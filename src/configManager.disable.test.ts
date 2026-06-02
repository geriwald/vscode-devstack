import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { addToDisable, loadConfig } from "./configManager";

describe("addToDisable", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "devstack-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(obj: unknown) {
    fs.writeFileSync(path.join(dir, ".devstack.json"), JSON.stringify(obj, null, 2));
  }

  it("creates the config file with the disable entry when none exists", () => {
    addToDisable(dir, "FastAPI Server");
    const cfg = loadConfig(dir);
    expect(cfg.disable).toEqual(["FastAPI Server"]);
  });

  it("appends to an existing disable array", () => {
    writeConfig({ disable: ["Vite Dev"] });
    addToDisable(dir, "FastAPI Server");
    expect(loadConfig(dir).disable).toEqual(["Vite Dev", "FastAPI Server"]);
  });

  it("is idempotent — does not add a duplicate", () => {
    writeConfig({ disable: ["FastAPI Server"] });
    addToDisable(dir, "FastAPI Server");
    expect(loadConfig(dir).disable).toEqual(["FastAPI Server"]);
  });

  it("preserves other config keys", () => {
    writeConfig({ services: [{ name: "X", role: "backend", command: "run" }], disable: [] });
    addToDisable(dir, "FastAPI Server");
    const cfg = loadConfig(dir);
    expect(cfg.services).toHaveLength(1);
    expect(cfg.disable).toEqual(["FastAPI Server"]);
  });

  it("adds disable to a config that has none yet", () => {
    writeConfig({ services: [] });
    addToDisable(dir, "FastAPI Server");
    expect(loadConfig(dir).disable).toEqual(["FastAPI Server"]);
  });

  function writeRaw(text: string) {
    fs.writeFileSync(path.join(dir, ".devstack.json"), text);
  }

  // The bug: a .devstack.json with comments (commenting out disable entries to
  // test the hide button) is not valid strict JSON. The old loadConfig caught
  // the parse error and returned {}, so addToDisable rewrote a minimal file and
  // wiped the user's services. JSONC tolerates the comments.
  it("preserves services when the config has comments (JSONC)", () => {
    writeRaw(
      [
        "{",
        '  "services": [',
        '    { "name": "Bulle backend", "role": "backend", "command": "uvicorn" }',
        "  ],",
        '  "disable": [',
        '    // "FastAPI Server (webapp/backend)",',
        '    // "Vite Dev (webapp/frontend)"',
        "  ]",
        "}",
      ].join("\n")
    );
    addToDisable(dir, "FastAPI Server (webapp/backend)");
    const cfg = loadConfig(dir);
    expect(cfg.services).toHaveLength(1);
    expect(cfg.disable).toEqual(["FastAPI Server (webapp/backend)"]);
  });

  // Genuinely broken config (not just comments): never silently overwrite it.
  it("refuses to overwrite a config that cannot be parsed", () => {
    writeRaw('{ "services": [ { "name": broken ] ');
    const before = fs.readFileSync(path.join(dir, ".devstack.json"), "utf-8");
    expect(() => addToDisable(dir, "FastAPI Server")).toThrow();
    const after = fs.readFileSync(path.join(dir, ".devstack.json"), "utf-8");
    expect(after).toEqual(before);
  });
});
