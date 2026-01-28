# IMPROVEMENTS

## GRPC PATH
**Proposed change:** Add gRPC support behind the proxy, keep JSON‑RPC as a fallback, and track provider latency/error rates per request.
**Benefits:** Lower latency and better long‑term compatibility as JSON‑RPC deprecates; safer failover decisions based on real performance.

## SCHEMA-AWARE PARSING
**Proposed change:** Build a package/module label map for common protocols and expand templates for known Move calls.
**Benefits:** More accurate, human‑readable explanations without increasing risk for unknown/complex calls.

## BETTER CACHING
**Proposed change:** Add a persistent cache (KV/Redis) keyed by digest + options and set CDN cache headers for immutable responses.
**Benefits:** Faster repeat explanations, lower RPC costs, and improved uptime under load.

## OBSERVABILITY
**Proposed change:** Emit structured logs, latency histograms, error codes, and per‑provider health metrics; add SLO alerts.
**Benefits:** Faster debugging, clearer reliability posture, and proactive detection of provider degradation.

## SMARTER RATE LIMITING
**Proposed change:** Implement token bucket per IP (and per API key if auth is added), with progressive backoff or soft bans.
**Benefits:** Better protection against abuse without blocking legitimate power users.

## UI CLARITY
**Proposed change:** Add a “What happened” timeline, object name/type badges, and improve raw JSON rendering with collapsible sections.
**Benefits:** Faster scanning, lower cognitive load, and more confident interpretation of complex transactions.

## SECURITY HARDENING
**Proposed change:** Add strict request size limits, stronger digest validation, and conservative parsing for unknown types.
**Benefits:** Reduced attack surface and fewer misleading explanations.

## TESTING DEPTH
**Proposed change:** Expand fixtures to include failures, complex Move calls, shared objects, coin merges/splits, and NFTs.
**Benefits:** Higher confidence in edge cases and fewer regressions as schemas evolve.

## PERFORMANCE BUDGET
**Proposed change:** Enforce a 3s SLO with automated checks covering proxy latency, parsing time, and rendering time.
**Benefits:** Keeps the UX fast and prevents regressions before release.

## DEPLOYMENT HYGIENE
**Proposed change:** Document provider switch procedures, rollback steps, and an outage runbook.
**Benefits:** Faster recovery during incidents and clearer operational ownership.
