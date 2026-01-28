# Sui Transaction Explainer MVP

A Next.js app that turns a Sui transaction digest into a plain‑language explanation in under three seconds. It ships with a serverless proxy, multi‑provider failover, cached immutable responses, and a fixture‑driven test suite.

## Architecture
- **UI**: Next.js App Router, digest input → summary + expandable details.
- **Proxy**: `/api/tx` validates input, rate‑limits, caches, retries, and fails over.
- **Parser**: Extracts Move calls, object changes, balance changes, and gas.
- **Resilience**: Circuit breaker + provider ordering based on health.

## Getting started
```bash
npm install
npm run dev
```

Open `http://localhost:3000` and paste a digest.

## Environment variables
- `SUI_RPC_PRIMARY` – Primary JSON‑RPC URL (recommended).
- `SUI_RPC_SECONDARY` – Secondary JSON‑RPC URL for failover.
- `SUI_RPC_TERTIARY` – Optional third provider.
- `SUI_RPC_TIMEOUT_MS` – Per‑request timeout (default: `2200`).
- `RATE_LIMIT_MAX` – Requests per IP per window (default: `30`).
- `RATE_LIMIT_WINDOW_MS` – Rate limit window in ms (default: `60000`).
- `FIXTURE_MODE` – Set to `1` to respond with local fixtures (used by E2E tests).

## RPC call details
The proxy calls `sui_getTransactionBlock` with the following options:
```json
{
  "showInput": true,
  "showEffects": true,
  "showEvents": false,
  "showObjectChanges": true,
  "showBalanceChanges": true
}
```

## Testing
- Unit + parser tests: `npm test`
- E2E (UI + API + parser via fixtures): `npm run test:e2e`

### Playwright note
The E2E config runs the dev server on port `3006` to avoid clashes with other local apps. Adjust `playwright.config.ts` if you need a different port.

## Deployment
Deploy on Vercel or Netlify. Set the RPC provider env vars and keep `FIXTURE_MODE` unset.

## Notes
- Gas values are converted from MIST to SUI (1e9 MIST = 1 SUI).
- Complex Move arguments fall back to raw data to avoid incorrect explanations.
- JSON‑RPC is used today; provider config is structured for future gRPC upgrades.
