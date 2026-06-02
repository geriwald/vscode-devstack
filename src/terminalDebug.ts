import * as vscode from "vscode";

/**
 * Debug instrumentation for diagnosing terminal startup behavior (the venv
 * activation delay). Activated only when the DEVSTACK_DEBUG env var is set.
 *
 * Subscribes to the PROPOSED `window.onDidWriteTerminalData` API to capture
 * every byte written to a DevStack-spawned terminal — including text injected
 * by other extensions (e.g. the Python extension's venv auto-activation) and
 * control characters like Ctrl+C (\x03). This is what reveals whether the
 * activation path types into the terminal or only sets env vars.
 *
 * The proposed API is accessed dynamically so that:
 *   - it is never referenced when DEVSTACK_DEBUG is unset (no runtime cost), and
 *   - the published manifest does not declare `enabledApiProposals`
 *     (which would block Marketplace publication).
 *
 * To use: launch the Extension Development Host with DEVSTACK_DEBUG=1 and the
 * `--enable-proposed-api` flag wired via an uncommitted .vscode/launch.json.
 */

/** True when debug instrumentation should be active. */
export function isDebugEnabled(): boolean {
  return !!process.env.DEVSTACK_DEBUG;
}

/** Render control bytes visibly so Ctrl+C, CR, LF, ESC are unmistakable in logs. */
function visualize(data: string): string {
  return data
    .replace(/\x1b/g, "<ESC>")
    .replace(/\x03/g, "<CTRL-C>")
    .replace(/\r/g, "<CR>")
    .replace(/\n/g, "<LF>\n");
}

interface TrackedTerminal {
  terminal: vscode.Terminal;
  label: string;
  t0: number;
}

/**
 * Captures the raw write stream of specific terminals into an output channel.
 * No-op unless DEVSTACK_DEBUG is set.
 */
export class TerminalDebugRecorder implements vscode.Disposable {
  private readonly out = vscode.window.createOutputChannel("DevStack Debug");
  private readonly tracked: TrackedTerminal[] = [];
  private writeListener?: vscode.Disposable;

  constructor() {
    if (!isDebugEnabled()) {
      return;
    }
    // Proposed API: window.onDidWriteTerminalData. Accessed dynamically to keep
    // it out of the type-checked surface and out of the prod code path.
    const onDidWriteTerminalData = (vscode.window as unknown as {
      onDidWriteTerminalData?: vscode.Event<{ terminal: vscode.Terminal; data: string }>;
    }).onDidWriteTerminalData;

    if (!onDidWriteTerminalData) {
      this.out.appendLine(
        "[debug] onDidWriteTerminalData unavailable — relaunch with --enable-proposed-api and the proposed dts."
      );
      return;
    }

    this.writeListener = onDidWriteTerminalData((event) => {
      const entry = this.tracked.find((t) => t.terminal === event.terminal);
      if (!entry) {
        return;
      }
      const dt = Date.now() - entry.t0;
      this.out.appendLine(`[+${dt}ms] [${entry.label}] ${visualize(event.data)}`);
    });
    this.out.appendLine("[debug] terminal data recorder active (DEVSTACK_DEBUG set)");
  }

  /** Start recording writes for a terminal. The t0 origin is now. */
  track(terminal: vscode.Terminal, label: string): void {
    if (!isDebugEnabled()) {
      return;
    }
    this.tracked.push({ terminal, label, t0: Date.now() });
    this.out.appendLine(`[+0ms] [${label}] === terminal created, recording ===`);
  }

  dispose(): void {
    this.writeListener?.dispose();
    this.out.dispose();
  }
}
