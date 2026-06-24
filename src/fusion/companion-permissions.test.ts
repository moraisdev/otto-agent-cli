import { describe, expect, it } from "bun:test";
import { buildCompanionReadOnlyGrants, DENIED_FOR_COMPANION } from "./companion-permissions.js";

describe("companion permission profile", () => {
  it("grants Bash plus read-only analysis executables (the real Codex gate)", () => {
    const grants = buildCompanionReadOnlyGrants();
    const tools = grants.filter((g) => g.objectType === "tool").map((g) => g.objectId);
    const execs = grants.filter((g) => g.objectType === "executable").map((g) => g.objectId);
    expect(tools).toContain("Bash");
    expect(execs).toContain("rg");
    expect(execs).toContain("git");
    expect(execs).toContain("sed");
    expect(execs).toContain("bun");
  });

  it("grants the otto CLI so the peer can read the lead's work and inform it back", () => {
    // Without `execute executable:otto`, both `otto sessions read` (see the lead's
    // real work) and `otto sessions inform` (proactive findings) die denied.
    const grants = buildCompanionReadOnlyGrants();
    const execs = grants.filter((g) => g.objectType === "executable").map((g) => g.objectId);
    expect(execs).toContain("otto");
  });

  it("uses the 'execute' relation for executables", () => {
    const grants = buildCompanionReadOnlyGrants();
    for (const g of grants.filter((x) => x.objectType === "executable")) {
      expect(g.relation).toBe("execute");
    }
  });

  it("codex peer: does NOT grant placebo Claude-SDK tools or any mutating shell", () => {
    const grants = buildCompanionReadOnlyGrants("codex");
    const objects = grants.map((g) => `${g.objectType}:${g.objectId}`);
    // Codex has no SDK tools — granting them would be a no-op.
    for (const placebo of ["tool:Read", "tool:Grep", "tool:Glob"]) {
      expect(objects).not.toContain(placebo);
    }
    for (const mutating of ["executable:rm", "executable:cp", "executable:mv", "executable:mkdir"]) {
      expect(objects).not.toContain(mutating);
    }
  });

  it("claude peer: grants read-only SDK tools (Read/Grep/Glob) but never Write/Edit", () => {
    const grants = buildCompanionReadOnlyGrants("claude");
    const objects = grants.map((g) => `${g.objectType}:${g.objectId}`);
    expect(objects).toContain("tool:Bash");
    for (const ro of ["tool:Read", "tool:Grep", "tool:Glob"]) {
      expect(objects).toContain(ro);
    }
    for (const denied of ["tool:Write", "tool:Edit", "tool:NotebookEdit"]) {
      expect(objects).not.toContain(denied);
    }
    // still has the executable allowlist for shelling out (tests/build/git read)
    expect(objects).toContain("executable:git");
  });

  it("keeps write tools on the denied reference list", () => {
    expect(DENIED_FOR_COMPANION).toContain("tool:Write");
    expect(DENIED_FOR_COMPANION).toContain("tool:Edit");
  });
});
