# FEATURE: FULL TYPE-AWARE BCS DECODING

## Goal
Decode BCS-encoded Move call arguments beyond primitives by using Move schemas, type arguments, and PTB command relationships. This upgrades the explainer from “command‑level summaries” to **typed argument-level explanations**.

## Why This Matters
PTBs pack arguments as BCS bytes. Without decoding, we only show *what* was called, not *with which values*. Fully type‑aware decoding unlocks:
- Exact amounts in splits/merges/swaps.
- Structured fields for custom structs.
- Clear human-readable summaries for complex flows.

## Current State (Baseline)
- Primitive decoding for `u8/u16/u32/u64/u128/u256/bool/address`.
- Limited `vector<primitive>` decoding.
- Works best for `Input(n)` when the argument is pure BCS.
- Does not decode structs, generics, or command result arguments.

## Full Solution Overview
### 1) Type Resolution
**Problem:** Move call signatures often use type parameters (e.g., `T0`, `T1`) that must be resolved.

**Plan:**
- Parse the Move function signature.
- Substitute type parameters using `typeArguments` on the Move call.
- Normalize the final parameter types (remove refs, expand generics).

### 2) Schema Acquisition (Move Metadata)
**Problem:** Struct layouts are not known locally.

**Plan:**
- Fetch normalized Move module metadata via `MovePackageService`.
- Build a schema registry (struct name → field definitions).
- Cache results (LRU + TTL) for performance.

### 3) Struct Layout Construction
**Problem:** BCS decode requires the exact struct layout.

**Plan:**
- For each struct type, recursively build a BCS schema:
  - Primitive fields → `bcs.u64()`, `bcs.bool()`, etc.
  - `vector<T>` → `bcs.vector(schema(T))`
  - Nested structs → `bcs.struct()`
- Support generic structs by instantiating schemas with resolved type args.

### 4) Argument Decoding
**Problem:** Inputs can be pure bytes, object refs, or results from prior commands.

**Plan:**
- **Pure inputs**: Decode using the resolved schema.
- **Object inputs**: Resolve object type, and optionally fetch object contents if needed for argument‑level summaries.
- **Result/NestedResult inputs**:
  - Infer result type from previous commands (using metadata + signature returns).
  - Decode only when a command output is BCS‑serializable.

### 5) PTB Command Dependency Graph
**Problem:** Results from earlier commands are used later.

**Plan:**
- Build a lightweight PTB graph:
  - Each command output tagged with inferred type.
  - Each argument consumes either an input or prior result.
- This enables resolution of `Result(n)` and `NestedResult(n,m)` types.

### 6) Decoder Confidence + Fallbacks
**Problem:** Not all types can be resolved, and some packages are unverified.

**Plan:**
- Attach confidence levels per decoded argument.
- Fallback to raw bytes if schema resolution fails.
- Surface warnings: “Struct schema unavailable” or “Type args unresolved”.

## Data Pipeline
1. Fetch transaction (gRPC preferred).
2. Parse PTB inputs + commands.
3. Fetch Move metadata for involved packages/modules.
4. Resolve function signatures + type args.
5. Build BCS schema per arg type.
6. Decode BCS bytes into structured values.
7. Render in UI with confidence + fallback info.

## Scope Phasing
**Phase 1 (80/20):**
- Decode primitives + vector<primitive> for all inputs.
- Add type parameter substitution.
- Support structs for 0x2 and top packages.

**Phase 2 (Core structs):**
- Full struct decoding for common DeFi/NFT packages.
- Resolve `Result/NestedResult` types for basic flows.

**Phase 3 (Deep coverage):**
- Full PTB graph type inference.
- Decode complex nested structs + vectors of structs.
- Object content hydration for richer narratives.

## Risks & Mitigations
- **Schema drift:** cache invalidation by package version; tie schemas to package ID.
- **Performance:** heavy decode paths require caching + concurrency limits.
- **Missing metadata:** use fallback summaries and mark as low confidence.

## Deliverables
- BCS schema resolver (Move metadata → BCS types).
- Type substitution engine (type params + generics).
- PTB dependency tracker (inputs/results).
- UI: expanded argument details with decoded values + confidence.

## Success Criteria
- Common flows (coin split/merge, transfers, swaps) show exact amounts.
- For top packages, struct arguments render into human‑readable fields.
- Decoder gracefully falls back with no runtime errors.
