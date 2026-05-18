# Scripts section — design

- **Status**: accepted
- **Author**: Géraud
- **Date**: 2026-05-18

## Problem

`.devstack.json` only supports `services`, which are modeled as
long-running processes (dev servers, bots, frontend watchers) with a
start/stop lifecycle. Many projects also ship **one-shot interactive
CLI commands** that do not fit this model:

- `bin/docpipe-scan` — interactive REPL that prompts the user to feed
  each page, exits on `q`.
- `bin/docpipe-ocr` — batch OCR, terminates when the input queue is
  drained.
- `bin/docpipe-classify` — processes PDFs and exits.
- `bin/docpipe-ledger` — reconciliation pipeline triggered with
  `--import` / `--check` / `--export-csv`.

Forcing these into the `services` slot is semantically wrong:

- The status indicator (`stopped` / `running` / `error`) is irrelevant
  — these commands are meant to finish.
- The `stop` button (Ctrl+C + dispose terminal) is hostile to a user
  who is mid-interaction with the script.
- There is no localhost URL, no port, no hot-reload badge — the
  service metadata fields are unused.

Without a dedicated slot, project maintainers either omit these
commands from `.devstack.json` (losing discoverability) or jam them in
as fake services (cluttering the UI). A separate `scripts` section
addresses the gap.

A secondary motivation: when Claude works on such a project, it needs
a reliable, machine-readable inventory of "what commands does this
project expose?" so it stops re-reading `CLAUDE.md` or shell scripts
just to remember the entry points. `.devstack.json` becomes that
inventory once it can describe both services and scripts.

## Goals

1. Extend `.devstack.json` with a `scripts` array that lives
   alongside `services`.
2. Render scripts in the DevStack sidebar as a dedicated section,
   visually distinct from services.
3. Provide a single **Run** action per script — no stop, no status
   tracking, no port/URL handling.
4. Keep `services` semantics and existing behaviour untouched.
5. Preserve auto-detection for services — `scripts` is **config-only**
   (no auto-detection of CLI entry points in this iteration).

## Non-goals

- Auto-detecting scripts from `bin/`, `scripts/`, `package.json`
  scripts, or `pyproject.toml` `[project.scripts]`. Out of scope; can
  be a follow-up.
- Stopping or killing a running script from the sidebar. A script
  ends when it ends; the user closes the terminal if they want to
  abort.
- Tracking concurrent runs. Clicking Run while a previous instance is
  still alive opens a **new** terminal — each run is independent.
- Scheduling, sequencing, or piping scripts together.
- Capturing script output / exit codes for display in the webview.

## Config schema

`.devstack.json` gains an optional top-level `scripts` array:

```json
{
  "services": [ ... ],
  "scripts": [
    {
      "name": "Scan documents",
      "command": "bin/docpipe-scan",
      "description": "Duplex scan loop → ~/Scans/raw/",
      "cwd": "."
    },
    {
      "name": "Classify all",
      "command": "bin/docpipe-classify --all",
      "description": "Run Claude classification on every un-classified PDF"
    }
  ],
  "disable": [ ... ]
}
```

### `ScriptDefinition`

| Field         | Type     | Required | Notes                                                          |
| ------------- | -------- | -------- | -------------------------------------------------------------- |
| `name`        | string   | yes      | Display name in the sidebar.                                   |
| `command`     | string   | yes      | Shell command to execute.                                      |
| `description` | string   | no       | One-line subtitle under the name.                              |
| `cwd`         | string   | no       | Working dir, relative to workspace root. Defaults to root.     |
| `group`       | string   | no       | Optional sub-grouping label (e.g. `"scan"`, `"ledger"`). UI may render groups as headers within the Scripts section. |

`group` is reserved for future use; the first iteration can ignore it
and render a flat list.

The `disable` array continues to work and applies to script names too
(scripts being config-only, this is mainly useful for overriding a
template or partial reuse, but the symmetry keeps the schema simple).

## UI

A new collapsible section labelled **Scripts** appears below the
existing role-grouped services, above any empty state. Each script
renders as:

- **Name** (bold, like a service name).
- **Description** (muted, one-line; omitted if absent).
- **Command** (monospace, same style as the existing
  `.service-command` block).
- A single **Run** button (codicon: `play` or `terminal`). No status
  dot, no stop button, no URL block, no port badge.

Clicking Run always creates a **fresh terminal** named
`[DevStack] <script name>`, runs the command, and leaves the terminal
open for the user to read output or interact. No
`onDidChangeTerminalShellIntegration` wait — scripts are launched via
`sendText` immediately (the 3-second venv-activation race condition
that motivates the wait for services is acceptable here: a script
that needs the venv will either resolve the interpreter itself, or
its first interactive prompt will recover gracefully from a stray
Ctrl+C).

