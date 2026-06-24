import { describe, it, expect } from "bun:test";
import { translateCapabilities, ESCALATION_OBJECTS } from "./nl-to-rebac.js";

describe("translateCapabilities", () => {
  it("maps a single declared capability to minimal grants", () => {
    const r = translateCapabilities("pm", [
      { verb: "execute", target: "executable:clickup" },
      { verb: "use", target: "tool:Read" },
    ]);
    expect(r.grants).toEqual([
      { subject: "agent:pm", relation: "execute", object: "executable:clickup" },
      { subject: "agent:pm", relation: "use", object: "tool:Read" },
    ]);
    expect(r.summary.can).toContain("executable:clickup");
    expect(r.summary.cannot).toContain("everything else");
  });

  it("never emits escalation grants even if requested", () => {
    const r = translateCapabilities("pm", [
      { verb: "admin", target: "system:*" },
      { verb: "execute", target: "group:permissions" },
      { verb: "execute", target: "group:agents" },
    ]);
    expect(r.grants).toEqual([]); // all stripped
    expect(r.blocked.length).toBe(3);
    expect(ESCALATION_OBJECTS).toContain("group:permissions");
  });

  it("defaults to closed when no capability is parsed", () => {
    const r = translateCapabilities("pm", []);
    expect(r.grants).toEqual([]);
    expect(r.summary.can).toEqual([]); // nothing
  });

  it("blocks escalation despite case/whitespace on the verb", () => {
    for (const verb of ["Admin", "admin ", "ADMIN", " admin"]) {
      const r = translateCapabilities("x", [{ verb, target: "executable:clickup" }]);
      expect(r.grants).toHaveLength(0);
      expect(r.blocked).toHaveLength(1);
    }
  });

  it("blocks any system:* target including unlisted and whitespace variants", () => {
    for (const target of ["system:secrets", "system:* ", "System:Tokens", " system:anything"]) {
      const r = translateCapabilities("x", [{ verb: "execute", target }]);
      expect(r.grants).toHaveLength(0);
      expect(r.blocked).toHaveLength(1);
    }
  });

  it("blocks sensitive group subcommands by prefix", () => {
    for (const target of [
      "group:permissions_grant",
      "group:agents_create",
      "group:instances_routes",
      "GROUP:PERMISSIONS_REVOKE",
    ]) {
      const r = translateCapabilities("x", [{ verb: "execute", target }]);
      expect(r.grants).toHaveLength(0);
      expect(r.blocked).toHaveLength(1);
    }
  });

  it("trims whitespace on the generated grant (no dirty padding)", () => {
    const r = translateCapabilities("clickup", [{ verb: " execute ", target: " executable:clickup " }]);
    expect(r.grants).toHaveLength(1);
    expect(r.grants[0]).toEqual({ subject: "agent:clickup", relation: "execute", object: "executable:clickup" });
    expect(r.blocked).toHaveLength(0);
  });

  it("preserves case of legitimate case-sensitive targets like tool:Read", () => {
    const r = translateCapabilities("pm", [{ verb: " use ", target: " tool:Read " }]);
    expect(r.grants[0]).toEqual({ subject: "agent:pm", relation: "use", object: "tool:Read" });
  });
});
