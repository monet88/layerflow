# Backend and Photoshop UXP Testing Guide

## Overview

This guide covers automated backend validation and manual Photoshop UXP verification for InpaintKit.

Use it before marking Phase 11 complete or starting distribution packaging. Automated checks can run on Linux. Photoshop UXP checks require a machine with Adobe Photoshop 24+ and Adobe UXP Developer Tool.

## Backend Tests

### Prerequisites

Run commands from the repository root unless noted.

```bash
python3 -m venv backend/venv
backend/venv/bin/python -m pip install -r backend/requirements-dev.txt
```

If dependencies are already installed, rerun the install command after `backend/requirements*.txt` changes.

### Run the Full Backend Suite

```bash
PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests
```

Expected result:

- All tests pass.
- Current automated baseline after frontend/backend test expansion: `71 passed`.
- A Starlette `httpx` deprecation warning is acceptable unless it becomes a failure.

### Run Targeted Backend Tests

```bash
PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests/test_backend.py -q
PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests/test_chatgpt_web_provider.py -q
PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests/test_image_upload_security.py -q
```

Use targeted tests when changing routes, ChatGPT provider behavior, upload limits, or payload validation.

### Run Backend Server for Manual Smoke Tests

Create a local backend env file:

```bash
cp backend/.env.example backend/.env
backend/venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the generated key into `backend/.env` as `ENCRYPTION_KEY`.

For mock-provider smoke testing, keep:

```env
ENV=development
APP_API_KEY=dev-app-key
IMAGE_PROVIDER=mock
ALLOWED_ORIGINS=app://uxp-internal,http://localhost:8000
```

Start the backend from the `backend/` directory so `.env` is loaded from the expected location:

```bash
cd backend
venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Smoke check from another terminal:

```bash
curl -s http://127.0.0.1:8000/health
curl -s -H "Authorization: Bearer dev-app-key" http://127.0.0.1:8000/v1/models
curl -s \
  -X POST http://127.0.0.1:8000/v1/images/generations \
  -H "Authorization: Bearer dev-app-key" \
  -H "X-User-Id: manual-test" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"draw a small red square","model":"gpt-image-2"}'
```

Expected smoke result:

- `/health` returns `{"status":"ok"}`.
- `/v1/models` returns `gpt-image-2`.
- `/v1/images/generations` returns a `data` array with image payload when `IMAGE_PROVIDER=mock`.

## Frontend Automated Tests

Run the frontend unit/component suite:

```bash
npm test -- --run
```

Expected result:

- All Vitest suites pass.
- Current automated baseline: `9 passed`.
- Tests run in jsdom and mock Spectrum Web Component side-effect imports; they do not replace Photoshop UXP manual verification.

## Frontend Build Checks

Run these before loading the plugin manually:

```bash
npm test -- --run
npm run typecheck
npm run build
```

Expected result:

- Typecheck passes with no TypeScript errors.
- Build writes the UXP bundle into `dist/`.

For iterative UXP testing, use watch mode:

```bash
npm run dev
```

Reload the plugin in UXP Developer Tool after each build.

## Photoshop UXP Manual Testing

### Prerequisites

- Adobe Photoshop 24+ installed.
- Adobe UXP Developer Tool installed.
- Backend running at `http://127.0.0.1:8000` or another configured backend URL when testing ChatGPT backend flows.
- Plugin built with `npm run build` or actively watched with `npm run dev`.
- Do not record API keys, access tokens, device codes, or ChatGPT account details in screenshots.

### Install Adobe UXP Developer Tool

Official install path:

1. Install or open Adobe Creative Cloud Desktop App: <https://www.adobe.com/download/creative-cloud>.
2. In Creative Cloud, open Apps.
3. Search for `UXP Developer Tools`.
4. Click Install.
5. If it does not appear in Creative Cloud, use Adobe's direct download page: <https://www.adobe.com/download/uxp-developer-tools>.

Reference docs:

- Photoshop UXP Developer Tool guide: <https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/>.
- Photoshop UXP installation guide: <https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/installation>.

### Load the Plugin

1. Open Adobe UXP Developer Tool.
2. Add the plugin by selecting the repository-root `manifest.json`.
3. Click Load or Reload.
4. Open Photoshop.
5. Open the plugin from `Plugins → InpaintKit`.

### Configure Providers

For direct providers:

1. Open Settings in the plugin.
2. Add the fal.ai or Replicate API key.
3. Save settings.

For ChatGPT backend:

1. Start the backend.
2. Open Settings in the plugin.
3. Set backend URL, for example `http://127.0.0.1:8000`.
4. Set backend API key, for example `dev-app-key` in development.
5. In ChatGPT, open Settings → Security and enable Device Code authorization for Codex.
6. Start ChatGPT sign-in from the plugin and complete the device-code flow.

