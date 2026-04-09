import * as vscode from "vscode";
import { ServiceDefinition, ServiceStatus } from "./types";

interface ManagedTerminal {
  terminal: vscode.Terminal;
  service: ServiceDefinition;
  status: ServiceStatus;
}

/**
 * Manages VS Code terminals for DevStack services.
 * Tracks which services are running, provides start/stop, and emits status changes.
 */
export class TerminalManager implements vscode.Disposable {
  private terminals = new Map<string, ManagedTerminal>();
  private readonly onStatusChangeEmitter = new vscode.EventEmitter<ServiceDefinition>();
  public readonly onStatusChange = this.onStatusChangeEmitter.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Track terminal closures
    this.disposables.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [key, managed] of this.terminals) {
          if (managed.terminal === closed) {
            managed.status = "stopped";
            this.onStatusChangeEmitter.fire(managed.service);
            this.terminals.delete(key);
            break;
          }
        }
      })
    );
  }

  private serviceKey(service: ServiceDefinition): string {
    return `${service.role}::${service.name}`;
  }

  getStatus(service: ServiceDefinition): ServiceStatus {
    return this.terminals.get(this.serviceKey(service))?.status ?? "stopped";
  }

  start(service: ServiceDefinition, workspaceRoot: string): void {
    const key = this.serviceKey(service);
    const existing = this.terminals.get(key);

    // If already running, just show the terminal
    if (existing && existing.status === "running") {
      existing.terminal.show();
      return;
    }

    const cwd = service.cwd
      ? vscode.Uri.file(`${workspaceRoot}/${service.cwd}`)
      : vscode.Uri.file(workspaceRoot);

    const terminal = vscode.window.createTerminal({
      name: `[DevStack] ${service.name}`,
      cwd,
      iconPath: new vscode.ThemeIcon("server-process"),
    });

    terminal.show();
    terminal.sendText(service.command);

    const managed: ManagedTerminal = { terminal, service, status: "running" };
    this.terminals.set(key, managed);
    this.onStatusChangeEmitter.fire(service);
  }

  stop(service: ServiceDefinition): void {
    const key = this.serviceKey(service);
    const managed = this.terminals.get(key);
    if (!managed) { return; }

    // Send SIGINT first, then dispose the terminal
    managed.terminal.sendText("\x03"); // Ctrl+C
    setTimeout(() => {
      managed.terminal.dispose();
    }, 500);

    managed.status = "stopped";
    this.onStatusChangeEmitter.fire(service);
    this.terminals.delete(key);
  }

  stopAll(): void {
    for (const managed of this.terminals.values()) {
      managed.terminal.sendText("\x03");
      setTimeout(() => managed.terminal.dispose(), 500);
    }
    this.terminals.clear();
  }

  dispose(): void {
    this.stopAll();
    this.onStatusChangeEmitter.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
