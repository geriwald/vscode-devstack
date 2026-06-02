# Bug: `disable` does not match auto-detected services found in subdirectories

**Date:** 2026-06-02
**Reported from:** popic repo (`~/code/popic`, monorepo-ish layout with `vision/`, `backend/`, `frontend/` subdirs)
**Severity:** medium — user cannot suppress a broken auto-detected service via `.devstack.json`.
**Status:** open

## Symptom

In a workspace where a stack is detected inside a **subdirectory**, the
auto-detected service shows up in the panel with the subdir appended, e.g.
**"FastAPI Server (vision)"**. Adding the service name to the `disable` array in
`.devstack.json` does **not** remove it:

```jsonc
// .devstack.json — does NOT work
"disable": ["FastAPI Server"]
```

The service remains visible after a panel refresh and after a full
*Reload Window*. The user ends up with two backend entries for the same service:
the broken auto-detected one and their own `config` override (different name →
no merge), and clicks the wrong (broken) button.

## Root cause

Name mismatch between **detection-time** and **disable-time**.

`src/stackDetector.ts:33` renames every service detected in a subdirectory by
appending the relative path:

```ts
// stackDetector.ts, scanning subdirs at depth <= 2
name: `${svc.name} (${rel})`,   // "FastAPI Server" -> "FastAPI Server (vision)"
```

But `src/configManager.ts:35` filters the `disable` set against that **already
renamed** name:

```ts
const disabled = new Set(config.disable ?? []);
const filtered = autoDetected.filter((s) => !disabled.has(s.name));
```

So the user must write the *display* name `"FastAPI Server (vision)"` in
`disable`, not the detector's intrinsic name `"FastAPI Server"`. This is
undiscoverable: the user reads the detector source, sees `name: "FastAPI Server"`,
disables that, and it silently fails. The `(subdir)` suffix is presented as a
cosmetic label but is in fact load-bearing for `disable` matching.

## Reproduction

1. Workspace root with a FastAPI app in a subdir (e.g. `vision/src/api.py` with
   `app = FastAPI(...)`), no usable venv at the expected path.
2. Auto-detection produces `"FastAPI Server (vision)"` with a broken command
   (`uvicorn main:app --reload --port 8000` — wrong app entry, wrong port, and
   `uvicorn` not on PATH because no venv was found).
3. Add `"FastAPI Server"` to `disable` in `.devstack.json`.
4. Refresh / Reload Window → service still present.

## Fix options

1. **Match `disable` against the intrinsic (pre-suffix) name.** Tag the service
   with both an intrinsic `name` and a display label, and filter `disable` on the
   intrinsic name (or strip the ` (rel)` suffix before comparing). Most intuitive
   for users reading the detector source.
2. **Match against the displayed name but document it.** Keep current behavior,
   but document that `disable` entries for subdir-detected services must include
   the ` (subdir)` suffix. Cheap, but keeps the foot-gun.
3. **Allow `disable` to match a prefix or a glob** (`"FastAPI Server"` matches
   `"FastAPI Server (*)"`). Flexible but fuzzier.

Recommendation: option 1. The suffix is a display concern and should not leak
into the disable-matching key.

## Workaround (until fixed)

Put the **full displayed name** in `disable`:

```jsonc
"disable": ["FastAPI Server (vision)"]
```

## Related

- `src/stackDetector.ts:22-40` — subdir scan + rename
- `src/configManager.ts:28-49` — `mergeServices` / disable filtering
- Spec `docs/specs/2026-05-31-venv-startup-delay-design.md` (separate concern:
  the venv discovery that produced the broken `uvicorn` fallback command)
