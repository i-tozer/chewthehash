# Sui Transaction Explainer MVP

A Next.js app that turns a Sui transaction digest into a plain‑language explanation in under three seconds. It ships with a serverless proxy, multi‑provider failover, cached immutable responses, and a fixture‑driven test suite.

## Objectives
- **Speed**: Time‑to‑first‑explanation under 3 seconds.
- **Accuracy**: Under 1% error rate on common transactions.
- **Resilience**: Multi‑provider failover and graceful degradation.
- **Security**: No direct browser → RPC calls; all traffic through a proxy.

## Architecture
- **UI**: Next.js App Router, digest input → summary + expandable details.
- **Proxy**: `/api/tx` validates input, rate‑limits, caches, retries, and fails over.
- **Parser**: Extracts Move calls, object changes, balance changes, and gas.
- **Resilience**: Circuit breaker + provider ordering based on health.

## RPC Strategy
- **gRPC‑first mindset** with JSON‑RPC support today.
- **Providers**: Primary + secondary (optionally tertiary) with health‑based routing.
- **Proxy responsibilities**:
  - Input validation
  - Caching immutable transaction responses
  - Rate limiting
  - Retries + circuit breaker
  - Provider failover

## Explanation Engine (MVP Scope)
- Parse **object changes**: created, transferred, mutated, deleted.
- Parse **Move calls** with simple labeling (package/module/function).
- Convert to short templates: “who did what to which object and who received it.”
- **Graceful fallback** for complex/unknown types (raw data view).
- **Heuristics** for coin detection and light aggregation to reduce clutter.

## Gas Presentation
- Convert **MIST → SUI** (1e9 MIST = 1 SUI).
- Display:
  - Total gas
  - Computation cost
  - Storage cost
  - Storage rebate
  - Budget usage (when available)

## UX Flow
- Digest input → loading skeletons → summary card (status, sender, gas).
- Expandable sections for Move calls, object changes, balance changes, raw data.
- “Explain another” CTA for rapid iteration.
- Optional stretch: sender → recipient flow visualization (transfers only).

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
- `SUI_GRPC_ENDPOINT` – gRPC endpoint host (example: `sui-mainnet.nodeinfra.com:443`).
- `SUI_GRPC_NETWORK` – Network name for the gRPC client (default: `mainnet`).
- `SUI_GRPC_AUTH_HEADER` – Optional auth header name for gRPC providers.
- `SUI_GRPC_AUTH_TOKEN` – Optional auth token for gRPC providers.
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

## Deliverables
- Public Next.js app
- Serverless proxy calling `sui_getTransactionBlock` with required options
- Core parser + template mapper
- Gas computation + UI display
- Documentation
- Fixture‑driven tests with E2E coverage

## Risks & Mitigations
- **RPC rate limits** → caching + rate limiting + provider failover.
- **Complex Move arguments** → conservative parsing + raw fallback.
- **Schema drift** → fixture suite + CI regressions.

## Success Metrics
- **TTFX** (time‑to‑first‑explanation): < 3 seconds
- **Accuracy**: < 1% error rate on common transactions
- **Uptime**: ≥ 99.5%

## Notes
- Gas values are converted from MIST to SUI (1e9 MIST = 1 SUI).
- Complex Move arguments fall back to raw data to avoid incorrect explanations.
- JSON‑RPC is the default; gRPC can be selected from the UI toggle once configured.
