import * as fs from "fs";
import * as path from "path";
import { DetectedStack, ServiceDefinition } from "./types";

/**
 * Detect the tech stack of a project by examining marker files.
 * Scans the workspace root, then subdirectories up to 2 levels deep.
 * Returns all detected stacks with their launchable services.
 */
export function detectStacks(workspaceRoot: string): DetectedStack[] {
  const stacks: DetectedStack[] = [];

  // Scan workspace root
  for (const detector of DETECTORS) {
    const result = detector(workspaceRoot);
    if (result) {
      stacks.push(result);
    }
  }

  // Scan subdirectories (up to depth 2) for nested projects
  for (const subdir of listSubdirs(workspaceRoot, 2)) {
    const rel = path.relative(workspaceRoot, subdir);
    for (const detector of DETECTORS) {
      const result = detector(subdir);
      if (result) {
        // Tag each service with the subdirectory.
        // Respect cwd already set by the detector (e.g. "" = workspace root for packages).
        const tagged: DetectedStack = {
          tech: result.tech,
          services: result.services.map((svc) => ({
            ...svc,
            name: `${svc.name} (${rel})`,
            cwd: svc.cwd !== undefined ? svc.cwd : rel,
          })),
        };
        stacks.push(tagged);
      }
    }
  }

  return stacks;
}

type Detector = (root: string) => DetectedStack | null;

function fileExists(root: string, ...segments: string[]): boolean {
  return fs.existsSync(path.join(root, ...segments));
}

function readJsonSafe(filepath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
  }
}

// --- Detectors ---

const detectNextJs: Detector = (root) => {
  if (!fileExists(root, "next.config.js") && !fileExists(root, "next.config.mjs") && !fileExists(root, "next.config.ts")) {
    return null;
  }
  return {
    tech: "Next.js",
    services: [
      { name: "Next.js Dev", role: "fullstack", command: "npm run dev", source: "auto" },
    ],
  };
};

const detectVite: Detector = (root) => {
  if (!fileExists(root, "vite.config.ts") && !fileExists(root, "vite.config.js") && !fileExists(root, "vite.config.mjs")) {
    return null;
  }
  // Skip if Next.js already detected (some projects have both)
  if (fileExists(root, "next.config.js") || fileExists(root, "next.config.mjs") || fileExists(root, "next.config.ts")) {
    return null;
  }
  return {
    tech: "Vite",
    services: [
      { name: "Vite Dev", role: "frontend", command: "npm run dev", source: "auto" },
    ],
  };
};

const detectAstro: Detector = (root) => {
  if (!fileExists(root, "astro.config.mjs") && !fileExists(root, "astro.config.ts")) {
    return null;
  }
  return {
    tech: "Astro",
    services: [
      { name: "Astro Dev", role: "frontend", command: "npm run dev", source: "auto" },
    ],
  };
};

const detectNuxt: Detector = (root) => {
  if (!fileExists(root, "nuxt.config.ts") && !fileExists(root, "nuxt.config.js")) {
    return null;
  }
  return {
    tech: "Nuxt",
    services: [
      { name: "Nuxt Dev", role: "fullstack", command: "npm run dev", source: "auto" },
    ],
  };
};

const detectRemix: Detector = (root) => {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg) { return null; }
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  if (!deps["@remix-run/node"] && !deps["@remix-run/react"]) { return null; }
  return {
    tech: "Remix",
    services: [
      { name: "Remix Dev", role: "fullstack", command: "npm run dev", source: "auto" },
    ],
  };
};

const detectAngular: Detector = (root) => {
  if (!fileExists(root, "angular.json")) { return null; }
  return {
    tech: "Angular",
    services: [
      { name: "Angular Dev", role: "frontend", command: "ng serve", source: "auto" },
    ],
  };
};

const detectGo: Detector = (root) => {
  if (!fileExists(root, "go.mod")) { return null; }
  const command = fileExists(root, "Makefile") ? "make run" : "go run .";
  return {
    tech: "Go",
    services: [
      { name: "Go Server", role: "backend", command, source: "auto" },
    ],
  };
};

