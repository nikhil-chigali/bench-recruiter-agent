# Candidates Chunk 2.5 — Shared Types Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the frontend's backend-request/response types from the backend's OpenAPI schema instead of hand-declaring them, so a backend contract change surfaces as a frontend type error.

**Architecture:** The backend emits its OpenAPI schema to a committed `backend/openapi.json` (a pytest guard fails the fast suite if it drifts from the code). A pnpm workspace adds a `@callup/shared-types` package whose types are generated from that JSON by `openapi-typescript` (committed `openapi.d.ts`), guarded against drift by a frontend CI step. Chunk 2's local `CandidateCard` type is then deleted and re-sourced from the generated schema as the first consumer — proving the whole pipeline end-to-end.

**Tech Stack:** Backend — FastAPI (`app.openapi()`), `uv`, pytest. Frontend — pnpm workspaces, `openapi-typescript`, TypeScript (strict, bundler resolution), Vite. CI — GitHub Actions.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`. The frontend drift check is therefore a **CI step**, not a test.
- Backend fast suite (`uv run pytest -m "not integration"`) must stay green and hit no network/DB. Format Python with `uv run black`.
- **Minimum release age: 7 days** (`frontend/.npmrc` `minimum-release-age=10080`). `openapi-typescript` is well older than that, so a normal `pnpm add -D` works; justify the dependency in the commit message per the root dependency policy (it is the declared mechanism — `frontend/CLAUDE.md` already says "Shared request/response types come from `packages/shared-types` (generated from the backend's OpenAPI schema)").
- TypeScript **strict, no `any`**; use `import type` for type-only imports (`verbatimModuleSyntax` is on). The app keeps the `@/*` alias for app-internal modules; the generated package is imported by its package name `@callup/shared-types`.
- The committed generated artifacts (`backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`) are **pinned to LF** via `.gitattributes` because this repo runs `core.autocrlf=true` on Windows while CI is Linux — without pinning, the byte-for-byte drift checks false-positive across platforms.
- `backend/openapi.json` is a **public API contract** — no secrets appear in it. Safe to commit.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/openapi_export.py` | render `app.openapi()` to deterministic JSON bytes; `__main__` writes the committed file | Create |
| `backend/openapi.json` | committed OpenAPI contract (generated) | Create (generated) |
| `backend/tests/test_openapi_export.py` | fast-suite guard: schema has the contract + committed file is up to date | Create |
| `.gitattributes` (repo root) | pin generated artifacts to LF | Create, then append in Task 2 |
| `frontend/pnpm-workspace.yaml` | declare the `packages/*` workspace | Create |
| `frontend/packages/shared-types/package.json` | the `@callup/shared-types` package manifest (types-only, no build) | Create |
| `frontend/packages/shared-types/index.ts` | curated public surface re-exporting the generated namespaces | Create (Task 2), extend (Task 3) |
| `frontend/packages/shared-types/openapi.d.ts` | generated types (committed) | Create (generated) |
| `frontend/package.json` | add `gen:types` script + `openapi-typescript` devDep + `@callup/shared-types` dep | Modify |
| `frontend/pnpm-lock.yaml` | updated by `pnpm install` | Modify (generated) |
| `frontend/eslint.config.js` | ignore the generated `openapi.d.ts` | Modify |
| `frontend/Dockerfile` | copy workspace manifests into the dep layer | Modify |
| `.github/workflows/frontend-ci.yml` | add the types drift check step | Modify |
| `frontend/src/lib/candidates.ts` | delete (its type moves to the package) | Delete (Task 3) |
| `frontend/src/components/CandidateCard.tsx` | import `CandidateCard` from `@callup/shared-types` | Modify (Task 3) |
| `frontend/src/pages/Candidates.tsx` | import `CandidateCard` from `@callup/shared-types` | Modify (Task 3) |

---

## Task 1: Backend emits a committed OpenAPI contract with a drift guard

**Files:**
- Create: `backend/src/callup/openapi_export.py`
- Create: `backend/tests/test_openapi_export.py`
- Create: `backend/openapi.json` (generated)
- Create: `.gitattributes` (repo root)

**Interfaces:**
- Produces: `openapi_bytes() -> bytes` — the app's OpenAPI schema as deterministic UTF-8 JSON (2-space indent, sorted keys, trailing `\n`).
- Produces: `OPENAPI_PATH: pathlib.Path` — absolute path to `backend/openapi.json`, resolved from the module location (cwd-independent).
- Produces: `write_openapi() -> None` — writes `openapi_bytes()` to `OPENAPI_PATH` in binary (no newline translation).
- Produces: the committed `backend/openapi.json` that Task 2's `gen:types` reads via `../backend/openapi.json`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_openapi_export.py`:

```python
from callup.openapi_export import OPENAPI_PATH, openapi_bytes


def test_openapi_includes_candidates_contract():
    text = openapi_bytes().decode("utf-8")
    assert '"/candidates"' in text
    assert '"CandidateCard"' in text


def test_committed_openapi_is_up_to_date():
    # Reads bytes (no newline translation) so the check is identical on Windows and Linux CI.
    committed = OPENAPI_PATH.read_bytes()
    assert committed == openapi_bytes(), (
        "backend/openapi.json is stale — regenerate with "
        "`uv run python -m callup.openapi_export`"
    )
```

- [ ] **Step 2: Run the tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/test_openapi_export.py -v
```
Expected: collection/import error — `ModuleNotFoundError: No module named 'callup.openapi_export'`.

- [ ] **Step 3: Implement the export module**

Create `backend/src/callup/openapi_export.py`:

```python
"""Emit the backend's OpenAPI schema to a committed file the frontend generates types from.

Run ``uv run python -m callup.openapi_export`` to rewrite ``backend/openapi.json``. The fast
suite's ``test_committed_openapi_is_up_to_date`` (and therefore CI) fails if the committed file
drifts from the code, so the contract the frontend types are generated from always matches the API.
"""

import json
from pathlib import Path
from typing import Any

from callup.main import app

# backend/src/callup/openapi_export.py -> parents[2] == backend/
OPENAPI_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def openapi_bytes() -> bytes:
    """The app's OpenAPI schema as deterministic UTF-8 JSON (sorted keys, trailing newline)."""
    schema: dict[str, Any] = app.openapi()
    return (json.dumps(schema, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_openapi() -> None:
    OPENAPI_PATH.write_bytes(openapi_bytes())


if __name__ == "__main__":
    write_openapi()
    print(f"wrote {OPENAPI_PATH}")
```

- [ ] **Step 4: Run the tests to confirm the contract test passes and the drift test still fails**

From `backend/`:
```bash
uv run pytest tests/test_openapi_export.py -v
```
Expected: `test_openapi_includes_candidates_contract` PASSES; `test_committed_openapi_is_up_to_date` FAILS with `FileNotFoundError` (the committed `openapi.json` doesn't exist yet). This is the expected RED for the drift guard.

- [ ] **Step 5: Pin the generated contract to LF before it is created**

Create `.gitattributes` at the **repo root** (`C:\Users\nikhi\Documents\Projects\bench-recruiter-agent\.gitattributes`):

```gitattributes
# Generated API contract — pin to LF so the byte-for-byte drift checks match on
# Windows (core.autocrlf=true) and Linux CI alike.
backend/openapi.json text eol=lf
```

Creating this **before** the first `git add` of `openapi.json` ensures git stores and checks it out as LF on every platform.

- [ ] **Step 6: Generate the committed contract**

From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`, and `backend/openapi.json` now exists (a JSON object with `"openapi"`, `"paths"` including `"/candidates"`, and `"components"."schemas"."CandidateCard"`).

- [ ] **Step 7: Run the tests to verify both pass**

From `backend/`:
```bash
uv run pytest tests/test_openapi_export.py -v
```
Expected: 2 passed.

- [ ] **Step 8: Run the fast suite and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass (the existing suite plus the 2 new tests); black reports no changes (or reformats only the two new files — re-run to confirm clean).

- [ ] **Step 9: Commit**

From the repo root (add files explicitly — never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add .gitattributes backend/src/callup/openapi_export.py backend/tests/test_openapi_export.py backend/openapi.json
git commit -m "Emit committed OpenAPI contract with a fast-suite drift guard"
```

Note: no `.github/workflows/backend-ci.yml` change is needed — backend CI already runs `uv run pytest -m "not integration"`, which now includes the drift guard.

---

## Task 2: pnpm workspace + `@callup/shared-types` generator (pipeline, unconsumed)

**Files:**
- Create: `frontend/pnpm-workspace.yaml`
- Create: `frontend/packages/shared-types/package.json`
- Create: `frontend/packages/shared-types/index.ts`
- Create: `frontend/packages/shared-types/openapi.d.ts` (generated)
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml` (via `pnpm install`)
- Modify: `frontend/eslint.config.js`
- Modify: `frontend/Dockerfile`
- Modify: `.gitattributes` (repo root)
- Modify: `.github/workflows/frontend-ci.yml`

**Interfaces:**
- Consumes: `backend/openapi.json` (Task 1) via the relative path `../backend/openapi.json`.
- Produces: the package `@callup/shared-types`, importable from app code, whose `index.ts` re-exports the generated `components`/`paths`/`operations` type namespaces.
- Produces: `pnpm gen:types` — regenerates `frontend/packages/shared-types/openapi.d.ts` from `../backend/openapi.json`.

This task wires the pipeline but does **not** change any app import yet, so `pnpm build`/`pnpm lint` must stay green with the package merely present.

- [ ] **Step 1: Declare the workspace**

Create `frontend/pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Create the shared-types package manifest**

Create `frontend/packages/shared-types/package.json`:

```json
{
  "name": "@callup/shared-types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "types": "./index.ts",
  "exports": {
    ".": {
      "types": "./index.ts",
      "default": "./index.ts"
    }
  }
}
```

This is a types-only package consumed as source (no build step) — bundler module resolution reads `index.ts` directly.

- [ ] **Step 3: Create the package's public surface**

Create `frontend/packages/shared-types/index.ts`:

```ts
// Public surface of the generated backend contract. Regenerate `openapi.d.ts` with
// `pnpm gen:types`. Add friendly aliases here as consumers need them (see Chunk 2.5+).
export type * from './openapi'
```

- [ ] **Step 4: Add the generator script and dependencies**

In `frontend/package.json`:

Add `"gen:types"` to `"scripts"` (after `"lint"`):
```json
    "lint": "eslint .",
    "gen:types": "openapi-typescript ../backend/openapi.json -o packages/shared-types/openapi.d.ts",
```

Add the workspace package to `"dependencies"` (alphabetical, before `@fontsource-...` — i.e. first):
```json
  "dependencies": {
    "@callup/shared-types": "workspace:*",
    "@fontsource-variable/geist": "^5.2.9",
```

Add `openapi-typescript` to `"devDependencies"` (alphabetical, after `@eslint/js`):
```json
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "openapi-typescript": "^7.5.0",
    "@types/node": "^24.13.2",
```
(Keep valid JSON — exact key order doesn't matter; the snippet shows placement. The `^7.5.0` floor is a known-good `openapi-typescript` 7.x; `pnpm` will resolve the latest matching version that satisfies the 7-day release-age policy.)

- [ ] **Step 5: Install (resolves the workspace + new dep, updates the lockfile)**

From `frontend/`:
```bash
pnpm install
```
Expected: succeeds; `pnpm-lock.yaml` updates to include the `packages/shared-types` importer and `openapi-typescript`; `frontend/node_modules/@callup/shared-types` is a symlink to `packages/shared-types`.

- [ ] **Step 6: Pin the generated TS file to LF, then generate it**

Append to the repo-root `.gitattributes` (created in Task 1):
```gitattributes
frontend/packages/shared-types/openapi.d.ts text eol=lf
```

Then from `frontend/`:
```bash
pnpm gen:types
```
Expected: writes `packages/shared-types/openapi.d.ts` containing `export interface components { schemas: { ... CandidateCard: { ... } ... } }` plus `paths`/`operations`. The file has **no timestamp** (openapi-typescript 7 output is deterministic).

- [ ] **Step 7: Verify generation is deterministic**

From `frontend/`:
```bash
pnpm gen:types
git diff --stat packages/shared-types/openapi.d.ts
```
Expected: empty output (running it twice produces no diff). If there is a diff, stop — a non-deterministic generator would break the CI drift check; report it.

- [ ] **Step 8: Exclude the generated file from eslint**

In `frontend/eslint.config.js`, change the `globalIgnores` line:
```js
  globalIgnores(['dist']),
```
to:
```js
  globalIgnores(['dist', 'packages/shared-types/openapi.d.ts']),
```
(The hand-written `index.ts` is still linted; only the generated artifact is ignored.)

- [ ] **Step 9: Make the Docker dep layer workspace-aware**

In `frontend/Dockerfile`, change the dependency layer. Replace:
```dockerfile
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
```
with:
```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared-types/package.json ./packages/shared-types/
RUN pnpm install --frozen-lockfile
```
This is required: with a workspace, `--frozen-lockfile` needs the workspace manifest and every member's `package.json` present before install, or it errors. The generated `openapi.d.ts` and `index.ts` arrive later via the existing `COPY . .` (the build reads the committed types — it does **not** run `gen:types`, and the Docker context has no `../backend`).

- [ ] **Step 10: Add the frontend CI drift check**

In `.github/workflows/frontend-ci.yml`, append a step after the `Build` step (same indentation, as the last step under `steps:`):
```yaml
      # Regenerate the shared types from the committed backend contract and fail on drift.
      # The full repo is checked out, so ../backend/openapi.json is present here (unlike the
      # Docker build, which only has the frontend/ context and uses the committed types).
      - name: Shared types drift check
        run: |
          pnpm gen:types
          git diff --exit-code packages/shared-types/openapi.d.ts
```

- [ ] **Step 11: Verify the frontend still builds and lints (package present, unconsumed)**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed. App code hasn't changed, so this proves the new package + config don't break the existing build.

- [ ] **Step 12: Commit**

From the repo root (explicit adds only):
```bash
git add frontend/pnpm-workspace.yaml frontend/packages/shared-types/package.json frontend/packages/shared-types/index.ts frontend/packages/shared-types/openapi.d.ts frontend/package.json frontend/pnpm-lock.yaml frontend/eslint.config.js frontend/Dockerfile .gitattributes .github/workflows/frontend-ci.yml
git commit -m "Add shared-types pnpm workspace generated from the OpenAPI contract"
```

---

## Task 3: Migrate `CandidateCard` to the generated type (first consumer)

**Files:**
- Modify: `frontend/packages/shared-types/index.ts`
- Modify: `frontend/src/components/CandidateCard.tsx`
- Modify: `frontend/src/pages/Candidates.tsx`
- Delete: `frontend/src/lib/candidates.ts`

**Interfaces:**
- Consumes: `@callup/shared-types` (Task 2) and the generated `components['schemas']['CandidateCard']`.
- Produces: `export type CandidateCard` from `@callup/shared-types` — the app-facing alias replacing the deleted local `@/lib/candidates` type. After this task no hand-declared backend shape remains for the candidate card.

- [ ] **Step 1: Add the `CandidateCard` alias to the package surface**

In `frontend/packages/shared-types/index.ts`, append below the existing re-export:
```ts
import type { components } from './openapi'

/** Backend `GET /candidates` card (generated). */
export type CandidateCard = components['schemas']['CandidateCard']
```
Final file:
```ts
// Public surface of the generated backend contract. Regenerate `openapi.d.ts` with
// `pnpm gen:types`. Add friendly aliases here as consumers need them (see Chunk 2.5+).
export type * from './openapi'

