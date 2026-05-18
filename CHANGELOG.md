# Changelog

All notable changes to the DevStack VS Code extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-05-18

### Added

- **Scripts section** in the sidebar for one-shot CLI commands (interactive REPLs, batch jobs, ad-hoc tasks). Configure via a new `scripts` array in `.devstack.json`. Each script has a single Run action — no status tracking, no stop button, no URL. Each click opens a fresh terminal; concurrent runs are independent. See `docs/specs/2026-05-18-scripts-section-design.md` for the design.

### Changed

- The Reload Extension service in the project's dogfooded `.devstack.json` now runs `npm run compile` before packaging, ensuring the `.vsix` always reflects the latest TypeScript sources.

## Earlier versions

For changes prior to 0.4.0, see the [git history](https://github.com/geriwald/vscode-devstack/commits/master) and release tags `v0.1.0` … `v0.3.2`.
