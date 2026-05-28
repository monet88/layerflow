---
phase: 3
title: Prepare Commit Readiness
status: completed
priority: P1
effort: 45m
dependencies:
  - 1
  - 2
---

# Phase 3: Prepare Commit Readiness

## Context Links

- Git branch: `fix/phase-8-code-review-findings`
- Validation command policy: run relevant checks before commit; do not bypass hooks.
- Existing Phase 8 commits: `946e92f`, `b9b6035`, `0e241e3`

## Overview

Prepare a clean commit boundary from the audited dirty worktree. The commit should include only intentional changes and should not mix scratch artifacts with roadmap or security-related updates unless the user approves.

## Requirements

- Functional: select files for staging, draft commit message, and identify validation commands.
- Non-functional: do not commit unless the user explicitly asks; never use `--no-verify`.

## Architecture

This phase converts the audit into a safe git action plan. It separates commit candidates into coherent focused groups for split commits.

## Related Code Files

- Candidate docs/plans: `docs/*.md`, `plans/**/*.md`
- Candidate skills: `.agents/skills/**/*.md`, `skills-lock.json`
- Candidate backend/test/script changes: `backend/tests/conftest.py`, `scripts/hello_world/api_client.py`
- Candidate exclusions: `backend/scratch/` until explicitly approved

## Implementation Steps

1. Review Phase 1 dispositions and split commit candidates by concern.
2. Keep `backend/scratch/` out of commit candidates unless the user explicitly changes that decision.
3. Run security scan by inspection for secrets in candidate files.
4. Run validation relevant to included code changes:
   - frontend/plugin changes: `npm run typecheck` and `npm run build`
   - backend Python changes: project-specific pytest command if configured
   - docs-only changes: no build required unless linked tooling demands it
5. Draft conventional commit messages for each commit group.
6. If user asks to commit, stage explicit paths only and create new commits.

## Commit Readiness Findings

| Candidate group | Paths | Decision |
|-----------------|-------|----------|
| New cleanup plan | `plans/260528-1400-GH-8-branch-cleanup-and-inpaintkit-resume/` | Safe candidate for a docs/plan commit. |
| Existing tracked files | `.agents/skills/**`, `backend/tests/conftest.py`, `docs/**`, `plans/260519-2141-inpaintkit-uxp-plugin/**`, `plans/reports/**`, `scripts/hello_world/api_client.py`, `skills-lock.json` | Exclude for now; changes are whitespace/EOL-only and `git diff --check` reports trailing whitespace at scale. |
| Scratch | `backend/scratch/` | Exclude by validated decision. |

Validation performed:
- `git diff --check` reports trailing whitespace in tracked whitespace/EOL-only files, so those should not be committed as-is.
- New plan files have no trailing whitespace.
- Secret scan on new plan files found only policy text mentioning secrets, not credentials.

Suggested commit if user approves later:

```text
docs: add branch cleanup and roadmap resume plan
```

## Todo List

- [x] Decide whether to split docs/plans, skills, and backend changes into separate commits.
- [x] Keep `backend/scratch/` excluded from commit candidates.
- [x] Run relevant validation checks for selected files.
- [x] Draft commit message.
- [x] Ask user before committing.

## Success Criteria

- [x] Commit candidate set is explicit.
- [x] Validation commands and results are documented.
- [x] No accidental secrets or scratch files are included.
- [x] Commit happens only after explicit approval.

## Risk Assessment

The dirty set spans multiple concerns. Mitigate by preferring focused commits or asking before combining unrelated changes.

## Security Considerations

Do not stage `.env`, credentials, scratch output, generated tokens, or API keys. Inspect scripts and scratch files carefully.

## Next Steps

Proceed to Phase 4 after the branch has a clean or intentionally dirty state.
