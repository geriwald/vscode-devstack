# `disable` matching for subdir-detected services — design

- **Date:** 2026-06-02
- **Status:** implemented

## Problem

A service detected in a subdirectory is displayed with a path suffix
(`"FastAPI Server"` → `"FastAPI Server (vision)"`, `stackDetector.ts`). The
`disable` filter in `configManager.ts` matched against that **suffixed** name,
so a user writing the intuitive intrinsic name (`"FastAPI Server"`) in
`.devstack.json`'s `disable` array saw it silently fail. The suffix was a
display concern that had leaked into the matching key.

Full report: `docs/bugs/2026-06-02-disable-fails-on-subdir-renamed-services.md`.

## Decision

Option 1 from the bug report: separate the intrinsic name from the display name.

- `ServiceDefinition` gains an optional `intrinsicName` — the detector's
  pre-suffix name. Set only when a service is renamed for a subdirectory.
- `mergeServices` matches a `disable` entry against the **display name OR the
  intrinsic name**. Both work; existing configs using the full suffixed name
  keep working (back-compat).

Matching both (rather than only the intrinsic) preserves the ability to disable
exactly one of two same-named services in different subdirs by its display name.

## Acceptance criteria

- [x] A subdir service is disabled by its intrinsic name (`"FastAPI Server"`).
- [x] It is also disabled by its full display name (`"FastAPI Server (vision)"`).
- [x] Disabling by one display name does not disable a same-intrinsic-name
      service in another subdir.
- [x] Root services (no suffix) keep being disabled by their name.
- [x] Covered by unit tests (`src/configManager.test.ts`, Vitest).

## Scope

- `types.ts`, `stackDetector.ts`, `configManager.ts`, the test, and a Vitest
  test harness (first tests in the repo).

## Out of scope

- The UI "hide" button that writes the right `disable` key automatically — see
  `docs/pre-specs/2026-06-02-source-affordances-gear-and-hide.md` and its own
  spec. This fix is the prerequisite: the matching key is now well-defined.
