import * as vscode from "vscode";
import { ServiceDefinition, ServiceRole, ServiceStatus, ROLE_LABELS, ROLE_ORDER } from "./types";
import { TerminalManager } from "./terminalManager";

/**
 * Tree data provider for the DevStack sidebar.
 * Shows services grouped by role, with inline play/stop buttons.
 */
export class DevStackTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private services: ServiceDefinition[] = [];
  private detectedTechs: string[] = [];

  constructor(private readonly terminalManager: TerminalManager) {
    terminalManager.onStatusChange(() => this.onDidChangeEmitter.fire(undefined));
  }

  setServices(services: ServiceDefinition[], techs: string[]): void {
    this.services = services;
    this.detectedTechs = techs;
    this.onDidChangeEmitter.fire(undefined);
  }

  refresh(): void {
    this.onDidChangeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      return this.getRootItems();
    }
    if (element instanceof RoleGroupItem) {
      return this.getServiceItems(element.role);
    }
    return [];
  }

  private getRootItems(): TreeItem[] {
    if (this.services.length === 0) {
      return [new MessageItem("No services detected")];
    }

    const items: TreeItem[] = [];

    // Tech badge at the top
    if (this.detectedTechs.length > 0) {
      items.push(new MessageItem(`Stack: ${this.detectedTechs.join(" + ")}`));
    }

    // Group by role
    const roles = new Set(this.services.map((s) => s.role));
    for (const role of ROLE_ORDER) {
      if (roles.has(role)) {
        const count = this.services.filter((s) => s.role === role).length;
        items.push(new RoleGroupItem(role, count));
      }
    }

    return items;
  }

  private getServiceItems(role: ServiceRole): TreeItem[] {
    return this.services
      .filter((s) => s.role === role)
      .map((s) => new ServiceItem(s, this.terminalManager.getStatus(s)));
  }
}

// --- Tree item types ---

export type TreeItem = RoleGroupItem | ServiceItem | MessageItem;

export class RoleGroupItem extends vscode.TreeItem {
  constructor(
    public readonly role: ServiceRole,
    count: number
  ) {
    super(ROLE_LABELS[role], vscode.TreeItemCollapsibleState.Expanded);
    this.description = `(${count})`;
    this.iconPath = roleIcon(role);
    this.contextValue = "role-group";
  }
}

export class ServiceItem extends vscode.TreeItem {
  constructor(
    public readonly service: ServiceDefinition,
    status: ServiceStatus
  ) {
    super(service.name, vscode.TreeItemCollapsibleState.None);
    this.description = service.command;
    this.tooltip = `${service.name}\n${service.command}${service.cwd ? `\ncwd: ${service.cwd}` : ""}`;
    this.iconPath = statusIcon(status);
    this.contextValue = `service-${status}`;
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "message";
  }
}

function statusIcon(status: ServiceStatus): vscode.ThemeIcon {
  switch (status) {
    case "running":
      return new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
    case "error":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
    case "stopped":
      return new vscode.ThemeIcon("circle-outline");
  }
}

function roleIcon(role: ServiceRole): vscode.ThemeIcon {
  switch (role) {
    case "frontend":
      return new vscode.ThemeIcon("browser");
    case "backend":
      return new vscode.ThemeIcon("server");
    case "database":
      return new vscode.ThemeIcon("database");
    case "infra":
      return new vscode.ThemeIcon("cloud");
    case "fullstack":
      return new vscode.ThemeIcon("layers");
    case "other":
      return new vscode.ThemeIcon("terminal");
  }
}