## Team Testing from Another Machine

Use this section when a teammate tests the plugin on a different computer.

### What to Send to the Tester

Preferred handoff:

1. Push or zip the repository state that should be tested.
2. Include this guide and the expected branch/commit.
3. Share backend URL and backend API key through a secure channel, not in git or screenshots.
4. Tell the tester which provider path to test:
   - `IMAGE_PROVIDER=mock` for backend/plugin smoke testing.
   - `IMAGE_PROVIDER=chatgpt_web` for real ChatGPT GPT Image 2 testing.

On the tester machine:

```bash
npm install
npm run typecheck
npm run build
```

Then load the repository-root `manifest.json` in Adobe UXP Developer Tool.

### Option A: Backend Runs on the Tester Machine

Use this when each tester can run their own backend locally.

Tester setup:

```bash
python3 -m venv backend/venv
backend/venv/bin/python -m pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
backend/venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the generated key into `backend/.env` as `ENCRYPTION_KEY`.

For local mock testing:

```env
ENV=development
APP_API_KEY=dev-app-key
IMAGE_PROVIDER=mock
ALLOWED_ORIGINS=app://uxp-internal,http://localhost:8000
```

Start backend:

```bash
cd backend
venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Plugin settings:

- Backend URL: `http://127.0.0.1:8000`
- Backend API key: value of `APP_API_KEY`, for example `dev-app-key`

No `manifest.json` network-domain change is needed for this path because localhost and `127.0.0.1` are already allowed.

### Option B: Backend Runs on a Shared Machine

Use this when one machine hosts the backend and multiple testers connect to it.

On the shared backend machine, set `backend/.env`:

```env
ENV=development
APP_API_KEY=<shared-test-api-key>
IMAGE_PROVIDER=mock
ALLOWED_ORIGINS=app://uxp-internal,http://<backend-host>:8000
```

Use `IMAGE_PROVIDER=chatgpt_web` only when the shared machine is intended to perform real ChatGPT GPT Image 2 testing.

Start backend so other machines can reach it:

```bash
cd backend
venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Network checklist:

- Use a trusted LAN or VPN; do not expose this dev backend to the public internet.
- Open firewall access to TCP port `8000` only for tester machines.
- Confirm the tester can open `http://<backend-host>:8000/health` in a browser.
- Keep `<shared-test-api-key>` secret and rotate it after shared testing.

Plugin build checklist for shared backend:

- Current `manifest.json` allows only `localhost`, `127.0.0.1`, and `[::1]` for the backend.
- If testers use `http://<backend-host>:8000`, add that exact origin to `requiredPermissions.network.domains` in `manifest.json`, then rerun `npm run build` before loading the plugin.
- Do not commit a private LAN IP unless the team intentionally wants that test origin tracked.

Tester plugin settings:

- Backend URL: `http://<backend-host>:8000`
- Backend API key: shared value of `APP_API_KEY`

### ChatGPT Device Code on a Tester Machine

For real ChatGPT backend testing:

1. Set backend `IMAGE_PROVIDER=chatgpt_web`.
2. In the tester's ChatGPT account, open Settings → Security.
3. Enable Device Code authorization for Codex.
4. In the plugin Settings, start ChatGPT sign-in.
5. Complete the device-code flow in the browser.
6. Run both ChatGPT manual scenarios: blank-canvas Generate and selection-based Inpaint.

The ChatGPT session is tied to the tester/backend auth flow. Do not share access tokens or device codes in chat, logs, or screenshots.

### Team Pass Criteria

A teammate's test pass is valid only when they report:

- OS, Photoshop version, UXP Developer Tool version, branch/commit.
- Backend mode: local tester backend or shared backend.
- Backend URL used in plugin Settings.
- Provider/model tested.
- `npm run typecheck` and `npm run build` result on the plugin build they loaded.
- Backend pytest result if they changed or own backend code.
- Screenshots for blank-canvas Generate and selection-based Inpaint.
- Any UXP Developer Tool console errors and backend terminal errors.

Do not mark Phase 11 complete from team testing unless both ChatGPT Photoshop UXP demo flows pass on at least one Photoshop-capable machine.

## Manual Test Matrix

### 1. Blank-Canvas Generate

Goal: Verify full-canvas generation and placement.

Steps:

1. Create a new Photoshop document, for example `1024 × 1024` RGB.
2. Open InpaintKit.
3. Select mode `Generate`.
4. Pick a model that supports generate. For Phase 11 ChatGPT parity, use `gpt-image-2-chatgpt`.
5. Enter a prompt, for example `A clean product photo of a red ceramic mug on a neutral background`.
6. Click Generate.
7. Wait for completion. ChatGPT GPT Image 2 can take 2+ minutes.

Expected result:

