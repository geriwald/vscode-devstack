export type ServiceRole = "frontend" | "backend" | "database" | "infra" | "fullstack" | "other";

export type ServiceStatus = "stopped" | "running" | "error";

export interface ServiceDefinition {
  /** Display name (may include a " (subdir)" suffix for nested detection) */
  name: string;
  /**
   * Intrinsic name as emitted by the detector, before any " (subdir)" suffix.
   * Used to match `disable` entries so users can disable by the name they see
   * in the detector, not the suffixed display name. Absent for root services
   * (where name is already intrinsic) and config services.
   */
  intrinsicName?: string;
  /** Role category for grouping */
  role: ServiceRole;
  /** Shell command to start the service */
  command: string;
  /** Optional one-line subtitle shown under the name, in place of the command */
  description?: string;
  /** Working directory (relative to workspace root) */
  cwd?: string;
  /** How the service was discovered */
  source: "auto" | "config";
  /** Technology that detected this service (e.g. "Next.js", "Vite") */
  tech?: string;
  /** Individual service names from docker-compose (for display as badges) */
  composeServices?: string[];
  /** Override the port used to build the localhost URL */
  port?: number;
  /** Override the full URL shown when the service is running */
  url?: string;
  /**
   * How the service is run. "process" (default) = a child process the dashboard
   * spawns and owns. "systemd" = a systemd unit the dashboard drives via
   * `systemctl`. The VS Code extension only knows the terminal lifecycle, so it
   * ignores systemd services; they are web-dashboard-only.
   */
  manager?: "process" | "systemd";
  /** systemd unit name (without ".service"), required when manager === "systemd" */
  unit?: string;
  /** Whether the systemd unit is a --user unit (default true). */
  userScope?: boolean;
}

export interface DetectedStack {
  /** Human-readable tech name (e.g. "Next.js", "Go", "PostgreSQL") */
  tech: string;
  /** Services that can be launched */
  services: ServiceDefinition[];
}

export interface ScriptDefinition {
  /** Display name in the sidebar */
  name: string;
  /** Shell command to execute */
  command: string;
  /** Optional one-line subtitle under the name */
  description?: string;
  /** Working dir, relative to workspace root. Defaults to root. */
  cwd?: string;
  /** Optional sub-grouping label (reserved for future UI use) */
  group?: string;
}

export interface DevStackConfig {
  /** Override or add services manually */
  services?: Array<Omit<ServiceDefinition, "source">>;
  /** One-shot scripts (config-only, no auto-detection) */
  scripts?: ScriptDefinition[];
  /** Disable auto-detected services by name */
  disable?: string[];
}

export const ROLE_LABELS: Record<ServiceRole, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  infra: "Infrastructure",
  fullstack: "Full Stack",
  other: "Other",
};

export const ROLE_ORDER: ServiceRole[] = [
  "frontend",
  "backend",
  "database",
  "infra",
  "fullstack",
  "other",
];

export interface ServiceMeta {
  /** Default port this service listens on (if known) */
  defaultPort?: number;
  /** Mode: dev, prod, build, test, watch */
  mode?: "dev" | "prod" | "build" | "test" | "watch" | "run";
  /** Whether the service supports hot reload / live refresh */
  hotReload?: boolean;
  /** Short label for the mode badge (e.g. "dev · hot reload") */
  modeLabel?: string;
}

export interface TechDescription {
  /** Short human-readable description */
  description: string;
  /** VS Code codicon name for the icon */
  icon: string;
  /** CSS color for the icon */
  color: string;
}