If the user clicks Run a second time while a previous terminal is
still open, a second terminal is created — runs are independent and
not deduplicated. The terminal name suffix (`#2`, `#3`) is left to VS
Code's default behaviour.

## Type changes

`src/types.ts`:

```ts
export interface ScriptDefinition {
  name: string;
  command: string;
  description?: string;
  cwd?: string;
  group?: string;
}

export interface DevStackConfig {
  services?: Array<Omit<ServiceDefinition, "source">>;
  scripts?: ScriptDefinition[];
  disable?: string[];
}
```

`src/configManager.ts`: `loadConfig` already returns the raw JSON;
add a `loadScripts(workspaceRoot)` helper or extend the return of
`loadConfig` so `scripts` is plumbed through.

`src/extension.ts`: pass scripts into the webview provider alongside
services (`webviewProvider.setServices(services, techs, scripts)`).

`src/webviewProvider.ts`:

- Extend `WebviewState` with a `scripts` array.
- Add a `runScript` case in `onDidReceiveMessage`.
- `buildState` populates the new field from the loaded config.

`src/terminalManager.ts`: add a `runOneShot(script, workspaceRoot)`
method. Implementation:

```ts
runOneShot(script: ScriptDefinition, workspaceRoot: string): void {
  const cwd = script.cwd
    ? vscode.Uri.file(`${workspaceRoot}/${script.cwd}`)
    : vscode.Uri.file(workspaceRoot);
  const terminal = vscode.window.createTerminal({
    name: `[DevStack] ${script.name}`,
    cwd,
    iconPath: new vscode.ThemeIcon("play"),
  });
  terminal.show();
  terminal.sendText(script.command);
}
```

No tracking, no status emitter, no entry in the `terminals` map.

`media/main.js`: render a new `<div class="scripts-section">` block
after the services. New CSS rules in `media/main.css` for the Run
button styling.

## File-watcher

`.devstack.json` is already in the
`createFileSystemWatcher` glob, so edits to the `scripts` array
trigger a `scanAndRefresh` that re-renders the sidebar with no
additional plumbing.

## Acceptance criteria

1. A `.devstack.json` with only a `scripts` array (no `services`)
   loads without error and renders the Scripts section.
2. A `.devstack.json` with both `services` and `scripts` renders
   both sections correctly; services keep their current behaviour
   (status, stop, URL).
3. Clicking Run opens a new terminal in the configured `cwd`, runs
   the command, and does not block on shell integration.
4. Re-clicking Run with the previous terminal still open creates a
   second terminal; neither interferes with the other.
5. Editing `.devstack.json` to add, remove, or rename a script
   updates the sidebar within ~1 second (existing watcher debounce).
6. The Scripts section is hidden when the array is empty or absent.
7. `description` is rendered when present, omitted when absent — no
   empty `<div>` left in the DOM.
8. `name` collisions between a service and a script are tolerated
   (different sections, different `data-*` attributes). The `disable`
   list is not used to silence scripts in this iteration — see Open
   questions.

## Open questions

- **Should `disable` apply to scripts?** Symmetry says yes, but
  scripts are config-only so disabling them is the same as deleting
  the entry. Leaving `disable` services-only is simpler.
- **Should we add `bin/` auto-detection later?** A natural follow-up:
  scan executable files in `bin/` and `scripts/` and offer them as
  auto-detected scripts (like the existing `Makefile` and
  `package.json` script detection). Defer until the manual path is
  in use and we know what shape the auto-detection should take.
- **Should script runs share a single terminal (re-used) rather than
  spawning new ones?** Spawning is simpler and matches the "each run
  is a fresh attempt" semantics. Re-use would need stop logic, which
  contradicts the goals.
- **Icon for the Run button.** `play` matches the service start
  icon, which could confuse users into expecting a stoppable
  service. `terminal` or `run-all` may signal "one-shot" better.
  Decide during implementation.

## Migration

No migration needed. Existing `.devstack.json` files without a
`scripts` field continue to work unchanged. The extension version
bump (e.g. 0.3.2 → 0.4.0) signals the feature addition.

## Implementation order

1. Types (`types.ts`).
2. Config loading (`configManager.ts`).
3. `runOneShot` in `terminalManager.ts`.
4. Webview state + message handler (`webviewProvider.ts`).
5. Webview render + CSS (`media/main.js`, `media/main.css`).
6. Manual smoke test on a real `.devstack.json` (the `docpipe`
   project is the first consumer).
7. Bump version, rebuild `.vsix`, reinstall.
