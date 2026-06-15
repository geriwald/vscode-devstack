import * as fs from "fs";
import { run } from "./exec";
import { HealthInfo, PortInfo, PortOwnership } from "./types";

export interface RawListener {
  port: number;
  address: string;
  pid: number | null;
  comm: string | null;
  cwd: string | null;
  cmdline: string | null;
  pgrp: number | null;
  cgroup: string | null;
}

/** Scan every listening TCP socket via `ss`, enriched from /proc. */
export async function scanListeners(): Promise<RawListener[]> {
  const r = await run("ss", ["-H", "-tlnp"]);
  if (r.code !== 0) {
    return [];
  }
  const out: RawListener[] = [];
  const seen = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const fields = line.trim().split(/\s+/);
    const local = fields[3];
    if (!local) {
      continue;
    }
    const colon = local.lastIndexOf(":");
    if (colon < 0) {
      continue;
    }
    const port = parseInt(local.slice(colon + 1), 10);
    const address = local.slice(0, colon);
    if (!Number.isFinite(port)) {
      continue;
    }

    const procTok = fields.slice(5).join(" ");
    const m = procTok.match(/\("([^"]+)",pid=(\d+)/);
    const comm = m ? m[1] : null;
    const pid = m ? parseInt(m[2], 10) : null;

    // Collapse the IPv4/IPv6 duplicate rows of the same listener.
    const key = `${port}/${pid ?? "?"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    out.push({
      port,
      address,
      pid,
      comm,
      cwd: pid ? readlink(`/proc/${pid}/cwd`) : null,
      cmdline: pid ? readCmdline(pid) : null,
      pgrp: pid ? readPgrp(pid) : null,
      cgroup: pid ? readText(`/proc/${pid}/cgroup`) : null,
    });
  }
  return out;
}

export interface ClassifyInput {
  projectRoot: string;
  /** pgid → service name, for process services we own. */
  managedPgids: Map<number, string>;
  /** systemd unit name → service name. */
  systemdUnits: Map<string, string>;
  /** port → service name, the ports services are expected to listen on. */
  expectedPorts: Map<number, string>;
  /** the dashboard's own listening port. */
  selfPort?: number;
}

/** Turn raw listeners into classified PortInfo. */
export function classifyPorts(listeners: RawListener[], input: ClassifyInput): PortInfo[] {
  return listeners.map((l) => {
    let ownership: PortOwnership = "foreign";
    let service: string | null = null;
    let note = "";

    const ownedByPgid = l.pgrp !== null ? input.managedPgids.get(l.pgrp) : undefined;
    const ownedByUnit = matchSystemdUnit(l.cgroup, input.systemdUnits);

    if (l.port === input.selfPort) {
      ownership = "managed";
      service = "DevStack dashboard";
    } else if (ownedByPgid) {
      ownership = "managed";
      service = ownedByPgid;
    } else if (ownedByUnit) {
      ownership = "managed";
      service = ownedByUnit;
    } else if (input.expectedPorts.has(l.port)) {
      service = input.expectedPorts.get(l.port) ?? null;
      if (isUnderRoot(l, input.projectRoot)) {
        // Our own service, but started outside this dashboard (a terminal, the
        // VS Code extension, …). Not a conflict — just not dashboard-managed.
        ownership = "managed";
        note = "running outside the dashboard (started in a terminal)";
      } else {
        // Our expected port held by a process from elsewhere — the real hazard.
        ownership = "conflict";
        note = "port held by a foreign process (another project? stale daemon?)";
      }
    } else if (isUnderRoot(l, input.projectRoot)) {
      ownership = "project";
      note = "this project, not a tracked service";
    }

    // Don't surface the full cwd/cmdline of unrelated (foreign) processes — they
    // may carry other apps' secrets, and `comm` is enough to identify them.
    const foreign = ownership === "foreign";
    return {
      port: l.port,
      address: l.address,
      pid: l.pid,
      comm: l.comm,
      cwd: foreign ? null : l.cwd,
      cmdline: foreign ? null : l.cmdline,
      ownership,
      service,
      note,
    };
  });
}

function matchSystemdUnit(cgroup: string | null, units: Map<string, string>): string | undefined {
  if (!cgroup) {
    return undefined;
  }
  for (const [unit, name] of units) {
    if (cgroup.includes(`${unit}.service`)) {
      return name;
    }
  }
  return undefined;
}

function isUnderRoot(l: RawListener, root: string): boolean {
  return (
    (l.cwd !== null && l.cwd.startsWith(root)) ||
    (l.cmdline !== null && l.cmdline.includes(root))
  );
}

/** HTTP health probe with a short timeout. */
export async function probeHealth(url: string): Promise<HealthInfo> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(1500),
      redirect: "manual",
    });
    const latencyMs = Date.now() - started;
    // A redirect or any < 500 response means "the socket answered HTTP".
    const ok = res.status < 400;
    return {
      state: ok ? "healthy" : "unhealthy",
      httpStatus: res.status,
      latencyMs,
      checkedAt: started,
    };
  } catch (err) {
    return {
      state: "down",
      checkedAt: started,
      latencyMs: Date.now() - started,
      detail: (err as Error).message,
    };
  }
}

function readlink(p: string): string | null {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function readCmdline(pid: number): string | null {
  const raw = readText(`/proc/${pid}/cmdline`);
  if (raw === null) {
    return null;
  }
  return raw.replace(/\0+$/, "").split("\0").join(" ").trim() || null;
}

/** /proc/<pid>/stat field 5 (pgrp). comm (field 2) may contain spaces/parens. */
function readPgrp(pid: number): number | null {
  const raw = readText(`/proc/${pid}/stat`);
  if (raw === null) {
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) {
    return null;
  }
  const rest = raw.slice(close + 2).split(" "); // after ") " : [state, ppid, pgrp, ...]
  const pgrp = parseInt(rest[2], 10);
  return Number.isFinite(pgrp) ? pgrp : null;
}
