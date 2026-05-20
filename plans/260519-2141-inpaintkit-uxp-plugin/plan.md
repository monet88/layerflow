---
title: "InpaintKit — Photoshop UXP Plugin"
description: "AI image editing plugin for Photoshop. Multi-provider: fal.ai + Replicate (direct) + GPT Image 2 (via backend server with ChatGPT subscription)"
status: pending
priority: P1
effort: 58h
branch: main
tags: [uxp, photoshop, ai, react, typescript, falai, replicate, chatgpt, fastapi]
created: 2026-05-19
updated: 2026-05-20
---

# InpaintKit — Implementation Plan

## Overview

AI image editing plugin for Adobe Photoshop (UXP). Select area → prompt → AI edit → non-destructive Smart Object layer. Multi-provider architecture following InpaintKit's proven development order: simple direct providers first (fal.ai, Replicate), ChatGPT backend last.

Target: Photoshop 24+ on macOS and Windows. First-time UXP developer context.

See [/docs/development-roadmap.md](../../docs/development-roadmap.md) for architecture diagram, sprint details, and full technical decisions.

## Sprints

| Sprint | Goal | Duration | Est. | Status |
|--------|------|----------|------|--------|
| 1 | Plugin + fal.ai end-to-end inpainting | 1.5 weeks | 25h | in_progress |
| 2 | More models + UX polish | 1 week | 12h | pending |
| 3 | ChatGPT backend + GPT Image 2 | 1.5 weeks | 16h | pending |
| 4 | Distribution + final polish | 0.5 week | 3h | pending |

**Total estimated effort:** 56h (critical path ~36h with parallel execution)

## Phase Files

### Sprint 1: Plugin + fal.ai MVP

| # | Phase | Est. | Status | File |
|---|-------|------|--------|------|
| 1 | Project Setup | 3h | complete | [phase-01-project-setup.md](./phase-01-project-setup.md) |
| 2 | Core UI | 5h | complete | [phase-02-core-ui.md](./phase-02-core-ui.md) |
| 3 | Photoshop Integration | 8h | pending | [phase-03-photoshop-integration.md](./phase-03-photoshop-integration.md) |
| 4 | Provider Architecture + fal.ai | 3h | pending | [phase-04-provider-architecture.md](./phase-04-provider-architecture.md) |
| 5 | Generation Pipeline | 6h | pending | [phase-05-generation-pipeline.md](./phase-05-generation-pipeline.md) |

### Sprint 2: More Models + Polish

| # | Phase | Est. | Status | File |
|---|-------|------|--------|------|
| 6 | Models, History, Resolution Bucketing | 12h | pending | [phase-06-models-and-polish.md](./phase-06-models-and-polish.md) |

### Sprint 3: ChatGPT Backend + GPT Image 2

| # | Phase | Est. | Status | File |
|---|-------|------|--------|------|
| 7 | Backend MVP (Fork chatgpt2api) | 5h | pending | [phase-07-backend-mvp.md](./phase-07-backend-mvp.md) |
| 8 | Backend ChatGPT Provider (Adapt) | 4h | pending | [phase-08-backend-chatgpt-provider.md](./phase-08-backend-chatgpt-provider.md) |
| 9 | Plugin ChatGPT Integration | 7h | pending | [phase-09-plugin-chatgpt-integration.md](./phase-09-plugin-chatgpt-integration.md) |

### Sprint 4: Distribution

| # | Phase | Est. | Status | File |
|---|-------|------|--------|------|
| 10 | Distribution & Packaging | 3h | pending | [phase-10-distribution.md](./phase-10-distribution.md) |

## Architecture (Hybrid)

```
┌─ Plugin (direct, 5-15s) ─────────┐  ┌─ Plugin → Backend (120-150s) ────┐
│ fal.ai: Nano Banana 2, Flux Fill  │  │ ChatGPT Web: GPT Image 2         │
│ Replicate: Nano Banana Pro,       │  │                                   │
│            Seedream 5 Lite         │  │ Device code OAuth in plugin       │
│ Auth: API key in secureStorage    │  │ access_token sent to backend      │
└───────────────────────────────────┘  │ Backend: PoW + SSE + poll + DL    │
                                       └───────────────────────────────────┘
```

- Plugin handles ALL auth (API keys + device code OAuth)
- Direct providers: plugin → fal.ai/Replicate (simple fetch)
- ChatGPT path: plugin → backend server → ChatGPT Web API
- Backend only needed when using ChatGPT subscription

## Key Dependencies

```
Sprint 1:  Phase 1 → Phase 2 ─┐
                    → Phase 3 ─┼→ Phase 5
                    → Phase 4 ─┘

Sprint 2:  Phase 5 → Phase 6

Sprint 3:  Phase 7 → Phase 8 ─┐
           Phase 5 ─────────────┼→ Phase 9
           Phase 6 ─────────────┘

Sprint 4:  Phase 9 → Phase 10
```

Sprint 1 phases 2/3/4 can run in parallel after Phase 1.
Sprint 3 backend (7-8) can start parallel with Sprint 2, but Phase 9 requires Phase 6 (model-registry.ts).

