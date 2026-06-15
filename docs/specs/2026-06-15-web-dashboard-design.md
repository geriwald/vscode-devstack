# DevStack Web Dashboard — design

Date: 2026-06-15
Status: accepted (built same day, autonomous session)

## Problem

The DevStack VS Code extension launches services into managed terminals inside
the activity-bar sidebar. That sidebar is narrow and single-purpose: it cannot
show several live log streams side by side, it has no notion of *prod* services
(systemd), and it answers none of the operational questions that actually bite
during day-to-day work on a multi-service project like Popic:

- Which front-end is wired to which back-end right now?
- Is a port held by *this* project, or squatted by another project entirely?
- Is the backend actually healthy, or just "the terminal is still open"?
- Which `venv` and which `.env` is each service really using?
- A line just scrolled past in one of five log panels — *which* one moved?

This calls for a full-screen tool, not a sidebar. And it must eventually be
embeddable in a web app (Popic's maquette), which a VS Code webview can never be.

## Decision

Add a **standalone web dashboard** to DevStack, launched by a new CLI command
`devstack serve`. It is a *second front-end over the same core* (the
`.devstack.json` grammar, stack detection, service metadata). The VS Code
webview and the web dashboard share the config/model layer; they do **not**
share the process lifecycle:

- The extension runs services in **VS Code terminals** (`terminalManager.ts`).
- The dashboard runs them as **child processes** it owns directly
  (`server/processManager.ts`) and manages **systemd user units** for prod
  (`server/systemd.ts`).

This is a deliberate reversal of two items previously listed as "Not in scope"
in `CLAUDE.md`: *multi-project dashboard* and *dynamic port detection /
healthcheck*. They are now in scope, for the dashboard only.

### Architecture

```
src/core/        vscode-free, shared by extension + dashboard
  config.ts        read/merge/load .devstack.json (moved out of configManager.ts)
  wiring.ts        pure parsers: venv path, --env-file, inline KEY=val, *_URL/*_PORT refs
src/server/      dashboard backend (Node http, child_process, fs) — no vscode import
  types.ts         runtime DTOs (RuntimeService, LogLine, PortInfo, HealthInfo, WiringEdge)
  processManager.ts  spawn/kill dev services (own process group), ring-buffer logs, status
  systemd.ts       start/stop/status/journalctl for `manager: "systemd"` services
  inspector.ts     port scan (ss + /proc owner), health probes, wiring resolution
  httpServer.ts    static SPA + REST + SSE; exported factory for later embedding
src/cli.ts       arg parsing → launch the server
media/dashboard/ the SPA (index.html, app.js, style.css) — served as-is
```

`configManager.ts` keeps re-exporting the moved pure functions plus the
vscode-only `editConfig`, so the extension and its tests are untouched.

### Config grammar extension

A service may declare `"manager": "systemd"` with `"unit": "<name>"` (and
optional `"userScope": true`, default true). Such services are **prod** services:
the dashboard drives them via `systemctl --user`, and reads their logs via
`journalctl --user -u <unit> -f`. The VS Code extension **ignores** systemd
services (they have no terminal lifecycle); they are dashboard-only.

`venv` and `.env` are **never declared** — they are *derived* from the command
(dev) or from `systemctl show` (prod). Showing the real, resolved values is the
whole point; a hand-written field would lie the moment the command changes.

### Cross-project port classification

The dashboard scans every listening TCP socket (`ss -tlnpH`), resolves each
owner via `/proc/<pid>/{cwd,cmdline,comm}`, and classifies it:

1. **managed** — pid belongs to a dev service this dashboard started, or is the
   `MainPID` of a configured systemd service → linked to that service.
2. **conflict** — the port matches a configured service's port but is held by a
   process this dashboard did *not* start (stale/orphaned process, or another
   project on our port). Flagged loud.
3. **foreign** — anything else listening, labelled with its `comm` + cwd so the
   user can see *what* it is (e.g. another project's vite on 5173).

### Wiring graph

For each service, `wiring.ts` extracts references to other services from its
resolved env: any `*_URL=http://host:port` and any `*_PORT=NNNN` (other than the
service's own `PORT`), plus URL literals in the command. Each reference becomes
an edge `service → port`. The inspector resolves the target port to the
service/listener that owns it and whether it is listening, producing lines like:
`Popic frontend (:5173) --POPIC_BACKEND_PORT--> :3001 Backend·MOCK [up]`. (The
Vite `/api` proxy is captured this way because popic passes `POPIC_BACKEND_PORT`;
the dashboard does not parse `vite.config.ts`.)

### Log UX

- Every line is broadcast over SSE as `{serviceId, ts, stream, line}`.
- Per-service ring buffer (last N lines) so a new browser tab gets backlog.
- The SPA tiles one log panel per running service in a near-square grid
  (`cols = ceil(sqrt(n))`), each panel scrolling internally and tailing — all
  panels visible at once, re-tiled when the running count changes.
- A freshly appended line flashes an accent background that fades to transparent
  over ~4 s (CSS animation), and the panel header pulses, so the eye is drawn to
  *which* panel just moved.

## Acceptance criteria

1. `devstack serve --root <project>` serves a dashboard at `http://localhost:<port>`.
2. Dev services start/stop from the UI; stopping kills the **whole process group**
   (no orphaned `tsx watch` / `uvicorn --reload` children holding the port).
3. systemd (prod) services start/stop/status via the UI; their logs stream via journalctl.
4. Each service card shows its resolved `venv` and `.env`/EnvironmentFile, its
   inline env (mock vs real, target ports), mode badge, port, and live health.
5. The port panel lists every listener, classifying managed / conflict / foreign,
   so a port squatted by a non-project process is visible at a glance.
6. The wiring panel shows front→back→vision edges and whether each target is up.
7. Log panels auto-tile to all be visible; a new line flashes then fades.
8. The existing extension build (`npm run compile`) and tests (`npm test`) stay green.

## Scope

- New CLI `serve`, dashboard backend, dashboard SPA, `manager: "systemd"` support,
  port/health/wiring inspection. Refactor of pure config logic into `core/`.

## Out of scope

- Auth / remote exposure: the dashboard binds `127.0.0.1` only. It can start and
  kill arbitrary processes; it is a localhost dev tool, never exposed.
- Embedding into the Popic web app (the factory in `httpServer.ts` is shaped for
  it, but the mount is deferred — "pas urgent").
- Editing `.devstack.json` from the dashboard (use the extension's gear / an editor).
- Windows/macOS port scanning (`ss` + `/proc` are Linux-specific; documented).
