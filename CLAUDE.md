# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: InpaintKit (layerflow)

AI image editing UXP plugin for Adobe Photoshop. Selection → prompt → AI → Smart Object layer.
Multi-provider: fal.ai + Replicate (direct, 5-15s); GPT Image 2 via ChatGPT backend (Sprint 3, 120-150s).

Target: Photoshop 24+ on macOS/Windows. UXP manifest v5, React 18 + Spectrum Web Components 0.37.0 (pinned — UXP v8 lock), TypeScript strict mode, Vite + `@bubblydoo/vite-uxp-plugin`.

## Common Commands

```bash
npm run dev          # vite build --watch (dist/ updated on save; UDT auto-reloads)
npm run build        # production bundle to dist/
npm run typecheck    # tsc --noEmit (strict; noUnusedLocals/noUnusedParameters/noImplicitReturns)
```

No test runner is configured — verify changes via `typecheck` + `build` + UDT manual run.
Vite output goes to `dist/` (root: `src/`). Load `manifest.json` from repo root in Adobe UXP Developer Tool.

## Architecture (Big Picture)

```
UI (React + SWC)  →  generation-service  →  Photoshop APIs  →  Provider  →  Place Smart Object
   App.tsx            runGenerate           export-image       falai          place-result
   MainDialog         runInpaint            selection          replicate      (layer mask if inpaint)
                                            document-utils     [chatgpt-backend]
```

Pipeline lives in **`src/services/generation-service.ts`**. Two entry points:

- `runGenerate(opts)` — text-to-image. Sources doc dimensions, no selection.
- `runInpaint(opts)` — selection-based edit. Reads selection bounds, expands for context, exports cropped PNG, reads mask, places result with pixel-accurate layer mask.

Both:
1. `acquireLock()` — module-level `isGenerating` flag prevents concurrent `executeAsModal` collisions.
2. `assertCapability(model, 'generate' | 'inpaint')` — throws `ModelCapabilityError` if model registry says no.
3. Resolve provider + endpoint from registries; pass `signal` and `referenceImages` through.
4. Cache result `pngBytes` BEFORE placement; on placement failure throw `PlacementError(cachedBytes)` so UI can retry without re-running paid generation.
5. `saveRecentPrompt(prompt, model)` only on success.

### Provider Layer

`src/providers/`:
- **`provider-interface.ts`** — `Provider`, `GenerateOptions`, `InpaintOptions`, `ResultItem`, `ProviderCredentials`, `ProviderId = 'falai' | 'replicate' | 'chatgpt-backend'`. Error hierarchy: `ProviderError` → `RateLimitError`, `ContentPolicyError`, `AuthError`. `CancelledError` is separate.
- **`model-registry.ts`** — single source of truth for UI-facing model IDs. Each `ModelDefinition` declares `providerId`, `capabilities[]`, `endpointByCapability` (some models like `gpt-image-2` have separate slugs for generate vs inpaint), `resolutions[]`, `defaultResolution`, `costHint`, `supportsReferenceImages`. Always go through `resolveEndpoint(modelId, capability)` — never hardcode endpoint strings.
- **`provider-registry.ts`** — `getProvider(id, credentials)` factory; throws if API key missing.
- **`falai-provider.ts`** — Flux Fill Pro, Nano Banana 2, GPT Image 2 (separate generate/edit slugs). Uses inline data URIs for source/mask.
- **`replicate-provider.ts`** — prediction create + poll pattern. Uses `Bearer` auth (not `Key` like fal.ai). Files >256KB MUST upload via `POST /v1/files` first (data URIs are rejected). Cancels server-side prediction when AbortSignal fires.

`ResultItem.imageUrl` (set by providers returning a URL) is downloaded by the pipeline via `resolveImageUrls` → `fetchBytes`. Set `pngBytes: new Uint8Array(0)` + `imageUrl: '...'` instead of fetching inside the provider.

### Network Client (`src/services/network-client.ts`)

Functional API: `request`, `checkedRequest<T>`, `fetchBytes`. NOT a class.

UXP `fetch()` silently fails on uploads >5MB → request() routes large bodies straight to XHR. Bodies <5MB use fetch with XHR fallback on error. `checkedRequest` converts non-2xx into typed `ProviderError`/`AuthError`/`RateLimitError`/`ContentPolicyError`. All requests honor `AbortSignal`.

### Photoshop Layer (`src/photoshop/`)

ALL Photoshop write operations MUST run inside `core.executeAsModal`. The helpers wrap modal scope internally — caller does not need to.

