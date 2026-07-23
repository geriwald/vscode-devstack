# Changelog

All notable changes to the DevStack VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-07-19

### Added

- **Web dashboard** (`devstack serve`) — a standalone full-screen mission-control served over localhost. Start/stop dev services (child processes, killed by process group so no orphaned watchers) and prod `systemd --user` services; per-service resolved venv/`.env`/inline-env/mode/health; cross-project port classification (managed/conflict/foreign/project); front→back→service wiring; and tiled live log panels with fade-on-update over SSE. See `docs/specs/2026-06-15-web-dashboard-design.md` and the API contract in `docs/dev/web-dashboard-ui-brief.md`.
- **`manager: "systemd"`** service field (+ `unit`, `userScope`) so prod systemd units appear in the dashboard. The VS Code extension ignores them (no terminal lifecycle).
- Node-watcher mode detection (`tsx watch`, `ts-node-dev`, `nodemon`, `node --watch`) in `serviceMeta`.
- `description` field on services in `.devstack.json`: the sidebar shows it as the subtitle under the name; the raw command is no longer printed, only exposed as a tooltip on the service name (services and scripts alike).

### Changed

- Config parsing/merging moved from `configManager.ts` to a vscode-free `core/config.ts` (re-exported), so the CLI can reuse it without the `vscode` module. New `core/wiring.ts` (pure, unit-tested).

### Fixed

- `.devstack.json` is now parsed as JSONC: comments and trailing commas are tolerated instead of silently wiping every configured service and script. Previously a single `//` comment made `JSON.parse` throw, the error was swallowed, and the sidebar fell back to auto-detection only (no configured buttons).

## [0.4.0] — 2026-05-18

### Added

- **Scripts section** in the sidebar for one-shot CLI commands (interactive REPLs, batch jobs, ad-hoc tasks). Configure via a new `scripts` array in `.devstack.json`. Each script has a single Run action — no status tracking, no stop button, no URL. Each click opens a fresh terminal; concurrent runs are independent. See `docs/specs/2026-05-18-scripts-section-design.md` for the design.

### Changed

- The Reload Extension service in the project's dogfooded `.devstack.json` now runs `npm run compile` before packaging, ensuring the `.vsix` always reflects the latest TypeScript sources.

## Earlier versions

For changes prior to 0.4.0, see the [git history](https://github.com/geriwald/vscode-devstack/commits/master) and release tags `v0.1.0` … `v0.3.2`.
