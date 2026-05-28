---
title: "Phase 1: Project Setup"
sprint: 1
status: complete
priority: P1
effort: 3h
depends_on: []
---

# Phase 1: Project Setup

**Priority:** P1 — Blocks all other phases
**Estimated effort:** 3h
**Status:** pending

---

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-uxp-report.md](../reports/researcher-uxp-report.md) — UXP platform reference
- [researcher-architecture-report.md](../reports/researcher-architecture-report.md) — Build tooling decision

---

## Overview

Scaffold a working UXP plugin that loads in Photoshop via UXP Developer Tool (UDT) with a blank React panel. Establish the build pipeline, TypeScript config, manifest, and developer workflow. No AI features yet — just "panel appears in Photoshop."

---

## Key Insights

- `@bubblydoo/vite-uxp-plugin` is the only maintained Vite+TypeScript+UXP solution as of 2026-05-18 (9 stars, active). It handles CJS output, UXP module externalization, and dev-mode WebSocket HMR.
- Adobe's official starter (`create-uxp-plugin`) uses webpack, not Vite. Do NOT use it — results in a more complex build setup.
- UXP does NOT support ES module `type: "module"` — Vite plugin handles the CJS transform automatically.
- Hot reload in UXP is panel reload (not true HMR). UDT detects file changes and reloads.
- `imaging.getSelection` requires PS 25+ — set `minVersion: "24.0.0"` but document this limitation.

---

## Requirements

**Functional:**
- Plugin loads in Photoshop via UDT (no marketplace yet)
- React panel renders in Photoshop sidebar
- `npm run dev` starts Vite watch mode, UDT auto-reloads on change
- `npm run build` produces distributable `dist/`
- TypeScript strict mode compiles with no errors

**Non-functional:**
- All UXP modules (`photoshop`, `uxp`) externalized in Vite config (never bundled)
- Source maps enabled in dev mode
- `.gitignore` covers `dist/`, `node_modules/`, `*.ccx`

---

## Architecture

```
inpaintkit/
├── manifest.json          # Plugin metadata — v5, PS 24+
├── package.json           # Scripts: dev, build, package
├── vite.config.ts         # Vite + uxp plugin config
├── tsconfig.json          # Strict TS, no emit, paths
├── src/
│   ├── index.html         # UXP panel entry point
│   ├── index.tsx          # React root, mounts <App />
│   ├── App.tsx            # Top-level layout shell
│   └── types/
│       └── photoshop.d.ts # Ambient declarations for UXP modules
├── assets/
│   └── icons/
│       ├── icon.png       # 23x23 panel icon (dark)
│       └── icon@2x.png    # 46x46 retina
└── dist/                  # Build output (gitignored)
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Dependencies + scripts |
| `manifest.json` | UXP plugin metadata + permissions |
| `vite.config.ts` | Build configuration |
| `tsconfig.json` | TypeScript settings |
| `src/index.html` | Panel HTML shell |
| `src/index.tsx` | React bootstrap |
| `src/App.tsx` | Root component (placeholder) |
| `src/types/photoshop.d.ts` | Type stubs for `require("photoshop")` etc. |
| `.gitignore` | Standard + dist/ + *.ccx |
| `assets/icons/icon.png` | 23×23 placeholder icon |

---

## Implementation Steps

### Step 1.1 — Initialize npm project

```bash
cd /home/monet/dev/inpaintkit
npm init -y
```

### Step 1.2 — Install dependencies

```bash
# Runtime deps (bundled into dist/)
npm install react react-dom

# Dev deps
npm install -D \
  typescript \
  @types/react \
  @types/react-dom \
  vite \
  @vitejs/plugin-react \
  @bubblydoo/vite-uxp-plugin