const detectPythonFastAPI: Detector = (root) => {
  const reqFile = path.join(root, "requirements.txt");
  const pyproject = path.join(root, "pyproject.toml");
  let hasFastAPI = false;
  let hasDjango = false;
  let hasFlask = false;

  for (const f of [reqFile, pyproject]) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, "utf-8");
      if (/fastapi/i.test(content)) { hasFastAPI = true; }
      if (/django/i.test(content)) { hasDjango = true; }
      if (/flask/i.test(content)) { hasFlask = true; }
    }
  }

  const venvBin = findVenvBin(root);
  const python = venvBin ? path.join(venvBin, "python") : "python";
  const uvicorn = venvBin ? path.join(venvBin, "uvicorn") : "uvicorn";

  // Discover the uvicorn app entry point.
  // Prefer pyproject.toml [project.scripts] entry (handles packages with relative imports).
  // Fall back to scanning the root and common app subdirectories for a FastAPI module.
  const pyprojectEntry = discoverFastAPIEntry(root);
  let appEntry: string;
  let appDir: string | null = null;
  let needsPackageRoot = false;

  if (pyprojectEntry) {
    // Entry like "webapp.backend.main:app" — must be launched from the package root
    appEntry = pyprojectEntry;
    needsPackageRoot = pyprojectEntry.includes(".");
  } else {
    const found = findFastAPIModule(root);
    if (found) {
      appEntry = found.entry;
      appDir = found.dir;
    } else {
      appEntry = "main:app";
    }
  }

  if (hasFastAPI) {
    let cmd: string;
    if (fileExists(root, "Makefile")) {
      cmd = "make run";
    } else {
      const appDirFlag = appDir ? ` --app-dir ${appDir}` : "";
      cmd = `${uvicorn} ${appEntry}${appDirFlag} --reload --port 8000`;
    }
    const svc: ServiceDefinition = { name: "FastAPI Server", role: "backend", command: cmd, source: "auto" };
    // When entry is a dotted module path, cwd must stay at the workspace root
    if (needsPackageRoot) { svc.cwd = ""; }
    return {
      tech: "FastAPI",
      services: [svc],
    };
  }
  if (hasDjango) {
    return {
      tech: "Django",
      services: [
        { name: "Django Server", role: "backend", command: `${python} manage.py runserver`, source: "auto" },
      ],
    };
  }
  if (hasFlask) {
    return {
      tech: "Flask",
      services: [
        { name: "Flask Server", role: "backend", command: `${venvBin ? path.join(venvBin, "flask") : "flask"} run --reload`, source: "auto" },
      ],
    };
  }
  return null;
};

const detectPythonScript: Detector = (root) => {
  // Standalone "python server.py"-style apps: a script at the root that is
  // either sitting next to an index.html, or imports a known web framework.
  // Skipped when the project declares a framework in its packaging metadata
  // (those cases are handled by detectPythonFastAPI and invoked via uvicorn /
  // manage.py / flask run).
  const candidates = ["server.py", "app.py", "main.py", "wsgi.py"];
  const script = candidates.find((f) => fileExists(root, f));
  if (!script) { return null; }

  for (const f of ["requirements.txt", "pyproject.toml"]) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      if (/fastapi|django|flask/i.test(content)) { return null; }
    }
  }

  // Grep the script itself for a web-framework import — anchored at line
  // start to avoid matching comments or strings deeper in the file.
  const importsFramework = scriptImportsWebFramework(path.join(root, script));

  // Accept either: (a) script + sibling index.html (static site server),
  // or (b) script that imports a web framework (ad-hoc Flask/FastAPI/etc.).
  if (!fileExists(root, "index.html") && !importsFramework) { return null; }

  const venvBin = findVenvBin(root);
  const python = venvBin ? path.join(venvBin, "python") : "python3";

  return {
    tech: "Python Script",
    services: [
      { name: `Python ${script}`, role: "backend", command: `${python} ${script}`, source: "auto" },
    ],
  };
};

function scriptImportsWebFramework(scriptPath: string): boolean {
  try {
    const content = fs.readFileSync(scriptPath, "utf-8");
    return /^\s*(from|import)\s+(flask|fastapi|bottle|starlette|quart|sanic|aiohttp|tornado)\b/m.test(content);
  } catch {
    return false;
  }
}

const detectRust: Detector = (root) => {
  if (!fileExists(root, "Cargo.toml")) { return null; }
  const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf-8");
  const isWeb = /actix|axum|rocket|warp|tide/.test(cargo);
  return {
    tech: "Rust",
    services: [
      { name: "Rust Server", role: isWeb ? "backend" : "other", command: "cargo run", source: "auto" },
    ],
  };
};

