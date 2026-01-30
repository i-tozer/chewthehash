# ROADMAP V2

## Phase A — Core Decode Engine (Foundation)
**Goal:** Build the single shared engine that all higher‑level features depend on.

**Scope**
- ABI/IDL fetch + cache (MovePackageService / normalized modules)
- Type argument substitution (generics, refs, nested types)
- Full BCS decoding for primitives, vectors, structs (recursive)
- Object argument handling (resolve object type + reference vs pure)
- PTB command graph (inputs → results → nested results)
- Return type tracking and Result/NestedResult decoding
- Error‑tolerant fallbacks + confidence annotations

**Deliverables**
- Type resolver + schema builder
- PTB dependency graph + output type inference
- Unified decoder pipeline with graceful fallback

---

## Phase B — Protocol Intelligence Layer
**Goal:** Add protocol‑specific understanding without hard‑coding in core logic.

**Scope**
- Protocol registry (Cetus, Turbos, DeepBook, etc.)
- Plugin SDK + test harness
- Human‑readable protocol labels and enriched summaries
- External plugin loading (optional/controlled)

**Deliverables**
- Stable plugin interface
- Protocol‑specific decoders with curated metadata
- Registry documentation + contribution workflow

---

## Phase C — Visualization & UX
**Goal:** Turn decoded data into clear, narrative UI.

**Scope**
- PTB flow visualization (command graph / arrows / timeline)
- Argument‑level breakdown for Move calls
- Object provenance (where objects came from, where they go)
- Expanded “What happened” narrative summary

**Deliverables**
- Interactive flow view
- UI components for decoded structs + argument inspection

---

## Phase D — Ecosystem & GTM
**Goal:** Ensure adoption and feedback loops.

**Scope**
- Design Partner Program (wallets + high‑volume dApps)
- Integration feedback + API hardening
- Public roadmap + open source governance

**Deliverables**
- Partner onboarding process
- Compatibility feedback + revisions

---

## Notes on De‑Duplication
This roadmap removes overlap across prior lists:
- **ABI/IDL awareness** is foundational and lives in Phase A.
- **Return type tracking** and **Result/NestedResult decoding** are PTB graph work in Phase A.
- **Protocol registry & labels** belong to Phase B (plugin layer).
- **Human‑readable coin/token names** are a by‑product of Phase A + Phase B metadata.
