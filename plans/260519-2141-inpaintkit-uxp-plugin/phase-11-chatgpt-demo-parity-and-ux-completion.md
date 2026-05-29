---
title: "Phase 11: ChatGPT Demo Parity and UX Completion"
sprint: 4
status: in-progress
priority: P1
effort: 8h
depends_on: [phase-09]
updated: 2026-05-29
---

# Phase 11: ChatGPT Demo Parity and UX Completion

## Context Links

- [plan.md](./plan.md) — Overview
- [phase-09-plugin-chatgpt-integration.md](./phase-09-plugin-chatgpt-integration.md) — Historical ChatGPT integration milestone
- [phase-10-distribution.md](./phase-10-distribution.md) — Packaging/distribution gate that stays blocked until this phase passes
- [video-ui-ux-analysis-260528-2319-gpt-image-2-photoshop-inpaintkit-demo-report.md](../reports/video-ui-ux-analysis-260528-2319-gpt-image-2-photoshop-inpaintkit-demo-report.md) — Demo target and UX gaps

## Overview

Keep Phase 9 as the historical integration milestone, but add this explicit follow-up phase for the gap between current implementation and the intended demo behavior. This phase is the parity gate before public packaging/distribution.

## Verified Gaps

- `gpt-image-2-chatgpt` is still `inpaint`-only in `src/providers/model-registry.ts`.
- `ChatGPTBackendProvider.generate()` is still unsupported in `src/providers/backend-provider.ts`.
- The panel does not expose an explicit `Generate` / `Inpaint` mode switch; behavior changes implicitly from model capability.
- Progress UX still collapses rich pipeline stages into a single spinner + message.
- `PlacementError` already caches bytes for retry, but the UI does not surface recovery actions.

## Requirements

**Functional:**
- ChatGPT path supports full-canvas generate behavior matching the demo goal.
- `gpt-image-2-chatgpt` exposes both `generate` and `inpaint` capabilities, or an equivalent documented contract that preserves the same user-facing behavior.
- Main panel exposes an explicit `Generate` / `Inpaint` choice instead of silently inferring the mode.
- Progress UI shows stage-aware feedback for long GPT Image 2 runs.
- Placement failure exposes a user-facing retry/recovery action without re-running a paid generation.
- ChatGPT login/settings copy makes the Device Code + Security Settings requirement explicit.

**Non-functional:**
- No regressions to fal.ai / Replicate flows.
- `npm run typecheck` passes.
- `npm run build` passes.
- Manual verification covers both blank-canvas generate and selection-based inpaint for the ChatGPT path.

## Related Code Files

**Modify:**
- `src/App.tsx`
- `src/components/main-dialog.tsx`
- `src/components/progress-dialog.tsx`
- `src/components/settings-dialog.tsx`
- `src/components/chatgpt-login-modal.tsx`
- `src/providers/model-registry.ts`
- `src/providers/backend-provider.ts`
- `src/services/generation-service.ts`

**Possible follow-up backend touchpoint:**
- `plans/260519-2141-inpaintkit-uxp-plugin/phase-08-backend-chatgpt-provider.md` contract notes, if the backend generate surface must be clarified.

## Implementation Steps

1. Enable ChatGPT full-canvas generate path.
   - Decide the concrete contract for blank-canvas generation.
   - Implement provider + registry wiring so the plugin can trigger it predictably.

2. Make mode selection explicit in the panel.
   - Add a visible `Generate` / `Inpaint` choice.
   - Keep model availability/capability checks aligned with the selected mode.

3. Upgrade progress UX.
   - Surface stage-aware progress (`preparing`, `uploading`, `generating`, `placing`).
   - Keep GPT Image 2 slow-path messaging explicit.

4. Surface retry/recovery actions.
   - Use cached placement bytes from `PlacementError`.
   - Add a user path for retrying placement without re-running generation.

5. Tighten ChatGPT auth UX copy.
   - Clarify Device Code flow prerequisites.
   - Add clearer recovery copy for the Security Settings toggle requirement.

6. Validate demo parity.
   - Typecheck + build.
   - Manual test: blank canvas generate.
   - Manual test: selection inpaint.

## Todo List

- [x] Add ChatGPT full-canvas generate support
- [x] Make `Generate` / `Inpaint` mode explicit in the panel
- [x] Upgrade progress UI to show stage-aware feedback
- [x] Expose placement retry/recovery actions in the UI
- [x] Improve ChatGPT login/settings guidance copy
- [x] Re-run typecheck and build
- [ ] Manually verify blank-canvas generate + selection inpaint demo flows

## Success Criteria

- [ ] ChatGPT full-canvas generate works from the plugin UI
- [ ] ChatGPT selection-based inpaint still works after the change
- [x] User can explicitly choose `Generate` vs `Inpaint`
- [x] Progress UI exposes more than a single spinner/message
- [x] Placement failure offers a visible retry/recovery path
- [x] Login/settings UI explains the Device Code + Security Settings prerequisite
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [ ] Manual demo script passes for both target flows

## Validation Notes

- Automated validation passed: `npm run typecheck`, `npm run build`, and `PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests` (`65 passed`, with one existing Starlette `httpx` deprecation warning).
- Code review and UI/UX re-review found no remaining blocker, high, or medium issues after recovery/progress copy fixes.
- Manual Photoshop UXP verification for blank-canvas ChatGPT generate and selection-based ChatGPT inpaint is still pending because this Linux session cannot run Photoshop/UDT.

## Risk Assessment

- Full-canvas ChatGPT generate may require a small backend contract extension; keep the plugin-side plan flexible but user-facing behavior fixed.
- The new mode switch can regress existing fal.ai / Replicate flows if capability filtering is not kept consistent.
- Progress/recovery UX can sprawl; keep this phase focused on demo parity, not broader history/variation features.

## Next Steps

- Phase 10 stays pending and blocked by this parity phase.
- Distribution only starts after demo-parity acceptance is verified.