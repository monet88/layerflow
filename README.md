# InpaintKit

InpaintKit is an AI image editing plugin for Adobe Photoshop. It turns a Photoshop selection plus a text prompt into generated image content, then places the result back into the document as a Smart Object layer.

The plugin targets Photoshop 24+ on macOS and Windows using UXP manifest v5, React 18, TypeScript, Vite, and Spectrum Web Components.

## What it does

- Generate new images from text prompts.
- Inpaint selected document regions with prompt-guided edits.
- Export selection/source pixels and masks from Photoshop.
- Send generation requests to supported AI providers.
- Place results back as Smart Object layers.
- Preserve paid generation results for retry when Photoshop placement fails.

## Providers

| Provider | Mode | Notes |
| --- | --- | --- |
| fal.ai | Direct plugin request | Fast image generation/editing provider. |
| Replicate | Direct plugin request | Uses prediction polling and file upload for larger inputs. |
| ChatGPT backend | Backend-mediated request | Supports GPT Image 2 workflows through the FastAPI backend. |

Provider and model metadata live in the TypeScript registries under `src/providers/` and `src/providers/model-registry.ts`.

## Architecture

```text
UI (React + SWC)
  -> generation service
  -> Photoshop export/selection helpers
  -> AI provider
  -> Photoshop Smart Object placement
```

Important paths:

```text
src/
├── App.tsx, index.tsx              # entry + dialog routing
├── components/                     # React + Spectrum Web Components dialogs
├── hooks/use-sp-event.ts           # SWC change/input event bridge
├── providers/                      # provider implementations and registries
├── services/                       # generation pipeline, network, image helpers
├── photoshop/                      # Photoshop host interactions
├── storage/                        # secureStorage keys + localStorage prefs
└── types/                          # shared TypeScript types

backend/                            # FastAPI backend for ChatGPT/GPT Image workflows
manifest.json                       # UXP manifest v5 and network permissions
plans/260519-2141-inpaintkit-uxp-plugin/
                                    # implementation roadmap and phase plans
```

## Requirements

- Node.js and npm.
- Adobe Photoshop 24+.
- Adobe UXP Developer Tool.
- Python environment for backend work when using ChatGPT backend flows.

## Setup

Install frontend dependencies:

```bash
npm install
```

Run TypeScript validation:

```bash
npm run typecheck
```

Build the UXP plugin bundle:

```bash
npm run build
```

Start watch build during plugin development:

```bash
npm run dev
```

Then load `manifest.json` from the repository root in Adobe UXP Developer Tool.

## Backend

The backend lives in `backend/` and supports ChatGPT/GPT Image workflows that should not run directly inside the UXP plugin.

See `backend/README.md` and backend configuration files for local setup, environment variables, and validation commands.

## Development notes

- Photoshop write operations must run inside `core.executeAsModal`.
- Provider requests must honor `AbortSignal`.
- API keys and provider secrets must stay in secure storage or environment variables.
- New UI-facing models should be registered in `model-registry.ts` instead of hardcoding endpoints.
- UXP network domains must be declared in `manifest.json`.

## Agent harness

This repository includes a Harness workspace for agent-assisted development:

- `docs/HARNESS.md` — collaboration model for humans and coding agents.
- `docs/FEATURE_INTAKE.md` — work classification and risk intake.
- `docs/TEST_MATRIX.md` — behavior-to-proof validation matrix.
- `docs/templates/` — reusable story, decision, and validation templates.
- `scripts/harness` — repo-local Harness CLI entrypoint.

The Harness files are support infrastructure; the product in this repository is InpaintKit.
