# SCHEMA-AWARE PTB DECODER DESIGN

This document defines a production-grade, schema-aware decoding engine for complex
Programmable Transaction Blocks (PTBs). It focuses on gRPC-first data access,
Move metadata usage, and safe fallbacks.

## GOALS
- Decode PTB commands into human-readable actions.
- Use Move schema metadata to type arguments and object changes.
- Preserve correctness via conservative fallback logic.
- Maintain low latency with aggressive caching.

## DATA FLOW OVERVIEW
1) Fetch transaction + effects + object set via gRPC.
2) Build a PTB command graph (inputs, commands, outputs).
3) Resolve Move function signatures and struct schemas.
4) Decode object contents (BCS) only when safe.
5) Render both human and machine-readable explanations.

## GRPC CALLS (EXACT)
### LedgerService.GetTransaction
Purpose: Retrieve transaction, effects, balance changes, and object set.

Request:
- digest: <tx_digest>
- read_mask.paths:
  - digest
  - transaction
  - effects
  - balance_changes
  - objects
  - timestamp

### MovePackageService.GetPackage
Purpose: Fetch full package metadata (modules, structs).

Request:
- package_id: <package_storage_id>

### MovePackageService.GetFunction
Purpose: Fetch function signature (parameters, return types).

Request:
- package_id: <package_storage_id>
- module_name: <module>
- name: <function>

### MovePackageService.GetDatatype
Purpose: Fetch struct/enum definition for a given type.

Request:
- package_id: <package_storage_id>
- module_name: <module>
- name: <datatype>

### MovePackageService.ListPackageVersions
Purpose: Optional audit of all versions for a package id.

Request:
- package_id: <package_storage_id>
- page_size: <n>
- page_token: <optional>

## PTB GRAPH CONSTRUCTION
Input:
- transaction.kind.data.programmableTransaction
- inputs[] (objects + pure values)
- commands[] (MoveCall, TransferObjects, SplitCoins, MergeCoins, Publish, etc.)

Output:
- A DAG with nodes = commands, edges = command outputs consumed later.
- A typed input table:
  - InputIndex -> Value
  - Value type (object, pure, result)

## TYPE RESOLUTION
For each MoveCall:
1) Load function signature via GetFunction.
2) Apply type arguments to get concrete parameter types.
3) Resolve struct types via GetDatatype (when needed).
4) Produce a typed argument list with human-readable labels.

For objects:
- Use effects.changedObjects + objects set to link object_id -> object_type.
- Map object_type -> struct schema via GetDatatype.

## BCS DECODING (SAFE PATH)
Decode only if:
- Struct schema is known and stable.
- Object size is below a safe threshold.
- Type is not in a denylist (privacy-sensitive or dynamic blobs).

If unsafe:
- Fall back to object type + owner + change kind.

## EXPLANATION LAYER
### Tier 1: PTB Commands
- TransferObjects -> "Transferred N objects to <address>"
- SplitCoins -> "Split coin into N outputs"
- MergeCoins -> "Merged coins"
- Publish -> "Published package"

### Tier 2: MoveCall Templates
Use package/module/function mapping for known protocols:
- swaps, staking, NFTs, game actions

### Tier 3: Fallback
- "Called <pkg::module::fn>"
- "Mutated <object_type>" if unknown

## CACHE DESIGN
Two-tier cache:
1) In-memory LRU (hot path)
2) Persistent KV/Redis (long TTL)

Suggested keys:
- pkg:<package_id>
- fn:<package_id>:<module>:<function>
- dt:<package_id>:<module>:<datatype>
- pkg_versions:<package_id>

TTL strategy:
- Packages are immutable -> long TTL (days/weeks)
- Function/datatype derived from package -> long TTL

## OUTPUT SCHEMA (HUMAN + MACHINE)
- Human: summary + timeline + detailed sections
- Machine: stable JSON with typed command graph + object changes

Example machine fields:
- tx.digest
- ptb.commands[] { kind, inputs, outputs, types }
- objectChanges[] { id, type, ownerBefore, ownerAfter, objectType }
- balanceChanges[] { address, coinType, amount }

## SAFETY LIMITS
- Max decode depth
- Max object size
- Max schema fetch time budget (per request)
- If budget exceeded -> fallback only

## DECODER INTERFACE (PLUGIN SDK)
```ts
export type DecodeContext = {
  tx: Transaction;
  effects: Effects;
  objectTypes: Record<string, string>;
  schemas: SchemaRegistry;
  ptb: PTBGraph;
};

export interface DecoderPlugin {
  id: string;
  match(ctx: DecodeContext): boolean;
  describe(ctx: DecodeContext): DecodedExplanation;
}
```

## IMPLEMENTATION PHASES
1) PTB command interpretation (no BCS decode)
2) Move metadata fetch + schema cache
3) Selective BCS decoding + advanced templates

