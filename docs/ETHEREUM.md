# SUI vs ETHEREUM (DECODING & SCHEMA-AWARE)

## Summary
Ethereum decoding is ABI-driven (off-chain schemas), while Sui decoding is Move-metadata driven (on-chain schemas). Both benefit from traces and protocol-specific plugins, but the source of truth is different.

## Schema Source
- **Ethereum:** Contract ABI (function signatures, events, types).
- **Sui:** Move package metadata (struct layouts + function signatures).

## Schema Discovery
- **Ethereum:**
  - Verified source (Etherscan / Sourcify) exposes ABI.
  - Compiler metadata hash in bytecode can point to ABI if verified.
  - 4byte registries help infer selectors when ABI is missing.
- **Sui:**
  - Fullnode MovePackageService exposes normalized Move modules.
  - Package metadata is available on-chain and fetched directly.

## Runtime Data to Decode
- **Ethereum:**
  - Calldata (function selector + ABI-encoded args).
  - Logs (event topics + data) for state changes.
  - Traces (internal calls) for nested execution paths.
- **Sui:**
  - PTB commands (up to 1,024 ops in one transaction).
  - Object changes + balance changes are explicit in results.
  - BCS-encoded args decoded using Move type layouts.

## Execution Model Implications
- **Ethereum:**
  - Account model, state changes inferred via traces and logs.
  - Proxies require implementation resolution (EIP-1967, beacon).
- **Sui:**
  - Object model, state changes are first-class outputs.
  - PTB atomicity means partial failures invalidate the whole block.

## Decoder Pipeline Mapping
- **Ethereum approach:** ABI resolution → decode calldata/logs → trace enrichment → protocol plugins.
- **Sui equivalent:** MovePackageService → decode BCS → object/balance deltas → flow-specific plugins.

## Practical Takeaway
Ethereum relies on **off-chain ABIs + trace infrastructure**. Sui relies on **on-chain Move schemas + explicit object diffs**. A production Sui decoder should therefore prioritize Move metadata caching, PTB command decoding, and plugin matching over ABI heuristics.
