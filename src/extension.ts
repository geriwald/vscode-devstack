import * as vscode from "vscode";
import { detectStacks, deduplicateServices } from "./stackDetector";
import { loadConfig, mergeServices, editConfig } from "./configManager";
import { TerminalManager } from "./terminalManager";
import { DevStackWebviewProvider } from "./webviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const terminalManager = new TerminalManager();
  const webviewProvider = new DevStackWebviewProvider(context.extensionUri, terminalManager);

  // Register webview view
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    DevStackWebviewProvider.viewType,
    webviewProvider
  );

  // Initial scan
  scanAndRefresh(webviewProvider);

  // Watch for workspace changes that might affect detection
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,go.mod,Cargo.toml,pyproject.toml,requirements.txt,docker-compose.yml,docker-compose.yaml,compose.yml,compose.yaml,Makefile,.devstack.json,next.config.*,vite.config.*,astro.config.*,nuxt.config.*,angular.json}"
  );
  watcher.onDidChange(() => scanAndRefresh(webviewProvider));
  watcher.onDidCreate(() => scanAndRefresh(webviewProvider));
  watcher.onDidDelete(() => scanAndRefresh(webviewProvider));

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("devstack.refresh", () => {
      scanAndRefresh(webviewProvider);
    }),

    vscode.commands.registerCommand("devstack.editConfig", () => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      editConfig(root);
    }),

    viewRegistration,
    watcher,
    terminalManager
  );
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function scanAndRefresh(webviewProvider: DevStackWebviewProvider): void {
  const root = getWorkspaceRoot();
  if (!root) {
    webviewProvider.setServices([], []);
    return;
  }

  const stacks = detectStacks(root);
  const techs = stacks.map((s) => s.tech);
  const autoServices = deduplicateServices(stacks);

  const config = loadConfig(root);
  const services = mergeServices(autoServices, config);

  webviewProvider.setServices(services, techs);
}

export function deactivate(): void {
  // TerminalManager.dispose() is called via context.subscriptions
}
