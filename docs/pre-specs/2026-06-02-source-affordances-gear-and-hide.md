# Pre-spec: tell manual vs auto services apart, + one-click hide

**Date:** 2026-06-02
**Status:** idea, not a spec yet
**Origin:** popic session — couldn't suppress a broken auto-detected service
because `disable` needs the exact (suffixed) name. See
`docs/bugs/2026-06-02-disable-fails-on-subdir-renamed-services.md`.

## The need

In the panel, you can't tell which services came from `.devstack.json` (manual,
`source: "config"`) and which were auto-detected (`source: "auto"`). And to hide
a bad auto-detected one you have to hand-edit the JSON and guess the exact name.

## Two small affordances

1. **Gear icon on each manual (config) service** → opens `.devstack.json`
   (ideally jumps to that service's entry). Signals "this one is yours, defined
   in the file" and gives a one-click way in to edit it.

2. **Hide icon on each auto-detected service** → appends the service to the
   `disable` array in `.devstack.json` automatically, writing the *correct* name
   (whatever `disable` actually matches against). No manual editing, no guessing
   the `(subdir)` suffix.

## Why this matters

The hide button is the real fix for the disable foot-gun: instead of asking the
user to know the exact matching name, the button writes it. So (2) is **coupled**
to the bug fix — it depends on `disable` matching being well-defined (intrinsic
name vs display label). Decide that first, then the hide button writes the right
key.

## Open questions (for the real spec)

- The panel already has a global gear (top-right). Per-service gear vs a small
  `config` / `auto` source badge — which reads better?
- Hide writes to `disable`: by intrinsic name or display name? (Same decision as
  the bug fix — keep them consistent.)
- Should hidden services be listed somewhere (a collapsed "hidden" section) so
  they're un-hideable from the UI, or is editing the JSON back the only undo?
