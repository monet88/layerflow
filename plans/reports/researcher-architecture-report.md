# Architecture Research Report: AI Image Generation Photoshop UXP Plugin

**Date:** 2026-05-19  
**Scope:** Open-source UXP plugin architecture, patterns, boilerplates, technical challenges

---

## 1. Existing Open-Source UXP Plugins Inventory

### Primary Reference: `wuji419-bit/OpenAI-PS` (1 star, updated 2026-05-15)
- **Most architecturally relevant.** OpenAI image generation, edits, inpainting, outpainting in pure JS.
- Vanilla JS single-file (`src/app.js`, ~3000 lines). No framework.
- Supports OpenAI gpt-image-2 + ComfyUI backend via `backendTypeEnum` dispatch.
- Full inpaint pipeline: selection → context crop → mask generation via `imaging.getSelection` → resize → API → composite back.
- Key patterns extracted and documented below.

### Primary Reference: `AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin` (7,250 stars, active 2026-05-19)
- **Most mature ecosystem.** Supports Automatic1111 + ComfyUI backends.
- Multi-file vanilla JS. `psapi.js` (1,369 lines) is PS API abstraction layer, `index.js` (1,823 lines) is main logic.
- Has `backendTypeEnum = { Auto1111, HordeNative, Auto1111HordeExtension }` — explicit enum-based provider dispatch.
- Uses Jimp for in-browser image processing.
- Extensive layer manipulation: snapshot, group, clipping mask, selection-to-mask, layerToSelection.
- Ships Python server as sidecar via WebSocket.

### Other Notable Repos
| Repo | Stars | Notes |
|------|-------|-------|
| `eamonnmohieldean/lier` | 0 | Imagen 3 AI inpainting, JS |
| `tinyainkhant/gemini-fill` | 0 | Gemini image gen, JS |
| `zazikant/Photoshop-uxp-plugin-` | 2 | Gemini + GIMP, JS |
| `XIAOTsune/PixelRunner` | 24 | RunningHub AI workflows, JS |
| `TheWhykiki/photoshop-comfyui-mcp-bridge` | 4 | ComfyUI + MCP bridge, TS |

**InpaintKit / InpaintXGI**: No public source found on GitHub. Likely closed-source commercial product.

---

## 2. Architecture Patterns

### 2.1 Multi-Provider Strategy Pattern

Auto-PS-SD and OpenAI-PS both use an explicit backend enum + dispatch approach:

```js
// Provider registry pattern (from Auto-PS-SD)
const backendTypeEnum = {
  Auto1111: 'auto1111',
  HordeNative: 'horde_native',
  Auto1111HordeExtension: 'auto1111_horde_extension',
}

// OpenAI-PS approach: model-name-based routing
function isComfyModel(model) { return Object.hasOwn(COMFY_WORKFLOWS, model); }
// dispatch: if (isComfyModel(model)) → requestSingleComfyEdit() else → requestSingleEdit()
```

**Recommended pattern for InpaintKit:** Strategy object keyed by provider ID, each implementing `{ generate, edit, inpaint, outpaint }`. Use a factory function rather than class inheritance (simpler, KISS).

### 2.2 Async API Calls with Progress UI

Both plugins use a `setBusy(true)` + manual `setProgress(n, visible)` pattern. No reactive state management (no React state/Zustand). Increment progress at named checkpoints:

```js
setBusy(true);
setProgress(8, true);
// ... export selection
setProgress(34, true);
// ... call API
setProgress(84, true);
// ... composite result
setProgress(100, true);
setBusy(false);
setTimeout(() => setProgress(0, false), 700);
```

For long-running ComfyUI jobs, OpenAI-PS polls `waitForComfyOutput()` with exponential backoff against `/history/{promptId}` endpoint.

**Key insight:** UXP's `fetch()` has known reliability issues. OpenAI-PS falls back to `XMLHttpRequest` via `sendXhrRequest()` with a 180s timeout when `fetch` fails (and auto-retries). This is a critical production concern.

### 2.3 Pixel Data Export: Document → base64 PNG

**Method 1 (preferred, OpenAI-PS):** Use `document.saveAs.png()` to temp file, read binary, convert to base64.

```js
// Inside executeAsModal:
const file = await folder.createFile("region.png", { overwrite: true });
await duplicateDoc.saveAs.png(file, null, true); // true = flatten to composite
const buffer = await file.read({ format: storage.formats.binary });
return arrayBufferToBase64(buffer);
```

For region export: duplicate doc → crop to rect → optional resizeImage → saveAs.png → read binary.

**Method 2 (Auto-PS-SD):** Export via `document.saveAs.png()` on a temp duplicate, using `readPng()` helper.

