import { spawn, ChildProcess } from "child_process";
import { LogBus } from "./logBus";
import { run } from "./exec";
import { RuntimeStatus } from "./types";

export interface SystemdFacts {
  mainPid: number | null;
  activeState: string; // active | inactive | failed | activating | deactivating
  subState: string;
  startedAt: number | null;
  execStart: string | null;
  envFile: string | null;
  env: Record<string, string>;
}

/**
 * Drives a systemd unit (default `--user`). Lifecycle via `systemctl`, status
 * via `systemctl show`, logs via a long-lived `journalctl -f` follower piped
 * into the log bus. This is how the dashboard manages *prod* services.
 */
export class SystemdRunner {
  status: RuntimeStatus = "stopped";
  lastFacts: SystemdFacts | null = null;
  private follower?: ChildProcess;

  constructor(
    readonly id: string,
    private readonly unit: string,
    private readonly userScope: boolean,
    private readonly bus: LogBus,
    private readonly onChange: () => void
  ) {}

  private scopeArgs(): string[] {
    return this.userScope ? ["--user"] : [];
  }

  async start(): Promise<void> {
    this.status = "starting";
    this.onChange();
    const r = await run("systemctl", [...this.scopeArgs(), "start", this.unit]);
    if (r.code !== 0) {
      this.bus.system(this.id, `[systemctl start failed] ${r.stderr.trim() || r.stdout.trim()}`);
    }
    await this.refreshStatus();
    this.ensureFollower();
  }

  async stop(): Promise<void> {
    this.status = "stopping";
    this.onChange();
    const r = await run("systemctl", [...this.scopeArgs(), "stop", this.unit]);
    if (r.code !== 0) {
      this.bus.system(this.id, `[systemctl stop failed] ${r.stderr.trim() || r.stdout.trim()}`);
    }
    // Drop the journalctl follower; a new one is created on the next start.
    this.follower?.kill("SIGTERM");
    this.follower = undefined;
    await this.refreshStatus();
  }

  async restart(): Promise<void> {
    this.status = "starting";
    this.onChange();
    const r = await run("systemctl", [...this.scopeArgs(), "restart", this.unit]);
    if (r.code !== 0) {
      this.bus.system(this.id, `[systemctl restart failed] ${r.stderr.trim() || r.stdout.trim()}`);
    }
    await this.refreshStatus();
    this.ensureFollower();
  }

  /** Query systemctl for live facts and update `status`. */
  async refreshStatus(): Promise<SystemdFacts> {
    const props = [
      "ActiveState",
      "SubState",
      "MainPID",
      "ExecMainStartTimestamp",
      "ExecStart",
      "EnvironmentFiles",
      "Environment",
    ];
    const r = await run("systemctl", [
      ...this.scopeArgs(),
      "show",
      this.unit,
      "--property=" + props.join(","),
    ]);
    const map = parseShow(r.stdout);

    const activeState = map.ActiveState ?? "unknown";
    const subState = map.SubState ?? "";
    const mainPid = map.MainPID && map.MainPID !== "0" ? parseInt(map.MainPID, 10) : null;

    this.status =
      activeState === "active"
        ? "running"
        : activeState === "activating"
          ? "starting"
          : activeState === "deactivating"
            ? "stopping"
            : activeState === "failed"
              ? "error"
              : "stopped";

    const facts: SystemdFacts = {
      mainPid,
      activeState,
      subState,
      startedAt: parseSystemdTimestamp(map.ExecMainStartTimestamp),
      execStart: parseExecStart(map.ExecStart),
      envFile: parseEnvironmentFiles(map.EnvironmentFiles),
      env: parseEnvironment(map.Environment),
    };
    this.lastFacts = facts;
    this.onChange();
    if (this.status === "running") {
      this.ensureFollower();
    }
    return facts;
  }

  /** Start a single journalctl follower if not already running. */
  private ensureFollower(): void {
    if (this.follower) {
      return;
    }
    const follower = spawn(
      "journalctl",
      [...this.scopeArgs(), "-u", this.unit, "-f", "-n", "200", "-o", "cat", "--no-pager"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.follower = follower;
    follower.stdout?.on("data", (d: Buffer) => this.bus.push(this.id, "out", d.toString()));
    follower.stderr?.on("data", (d: Buffer) => this.bus.push(this.id, "err", d.toString()));
    follower.on("exit", () => {
      if (this.follower === follower) {
        this.follower = undefined;
      }
    });
  }

  dispose(): void {
    this.follower?.kill("SIGTERM");
    this.follower = undefined;
  }
}

function parseShow(stdout: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      map[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return map;
}

/** ExecStart=`{ path=/usr/bin/npm ; argv[]=/usr/bin/npm start ; ... }` → "/usr/bin/npm start" */
function parseExecStart(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  const m = raw.match(/argv\[\]=([^;]+?)\s*;/);
  return m ? m[1].trim() : null;
}

/** EnvironmentFiles=`/home/.../.env (ignore_errors=no)` → "/home/.../.env"
 * (the path may contain spaces; the ` (ignore_errors=…)` suffix delimits it). */
function parseEnvironmentFiles(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  const path = raw.split(/\s*\(ignore_errors=[^)]*\)/)[0].trim();
  return path || null;
}

/** Environment=`PORT=3000 IMAGE_ENGINE=gemini` → { PORT:"3000", IMAGE_ENGINE:"gemini" } */
function parseEnvironment(raw?: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!raw) {
    return env;
  }
  for (const tok of raw.trim().split(/\s+/)) {
    const eq = tok.indexOf("=");
    if (eq > 0) {
      env[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
  }
  return env;
}

function parseSystemdTimestamp(raw?: string): number | null {
  if (!raw || raw === "n/a" || raw.trim() === "") {
    return null;
  }
  // e.g. "Thu 2026-06-05 16:58:00 CEST". Date.parse chokes on the tz abbreviation,
  // so strip the weekday prefix AND the trailing tz token → parsed as local time.
  const cleaned = raw
    .replace(/^[A-Za-z]{3}\s+/, "")
    .replace(/\s+[A-Za-z]{2,5}$/, "");
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? null : t;
}
