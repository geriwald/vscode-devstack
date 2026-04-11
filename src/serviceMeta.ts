import { ServiceMeta, TechDescription } from "./types";

/**
 * Metadata for known service commands.
 * Keyed by command substring or exact match.
 */
const SERVICE_META: Array<{ match: RegExp; meta: ServiceMeta }> = [
  // Next.js
  { match: /next dev|npm run dev.*next/, meta: { defaultPort: 3000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  { match: /next start|next build/, meta: { defaultPort: 3000, mode: "prod", hotReload: false, modeLabel: "prod" } },
  // Vite
  { match: /vite|npm run dev/, meta: { defaultPort: 5173, mode: "dev", hotReload: true, modeLabel: "dev · HMR" } },
  // Astro
  { match: /astro dev/, meta: { defaultPort: 4321, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  // Nuxt
  { match: /nuxt dev|nuxi dev/, meta: { defaultPort: 3000, mode: "dev", hotReload: true, modeLabel: "dev · HMR" } },
  // Angular
  { match: /ng serve/, meta: { defaultPort: 4200, mode: "dev", hotReload: true, modeLabel: "dev · live reload" } },
  // Go
  { match: /go run/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /air|gow/, meta: { mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  // Python
  { match: /uvicorn.*--reload/, meta: { defaultPort: 8000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  { match: /uvicorn/, meta: { defaultPort: 8000, mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /manage\.py runserver/, meta: { defaultPort: 8000, mode: "dev", hotReload: true, modeLabel: "dev · auto reload" } },
  { match: /flask run.*--reload/, meta: { defaultPort: 5000, mode: "dev", hotReload: true, modeLabel: "dev · hot reload" } },
  { match: /flask run/, meta: { defaultPort: 5000, mode: "run", hotReload: false, modeLabel: "run" } },
  // Rust
  { match: /cargo run/, meta: { mode: "run", hotReload: false, modeLabel: "run" } },
  { match: /cargo watch/, meta: { mode: "dev", hotReload: true, modeLabel: "dev · watch" } },
  // Docker
  { match: /docker compose.*up/, meta: { mode: "run", hotReload: false, modeLabel: "containers" } },
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
 * Look up metadata for a service command.
 * Returns the first match, or an empty object if no match.
 */
export function getServiceMeta(command: string): ServiceMeta {
  for (const entry of SERVICE_META) {
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
  "Next.js":          { description: "React framework with SSR/SSG",         icon: "globe",          color: "#000000" },
  "Nuxt":             { description: "Vue.js framework with SSR/SSG",        icon: "globe",          color: "#00DC82" },
  "Remix":            { description: "React full-stack web framework",       icon: "globe",          color: "#3992FF" },
  "Astro":            { description: "Static site builder, multi-framework", icon: "rocket",         color: "#FF5D01" },
  "Vite":             { description: "Frontend build tool with HMR",         icon: "zap",            color: "#646CFF" },
  "Angular":          { description: "TypeScript SPA framework",             icon: "compass",        color: "#DD0031" },
  "Go":               { description: "Compiled backend language",            icon: "server",         color: "#00ADD8" },
  "FastAPI":          { description: "Python async web framework",           icon: "server",         color: "#009688" },
  "Django":           { description: "Python full-stack web framework",      icon: "server",         color: "#092E20" },
  "Flask":            { description: "Python lightweight web framework",     icon: "server",         color: "#000000" },
  "Rust":             { description: "Systems language, high performance",   icon: "server",         color: "#DEA584" },
  "Docker Compose":   { description: "Multi-container orchestration",        icon: "package",        color: "#2496ED" },
  "Makefile":         { description: "Task runner via make targets",         icon: "terminal",       color: "#6D8086" },
  "npm scripts":      { description: "Package.json task runner",             icon: "terminal",       color: "#CB3837" },
};
