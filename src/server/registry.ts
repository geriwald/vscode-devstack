import { spawn } from "child_process";
import { ServiceDefinition, ScriptDefinition } from "../types";
import { getServiceMeta } from "../serviceMeta";
import { parseCommandFacts, extractWiringRefs } from "../core/wiring";
import { LogBus } from "./logBus";
import { ProcessRunner, resolveCwd } from "./procRunner";
import { SystemdRunner } from "./systemdRunner";
import { scanListeners, classifyPorts, probeHealth } from "./inspector";
import { RuntimeService, RuntimeScript, Snapshot, WiringEdge, HealthInfo } from "./types";

type Runner = ProcessRunner | SystemdRunner;

export function serviceId(s: { role: string; name: string }): string {
  return `${s.role}::${s.name}`;
}

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|_PW|CREDENTIAL|AUTH)/i;

/** Show only a short prefix of a secret value — never the whole secret. */
function maskValue(value: string): string {
  if (value.length <= 6) {
    return "••••";
  }
  return `${value.slice(0, 4)}…(${value.length})`;
}

/** Mask values of secret-looking env keys (Géraud's rule: prefix, never the key). */
function maskEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SECRET_KEY.test(k) ? maskValue(v) : v;
  }
  return out;
}

/** Redact inline `SECRET_KEY=value` assignments in a command string. */
function redactCommand(command: string): string {
  return command.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g,
    (m, k: string, v: string) => (SECRET_KEY.test(k) ? `${k}=${maskValue(v)}` : m)
  );
}

/**
 * Owns every runner for a project and assembles the dashboard snapshot
 * (services + classified ports). One Registry per `devstack serve` process.
 */
export class Registry {
  private runners = new Map<string, Runner>();
  private scriptRuns = new Map<string, number>();

  constructor(
    private readonly projectRoot: string,
    private readonly services: ServiceDefinition[],
    private readonly scripts: ScriptDefinition[],
    private readonly bus: LogBus,
    private readonly onChange: () => void,
    private readonly selfPort: number
  ) {
    for (const svc of services) {
      const id = serviceId(svc);
      if (svc.manager === "systemd" && svc.unit) {
        this.runners.set(
          id,
          new SystemdRunner(id, svc.unit, svc.userScope !== false, bus, onChange)
        );
      } else {
        this.runners.set(
          id,
          new ProcessRunner(id, svc.command ?? "", resolveCwd(projectRoot, svc.cwd), bus, onChange)
        );
      }
    }
  }

  /** Refresh systemd statuses once at startup so prod state shows immediately. */
  async init(): Promise<void> {
    await Promise.all(
      [...this.runners.values()]
        .filter((r): r is SystemdRunner => r instanceof SystemdRunner)
        .map((r) => r.refreshStatus())
    );
  }

  hasService(id: string): boolean {
    return this.runners.has(id);
  }

  async start(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (r) {
      await r.start();
    }
  }

  async stop(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (r) {
      await r.stop();
    }
  }

  async restart(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (!r) {
      return;
    }
    if (r instanceof SystemdRunner) {
      await r.restart();
    } else {
      // Wait for the group to ACTUALLY exit (stop resolves on exit) before
      // relaunching — never spawn a second generation onto the same port.
      await r.stop();
      r.start();
    }
  }

