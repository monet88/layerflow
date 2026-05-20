---
title: "Phase 9: Plugin ChatGPT Integration"
sprint: 3
status: pending
priority: P2
effort: 7h
depends_on: [phase-05, phase-06, phase-08]
---

# Phase 9: Plugin ChatGPT Integration

## Context Links

- [plan.md](./plan.md) — Overview
- [/home/monet/dev/cc-switch/src/components/providers/forms/hooks/useManagedAuth.ts](file:///home/monet/dev/cc-switch/src/components/providers/forms/hooks/useManagedAuth.ts) — Device code polling pattern (PORT SOURCE)
- [/home/monet/dev/cc-switch/src/components/providers/forms/CodexOAuthSection.tsx](file:///home/monet/dev/cc-switch/src/components/providers/forms/CodexOAuthSection.tsx) — OAuth UI reference (PORT SOURCE)
- [/home/monet/dev/cc-switch/src/lib/api/auth.ts](file:///home/monet/dev/cc-switch/src/lib/api/auth.ts) — Device code response types (PORT SOURCE)
- [/docs/provider-api-verification.md](../../docs/provider-api-verification.md) — Verified OAuth endpoints and flow

## Port Strategy

**Use `/xia` from `/home/monet/dev/cc-switch` to port the Codex OAuth device code login flow.** Key files to port/adapt:

| cc-switch Source | InpaintKit Target | Adaptation |
|------------------|-------------------|-----------|
| `src/lib/api/auth.ts` (types) | `src/auth/oauth-types.ts` | Keep types, remove Tauri `invoke()` |
| `src/components/providers/forms/hooks/useManagedAuth.ts` (polling logic) | `src/auth/codex-device-code.ts` | Replace Tauri invoke with direct HTTP fetch to auth.openai.com |
| `src/components/providers/forms/CodexOAuthSection.tsx` (UI) | `src/components/chatgpt-login-modal.tsx` | Rewrite with Spectrum Web Components |

**Key adaptations from cc-switch → UXP plugin:**
- cc-switch uses Tauri `invoke()` to call Rust backend for actual HTTP → InpaintKit calls auth.openai.com directly via UXP fetch
- cc-switch manages multiple accounts → InpaintKit manages single account
- cc-switch uses React Query → InpaintKit uses simple useState + useEffect
- Polling interval logic identical: `Math.max((response.interval + 3), 8) * 1000`ms

## Overview

Add GPT Image 2 as a provider option in the plugin. This requires two parts: (1) Device Code OAuth flow to get a ChatGPT access_token, and (2) a backend provider that sends requests to the backend server which proxies ChatGPT Web API.

The plugin handles login (simple REST to auth.openai.com). The backend handles the heavy ChatGPT API processing (PoW, SSE, polling).

## Key Insights (from cc-switch + video analysis)

**Device Code OAuth:**
- POST `auth.openai.com/deviceauth/usercode` → `{ device_code, user_code, verification_uri, expires_in, interval }`
- Plugin displays `user_code` (8 chars) + opens `verification_uri` in browser
- Plugin polls `auth.openai.com/deviceauth/token` every `(interval + 3)s`
- On success: receive `access_token`, `refresh_token`, `expires_in`
- User must enable "Device code authorization for Codex" in ChatGPT Security Settings
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (Codex public client)
- Client ID stored as configurable constant in `src/constants/oauth.ts` — if OpenAI revokes this client, user can update via plugin settings
- Token expires ~10 days, refresh via standard OAuth refresh_token grant

**Plugin → Backend flow:**
- Plugin sends access_token + image + mask + prompt to backend
- Backend uses token to call ChatGPT Web API (120-150s)
- Backend returns OpenAI-compatible b64_json response
- Plugin places result as Smart Object (same as other providers)

## Requirements

**Functional:**
- Device Code OAuth login UI (modal in Settings)
  - Display user_code in large mono font
  - Copy to clipboard button
  - Open verification_uri in system browser (shell.openExternal)
  - Polling indicator (spinner + "Waiting for authorization...")
  - Cancel button
  - Error state with retry
  - Success state → store tokens
- Token management
  - Store access_token + refresh_token in secureStorage
  - Show connected status + expiry in Settings
  - Disconnect button (clear tokens)
  - Auto-refresh when token expires within 5 minutes
- Backend provider in plugin
  - After successful OAuth, register token with backend: POST `{backend_url}/auth/chatgpt/session` with `{ access_token, refresh_token }` (HTTPS required for non-localhost)
  - Generation requests: POST `{backend_url}/v1/images/edits` with multipart form
  - Headers: `Authorization: Bearer {app_api_key}`, `X-User-Id: {user_id}`
  - Token NOT sent per-request — backend retrieves stored token from session_repository by user_id
  - Handle 180s timeout (XHR, not fetch)
  - Progress: "Uploading..." → "Generating (this may take 2+ minutes)..."
  - Backend URL validation: reject non-HTTPS URLs (except localhost) at settings save time
- Settings UI updates
  - Backend URL input field (default: http://localhost:8000)
  - Backend API key input field
  - ChatGPT sign-in section (conditional, shown when ChatGPT provider selected)
  - Connection status badge (connected/disconnected/expired)

**Non-functional:**
- OAuth tokens never logged or exposed in UI beyond status
- Polling cleanup on component unmount (clear intervals)
- Graceful degradation: if backend unreachable, show clear error
- Device code flow works entirely from UXP plugin (no backend needed for auth)

## Architecture

```
src/
├── providers/
│   └── backend-provider.ts        # POST to backend /v1/images/edits
├── auth/
│   ├── codex-device-code.ts       # OAuth device code flow logic
│   ├── token-manager.ts           # Store/refresh/validate tokens
│   └── oauth-types.ts             # TypeScript types for OAuth responses
├── constants/
│   └── oauth.ts                   # Configurable CODEX_CLIENT_ID, AUTH_BASE_URL, scopes
├── components/
│   ├── settings-dialog.tsx        # Updated: backend URL, ChatGPT section
│   ├── chatgpt-login-modal.tsx    # Device code display + polling UI
│   └── connection-status.tsx      # Badge: connected/expired/disconnected
└── storage/
    └── secure-storage.ts          # Updated: token read/write helpers
```

## Implementation Steps

1. Create `oauth-types.ts` with device code response types
2. Create `src/constants/oauth.ts` — configurable CODEX_CLIENT_ID, AUTH_BASE_URL, default scopes
3. Implement `codex-device-code.ts`:
   - `startDeviceAuth()` → POST to auth.openai.com/deviceauth/usercode
   - `pollForToken(device_code)` → poll auth.openai.com/deviceauth/token
     - Handle `authorization_pending` → continue polling
     - Handle `slow_down` → increase interval by 5s, continue polling (RFC 8628 compliance)
     - Handle `expired_token` / `access_denied` → stop, show error
   - `refreshToken(refresh_token)` → POST to auth.openai.com/oauth/token
4. Implement `token-manager.ts`:
   - Store tokens in secureStorage (access_token, refresh_token, expires_at)
   - `getValidToken()` → auto-refresh if expiring within 5 min; **throws `TokenExpiredError` on refresh failure** (never return stale token)
   - `isConnected()` → check if valid token exists
   - `disconnect()` → clear stored tokens
5. Implement `chatgpt-login-modal.tsx`:
   - Large user_code display (mono font)
   - Copy button with check animation
   - "Open ChatGPT to authorize" button (shell.openExternal)
   - Polling spinner + "Waiting for authorization..."
   - Error/retry state
   - Cancel button (stops polling)
   - **useEffect cleanup:** store interval/timeout handles in refs, clearInterval + clearTimeout on unmount
6. Implement `connection-status.tsx`:
   - Green badge "Connected" + "Expires in X days"
   - Red badge "Expired" or "Disconnected"
   - "Sign in" / "Disconnect" action buttons
7. Update `settings-dialog.tsx`:
   - Add "ChatGPT (Subscription)" provider option
   - Show backend URL + API key inputs when ChatGPT selected
   - Show ChatGPT sign-in section below
8. Implement `backend-provider.ts`:
   - Implements same ProviderInterface as fal.ai/Replicate
   - On first use after OAuth: POST `{backend_url}/auth/chatgpt/session` to register token server-side
   - Generation: POST multipart to `{backend_url}/v1/images/edits`
   - Include: image, mask (optional), prompt, model (NO access_token — backend retrieves it by user_id)
   - Headers: `Authorization: Bearer {app_api_key}`, `X-User-Id: {user_id}`
   - XHR with 180s timeout (not fetch — too unreliable for long requests)
   - Parse OpenAI-compatible response — `assertImageEditsResponse()` runs before consumption (RT9): require object → `data: array` → first entry has `b64_json: string` OR `url: string`. Throw `ProviderResponseError` with the offending payload (sanitized) on shape mismatch
   - Pre-flight: call `getValidToken()` — catch `TokenExpiredError` → show "Session expired" immediately (avoid 150s wait)
   - Pre-flight: call `validateBackendUrl(backendUrl)` (see below) — fail fast with a settings-pointed error if URL is malformed or non-HTTPS (RT1)
9. Register backend provider in provider-registry
10. Update generation pipeline:
    - Detect ChatGPT provider → use backend provider
    - Progress message: "Generating with GPT Image 2 (this may take 2+ minutes)..."
    - Handle backend-specific errors (session expired, rate limited)
11. Add manifest network domains: `auth.openai.com`, backend URL configurable
12. End-to-end test: OAuth login → generate → verify Smart Object placed

## Backend URL Validation (RT1)

Backend URL must enforce HTTPS to prevent token / image leakage on shared networks. The only exception is loopback (developer machines).

```typescript
// src/auth/backend-url.ts
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export class InvalidBackendUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackendUrlError';
  }
}

/**
 * Throws InvalidBackendUrlError unless URL is:
 *  - well-formed
 *  - https://, OR http:// pointing at loopback (dev only)
 *  - no fragment, no userinfo
 */
export function validateBackendUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidBackendUrlError('Backend URL is not a valid URL.');
  }
  if (parsed.username || parsed.password) {
    throw new InvalidBackendUrlError('Backend URL must not contain credentials.');
  }
  if (parsed.hash) {
    throw new InvalidBackendUrlError('Backend URL must not contain a fragment.');
  }
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed;
  throw new InvalidBackendUrlError(
    `Backend URL must use https:// (got ${parsed.protocol}//${parsed.hostname}). ` +
    'http:// is only allowed for localhost / 127.0.0.1.'
  );
}
```

**Where it runs:**
- `settings-dialog.tsx` — on Save, call `validateBackendUrl(input)`. Display the error message inline; do not persist invalid URLs.
- `backend-provider.ts` — call once in the constructor as a defence-in-depth (catches URLs that bypassed UI validation, e.g. seeded from older settings).

## Backend Response Validation (RT9)

The backend is trusted but not infallible — a malformed upstream response, bug in the proxy, or middlebox that rewrites JSON could produce unexpected shapes. Validate before consumption to fail fast with a clean message instead of `Cannot read property 'b64_json' of undefined`.

```typescript
// src/providers/backend-response.ts
export class ProviderResponseError extends Error {
  constructor(message: string, public readonly payloadPreview?: string) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

interface ImageEditsItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface ImageEditsResponse {
  data: ImageEditsItem[];
}

export function assertImageEditsResponse(raw: unknown): ImageEditsResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProviderResponseError('Backend returned a non-object response.', preview(raw));
  }
  const data = (raw as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ProviderResponseError('Backend response missing "data" array.', preview(raw));
  }
  const first = data[0];
  if (typeof first !== 'object' || first === null) {
    throw new ProviderResponseError('Backend response data[0] is not an object.', preview(raw));
  }
  const item = first as ImageEditsItem;
  const hasB64 = typeof item.b64_json === 'string' && item.b64_json.length > 0;
  const hasUrl = typeof item.url === 'string' && item.url.length > 0;
  if (!hasB64 && !hasUrl) {
    throw new ProviderResponseError('Backend response data[0] missing both b64_json and url.', preview(raw));
  }
  return { data: data as ImageEditsItem[] };
}

function preview(raw: unknown): string {
  try {
    const s = JSON.stringify(raw);
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    return '<unserializable>';
  }
}
```

`backend-provider.ts` consumes the response only via `assertImageEditsResponse()`; downstream code can rely on `data[0].b64_json` or `data[0].url` being well-typed.

## OAuth Endpoints

| Action | Method | URL |
|--------|--------|-----|
| Start device auth | POST | `https://auth.openai.com/deviceauth/usercode` |
| Poll for token | POST | `https://auth.openai.com/deviceauth/token` |
| Refresh token | POST | `https://auth.openai.com/oauth/token` |
| Verification (user) | Browser | `https://auth.openai.com/codex/device` |

Request body for start:
```json
{
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
  "scope": "openid profile email offline_access",
  "audience": "https://api.openai.com/v1"
}
```

## Manifest Domains Update

```json
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
}
```

Note: This is the FULL domains list at Phase 9. Equals Phase 1 manifest domains + `http://localhost:8000` for backend dev. Backend is developer-managed (not user-facing); localhost:8000 for dev, VPS URL updated at build time for production. Plugin does NOT call chatgpt.com directly — backend handles that.

## Success Criteria

- [ ] Device code flow shows user_code and opens browser
- [ ] Polling detects successful authorization and stores tokens
- [ ] Token stored encrypted in secureStorage
- [ ] Connected status shows in Settings with expiry
- [ ] Disconnect clears tokens and shows disconnected
- [ ] Token auto-refreshes when near expiry
- [ ] `validateBackendUrl()` rejects `http://` for non-loopback hosts and accepts `http://localhost:8000`
- [ ] Settings dialog displays the validation error inline and refuses to persist a bad URL
- [ ] `assertImageEditsResponse()` throws `ProviderResponseError` on malformed payloads (missing data array, missing b64_json AND url, non-object)
- [ ] Backend provider sends request and receives b64_json
- [ ] 180s timeout handled without plugin crash
- [ ] Backend unreachable shows clear error message
- [ ] Full flow: login → select area → generate → Smart Object layer

## Risk Assessment

- auth.openai.com endpoints may change — keep URLs in config constants
- User must manually enable "Device code authorization for Codex" — document clearly
- Token refresh may fail silently — show "session expired, please sign in again"
- Backend URL `http://` outside localhost — blocked by `validateBackendUrl()` (RT1); MITM cannot trick plugin into sending APP_API_KEY or OAuth tokens over plaintext
- Backend response shape drift — `assertImageEditsResponse()` raises a clean `ProviderResponseError` instead of unguarded property access (RT9)
- UXP shell.openExternal requires manifest `launchProcess.schemes: ["https"]`
