# Isolated terminals — design

- **Status**: proposed
- **Issue**: [#4](https://github.com/geriwald/vscode-devstack/issues/4)
- **Author**: Géraud
- **Date**: 2026-04-15

## Problem

Starting any DevStack service incurs a visible lag of up to 3 seconds. The
lag comes from [`terminalManager.ts`](../../src/terminalManager.ts#L148-L155):
after `createTerminal`, DevStack waits for
`onDidChangeTerminalShellIntegration` before calling `executeCommand`. If the
event never fires (common case when shell integration is not active, or when
a user's shell setup interferes with automatic activation), DevStack falls
back to `sendText` after a 3-second timeout.

The wait exists for one reason: the VS Code Python extension, whenever a new
terminal is created in a workspace containing a `.venv`, sends a Ctrl+C to
the terminal to clear its prompt before running `source .venv/bin/activate`.
If DevStack sends its command before the Python extension's Ctrl+C lands,
the Ctrl+C kills the freshly launched process.

The wait is therefore a defensive measure against an extension we do not
control, and it penalises every service launch — even services that do not
need a venv at all.

## Goals

1. Remove the 3-second lag for services that do not depend on shell
   activation (e.g. a Python script launched via its resolved venv
   interpreter, a static Go binary, a Docker Compose command).
2. Guarantee that no other extension can inject input into the terminal of
   a managed service.
3. Keep the existing shell-integration-based terminal as the default for
   services that legitimately need the user's shell environment (venv
   activation, `nvm`, `direnv`, shell aliases, `.bashrc` setup).
4. Preserve today's features — status tracking, port detection, stop via
   Ctrl+C, stdout display — for isolated services.

## Non-goals

- Replacing the current shell-integration terminal entirely.
- Supporting interactive input from the user inside an isolated terminal
  (they will be read-only).
- Fully supporting Windows (`cmd.exe`/PowerShell). Isolated mode assumes a
  POSIX shell; Windows support is best-effort (untested).

## Decisions

### D1 — Use `vscode.window.createTerminal` with `Pseudoterminal`

The VS Code API exposes `ExtensionTerminalOptions` which lets an extension
provide its own `Pseudoterminal` implementation. A Pseudoterminal is backed
entirely by the extension: input, output, and lifecycle are under our
control. Crucially, **other extensions cannot inject text into it** — a
call to `terminal.sendText()` on a Pseudoterminal-backed terminal is
routed to our `handleInput` handler, which we can ignore.

This also implicitly disables shell integration: there is no shell, so
VS Code does not attempt to instrument anything, and we do not need to
wait for `onDidChangeTerminalShellIntegration`.

### D2 — Spawn the command via `child_process.spawn('bash', ['-c', command])`

The service command is a shell string (e.g. `rm -f *.vsix && vsce package`)
and users expect shell features: pipes, redirections, `&&`, globs, env
variable expansion. `child_process.spawn('bash', ['-c', command], { cwd, env })`
gives us all of that in a single subprocess without going through the
user's interactive shell (no `.bashrc`, no Python extension interference).

The spawned process inherits DevStack's environment by default (the
VS Code extension host), which is close enough to what the user expects.
Users who need a custom env can use `.devstack.json` env overrides in a
future iteration (out of scope here).

### D3 — Pipe stdout/stderr through the Pseudoterminal, verbatim

`child.stdout` and `child.stderr` are `Readable` streams. We listen to
`'data'` events and emit each chunk through the Pseudoterminal's
`writeEmitter`. ANSI escape codes pass through unchanged, so colours
and basic terminal UI (spinners, progress bars) display correctly.

The same stream is scanned for the existing localhost URL regex
(`TerminalManager.URL_PATTERN`) to populate `detectedPort`. No duplication
of logic — the scan uses the same regex the stream reader already uses.

### D4 — Stop by sending SIGINT to the child process group

Current stop logic sends `\x03` to the terminal (which only works via
shell integration or interactive pty input) and then disposes the
terminal. For isolated mode, we call `child.kill('SIGINT')` directly; if
the process is still alive after 500 ms, we escalate to `SIGTERM`, then
`SIGKILL` after another 500 ms.

To ensure signals reach child processes the command itself spawned (e.g.
`npm run dev` → `node`), we use `{ detached: true }` on the spawn call
and send the signal to the negative PID (`process.kill(-child.pid)`),
which targets the entire process group.

### D5 — Opt-in via `.devstack.json`, auto-enabled for specific detectors

`ServiceDefinition` gains an optional `isolated?: boolean`. When true,
DevStack uses the Pseudoterminal path. When unset or false, the existing
shell-integration path is used (unchanged).

Detectors that already resolve an absolute interpreter or binary path
default to `isolated: true` because they have no reason to go through the
user's shell:

- `detectPythonScript` (already resolves `.venv/bin/python` or `python3`)
- `detectGo` (`go run .` — no venv, no shell aliases needed in practice)
- `detectRust` (`cargo run` — idem)

Detectors that rely on user shell setup keep the default path:

- `detectPythonFastAPI` (may need `flask run` with env vars from `.bashrc`)
- `detectNpmScripts` (may need `nvm`, `direnv`, etc.)
- `detectNextJs` / `detectVite` / `detectNuxt` / ... (idem)
- `detectDockerCompose` (docker daemon env, `~/.docker/config.json`)
- `detectMakefile` (make targets may call into the user's shell env)

Users can override either way via `.devstack.json` (force `isolated: true`
on an npm script, or force `isolated: false` on a Python script).

### D6 — Status tracking: still terminal-alive-based, plus process exit

Today, the only "stopped" signal is `onDidCloseTerminal`. For isolated
mode, the primary signal becomes `child.on('exit')`: when the spawned
process ends, we mark the service stopped (or error, based on exit code)
and close the pty. If the user dismisses the terminal via the UI
(`onDidCloseTerminal`), we kill the child process and mark stopped.

## Affected files

- [`src/types.ts`](../../src/types.ts) — add `isolated?: boolean` to
  `ServiceDefinition`.
- [`src/terminalManager.ts`](../../src/terminalManager.ts) — branch between
  the existing shell-integration path and the new Pseudoterminal path in
  `start()`. Extract shared logic (URL detection, status updates).
- [`src/stackDetector.ts`](../../src/stackDetector.ts) — set
  `isolated: true` on services emitted by `detectPythonScript`,
  `detectGo`, and `detectRust`.
- [`README.md`](../../README.md) — document the `isolated` field.

## Acceptance criteria

- Clicking play on a `detectPythonScript` service (e.g. simply-jo's
  `python3 server.py`) launches in under 200 ms end-to-end — no perceptible
  lag.
- The Python extension's Ctrl+C-on-terminal-open behaviour has no effect
  on an isolated service (verified by opening simply-jo with the Python
  extension active and launching the service).
- Clicking stop on an isolated service kills the child process within
  1.5 s (SIGINT → SIGTERM → SIGKILL escalation).
- Port detection still works: launching simply-jo displays the
  `http://localhost:5000` link once Flask prints its startup banner.
- A service with `"isolated": false` explicitly set in `.devstack.json`
  uses the legacy path even if the detector defaulted to `true`.
- An existing service with no `isolated` field set (e.g. a Vite dev
  server) behaves exactly like today — no regression on the default
  path.

## Out of scope

- Interactive input into isolated terminals.
- Full Windows support (POSIX shell assumption).
- Env overrides per service in `.devstack.json`.
- Replacing the shell-integration path entirely.