```

> Note: `@spectrum-web-components/*` packages are installed in Phase 2.
> UXP provides `photoshop` and `uxp` as host-injected modules — never install them as npm packages.

### Step 1.3 — Create `manifest.json`

Critical fields:
- `manifestVersion: 5`
- `id: "com.inpaintkit.plugin"` — register at Adobe Developer Console before marketplace submission
- `host.minVersion: "24.0.0"` — PS 24 for imaging API; some features need PS 25+
- Network domains: enumerate ALL API endpoints explicitly (no wildcards in UXP 7.4+)

```json
{
  "manifestVersion": 5,
  "id": "com.inpaintkit.plugin",
  "name": "InpaintKit",
  "version": "1.0.0",
  "main": "index.html",
  "icons": [
    {
      "width": 23,
      "height": 23,
      "path": "assets/icons/icon.png",
      "scale": [1, 2],
      "theme": ["dark", "light", "darkest", "lightest", "medium"]
    }
  ],
  "host": {
    "app": "PS",
    "minVersion": "24.0.0"
  },
  "entrypoints": [
    {
      "type": "panel",
      "id": "inpaintkitPanel",
      "label": { "default": "InpaintKit" },
      "minimumSize": { "width": 300, "height": 400 },
      "maximumSize": { "width": 800, "height": 1200 },
      "preferredDockedSize": { "width": 360, "height": 640 },
      "icons": [
        { "width": 23, "height": 23, "path": "assets/icons/icon.png", "scale": [1, 2] }
      ]
    }
  ],
  "requiredPermissions": {
    "network": {
      "domains": [
        "https://api.openai.com",
        "https://auth.openai.com",
        "https://fal.run",
        "https://fal.ai",
        "https://storage.googleapis.com",
        "https://v3.fal.media",
        "https://api.replicate.com",
        "https://replicate.delivery",
        "http://localhost:8000"
      ]
    },
    "localFileSystem": "request",
    "clipboard": "readAndWrite",
    "launchProcess": {
      "schemes": ["https"]
    }
  }
}
```

**Risk — domain list:** If fal.ai uses additional subdomains for file storage or CDN, the request will fail silently. Monitor network tab in UDT DevTools during Phase 4 testing and add any missing hostnames. `[VERIFY_AT_RUNTIME]` — fal.ai may migrate result CDN from `storage.googleapis.com` to `v3.fal.media`; both listed preemptively.

**Note — localhost:8000:** Required for Phase 9 backend dev (ChatGPT provider). Listed here in baseline so manifest stays sync across phases. Production builds replace `http://localhost:8000` with the actual VPS URL via build-time substitution (see Phase 10).

### Step 1.4 — Create `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { uxp } from '@bubblydoo/vite-uxp-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    react(),
    uxp(manifest),
  ],
  build: {
    sourcemap: true,
    minify: false,  // Keep readable for UXP debugging
    outDir: 'dist',
  },
});
```

The `uxp()` plugin handles:
- CJS output format (UXP requires CommonJS, not ESM)
- Externalization of `photoshop`, `uxp`, `os`, `path`, `fs` (host-provided modules)
- Copies `manifest.json` and `assets/` to `dist/`

### Step 1.5 — Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 1.6 — Create `src/types/photoshop.d.ts`

UXP modules are injected by the host — TypeScript needs ambient declarations to avoid import errors:

```typescript
// Ambient declarations for UXP host-injected modules.
// These are NOT npm packages; they exist at runtime inside Photoshop.

declare module 'photoshop' {
  const app: any;
  const core: any;
  const action: any;
  const imaging: any;
  export { app, core, action, imaging };
}

declare module 'uxp' {
  const storage: {
    localFileSystem: any;
    secureStorage: any;
  };
  const shell: {
    openExternal: (url: string) => Promise<void>;
  };
  export { storage, shell };
}
```

> Note: More precise types can be added as APIs are used in later phases. Starting minimal avoids fighting the type system during setup.

### Step 1.7 — Create `src/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>InpaintKit</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

### Step 1.8 — Create `src/index.tsx`

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(<App />);
```

### Step 1.9 — Create `src/App.tsx` (placeholder)

```typescript
import React from 'react';

export function App() {
  return (
    <div style={{ padding: 16, color: '#fff', fontFamily: 'sans-serif' }}>
      <h2>InpaintKit</h2>
      <p>Phase 1: Setup complete</p>
    </div>
  );
}
```

### Step 1.10 — Add `package.json` scripts

```json
{
  "scripts": {
    "dev": "vite build --watch --mode development",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

### Step 1.11 — Create placeholder icon

Create a 23×23 PNG at `assets/icons/icon.png`. A solid colored square is fine for development. UDT requires the file to exist — plugin fails to load without it.

### Step 1.12 — Developer workflow setup

1. Install Photoshop 24+ via Creative Cloud
2. Enable Developer Mode: Photoshop → Edit (Win) / Photoshop (Mac) → Preferences → Plugins → Enable Developer Mode → OK
3. Install UXP Developer Tool (UDT) from Creative Cloud Desktop
4. In UDT: click "Add Plugin" → navigate to `dist/manifest.json` → click "Load"
5. In terminal: `npm run dev` (Vite watch starts, outputs to `dist/`)
6. In UDT: "Load" becomes active; click "Debug" for DevTools
7. In Photoshop: Plugins → InpaintKit → InpaintKit panel appears

---

## Success Criteria

- [ ] `npm run dev` runs without errors, outputs to `dist/`
- [ ] `npm run typecheck` reports 0 errors
- [ ] UDT loads plugin from `dist/manifest.json` without errors
- [ ] Panel appears in Photoshop Plugins menu
- [ ] "InpaintKit / Phase 1: Setup complete" renders in the panel
- [ ] Modifying `App.tsx` triggers auto-reload in UDT within 3 seconds
- [ ] UDT DevTools console shows no errors on load
- [ ] `typeof AbortController !== 'undefined'` returns true in UDT console (needed for Phase 4-5 fetch timeout)
- [ ] `typeof localStorage !== 'undefined' && localStorage.setItem('_test', '1') === undefined` works in UDT console (needed for Phase 4 settings-storage; if unavailable, use UXP localFileSystem fallback)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `@bubblydoo/vite-uxp-plugin` API changes | Low | High | Pin exact version; read changelog before upgrade |
| UXP module externalization misconfigured | Medium | High | Test `require("photoshop")` in console — if undefined, externalization broke |
| Icon file missing → plugin fails to load | High (easy mistake) | Medium | Create placeholder immediately; add file-exists check to build |
| Windows path separators in manifest | Low | Medium | Use forward slashes in all manifest paths |
| `type: "module"` in package.json breaks CJS output | Medium | High | Do NOT add `"type": "module"` to package.json |

---

## Rollback Plan

Phase 1 only creates config files and a blank component. Full rollback = delete `dist/` and revert to a fresh `npm init`. No Photoshop data is touched.

---

## Next Steps

Phase 2 (Core UI) begins immediately after this step's success criteria are met. Spectrum Web Components are installed in Phase 2.

---

## Code Conventions

**Import style:**
- `require()` for UXP host modules (`photoshop`, `uxp`, `os`, `fs`) — these are externalized by Vite, kept as CJS `require()` in output
- ESM `import/export` for all project source code — Vite resolves, tree-shakes, and bundles these

```typescript
// UXP host modules — CJS (externalized, resolved at runtime by Photoshop)
const { app, core, imaging } = require('photoshop');
const { storage } = require('uxp');

// Project modules — ESM (bundled by Vite)
import { getProvider } from '../providers/provider-registry';
import { invertMaskConvention } from '../services/image-processing';
```
