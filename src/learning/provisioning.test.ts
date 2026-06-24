import { describe, it, expect } from "bun:test";
import { provisionAgent } from "./provisioning.js";

const ops = () => {
  const calls: string[] = [];
  return {
    calls,
    createAgent: async (id: string, cwd: string) => {
      calls.push(`create:${id}:${cwd}`);
    },
    grant: async (s: string, r: string, o: string) => {
      calls.push(`grant:${s}:${r}:${o}`);
    },
    writeWorkspace: async (cwd: string, _agentsMd: string) => {
      calls.push(`ws:${cwd}`);
    },
    addRoute: async (_instance: string, pattern: string, agent: string) => {
      calls.push(`route:${pattern}:${agent}`);
    },
  };
};

describe("provisionAgent", () => {
  it("does not add route before confirmation", async () => {
    const o = ops();
    const result = await provisionAgent({
      senderIsAdmin: true,
      agentId: "pm",
      instance: "main",
      groupPattern: "group:123",
      role: "PM que move cards no ClickUp",
      capabilities: [{ verb: "execute", target: "executable:clickup" }],
      confirmed: false,
      ops: o,
    });
    expect(result.status).toBe("awaiting_confirmation");
    expect(o.calls.some((c) => c.startsWith("route:"))).toBe(false);
    expect(result.summary.can).toContain("execute executable:clickup");
  });

  it("rejects non-admin sender", async () => {
    const o = ops();
    const result = await provisionAgent({
      senderIsAdmin: false,
      agentId: "pm",
      instance: "main",
      groupPattern: "group:123",
      role: "x",
      capabilities: [],
      confirmed: false,
      ops: o,
    });
    expect(result.status).toBe("denied");
    expect(o.calls).toEqual([]);
  });

  it("activates route only when confirmed", async () => {
    const o = ops();
    const result = await provisionAgent({
      senderIsAdmin: true,
      agentId: "pm",
      instance: "main",
      groupPattern: "group:123",
      role: "PM",
      capabilities: [{ verb: "execute", target: "executable:clickup" }],
      confirmed: true,
      ops: o,
    });
    expect(result.status).toBe("activated");
    expect(o.calls.some((c) => c === "route:group:123:pm")).toBe(true);
  });

  it("returns route_failed (without throwing) when addRoute throws after confirmation", async () => {
    const o = ops();
    o.addRoute = async () => {
      throw new Error("db locked");
    };
    const result = await provisionAgent({
      senderIsAdmin: true,
      agentId: "pm",
      instance: "main",
      groupPattern: "group:123",
      role: "PM",
      capabilities: [{ verb: "execute", target: "executable:clickup" }],
      confirmed: true,
      ops: o,
    });
    expect(result.status).toBe("route_failed");
    expect(result.error).toContain("db locked");
    expect(o.calls.some((c) => c.startsWith("create:"))).toBe(true);
    expect(o.calls.some((c) => c.startsWith("grant:"))).toBe(true);
    expect(o.calls.some((c) => c.startsWith("route:"))).toBe(false);
  });
});
