# Sui Transaction Explainer MVP

## Overview
Build a publicly hosted web app that accepts a Sui transaction digest and returns a clear, plain‑language explanation in **under 3 seconds**. The MVP should move quickly to production while leaving room for RPC and ecosystem evolution.

## Objectives
- **Speed**: Time‑to‑first‑explanation under 3 seconds.
- **Accuracy**: Under 1% error rate on common transactions.
- **Resilience**: Multi‑provider failover and graceful degradation.
- **Security**: No direct browser → RPC calls; all traffic through a proxy.

## Architecture
- **Frontend**: Next.js (App Router) web UI.
- **Backend**: Serverless proxy (Next.js API Route).
- **Hosting**: Vercel or Netlify for global delivery and fast deploys.

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

## Testing & Documentation
- **Fixtures**: Recorded `SuiTransactionBlockResponse` payloads.
- **CI**: Deterministic parser unit tests + regression coverage.
- **E2E**: Validate full input → render flow.
- **Performance**: Lightweight proxy/parse latency checks.
- **Docs**: Architecture, RPC options, local dev, deployment, output interpretation.

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
