---
name: phase-based-feature-development
description: Workflow command scaffold for phase-based-feature-development in layerflow.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /phase-based-feature-development

Use this workflow when working on **phase-based-feature-development** in `layerflow`.

## Goal

Implements a new feature or architectural layer as a project phase, updating both plans and corresponding code modules.

## Common Files

- `plans/260519-2141-inpaintkit-uxp-plugin/phase-*.md`
- `plans/260519-2141-inpaintkit-uxp-plugin/plan.md`
- `src/**/*`
- `backend/**/*`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update phase plan markdown in plans/phase-XX-*.md
- Update the main plan.md to reflect phase progress
- Implement or modify code files in src/ or backend/ relevant to the phase
- Update or add types, services, or components as needed

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.