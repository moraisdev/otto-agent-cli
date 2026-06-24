import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bindGroupToProjectSession, groupRoutePattern, resolveSessionGroupTargets } from "./session-binding.js";
import { dbGetRoute } from "./router-db.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";

let stateDir: string | null = null;

describe("groupRoutePattern", () => {
  it("builds a group: route pattern from a group id", () => {
    expect(groupRoutePattern("120363000@g.us")).toBe("group:120363000@g.us");
  });
  it("does not double-prefix an already-prefixed id", () => {
    expect(groupRoutePattern("group:123")).toBe("group:123");
  });
});

describe("bindGroupToProjectSession", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-session-binding-test-");
  });
  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("creates a route mapping the group to the project session", () => {
    bindGroupToProjectSession({
      groupId: "120363abc",
      sessionName: "proj-myapp-1a2b3c4d",
      accountId: "default",
      agentId: "main",
    });
    const route = dbGetRoute("group:120363abc", "default");
    expect(route?.session).toBe("proj-myapp-1a2b3c4d");
    expect(route?.agent).toBe("main");
  });

  it("resolves the group targets bound to a session (for fan-out)", () => {
    bindGroupToProjectSession({ groupId: "g1", sessionName: "proj-x-1", accountId: "default", agentId: "main" });
    const targets = resolveSessionGroupTargets("proj-x-1");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ chatId: "g1", accountId: "default" });
  });

  it("excludes the originating target from fan-out (no echo back to sender)", () => {
    bindGroupToProjectSession({ groupId: "g2", sessionName: "proj-y-1", accountId: "default", agentId: "main" });
    const targets = resolveSessionGroupTargets("proj-y-1", { accountId: "default", chatId: "g2" });
    expect(targets).toHaveLength(0);
  });
});
