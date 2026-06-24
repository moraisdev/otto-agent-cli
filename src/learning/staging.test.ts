import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stagePending, listPending, readPending } from "./staging.js";

describe("staging", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "otto-stg-"));
  });
  it("stages a skill artifact with manifest and lists it", () => {
    const id = stagePending(cwd, {
      kind: "skill",
      name: "move-clickup-card",
      insightId: "i1",
      summary: "Mover card",
      files: { "SKILL.md": "# Move card\n..." },
    });
    expect(existsSync(join(cwd, ".pending", id, "SKILL.md"))).toBe(true);
    expect(listPending(cwd).find((p) => p.id === id)?.name).toBe("move-clickup-card");
    expect(readPending(cwd, id)?.files["SKILL.md"]).toContain("Move card");
  });
});
