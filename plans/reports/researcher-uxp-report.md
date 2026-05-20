# Adobe Photoshop UXP Plugin Development — Technical Research Report

**Date:** 2026-05-19
**Researcher:** Technical Analyst
**Purpose:** InpaintKit Photoshop plugin — UXP platform evaluation and API reference

---

## Executive Summary

UXP (Unified Extensibility Platform) is the mandatory path for new Photoshop plugin development. CEP is dead for new work (no Apple Silicon native support, Chromium overhead, ExtendScript translation layer). UXP runs in-process, uses V8 JS engine, has direct DOM APIs, and supports Spectrum Web Components. For an AI inpainting plugin, the full workflow is viable: read selection bounds, extract pixels via Imaging API, send to AI backend via `fetch`, receive result, write pixels back or create new layer.

---

## 1. UXP vs CEP

| Dimension | UXP | CEP |
|---|---|---|
| Process model | In-process with Photoshop | Separate Chromium process |
| JS engine | V8 (modern ES6+) | Chromium/CEF |
| PS communication | Direct native API calls | evalScript string-passing bridge |
| Apple Silicon | Native | Rosetta workaround only |
| Startup time | Fast | Slow (Chromium init) |
| Security model | Sandboxed, manifest-declared permissions | Broad access |
| Future support | Adobe's active investment | Legacy/maintenance only |
| API surface | UXP DOM + batchPlay | ExtendScript only |

**Verdict:** UXP for all new work. No exceptions.

