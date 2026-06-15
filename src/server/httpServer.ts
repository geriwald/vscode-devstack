import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { ServiceDefinition, ScriptDefinition } from "../types";
import { LogBus } from "./logBus";
import { Registry, serviceId } from "./registry";
import { Snapshot } from "./types";
import { fallbackPage } from "./fallbackPage";

export interface DashboardOptions {
  projectRoot: string;
  projectName: string;
  services: ServiceDefinition[];
  scripts: ScriptDefinition[];
  port: number;
  host?: string;
  /** Directory holding the SPA (index.html, app.js, style.css). */
  dashboardDir: string;
  refreshMs?: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/**
 * Build the dashboard HTTP server. Exposed as a factory (not auto-listening) so
 * it can later be mounted by another app. Binds localhost only and rejects
 * non-localhost Host headers (DNS-rebinding guard) — it can kill processes.
 */
export function createDashboardServer(opts: DashboardOptions): { server: http.Server; start: () => Promise<void> } {
  const host = opts.host ?? "127.0.0.1";
  const refreshMs = opts.refreshMs ?? 3000;
  const bus = new LogBus();

  let latest: Snapshot | null = null;
  let rebuildPending = false;
  let refreshTimer: NodeJS.Timeout | null = null;

  const sseClients = new Set<http.ServerResponse>();

  const registry = new Registry(
    opts.projectRoot,
    opts.services,
    opts.scripts,
    bus,
    () => scheduleRebuild(),
    opts.port
  );

  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  }

  async function rebuild(): Promise<void> {
    latest = await registry.buildSnapshot(opts.projectName);
    broadcast("snapshot", latest);
  }

  function scheduleRebuild(): void {
    if (rebuildPending) {
      return;
    }
    rebuildPending = true;
    setTimeout(async () => {
      rebuildPending = false;
      try {
        await rebuild();
      } catch {
        /* a transient scan/probe failure must not crash the loop */
      }
    }, 150);
  }

  // Stream every log line to SSE clients.
  bus.subscribe((line) => broadcast("log", line));

  const server = http.createServer((req, res) => handle(req, res));

  function isLocalHost(req: http.IncomingMessage): boolean {
    const h = (req.headers.host ?? "").split(":")[0];
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  }

  // CSRF guard for mutating requests: a cross-site POST carries the attacker's
  // Origin (the Host-header guard does NOT catch this — the browser still sends
  // Host: localhost). Reject any POST whose Origin is set and not localhost.
  // Absent Origin = a non-browser client (curl, the CLI) → allowed.
  function isAllowedOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) {
      return true;
    }
    try {
      const h = new URL(origin).hostname;
      return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
    } catch {
      return false;
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // DNS-rebinding guard: only localhost Host headers may reach the API.
    if (pathname.startsWith("/api/") && !isLocalHost(req)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    // CSRF guard: a mutating request must not come from a foreign Origin.
    if (pathname.startsWith("/api/") && req.method === "POST" && !isAllowedOrigin(req)) {
      res.writeHead(403).end("forbidden: cross-origin");
      return;
    }

    try {
      if (pathname === "/api/state") {
        const snap = latest ?? (await registry.buildSnapshot(opts.projectName));
        return sendJson(res, 200, snap);
      }
      if (pathname === "/api/events") {
        return handleSse(req, res);
      }
      if (pathname.startsWith("/api/logs/")) {
        const id = pathname.slice("/api/logs/".length);
        const tail = parseInt(url.searchParams.get("tail") ?? "500", 10);
        return sendJson(res, 200, { id, lines: bus.tail(id, Number.isFinite(tail) ? tail : 500) });
      }
      if (req.method === "POST" && pathname.startsWith("/api/services/")) {
        return await handleServiceAction(pathname, res);
      }
      if (req.method === "POST" && pathname.startsWith("/api/scripts/")) {
        const m = pathname.match(/^\/api\/scripts\/(.+)\/run$/);
        if (m) {
          const channel = registry.runScript(m[1]);
          return sendJson(res, channel ? 200 : 404, channel ? { ok: true, channel } : { ok: false });
        }
      }
      return serveStatic(pathname, res);
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  }

  async function handleServiceAction(pathname: string, res: http.ServerResponse): Promise<void> {
    const m = pathname.match(/^\/api\/services\/(.+)\/(start|stop|restart)$/);
    if (!m) {
      return sendJson(res, 404, { ok: false });
    }
    const id = m[1];
    const action = m[2];
    if (!registry.hasService(id)) {
      return sendJson(res, 404, { ok: false, error: "unknown service" });
    }
    if (action === "start") {
      await registry.start(id);
    } else if (action === "stop") {
      await registry.stop(id);
    } else {
      await registry.restart(id);
    }
    scheduleRebuild();
    const status = action === "stop" ? "stopping" : "starting";
    sendJson(res, 200, { ok: true, status });
  }

  function handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    sseClients.add(res);

    // Initial snapshot, then replay the recent log buffer (same seq → dedupe).
    if (latest) {
      res.write(`event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`);
    }
    for (const line of bus.recent(1000)) {
      res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
    }

    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  }

  function serveStatic(pathname: string, res: http.ServerResponse): void {
    const rel = pathname === "/" ? "/index.html" : pathname;
    const target = path.normalize(path.join(opts.dashboardDir, rel));
    // Path-traversal guard: never escape the dashboard dir.
    if (!target.startsWith(path.normalize(opts.dashboardDir))) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream" });
      const stream = fs.createReadStream(target);
      stream.on("error", () => res.destroy()); // a mid-pipe read error must not crash the process
      stream.pipe(res);
      return;
    }
    // No SPA built yet (or unknown asset): serve the diagnostic fallback at /.
    if (rel === "/index.html") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(fallbackPage(opts.projectName));
      return;
    }
    res.writeHead(404).end("not found");
  }

  function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify(body));
  }

  async function start(): Promise<void> {
    await registry.init();
    await rebuild();
    refreshTimer = setInterval(() => scheduleRebuild(), refreshMs);
    await new Promise<void>((resolve) => server.listen(opts.port, host, resolve));

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      await registry.shutdown(); // SIGTERM groups, wait, SIGKILL stragglers — no orphans
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  return { server, start };
}
