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
});
