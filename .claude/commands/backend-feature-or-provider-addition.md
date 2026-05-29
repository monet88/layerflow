---
name: backend-feature-or-provider-addition
description: Workflow command scaffold for backend-feature-or-provider-addition in layerflow.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /backend-feature-or-provider-addition

Use this workflow when working on **backend-feature-or-provider-addition** in `layerflow`.

## Goal

Adds or extends a backend provider, API route, or core backend feature, with corresponding tests and documentation.

## Common Files

- `backend/app/providers/*.py`
- `backend/app/services/*.py`
- `backend/app/api/routes/*.py`
- `backend/main.py`
- `backend/docker-compose.yml`
- `backend/tests/*.py`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or modify provider/service modules in backend/app/providers/ or backend/app/services/
- Update or add API route files in backend/app/api/routes/
- Update backend/main.py or backend/docker-compose.yml if needed
- Add or update tests in backend/tests/
- Update backend/README.md and requirements

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.