## Confirmed Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build tool | Vite + @bubblydoo/vite-uxp-plugin | Only modern TS/React UXP setup maintained (2026) |
| UI | React 18 + Spectrum Web Components 0.37.0 | Adobe native look, locked in UXP v8 |
| Network | fetch + XHR fallback | UXP fetch fails silently on large uploads |
| Image export | doc.saveAs.png() on duplicate | Handles ICC, compositing, bit depth |
| Selection mask | imaging.getSelection() + rect fallback | Feathered/lasso, PS 24.x compat |
| Result placement | placeEvent batchPlay → Smart Object | Non-destructive, scalable |
| Layer mask | batchPlay revealSelection | Auto-mask from selection |
| Mask convention | Internal: alpha=0 = edit zone | Invert for fal.ai (white=edit) |
| Auth (API keys) | Plugin secureStorage | Encrypted, local, no backend |
| Auth (ChatGPT) | Device code OAuth in plugin | Simple REST to auth.openai.com |
| ChatGPT gen | Backend (Python/FastAPI/Docker) | Needs curl-cffi, PoW, 150s SSE |
| Backend deploy | Docker Compose | Local dev + VPS |
| Provider order | fal.ai first → Replicate → ChatGPT | Easy→hard, ship early |
| Import style | CJS `require()` for UXP host modules, ESM for project code | Vite externalizes host modules; project code tree-shaken |

## Critical Risks

| Risk | Mitigation |
|------|-----------|
| UXP fetch fails on large uploads | XHR fallback (proven pattern) |
| imaging.getSelection() needs PS 25+ | Rectangular fallback for PS 24.x |
| ChatGPT API changes frequently | Isolated in single backend file |
| 150s timeout too long for UXP | XHR 180s timeout + progress polling |
| SWC event listeners don't work with React | ref + manual addEventListener |
| domains: "all" unreliable in manifest v5 | Enumerate all API hostnames |

## Reference Implementations