import type { components } from './openapi'

/** Backend `GET /candidates` card (generated). */
export type CandidateCard = components['schemas']['CandidateCard']
```

- [ ] **Step 2: Point the card component at the generated type**

In `frontend/src/components/CandidateCard.tsx`, change line 2:
```tsx
import type { CandidateCard as Candidate } from '@/lib/candidates'
```
to:
```tsx
import type { CandidateCard as Candidate } from '@callup/shared-types'
```

- [ ] **Step 3: Point the roster page at the generated type**

In `frontend/src/pages/Candidates.tsx`, change the import (currently line 6):
```tsx
import type { CandidateCard as Candidate } from '@/lib/candidates'
```
to:
```tsx
import type { CandidateCard as Candidate } from '@callup/shared-types'
```

- [ ] **Step 4: Delete the now-unused local type**

```bash
git rm frontend/src/lib/candidates.ts
```
(Confirm no other importers remain — Steps 2–3 covered the only two: `git grep "@/lib/candidates" -- frontend/src` must return nothing.)

- [ ] **Step 5: Verify the build type-checks against the generated contract**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed. A green `tsc -b` here is the end-to-end proof: the roster page and card component compile against the type generated from the backend's actual schema, so the field names/nullability the page consumes (`name`, `title`, `primary_skills`, `work_authorization`, `years_experience`, `location`, `status`, `recruiter_id`, `recruiter_name`) match the contract. If a field had drifted, this would be a type error.

- [ ] **Step 6: Confirm no hand-declared candidate shape remains**

From the repo root:
```bash
git grep -n "@/lib/candidates" -- frontend/src
```
Expected: no output (the local type is gone and all imports moved).

- [ ] **Step 7: Commit**

From the repo root (explicit adds only):
```bash
git add frontend/packages/shared-types/index.ts frontend/src/components/CandidateCard.tsx frontend/src/pages/Candidates.tsx
git commit -m "Source CandidateCard from generated shared-types (first consumer)"
```
(The deletion from `git rm` in Step 4 is already staged.)

---

## Done-when

- `backend/openapi.json` is committed; `uv run pytest -m "not integration"` is green including the `test_committed_openapi_is_up_to_date` drift guard; `uv run black --check .` clean.
- `frontend/` is a pnpm workspace with `@callup/shared-types`; `pnpm gen:types` regenerates `openapi.d.ts` deterministically; `pnpm build` and `pnpm lint` pass.
- Frontend CI fails if `openapi.d.ts` drifts from `../backend/openapi.json`; backend CI fails if `openapi.json` drifts from the code.
- `frontend/src/lib/candidates.ts` is deleted; the candidate card type is sourced from the generated schema; `git grep "@/lib/candidates" -- frontend/src` is empty.
- The Docker frontend build still installs and builds with the workspace.
- Three commits (Task 1, Task 2, Task 3).

## Out of scope (not requested)

- Generating typed request/response helpers or a typed `api` client wrapper over the schema (the `api.get<T>` pattern stays; only the `T` source changes). YAGNI until a consumer needs it.
- Migrating other hand-declared types (`Me`/`User`, `Member`) to the generated package — those move when their owning chunk is next touched; this chunk only proves the pipeline on `CandidateCard`.
- A pre-commit hook that auto-regenerates either artifact (the CI/pytest drift guards are the enforcement; a hook is optional polish).
- Splitting backend/frontend into a single top-level monorepo workspace — the frontend workspace is rooted at `frontend/` to match the existing `frontend/pnpm-lock.yaml` and CI layout.

## Self-review notes (for the planner)

- **Spec coverage:** all four spec bullets are covered — backend emits `openapi.json` (Task 1); pnpm workspace + `packages/shared-types` via `openapi-typescript` + `pnpm gen:types` + CI drift check (Task 2); migrate Chunk 2's local `CandidateCard` as the first consumer (Task 3); deliverable "backend contract changes surface as frontend type errors, no hand-declared backend shapes" is realized and asserted by Step 3.5/3.6.
- **Drift coverage is two-sided:** backend code → `openapi.json` is guarded by the pytest in CI's fast suite; `openapi.json` → `openapi.d.ts` is guarded by the frontend CI step. A backend schema change that isn't propagated fails one of the two.
- **Cross-platform:** `.gitattributes eol=lf` + binary read/write make both drift checks byte-stable between Windows (autocrlf) and Linux CI — the specific failure this repo would otherwise hit.
- **No placeholders:** every code/command step shows the exact content and expected output. The one judgment step (deterministic-generation check, Step 2.7) has a concrete pass/fail.
- **Type consistency:** the package alias `components['schemas']['CandidateCard']` matches the backend Pydantic model name `CandidateCard` (Chunk 2, `backend/src/callup/api/schemas.py`); the app-facing name `CandidateCard` and its `as Candidate` import alias are unchanged from Chunk 2, so only the import source changes.
- **No frontend tests:** consistent with the standing constraint — frontend correctness is `pnpm build` + `pnpm lint`, and the drift enforcement is CI, not a test runner.
