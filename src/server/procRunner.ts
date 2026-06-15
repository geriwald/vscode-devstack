import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { LogBus } from "./logBus";
import { RuntimeStatus } from "./types";

const SIGKILL_GRACE_MS = 5000;

/**
 * Owns a single dev service as a child process. The command runs under
 * `/bin/bash -c` in its own process *group* (detached → setsid), so stopping
 * kills the WHOLE group — not just bash. This is what prevents `tsx watch` and
 * `uvicorn --reload` from leaving an orphaned worker holding the port.
 *
 * Lifecycle invariant: at most one child generation is ever live. `start()`
 * refuses while stopping, and `stop()` resolves only once the group has actually
 * exited, so callers (e.g. restart) sequence cleanly without overlap.
 */
export class ProcessRunner {
  status: RuntimeStatus = "stopped";
  pid: number | null = null;
  /** Process-group id (== child.pid for a detached leader). */
  pgid: number | null = null;
  startedAt: number | null = null;
  private child?: ChildProcess;
  private killTimer?: NodeJS.Timeout;
  private exitWaiters: Array<() => void> = [];

  constructor(
    readonly id: string,
    private readonly command: string,
    private readonly cwd: string,
    private readonly bus: LogBus,
    private readonly onChange: () => void
  ) {}

  start(): void {
    // Refuse while a generation is live or still dying — no overlapping spawns.
    if (this.status === "running" || this.status === "starting" || this.status === "stopping") {
      return;
    }
    this.status = "starting";
    this.startedAt = Date.now();

    const child = spawn("/bin/bash", ["-c", this.command], {
      cwd: this.cwd,
      env: process.env,
      detached: true, // own process group so we can signal the whole tree
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.pid = child.pid ?? null;
    this.pgid = child.pid ?? null;

    child.stdout?.on("data", (d: Buffer) => this.bus.push(this.id, "out", d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.bus.push(this.id, "err", d.toString()));

    child.on("spawn", () => {
      if (this.child !== child) {
        return;
      }
      this.status = "running";
      this.bus.system(this.id, `[started] pid ${this.pid} · ${this.command}`);
      this.onChange();
    });

    child.on("error", (err) => {
      if (this.child !== child) {
        return;
      }
      this.status = "error";
      this.bus.system(this.id, `[spawn error] ${err.message}`);
      this.onChange();
    });

    child.on("exit", (code, signal) => {
      // Guard against a stale generation's exit clobbering a newer child.
      if (this.child !== child) {
        return;
      }
      this.bus.flush(this.id);
      const clean = code === 0 || this.status === "stopping";
      this.status = clean ? "stopped" : "error";
      this.bus.system(this.id, `[exited] ${signal ? `signal ${signal}` : `code ${code}`}`);
      this.pid = null;
      this.pgid = null;
      this.child = undefined;
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = undefined;
      }
      this.onChange();
      const waiters = this.exitWaiters;
      this.exitWaiters = [];
      for (const w of waiters) {
        w();
      }
    });
  }

  /** Stop the group; resolves once the child has actually exited. */
  stop(): Promise<void> {
    if (!this.child || this.pgid === null) {
      this.status = "stopped";
      this.onChange();
      return Promise.resolve();
    }
    if (this.status !== "stopping") {
      this.status = "stopping";
      this.onChange();
      this.signalGroup("SIGTERM");
      this.killTimer = setTimeout(() => {
        if (this.child) {
          this.bus.system(this.id, "[force kill] SIGKILL after grace period");
          this.signalGroup("SIGKILL");
        }
      }, SIGKILL_GRACE_MS);
    }
    return new Promise<void>((resolve) => this.exitWaiters.push(resolve));
  }

  /** Immediate SIGKILL of the group (used on dashboard shutdown). */
  forceKill(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
    this.signalGroup("SIGKILL");
  }

  private signalGroup(sig: NodeJS.Signals): void {
    if (this.pgid === null) {
      return;
    }
    try {
      // Negative pid → signal the entire process group.
      process.kill(-this.pgid, sig);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ESRCH") {
        this.bus.system(this.id, `[kill error] ${e.message}`);
      }
    }
  }

  uptimeMs(): number | null {
    return this.status === "running" && this.startedAt ? Date.now() - this.startedAt : null;
  }
}

/** Resolve a service cwd (relative to the project root) to an absolute path. */
export function resolveCwd(projectRoot: string, cwd?: string): string {
  if (!cwd || cwd === ".") {
    return projectRoot;
  }
  return path.isAbsolute(cwd) ? cwd : path.join(projectRoot, cwd);
}