- **`document-utils.ts`** — `getDocumentInfo()`, `clampRectToDoc()`, `needsColorConversion()`.
- **`selection.ts`** — `getSelectionBounds`, `getSelectionMask` (uses `imaging.getSelection`), `expandRectForInpaintContext`. Mask is read at expandedBounds so dimensions match exported source exactly.
- **`export-image.ts`** — `exportDocumentRegion(rect)`. Duplicates the active doc, activates the duplicate by ID (race fix), converts CMYK→RGB if needed, crops, flattens, `saveAs.png()`. Returns PNG bytes. Original doc untouched.
- **`place-result.ts`** — `placeResultAsSmartObject({pngBytes, targetRect, maskData?, layerName?})`. Uses `placeEvent` batchPlay → Smart Object, `imaging.putSelection` for pixel-accurate mask, single undo step via `suspendHistory`/`resumeHistory`.
- **`batch-play-helpers.ts`** — `bpPlaceAsSmartObject`, `bpAddLayerMaskFromSelection`, `bpSelectLayer`, `bpConvertToRGB`. Use these instead of inlining batchPlay descriptors.

### Mask Convention (CRITICAL)

Internal: **alpha = 0 means "edit this pixel"**, alpha = 255 means "preserve". Provider conventions vary:

- fal.ai / Replicate: white = edit. Use `invertMaskConvention(rgbaMask)` from `image-processing.ts` before sending.
- `place-result.ts` reverses again to put the visible region in the layer mask.

### Storage

- **`storage/secure-storage.ts`** — UXP `secureStorage` for API keys. Per-provider keys: `falai`, `replicate`, `chatgptBackendUrl`, `chatgptBackendApiKey`.
- **`storage/settings-storage.ts`** — localStorage for non-secrets: `RecentPrompt[]` (max 20, dedupe by prompt+model) and `UserPreferences`. Session 7 confirmed localStorage works in UXP for ephemeral data.

### Image Processing (`src/services/image-processing.ts`)

Pure helpers, no side effects. Pattern: always return new Uint8Array (immutability).
- `bytesToBase64`, `base64ToBytes`, `bytesToDataUri`
- `invertMaskConvention(rgbaMask)` — alpha→white intensity
- `resizeMaskToMatch(mask, w, h)` — nearest-neighbour
- `selectResolutionBucket(w, h, supportedResolutions)` — picks smallest bucket covering max dim
- `detectPngOutputFormat(pngBytes)` — parses PNG IHDR color type (no decode); 0/2 → `jpg`, 4/6 → `png`, 3 → scan tRNS chunk. Falls back to `png`.

## UXP Conventions

- **Imports**: ESM for project code; CJS `require()` ONLY for host modules `photoshop`, `uxp` (Vite externalizes them). Don't mix.
- **SWC events**: `onClick` works on `sp-button` / `sp-action-button` via React synthetic events. Use `useSpEvent` (`src/hooks/use-sp-event.ts`) for `change`/`input` on `sp-picker` / `sp-textfield`.
- **Manifest network domains**: every API host must be enumerated in `manifest.json` `requiredPermissions.network.domains`. `domains: "all"` is unreliable in v5. Already registered: openai, fal.ai (multiple subdomains), replicate, replicate.delivery, localhost:8000.
- **File picker**: `storage.localFileSystem.getFileForOpening({ types: [...] })` then `file.read({ format: fs.formats.binary })`. See `main-dialog.tsx#handleAddReference`.

## Plans Directory

Implementation plans live in `plans/260519-2141-inpaintkit-uxp-plugin/`:
- `plan.md` — sprint overview, validation log, red-team findings.
- `phase-XX-*.md` — per-phase scope with YAML frontmatter (`status`, `priority`, `depends_on`).
- `reports/` — execution notes (e.g., `cook-phase-06-png-jpg-output-format-wire-up.md`).

When implementing a phase, update its frontmatter `status` to `complete` and update `plan.md` sprint status table.

## Where to Add Things

| New | Location |
|-----|----------|
| AI provider | `src/providers/<name>-provider.ts` + register in `provider-registry.ts` + add models to `model-registry.ts` |
| AI model on existing provider | `model-registry.ts` only (UI picks it up automatically via `listModels()`) |
| Photoshop interaction | `src/photoshop/<verb>-<noun>.ts`; export a single async function wrapped in `executeAsModal` |
| Pure data helper | `src/services/image-processing.ts` (mutate-free, return new buffers) |
| UI dialog | `src/components/<name>-dialog.tsx`; wire into `App.tsx` `activeDialog` switch |
| Network host | Add to `manifest.json` `requiredPermissions.network.domains` |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **layerflow** (511 symbols, 545 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/layerflow/context` | Codebase overview, check index freshness |
| `gitnexus://repo/layerflow/clusters` | All functional areas |
| `gitnexus://repo/layerflow/processes` | All execution flows |
| `gitnexus://repo/layerflow/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
