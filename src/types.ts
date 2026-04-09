export type ServiceRole = "frontend" | "backend" | "database" | "infra" | "fullstack" | "other";

export type ServiceStatus = "stopped" | "running" | "error";

export interface ServiceDefinition {
  /** Display name */
  name: string;
  /** Role category for grouping */
  role: ServiceRole;
  /** Shell command to start the service */
  command: string;
  /** Working directory (relative to workspace root) */
  cwd?: string;
  /** How the service was discovered */
  source: "auto" | "config";
}

export interface DetectedStack {
  /** Human-readable tech name (e.g. "Next.js", "Go", "PostgreSQL") */
  tech: string;
  /** Services that can be launched */
  services: ServiceDefinition[];
}

export interface DevStackConfig {
  /** Override or add services manually */
  services?: Array<Omit<ServiceDefinition, "source">>;
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