const detectDockerCompose: Detector = (root) => {
  const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  const found = composeFiles.find((f) => fileExists(root, f));
  if (!found) { return null; }

  const services: ServiceDefinition[] = [];

  // Parse compose file to extract service names (shown as badges)
  let composeServices: string[] | undefined;
  try {
    const content = fs.readFileSync(path.join(root, found), "utf-8");
    const serviceNames = extractComposeServiceNames(content);
    if (serviceNames.length > 0) {
      composeServices = serviceNames;
    }
  } catch {
    // Ignore parse errors
  }

  services.push({
    name: "Docker Compose",
    role: "infra",
    command: `docker compose -f ${found} up`,
    source: "auto",
    composeServices,
  });

  return { tech: "Docker Compose", services };
};

const detectMakefile: Detector = (root) => {
  if (!fileExists(root, "Makefile")) { return null; }
  const content = fs.readFileSync(path.join(root, "Makefile"), "utf-8");
  const targets = extractMakefileTargets(content);
  if (targets.length === 0) { return null; }

  const services: ServiceDefinition[] = targets.map((target) => ({
    name: `make ${target}`,
    role: "other",
    command: `make ${target}`,
    source: "auto",
  }));

  return { tech: "Makefile", services };
};

/**
 * Extract real, runnable targets from a Makefile.
 * Skips variable assignments, special targets (.PHONY, .SUFFIXES, ...),
 * pattern rules, file-path targets, and private targets starting with "_".
 */
function extractMakefileTargets(content: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip indented lines (recipes) and blank/comment lines
    if (/^\s/.test(line) || line.trim() === "" || line.startsWith("#")) { continue; }

    // Match a target definition: name: or name : (no "=" before the colon)
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:(?!=)/);
    if (!match) { continue; }

    const name = match[1];
    if (name.startsWith("_")) { continue; }
    if (seen.has(name)) { continue; }

    seen.add(name);
    targets.push(name);
  }

  return targets;
}

const detectNpmScripts: Detector = (root) => {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  if (!pkg || !pkg.scripts) { return null; }
  const scripts = pkg.scripts as Record<string, string>;

  // If a framework is detected, skip "start" and "dev" (redundant with framework detector)
  const hasFramework =
    fileExists(root, "next.config.js") || fileExists(root, "next.config.mjs") || fileExists(root, "next.config.ts") ||
    fileExists(root, "nuxt.config.ts") || fileExists(root, "nuxt.config.js") ||
    fileExists(root, "vite.config.ts") || fileExists(root, "vite.config.js") || fileExists(root, "vite.config.mjs") ||
    fileExists(root, "astro.config.mjs") || fileExists(root, "astro.config.ts") ||
    fileExists(root, "angular.json");

  const services: ServiceDefinition[] = [];
  const interestingScripts = ["dev", "start", "serve", "build:watch", "storybook"];

  for (const name of interestingScripts) {
    if (scripts[name]) {
      if (hasFramework && (name === "start" || name === "dev")) { continue; }
      services.push({
        name: `npm run ${name}`,
        role: guessRoleFromNpmScript(name, scripts[name]),
        command: `npm run ${name}`,
        source: "auto",
      });
    }
  }

  if (services.length === 0) { return null; }
  return { tech: "npm scripts", services };
};

// --- Python venv discovery ---

const VENV_DIRS = [".venv", "venv", "env", ".env"];

/** Walk up from `root` looking for a Python venv. Returns the bin/ path or null. */
function findVenvBin(startDir: string): string | null {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const name of VENV_DIRS) {
      const bin = path.join(dir, name, "bin");
      if (fs.existsSync(path.join(bin, "python"))) {
        return bin;
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Locate a FastAPI `app = FastAPI(...)` module on disk.
 * Checks the root first, then common subdirectories (web, app, backend, src, api, server).
 * Returns `{ entry, dir }` where entry is "<stem>:<var>" and dir is the relative folder
 * to pass to `uvicorn --app-dir` (null when the module sits at the workspace root).
 */
function findFastAPIModule(root: string): { entry: string; dir: string | null } | null {
  const SUBDIRS = ["", "web", "app", "backend", "src", "api", "server"];
  const FILES = ["main.py", "app.py", "server.py", "asgi.py"];

  for (const sub of SUBDIRS) {
    const dir = sub ? path.join(root, sub) : root;
    if (sub && !fs.existsSync(dir)) { continue; }
    for (const file of FILES) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) { continue; }
      const varName = findFastAPIVar(full);
      if (!varName) { continue; }
      const stem = file.replace(/\.py$/, "");
      return { entry: `${stem}:${varName}`, dir: sub || null };
    }
  }
  return null;
}

