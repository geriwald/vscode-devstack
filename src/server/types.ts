import { ServiceRole } from "../types";

/** Lifecycle state of a runnable service. */
export type RuntimeStatus = "stopped" | "starting" | "running" | "stopping" | "error";

/** Health of a service that exposes a URL. */
export type HealthState = "healthy" | "unhealthy" | "down" | "unknown";

export interface HealthInfo {
  state: HealthState;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: number;
  detail?: string;
}

export interface WiringEdge {
  label: string;
  targetHost?: string;
  targetPort: number;
  /** Name of the service that owns targetPort, if any. */
  resolved: string | null;
  /** Whether the target port is currently listening. */
  up: boolean;
}

/** A service as presented to the dashboard (config + live runtime facts). */
export interface RuntimeService {
  id: string;
  name: string;
  role: ServiceRole;
  manager: "process" | "systemd";
  unit?: string;
  mode?: string | null;
  modeLabel?: string | null;
  status: RuntimeStatus;
  command: string;
  cwd?: string;
  port?: number;
  url?: string;
  pid?: number | null;
  uptimeMs?: number | null;
  venv?: string | null;
  interpreter?: string | null;
  envFile?: string | null;
  env: Record<string, string>;
  health: HealthInfo | null;
  wiring: WiringEdge[];
}

export interface RuntimeScript {
  id: string;
  name: string;
  description?: string;
  group?: string;
}

/** Classification of a listening TCP port. */
export type PortOwnership = "managed" | "conflict" | "foreign" | "project";

export interface PortInfo {
  port: number;
  address: string;
  pid: number | null;
  comm: string | null;
  cwd: string | null;
  cmdline: string | null;
  ownership: PortOwnership;
  /** Name of the related service for managed/conflict. */
  service: string | null;
  note: string;
}

export interface Snapshot {
  project: { name: string; root: string };
  generatedAt: number;
  services: RuntimeService[];
  scripts: RuntimeScript[];
  ports: PortInfo[];
}

export interface LogLine {
  id: string;
  seq: number;
  ts: number;
  stream: "out" | "err" | "sys";
  line: string;
}
