# Suggested Improvements

- gRPC path: add gRPC support behind the proxy with a JSON‑RPC fallback; measure latency and error rates per provider.
- Schema‑aware parsing: map known packages/modules to richer templates; keep strict fallback for unknowns.
- Better caching: persistent cache (KV/Redis) keyed by digest + options; add cache headers for CDN.
- Observability: structured logs, latency histograms, error codes, and per‑provider health stats; add SLO alerts.
- Smarter rate limiting: token bucket per IP + per API key (if you add auth), with soft bans on abuse.
- UI clarity: add “What happened” timeline; include object name/type badges; improve raw view (collapsible sections).
- Security hardening: input throttling, request size limits, and tighter zod validation (length + base58/hex).
- Testing depth: add fixtures for failures, complex Move calls, shared objects, coin merges/splits, and NFTs.
- Performance budget: enforce a 3s SLO with automated checks (proxy + parse + render).
- Deployment hygiene: add provider switcher docs + runbook for provider outages.