/** Scan a Python file for `<var> = FastAPI(...)` and return the variable name, or null. */
function findFastAPIVar(filepath: string): string | null {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*FastAPI\s*\(/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Try to extract the FastAPI app entry point from pyproject.toml [project.scripts]. */
function discoverFastAPIEntry(root: string): string | null {
  const pyprojectPath = path.join(root, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) { return null; }
  try {
    const content = fs.readFileSync(pyprojectPath, "utf-8");
    // Match patterns like: some-name = "webapp.backend.main:app"
    const match = content.match(/=\s*"([^"]+:app)"/);
    if (match) { return match[1]; }
  } catch {
    // Ignore
  }
  return null;
}

// --- Subdirectory scanning ---

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", ".next", ".nuxt", "__pycache__", ".venv", "venv", "target", "vendor"]);

function listSubdirs(root: string, maxDepth: number, currentDepth = 1): string[] {
  if (currentDepth > maxDepth) { return []; }
  const dirs: string[] = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") && entry.name !== ".") { continue; }
      if (IGNORED_DIRS.has(entry.name)) { continue; }
      const full = path.join(root, entry.name);
      dirs.push(full);
      dirs.push(...listSubdirs(full, maxDepth, currentDepth + 1));
    }
  } catch {
    // Permission denied or similar — skip
  }
  return dirs;
}

// --- Helpers ---

function extractComposeServiceNames(yamlContent: string): string[] {
  // Simple YAML parsing: find top-level "services:" then indented keys
  const lines = yamlContent.split("\n");
  const names: string[] = [];
  let inServices = false;

  for (const line of lines) {
    if (/^services\s*:/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices) {
      // Top-level key under services (2-space indent)
      const match = line.match(/^  (\w[\w-]*)\s*:/);
      if (match) {
        names.push(match[1]);
      } else if (/^\S/.test(line) && line.trim() !== "") {
        // New top-level key, stop
        break;
      }
    }
  }
  return names;
}

function guessRoleFromName(name: string): ServiceDefinition["role"] {
  const n = name.toLowerCase();
  if (/\bfront(end)?\b|\bgui\b|\bweb\b|\bclient\b|\bdashboard\b/.test(n)) { return "frontend"; }
  if (/\bback(end)?\b|\bapi\b|\bserver\b|\bgateway\b/.test(n)) { return "backend"; }
  if (/\bdb\b|\bdatabase\b|\bpostgres\b|\bmysql\b|\bmongo\b|\bredis\b|\bmariadb\b|\bsqlite\b/.test(n)) { return "database"; }
  if (/\bproxy\b|\btraefik\b|\bnginx\b|\bcaddy\b|\bqueue\b|\bworker\b|\bmail\b|\bwatchtower\b|\bportainer\b|\bdozzle\b|\bmonitor\b|\blog(s)?\b|\bagent\b/.test(n)) { return "infra"; }
  return "other";
}

function guessRoleFromNpmScript(name: string, _command: string): ServiceDefinition["role"] {
  if (name === "storybook") { return "frontend"; }
  if (name === "dev" || name === "start" || name === "serve") { return "fullstack"; }
  return "other";
}

/** Deduplicate services by command, preferring framework-detected over generic */
export function deduplicateServices(stacks: DetectedStack[]): ServiceDefinition[] {
  const seen = new Map<string, ServiceDefinition>();

  // Framework-specific stacks first, then generic (npm scripts, Makefile)
  const genericTechs = new Set(["npm scripts", "Makefile"]);
  const sorted = [...stacks].sort((a, b) => {
    const aGeneric = genericTechs.has(a.tech) ? 1 : 0;
    const bGeneric = genericTechs.has(b.tech) ? 1 : 0;
    return aGeneric - bGeneric;
  });

  for (const stack of sorted) {
    for (const svc of stack.services) {
      if (!seen.has(svc.command)) {
        seen.set(svc.command, { ...svc, tech: stack.tech });
      }
    }
  }

  return Array.from(seen.values());
}

// Order matters: framework-specific detectors first, generic last
const DETECTORS: Detector[] = [
  detectNextJs,
  detectNuxt,
  detectRemix,
  detectAstro,
  detectVite,
  detectAngular,
  detectGo,
  detectPythonFastAPI,
  detectPythonScript,
  detectRust,
  detectDockerCompose,
  detectMakefile,
  detectNpmScripts,
];
