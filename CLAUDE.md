# DevStack

VS Code extension: auto-detect the current workspace's tech stack and launch dev services from the activity bar.

## Purpose

Géraud opens a project and doesn't remember the stack. DevStack scans the workspace, lists launchable services grouped by role (Frontend / Backend / Database / Infra / Full Stack), and exposes play/stop buttons that spawn managed terminals.

## Architecture

```
src/
├── extension.ts       # Entry point: wires up tree view, commands, file watcher
├── stackDetector.ts   # Detects tech from marker files (package.json, go.mod, etc.)
├── configManager.ts   # Loads .devstack.json overrides
├── terminalManager.ts # Spawns/tracks VS Code terminals, emits status changes
├── treeProvider.ts    # TreeDataProvider for the activity bar panel
└── types.ts           # Shared types (ServiceDefinition, ServiceRole, etc.)
```

**Key design points:**

- **Single workspace**: scans the first workspace folder only — not multi-project by design.
- **Status = terminal alive**: a service is "running" iff its terminal is still open. Closing the terminal flips status to stopped.
- **Stop = Ctrl+C then dispose**: sends `\x03` to the terminal, waits 500ms, disposes it.
- **Deduplication**: framework-specific detectors (Next.js, Vite…) win over generic ones (npm scripts, Makefile) when commands collide.
- **Config override**: `.devstack.json` at workspace root can add services (`services: [...]`) or disable auto-detected ones (`disable: ["name"]`).

## Supported stacks (v0.1)

Next.js · Nuxt · Remix · Astro · Vite · Angular · Go · FastAPI · Django · Flask · Rust · Docker Compose · Makefile · npm scripts

Adding a new detector: append a `Detector` function in `stackDetector.ts` and add it to the `DETECTORS` array. Framework-specific detectors go before generic ones.

## Build & install

```bash
cd ~/code/devstack
npm install
npx tsc -p ./                              # compile
npx @vscode/vsce package --allow-missing-repository  # produce .vsix
code --install-extension devstack-0.1.0.vsix
```

Then reload the VS Code window.

## Commands

- `devstack.refresh` — rescan the workspace
- `devstack.startService` — launch a service (inline play button)
- `devstack.stopService` — stop a service (inline stop button)
- `devstack.editConfig` — open `.devstack.json` (creates a template if missing)

## Known limitations

- No real process status — closing the terminal is the only "stopped" signal. If a dev server crashes inside the terminal, DevStack still shows "running".
- No port detection / healthcheck.
- No multi-root workspace support.
- Docker Compose service detection uses a hand-rolled YAML parser (top-level `services:` block only). No full YAML dependency.

## Not in scope

- Multi-project dashboard — explicitly rejected by the user.
- Project switching — use VS Code's native Recent Workspaces.