Sources: [CEP vs UXP analysis](https://configurator.pixelsucht.net/blog/cep-vs-uxp-photoshop-2026/), [Adobe UXP for CEP Devs](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_for_you/uxp_for_cep_devs/)

---

## 2. Plugin Folder Structure

```
my-plugin/
├── manifest.json        # Required — plugin metadata, permissions, entry points
├── index.html           # Main entry point (panel UI)
├── index.js             # JS entry (if panel-less command plugin)
├── assets/
│   └── icon.png
└── src/
    ├── app.jsx          # React root component (if using React)
    ├── photoshop.js     # PS API wrapper
    └── api.js           # Network calls to AI backend
```

For a React-based plugin with a build step:

```
my-plugin/
├── manifest.json
├── public/
│   └── index.html
├── src/
│   ├── index.jsx
│   └── components/
└── dist/               # Build output — what UDT loads
    ├── index.html
    └── index.js
```

---

## 3. manifest.json (v5 — Current Standard)

Manifest v5 requires Photoshop >= 23.3.0. As of 2025, target v5.

```json
{
  "manifestVersion": 5,
  "id": "com.yourcompany.inpaintkit",
  "name": "InpaintKit",
  "version": "1.0.0",
  "main": "index.html",
  "icons": [
    { "width": 23, "height": 23, "path": "assets/icon.png", "scale": [1, 2], "theme": ["dark", "light"] }
  ],
  "host": {
    "app": "PS",
    "minVersion": "24.0.0"
  },
  "entryPoints": [
    {
      "type": "panel",
      "id": "inpaintkitPanel",
      "label": { "default": "InpaintKit" },
      "minimumSize": { "width": 300, "height": 400 },
      "maximumSize": { "width": 800, "height": 1200 },
      "preferredDockedSize": { "width": 350, "height": 600 },
      "icons": [
        { "width": 23, "height": 23, "path": "assets/panel-icon.png", "scale": [1, 2] }
      ]
    }
  ],
  "requiredPermissions": {
    "network": {
      "domains": [
        "https://api.yourbackend.com",
        "https://api.openai.com",
        "http://localhost"
      ]
    },
    "localFileSystem": "request",
    "clipboard": "readAndWrite",
    "launchProcess": {
      "schemes": ["https", "http"]
    }
  }
}
```

Key notes:
- `id` must be registered on Adobe Developer Console for marketplace distribution
- `localFileSystem: "request"` allows file picker dialogs; use `"fullAccess"` sparingly
- HTTP only works on Windows, not macOS — use HTTPS for cross-platform network calls
- `launchProcess.schemes` needed for `shell.openExternal()` (OAuth flows)
- Wildcard top-level domains NOT supported in UXP 7.4+

---

## 4. Photoshop UXP APIs — Critical Methods

### 4.1 Document Access

```js
const { app } = require("photoshop");

const doc = app.activeDocument;
const width = doc.width;           // pixels
const height = doc.height;         // pixels
const resolution = doc.resolution; // DPI
const colorMode = doc.mode;        // e.g., "RGBColorMode"
const layers = doc.layers;         // Layers collection
```

### 4.2 Selection — Getting Active Selection

```js
const { app } = require("photoshop");

const doc = app.activeDocument;
const sel = doc.selection;
const bounds = sel.bounds;
// bounds = { left: 100, top: 50, right: 400, bottom: 350 } or null if no selection

if (!bounds) {
  // no active selection — warn user
  return;
}
// bounds are in document pixels
const w = bounds.right - bounds.left;
const h = bounds.bottom - bounds.top;
```

### 4.3 Reading Pixel Data (Imaging API)

```js
const { core, imaging } = require("photoshop");

await core.executeAsModal(async (executionContext) => {
  const doc = app.activeDocument;
  const activeLayer = doc.activeLayers[0];

  // Get pixels from layer (or from selection area)
  const pixels = await imaging.getPixels({
    documentID: doc.id,
    layerID: activeLayer.id,
    // targetSize constrains output — use selection bounds for efficiency
    targetSize: {
      width: selectionWidth,
      height: selectionHeight
    },
    // applyAlpha: true to include alpha channel
    applyAlpha: false,
    // colorProfile: match document's profile for efficiency
    colorProfile: "sRGB IEC61966-2.1"
  });

  // pixels.imageData is a PhotoshopImageData object
  // pixels.imageData.data is Uint8Array (RGBA: 4 bytes per pixel)
  const imageData = pixels.imageData;
  const pixelArray = imageData.data; // Uint8Array, length = w * h * 4

  // IMPORTANT: Always dispose when done to free memory
  imageData.dispose();
}, { commandName: "Read Pixels" });
```

### 4.4 Writing Pixel Data Back

```js
await core.executeAsModal(async (executionContext) => {
  const doc = app.activeDocument;

  // Create new pixel layer for result
  const newLayer = await doc.createLayer({ name: "InpaintKit Result" });

  await imaging.putPixels({
    documentID: doc.id,
    layerID: newLayer.id,
    // offset positions the pixel data within the layer
    offset: { horizontal: bounds.left, vertical: bounds.top },
    pixels: {
      width: resultWidth,
      height: resultHeight,
      // components: 3 for RGB, 4 for RGBA
      components: 4,
      // chunky = interleaved RGBA RGBA... (vs planar: RRR... GGG... BBB...)
      chunky: true,
      colorProfile: "sRGB IEC61966-2.1",
      colorSpace: "RGB",
      data: resultUint8Array
    }
  });
}, { commandName: "Write AI Result" });
```

### 4.5 Getting Selection as Pixel Mask (for sending to AI)

For inpainting, you need the selection as a grayscale mask. Use batchPlay to export selection as channel, or use Imaging API on the selection channel:

```js
await core.executeAsModal(async () => {
  // Method 1: use batchPlay to save selection to channel, then read it
  // Method 2: use selection bounds + create a temporary layer, fill selection white
  await require("photoshop").action.batchPlay([
    {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _obj: "channel", _enum: "channel", _value: "mask" }
    }
  ], { synchronousExecution: false });
}, { commandName: "Export Selection as Mask" });
```

Simpler approach for rectangular selections: just use `selection.bounds` to define the crop region; send the masked area as an RGBA image where the alpha encodes the mask.

### 4.6 Creating Layers

```js
await core.executeAsModal(async () => {
  const doc = app.activeDocument;

  // Create regular pixel layer
  const pixelLayer = await doc.createLayer({
    name: "AI Inpaint",
    opacity: 100,
    blendMode: "normal"
  });

  // Create group layer
  const group = await doc.createLayerGroup({
    name: "InpaintKit Group"
  });
}, { commandName: "Create Layers" });
```

### 4.7 Smart Objects (via batchPlay)

Direct Smart Object creation is not fully exposed in UXP DOM v2; use batchPlay:

```js
await core.executeAsModal(async () => {
  await require("photoshop").action.batchPlay([
    {
      _obj: "newPlacedLayer"
    }
  ], {});
}, { commandName: "Create Smart Object" });
```

For placing an image file as Smart Object:

```js
await core.executeAsModal(async () => {
  await require("photoshop").action.batchPlay([
    {
      _obj: "placeEvent",
      null: { _path: "/path/to/image.png", _kind: "local" },
      linked: false
    }
  ], {});
}, { commandName: "Place as Smart Object" });
```

### 4.8 Layer Masks

Applying a mask from a selection (batchPlay required):

```js
await core.executeAsModal(async () => {
  await require("photoshop").action.batchPlay([
    {
      _obj: "make",
      at: { _ref: "channel" },
      using: { _enum: "userMaskEnabled", _value: "revealSelection" }
    }
  ], {});
}, { commandName: "Apply Layer Mask from Selection" });
```

### 4.9 executeAsModal Pattern

```js
const { core } = require("photoshop");

await core.executeAsModal(
  async (executionContext) => {
    // All document-modifying code goes here
    // executionContext.hostControl can suspend/resume history
    const historyState = await executionContext.hostControl.suspendHistory({
      historyStateInfo: { name: "InpaintKit Operation" }
    });
    try {
      // ... do work ...
      await executionContext.hostControl.resumeHistory(historyState);
    } catch (e) {
      await executionContext.hostControl.resumeHistory(historyState, false); // discard
      throw e;
    }
  },
  {
    commandName: "InpaintKit",
    // interactive: true — allows user input during modal (e.g. Select and Mask)
  }
);
```

---

## 5. UI Framework

### Options (ranked)

1. **Spectrum Web Components (SWC) + React** — Recommended. Adobe's design system, 30+ components, native look.
2. **Vanilla HTML + Spectrum UXP Widgets** — Simpler, no build step, fewer components.
3. **Pure React without SWC** — Works, but no Adobe-native look.

### React + SWC Setup

```bash
# Use Adobe's starter
npx @adobe/create-uxp-plugin my-plugin --template swc-uxp-react-starter
```

Key gotchas with React + Web Components:
- React does NOT attach event listeners to Web Component elements; use `ref` + manual `addEventListener`
- Use `class` not `className` in Web Components
- No self-closing tags on Web Components
- Must wrap in `<sp-theme>` to get Spectrum tokens

```jsx
import React, { useRef, useEffect } from "react";

function MyPanel() {
  const buttonRef = useRef(null);

  useEffect(() => {
    const btn = buttonRef.current;
    btn.addEventListener("click", handleClick);
    return () => btn.removeEventListener("click", handleClick);
  }, []);

  return (
    <sp-theme scale="medium" color="dark">
      <sp-button ref={buttonRef}>Generate</sp-button>
    </sp-theme>
  );
}
```

UXP v8.0.0 locks SWC to version 0.37.0 — do not update `@spectrum-web-components` independently.

---

## 6. Network Requests

UXP provides `fetch`, `XMLHttpRequest`, and `WebSocket` in global scope — no `require` needed.

```js
// fetch works normally
const response = await fetch("https://api.yourbackend.com/inpaint", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify({ image: base64Image, mask: base64Mask, prompt })
});
const result = await response.json();
```

For binary image data:

```js
// Sending pixel data as binary
const blob = new Blob([uint8Array], { type: "image/png" });
const formData = new FormData();
formData.append("image", blob, "image.png");
const response = await fetch(url, { method: "POST", body: formData });
```

Manifest requirements:

```json
"requiredPermissions": {
  "network": {
    "domains": ["https://api.yourbackend.com"]
  }
}
```

Restrictions:
- HTTP blocked on macOS — use HTTPS everywhere
- No wildcard TLDs from UXP 7.4+ (e.g., `*.com` disallowed)
- Known bug: `domains: "all"` unreliable in manifest v5 — list domains explicitly
- Private/VPN networks may fail even with explicit listing

---

## 7. File System Access

```js
const { localFileSystem } = require("uxp").storage;

// Sandbox locations (no permission needed)
const tmpFolder = await localFileSystem.getTemporaryFolder();
const dataFolder = await localFileSystem.getDataFolder();

// Write temp file
const tempFile = await tmpFolder.createFile("result.png", { overwrite: true });
await tempFile.write(uint8ArrayData, { format: localFileSystem.formats.binary });

// Read file back
const data = await tempFile.read({ format: localFileSystem.formats.binary });

// User-picked file (requires "localFileSystem": "request" in manifest)
const entry = await localFileSystem.getFileForOpening({ types: ["png", "jpg"] });
const pickedData = await entry.read({ format: localFileSystem.formats.binary });

// Persistent token (remember file between sessions)
const token = localFileSystem.createPersistentToken(entry);
// Store token in localStorage or secureStorage
// Later: const sameEntry = await localFileSystem.getEntryForPersistentToken(token);
```

URL schemes for direct path access: `plugin:/`, `plugin-data:/`, `plugin-temp:/`

---

## 8. Persistent Storage

### localStorage (non-sensitive settings)

```js
// Standard Web Storage API — works in UXP
localStorage.setItem("model", "flux-dev");
const model = localStorage.getItem("model");
```

### SecureStorage (tokens, API keys)

```js
const { secureStorage } = require("uxp").storage;

// Store
await secureStorage.setItem("api_key", "sk-xxxx");

// Retrieve (returns Uint8Array — decode it)
const raw = await secureStorage.getItem("api_key");
const apiKey = new TextDecoder().decode(raw);

// Remove
await secureStorage.removeItem("api_key");
```

WARNING: SecureStorage encrypts under the current user's account. Treat it as a cache — data can be lost on uninstall or corruption. Do not rely on it as the sole storage for credentials; provide a re-auth flow.

---

## 9. Opening URLs (OAuth Flows)

```js
const { shell } = require("uxp");

// Opens URL in system default browser
await shell.openExternal("https://accounts.yourservice.com/oauth/authorize?...");
```

Manifest requirement:

```json
"requiredPermissions": {
  "launchProcess": {
    "schemes": ["https"]
  }
}
```

For a full OAuth2 PKCE flow: open browser via `shell.openExternal`, run a local server inside the plugin (or use a backend relay), capture the callback. See [Adobe OAuth sample](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples) for reference implementation.

---

## 10. Development Setup

### Tools Required

1. **UXP Developer Tool (UDT)** — install from Creative Cloud Desktop
   - Load plugin by pointing to `manifest.json`
   - Watch mode (hot reload) for file changes
   - Embedded Chrome DevTools debugger
   - Package to `.ccx`
2. **Photoshop 24+** with Developer Mode enabled (Edit → Preferences → Plugins → Enable Developer Mode)
3. **Node.js** + build tooling (Vite/webpack for React plugins)

### Workflow

```bash
# 1. Scaffold project
npx @adobe/create-uxp-plugin my-inpaintkit --template swc-uxp-react-starter

# 2. Install deps
cd my-inpaintkit && npm install

# 3. Dev build with watch
npm run watch   # outputs to dist/

# 4. In UDT: Add Plugin → select dist/manifest.json → Load
# 5. UDT: click Debug to attach DevTools
```

Hot reload: UDT watches the plugin folder. For React builds, run `npm run watch` alongside; UDT detects file changes and reloads the panel. Not true HMR — it's a full panel reload.

### Debugging

- UDT provides full Chrome DevTools (Elements, Console, Network, Sources)
- `console.log()` output appears in UDT's console
- Network tab shows fetch calls — useful for debugging API requests
- `batchPlay` errors surface as descriptive strings in console

---

## 11. Plugin Distribution

### Format: `.ccx`

A `.ccx` is a ZIP with specific structure. Do NOT create it manually — use UDT's Package action.

### Process

1. Register plugin ID at [Adobe Developer Console](https://developer.adobe.com/console/)
2. Add the ID to `manifest.json` `"id"` field
3. In UDT: Actions → Package → select output directory
4. Test locally: double-click `.ccx` → Creative Cloud installs it
5. For marketplace: submit via Adobe Developer Console (review process applies)
6. For direct distribution: share `.ccx` file; users double-click to install

### Multi-channel warning

If distributing on both Adobe Marketplace AND direct/third-party: use two different plugin IDs. Critical for paid plugins to prevent license bypass.

---

## 12. InpaintKit-Specific Architecture Notes

### Inpainting Workflow

```
1. User makes selection (any PS tool: lasso, magic wand, etc.)
2. Plugin reads selection.bounds → { left, top, right, bottom }
3. Plugin reads active layer pixels in selection bounds via imaging.getPixels()
4. Plugin reads selection as mask (via batchPlay + temp channel, or derive from bounds)
5. Convert pixel data → base64 PNG or FormData binary blob
6. POST to AI backend (Stable Diffusion / custom API) via fetch
7. Receive generated image as binary/base64
8. Decode to Uint8Array
9. Create new pixel layer via doc.createLayer()
10. Write pixels at correct offset via imaging.putPixels()
11. Optionally: apply layer mask to constrain to original selection
```

### Selection Mask Extraction (Practical)

The simplest approach for rectangular/arbitrary selections:
- Use `selection.bounds` for position/crop
- Create a temp layer, fill with white, then use `imaging.getPixels()` on it with the selection active — Photoshop composites the selection into the alpha channel
- Alternative: use `batchPlay` to save selection to an alpha channel, then read that channel

### Base64 Conversion

```js
// Uint8Array → base64 (in UXP, btoa works but only for small images)
// For large images, use a chunked approach:
function uint8ToBase64(uint8Array) {
  let binary = "";
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
```

For large images (>1MB), convert to PNG first via canvas or send as FormData binary.

### Known API Issues (2025)

- `layer.pixelMap` undefined on Photoshop 26.7 — use `imaging.getPixels({ layerID })` instead
- `domains: "all"` unreliable — list explicit domains
- HTTP on macOS blocked — all AI backend calls must use HTTPS
- Smart Object creation requires batchPlay, not direct UXP DOM API

---

## 13. Existing Reference Implementations

| Project | Backend | Key Pattern | Repo |
|---|---|---|---|
| Auto-Photoshop-SD | Automatic1111/ComfyUI | Selection → SD inpaint | [GitHub](https://github.com/AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin) |
| stable.art | Automatic1111 | Selection → img2img | [GitHub](https://github.com/isekaidev/stable.art) |
| comfyui-photoshop | ComfyUI | Full workflow | [GitHub](https://github.com/NimaNzrii/comfyui-photoshop) |
| Adobe Samples | N/A | Official API examples | [GitHub](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples) |

`stable.art` and `Auto-Photoshop-SD` are highest-value references — both are UXP, open source, handle selections, and call external AI backends.

---

## 14. Trade-off Matrix

| Decision | Option A | Option B | Recommendation |
|---|---|---|---|
| UI Framework | React + SWC | Vanilla + Spectrum widgets | React + SWC for maintainability |
| Pixel transfer | imaging API (getPixels) | batchPlay + save to disk | imaging API — direct, no I/O |
| Auth storage | secureStorage | localStorage | secureStorage for tokens, localStorage for settings |
| AI call | Direct from plugin | Relay server | Direct (simpler); relay if CORS issues |
| Mask representation | RGBA alpha channel | Separate grayscale image | RGBA alpha — single request |
| Distribution | Adobe Marketplace | Direct .ccx | Direct first, marketplace later |

---

## Sources

- [Adobe UXP Photoshop API Reference](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/)
- [Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/)
- [executeAsModal](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/)
- [Selection API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/)
- [Layer API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/)
- [Manifest v4/v5](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v4/)
- [File Access in UXP](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/file-access/)
- [SecureStorage API](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/Modules/uxp/Key-Value%20Storage/SecureStorage/)
- [shell.openExternal](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/Modules/uxp/shell/Shell/)
- [Spectrum Web Components](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-spectrum/swc/)
- [UXP Developer Tool Guide](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/udt-walkthrough/)
- [Packaging Your Plugin](https://developer.adobe.com/photoshop/uxp/2022/guides/distribution/packaging-your-plugin/)
- [BatchPlay](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/)
- [UXP Photoshop Plugin Samples](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples)
- [Auto-Photoshop-StableDiffusion-Plugin](https://github.com/AbdullahAlfaraj/Auto-Photoshop-StableDiffusion-Plugin)
- [stable.art](https://github.com/isekaidev/stable.art)
- [CEP vs UXP (2026)](https://configurator.pixelsucht.net/blog/cep-vs-uxp-photoshop-2026/)
- [OAuth Sample for Photoshop (Adobe Tech Blog)](https://medium.com/adobetech/developing-an-oauth-sample-for-adobe-photoshop-999148f422d3)

---

## Unresolved Questions

1. **Selection mask precision**: For non-rectangular selections (lasso, magic wand), the exact method to extract the selection as a pixel mask (not just bounds) via stable UXP API needs validation. batchPlay approach (save to alpha channel → read with imaging API) is most likely correct but requires testing.
2. **Large image performance**: For high-resolution documents (100MP+), round-tripping pixel data through JS to a remote API may be prohibitively slow. May need to consider Hybrid Plugin (C++) or server-side pre-processing.
3. **Photoshop 26.7 pixelMap regression**: Bug where `layer.pixelMap` returns undefined on stable 26.7 is unresolved. Use `imaging.getPixels({ layerID })` as workaround and track Adobe's fix.
4. **SWC version lock**: SWC 0.37.0 lock in UXP v8 may lag behind Spectrum design system. Check if Adobe has released UXP v9 with updated SWC by the time implementation starts.
5. **`domains: "all"` manifest v5 bug**: Whether this is fixed in 2025 Photoshop releases needs verification. Currently, explicit domain listing is the safe path.
