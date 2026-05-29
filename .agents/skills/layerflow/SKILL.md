```markdown
# layerflow Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns, coding conventions, and workflow automation used in the `layerflow` repository. The codebase is primarily Python for backend logic and React for frontend UI, with a strong emphasis on phase-based planning, modular feature development, and security hardening. The repository employs conventional commits, structured planning documents, and a set of repeatable workflows for backend, documentation, and security tasks.

## Coding Conventions

**File Naming**
- Use `camelCase` for file names.
  - Example: `imageProcessor.py`, `userProfile.tsx`

**Import Style**
- Use relative imports within modules.
  - Example (Python):
    ```python
    from .utils import process_image
    ```
  - Example (TypeScript/React):
    ```typescript
    import { fetchData } from './apiService';
    ```

**Export Style**
- Use named exports for modules and components.
  - Example (TypeScript/React):
    ```typescript
    export function ImageUploader() { ... }
    ```

**Commit Messages**
- Follow [Conventional Commits](https://www.conventionalcommits.org/) with these prefixes:
  - `feat`: New features
  - `fix`: Bug fixes
  - `docs`: Documentation changes
  - `sec`: Security improvements
  - `chore`: Maintenance and tooling
- Average commit message length: ~87 characters
  - Example: `feat: add new provider for image inpainting with async support`

---

## Workflows

### Phase-Based Feature Development
**Trigger:** When starting a new planned phase or major feature (e.g., UI, provider, backend module).  
**Command:** `/start-phase`

1. Add or update phase plan markdown in `plans/phase-XX-*.md`.
2. Update the main `plan.md` to reflect phase progress.
3. Implement or modify code files in `src/` or `backend/` relevant to the phase.
4. Update or add types, services, or components as needed.

**Example:**
```bash
# Add a new phase plan
touch plans/260519-2141-inpaintkit-uxp-plugin/phase-03-new-feature.md

# Update main plan
vim plans/260519-2141-inpaintkit-uxp-plugin/plan.md

# Implement feature in src/
vim src/newFeature.tsx
```

---

### Backend Feature or Provider Addition
**Trigger:** When implementing a new backend provider, API endpoint, or major backend capability.  
**Command:** `/add-backend-provider`

1. Add or modify provider/service modules in `backend/app/providers/` or `backend/app/services/`.
2. Update or add API route files in `backend/app/api/routes/`.
3. Update `backend/main.py` or `backend/docker-compose.yml` if needed.
4. Add or update tests in `backend/tests/`.
5. Update `backend/README.md` and requirements files.

**Example:**
```python
# backend/app/providers/imageInpaintProvider.py
from .baseProvider import BaseProvider

class ImageInpaintProvider(BaseProvider):
    ...
```
```python
# backend/app/api/routes/inpaint.py
from fastapi import APIRouter

router = APIRouter()

@router.post("/inpaint")
def inpaint_endpoint(...):
    ...
```

---

### Security and Code Review Hardening
**Trigger:** When a code review or security audit identifies issues to be fixed.  
**Command:** `/harden-backend`

1. Modify backend modules to fix security/resource issues (e.g., SSRF, leaks, race conditions).
2. Update or add tests to verify fixes (often `test_leak_prevention.py`).
3. Document findings or deferred issues in `plans/phase-XX-*.md` or `README`.

**Example:**
```python
# backend/app/core/security.py
def sanitize_url(url: str) -> str:
    # Prevent SSRF by validating the URL
    ...
```
```python
# backend/tests/test_leak_prevention.py
def test_no_resource_leak():
    ...
```

---

### Plan and Phase Documentation Update
**Trigger:** When a phase is completed or planning needs to be updated with new status, carry-overs, or reports.  
**Command:** `/update-phase-docs`

1. Mark phase as complete or update status in `plans/phase-XX-*.md`.
2. Update main `plan.md` with new phase statuses or carry-overs.
3. Add or update reports in `plans/reports/`.

**Example:**
```markdown
# plans/260519-2141-inpaintkit-uxp-plugin/phase-03-new-feature.md
## Status: Complete

- [x] Implemented new inpainting UI
- [x] Integrated backend provider
```

---

## Testing Patterns

- **Test Framework:** Unknown (likely Python `pytest` for backend, Jest for frontend)
- **Test File Pattern:** `*.test.ts` for frontend (React/TypeScript)
  - Example:
    ```typescript
    // src/components/imageUploader.test.ts
    import { render } from '@testing-library/react';
    import { ImageUploader } from './imageUploader';

    test('renders upload button', () => {
      const { getByText } = render(<ImageUploader />);
      expect(getByText(/upload/i)).toBeInTheDocument();
    });
    ```
- **Backend Tests:** Located in `backend/tests/*.py`

---

## Commands

| Command              | Purpose                                                       |
|----------------------|---------------------------------------------------------------|
| /start-phase         | Begin a new planned phase or major feature                    |
| /add-backend-provider| Add or extend a backend provider, API route, or core feature  |
| /harden-backend      | Address security/code review issues and harden backend        |
| /update-phase-docs   | Update planning documents, phase statuses, or add reports     |
```
