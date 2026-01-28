# SUI vs SOLANA (DECODING & SCHEMA-AWARE)

## Summary
Solana decoding depends on off-chain IDLs and account layouts, while Sui decoding uses on-chain Move metadata. Solana provides rich instruction traces but no canonical ABI; Sui provides type schemas via Move packages.

## Schema Source
- **Solana:** Program IDLs (Anchor/Shank) + custom account layouts (Borsh).
- **Sui:** Move package metadata (struct layouts + function signatures).

## Schema Discovery
- **Solana:**
  - Anchor IDLs are often published off-chain; some programs store IDLs on-chain.
  - No canonical network-wide ABI registry; decoders maintain their own IDL catalogs.
- **Sui:**
  - MovePackageService exposes normalized Move modules directly from the chain.
  - Schema discovery is native and consistent across nodes.

## Runtime Data to Decode
- **Solana:**
  - Instruction data (program-specific encoding, often Borsh).
  - Inner instructions from transaction meta.
  - Logs (program logs for additional context).
- **Sui:**
  - PTB commands with typed arguments.
  - Object changes + balance changes as structured outputs.

## Execution Model Implications
- **Solana:**
  - Account model; state diffs inferred by decoding account data before/after.
  - Heavy reliance on program-specific IDLs for meaning.
- **Sui:**
  - Object model; state changes are reported directly.
  - PTB atomicity and Move types improve deterministic decoding.

## Decoder Pipeline Mapping
- **Solana approach:** IDL catalog → decode instruction data → read account diffs/logs → protocol plugins.
- **Sui equivalent:** MovePackageService → decode BCS → object/balance deltas → flow-specific plugins.

## Practical Takeaway
Solana decoders must **maintain off-chain IDL coverage** and interpret account state deltas. Sui decoders should **cache on-chain Move schemas** and focus on PTB command decoding plus object-level diffs for accurate explanations.
