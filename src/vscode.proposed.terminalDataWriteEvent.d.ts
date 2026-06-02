// Proposed VS Code API: terminalDataWriteEvent.
// Vendored verbatim from microsoft/vscode so the debug instrumentation in
// terminalDebug.ts type-checks. This is a type declaration only — it does NOT
// enable the API at runtime (that requires --enable-proposed-api at launch and
// is wired via an uncommitted .vscode/launch.json, never via the published
// manifest, which must not declare `enabledApiProposals`).
declare module "vscode" {
  export interface TerminalDataWriteEvent {
    readonly terminal: Terminal;
    readonly data: string;
  }

  export namespace window {
    export const onDidWriteTerminalData: Event<TerminalDataWriteEvent>;
  }
}
