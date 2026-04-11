# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

VS Code extension that auto-detects a workspace's tech stack and exposes launchable dev services in the activity bar. No tests, no linter config — it's a single-developer v0.1.

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

- Multi-project dashboard (explicitly rejected).
- Dynamic port detection / healthcheck.
- Multi-root workspace support.
