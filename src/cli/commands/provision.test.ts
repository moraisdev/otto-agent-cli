import { describe, it, expect, mock } from "bun:test";
import type { ProvisionOps } from "../../learning/provisioning.js";

const adminSet = new Set<string>(["agent:main", "system:owner"]);

mock.module("../../learning/admin-gate.js", () => ({
  isSenderAdmin: (sender: string | undefined) => (sender ? adminSet.has(sender) : false),
}));

const { runProvision, parseCapability } = await import("./provision.js");

function fakeOps(): { ops: ProvisionOps; calls: string[] } {
  const calls: string[] = [];
  const ops: ProvisionOps = {
    createAgent: async (id: string) => {
      calls.push(`create:${id}`);
    },
    grant: async (s: string, r: string, o: string) => {
      calls.push(`grant:${s}:${r}:${o}`);
    },
    writeWorkspace: async (cwd: string) => {
      calls.push(`ws:${cwd}`);
    },
    addRoute: async (i: string, p: string, a: string) => {
      calls.push(`route:${i}:${p}:${a}`);
    },
  };
  return { ops, calls };
}

const base = {
  agentId: "clickup",
  instance: "wa-main",
  group: "group:123@g.us",
  role: "ClickUp assistant",
  caps: ["execute:executable:clickup"],
};

describe("parseCapability", () => {
  it("splits on the first colon only so targets keep their colons", () => {
    expect(parseCapability("execute:executable:clickup")).toEqual({ verb: "execute", target: "executable:clickup" });
  });
  it("rejects malformed input", () => {
    expect(() => parseCapability("noseparator")).toThrow();
    expect(() => parseCapability(":target")).toThrow();
    expect(() => parseCapability("verb:")).toThrow();
  });
});

describe("runProvision", () => {
  it("denies non-admin senders without touching ops", async () => {
    const { ops, calls } = fakeOps();
    const run = await runProvision({ ...base, confirm: true, sender: "agent:intruder" }, ops);
    expect(run.status).toBe("denied");
    expect(calls).toHaveLength(0);
  });

  it("without --confirm scaffolds but does not add a route", async () => {
    const { ops, calls } = fakeOps();
    const run = await runProvision({ ...base, confirm: false, sender: "system:owner" }, ops);
    expect(run.status).toBe("awaiting_confirmation");
    expect(calls.some((c) => c.startsWith("create:"))).toBe(true);
    expect(calls.some((c) => c.startsWith("grant:"))).toBe(true);
    expect(calls.some((c) => c.startsWith("route:"))).toBe(false);
  });

  it("with --confirm activates the route", async () => {
    const { ops, calls } = fakeOps();
    const run = await runProvision({ ...base, confirm: true, sender: "system:owner" }, ops);
    expect(run.status).toBe("activated");
    expect(calls.some((c) => c.startsWith("route:"))).toBe(true);
  });

  it("uses the default admin subject when sender is omitted", async () => {
    const { ops } = fakeOps();
    const run = await runProvision({ ...base, confirm: false }, ops);
    expect(run.status).toBe("awaiting_confirmation");
  });

  it("strips escalation capabilities from the grants", async () => {
    const { ops, calls } = fakeOps();
    const run = await runProvision(
      { ...base, caps: ["admin:system:*", "execute:executable:clickup"], confirm: false, sender: "system:owner" },
      ops,
    );
    expect(run.result?.blocked).toHaveLength(1);
    expect(calls.some((c) => c.includes("system:*"))).toBe(false);
    expect(calls.some((c) => c.includes("executable:clickup"))).toBe(true);
  });
});
