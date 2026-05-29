---
title: "Phase 10: Distribution and Packaging"
sprint: 4
status: pending
priority: P2
effort: 3h
depends_on: [phase-09, phase-11]
---

# Phase 10: Distribution and Packaging

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-uxp-report.md](../reports/researcher-uxp-report.md) — UXP distribution section

## Overview

Package the plugin as .ccx for distribution and the backend as a Docker image after the ChatGPT demo-parity phase passes. Write user-facing documentation covering both plugin installation and backend setup.

## Requirements

**Functional:**
- Plugin packaged as .ccx (ZIP format via UXP Developer Tool)
- Backend Docker image ready for Docker Hub or self-host
- README for plugin (install, configure, usage)
- README for backend (Docker Compose setup, env vars, VPS deploy)
- About dialog in plugin (version, links)
- Keyboard shortcuts (generate: Ctrl+Enter, cancel: Escape)

**Non-functional:**
- Plugin bundle < 500KB
- Backend Docker image < 200MB
- No secrets in distributed packages
- Works on macOS and Windows (plugin)
- Works on any Linux VPS (backend)

**Production hardening (backend, public-facing deploy):**
- Rate limiting on `/auth/chatgpt/session` and `/v1/images/edits` (`slowapi` or reverse-proxy level)
- TLS termination via Caddy/Nginx in front of backend (never expose port 8000 raw)
- Secret store: `ENCRYPTION_KEY` and `APP_API_KEY` injected via Docker secrets / env from a vault, NOT committed `.env`
- SQLite volume permissions: `chmod 600`, host-side encryption-at-rest if compliance requires
- Log shipping: structured JSON logs to stdout for collection (Loki / Datadog / CloudWatch)
- Health endpoint: keep `/health` unauthenticated but document that it leaks "service is up"; add `/health/deep` (auth-gated) if DB/upstream checks needed
- `X-User-Id` format validation: regex `^[a-zA-Z0-9_\-]{1,64}$` to prevent traversal in any future log/file output
- Dev deps stripped from Docker image (split `requirements.txt` runtime vs `requirements-dev.txt`)
- Upload size pre-check via `Content-Length` / `UploadFile.size` BEFORE buffering the body

## Implementation Steps

1. Plugin packaging:
   - Production build: `vite build` (minified, no sourcemaps)
   - Verify manifest.json has correct plugin ID, version, icons
   - Package via UXP Developer Tool → .ccx file
   - Test install from .ccx on clean Photoshop

2. Backend packaging:
   - Multi-stage Dockerfile (slim Python image)
   - docker-compose.yml with volume mounts, health check
   - .env.example with placeholder values
   - Test: `docker compose up --build` from scratch

3. Plugin README:
   - System requirements (Photoshop 24+)
   - Installation steps (.ccx install via Creative Cloud)
   - Provider setup guides (fal.ai API key, Replicate, ChatGPT)
   - Usage walkthrough with screenshots
   - Troubleshooting (common errors)

4. Backend README:
   - What it does and doesn't do
   - Docker Compose quickstart
   - Environment variables reference
   - curl examples for all endpoints
   - VPS deployment notes (HTTPS, persistence, Caddy/Nginx)
   - Security notes (per-user only, no account pool)

5. About dialog:
   - Plugin version
   - Link to documentation
   - Link to support/feedback
   - Built by credit

6. Keyboard shortcuts:
   - Register Ctrl+Enter / Cmd+Enter → trigger generate
   - Escape → cancel generation
   - Register via UXP keyboard shortcut API

7. PS version testing:
   - Test on Photoshop 24.x (baseline)
   - Test on Photoshop 25.x (imaging.getSelection available)
   - Test on Photoshop 26.x (latest, verify no regressions)

## Success Criteria

- [ ] .ccx installs cleanly on fresh Photoshop
- [ ] Plugin appears in Plugins menu after install
- [ ] `docker compose up --build` starts backend from scratch
- [ ] All keyboard shortcuts work
- [ ] About dialog shows correct version and links
- [ ] READMEs contain working curl/usage examples
- [ ] Plugin works on PS 24, 25, 26 (macOS or Windows)
- [ ] No secrets in any distributed file
- [ ] Production hardening checklist (public deploy only):
  - [ ] Rate limit configured on auth + image-edit endpoints
  - [ ] TLS via reverse proxy; backend not exposed directly
  - [ ] Secrets injected from vault / Docker secrets, not committed `.env`
  - [ ] SQLite volume permissions locked (`chmod 600`)
  - [ ] `X-User-Id` regex validation in `app/api/deps.py`
  - [ ] Production Docker image excludes pytest / dev deps
  - [ ] Upload size pre-checked before buffering body

## Risk Assessment

- Adobe Marketplace review may require changes — distribute direct first
- Plugin ID must be registered on Adobe Developer Console for marketplace
- PS 24.x lacks some APIs — verify graceful degradation documented
- Docker Hub publishing requires account — use GitHub Container Registry as alternative