**Method 3 (not recommended):** `imaging.getPixels()` — direct pixel access but unwieldy for full document export. Used only for selection mask reading in OpenAI-PS.

### 2.4 Selection → Mask Generation

Two paths, both used in OpenAI-PS:

**Path A: `imaging.getSelection()` API (preferred when selection is complex/feathered)**

```js
const selectionImage = await imaging.getSelection({
  documentID: app.activeDocument._id,
  sourceBounds: { left, top, right, bottom },
});
const pixels = await selectionImage.imageData.getData({ chunky: true });
// pixels[i] = selection density (0=unselected, 255=fully selected)
// Invert for OpenAI mask convention: alpha=0 means "paint here"
rgba[offset + 3] = 255 - selected;
selectionImage.imageData.dispose(); // ALWAYS dispose
```

**Path B: Rectangular bounding box mask (fallback)**

```js
// White RGBA bitmap; zero out the selection bounding box (transparent = inpaint zone)
for (let y = top; y < bottom; y++) {
  for (let x = left; x < right; x++) {
    rgba[(y * width + x) * 4 + 3] = 0; // transparent = inpaint here
  }
}
```

**Context padding:** OpenAI-PS adds 18% horizontal + 25% vertical padding around selection for better inpaint blending (`expandRectForInpaintContext`).

### 2.5 Smart Object / Layer Placement via `placeEvent`

Both plugins place result images as Smart Object layers using `batchPlay` with `placeEvent`:

```js
// Requires a session token, not a raw path
const token = await fs.createSessionToken(file);
await action.batchPlay([{
  _obj: "placeEvent",
  null: { _path: token, _kind: "local" },
  freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
  offset: { _obj: "offset",
    horizontal: { _unit: "pixelsUnit", _value: 0 },
    vertical: { _unit: "pixelsUnit", _value: 0 }
  },
  _isCommand: true,
  _options: { dialogOptions: "dontDisplay" },
}], { synchronousExecution: true, modalBehavior: "execute" });
```

After placement, transform to selection bounds via separate `transform` batchPlay call with pixel offset + percent scale. Apply layer mask via `make channel mask revealSelection` batchPlay.

### 2.6 Layer Mask from Selection

```js
// Inside executeAsModal, after selecting the layer:
await action.batchPlay([
  { _obj: "select", _target: [{ _id: layer.id, _ref: "layer" }], makeVisible: false },
  // Set rectangular selection:
  { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }],
    to: { _obj: "rectangle", top: {_unit:"pixelsUnit",_value:rect.top}, ... } },
  // Create mask from selection:
  { _obj: "make", new: { _class: "channel" },
    at: { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealSelection" },
  },
], { synchronousExecution: true, modalBehavior: "execute" });
```

---

## 3. UXP Plugin Boilerplates

### Official Adobe (`AdobeDocs/uxp-photoshop-plugin-samples`, 334 stars)
Available starters:
- `swc-uxp-react-starter` — React 18 + webpack 5 + SWC/Spectrum Web Components
- `ui-react-starter` — React + webpack (simpler)
- `typescript-webpack-sample` — TypeScript + webpack
- `tailwind-sample` — Tailwind CSS integration
- `ui-svelte-starter`, `ui-vue-3-starter`

**manifest.json minimum fields:** `name`, `id`, `version`, `main`, `manifestVersion` (5 or 6), `host[].app: "PS"`, `host[].minVersion`, `entrypoints[]`.

### Community: `bubblydoo/uxp-toolkit` (9 stars, updated 2026-05-18)
**Best modern TypeScript setup.** Monorepo with:
- `@bubblydoo/vite-uxp-plugin` — Vite plugin that handles CJS output, externalizes UXP modules, HMR via WebSocket in dev mode
- `@bubblydoo/uxp-toolkit-react` — React Query hooks for PS events (`useActiveDocument`, `useOnDocumentEdited`, etc.)
- `@bubblydoo/uxp-toolkit` — core utilities
- Example with React 18 + Vite + Tailwind + TypeScript

