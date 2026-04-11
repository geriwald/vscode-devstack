import * as vscode from "vscode";
import { ServiceDefinition, ServiceRole, ServiceStatus, ROLE_LABELS, ROLE_ORDER, TechDescription } from "./types";
import { TerminalManager } from "./terminalManager";
import { getServiceMeta, TECH_DESCRIPTIONS } from "./serviceMeta";

interface WebviewState {
  techs: string[];
  servicesByRole: Record<string, Array<{
    name: string;
    command: string;
    cwd?: string;
    status: ServiceStatus;
    modeLabel?: string;
    hotReload?: boolean;
    defaultPort?: number;
    url?: string;
    role: ServiceRole;
  }>>;
}

export class DevStackWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "devstackPanel";

  private view?: vscode.WebviewView;
  private services: ServiceDefinition[] = [];
  private techs: string[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly terminalManager: TerminalManager
  ) {
    terminalManager.onStatusChange(() => this.updateWebview());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "start": {
          const service = this.findService(message.name, message.role);
          if (service) {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (root) { this.terminalManager.start(service, root); }
          }
          break;
        }
        case "stop": {
          const service = this.findService(message.name, message.role);
          if (service) { this.terminalManager.stop(service); }
          break;
        }
        case "openUrl": {
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;
        }
      }
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  setServices(services: ServiceDefinition[], techs: string[]): void {
    this.services = services;
    this.techs = techs;
    this.updateWebview();
  }

  private findService(name: string, role: string): ServiceDefinition | undefined {
    return this.services.find((s) => s.name === name && s.role === role);
  }

  private updateWebview(): void {
    if (!this.view) { return; }
    const state = this.buildState();
    this.view.webview.postMessage({ type: "update", state });
  }

  private buildState(): WebviewState {
    const servicesByRole: WebviewState["servicesByRole"] = {};

    for (const role of ROLE_ORDER) {
      const matching = this.services.filter((s) => s.role === role);
      if (matching.length === 0) { continue; }

      servicesByRole[role] = matching.map((s) => {
        const status = this.terminalManager.getStatus(s);
        const meta = getServiceMeta(s.command);
        const port = meta.defaultPort;
        const url = (status === "running" && port) ? `http://localhost:${port}` : undefined;

        return {
          name: s.name,
          command: s.command,
          cwd: s.cwd,
          status,
          modeLabel: meta.modeLabel,
          hotReload: meta.hotReload,
          defaultPort: port,
          url,
          role: s.role,
        };
      });
    }

    return { techs: this.techs, servicesByRole };
  }

  private getHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js")
    );

    // Build tech descriptions JSON for the webview
    const techDescriptions: Record<string, TechDescription> = {};
    for (const tech of this.techs) {
      if (TECH_DESCRIPTIONS[tech]) {
        techDescriptions[tech] = TECH_DESCRIPTIONS[tech];
      }
    }

    const roleLabels = JSON.stringify(ROLE_LABELS);
    const techDescs = JSON.stringify(techDescriptions);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="root"></div>
  <script>
    const ROLE_LABELS = ${roleLabels};
    const TECH_DESCRIPTIONS = ${techDescs};
  </script>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }
}
