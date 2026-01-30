import { bcs, fromBase64, fromHex, toHex } from '@mysten/bcs';
import { LRUCache } from 'lru-cache';
import { getGrpcClientForAbi } from './grpc';

const OPEN_SIGNATURE_BODY_TYPE = {
  TYPE_UNKNOWN: 0,
  ADDRESS: 1,
  BOOL: 2,
  U8: 3,
  U16: 4,
  U32: 5,
  U64: 6,
  U128: 7,
  U256: 8,
  VECTOR: 9,
  DATATYPE: 10,
  TYPE_PARAMETER: 11
} as const;

type OpenSignatureBody = {
  type?: number;
  typeName?: string;
  typeParameterInstantiation?: OpenSignatureBody[];
  typeParameter?: number;
};

type OpenSignature = {
  body?: OpenSignatureBody;
};

type FunctionDescriptor = {
  parameters?: OpenSignature[];
};

type FieldDescriptor = {
  name?: string;
  type?: OpenSignatureBody;
};

type DatatypeDescriptor = {
  typeName?: string;
  name?: string;
  module?: string;
  kind?: number;
  fields?: FieldDescriptor[];
  typeParameters?: Array<{ constraints: number[]; isPhantom?: boolean }>;
};

type DecodedArg = {
  index: number;
  value: string;
  type: string;
};

const functionCache = new LRUCache<string, { value: FunctionDescriptor; cachedAt: number }>({
  max: 1000,
  ttl: 1000 * 60 * 60
});

const datatypeCache = new LRUCache<string, { value: DatatypeDescriptor; cachedAt: number }>({
  max: 2000,
  ttl: 1000 * 60 * 60
});

const structSchemaCache = new LRUCache<string, any>({
  max: 500,
  ttl: 1000 * 60 * 30
});

function toBytes(raw: string | Uint8Array | null | undefined): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw !== 'string') return null;
  if (raw.startsWith('0x')) return fromHex(raw);
  return fromBase64(raw);
}

function parseTypeName(typeName: string) {
  const base = typeName.split('<')[0];
  const [pkg, moduleName, name] = base.split('::');
  if (!pkg || !moduleName || !name) return null;
  return { packageId: pkg, moduleName, name };
}

