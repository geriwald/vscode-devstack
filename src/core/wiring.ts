/**
 * Pure parsers that turn a service's shell command into the facts the dashboard
 * surfaces: which interpreter/venv it uses, which env-file it loads, its inline
 * environment, and which *other* services it talks to (wiring edges).
 *
 * vscode-free and IO-free — unit-tested in wiring.test.ts.
 */

export interface CommandFacts {
  /** Leading `KEY=value` assignments before the executable. */
  envAssignments: Record<string, string>;
  /** Path passed to `--env-file` (node) if any. */
  envFile?: string;
  /** Root of a Python virtualenv, derived from the interpreter or `activate`. */
  venv?: string;
  /** Full path of the interpreter, when an absolute `.../bin/python*` is used. */
  interpreter?: string;
}

export interface WiringRef {
  /** The env var (or marker) that revealed the dependency, e.g. "VISION_URL". */
  label: string;
  /** Target host when known (from a URL value). */
  targetHost?: string;
  /** Target port the service points at. */
  targetPort: number;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const INTERPRETER = /(\S*\/bin\/python[0-9.]*)\b/;
const ACTIVATE = /(\S*\/bin\/activate)\b/;
const ENV_FILE = /--env-file[ =]([^\s]+)/;
const URL_WITH_PORT = /^https?:\/\/([^/:\s]+):(\d+)/;
const ANY_URL_WITH_PORT = /https?:\/\/([^/:\s]+):(\d+)/g;

/** Parse the static facts of a service command. */
export function parseCommandFacts(command: string): CommandFacts {
  const tokens = command.trim().split(/\s+/);

  // Leading env assignments, up to the first token that is not one.
  const envAssignments: Record<string, string> = {};
  for (const tok of tokens) {
    if (!ASSIGNMENT.test(tok)) {
      break;
    }
    const eq = tok.indexOf("=");
    envAssignments[tok.slice(0, eq)] = tok.slice(eq + 1);
  }

  const facts: CommandFacts = { envAssignments };

  const envFile = command.match(ENV_FILE);
  if (envFile) {
    facts.envFile = envFile[1];
  }

  const interp = command.match(INTERPRETER);
  if (interp) {
    facts.interpreter = interp[1];
    facts.venv = interp[1].replace(/\/bin\/python[0-9.]*$/, "");
  } else {
    const activate = command.match(ACTIVATE);
    if (activate) {
      facts.venv = activate[1].replace(/\/bin\/activate$/, "");
    }
  }

  return facts;
}

/**
 * Extract the services this command depends on. Signals, in order:
 *  - any env value that is a URL with a port  → host:port edge
 *  - any `*_PORT` env (other than the service's own `PORT`) → port edge
 *  - any URL-with-port literal in the command → host:port edge
 * Deduped by (host, port).
 */
export function extractWiringRefs(facts: CommandFacts, command: string): WiringRef[] {
  const refs: WiringRef[] = [];
  const seen = new Set<string>();

  const add = (label: string, port: number, host?: string) => {
    const key = `${host ?? ""}:${port}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const ref: WiringRef = { label, targetPort: port };
    if (host) {
      ref.targetHost = host;
    }
    refs.push(ref);
  };

  for (const [key, value] of Object.entries(facts.envAssignments)) {
    const url = value.match(URL_WITH_PORT);
    if (url) {
      add(key, parseInt(url[2], 10), url[1]);
      continue;
    }
    if (/_PORT$/.test(key) && key !== "PORT" && /^\d+$/.test(value)) {
      add(key, parseInt(value, 10));
    }
  }

  // URL literals anywhere in the command (e.g. a hard-coded relay target).
  for (const m of command.matchAll(ANY_URL_WITH_PORT)) {
    add(m[0].replace(/^https?:\/\//, ""), parseInt(m[2], 10), m[1]);
  }

  return refs;
}
