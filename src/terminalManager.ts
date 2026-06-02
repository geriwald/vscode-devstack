import * as vscode from "vscode";
import { ScriptDefinition, ServiceDefinition, ServiceStatus } from "./types";
import { TerminalDebugRecorder } from "./terminalDebug";

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
  private readonly debug = new TerminalDebugRecorder();

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
      // hideFromUser opts this terminal out of the Python extension's terminal
      // auto-activation (it skips terminals created with hideFromUser). That
      // activation typed `source .venv/bin/activate` + Ctrl+C into the terminal,
      // killing our already-started process intermittently and adding a startup
      // delay. We don't need it: detected commands already use the venv's
      // absolute interpreter path (see findVenvBin in stackDetector.ts).
      hideFromUser: true,
    });

    this.debug.track(terminal, `service:${service.name}`);
    terminal.show();

    // Send immediately. No venv activation will interfere (hideFromUser above),
    // so there is nothing to wait for. Still read the output stream when shell
    // integration is available, to detect the localhost URL — but never block on it.
    this.sendCommand(terminal, service.command, key);

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

  /**
   * Run a one-shot script in a fresh terminal. No tracking, no status, no stop.
   * Each call creates a new terminal — runs are independent.
   */
  runOneShot(script: ScriptDefinition, workspaceRoot: string): void {
    const cwd = script.cwd
      ? vscode.Uri.file(`${workspaceRoot}/${script.cwd}`)
      : vscode.Uri.file(workspaceRoot);

    const terminal = vscode.window.createTerminal({
      name: `[DevStack] ${script.name}`,
      cwd,
      iconPath: new vscode.ThemeIcon("terminal"),
      hideFromUser: true, // opt out of Python venv auto-activation — see start()
    });
    this.debug.track(terminal, `script:${script.name}`);
    terminal.show();
    terminal.sendText(script.command);
  }

  stopAll(): void {
    for (const managed of this.terminals.values()) {
      managed.terminal.sendText("\x03");
      setTimeout(() => managed.terminal.dispose(), 500);
    }
    this.terminals.clear();
  }

  /**
   * Send a command to a terminal immediately, without waiting for shell
   * integration. The terminal is created with hideFromUser, so the Python
   * extension does not inject venv activation — there is nothing to wait for.
   *
   * Shell integration is used opportunistically, only to detect the localhost
   * URL (port badge): if it is already available we read its stream; otherwise
   * we send via sendText and skip port detection. We never delay the command.
   */
  private sendCommand(terminal: vscode.Terminal, command: string, serviceKey: string): void {
    if (terminal.shellIntegration) {
      const execution = terminal.shellIntegration.executeCommand(command);
      this.readOutputStream(execution, serviceKey);
      return;
    }

    // Send now; we can't read the stream without shell integration, so port
    // detection is best-effort and simply absent here.
    terminal.sendText(command);
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
    this.debug.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
