import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { DevStackConfig } from "./types";
import { CONFIG_FILENAME } from "./core/config";

// The config parsing/merging logic is vscode-free and lives in ./core/config so
// the web dashboard CLI (which cannot import the `vscode` module) can reuse it.
// Re-exported here to keep the extension's import surface unchanged.
export {
  CONFIG_FILENAME,
  readConfig,
  loadConfig,
  mergeServices,
  loadScripts,
  addToDisable,
} from "./core/config";

/**
 * Create a default .devstack.json if it doesn't exist, then open it.
 * vscode-dependent, so it stays here rather than in core.
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
