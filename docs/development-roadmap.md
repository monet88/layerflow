# InpaintKit Development Roadmap

## Product Vision

AI image editing plugin for Adobe Photoshop — inpainting, outpainting, and generation using multiple AI providers. Users bring their own API keys or ChatGPT subscription.

## Architecture

```
┌─ Photoshop UXP Plugin ──────────────────────────────────┐
│                                                          │
│  Auth:                                                   │
│    • Device Code OAuth → auth.openai.com (plugin-local)  │
│    • API keys → secureStorage (plugin-local)             │
│                                                          │
│  Direct Providers (simple REST, 5-15s):                  │
│    • fal.ai (Nano Banana 2, Flux Fill Pro)               │
│    • Replicate (Nano Banana Pro, Seedream 5 Lite)        │
│                                                          │
│  Backend Provider (heavy, 120-150s):                     │
│    POST backend:8000/v1/images/edits                     │
│    + access_token from device code OAuth                 │
│                                                          │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌─ Backend Server (Docker/VPS) ────────────────────────────┐
│  FastAPI + Uvicorn                                       │
│  ChatGPT Web reverse proxy (chatgpt2api pattern):        │
│    1. Bootstrap + PoW + Turnstile                        │
│    2. Prepare conversation + conduit token               │
│    3. Start image gen (SSE)                              │
│    4. Poll conversation for file_ids (120-150s)          │
│    5. Download attachment → return base64                 │
│  OpenAI-compatible response format                       │
└──────────────────────────────────────────────────────────┘
```

## Business Model

- One-time license fee (plugin)
- Users pay their own AI costs (API keys) OR use existing ChatGPT subscription
- No account pool, no quota sharing, no rotation

## Sprint Plan

> **Note:** This roadmap contains high-level task breakdowns with original estimates. The authoritative source for effort estimates is the implementation plan at `plans/260519-2141-inpaintkit-uxp-plugin/plan.md` (58h total). Estimates below may differ as they predate implementation planning.

### Sprint 1: Plugin + fal.ai (MVP)

**Goal**: Working end-to-end inpainting with fal.ai provider  
**Duration**: 1.5 weeks  
**Deliverable**: Plugin that reads selection, sends to fal.ai, places result as Smart Object

| Phase | Task | Est. | Status |
|-------|------|------|--------|
| 1.1 | Project scaffold (Vite + React + TS + UXP manifest) | 3h | pending |
| 1.2 | Core UI — Main dialog (model dropdown, prompt, generate button) | 4h | pending |
| 1.3 | Core UI — Settings dialog (provider selector, API key input) | 2h | pending |
| 1.4 | Core UI — Progress dialog (status text, cancel button) | 1h | pending |
| 1.5 | PS Integration — Read selection bounds + mask (imaging.getSelection) | 3h | pending |
| 1.6 | PS Integration — Export region as PNG (duplicate doc + saveAs) | 3h | pending |
| 1.7 | PS Integration — Place result as Smart Object + layer mask | 3h | pending |
| 1.8 | fal.ai provider (Flux Fill Pro inpainting, Nano Banana 2 generate) | 3h | pending |
| 1.9 | Generation pipeline — wire UI → PS → provider → PS | 4h | pending |
| 1.10 | Network client (fetch + XHR fallback) | 2h | pending |
| 1.11 | Settings storage (secureStorage for keys, localStorage for prefs) | 1h | pending |
| 1.12 | Error handling + user-friendly messages | 2h | pending |
| 1.13 | End-to-end testing in Photoshop | 2h | pending |

**Models available after Sprint 1:**
- Nano Banana 2 (fal.ai) — all-rounder, text rendering
- Flux Fill Pro (fal.ai) — best inpainting quality

---

### Sprint 2: More Models + Polish

**Goal**: Add Replicate provider, more models, UX refinements  
**Duration**: 1 week  
**Deliverable**: Multi-provider, multi-model plugin with history and resolution bucketing

| Phase | Task | Est. | Status |
|-------|------|------|--------|
| 2.1 | Replicate provider (API key, prediction polling) | 3h | pending |
| 2.2 | Add models: Nano Banana Pro, Seedream 5 Lite | 2h | pending |
| 2.3 | Auto resolution bucketing (1K/2K/4K from selection size) | 2h | pending |
| 2.4 | Reference images support (optional file upload) | 2h | pending |
| 2.5 | Recent prompts history (clickable chips, last 3) | 2h | pending |
| 2.6 | Output format: PNG when transparency, JPG otherwise | 1h | pending |
| ~~2.7~~ | ~~CMYK document guard~~ — moved to Phase 3 (Sprint 1) | — | done |
| ~~2.8~~ | ~~Context padding~~ — moved to Phase 3 (Sprint 1) | — | done |
| ~~2.9~~ | ~~Text-to-image mode~~ — removed (Session 1 dedup) | — | removed |
| 2.10 | Improved error UX + rate limit handling | 1h | pending |

**Models available after Sprint 2:**
- Nano Banana 2 (fal.ai)
- Nano Banana Pro (Replicate)
- Seedream 5 Lite (Replicate)
- Flux Fill Pro (fal.ai)

