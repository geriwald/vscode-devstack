# DevStack

Auto-detect your project's tech stack and launch dev services from the VS Code activity bar.

![DevStack screenshot](resources/screenshot.png)

## Features

- **Auto-detection** of Next.js, Nuxt, Remix, Astro, Vite, Angular, Go, FastAPI, Django, Flask, Rust, Docker Compose, Makefile, and npm scripts
- **Activity bar panel** with services grouped by role: Frontend, Backend, Database, Infrastructure, Full Stack
- **Inline play/stop buttons** on each service
- **Status indicators**: running (green check) / stopped (empty circle)
- **Managed terminals** — each service runs in a labelled VS Code terminal
- **Config override** via `.devstack.json` at workspace root

## Usage

Open a project. Click the DevStack icon in the activity bar. Click play on any detected service.

### Custom services (optional)

DevStack auto-detects most things, but anything that's specific to your workflow — a one-off script, a project-local task, a meta-command like "rebuild this extension" — belongs in a `.devstack.json` at the workspace root (or use the gear icon in the DevStack panel to create one).

This very repo dogfoods its own config. The [.devstack.json](.devstack.json) checked in here defines a single "Reload Extension" service that repackages the `.vsix` and reinstalls it, so iterating on DevStack is one click in DevStack itself:

```json
{
  "services": [
    {
      "name": "Reload Extension",
      "role": "infra",
      "description": "Repackage the .vsix and reinstall it in VS Code",
      "command": "rm -f devstack-*.vsix && npx @vscode/vsce package --allow-missing-repository && code --install-extension devstack-*.vsix --force"
    }
  ],
  "disable": []
}
```

Each entry under `services` accepts `name`, `role`, `command`, and optional `description`, `cwd` (relative to the workspace root), `port`, and `url`. The sidebar shows `description` as the subtitle under the name — the command itself is no longer printed, only exposed as the tooltip on the service name. Valid roles: `frontend`, `backend`, `database`, `infra`, `fullstack`, `other`. `port` overrides the localhost port used to build the clickable link shown while the service runs; `url` overrides the full URL (useful for HTTPS, custom domains, or a sub-path). Use `disable` to hide auto-detected services by name.

### Scripts (one-shot commands)

Services model long-running processes (dev servers, watchers) with a start/stop lifecycle. For one-shot interactive REPLs, batch jobs, or anything that's meant to *finish*, use the `scripts` array instead. Scripts render in a dedicated **Scripts** section in the sidebar with a single Run action — no status indicator, no stop button, no URL handling. Each click opens a fresh terminal; concurrent runs are independent.

```json
{
  "scripts": [
    {
      "name": "Scan documents",
      "command": "bin/docpipe-scan",
      "description": "Duplex scan loop → ~/Scans/raw/"
    },
    {
      "name": "Compile once",
      "command": "npx tsc -p ./"
    }
  ]
}
```

Each entry under `scripts` accepts `name`, `command`, and optional `description` (one-line subtitle) and `cwd` (relative to the workspace root). Scripts are config-only — there is no auto-detection of `bin/` or `scripts/` entry points in this iteration.

## Web dashboard (`devstack serve`)

Beyond the VS Code sidebar, DevStack ships a standalone **web dashboard** for
when you need the full picture at once — typically a multi-service project with
a dev *and* a prod stack:

```bash
npm run serve -- --root /path/to/project --open   # or, once built: node out/cli.js serve -r . -o
```

It serves a localhost dashboard that:

- **starts/stops services** — dev (child processes it owns) and prod
  (`systemd --user` units, see below). Stopping a dev service kills the whole
  process group, so `tsx watch` / `uvicorn --reload` never leave an orphan on the port.
- shows each service's resolved **venv**, **`.env`/EnvironmentFile**, inline env
  (so you see mock vs real at a glance), mode, port and **live health**.
- **classifies every listening port** — *managed* (a service you run), *conflict*
  (your port held by a foreign process), *foreign* (another project), *project*
  (your repo, untracked) — so a squatted port is obvious.
- shows the **wiring** — which frontend proxies to which backend, which backend
  points at which service, and whether each target is up.
- **tiles live log panels** so all running services are visible at once; a new
  line flashes then fades so you see which panel moved.

The dashboard binds `127.0.0.1` only and rejects non-localhost Host headers — it
can start/kill processes, so never expose it. The port scan uses `ss` + `/proc`
(Linux).

### systemd (prod) services

A service in `.devstack.json` may be a systemd unit:

```json
{
  "name": "Backend (prod)",
  "role": "backend",
  "manager": "systemd",
  "unit": "popic-backend",
  "command": "systemctl --user start popic-backend",
  "port": 3000,
  "url": "http://127.0.0.1:3000/api/health"
}
```

The dashboard drives it via `systemctl --user` and streams `journalctl --user -u
<unit> -f`. The VS Code extension ignores `manager: "systemd"` services (they
have no terminal lifecycle). `venv` and `.env` are never declared — they are
derived from the live command / `systemctl show`.

## Build from source

```bash
npm install
npx tsc -p ./
npx @vscode/vsce package --allow-missing-repository
code --install-extension devstack-0.4.0.vsix
```

## License

MIT