**Build workflow:**
- Dev/watch: `vite build --watch --mode development`
- Production: `vite build`
- Note: `vite serve` / HMR not supported (UXP doesn't support ES modules)

**vite.config.ts:**
```ts
import { uxp } from '@bubblydoo/vite-uxp-plugin';
export default defineConfig({
  plugins: [react(), tsconfigPaths(), uxp(manifest)],
  build: { sourcemap: true, minify: false },
});
```

**Recommendation: Use `bubblydoo/uxp-toolkit` for InpaintKit.** It's the only setup offering Vite + React + TypeScript + proper UXP externalization in a maintained package as of 2026.

---

## 4. Similar Products Feature Reference

### Auto-Photoshop-StableDiffusion-Plugin (7,250 stars)
- Modes: txt2img, img2img, inpaint, outpaint, upscale
- Backends: Automatic1111, ComfyUI (via manager extension), Horde
- ComfyUI integration: loads workflow JSON files, uploads images via `/upload/image`, queues via `/prompt`, polls `/history/{id}`
- Has i18n (multiple languages)
- Settings: stored via `batchPlay` fileInfo caption/keywords (document metadata hack)
- Separate Python sidecar server (deprecated pattern)

### OpenAI-PS
- Modes: generate (txt2img), reference (img2img), inpaint (selection repaint), outpaint (canvas expand), cutout (background removal)
- Backends: OpenAI API, local OpenAI-compatible server, ComfyUI
- Multi-provider: model name routes to provider (gpt-image-2 → OpenAI, comfy:* → ComfyUI)
- Smart mask locking: after API returns, composites result with original using mask (non-selected pixels preserved from original)
- History: saved to plugin local storage as base64 PNG thumbnails
- Settings: `uxp.storage.secureStorage` + localStorage

### Alpaca
- Commercial product, no public source. Differentiators: tight PS integration, generative fill-like UX, multiple cloud AI backends.

---

## 5. Technical Challenges & Solutions

### 5.1 Image Size Constraints

**OpenAI gpt-image-1 (legacy):** Fixed sizes only: `1024x1024`, `1024x1536`, `1536x1024`. Uses aspect-ratio detection to pick nearest.

**OpenAI gpt-image-2:** Flexible sizes. Constraints:
- Min: 655,360 pixels (~512×512 equivalent area)
- Max: 8,294,400 pixels (~3840×2160)
- Max edge: 3,840px
- Max aspect ratio: 3:1
- Must be multiple of 16

**Upload size limits (OpenAI-PS findings):**
- Warns at 40MB for single image
- Hard check at 75MB for image+mask combined

**ComfyUI inpaint:** Max 1,600×1,600px (2,560,000 pixels), max edge 1,600px.

**Recommendation:** Implement `normalizeFlexibleImageSize(w, h, rules)` as a pure utility. Rules object per provider. Always downscale before upload, never upscale.

### 5.2 Color Space Conversions (CMYK)

**Neither major open-source plugin handles CMYK.** Both create new documents in `RGBColorMode` and assume RGB input. Auto-PS-SD uses Jimp for in-browser pixel manipulation (RGB only).

**Production concern:** If user's document is CMYK, `saveAs.png()` on a duplicated CMYK document will produce a CMYK PNG — which most APIs reject. Need to detect `app.activeDocument.mode` and convert to RGB before export:

```js
// Detect
if (app.activeDocument.mode !== "RGBColorMode") {
  // batchPlay convertDocument to RGB before export
}
```

**batchPlay conversion:**
```js
await action.batchPlay([{
  _obj: "convertMode",
  _target: [{ _ref: "document", _enum: "ordinal" }],
  to: { _class: "RGBColorMode" },
  merge: false,
  flatten: false,
}], { synchronousExecution: true });
```

None of the surveyed plugins do this; it's a gap.

### 5.3 fetch() Reliability in UXP

`fetch()` in UXP WebView can silently fail or timeout with no error on large uploads. OpenAI-PS solution: wrap all requests in `sendRequest()` which tries `fetch` first, falls back to `XMLHttpRequest` with 180s timeout. Both paths return a normalized response object. **This pattern should be adopted verbatim.**

### 5.4 `executeAsModal` Requirements

All PS document mutations must be inside `core.executeAsModal()`. Re-entry is disallowed. Pattern:
- Wrap multiple sequential operations in one `executeAsModal` call when possible
- Use `{ commandName: "descriptive name" }` for undo history

### 5.5 `imaging.getSelection()` Memory Leak

`selectionImage.imageData` must be explicitly `.dispose()`d after use. Both surveyed plugins use try/finally to guarantee disposal.

### 5.6 Selection to Mask for Non-Rectangular Selections

`imaging.getSelection()` returns per-pixel selection density (supports feathering, lasso, etc.). The fallback rectangular mask only works for marquee selections. For Lasso/Magic Wand, `imaging.getSelection` is mandatory for correct masks.

---

## 6. Trade-Off Matrix: Build Tool / Framework

| Option | DX | UXP Compatibility | Ecosystem | Adoption Risk |
|--------|----|--------------------|-----------|---------------|
| Vanilla JS + webpack (Auto-PS-SD style) | Low | Proven | Mature | Low — widely used |
| React + webpack (Adobe starter) | Medium | Proven | Mature | Low |
| React + Vite + `bubblydoo/vite-uxp-plugin` | High | Proven (maintained 2026) | Growing | Low-Medium — 9 stars but active |
| Svelte/Vue + webpack | Medium | Proven | Mature | Low |

**Recommendation:** React + Vite + `@bubblydoo/vite-uxp-plugin` + TypeScript. Fastest DX, proper TS support, active maintenance. Use `@bubblydoo/uxp-toolkit-react` hooks for PS event subscriptions.

---

## 7. Recommended Architecture for InpaintKit

```
src/
├── providers/
│   ├── types.ts              # Provider interface: generate, edit, inpaint, outpaint
│   ├── openai-provider.ts    # OpenAI gpt-image-2
│   ├── stability-provider.ts # Stability AI
│   ├── comfyui-provider.ts   # ComfyUI workflow runner
│   └── provider-registry.ts  # Factory: getProvider(id) → Provider
├── ps/
│   ├── export.ts             # Document/region → base64 PNG (executeAsModal wrapper)
│   ├── selection.ts          # getSelectionInfo, imaging.getSelection mask
│   ├── layer.ts              # placeEvent, transformLayerToRect, applyRectMaskToLayer
│   └── color-space.ts        # detectMode, convertToRGB (CMYK guard)
├── utils/
│   ├── image-size.ts         # normalizeFlexibleImageSize per provider rules
│   ├── network.ts            # fetch-with-xhr-fallback, timeout, retry
│   └── png-encode.ts         # Raw RGBA → PNG bytes (for mask generation)
├── ui/
│   ├── App.tsx
│   ├── GeneratePanel.tsx
│   ├── ProgressBar.tsx
│   └── ProviderSettings.tsx
├── index.html
└── manifest.json / uxp.config.ts
```

**Provider interface:**
```ts
interface Provider {
  id: string;
  label: string;
  sizeRules: ImageSizeRules;
  generate(prompt: string, settings: GenerateSettings): Promise<ResultItem[]>;
  edit(image: string, prompt: string, settings: EditSettings): Promise<ResultItem[]>;
  inpaint(image: string, mask: string, prompt: string, settings: InpaintSettings): Promise<ResultItem[]>;
}
```

---

## 8. Source Credibility Assessment

| Source | Type | Credibility | Weight |
|--------|------|-------------|--------|
| `wuji419-bit/OpenAI-PS` | Production plugin, recent (2026) | High — solves exact problem | Primary |
| `AbdullahAlfaraj/Auto-PS-SD` | 7k star production plugin | High — battle-tested at scale | Primary |
| `AdobeDocs/uxp-photoshop-plugin-samples` | Official Adobe samples | Authoritative for manifest/API | High |
| `bubblydoo/uxp-toolkit` | Community library, active 2026 | Good — TypeScript-first, maintained | Medium-High |
| Adobe UXP Docs (`AdobeDocs/uxp-photoshop`) | Official API docs | Authoritative | Reference |

---

## 9. Adoption Risk Summary

| Technology | Maturity | Risk |
|-----------|----------|------|
| UXP platform (PS 24.4+) | Stable, replacing CEP | Low — Adobe committed |
| `batchPlay` action descriptors | Core PS scripting API | Low — stable for 5+ years |
| `imaging.getSelection` | Newer UXP API | Medium — PS 25+ required, dispose bugs |
| `bubblydoo/vite-uxp-plugin` | 9 stars, 1 maintainer | Medium — fork risk if abandoned |
| ComfyUI WebSocket API | Defacto standard | Low — widely adopted |
| OpenAI image edit API | Production API | Low — gpt-image-2 is current |

---

## 10. Unresolved Questions

1. **InpaintKit's current tech stack** — The project directory exists at `/home/monet/dev/inpaintkit` but no source files were inspected. Architecture recommendations may need adjustment once the existing code structure is known.

2. **CMYK document handling** — No production UXP plugin surveyed handles CMYK conversion. Need to decide: guard with error, or silently convert duplicate?

3. **Manifest permissions required** — Network domains, `localFileSystem: "fullAccess"`, and `allowCodeGenerationFromStrings: true` are needed for fetch+base64. Check if `secureStorage` permission is also required for API key storage.

4. **PS version targeting** — `imaging.getSelection` requires PS 25+. If targeting PS 24.x, must fall back to rectangular masks only. The `bubblydoo` example targets `minVersion: "24.2.0"` — confirm `imaging.getSelection` availability there.

5. **Alpaca's architecture** — Closed source. No data on how they handle provider abstraction or their UX patterns. Could be a competitive reference from user screenshots/demos only.
