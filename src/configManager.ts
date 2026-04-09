import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { DevStackConfig, ServiceDefinition } from "./types";

const CONFIG_FILENAME = ".devstack.json";

/**
 * Load user-defined service overrides from .devstack.json at workspace root.
 */
export function loadConfig(workspaceRoot: string): DevStackConfig {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
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

  // Filter out disabled auto-detected services
  const filtered = autoDetected.filter((s) => !disabled.has(s.name));

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
 * Create a default .devstack.json if it doesn't exist, then open it.
 */
export async function editConfig(workspaceRoot: string): Promise<void> {
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    const template: DevStackConfig = {
      services: [
        {
          name: "Example Service",
          role: "backend",
          command: "echo 'replace me'",
        },
      ],
      disable: [],
    };
    fs.writeFileSync(configPath, JSON.stringify(template, null, 2) + "\n");
  }

  const doc = await vscode.workspace.openTextDocument(configPath);
  await vscode.window.showTextDocument(doc);
}
