# DECODER COVERAGE STRATEGY

## Goal
Ship 80/20 coverage by targeting the most used packages/functions and expanding weekly based on indexer data.

## Data Sources
- gRPC streaming (live usage)
- General-purpose indexer SQL (weekly ranking)

## Weekly Update Loop
1. Pull top packages/functions for the last 7 days.
2. Update `lib/decoders/coverage.json`.
3. Add or refine plugin decoders for the top 10–15 flows.

## Example SQL (Indexer)
```sql
SELECT
  package_id,
  module,
  function,
  COUNT(*) AS tx_count,
  COUNT(DISTINCT sender) AS unique_senders
FROM transaction_calls
WHERE checkpoint BETWEEN :week_start AND :week_end
GROUP BY package_id, module, function
ORDER BY tx_count DESC
LIMIT 50;
```

## Plugin Workflow
- Each plugin targets a known package/module/function pattern.
- Plugins run before the fallback decoder.
- If no plugin matches, fallback explains raw object/balance changes.