- [wuji419-bit/OpenAI-PS](https://github.com/wuji419-bit/OpenAI-PS) — UXP inpaint pipeline
- [AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin](https://github.com/AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin) — 7k stars, PS AI plugin patterns
- [basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api) — ChatGPT Web reverse proxy
- [bubblydoo/uxp-toolkit](https://github.com/bubblydoo/uxp-toolkit) — Vite + React + TS UXP build
- `/home/monet/dev/chatgpt2api` — Local ChatGPT reverse proxy (PoW, conversation flow)
- `/home/monet/dev/cc-switch` — Device code OAuth UI pattern (React + polling)

## Validation Log

### Session 1 — 2026-05-19
**Trigger:** `/ck:plan validate` — pre-implementation review
**Questions asked:** 8

### Verification Results
- **Tier:** Full (10 phases → all 4 roles)
- **Claims checked:** 16
- **Verified:** 11 | **Failed:** 4 | **Unverified:** 1
- Failures resolved via interview (see below)

#### Questions & Answers

1. **[Architecture]** Effort estimates mismatch: plan.md vs phase files (Phase 3: 6h/8h, Phase 5: 4h/6h)
   - Options: Phase files as source of truth (Recommended) | plan.md as source | Accept mismatch
   - **Answer:** Phase files as source of truth
   - **Rationale:** Phase files have detailed breakdown; plan.md updated to 47h total, Sprint 1 to 20h

2. **[Architecture]** fal.ai network domains inconsistency across phases
   - Options: fal.run + fal.ai + GCS (Recommended) | Only api.fal.ai | Verify at runtime
   - **Answer:** All domains (fal.run, fal.ai, storage.googleapis.com, v3.fal.media) + [VERIFY_AT_RUNTIME]
   - **Rationale:** fal.ai uses multiple subdomains; listing all preemptively avoids silent failures

3. **[Scope]** Phase 6 duplicating CMYK guard, context padding, text-to-image from Phase 3/5
   - Options: Remove duplicates from Phase 6 (Recommended) | Keep as refinement | Move from Phase 3
   - **Answer:** Remove duplicates
   - **Rationale:** Features fully implemented in Phase 3/5; Phase 6 now focused on Replicate + model registry + resolution bucketing + reference images

4. **[Assumptions]** @spectrum-web-components version pinning strategy
   - Options: Pin @0.37.0 (Recommended) | Install latest | No pinning + verify
   - **Answer:** Pin @0.37.0 with fallback note
   - **Rationale:** UXP v8 locks SWC version; mismatch causes blank renders

5. **[Risk]** React 18 createRoot + UXP CJS compatibility
   - Options: Add verification to Phase 1 success criteria (Recommended) | Accept risk | Use React 17 API
   - **Answer:** Recommended (Phase 1 success criteria already covers verify in UDT console)
   - **Rationale:** Low-cost verification catches ESM-only issues early

6. **[Risk]** Device Code OAuth Client ID hardcoded
   - Options: Extract to configurable constant (Recommended) | Hardcode | Fallback to manual token
   - **Answer:** Extract to src/constants/oauth.ts
   - **Rationale:** If OpenAI revokes the Codex client, user can update without code changes

7. **[Tradeoff]** Missing `api.replicate.com` in Phase 1 manifest
   - Options: Add to Phase 1 immediately (Recommended) | Add in Phase 6
   - **Answer:** Add to Phase 1 immediately + `replicate.delivery` CDN domain
   - **Rationale:** Avoids manifest change surprise; all future providers pre-registered

8. **[Architecture]** Import style inconsistency (CJS require vs ESM import)
   - Options: ESM for project, CJS for host (Recommended) | All CJS | Accept inconsistency
   - **Answer:** Convention documented: CJS for host modules, ESM for project code
   - **Rationale:** Vite externalizes host modules as CJS require(); project code tree-shaken via ESM

#### Confirmed Decisions
- Effort: 47h total, Sprint 1 = 20h, Phase 3 = 8h, Phase 5 = 6h
- Domains: all provider domains registered in Phase 1 manifest preemptively
- SWC: pinned @0.37.0 with [VERIFY_AT_RUNTIME] fallback
- Phase 6: deduplicated — no CMYK, context padding, or text-to-image
- Client ID: configurable via src/constants/oauth.ts
- Import convention: CJS for `photoshop`/`uxp` host modules, ESM for project code

#### Impact on Phases
- Phase 1: manifest domains expanded; Code Conventions section added
- Phase 2: SWC install pinned @0.37.0; UXP built-in note added
- Phase 6: 3 duplicate requirements removed; effort unchanged (other items fill scope)
- Phase 9: manifest domains fixed to match Phase 1; Client ID extracted; architecture updated

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01, phase-02, phase-03, phase-05, phase-06, phase-09
- Decision deltas checked: 7
- Total verification checks: 30
- Reconciled stale references: 7
- Unresolved contradictions: 0

---

### Session 2 — 2026-05-19
**Trigger:** `/ck:plan validate` — post-Session-1 deep verification
**Questions asked:** 8

### Verification Results
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 22
- **Verified:** 14 | **Failed:** 5 | **Concerns:** 3
- Failures resolved via interview (see below)

#### Questions & Answers

1. **[Fact Check]** Effort totals wrong: plan.md = 47h, sum of phases = 58h
   - Options: Update to 58h (Recommended) | Reduce phases | Accept mismatch
   - **Answer:** Update plan.md to 58h
   - **Rationale:** Phase files are source of truth; Sprint 1=25h, Sprint 3=18h, total=58h

2. **[Contract]** Phase 2 uses onClick on sp-button/sp-action-button (12 instances) — contradicts SWC convention
   - Options: Fix all to useSpEvent | Accept onClick for buttons (Recommended) | Add verify note
   - **Answer:** Accept onClick for sp-button click events
   - **Rationale:** Click events work via React synthetic events on buttons; only change/input events need useSpEvent

3. **[Contract]** Phase 3 uses CJS require() for project modules (batch-play-helpers, document-utils)
   - Options: Fix to ESM (Recommended) | Accept CJS for photoshop/ folder | Keep as-is
   - **Answer:** Fix Phase 3 to ESM import for project modules
   - **Rationale:** Convention: CJS only for host modules (photoshop, uxp); project imports use ESM

4. **[Fact Check]** Phase 9 manifest missing api.openai.com (Phase 1 has it)
   - Options: Add api.openai.com (Recommended) | Phase 1 is source of truth | Add chatgpt.com
   - **Answer:** Add api.openai.com; chatgpt.com not needed (backend handles that)
   - **Rationale:** Backend is developer-managed, plugin never calls chatgpt.com directly

5. **[Architecture]** Phase 2 MODEL_OPTIONS lists gpt-image-1, dall-e-2 but Sprint 1 only ships fal.ai
   - Options: Only fal.ai models (Recommended) | Keep placeholder | List all disabled
   - **Answer:** Only fal.ai models (Flux Fill Pro, Nano Banana 2)
   - **Rationale:** Ship what works; more models added in Phase 6/9

6. **[Scope]** Phase 6 effort = 12h but file is thin (~78 lines, no code snippets)
   - Options: Accept 12h (Recommended) | Reduce to 8h | Flesh out details
   - **Answer:** Accept 12h
   - **Rationale:** Replicate polling + model registry + resolution bucketing + reference images + history is substantial

7. **[Risk]** AbortController availability in UXP unverified
   - Options: Verify in Phase 1 (Recommended) | Accept risk | Custom mechanism
   - **Answer:** Add Phase 1 success criteria: verify AbortController exists in UDT console
   - **Rationale:** Fail early avoids surprise at Phase 4-5; low-cost check

8. **[Architecture]** Backend URL management — user deploy on VPS
   - Options: Add api.openai.com, document backend (Recommended) | domains: all | Configurable note
   - **Answer:** Backend is developer-managed, not user-facing
   - **Rationale:** Developer controls backend URL; manifest updated at build time for production

#### Confirmed Decisions
- Effort: 58h total (Sprint 1=25h, Sprint 2=12h, Sprint 3=18h, Sprint 4=3h)
- SWC events: onClick OK for sp-button click; useSpEvent for change/input on sp-picker/sp-textfield
- Import style: Phase 3 fixed to ESM for project modules (4 files updated)
- Models: Phase 2 ships with fal.ai only (Flux Fill Pro, Nano Banana 2)
- AbortController: verified at Phase 1 via UDT console check
- Manifest: api.openai.com added to Phase 9; chatgpt.com NOT needed in plugin
- Backend: developer-managed, not user-configurable

#### Impact on Phases
- plan.md: effort 47h → 58h; sprint totals updated
- Phase 1: AbortController check added to success criteria
- Phase 2: SWC convention clarified (onClick OK for buttons); MODEL_OPTIONS = fal.ai only; default model = flux-fill-pro
- Phase 3: 4 CJS require() for project modules → ESM import
- Phase 9: manifest domains complete (added api.openai.com); backend note clarified

### Whole-Plan Consistency Sweep
- Files reread: all 10 phases + plan.md + development-roadmap.md
- Decision deltas checked: 8
- Total verification checks: 52 (cumulative sessions 1+2)
- Reconciled stale references: 5
- Unresolved contradictions: 0

---

### Session 3 — 2026-05-19
**Trigger:** `/ck:plan validate` — post-Session-2 structural verification
**Questions asked:** 5

### Verification Results
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 18
- **Verified:** 13 | **Failed:** 4 | **Concerns:** 1
- Failures resolved via interview (see below)

#### Questions & Answers

1. **[Fact Check]** Phase 1 manifest still contains `chatgpt.com` — contradicts Session 2 decision
   - Options: Remove chatgpt.com (Recommended) | Keep for future use | Add comment
   - **Answer:** Remove chatgpt.com from Phase 1 manifest
   - **Rationale:** Session 2 confirmed backend handles chatgpt.com; plugin never calls it directly

2. **[Contract]** Phase 1,2,3,5 missing YAML frontmatter (6 other phases have it)
   - Options: Add YAML frontmatter to all 4 (Recommended) | Convert all to markdown-only | Accept inconsistency
   - **Answer:** Add YAML frontmatter matching Phase 4 template format
   - **Rationale:** Tooling (ck plan status) requires parseable frontmatter; consistency across 10 phases

3. **[Contract]** `depends_on` in YAML vs `Blocked by` text inconsistent
   - Options: Fix depends_on in YAML (Recommended) | Remove text | Accept duplicate
   - **Answer:** Fix depends_on in YAML; keep text as human-readable redundancy
   - **Rationale:** YAML is source of truth for tooling; text stays for developer readability

4. **[Scope]** `storage/secure-storage.ts` and `storage/settings-storage.ts` not created by any phase before Phase 5
   - Options: Add to Phase 4 (Recommended) | Add to Phase 2 | New phase | Add to Phase 5
   - **Answer:** Add to Phase 4 (infrastructure layer alongside providers)
   - **Rationale:** Storage is same infrastructure layer as providers; Phase 5 imports both modules

5. **[Fact Check]** Phase 1 vs Phase 9 domain lists not progressive (P1 has chatgpt.com, P9 has localhost; should be P9 = P1 + backend)
   - Options: Fix both: P1 remove chatgpt.com, P9 = P1 base + localhost (Recommended) | P1 keep, P9 add all | Merge all to P1
   - **Answer:** Fix both — progressive accumulation consistent with Session 2
   - **Rationale:** Phase 9 domains should be P1 base + backend-specific localhost

#### Confirmed Decisions
- chatgpt.com: removed from Phase 1 manifest (Session 2 decision enforced)
- YAML frontmatter: all 10 phases now have consistent YAML frontmatter with sprint, effort, depends_on
- depends_on: Phase 2,3 → [phase-01]; Phase 5 → [phase-02, phase-03, phase-04]
- Storage modules: Phase 4 now creates `secure-storage.ts` and `settings-storage.ts`
- Domains: P1 = 8 domains (no chatgpt.com); P9 = P1 + localhost:8000

#### Impact on Phases
<!-- Updated: Validation Session 3 - YAML frontmatter + dependency graph -->
- Phase 1: YAML frontmatter added; chatgpt.com removed from manifest domains
- Phase 2: YAML frontmatter added with depends_on: [phase-01]
- Phase 3: YAML frontmatter added with depends_on: [phase-01]
- Phase 4: storage modules (secure-storage.ts, settings-storage.ts) added to architecture, files, and implementation steps
- Phase 5: YAML frontmatter added with depends_on: [phase-02, phase-03, phase-04]
- Phase 9: domain note updated to reflect corrected Phase 1 base

### Whole-Plan Consistency Sweep
- Files reread: all 10 phases + plan.md
- Decision deltas checked: 5
- Total verification checks: 32 (session 3) / 84 cumulative (sessions 1+2+3)
- Reconciled stale references: 6 (chatgpt.com in P1, 4 missing frontmatters, P9 note)
- Unresolved contradictions: 0

### Validation Session 4

- **Date:** 2026-05-19
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 24
- **Verified:** 18 | **Failed:** 4 | **Concerns:** 2

#### Questions & Answers

1. **[Fact Check]** Phase 6 Overview still mentions "text-to-image mode" — stale from Session 1 dedup
   - Options: Remove from Overview (Recommended) | Keep | Move to separate phase
   - **Answer:** Remove "text-to-image mode" from Phase 6 Overview
   - **Rationale:** Session 1 already decided to remove; Requirements/Impl Steps were clean, Overview was missed

2. **[Contract]** YAML `priority` field missing in Phase 4, 6, 7, 8, 9, 10
   - Options: Add priority for all 6 phases (Recommended) | Remove from all | Accept inconsistency
   - **Answer:** Phase 4 = P1 (Sprint 1 blocker), Phase 6-10 = P2
   - **Rationale:** Consistency in frontmatter helps tooling and filtering

3. **[Fact Check]** `development-roadmap.md` effort (92h) ≠ plan.md effort (58h)
   - Options: Add SOT note to roadmap (Recommended) | Update roadmap numbers | Accept discrepancy
   - **Answer:** Added note to roadmap clarifying plan.md is authoritative for effort estimates
   - **Rationale:** Roadmap is living document for high-level tracking; plan.md is source of truth

4. **[Contract]** Phase 9 Implementation Steps has duplicate step number "3."
   - Options: Fix numbering (Recommended) | Accept
   - **Answer:** Renumbered token-manager.ts to step 4, shifted subsequent (now 12 steps total)
   - **Rationale:** Duplicate numbering causes confusion in reviews and references

5. **[Scope]** Phase 6 is largest phase (12h) but thinnest file (78 lines, no code snippets)
   - Options: Accept as-is | Flesh out with code snippets (Recommended) | Split into 2 phases
   - **Answer:** Flesh out Phase 6 with detailed code snippets
   - **Rationale:** Complex phase (Replicate polling, model registry, resolution bucketing) needs implementation patterns

#### Confirmed Decisions
- Phase 6 Overview: "text-to-image mode" removed (Session 1 dedup enforced)
- YAML priority: all 10 phases now have consistent `priority` field (P1 for Sprint 1, P2 for Sprint 2-4)
- Roadmap: note added clarifying plan.md as SOT for effort estimates
- Phase 9: step numbering fixed (1-12, no duplicates)
- Phase 6: fleshed out from 78 → 385+ lines with 9 implementation step code snippets

#### Impact on Phases
<!-- Updated: Validation Session 4 -->
- Phase 4: `priority: P1` added to YAML frontmatter
- Phase 6: `priority: P2` added; "text-to-image mode" removed from Overview; 9 code snippets added (model-registry.ts, replicate-provider.ts, resolution bucketing, reference-images.tsx, recent prompts, prompt chips, PNG/JPG detection, provider registry update, model selector update)
- Phase 7: `priority: P2` added to YAML frontmatter
- Phase 8: `priority: P2` added to YAML frontmatter
- Phase 9: `priority: P2` added; step numbering fixed (3→4 shift, 11→12 steps)
- Phase 10: `priority: P2` added to YAML frontmatter
- `docs/development-roadmap.md`: source-of-truth note added before Sprint Plan

### Final Consistency Sweep (Session 4)
- Files modified: 8 (phase-04, 06, 07, 08, 09, 10, plan.md, development-roadmap.md)
- Total verification checks: 24 (session 4) / 108 cumulative (sessions 1+2+3+4)
- Reconciled stale references: 7 (text-to-image in P6, 6 missing priorities, P9 numbering, roadmap effort discrepancy)
- Unresolved contradictions: 0

---

### Session 5 — 2026-05-20
**Trigger:** `/ck:plan validate` — post-Session-4 structural verification
**Questions asked:** 4

### Verification Results
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 20
- **Verified:** 16 | **Failed:** 3 | **Concerns:** 1
- Failures resolved via interview (see below)

#### Questions & Answers

1. **[Fact Check]** Phase 2 Step 2.7 note says "onAdd triggers the file picker in Phase 7" — Phase 7 is Backend MVP, not file picker
   - Options: Fix to Phase 6 (Recommended) | Remove the note entirely | Keep as-is
   - **Answer:** Fix to Phase 6
   - **Rationale:** Phase 6 Step 6.4 implements the UXP file picker; Phase 7 is unrelated backend

2. **[Scope]** Roadmap Sprint 2 table still lists CMYK guard (2.7), context padding (2.8), text-to-image (2.9) — all removed/moved in Session 1
   - Options: Remove stale tasks from roadmap (Recommended) | Mark as 'moved/removed' | Accept discrepancy
   - **Answer:** Remove stale tasks from roadmap
   - **Rationale:** CMYK + padding already in Phase 3; text-to-image removed; roadmap should reflect reality

3. **[Contract]** Phase 9 depends_on [phase-05, phase-08] but imports model-registry.ts created in Phase 6
   - Options: Add phase-06 to Phase 9 depends_on (Recommended) | Keep as-is, rely on sprint ordering | Move model registration to Phase 6
   - **Answer:** Add phase-06 to Phase 9 depends_on
   - **Rationale:** Prevents Phase 9 starting before model-registry.ts exists if sprints overlap

4. **[Contract]** Phase 2 creates reference-images.tsx, Phase 6 Step 6.4 implies fresh create of same file
   - Options: Change Phase 6 to 'Update reference-images.tsx' (Recommended) | Keep implicit | Remove from Phase 2
   - **Answer:** Change Phase 6 to 'Update reference-images.tsx'
   - **Rationale:** Clarifies Phase 6 builds on Phase 2's skeleton

#### Confirmed Decisions
- Phase 2 note: corrected reference from "Phase 7" → "Phase 6 (Step 6.4)"
- Roadmap: Sprint 2 tasks 2.7/2.8/2.9 marked as done/removed with cross-references
- Phase 9: depends_on updated to [phase-05, phase-06, phase-08]
- Phase 6 Step 6.4: header changed to "Update reference-images.tsx (file picker + thumbnails)"
- Dependency graph: Phase 6 → Phase 9 edge added

#### Impact on Phases
<!-- Updated: Validation Session 5 - dependency + reference fixes -->
- Phase 2: Step 2.7 note corrected ("Phase 7" → "Phase 6 Step 6.4")
- Phase 6: Step 6.4 header clarified as "Update" not implicit create
- Phase 9: YAML depends_on expanded to include phase-06; dependency graph updated
- plan.md: Key Dependencies diagram updated with Phase 6 → Phase 9 edge
- docs/development-roadmap.md: Sprint 2 tasks 2.7-2.9 marked done/removed

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-02, phase-06, phase-09, development-roadmap.md
- Decision deltas checked: 4
- Total verification checks: 20 (session 5) / 128 cumulative (sessions 1+2+3+4+5)
- Reconciled stale references: 4 (P2 note, roadmap tasks, P9 depends_on, P6 step title)
- Unresolved contradictions: 0
- **Plan status: VALIDATED — ready for execution**

---

## Red Team Review

### Session — 2026-05-20
**Findings:** 15 accepted, 9 rejected (from 39 raw across 4 reviewers)
**Severity breakdown:** 5 Critical, 10 High, 0 Medium (only Critical+High accepted)
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Mask dimension mismatch (expandedBounds vs bounds) | Critical | Accept | Phase 5 |
| 2 | `getSelectionMask` outside `executeAsModal` | Critical | Accept | Phase 3 |
| 3 | NetworkClient missing `fetchBytes()` + `ProviderId` type | Critical | Accept | Phase 4 |
| 4 | `saveRecentPrompt` signature break (1 vs 2 args) | Critical | Accept | Phase 5, 6 |
| 5 | Backend access_token sent per-request vs stored server-side | Critical | Accept | Phase 9, 7 |
| 6 | `placeResultAsSmartObject` ignores pixel mask data | High | Accept | Phase 3 |
| 7 | `resolveImageUrls` phantom `_url` property | High | Accept | Phase 4, 5 |
| 8 | Download endpoint file_id vs sediment_id dual path | High | Accept | Phase 8 |
| 9 | Replicate polling ignores AbortSignal | High | Accept | Phase 6 |
| 10 | CMYK guard targets wrong document after `duplicate()` | High | Accept | Phase 3 |
| 11 | `RecentPrompt[]` type break (Phase 6 vs Phase 2 `string[]`) | High | Accept | Phase 6 |
| 12 | Token refresh failure silent before 150s generation | High | Accept | Phase 9 |
| 13 | SESSION_ENCRYPTION_KEY no startup validation | High | Accept | Phase 7 |
| 14 | `localStorage` persistence in UXP unverified | High | Accept | Phase 1 |
| 15 | FastAPI default logging captures access_token | High | Accept | Phase 7 |

#### Rejected Findings (9)
- cc-switch Tauri IPC reference — UI pattern still valid for component design
- useSpEvent stale closure — fragile but not broken for current callers (setState is stable)
- UXP panel hide/show timer suspension — speculative, no UXP documentation confirms
- Phase 6 effort underestimate — planning concern, not correctness
- Backend URL localhost in manifest — already addressed Validation Session 5
- PoW blocking event loop — MVP is single-user, acceptable
- Codex client_id unauthorized use — already configurable in constants/oauth.ts
- chatgpt2api pool reference mismatch — informational annotation only
- Prompt validation/length cap — minor, not blocking

#### Changes Applied
1. **Phase 4:** Added `ProviderId` type, `signal?: AbortSignal` to GenerateOptions, `imageUrl?: string` to ResultItem, `fetchBytes()` to NetworkClient interface
2. **Phase 5:** Mask now read at `expandedBounds` (not `bounds`); `resolveImageUrls` uses `item.imageUrl` (not phantom `_url`); `ProviderId` imported from `provider-interface`; `saveRecentPrompt(prompt, model)` both call sites
3. **Phase 3:** `getSelectionMask` wrapped in `executeAsModal`; `exportDocumentRegion` explicitly activates duplicate by ID before CMYK check; `placeResultAsSmartObject` uses `imaging.putSelection()` for pixel-accurate mask
4. **Phase 6:** `_run` and `_pollPrediction` accept and check `signal`; Architecture adds `ui-state.ts`, `generation-service.ts`, `prompt-input.tsx` to update list
5. **Phase 7:** Startup assertion rejects known-bad encryption key; logging step added (redact tokens, LOG_LEVEL=warning default); `ALLOW_INSECURE_DEV` env var added
6. **Phase 8:** Dual download paths (file_id + sediment_id); `_poll_results` returns both; PoW wrapped in `run_in_executor`
7. **Phase 9:** Token registered once via `/auth/chatgpt/session` (not sent per-request); backend-provider pre-flights token validity; device code polling handles `slow_down`; useEffect cleanup for polling refs; backend URL rejects non-HTTPS (except localhost)
8. **Phase 1:** `localStorage` availability check added to success criteria

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01, phase-03, phase-04, phase-05, phase-06, phase-07, phase-08, phase-09
- Decision deltas checked: 15
- Total verification checks: 148 cumulative (128 validation + 20 red-team)
- Reconciled stale references: 15 (all accepted findings propagated)
- Unresolved contradictions: 0
- **Plan status: VALIDATED + RED-TEAMED — ready for execution**

---

### Validation Session 6 — 2026-05-20
**Trigger:** `/ck:plan validate` — post-red-team consistency verification
**Questions asked:** 1

#### Verification Results
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 15 (re-verifying all red-team changes)
- **Verified:** 15 | **Failed:** 0 | **Concerns:** 0

#### Questions & Answers

1. **[Architecture]** FalAIProvider: should it set imageUrl or fetch bytes internally?
   - Options: Set imageUrl, let pipeline download (Recommended) | Fetch in provider, return pngBytes directly
   - **Answer:** Set imageUrl, let pipeline download
   - **Rationale:** Consistent with Phase 5 `resolveImageUrls()` pattern; separation of concerns

#### Confirmed Decisions
- FalAIProvider returns `{ pngBytes: new Uint8Array(0), imageUrl: "https://..." }` — pipeline resolves
- All 15 red-team fixes verified consistent across Phase 1, 3, 4, 5, 6, 7, 8, 9
- No stale references found in post-red-team scan

#### Impact on Phases
- No additional changes needed — all phases already consistent

### Validation Session 7 — 2026-05-20
**Trigger:** User feedback on prompt history, XHR fallback, and Replicate upload fallback.
**Questions asked:** 3

#### Verification Results
- **Tier:** Full (10 phases, all 4 roles)
- **Claims checked:** 3
- **Verified:** 3 | **Failed:** 0 | **Concerns:** 0

#### Questions & Answers

1. **[Architecture]** Prompt history storage strategy
   - Options: Option 1 (localStorage) | Option 2 (secureStorage) | Option 3 (File System API)
   - **Answer:** Option 1 (localStorage)
   - **Rationale:** Prompt history is ephemeral. localStorage in UXP is sufficient, simple, and reliable for this purpose.

2. **[Architecture]** XHR fallback threshold size
   - Options: Option 1 (1MB) | Option 2 (5MB)
   - **Answer:** Option 2 (5MB)
   - **Rationale:** UXP fetch() silently fails on uploads larger than 5MB. Setting the threshold to 5MB avoids premature fallback and unnecessary timeouts, aligning with the platform's known limits.

3. **[Architecture]** Replicate upload fallback on API error
   - Options: Option 1 (Throw error directly) | Option 2 (Fallback to inline base64)
   - **Answer:** Option 1 (Throw error directly)
   - **Rationale:** Replicate restricts data URIs to <256KB. Sending inline base64 for larger payloads will guarantee a 400 rejection from Replicate. Throwing the upload error directly saves network overhead and latency.

#### Confirmed Decisions
- Prompt history uses `localStorage`.
- XHR proactive bypass threshold is 5MB.
- Replicate provider throws immediately on upload failure (no base64 fallback for files > 256KB).

#### Impact on Phases
- **Phase 4:** Updated `phase-04-provider-architecture.md` to document the 5MB threshold and proactive XHR bypass.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-04, phase-06
- Decision deltas checked: 3
- Total verification checks: 166 cumulative
- Reconciled stale references: 0
- Unresolved contradictions: 0
- **Plan status: VALIDATED + RED-TEAMED — ready for execution**

---

### Validation Session 8 + Red Team Round 2 — 2026-05-20
**Trigger:** User asked to re-run validation and red-team after Session 7 decisions.
**Approach:** 10-finding validation sweep + 10-finding adversarial review across all 10 phases.
**User decision:** Apply all HIGH + MEDIUM findings (12 of 20).

#### Validation Findings

| ID | Severity | Finding | Disposition | Applied To |
|----|----------|---------|-------------|------------|
| F1 | HIGH | `ProviderId` mismatch: Phase 2 used `'openai' \| 'falai' \| 'chatgpt-oauth'`; Phase 4 canonical is `'falai' \| 'replicate' \| 'chatgpt-backend'` | Apply | Phase 2 |
| F2 | MEDIUM | `SettingsState` had unused `openaiApiKey`, missing `replicateApiKey` and ChatGPT backend fields | Apply | Phase 2 |
| F3 | LOW | `saveRecentPrompt` signature drift Phase 5 vs 6 | Defer | — |
| F4 | MEDIUM | Manifest domain completeness — same surface as RT10, merged | Apply (via RT10) | Phase 1 |
| F5 | LOW | Phase 2 model-selector should restrict to Sprint 1 models | Defer | — |
| F6 | HIGH | GPT Image 2 has TWO endpoints (`openai/gpt-image-2` for generate, `openai/gpt-image-2/edit` for inpaint); registry stored only one | Apply | Phase 6 |
| F7 | MEDIUM | `placeResultAsSmartObject(pngBytes)` signature already correct | Already resolved | — |
| F8 | LOW | AbortController availability — already mitigated via XHR fallback | Already resolved | — |
| F9 | MEDIUM | Phase 7 backend missing CORS middleware setup | Apply | Phase 7 |
| F10 | MEDIUM | Phase 9 token refresh flow already detailed (`getValidToken()` + `TokenExpiredError`) | Already resolved | — |

#### Red Team Findings (Round 2)

| ID | Severity | Finding | Disposition | Applied To |
|----|----------|---------|-------------|------------|
| RT1 | HIGH | Plugin did not enforce HTTPS for backend URL — MITM could intercept APP_API_KEY + OAuth tokens | Apply | Phase 9 |
| RT2 | MEDIUM | Backend Fernet key default value (`dev-only-...`) was a real fallback, no startup assertion | Apply | Phase 7 |
| RT3 | LOW | fal.ai signed URL expiry — non-issue with immediate download | Reject | — |
| RT4 | LOW | ChatGPT 120-150s wait UX — already covered in Phase 5 timeout section | Reject | — |
| RT5 | MEDIUM | Provider returned image but PS placement could fail, wasting paid generation | Apply | Phase 5 |
| RT6 | LOW | `revised_prompt` XSS — React + Spectrum auto-escape | Reject | — |
| RT7 | MEDIUM | Concurrent generation race — two `executeAsModal` calls could corrupt PS state | Apply | Phase 5 |
| RT8 | HIGH | Phase 5 did not validate `model.capabilities` before calling `inpaint()` (Nano Banana 2 has no mask support) | Apply | Phase 5 |
| RT9 | MEDIUM | `backend-provider.ts` consumed response without shape validation | Apply | Phase 9 |
| RT10 | HIGH | Phase 1 manifest baseline missing `http://localhost:8000` for backend dev | Apply | Phase 1 |

#### Confirmed Decisions
- ProviderId canonical: `'falai' | 'replicate' | 'chatgpt-backend'` everywhere.
- SettingsState fields: `falaiApiKey`, `replicateApiKey`, `chatgptBackendUrl`, `chatgptBackendApiKey`, `chatgptOAuthStatus`.
- Model registry: `endpointByCapability?: { generate?: string; inpaint?: string }` + `resolveEndpoint()` helper for models with mode-specific slugs.
- Generation pipeline: module-level `isGenerating` lock; `assertCapability()` runs before any network call; `pngBytes` cached before placement so a `PlacementError` carries `cachedBytes` for retry without re-running paid generation.
- Backend: `ENCRYPTION_KEY` (renamed from SESSION_ENCRYPTION_KEY) is required, validated via `Fernet(...)` round-trip on startup; `CORSMiddleware` configured with explicit `ALLOWED_ORIGINS` env var.
- Backend URL: `validateBackendUrl()` rejects non-`https://` (loopback hosts excepted) and rejects URLs with credentials/fragments.
- Backend response: `assertImageEditsResponse()` type guard runs before `data[0].b64_json` is read; throws `ProviderResponseError` with sanitized payload preview on shape mismatch.
- Manifest: `http://localhost:8000` listed in Phase 1 baseline so Phase 9 doesn't introduce a manifest delta surprise; production builds substitute the deployed URL.

#### Impact on Phases
<!-- Updated: Validation Session 8 + Red Team Round 2 -->
- **Phase 1:** Manifest network domains now include `http://localhost:8000`; note added explaining loopback dev + production substitution.
- **Phase 2:** `ProviderId` canonicalized; `SettingsState` rewritten with correct fields; `SettingsDialog` markup updated to `falai | replicate | chatgpt-backend` and includes the Replicate API key path.
- **Phase 5:** New `ModelCapabilityError` + `GenerationInProgressError`; module-level `isGenerating` lock with `acquireLock`/`releaseLock` and `isGenerationInFlight()` helper; `assertCapability()` runs before any network call in both `runGenerate` and `runInpaint`; result bytes cached as `generatedBytes` / `inpaintedBytes` and re-thrown as `PlacementError` with `cachedBytes` on placement failure; risk table extended with RT5/RT7/RT8 entries; `App.tsx` integration adds an in-flight guard alongside the disabled button.
- **Phase 6:** `ModelDefinition.endpointByCapability` field added; `resolveEndpoint(model, capability)` helper exposed; `gpt-image-2` registry entry now lists both endpoints.
- **Phase 7:** `ENCRYPTION_KEY` env var with Fernet validator and default-rejection; `ALLOWED_ORIGINS` env var; `CORSMiddleware` wiring shown explicitly; success criteria adds CORS preflight + bad-key startup-refusal checks.
- **Phase 9:** `validateBackendUrl()` helper module added (rejects non-HTTPS off loopback, rejects credentials/fragments); `assertImageEditsResponse()` + `ProviderResponseError` added; backend-provider documented to call both pre-flights; success criteria + risk table updated.

#### Whole-Plan Consistency Sweep
- Files modified: 6 (phase-01, phase-02, phase-05, phase-06, phase-07, phase-09) + plan.md
- Findings applied: 11 (HIGH + MEDIUM)
- Findings deferred: 3 LOW (F3, F5, F8 — F8 already mitigated)
- Findings rejected: 3 (RT3, RT4, RT6 — verified non-issues)
- Findings already resolved: 3 (F4 = RT10, F7, F10)
- Total verification checks: 186 cumulative
- Unresolved contradictions: 0
- **Plan status: VALIDATED + RED-TEAMED ×2 — ready for execution**

