---
phase: 2
title: Frontend Test Harness
status: completed
priority: P1
effort: 3h
dependencies:
  - 1
---

# Phase 2: Frontend Test Harness

## Overview

Add a Vitest-based frontend test harness that works with Vite, TypeScript strict mode, React 18, and custom Spectrum Web Component tags in jsdom.

## Requirements

- Add frontend test scripts to `package.json`.
- Add test dependencies only where needed: Vitest, jsdom, React Testing Library, jest-dom, and user-event.
- Configure Vitest without weakening existing Vite UXP build behavior.
- Add deterministic tests for pure helpers/contracts and a component-level UI behavior.

## Architecture

Use a separate `vitest.config.ts` or compatible Vite config extension so the UXP production build remains owned by `vite.config.mts`. Use `src/test/setup.ts` for shared DOM assertions and custom-element compatibility shims if needed.

## Related Code Files

- Modify: `package.json`, `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/services/image-processing.test.ts`
- Create: `src/providers/model-registry.test.ts`
- Create: one focused `src/components/*.test.tsx`

## Implementation Steps

1. Install test dependencies and add `test`, `test:watch`, and optional `test:coverage` scripts.
2. Configure jsdom, globals, and setup files for Vitest.
3. Add pure unit tests for image-processing output-format/mask behavior.
4. Add model-registry tests that lock ChatGPT generate/inpaint capabilities and endpoint resolution.
5. Add a React Testing Library test for a stable component behavior using accessible/user-visible queries where possible.

## Success Criteria

- [x] `npm test -- --run` runs under jsdom and passes.
- [x] Frontend test files compile under strict TypeScript.
- [x] Tests do not import Photoshop/UXP host modules directly.
- [x] Existing `npm run typecheck` and `npm run build` remain green.

## Validation Evidence

- `npm test -- --run`: 3 files, 9 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
