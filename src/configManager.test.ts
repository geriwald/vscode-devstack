import { describe, it, expect } from "vitest";
import { mergeServices } from "./configManager";
import { ServiceDefinition } from "./types";

function svc(partial: Partial<ServiceDefinition>): ServiceDefinition {
  return {
    name: "Svc",
    role: "backend",
    command: "run",
    source: "auto",
    ...partial,
  };
}

describe("mergeServices — disable matching", () => {
  it("disables a root service by its name", () => {
    const auto = [svc({ name: "FastAPI Server" })];
    const result = mergeServices(auto, { disable: ["FastAPI Server"] });
    expect(result).toHaveLength(0);
  });

  it("disables a subdir-detected service by its INTRINSIC name (the bug)", () => {
    // A service detected in subdir "vision" is displayed as "FastAPI Server (vision)"
    // but its intrinsic name is "FastAPI Server". The user naturally writes the
    // intrinsic name in `disable`; it must match.
    const auto = [
      svc({ name: "FastAPI Server (vision)", intrinsicName: "FastAPI Server", cwd: "vision" }),
    ];
    const result = mergeServices(auto, { disable: ["FastAPI Server"] });
    expect(result).toHaveLength(0);
  });

  it("still disables a subdir service by its full displayed name (back-compat)", () => {
    const auto = [
      svc({ name: "FastAPI Server (vision)", intrinsicName: "FastAPI Server", cwd: "vision" }),
    ];
    const result = mergeServices(auto, { disable: ["FastAPI Server (vision)"] });
    expect(result).toHaveLength(0);
  });

  it("does not over-disable: same intrinsic name in two subdirs, disable one display name", () => {
    const auto = [
      svc({ name: "FastAPI Server (vision)", intrinsicName: "FastAPI Server", cwd: "vision" }),
      svc({ name: "FastAPI Server (backend)", intrinsicName: "FastAPI Server", cwd: "backend" }),
    ];
    // Disabling by the full display name targets exactly one.
    const result = mergeServices(auto, { disable: ["FastAPI Server (vision)"] });
    expect(result.map((s) => s.name)).toEqual(["FastAPI Server (backend)"]);
  });

  it("keeps services that are not disabled", () => {
    const auto = [svc({ name: "Vite Dev" }), svc({ name: "FastAPI Server (vision)", intrinsicName: "FastAPI Server" })];
    const result = mergeServices(auto, { disable: ["nonexistent"] });
    expect(result).toHaveLength(2);
  });
});
