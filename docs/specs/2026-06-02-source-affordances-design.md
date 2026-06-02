# Source affordances: tell manual vs auto services apart, + one-click hide

- **Date:** 2026-06-02
- **Status:** accepted (implemented in autonomy; review on PR)
- **Promotes:** `docs/pre-specs/2026-06-02-source-affordances-gear-and-hide.md`
- **Depends on:** `docs/specs/2026-06-02-disable-subdir-services-design.md`
  (the `disable` matching key must be well-defined first)

## Problem

In the panel you can't tell which services come from `.devstack.json` (manual,
`source: "config"`) and which were auto-detected (`source: "auto"`). To hide a
bad auto-detected one you must hand-edit the JSON and guess the exact (suffixed)
name.

## Decisions

1. **Expose `source` and `intrinsicName`** in the webview state so the UI can
   branch on provenance.

2. **Manual (config) services** get a small `config` source badge and a **gear**
   button that opens `.devstack.json` (reuses the existing `editConfig`).

3. **Auto-detected services** get a **hide** button (codicon `eye-closed`). It
   sends `hideService` with the service's `name` and `intrinsicName`; the
   provider appends the **correct disable key** to `.devstack.json` and refreshes.
   No manual editing, no guessing the suffix.

### Which key does hide write?

The intrinsic name when present (so the entry reads `"FastAPI Server"`, intuitive
and stable across the suffix), otherwise the plain name. This matches the
disable resolution from the dependency spec (display OR intrinsic), so the
written key always matches.

If two subdir services share an intrinsic name, hiding one by intrinsic name
hides both. That is acceptable and arguably expected ("hide this detected
service"); a user who wants surgical control can still edit the JSON to the
display name. Documented, not silently surprising.

## Config writing

A new `addToDisable(workspaceRoot, key)` in `configManager.ts`:

- reads `.devstack.json` (creates a minimal one if absent),
- adds `key` to the `disable` array if not already present (idempotent),
- preserves existing content and writes back with 2-space indent + trailing NL.

Pure enough to unit-test against a temp dir (no vscode runtime needed).

## Acceptance criteria

- [ ] Config services show a `config` badge and a gear that opens the config file.
- [ ] Auto services show a hide button.
- [ ] Clicking hide adds the intrinsic name (or name) to `disable` and the
      service disappears after refresh.
- [ ] `addToDisable` is idempotent and preserves existing config; covered by
      unit tests.

## Scope

- `types.ts` (state), `webviewProvider.ts` (state + handlers), `configManager.ts`
  (`addToDisable`), `media/main.js` + `media/main.css` (rendering), tests.

## Out of scope

- A "hidden services" section / un-hide from the UI. Undo = edit the JSON back.
- Jumping the gear to the exact service entry in the JSON (just opens the file).