  /** Run a one-shot script in a fresh detached process; logs go to a channel. */
  runScript(id: string): string | null {
    const script = this.scripts.find((s) => s.name === id);
    if (!script) {
      return null;
    }
    const n = (this.scriptRuns.get(id) ?? 0) + 1;
    this.scriptRuns.set(id, n);
    const channel = `script::${id}::${n}`;
    const child = spawn("/bin/bash", ["-c", script.command], {
      cwd: resolveCwd(this.projectRoot, script.cwd),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.bus.system(channel, `[run] ${script.command}`);
    child.stdout?.on("data", (d: Buffer) => this.bus.push(channel, "out", d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.bus.push(channel, "err", d.toString()));
    child.on("exit", (code, signal) => {
      this.bus.flush(channel);
      this.bus.system(channel, `[done] ${signal ? `signal ${signal}` : `code ${code}`}`);
      this.onChange();
    });
    this.onChange();
    return channel;
  }

  /** SIGTERM every group, wait briefly for clean exits, SIGKILL stragglers. */
  async shutdown(): Promise<void> {
    const procs = [...this.runners.values()].filter(
      (r): r is ProcessRunner => r instanceof ProcessRunner
    );
    const stops = procs.map((r) => r.stop());
    await Promise.race([
      Promise.all(stops),
      new Promise((res) => setTimeout(res, 1800)),
    ]);
    for (const r of procs) {
      r.forceKill();
    }
    for (const r of this.runners.values()) {
      if (r instanceof SystemdRunner) {
        r.dispose();
      }
    }
  }

  async buildSnapshot(projectName: string): Promise<Snapshot> {
    // 1. Refresh systemd statuses (cheap; reflects external start/stop too).
    await Promise.all(
      [...this.runners.values()]
        .filter((r): r is SystemdRunner => r instanceof SystemdRunner)
        .map((r) => r.refreshStatus())
    );

    // 2. Scan ports once.
    const listeners = await scanListeners();
    const listeningPorts = new Set(listeners.map((l) => l.port));

    const managedPgids = new Map<number, string>();
    const systemdUnits = new Map<string, string>();
    const expectedPorts = new Map<number, string>();
    const portToRunning = new Map<number, string>();
    const portToAny = new Map<number, string>();

    for (const svc of this.services) {
      const id = serviceId(svc);
      const r = this.runners.get(id);
      if (svc.port) {
        expectedPorts.set(svc.port, svc.name);
        portToAny.set(svc.port, svc.name);
      }
      if (r instanceof ProcessRunner && r.status === "running" && r.pgid !== null) {
        managedPgids.set(r.pgid, svc.name);
        if (svc.port) {
          portToRunning.set(svc.port, svc.name);
        }
      }
      if (r instanceof SystemdRunner && svc.unit) {
        systemdUnits.set(svc.unit, svc.name);
        if (svc.port && r.status === "running") {
          portToRunning.set(svc.port, svc.name);
        }
      }
    }

    const ports = classifyPorts(listeners, {
      projectRoot: this.projectRoot,
      managedPgids,
      systemdUnits,
      expectedPorts,
      selfPort: this.selfPort,
    });

    // 3. Build each service DTO; probe health in parallel.
    const services = await Promise.all(
      this.services.map((svc) =>
        this.buildService(svc, listeningPorts, portToRunning, portToAny)
      )
    );

    const scripts: RuntimeScript[] = this.scripts.map((s) => ({
      id: s.name,
      name: s.name,
      description: s.description,
      group: s.group,
    }));

    return {
      project: { name: projectName, root: this.projectRoot },
      generatedAt: Date.now(),
      services,
      scripts,
      ports,
    };
  }

  private async buildService(
    svc: ServiceDefinition,
    listeningPorts: Set<number>,
    portToRunning: Map<number, string>,
    portToAny: Map<number, string>
  ): Promise<RuntimeService> {
    const id = serviceId(svc);
    const r = this.runners.get(id);
    const meta = getServiceMeta(svc.command, svc.tech);

    let status: RuntimeService["status"] = "stopped";
    let pid: number | null = null;
    let uptimeMs: number | null = null;
    let venv: string | null = null;
    let interpreter: string | null = null;
    let envFile: string | null = null;
    let env: Record<string, string> = {};
    let command = svc.command ?? "";

    if (r instanceof ProcessRunner) {
      status = r.status;
      pid = r.pid;
      uptimeMs = r.uptimeMs();
      const facts = parseCommandFacts(command);
      venv = facts.venv ?? null;
      interpreter = facts.interpreter ?? null;
      envFile = facts.envFile ?? null;
      env = facts.envAssignments;
    } else if (r instanceof SystemdRunner) {
      status = r.status;
      const f = r.lastFacts;
      pid = f?.mainPid ?? null;
      uptimeMs = f?.startedAt ? Date.now() - f.startedAt : null;
      envFile = f?.envFile ?? null;
      env = f?.env ?? {};
      if (f?.execStart) {
        command = f.execStart;
        const facts = parseCommandFacts(f.execStart);
        venv = facts.venv ?? null;
        interpreter = facts.interpreter ?? null;
      }
    }

    // Wiring edges from the resolved env (covers both inline dev env and systemd
    // Environment=) plus any URL literal in the command, against the listening set.
    const wiring: WiringEdge[] = extractWiringRefs({ envAssignments: env }, command).map((ref) => ({
      label: ref.label,
      targetHost: ref.targetHost,
      targetPort: ref.targetPort,
      resolved: portToRunning.get(ref.targetPort) ?? portToAny.get(ref.targetPort) ?? null,
      up: listeningPorts.has(ref.targetPort),
    }));

    // Health: only meaningful while the service runs and exposes a URL.
    let health: HealthInfo | null = null;
    if (svc.url && status === "running") {
      health = await probeHealth(svc.url);
    }

    return {
      id,
      name: svc.name,
      role: svc.role,
      manager: svc.manager === "systemd" ? "systemd" : "process",
      unit: svc.unit,
      mode: meta.mode ?? null,
      modeLabel: meta.modeLabel ?? (svc.manager === "systemd" ? "prod · systemd" : null),
      status,
      command: redactCommand(command),
      cwd: svc.cwd,
      port: svc.port,
      url: svc.url,
      pid,
      uptimeMs,
      venv,
      interpreter,
      envFile,
      env: maskEnv(env),
      health,
      wiring,
    };
  }
}
