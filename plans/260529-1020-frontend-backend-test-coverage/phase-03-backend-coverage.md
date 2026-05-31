---
phase: 3
title: Backend Coverage
status: completed
priority: P1
effort: 2h
dependencies:
  - 1
---

# Phase 3: Backend Coverage

## Overview

Extend the existing pytest suite with focused backend regressions where current coverage is weakest or most consequential.

## Requirements

- Keep tests offline and deterministic; no real ChatGPT or provider network calls.
- Reuse `backend/tests/conftest.py` fixtures and environment setup.
- Prefer route/provider behavior over implementation detail assertions.
- Cover at least one currently weak high-risk backend path.

## Architecture

Keep backend tests in `backend/tests/`, using pytest fixtures and monkeypatching already established by the suite. Avoid changing backend runtime code unless a real bug is exposed.

## Related Code Files

- Modify/Create: `backend/tests/test_*.py`
- Read: `backend/app/api/routes/images.py`
- Read: `backend/app/providers/chatgpt_web.py`
- Read: `backend/app/core/errors.py`

## Implementation Steps

1. Audit current backend tests for gaps around image route validation and ChatGPT provider helpers.
2. Add one or more pytest tests for uncovered behavior that is stable and offline.
3. Run targeted backend tests first.
4. Run the full backend test suite.

## Success Criteria

- [x] New backend test covers a meaningful route/provider edge case.
- [x] `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests` passes.
- [x] No secrets, live tokens, real sessions, or network calls are required.

## Validation Evidence

- Added oversized-mask upload route regression.
- Added ChatGPT SSE conversation-id parsing and stream-close regressions.
- `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests`: 71 passed, 1 existing Starlette `httpx` deprecation warning.