- Progress shows generate-specific stages, not inpaint export/upload stages.
- The generated image is placed as a new Smart Object layer covering the canvas.
- The original document remains usable.
- Recent prompt is saved only after successful placement.

Evidence to capture:

- Progress dialog screenshot.
- Final canvas screenshot.
- Layers panel showing the new `InpaintKit:` Smart Object layer.

### 2. Selection-Based Inpaint

Goal: Verify selection export, mask handling, generation, and masked placement.

Steps:

1. Open or create a Photoshop document with visible content.
2. Make a clear selection with marquee/lasso.
3. Open InpaintKit.
4. Select mode `Inpaint`.
5. Pick a model that supports inpaint. For Phase 11 ChatGPT parity, use `gpt-image-2-chatgpt`.
6. Enter a prompt, for example `Replace the selected area with a small green plant`.
7. Click Inpaint Selection.
8. Wait for completion.

Expected result:

- Progress shows inpaint stages: prepare, export, upload, generate, place, done.
- Only the selected area is affected through the placed result and mask.
- The result is placed as a new Smart Object layer with a layer mask.
- The source layer/document is not destructively edited.

Evidence to capture:

- Selection before running.
- Progress dialog screenshot.
- Final canvas screenshot.
- Layers panel showing Smart Object and mask.

### 3. Inpaint Without Selection

Goal: Verify guardrail before provider call.

Steps:

1. Open a Photoshop document.
2. Ensure there is no active selection.
3. Select mode `Inpaint`.
4. Enter a prompt.
5. Click Inpaint Selection.

Expected result:

- Plugin shows a clear `No selection` message.
- No provider generation starts.
- No new layer is placed.

### 4. Empty Prompt Guardrail

Goal: Verify generate/inpaint cannot run without a prompt.

Steps:

1. Open InpaintKit.
2. Select either mode.
3. Leave the prompt empty or whitespace-only.

Expected result:

- Primary action button is disabled.
- No generation request starts.

### 5. ChatGPT Backend Disconnected

Goal: Verify recoverable backend error handling.

Steps:

1. Stop the backend server.
2. Select `gpt-image-2-chatgpt`.
3. Run Generate or Inpaint with a valid prompt.

Expected result:

- Plugin returns to the main panel with a user-readable backend/network error.
- No partial layer is placed.
- User can fix backend settings/server and retry.

### 6. Placement Retry Recovery

Goal: Verify cached output can be placed again without paying for another generation.

Triggering placement failure is environment-dependent. Use this scenario when a real placement error occurs during manual testing.

Expected result after placement failure:

- Error panel keeps the real Photoshop placement error visible.
- Error panel shows a retry hint that the image is cached.
- `Retry Placement` runs placement only, not export/upload/generate.
- Retry progress shows placement-only status.
- If retry succeeds, the cached image is placed as a Smart Object layer.

### 7. Cancel During Progress

Goal: Verify user can cancel long operations before placement.

Steps:

1. Start a Generate or Inpaint run.
2. Click Cancel while progress is active.

Expected result:

- UI returns to the main panel.
- No completed result layer is placed if the operation was cancelled before placement.
- A later run can start normally.

## Pass Criteria

Backend automated pass:

- `npm run typecheck` passes.
- `npm run build` passes.
- `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests` passes.

Photoshop UXP manual pass:

- Blank-canvas ChatGPT generate passes.
- Selection-based ChatGPT inpaint passes.
- Inpaint without selection is blocked before provider call.
- Empty prompt disables execution.
- Backend disconnected state shows a clear error.
- Placement retry works if a placement failure is encountered.

Do not mark Phase 11 complete until both ChatGPT Photoshop UXP demo flows pass manually.

## Failure Report Template

Use this format when a test fails:

```text
Scenario:
Environment:
Provider/model:
Prompt:
Steps to reproduce:
Expected:
Actual:
Screenshots/logs:
Backend terminal output:
Photoshop/UXP Developer Tool console output:
Regression risk:
```

## Troubleshooting

### Backend cannot start because `ENCRYPTION_KEY` is invalid

Generate a new key:

```bash
backend/venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set it in the `.env` file loaded by the backend process.

### Plugin cannot connect to backend

Check:

- Backend is running.
- Plugin backend URL matches the running server.
- Plugin backend API key matches `APP_API_KEY`.
- `ALLOWED_ORIGINS` includes `app://uxp-internal`.
- `manifest.json` allows the backend host.

### ChatGPT authorization fails

Check:

- Device Code authorization for Codex is enabled in ChatGPT Settings → Security.
- The device code was completed before expiry.
- Backend is using `IMAGE_PROVIDER=chatgpt_web` for real ChatGPT provider testing.

### Inpaint result mask looks inverted

Check:

- The Photoshop selection was active before running.
- The selected area is the intended edit region.
- Capture source selection, final layer mask, and provider/model used for debugging.
