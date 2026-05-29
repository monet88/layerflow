---
title: Frontend and Backend Test Coverage
description: >-
  Add automated tests for the React UXP frontend and Python FastAPI backend
  without changing runtime behavior.
status: completed
priority: P2
branch: feature/phase-11-chatgpt-demo-parity
tags:
  - tests
  - vitest
  - react
  - pytest
  - fastapi
blockedBy: []
blocks: []
created: '2026-05-29T03:20:46.170Z'
createdBy: 'ck:plan'
source: skill
---

# Frontend and Backend Test Coverage

## Overview

Add a repeatable automated test lane for both sides of InpaintKit:

- Frontend: introduce a Vite-native Vitest harness for pure TypeScript helpers and React/Spectrum Web Components that can run under jsdom.
- Backend: build on the existing pytest suite for FastAPI routes, provider error mapping, upload security, leak prevention, and concurrency.

This plan is related to the active InpaintKit Phase 11 validation work. It has no blocking dependency because test coverage can be added independently of the remaining Photoshop/UDT manual demo verification.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Discovery](./phase-01-discovery.md) | Completed |
| 2 | [Frontend Test Harness](./phase-02-frontend-test-harness.md) | Completed |
| 3 | [Backend Coverage](./phase-03-backend-coverage.md) | Completed |
| 4 | [Validation](./phase-04-validation.md) | Completed |

## Dependencies

- Related plan: `plans/260519-2141-inpaintkit-uxp-plugin/plan.md`.
- Backend test lane: `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests`.
- Frontend test lane added by this plan: `npm test -- --run`.

## Success Criteria

- [x] `npm test -- --run` or equivalent frontend test script passes.
- [x] Frontend tests cover at least one pure service/helper module, one provider/model contract, and one user-visible React component.
- [x] Backend pytest suite still passes and includes at least one new high-value regression test for uncovered backend behavior.
- [x] `npm run typecheck`, `npm run build`, and `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests` pass.
- [x] Test commands are documented in `package.json` and existing backend docs remain accurate.

## Validation Evidence

- `npm test -- --run`: 3 files, 9 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests`: 71 passed, 1 existing Starlette `httpx` deprecation warning.
- GitNexus detect changes: low risk, 0 affected processes.
