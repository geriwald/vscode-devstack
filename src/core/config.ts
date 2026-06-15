import * as fs from "fs";
import * as path from "path";
import { parse as parseJsonc, ParseError, printParseErrorCode } from "jsonc-parser";
import { DevStackConfig, ScriptDefinition, ServiceDefinition } from "../types";

export const CONFIG_FILENAME = ".devstack.json";

/**
 * Parse .devstack.json as JSONC (comments and trailing commas tolerated, like
 * VS Code's own settings.json). Returns undefined if the file is absent;
 * throws if it exists but is genuinely unparseable, so callers never silently
 * overwrite a config they could not read.
 *
 * vscode-free: shared by the extension (configManager.ts) and the web dashboard
 * CLI (which cannot import the `vscode` module).
 */
export function readConfig(configPath: string): DevStackConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(fs.readFileSync(configPath, "utf-8"), errors);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${CONFIG_FILENAME} is invalid: ${printParseErrorCode(first.error)} at offset ${first.offset}`
    );
  }
  return (parsed as DevStackConfig) ?? {};
}

/**
 * Load user-defined service overrides from .devstack.json at workspace root.
 * Best-effort: an unreadable config yields {} so detection still proceeds.
 */
export function loadConfig(workspaceRoot: string): DevStackConfig {
  try {
    return readConfig(path.join(workspaceRoot, CONFIG_FILENAME)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Merge auto-detected services with user config.
 * Config services override auto-detected ones by name.
 * Config can also disable auto-detected services.
 */
export function mergeServices(
  autoDetected: ServiceDefinition[],
  config: DevStackConfig
): ServiceDefinition[] {
  const disabled = new Set(config.disable ?? []);

  // Filter out disabled auto-detected services. Match against the display name
  // OR the intrinsic (pre-suffix) name, so a subdir-detected service can be
  // disabled by either "FastAPI Server" or "FastAPI Server (vision)".
  const filtered = autoDetected.filter(
    (s) => !disabled.has(s.name) && !(s.intrinsicName !== undefined && disabled.has(s.intrinsicName))
  );

  // Add config services (override if same name)
  const configServices: ServiceDefinition[] = (config.services ?? []).map((s) => ({
    ...s,
    source: "config" as const,
  }));

  const result = new Map<string, ServiceDefinition>();
  for (const s of filtered) {
    result.set(s.name, s);
  }
  for (const s of configServices) {
    result.set(s.name, s);
  }

  return Array.from(result.values());
}

/**
 * Extract scripts from config. Returns an empty array if none are defined.
 */
export function loadScripts(config: DevStackConfig): ScriptDefinition[] {
  return config.scripts ?? [];
}

/**
 * Add a service name to the `disable` array in .devstack.json, creating the
 * file if needed. Idempotent: a name already present is left untouched.
 * Existing config keys are preserved.
 */
export function addToDisable(workspaceRoot: string, key: string): void {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
  // readConfig throws on an unparseable file, so a broken config is never
  // clobbered with a minimal rewrite. An absent file becomes a fresh {}.
  const config = readConfig(configPath) ?? {};
  const disable = config.disable ?? [];
  if (!disable.includes(key)) {
    disable.push(key);
  }
  config.disable = disable;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
