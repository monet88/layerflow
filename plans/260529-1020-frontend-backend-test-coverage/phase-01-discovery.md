---
phase: 1
title: Discovery
status: completed
priority: P1
effort: 1h
dependencies: []
---

# Phase 1: Discovery

## Overview

Confirm current test infrastructure and choose the smallest useful coverage surface before editing code.

## Requirements

- Identify existing backend tests and commands.
- Identify missing frontend test runner/configuration.
- Use GitNexus and local file evidence before changing symbols.
- Prefer tests around pure helpers and stable contracts before UXP host-dependent workflows.

## Architecture

No runtime architecture changes. Discovery feeds the frontend Vitest setup and backend pytest additions.

## Related Code Files

- Read: `package.json`, `vite.config.mts`, `tsconfig.json`
- Read: `backend/pytest.ini`, `backend/requirements-dev.txt`, `backend/tests/*`
- Read: `src/services/image-processing.ts`, `src/providers/model-registry.ts`, selected UI components

## Implementation Steps

1. Inspect project scripts, existing pytest config, and current plan state.
2. Use Context7 docs for current Vitest/React Testing Library/pytest setup conventions.
3. Use TokenSave/GitNexus to identify high-risk untested symbols.
4. Pick test files that avoid Photoshop/UXP host requirements.

## Success Criteria

- [x] Existing backend tests and command are identified.
- [x] Missing frontend test runner/config is identified.
- [x] High-value frontend/backend targets are selected.
- [x] GitNexus impact checks are run before code edits.
