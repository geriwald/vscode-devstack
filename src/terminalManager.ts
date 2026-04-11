import * as vscode from "vscode";
import { ServiceDefinition, ServiceStatus } from "./types";

interface ManagedTerminal {
  terminal: vscode.Terminal;
  service: ServiceDefinition;
  status: ServiceStatus;
  detectedPort?: number;
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

  /** Regex to match localhost URLs in terminal output (strips ANSI escape codes) */
  private static readonly URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/;

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

    // Track command exits (crash detection)
    this.disposables.push(
      vscode.window.onDidEndTerminalShellExecution((event) => {
        for (const managed of this.terminals.values()) {
          if (managed.terminal === event.terminal && managed.status === "running") {
            // exitCode !== 0 or undefined means the process crashed
            if (event.exitCode !== undefined && event.exitCode !== 0) {
              managed.status = "error";
              this.onStatusChangeEmitter.fire(managed.service);
            }
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

  getDetectedPort(service: ServiceDefinition): number | undefined {
    return this.terminals.get(this.serviceKey(service))?.detectedPort;
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

    // Wait for shell integration to be ready before sending the command.
    // This lets VS Code extensions (e.g. Python venv auto-activation) finish
    // their shell setup. Without this, they can send Ctrl+C which kills our process.
    this.sendCommandWhenReady(terminal, service.command, key);

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

  /**
   * Send a command to a terminal, waiting for shell integration if available.
   * Uses executeCommand (which waits for prompt) instead of sendText.
   * Falls back to sendText after 3s if shell integration never activates.
   * When shell integration is available, reads stdout to detect localhost URLs.
   */
  private sendCommandWhenReady(terminal: vscode.Terminal, command: string, serviceKey: string): void {
    if (terminal.shellIntegration) {
      const execution = terminal.shellIntegration.executeCommand(command);
      this.readOutputStream(execution, serviceKey);
      return;
    }

    let sent = false;

    const listener = vscode.window.onDidChangeTerminalShellIntegration(({ terminal: t, shellIntegration }) => {
      if (t === terminal && !sent) {
        sent = true;
        listener.dispose();
        const execution = shellIntegration.executeCommand(command);
        this.readOutputStream(execution, serviceKey);
      }
    });

    setTimeout(() => {
      if (!sent) {
        sent = true;
        listener.dispose();
        terminal.sendText(command);
        // No stream reading available without shell integration
      }
    }, 3000);
  }

  /**
   * Read terminal output stream to detect localhost URLs.
   * Stops reading after the first URL is found.
   */
  private async readOutputStream(execution: vscode.TerminalShellExecution, serviceKey: string): Promise<void> {
    const stream = execution.read();
    for await (const data of stream) {
      const managed = this.terminals.get(serviceKey);
      if (!managed || managed.status !== "running") { break; }

      // Strip ANSI escape codes before matching
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      const match = clean.match(TerminalManager.URL_PATTERN);
      if (match) {
        const port = parseInt(match[1], 10);
        if (port > 0 && port <= 65535) {
          managed.detectedPort = port;
          this.onStatusChangeEmitter.fire(managed.service);
          break; // Stop reading after first URL found
        }
      }
    }
  }

  dispose(): void {
    this.stopAll();
    this.onStatusChangeEmitter.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
