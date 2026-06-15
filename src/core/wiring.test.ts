import { describe, it, expect } from "vitest";
import { parseCommandFacts, extractWiringRefs } from "./wiring";

describe("parseCommandFacts", () => {
  it("extracts a venv interpreter and its root, plus leading env", () => {
    const cmd =
      "VISION_DEBUG=1 /home/geraud/ComfyUI/venv/bin/python -m uvicorn vision.src.api:app --host 127.0.0.1 --port 8781 --reload";
    const f = parseCommandFacts(cmd);
    expect(f.envAssignments).toEqual({ VISION_DEBUG: "1" });
    expect(f.interpreter).toBe("/home/geraud/ComfyUI/venv/bin/python");
    expect(f.venv).toBe("/home/geraud/ComfyUI/venv");
    expect(f.envFile).toBeUndefined();
  });

  it("extracts inline env and --env-file= for a node command", () => {
    const cmd =
      "PORT=3001 VISION_URL=http://127.0.0.1:8781 IMAGE_ENGINE=mock node --env-file=../.env node_modules/.bin/tsx watch src/index.ts";
    const f = parseCommandFacts(cmd);
    expect(f.envAssignments).toEqual({
      PORT: "3001",
      VISION_URL: "http://127.0.0.1:8781",
      IMAGE_ENGINE: "mock",
    });
    expect(f.envFile).toBe("../.env");
    expect(f.venv).toBeUndefined();
    expect(f.interpreter).toBeUndefined();
  });

  it("supports the space form of --env-file", () => {
    const f = parseCommandFacts("node --env-file .env src/x.ts");
    expect(f.envFile).toBe(".env");
  });

  it("detects a venv from a `source .../activate` prefix", () => {
    const f = parseCommandFacts(
      "source /home/geraud/proj/.venv/bin/activate && python app.py"
    );
    expect(f.venv).toBe("/home/geraud/proj/.venv");
  });

  it("stops collecting env at the first non-assignment token", () => {
    const f = parseCommandFacts("FOO=bar npm run dev BAZ=qux");
    expect(f.envAssignments).toEqual({ FOO: "bar" });
  });
});

describe("extractWiringRefs", () => {
  it("turns a *_URL env value into a host:port edge", () => {
    const f = parseCommandFacts(
      "PORT=3001 VISION_URL=http://127.0.0.1:8781 node x.ts"
    );
    const refs = extractWiringRefs(f, "PORT=3001 VISION_URL=http://127.0.0.1:8781 node x.ts");
    expect(refs).toEqual([
      { label: "VISION_URL", targetHost: "127.0.0.1", targetPort: 8781 },
    ]);
  });

  it("turns a *_PORT env (other than PORT) into a port edge", () => {
    const f = parseCommandFacts("POPIC_BACKEND_PORT=3001 npm run dev");
    const refs = extractWiringRefs(f, "POPIC_BACKEND_PORT=3001 npm run dev");
    expect(refs).toEqual([{ label: "POPIC_BACKEND_PORT", targetPort: 3001 }]);
  });

  it("does not treat the service's own PORT as a wiring target", () => {
    const f = parseCommandFacts("PORT=3001 node x.ts");
    expect(extractWiringRefs(f, "PORT=3001 node x.ts")).toEqual([]);
  });

  it("ignores the service's own --port flag (not a URL)", () => {
    const cmd = "python -m uvicorn app --host 127.0.0.1 --port 8781";
    const f = parseCommandFacts(cmd);
    expect(extractWiringRefs(f, cmd)).toEqual([]);
  });

  it("dedupes references that resolve to the same host:port", () => {
    const cmd = "A_URL=http://localhost:5000 B_URL=http://localhost:5000 node x";
    const f = parseCommandFacts(cmd);
    const refs = extractWiringRefs(f, cmd);
    expect(refs).toHaveLength(1);
    expect(refs[0].targetPort).toBe(5000);
  });
});
