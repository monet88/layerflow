---
phase: 1
title: Audit Dirty Worktree
status: completed
priority: P1
effort: 30m
dependencies: []
---

# Phase 1: Audit Dirty Worktree

## Context Links

- Branch: `fix/phase-8-code-review-findings`
- Existing roadmap: `plans/260519-2141-inpaintkit-uxp-plugin/plan.md`
- Reports path: `plans/reports/`

## Overview

Classify every modified and untracked path before deciding what belongs in the next commit. The goal is to protect user work and avoid mixing unrelated skill/doc/backend scratch changes.

## Requirements

- Functional: produce a file-by-file grouping with intended disposition: keep, review further, exclude, or ask user.
- Non-functional: read-only commands only; no staging, deletion, checkout, reset, or formatting.

## Architecture

This phase is a git hygiene pass. It uses `git status`, `git diff --stat`, and targeted diffs to identify whether files are related to Phase 8 security cleanup, roadmap maintenance, skill updates, or temporary scratch work.

## Related Code Files

- Review: `.agents/skills/fal-image-edit/SKILL.md`
- Review: `.agents/skills/fastapi-python/SKILL.md`
- Review: `.agents/skills/replicate/SKILL.md`
- Review: `backend/tests/conftest.py`
- Review: `scripts/hello_world/api_client.py`
- Review: `skills-lock.json`
- Review: `backend/scratch/`
- Review: `docs/*.md`
- Review: `plans/260519-2141-inpaintkit-uxp-plugin/*.md`
- Review: `plans/reports/*.md`

## Implementation Steps

1. Run `git status --short --branch` to capture the current dirty set.
2. Run `git diff --stat` to estimate size and risk by file.
3. Inspect diffs by category, not as one huge diff:
   - plan/docs updates
   - skill definitions and lockfile
   - backend tests/config
   - scripts and scratch files
4. Flag secrets or credentials immediately if any diff shows tokens, keys, URLs with embedded credentials, or local environment paths.
5. Create a concise disposition list for Phase 3 commit preparation.

## Audit Findings

| Group | Paths | Disposition |
|-------|-------|-------------|
| Existing docs/plans | `docs/*.md`, `plans/260519-2141-inpaintkit-uxp-plugin/*.md`, `plans/reports/*.md` | Review before staging; tracked diff is whitespace/EOL-only. |
| New cleanup plan | `plans/260528-1400-GH-8-branch-cleanup-and-inpaintkit-resume/` | Keep; created by this workflow. |
| Skills | `.agents/skills/*.md`, `skills-lock.json` | Review before staging; tracked diff is whitespace/EOL-only. |
| Backend test config | `backend/tests/conftest.py` | Review before staging; tracked diff is whitespace/EOL-only. |
| Script | `scripts/hello_world/api_client.py` | Review before staging; tracked diff is whitespace/EOL-only. |
| Scratch | `backend/scratch/` | Exclude from commit by default. Contains `main_diff.txt`, `test_startup.py`, and `__pycache__/test_startup.cpython-313.pyc`. |

`git diff --ignore-space-at-eol --stat` and `git diff -w --stat` produced no output, so all tracked dirty files appear to be line-ending/whitespace normalization only. Secret-pattern scan found documentation placeholders and test-only strings, not real credentials in tracked diffs.

## Todo List

- [x] Capture current dirty file list.
- [x] Group files by intent and risk.
- [x] Identify unrelated or accidental files.
- [x] Identify files requiring user confirmation before staging.

## Success Criteria

- [x] Every dirty path has a disposition.
- [x] Untracked `backend/scratch/` is classified but excluded from commit by default.
- [x] No destructive git operation was used.

## Risk Assessment

Primary risk is accidentally committing scratch data or unrelated skill changes. Mitigate by staging only explicit file paths after user approval and excluding `backend/scratch/` unless the user reverses that decision.

## Security Considerations

Scratch directories and API client scripts may contain credentials or local endpoints. Treat them as high-risk until inspected.

## Next Steps

Proceed to Phase 2 after file classification is complete.
