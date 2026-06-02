import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // The 'vscode' module only exists inside the VS Code host. Stub it so
      // pure logic (detection, config merge) can be unit-tested in Node.
      vscode: path.resolve(__dirname, "src/test/vscode-stub.ts"),
    },
  },
});
