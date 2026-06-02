// Minimal stub of the 'vscode' module for unit tests run under Node/Vitest.
// Only the surface touched by the modules under test needs to exist; extend as
// new tests require more. The functions under test (detection, config merge)
// do not call into vscode at runtime, so empty stubs are enough.

export const workspace = {
  openTextDocument: async () => ({}),
};

export const window = {
  showTextDocument: async () => ({}),
  createOutputChannel: () => ({ appendLine() {}, dispose() {}, show() {} }),
};

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export const Uri = {
  file: (p: string) => ({ fsPath: p }),
};
