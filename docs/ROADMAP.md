# ROADMAP

## TECHNICAL

### gRPC‑first infrastructure
- Make gRPC the primary path, keep JSON‑RPC as a fallback.
- Track per‑provider latency/error rates and enforce health‑based failover.
- Add streaming ingestion (subscriptions/checkpoints) for low‑latency updates.

### PTB decoding depth
- Interpret Programmable Transaction Block commands (transfer, split, merge, publish, etc.).
- Convert common command sequences into concise, human‑readable actions.
- Maintain safe fallbacks for unknown or complex patterns.

### Move schema + object decoding
- Fetch Move package metadata and schema data via gRPC.
- Decode object contents (BCS → structured JSON) when safe.
- Cache schemas aggressively to keep latency low.

### Simulation and pre‑execution insight
- Add transaction simulation endpoints for “what will happen” previews.
- Surface predicted balance/object changes in the UI and API.

### Structured output for agents
- Emit a stable, machine‑readable explanation schema alongside human text.
- Version the schema to avoid breaking downstream integrators.

### Performance + reliability
- Enforce a 3s SLO (proxy + parse + render) with automated checks.
- Add persistent caching (KV/Redis) and CDN cache headers.
- Add structured logs, metrics, and alerts for provider health.

### Security + safety
- Tighten input validation and request size limits.
- Harden rate limiting (token bucket + soft bans).
- Add explicit redaction modes for privacy‑sensitive transactions.

### Plugin decoder SDK
- Create a decoder registry for project‑specific templates.
- Provide a test harness and versioned compatibility guarantees.

## COMMUNITY & DISTRIBUTION

### Wallet integrations
- Build embeddable UI components for wallets (signing flow integration).
- Prioritize Sui Wallet, Suiet, Ethos, Martian as design partners.

### Developer adoption
- Publish SDKs and starter templates for dApps.
- Offer stable API contracts and example integrations.

### Ecosystem partnerships
- Run a design‑partner program with high‑volume apps.
- Coordinate with Sui Foundation for grants and co‑marketing.

### Community contributions
- Open a plugin marketplace/repository for decoder contributions.
- Maintain clear contribution guidelines and review processes.

### Education + transparency
- Publish public docs, changelogs, and roadmap updates.
- Document outages, provider switches, and reliability metrics.

### Sustainability
- Open‑core model: free decoding + paid hosted features (SLAs, scale, risk tooling).
- Keep core logic open for trust and long‑term alignment.
