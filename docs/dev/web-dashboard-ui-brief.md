# DevStack Web Dashboard — UI brief & API contract

This is the brief for the **front-end** of the DevStack web dashboard, and the
authoritative **HTTP API contract** the back-end implements. The back-end is
being built in parallel (`src/server/*`, `src/cli.ts`). The UI is fully
independent: it talks to the documented API only.

## What you own

Three files, served as-is by the back-end (no build step, no framework):

```
media/dashboard/index.html
media/dashboard/style.css
media/dashboard/app.js
```

Do **not** touch anything under `src/` — that is the back-end's territory.

If `media/dashboard/index.html` is absent, the server serves a placeholder; once
you create these three files, the server serves yours.

## What this dashboard is for

DevStack launches the dev/prod services of a project (here: Popic — a Python
vision service, a Node backend, a Vite frontend; plus systemd prod units). This
dashboard is a **full-screen mission-control** to run them and *catch wiring
mistakes*: a port squatted by another project, a frontend pointing at the wrong
backend, a backend that's "up" but unhealthy, the wrong `.env`/`venv` in use.

## Hard UX requirements (from the product owner)

1. **Service control** — start / stop / restart each service from the UI.
   Distinguish **dev** vs **prod** (systemd) and **mock** vs **real** (visible
   from each service's inline env, e.g. `IMAGE_ENGINE=mock`).
2. **venv & .env visibility** — each service card shows its resolved interpreter
   `venv`, its `.env` / EnvironmentFile path, and its key inline env vars.
3. **Health** — a live health dot per service (healthy / unhealthy / down / unknown)
   with latency.
4. **Port panel** — every listening TCP port on the machine, each classified:
   `managed` (a service we run), `conflict` (our port held by a process we did
   NOT start — flag it loud), `foreign` (another project / unrelated), `project`
   (our repo, untracked). Show pid + comm + cwd so the user sees *what* it is.
5. **Wiring panel** — show the edges: which frontend proxies to which backend,
   which backend points at which vision service, and whether each target is up.
   e.g. `Popic frontend :5173 --proxy--> :3001 Backend·MOCK [healthy]`.
6. **Tiled log panels** — one panel per **running** service, auto-arranged into a
   near-square grid so **all are visible at once** (no tabs, no scrolling between
   them). Re-tile when the running count changes. Each panel tails its own log
   and scrolls internally.
7. **Fade-on-update** — when a new log line arrives, it flashes an accent
   background that fades to transparent over ~4 s, and the panel header pulses,
   so the eye is drawn to *which* panel just moved. This is the headline feature.

## Aesthetic direction

A refined **dark "mission control" / ops-console** look (on screen all day; the
fade highlight reads best on dark). You have creative latitude — make it feel
crafted, not a generic admin template. Suggested baseline (tune freely):

- bg `#0e1116`, surface `#161b22`, raised `#1c222b`, border `#232a33`
- text `#e6edf3`, muted `#8b949e`
- accent (DevStack identity) `#a371f7` (purple); hover `#bda7f0`
- status: running/healthy `#3fb950`, starting/degraded `#d29922`,
  error/down/conflict `#f85149`, stopped/foreign `#6e7681`
- logs in a monospace stack (`ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace`)
- UI font: system stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
  Avoid hard CDN dependencies (this runs offline). Codicons are bundled at
  `media/codicons/codicon.css` if you want icons; otherwise inline SVG/emoji.

Layout suggestion (yours to refine): a top bar (project name, global
start-all/stop-all, health summary), a left/top region with the service cards +
port panel + wiring panel, and the **log grid filling the rest of the viewport**.
The log grid is the star — give it the most space.

## Technical constraints

- **Vanilla JS** (ES modules ok), no framework, no bundler. The file is loaded as
  `<script type="module" src="app.js">`. No `npm install`.
- One `EventSource("/api/events")` for live updates. One `fetch` for actions.
- **Dedupe log lines by `seq`** (monotonic int). On (re)connect the server
  replays the recent buffer as `log` events with their original `seq`; keep a
  `lastSeq` and ignore `seq <= lastSeq`.
- Keep DOM updates cheap: cap each panel at ~500 lines (drop oldest).

## Develop against a fixture (no back-end needed)

Drop a `state.json` next to your files and `fetch('state.json')` while iterating,
then switch to `/api/state`. To fake live logs, `setInterval` appending synthetic
`log` events. A realistic snapshot:

```json
{
  "project": { "name": "popic", "root": "/home/geraud/code/popic" },
  "generatedAt": 1718450000000,
  "services": [
    {
      "id": "backend::Vision · DEBUG", "name": "Vision · DEBUG", "role": "backend",
      "manager": "process", "mode": "dev", "modeLabel": "dev · hot reload",
      "status": "running", "pid": 40111, "uptimeMs": 932000,
      "command": "VISION_DEBUG=1 /home/geraud/ComfyUI/venv/bin/python -m uvicorn vision.src.api:app --host 127.0.0.1 --port 8781 --reload",
      "cwd": ".", "port": 8781, "url": "http://127.0.0.1:8781/health",
      "venv": "/home/geraud/ComfyUI/venv", "interpreter": "/home/geraud/ComfyUI/venv/bin/python",
      "envFile": null, "env": { "VISION_DEBUG": "1" },
      "health": { "state": "healthy", "httpStatus": 200, "latencyMs": 8, "checkedAt": 1718450000000, "detail": "" },
      "wiring": []
    },
    {
      "id": "backend::Backend · MOCK", "name": "Backend · MOCK", "role": "backend",
      "manager": "process", "mode": "dev", "modeLabel": "dev · hot reload",
      "status": "running", "pid": 40222, "uptimeMs": 88000,
      "command": "PORT=3001 VISION_URL=http://127.0.0.1:8781 IMAGE_ENGINE=mock node --env-file=../.env node_modules/.bin/tsx watch src/index.ts",
      "cwd": "backend", "port": 3001, "url": "http://localhost:3001/api/health",
      "venv": null, "interpreter": null, "envFile": "../.env",
      "env": { "PORT": "3001", "VISION_URL": "http://127.0.0.1:8781", "IMAGE_ENGINE": "mock", "TEXT_ENGINE": "claude" },
      "health": { "state": "healthy", "httpStatus": 200, "latencyMs": 14, "checkedAt": 1718450000000, "detail": "" },
      "wiring": [
        { "label": "VISION_URL", "targetHost": "127.0.0.1", "targetPort": 8781, "resolved": "Vision · DEBUG", "up": true }
      ]
    },
    {
      "id": "frontend::Popic frontend", "name": "Popic frontend", "role": "frontend",
      "manager": "process", "mode": "dev", "modeLabel": "dev · HMR",
      "status": "running", "pid": 40333, "uptimeMs": 60000,
      "command": "POPIC_BACKEND_PORT=3001 npm run dev", "cwd": "frontend",
      "port": 5173, "url": "http://localhost:5173",
      "venv": null, "interpreter": null, "envFile": null,
      "env": { "POPIC_BACKEND_PORT": "3001" },
      "health": { "state": "healthy", "httpStatus": 200, "latencyMs": 5, "checkedAt": 1718450000000, "detail": "" },
      "wiring": [
        { "label": "POPIC_BACKEND_PORT", "targetPort": 3001, "resolved": "Backend · MOCK", "up": true }
      ]
    },
    {
      "id": "backend::Backend (prod)", "name": "Backend (prod)", "role": "backend",
      "manager": "systemd", "unit": "popic-backend", "mode": "prod", "modeLabel": "prod · systemd",
      "status": "running", "pid": 1688, "uptimeMs": 864000000,
      "command": "/usr/bin/npm start", "cwd": "/home/geraud/popic-prod/backend",
      "port": 3000, "url": "http://127.0.0.1:3000/api/health",
      "venv": null, "interpreter": null, "envFile": "/home/geraud/popic-prod/.env",
      "env": { "PORT": "3000", "IMAGE_ENGINE": "gemini", "TEXT_ENGINE": "claude", "VISION_URL": "http://127.0.0.1:8780" },
      "health": { "state": "healthy", "httpStatus": 200, "latencyMs": 22, "checkedAt": 1718450000000, "detail": "" },
      "wiring": [
        { "label": "VISION_URL", "targetHost": "127.0.0.1", "targetPort": 8780, "resolved": "Vision (prod)", "up": true }
      ]
    },
    {
      "id": "backend::Backend · image MOCK", "name": "Backend · image MOCK", "role": "backend",
      "manager": "process", "mode": "dev", "modeLabel": "dev · hot reload",
      "status": "stopped", "pid": null, "uptimeMs": null,
      "command": "PORT=3001 IMAGE_ENGINE=mock TEXT_ENGINE=claude node --env-file=../.env node_modules/.bin/tsx watch src/index.ts",
      "cwd": "backend", "port": 3001, "url": "http://localhost:3001/api/health",
      "venv": null, "interpreter": null, "envFile": "../.env",
      "env": { "PORT": "3001", "IMAGE_ENGINE": "mock", "TEXT_ENGINE": "claude" },
      "health": null, "wiring": []
    }
  ],
  "scripts": [
    { "id": "Planches debug · pipeline backend", "name": "Planches debug · pipeline backend", "description": "One A4 debug sheet per run", "group": "planches" },
    { "id": "Logs PROD · backend (systemd)", "name": "Logs PROD · backend (systemd)", "description": "journalctl -u popic-backend -f", "group": "logs prod" }
  ],
  "ports": [
    { "port": 8781, "address": "127.0.0.1", "pid": 40111, "comm": "python", "cwd": "/home/geraud/code/popic", "cmdline": "python -m uvicorn vision.src.api:app --reload", "ownership": "managed", "service": "Vision · DEBUG", "note": "" },
    { "port": 3001, "address": "0.0.0.0", "pid": 40222, "comm": "node", "cwd": "/home/geraud/code/popic/backend", "cmdline": "tsx watch src/index.ts", "ownership": "managed", "service": "Backend · MOCK", "note": "" },
    { "port": 5173, "address": "0.0.0.0", "pid": 40333, "comm": "node", "cwd": "/home/geraud/code/popic/frontend", "cmdline": "vite", "ownership": "managed", "service": "Popic frontend", "note": "" },
    { "port": 3000, "address": "0.0.0.0", "pid": 1688, "comm": "node", "cwd": "/home/geraud/popic-prod/backend", "cmdline": "npm start", "ownership": "managed", "service": "Backend (prod)", "note": "" },
    { "port": 8780, "address": "127.0.0.1", "pid": 1380, "comm": "python", "cwd": "/home/geraud/popic-prod", "cmdline": "uvicorn vision.src.api:app", "ownership": "managed", "service": "Vision (prod)", "note": "" },
    { "port": 5173, "address": "0.0.0.0", "pid": 9999, "comm": "node", "cwd": "/home/geraud/code/other-project", "cmdline": "vite", "ownership": "conflict", "service": "Popic frontend", "note": "another project holds Popic's dev port" },
    { "port": 11434, "address": "127.0.0.1", "pid": 1212, "comm": "ollama", "cwd": "/", "cmdline": "ollama serve", "ownership": "foreign", "service": null, "note": "" }
  ]
}
```

### Field semantics

- `service.status`: `stopped | starting | running | stopping | error`.
- `service.health` is `null` when no health URL; else `state`:
  `healthy | unhealthy | down | unknown`.
- `service.manager`: `process` (dev, we own the child) or `systemd` (prod).
- `service.mode` may be `null`; prefer `modeLabel` for the badge text.
- `port.ownership`: `managed | conflict | foreign | project`.

## Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/state` | — | the snapshot above |
| GET | `/api/events` | — | SSE stream (see below) |
| GET | `/api/logs/:id` | `?tail=500` | `{ "id", "lines": [ { "seq", "ts", "stream", "line" } ] }` |
| POST | `/api/services/:id/start` | — | `{ "ok": true, "status": "starting" }` |
| POST | `/api/services/:id/stop` | — | `{ "ok": true, "status": "stopping" }` |
| POST | `/api/services/:id/restart` | — | `{ "ok": true, "status": "starting" }` |
| POST | `/api/scripts/:id/run` | — | `{ "ok": true, "channel": "script::<id>::<n>" }` |

`:id` is the service/script `id` field, `encodeURIComponent`-ed in the path.

### SSE `/api/events`

`EventSource` with three named events (all `data:` are JSON):

- `event: snapshot` — full snapshot (same shape as `/api/state`). Sent on
  connect and after every inspector refresh (~3 s) and after any start/stop.
  Render all cards/ports/wiring from this.
- `event: log` — `{ "id", "seq", "ts", "stream": "out"|"err"|"sys", "line" }`. One
  per log line. `sys` is a synthetic dashboard line (`[started]`, `[exited]`, …).
  Replayed from the ring buffer on connect (same `seq` values → dedupe). `id` may
  be a `script::...` channel for one-shot script runs.
- `event: status` — reserved. The current server folds status into the
  `snapshot` (debounced ~150 ms after any change), so consume `snapshot` for
  status; a dedicated `status` event is not emitted yet.

## Suggested invocation

Consider running `/frontend-design` for the visual craft. Keep it a single
cohesive theme; the log grid + fade is the signature interaction — make it feel alive.
