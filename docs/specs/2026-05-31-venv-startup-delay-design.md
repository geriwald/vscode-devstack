# Venv startup delay in spawned terminals — design

- **Date:** 2026-05-31
- **Status:** resolved 2026-06-02 (see Outcome below)

## Problem

When DevStack starts a Python service, the spawned terminal exhibits a
noticeable delay before the service command runs, and the user reports the
command being interrupted. The current `TerminalManager.sendCommandWhenReady`
waits for `onDidChangeTerminalShellIntegration` before dispatching the command,
with a 3s fallback to `sendText`.

The original rationale (see the comment in `terminalManager.ts`, lines ~96-98)
was that the Python extension's terminal auto-activation could send a `Ctrl+C`
that kills our process if we send the command too early.

A read of the Python extension source suggests the modern activation path
(`pythonTerminalEnvVarActivation` experiment) injects the venv via the
`EnvironmentVariableCollection` API — no text typed into the terminal, no
`Ctrl+C`. If that is the active path, the wait protects against nothing and only
costs us the time the extension spends computing its activated env.

**But the user observes the opposite in practice.** Observation overrides
source-reading. Before changing behavior, we instrument the terminal to capture
what actually happens.

## Decision

Build a reproducible test harness **before** touching the dispatch logic:

1. A Python fixture (`fixtures/python-venv/`) with a real `.venv` and a stdlib
   HTTP server that prints a `http://localhost:8000` URL (also exercises port
   detection).
2. A debug instrumentation layer in `TerminalManager`, gated by the
   `DEVSTACK_DEBUG` environment variable, that subscribes to the **proposed**
   `window.onDidWriteTerminalData` API and logs every byte written to a
   DevStack-spawned terminal, with timestamps relative to terminal creation.

This makes the real sequence observable: does the Python extension type
`source .venv/bin/activate`? Does it emit `\x03`? When, relative to our command?

## Acceptance criteria (harness phase)

- [ ] `fixtures/python-venv/setup.sh` creates a working `.venv` from scratch.
- [ ] Starting the fixture's service from DevStack reproduces the delay.
- [ ] With `DEVSTACK_DEBUG=1`, the DevStack output channel shows a timestamped
      dump of raw terminal data, clearly distinguishing extension-injected text
      from our own command.
- [ ] The instrumentation is a no-op (zero overhead, no proposed-API dependency
      loaded) when `DEVSTACK_DEBUG` is unset.

## Scope

- Test fixture, debug instrumentation, this spec.

## Out of scope

- The fix itself. The fix is a **separate commit**, decided once the harness
  produces evidence on which activation path is actually running.
- The proposed-API dependency must **never** ship in the published manifest
  (it would block Marketplace publication). Debug runs enable it via a local
  `.vscode/launch.json` copied from `docs/dev/launch.json.example` (the
  `--enable-proposed-api=geriwald.devstack` flag), never via `package.json`.

## Outcome (2026-06-02)

The harness was not even needed in the end: a real terminal capture showed
the sequence directly — our `uvicorn ...` command ran, the server started,
then a `^C` arrived followed by `source .../activate`, killing the process.

Reading the Python extension source confirmed the cause: `TerminalAutoActivation`
is registered **unconditionally** and, on `onDidOpenTerminal`, runs a slow
`getEnvironmentActivationCommands()` (the delay) then `terminal.sendText(...)`
of the activation command + Ctrl+C (the intermittent kill). It **skips**
terminals created with `hideFromUser`.

**Fix:** create spawned terminals with `hideFromUser: true` and send the
command immediately (the shell-integration wait + 3s fallback is removed).
We need no activation: detected commands already use the venv's absolute
interpreter path. The debug instrumentation is kept as a permanent diagnostic
tool behind `DEVSTACK_DEBUG`.