---

### Sprint 3: ChatGPT Backend + GPT Image 2

**Goal**: Add GPT Image 2 via ChatGPT subscription (backend server)  
**Duration**: 1.5 weeks  
**Deliverable**: Full ChatGPT OAuth + backend proxy + GPT Image 2 generation

| Phase | Task | Est. | Status |
|-------|------|------|--------|
| 3.1 | Backend MVP (FastAPI scaffold, health, models, Docker) | 3h | pending |
| 3.2 | Backend auth (per-user session storage, app API key) | 2h | pending |
| 3.3 | Backend /v1/images/edits endpoint (mock provider) | 2h | pending |
| 3.4 | Backend ChatGPT Web provider (port chatgpt2api logic) | 6h | pending |
| 3.5 | Backend tests (pytest, all endpoints) | 2h | pending |
| 3.6 | Plugin — Device Code OAuth flow (auth.openai.com/codex/device) | 3h | pending |
| 3.7 | Plugin — OAuth UI (user_code display, polling indicator, status) | 2h | pending |
| 3.8 | Plugin — Backend provider (POST backend/v1/images/edits, 150s timeout) | 2h | pending |
| 3.9 | Plugin — Settings update (backend URL config, ChatGPT sign-in section) | 2h | pending |
| 3.10 | Plugin — Token refresh + auto-reconnect | 2h | pending |
| 3.11 | End-to-end testing: OAuth → backend → GPT Image 2 → PS layer | 3h | pending |

**Models available after Sprint 3:**
- GPT Image 2 (ChatGPT subscription, via backend)
- All models from Sprint 1-2

---

### Sprint 4: Polish + Distribution

**Goal**: Production-ready packaging, documentation, edge cases  
**Duration**: 0.5 week  
**Deliverable**: .ccx plugin package + Docker image + README

| Phase | Task | Est. | Status |
|-------|------|------|--------|
| 4.1 | Plugin packaging (.ccx via UXP Developer Tool) | 1h | pending |
| 4.2 | Backend Docker image (production config, health checks) | 1h | pending |
| 4.3 | README — plugin install + usage | 1h | pending |
| 4.4 | README — backend setup (Docker Compose) | 1h | pending |
| 4.5 | Keyboard shortcuts (generate, cancel) | 1h | pending |
| 4.6 | Undo/redo integration cleanup | 1h | pending |
| 4.7 | Broader PS version testing (24.x, 25.x, 26.x) | 2h | pending |
| 4.8 | About dialog + version info | 0.5h | pending |

---

## Future (Post-Launch)

From InpaintKit's public roadmap + own ideas:

- Multi-mask / batch queue (select multiple areas, process sequentially)
- Project-level API key profiles for teams
- Advanced blending controls (edges, hair)
- OpenAI official API provider (gpt-image-1 via API key, no backend needed)
- More models as they become available
- Hosted backend option (no Docker needed for ChatGPT path)

---

## Technical Stack

### Plugin
- UXP (Unified Extensibility Platform), manifest v5
- React 18 + Spectrum Web Components (Adobe native look)
- TypeScript
- Vite + @bubblydoo/vite-uxp-plugin
- Target: Photoshop 24.0.0+

### Backend
- Python 3.13+
- FastAPI + Uvicorn
- curl-cffi (isolated in ChatGPT provider)
- SQLite (per-user session storage)
- Docker + Docker Compose

### Providers

| Provider | Auth | Transport | Timeout | Location |
|----------|------|-----------|---------|----------|
| fal.ai | API key | Plugin direct (fetch) | 30s | Plugin |
| Replicate | API key | Plugin direct (fetch) | 60s (polling) | Plugin |
| ChatGPT Web | Codex OAuth token | Plugin → Backend | 180s | Backend |

### Key Technical Decisions

1. fetch + XHR fallback for all network calls (UXP fetch unreliable on large uploads)
2. doc.saveAs.png() on temp duplicate for image export (handles ICC, compositing)
3. imaging.getSelection() for mask extraction (feathered/lasso support)
4. Smart Object via placeEvent batchPlay (non-destructive, editable)
5. Layer mask from selection via batchPlay (auto-created on inpaint results)
6. Mask convention: internal = alpha=0 means edit; invert for fal.ai (white=edit)
7. Plugin handles device code OAuth; backend handles heavy ChatGPT API processing
8. Per-user sessions only — user's own token, no account pool

---

## Reference Implementations

- `wuji419-bit/OpenAI-PS` — closest UXP inpaint plugin (OpenAI + ComfyUI)
- `AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin` — most mature PS AI plugin
- `basketikun/chatgpt2api` — ChatGPT Web reverse proxy reference
- `bubblydoo/uxp-toolkit` — Vite + React + TS UXP build tooling
- `cc-switch` — Device code OAuth UI pattern reference

## Success Metrics

- End-to-end inpainting works in <15s (fal.ai path)
- End-to-end GPT Image 2 works in <180s (ChatGPT path)
- Non-destructive output (Smart Object + mask, every time)
- No hardcoded secrets
- Plugin <500KB bundled
- Backend Docker image <200MB
