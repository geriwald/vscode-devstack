# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Two front-ends over one core:

1. **VS Code extension** — auto-detects a workspace's tech stack and exposes launchable dev services in the activity bar (runs them in managed terminals).
2. **Web dashboard** (`devstack serve`) — a standalone full-screen mission-control: start/stop dev *and* prod (systemd) services, see each service's resolved venv/.env, tiled live log panels, cross-project port classification, health checks, and front→back→service wiring. See `docs/specs/2026-06-15-web-dashboard-design.md`.

The two share the config/model layer (`core/`, `serviceMeta.ts`, `stackDetector.ts`); they do NOT share the process lifecycle (extension = VS Code terminals; dashboard = child processes it owns + systemd).

## Build & install

```bash
npm install
npm run compile                              # or: npx tsc -p ./
npm run lint                                 # eslint src --ext ts (no config yet — will fail until .eslintrc is added)
npx @vscode/vsce package --allow-missing-repository  # produce .vsix
code --install-extension devstack-0.1.0.vsix # then reload the window
```

Watch mode: `npm run watch` (tsc in watch mode).

No test runner is configured. No CI pipeline.

## Architecture

Files in `src/` (TypeScript, compiled to `out/`) plus `media/` (webview assets, served as-is):

### Shared core (vscode-free — usable from the CLI)

- **core/config.ts** — `.devstack.json` parsing/merging (JSONC). Moved out of `configManager.ts` so the CLI can import it without pulling in the `vscode` module. `configManager.ts` re-exports these and keeps the vscode-only `editConfig`.
- **core/wiring.ts** — pure parsers: a service command → its venv/interpreter, `--env-file`, inline `KEY=val` env, and `*_URL`/`*_PORT` references to other services. Unit-tested in `core/wiring.test.ts`.

### Web dashboard backend (`src/server/`, vscode-free)

- **server/procRunner.ts** — owns a dev service as a detached child (own process group), so stop kills the WHOLE tree (no orphaned `tsx watch`/`uvicorn --reload` worker).
- **server/systemdRunner.ts** — drives prod `systemd --user` units (`systemctl` lifecycle, `journalctl -f` logs, `systemctl show` facts).
- **server/inspector.ts** — `ss -tlnp` port scan + `/proc` owner resolution, port classification (managed/conflict/foreign/project), HTTP health probes.
- **server/registry.ts** — owns all runners, assembles the snapshot (services + ports), runs scripts.
- **server/logBus.ts** — line-splitting log fan-in/out with per-channel ring buffers + a monotonic `seq` for SSE replay/dedupe.
- **server/httpServer.ts** — `createDashboardServer()` factory: static SPA + REST + SSE. Binds 127.0.0.1, rejects non-localhost Host headers (DNS-rebinding guard).
- **server/fallbackPage.ts** — diagnostic page served when `media/dashboard/` has no SPA yet.
- **cli.ts** — `devstack serve` entry (detect → merge config → serve).
- **media/dashboard/** — the SPA (index.html, app.js, style.css), served as-is. API contract in `docs/dev/web-dashboard-ui-brief.md`.

### VS Code extension

- **extension.ts** — entry point. Wires WebviewView, commands, and a `FileSystemWatcher` that re-scans on marker file changes. The `scanAndRefresh` function is the main pipeline: detect → deduplicate → merge config → render.
- **stackDetector.ts** — ordered array of `Detector` functions (framework-specific first, generic last). Each detector reads marker files synchronously. `deduplicateServices()` dedupes by command string, preferring framework detectors over generic ones (npm scripts, Makefile). Sets `tech` field on each service for metadata lookup.
- **serviceMeta.ts** — two lookup tables: `TECH_META` (by tech name, e.g. "Next.js" → port 3000) and `COMMAND_META` (by command regex fallback). Also exports `TECH_DESCRIPTIONS` for the stack overview display (icon, color, description per tech).
- **configManager.ts** — loads `.devstack.json` overrides: `services` array (source: "config") and `disable` list. `mergeServices()` merges auto-detected + config services by name.
- **terminalManager.ts** — `TerminalManager` class. Keys terminals by `role::name`. Uses `onDidChangeTerminalShellIntegration` + `executeCommand()` to send commands after shell setup (venv activation, etc.), with 3s fallback to `sendText`. Stop sends `\x03` then `dispose()` after 500ms.
- **webviewProvider.ts** — `DevStackWebviewProvider` (WebviewView). Builds state snapshots and sends them to the webview via `postMessage`. Receives `start`/`stop`/`openUrl` commands back. Injects `INITIAL_STATE` in HTML for immediate render on panel open.
- **types.ts** — shared types. `ServiceDefinition` includes optional `tech` and `composeServices` fields. `ROLE_ORDER` drives the display order of groups.
- **media/main.css** — webview styles using VS Code CSS variables (`--vscode-*`) for native theme integration.
- **media/main.js** — vanilla JS webview: renders stack overview, grouped services with play/stop, mode badges, compose service badges, and clickable localhost URLs.

**Data flow:** `detectStacks()` → `deduplicateServices()` (injects `tech` field) → `loadConfig()` + `mergeServices()` → `webviewProvider.setServices()` → `buildState()` enriches with `getServiceMeta()` → `postMessage` to webview → webview renders.

## Key design decisions

- **Single workspace only** — `workspaceFolders[0]` only, not multi-root.
- **WebviewView, not TreeView** — HTML/CSS/JS sidebar panel for rich rendering (badges, colors, clickable URLs). TreeView was too limited (single-line description, no custom HTML).
- **Status = terminal alive** — closing the terminal is the only "stopped" signal. A crashed process inside the terminal still shows "running".
- **Shell integration for command dispatch** — uses `executeCommand()` via `onDidChangeTerminalShellIntegration` to wait for shell setup (Python venv auto-activation, etc.) before sending commands. Fallback to `sendText` after 3s.
- **No YAML dependency** — Docker Compose parsing is hand-rolled (regex on 2-space-indented keys under `services:`).
- **Docker services as badges** — individual compose services are displayed as badges on a single "Docker Compose" item (always under Infrastructure), not as separate service items.
- **Metadata lookup: tech-first, command-fallback** — `getServiceMeta(command, tech)` checks `TECH_META[tech]` first (avoids ambiguous commands like `npm run dev` matching the wrong framework), then falls back to `COMMAND_META` regex.
- **Synchronous file I/O** — all detection is sync (`fs.existsSync` / `fs.readFileSync`). Fine for startup, would need rework for large workspaces.

## Adding a new detector

1. Write a `Detector` function in `stackDetector.ts` (signature: `(root: string) => DetectedStack | null`).
2. Add it to the `DETECTORS` array. Framework-specific detectors go before generic ones — order matters for deduplication.
3. Add a `TECH_META` entry in `serviceMeta.ts` if the tech has a known default port/mode.
4. Add a `TECH_DESCRIPTIONS` entry in `serviceMeta.ts` for the stack overview display.

## VS Code extension commands

- `devstack.refresh` — rescan the workspace
- `devstack.editConfig` — open/create `.devstack.json`

Start/stop are handled via webview `postMessage`, not VS Code commands.

## Not in scope

- **Multi-project dashboard** and **dynamic port detection / healthcheck** were rejected for the *extension*, but are now implemented in the **web dashboard** (`devstack serve`) — a deliberate reversal, see the 2026-06-15 spec.
- Multi-root workspace support (extension).
- Dashboard auth / remote exposure: it can spawn and kill processes, so it binds 127.0.0.1 only and rejects non-localhost Host headers. Never expose it.
- Windows/macOS port scanning: the inspector uses `ss` + `/proc` (Linux-only).