function splitParams(paramStr: string) {
  const params: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of paramStr) {
    if (char === '<') depth += 1;
    if (char === '>') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function parseTypeTag(typeTag: string): OpenSignatureBody | null {
  const trimmed = typeTag.trim();
  if (trimmed.startsWith('&mut ')) return parseTypeTag(trimmed.slice(5));
  if (trimmed.startsWith('&')) return parseTypeTag(trimmed.slice(1));

  if (trimmed.startsWith('vector<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(7, -1);
    const innerBody = parseTypeTag(inner);
    if (!innerBody) return null;
    return {
      type: OPEN_SIGNATURE_BODY_TYPE.VECTOR,
      typeParameterInstantiation: [innerBody]
    };
  }

  const primitiveMap: Record<string, number> = {
    address: OPEN_SIGNATURE_BODY_TYPE.ADDRESS,
    bool: OPEN_SIGNATURE_BODY_TYPE.BOOL,
    u8: OPEN_SIGNATURE_BODY_TYPE.U8,
    u16: OPEN_SIGNATURE_BODY_TYPE.U16,
    u32: OPEN_SIGNATURE_BODY_TYPE.U32,
    u64: OPEN_SIGNATURE_BODY_TYPE.U64,
    u128: OPEN_SIGNATURE_BODY_TYPE.U128,
    u256: OPEN_SIGNATURE_BODY_TYPE.U256
  };

  if (primitiveMap[trimmed]) {
    return { type: primitiveMap[trimmed] };
  }

  const [base, generics] = trimmed.split('<');
  if (base?.includes('::')) {
    const body: OpenSignatureBody = {
      type: OPEN_SIGNATURE_BODY_TYPE.DATATYPE,
      typeName: base
    };
    if (generics && trimmed.endsWith('>')) {
      const params = splitParams(generics.slice(0, -1));
      body.typeParameterInstantiation = params
        .map((param) => parseTypeTag(param))
        .filter(Boolean) as OpenSignatureBody[];
    }
    return body;
  }

  return null;
}

function formatOpenSignatureBody(body: OpenSignatureBody): string {
  switch (body.type) {
    case OPEN_SIGNATURE_BODY_TYPE.ADDRESS:
      return 'address';
    case OPEN_SIGNATURE_BODY_TYPE.BOOL:
      return 'bool';
    case OPEN_SIGNATURE_BODY_TYPE.U8:
      return 'u8';
    case OPEN_SIGNATURE_BODY_TYPE.U16:
      return 'u16';
    case OPEN_SIGNATURE_BODY_TYPE.U32:
      return 'u32';
    case OPEN_SIGNATURE_BODY_TYPE.U64:
      return 'u64';
    case OPEN_SIGNATURE_BODY_TYPE.U128:
      return 'u128';
    case OPEN_SIGNATURE_BODY_TYPE.U256:
      return 'u256';
    case OPEN_SIGNATURE_BODY_TYPE.VECTOR: {
      const inner = body.typeParameterInstantiation?.[0];
      return `vector<${inner ? formatOpenSignatureBody(inner) : 'unknown'}>`;
    }
    case OPEN_SIGNATURE_BODY_TYPE.DATATYPE:
      return body.typeName ?? 'datatype';
    case OPEN_SIGNATURE_BODY_TYPE.TYPE_PARAMETER:
      return `T${body.typeParameter ?? 0}`;
    default:
      return 'unknown';
  }
}

function resolveTypeParameters(
  body: OpenSignatureBody,
  typeArgs: OpenSignatureBody[]
): OpenSignatureBody {
  if (body.type === OPEN_SIGNATURE_BODY_TYPE.TYPE_PARAMETER) {
    const index = body.typeParameter ?? 0;
    return typeArgs[index] ?? body;
  }
  if (body.type === OPEN_SIGNATURE_BODY_TYPE.VECTOR) {
    const inner = body.typeParameterInstantiation?.[0];
    if (!inner) return body;
    return {
      ...body,
      typeParameterInstantiation: [resolveTypeParameters(inner, typeArgs)]
    };
  }
  if (body.type === OPEN_SIGNATURE_BODY_TYPE.DATATYPE) {
    const params = body.typeParameterInstantiation ?? [];
    return {
      ...body,
      typeParameterInstantiation: params.map((param) =>
        resolveTypeParameters(param, typeArgs)
      )
    };
  }
  return body;
}

function getPrimitiveBcsType(body: OpenSignatureBody) {
  switch (body.type) {
    case OPEN_SIGNATURE_BODY_TYPE.U8:
      return bcs.u8();
    case OPEN_SIGNATURE_BODY_TYPE.U16:
      return bcs.u16();
    case OPEN_SIGNATURE_BODY_TYPE.U32:
      return bcs.u32();
    case OPEN_SIGNATURE_BODY_TYPE.U64:
      return bcs.u64();
    case OPEN_SIGNATURE_BODY_TYPE.U128:
      return bcs.u128();
    case OPEN_SIGNATURE_BODY_TYPE.U256:
      return bcs.u256();
    case OPEN_SIGNATURE_BODY_TYPE.BOOL:
      return bcs.bool();
    case OPEN_SIGNATURE_BODY_TYPE.ADDRESS:
      return bcs.bytes(32);
    default:
      return null;
  }
}

function formatDecodedValue(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return `0x${toHex(value)}`;
  if (Array.isArray(value)) return `[${value.map(formatDecodedValue).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, val]) => `${key}: ${formatDecodedValue(val)}`
    );
    return `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

async function getFunctionDescriptor(
  packageId: string,
  moduleName: string,
  functionName: string
): Promise<FunctionDescriptor | null> {
  const key = `${packageId}::${moduleName}::${functionName}`;
  const cached = functionCache.get(key);
  if (cached) return cached.value;

  const clientInfo = getGrpcClientForAbi();
  if (!clientInfo) return null;

  const { response } = await clientInfo.client.movePackageService.getFunction({
    packageId,
    moduleName,
    name: functionName
  });
  const fn = (response as any).function;
  if (!fn) return null;
  functionCache.set(key, { value: fn, cachedAt: Date.now() });
  return fn;
}

async function getDatatypeDescriptor(typeName: string): Promise<DatatypeDescriptor | null> {
  const cached = datatypeCache.get(typeName);
  if (cached) return cached.value;

  const parsed = parseTypeName(typeName);
  if (!parsed) return null;

  const clientInfo = getGrpcClientForAbi();
  if (!clientInfo) return null;

  const { response } = await clientInfo.client.movePackageService.getDatatype({
    packageId: parsed.packageId,
    moduleName: parsed.moduleName,
    name: parsed.name
  });
  const datatype = (response as any).datatype;
  if (!datatype) return null;
  datatypeCache.set(typeName, { value: datatype, cachedAt: Date.now() });
  return datatype;
}

async function buildBcsType(
  body: OpenSignatureBody,
  typeArgs: OpenSignatureBody[]
): Promise<any> {
  const resolved = resolveTypeParameters(body, typeArgs);
  const primitive = getPrimitiveBcsType(resolved);
  if (primitive) return primitive;

  if (resolved.type === OPEN_SIGNATURE_BODY_TYPE.VECTOR) {
    const inner = resolved.typeParameterInstantiation?.[0];
    if (!inner) return null;
    const innerType = await buildBcsType(inner, typeArgs);
    if (!innerType) return null;
    return bcs.vector(innerType);
  }

  if (resolved.type === OPEN_SIGNATURE_BODY_TYPE.DATATYPE && resolved.typeName) {
    const cacheKey = `${resolved.typeName}::${JSON.stringify(typeArgs)}`;
    const cached = structSchemaCache.get(cacheKey);
    if (cached) return cached;

    const datatype = await getDatatypeDescriptor(resolved.typeName);
    if (!datatype || datatype.kind !== 1) return null;
    const fields = datatype.fields ?? [];
    const schema: Record<string, any> = {};
    for (const field of fields) {
      const fieldType = field.type;
      if (!fieldType || !field.name) return null;
      const fieldSchema = await buildBcsType(fieldType, typeArgs);
      if (!fieldSchema) return null;
      schema[field.name] = fieldSchema;
    }
    const struct = bcs.struct(datatype.name ?? 'Struct', schema);
    structSchemaCache.set(cacheKey, struct);
    return struct;
  }

  return null;
}

async function decodeArgValue(
  body: OpenSignatureBody,
  bytes: Uint8Array,
  typeArgs: OpenSignatureBody[]
): Promise<string | null> {
  const resolved = resolveTypeParameters(body, typeArgs);
  const primitive = getPrimitiveBcsType(resolved);
  if (primitive) {
    const value = primitive.parse(bytes);
    if (resolved.type === OPEN_SIGNATURE_BODY_TYPE.ADDRESS) {
      return `0x${toHex(value as Uint8Array)}`;
    }
    return formatDecodedValue(value);
  }

  if (resolved.type === OPEN_SIGNATURE_BODY_TYPE.VECTOR) {
    const inner = resolved.typeParameterInstantiation?.[0];
    if (!inner) return null;
    const innerType = await buildBcsType(inner, typeArgs);
    if (!innerType) return null;
    const values = bcs.vector(innerType).parse(bytes);
    return formatDecodedValue(values);
  }

  if (resolved.type === OPEN_SIGNATURE_BODY_TYPE.DATATYPE) {
    const structType = await buildBcsType(resolved, typeArgs);
    if (!structType) return null;
    const value = structType.parse(bytes);
    return formatDecodedValue(value);
  }

  return null;
}

function getInputIndex(arg: any): number | null {
  if (!arg) return null;
  if (typeof arg.Input === 'number') return arg.Input;
  if (typeof arg.input === 'number') return arg.input;
  if (typeof arg === 'string') {
    const match = arg.match(/Input\\((\\d+)\\)/);
    if (match) return Number(match[1]);
  }
  return null;
}

export async function decodeMoveCallArgsWithAbi(args: {
  packageId: string;
  moduleName: string;
  functionName: string;
  typeArguments?: string[];
  arguments: any[];
  inputs: any[];
  objectTypes?: Record<string, string>;
}): Promise<DecodedArg[]> {
  const fn = await getFunctionDescriptor(
    args.packageId,
    args.moduleName,
    args.functionName
  );
  if (!fn?.parameters) return [];

  const typeArgs = (args.typeArguments ?? [])
    .map((tag) => parseTypeTag(tag))
    .filter(Boolean) as OpenSignatureBody[];

  const decoded: DecodedArg[] = [];

  for (let i = 0; i < args.arguments.length; i += 1) {
    const arg = args.arguments[i];
    const inputIndex = getInputIndex(arg);
    if (inputIndex === null) continue;
    const input = args.inputs[inputIndex];
    const object = input?.Object ?? null;
    const objectId =
      object?.ImmOrOwnedObject?.objectId ??
      object?.SharedObject?.objectId ??
      object?.Receiving?.objectId ??
      object?.objectId ??
      null;

    const paramBody = fn.parameters?.[i]?.body;
    if (!paramBody) continue;
    const typeLabel = paramBody.typeName ?? formatOpenSignatureBody(paramBody);

    if (objectId) {
      const objectType = args.objectTypes?.[objectId];
      const value = objectType ? `${objectId} (${objectType})` : objectId;
      decoded.push({ index: i, value, type: typeLabel });
      continue;
    }

    const pure = input?.Pure ?? input?.pure ?? null;
    const bytes = toBytes(pure?.bytes ?? pure ?? null);
    if (!bytes) continue;
    const value = await decodeArgValue(paramBody, bytes, typeArgs);
    if (!value) continue;
    decoded.push({ index: i, value, type: typeLabel });
  }

  return decoded;
}
