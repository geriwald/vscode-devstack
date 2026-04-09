import * as vscode from "vscode";
import { detectStacks, deduplicateServices } from "./stackDetector";
import { loadConfig, mergeServices, editConfig } from "./configManager";
import { TerminalManager } from "./terminalManager";
import { DevStackTreeProvider, ServiceItem } from "./treeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const terminalManager = new TerminalManager();
  const treeProvider = new DevStackTreeProvider(terminalManager);

  // Register tree view
  const treeView = vscode.window.createTreeView("devstackServices", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Initial scan
  scanAndRefresh(treeProvider);

  // Watch for workspace changes that might affect detection
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{package.json,go.mod,Cargo.toml,pyproject.toml,requirements.txt,docker-compose.yml,docker-compose.yaml,compose.yml,compose.yaml,Makefile,.devstack.json,next.config.*,vite.config.*,astro.config.*,nuxt.config.*,angular.json}"
  );
  watcher.onDidChange(() => scanAndRefresh(treeProvider));
  watcher.onDidCreate(() => scanAndRefresh(treeProvider));
  watcher.onDidDelete(() => scanAndRefresh(treeProvider));

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("devstack.refresh", () => {
      scanAndRefresh(treeProvider);
    }),

    vscode.commands.registerCommand("devstack.startService", (item: ServiceItem) => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      terminalManager.start(item.service, root);
    }),

    vscode.commands.registerCommand("devstack.stopService", (item: ServiceItem) => {
      terminalManager.stop(item.service);
    }),

    vscode.commands.registerCommand("devstack.editConfig", () => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      editConfig(root);
    }),

    treeView,
    watcher,
    terminalManager
  );
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function scanAndRefresh(treeProvider: DevStackTreeProvider): void {
  const root = getWorkspaceRoot();
  if (!root) {
    treeProvider.setServices([], []);
    return;
  }

  const stacks = detectStacks(root);
  const techs = stacks.map((s) => s.tech);
  const autoServices = deduplicateServices(stacks);

  const config = loadConfig(root);
  const services = mergeServices(autoServices, config);

  treeProvider.setServices(services, techs);
}

export function deactivate(): void {
  // TerminalManager.dispose() is called via context.subscriptions
}
