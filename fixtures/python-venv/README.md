# Python venv test fixture

Reproduces the venv-activation startup delay observed in DevStack-spawned
terminals. See `docs/specs/2026-05-31-venv-startup-delay-design.md`.

## Setup

```bash
./setup.sh   # creates .venv with the stdlib (no pip install needed)
```

The VS Code Python extension auto-selects `.venv` for this folder. To force it:
`Python: Select Interpreter` → `.venv/bin/python`.

## Reproduce the delay

1. Open this folder as a VS Code workspace (so the Python extension targets the
   local `.venv`).
2. Open the DevStack sidebar; the **Python HTTP server** service appears under
   Backend.
3. Start it and watch the spawned terminal: the `python app.py` command should
   show the activation-induced delay.

## Capture what the extension actually does

Run the Extension Development Host with `DEVSTACK_DEBUG=1` set (copy
`docs/dev/launch.json.example` to `.vscode/launch.json` and pick the
**Run Extension (DEBUG terminal capture)** config). The DevStack Debug output channel
then dumps every byte written to the spawned terminal, with timestamps relative
to terminal creation — revealing whether the Python extension types
`source .venv/bin/activate` / emits `Ctrl+C`, and exactly when.

`app.py` prints its `interpreter:` path on startup, so the run also confirms
whether the venv interpreter is actually in effect.
