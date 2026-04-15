import { ServiceMeta, TechDescription } from "./types";

/**
 * Metadata for known service commands.
 * Keyed by command substring or exact match.
 */
/** Tech-specific metadata — matched by tech name first, then by command regex. */
const TECH_META: Record<string, ServiceMeta> = {
  "Next.js":  { defaultPort: 3000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" },
  "Nuxt":     { defaultPort: 3000, mode: "dev", hotReload: true, modeLabel: "dev · HMR" },
  "Remix":    { defaultPort: 3000, mode: "dev", hotReload: true, modeLabel: "dev · HMR" },
  "Astro":    { defaultPort: 4321, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" },
  "Vite":     { defaultPort: 5173, mode: "dev", hotReload: true, modeLabel: "dev · HMR" },
  "Angular":  { defaultPort: 4200, mode: "dev", hotReload: true, modeLabel: "dev · live reload" },
};

/** Command-based metadata — matched by regex against the command string. */
const COMMAND_META: Array<{ match: RegExp; meta: ServiceMeta }> = [
  // Go
  { match: /go run/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /air|gow/, meta: { mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  // Python
  { match: /uvicorn.*--reload/, meta: { defaultPort: 8000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  { match: /uvicorn/, meta: { defaultPort: 8000, mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /manage\.py runserver/, meta: { defaultPort: 8000, mode: "dev", hotReload: true, modeLabel: "dev · auto reload" } },
  { match: /flask run.*--reload/, meta: { defaultPort: 5000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  { match: /flask run/, meta: { defaultPort: 5000, mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /python3?\s+\S+\.py/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  // Rust
  { match: /cargo run/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /cargo watch/, meta: { mode: "dev", hotReload: true, modeLabel: "dev · watch" } },
  // Docker (no modeLabel — compose services are shown as badges instead)
  { match: /docker compose.*up/, meta: { mode: "run", hotReload: false } },
  // Make
  { match: /make dev/, meta: { mode: "dev", hotReload: false, modeLabel: "dev" } },
  { match: /make run|make start|make serve/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  // npm generic
  { match: /npm run start$/, meta: { mode: "prod", hotReload: false, modeLabel: "prod" } },
  { match: /npm run serve/, meta: { mode: "dev", hotReload: false, modeLabel: "serve" } },
  { match: /npm run storybook/, meta: { defaultPort: 6006, mode: "dev", hotReload: true, modeLabel: "dev · HMR" } },
  { match: /npm run build:watch/, meta: { mode: "watch", hotReload: false, modeLabel: "build · watch" } },
];

/**
 * Look up metadata for a service.
 * Uses tech name first (exact match), then falls back to command regex.
 */
export function getServiceMeta(command: string, tech?: string): ServiceMeta {
  // Tech-specific lookup (covers generic commands like "npm run dev")
  if (tech && TECH_META[tech]) {
    return TECH_META[tech];
  }

  // Command-based fallback
  for (const entry of COMMAND_META) {
    if (entry.match.test(command)) {
      return entry.meta;
    }
  }
  return {};
}

/**
 * Human-readable descriptions for detected technologies.
 * Used in the Stack Overview section of the webview.
 */
export const TECH_DESCRIPTIONS: Record<string, TechDescription> = {
  "Next.js":          { description: "React framework with SSR/SSG",         icon: "globe",          color: "#CCCCCC" },
  "Nuxt":             { description: "Vue.js framework with SSR/SSG",        icon: "globe",          color: "#00DC82" },
  "Remix":            { description: "React full-stack web framework",       icon: "globe",          color: "#3992FF" },
  "Astro":            { description: "Static site builder, multi-framework", icon: "rocket",         color: "#FF5D01" },
  "Vite":             { description: "Frontend build tool with HMR",         icon: "zap",            color: "#646CFF" },
  "Angular":          { description: "TypeScript SPA framework",             icon: "compass",        color: "#DD0031" },
  "Go":               { description: "Compiled backend language",            icon: "server",         color: "#00ADD8" },
  "FastAPI":          { description: "Python async web framework",           icon: "server",         color: "#009688" },
  "Django":           { description: "Python full-stack web framework",      icon: "server",         color: "#44B78B" },
  "Flask":            { description: "Python lightweight web framework",     icon: "server",         color: "#CCCCCC" },
  "Python Script":    { description: "Standalone Python server script",      icon: "server",         color: "#3776AB" },
  "Rust":             { description: "Systems language, high performance",   icon: "server",         color: "#DEA584" },
  "Docker Compose":   { description: "Multi-container orchestration",        icon: "package",        color: "#2496ED" },
  "Makefile":         { description: "Task runner via make targets",         icon: "terminal",       color: "#6D8086" },
  "npm scripts":      { description: "Package.json task runner",             icon: "terminal",       color: "#CB3837" },
};
