import { describe, expect, it } from "bun:test";
import { buildRuntimeEnv } from "./host-env.js";
import type { RuntimeCapabilities } from "./types.js";

const capabilities: RuntimeCapabilities = {
  runtimeControl: { supported: false, operations: [] },
  dynamicTools: { mode: "none" },
  execution: { mode: "sdk" },
  sessionState: { mode: "provider-session-id" },
  usage: { semantics: "terminal-event" },
  tools: {
    permissionMode: "otto-host",
    accessRequirement: "tool_and_executable",
    supportsParallelCalls: false,
  },
  systemPrompt: { mode: "append" },
  terminalEvents: { guarantee: "adapter" },
  skillVisibility: { availability: "none", loadedState: "none" },
  supportsSessionResume: true,
  supportsSessionFork: true,
  supportsPartialText: true,
  supportsToolHooks: true,
  supportsPlugins: true,
  supportsMcpServers: true,
  supportsRemoteSpawn: true,
};

describe("runtime host env", () => {
  it("keeps Otto-owned env authoritative over base and provider bootstrap env", () => {
    const env = buildRuntimeEnv(
      {
        PATH: "/usr/bin",
        OTTO_TASK_ID: "stale-task",
        OTTO_CONTEXT_KEY: "stale-context",
      },
      {
        OTTO_CONTEXT_KEY: "runtime-context",
        OTTO_SESSION_NAME: "runtime-session",
      },
      {
        OTTO_CONTEXT_KEY: "provider-context",
        OTTO_SESSION_NAME: "provider-session",
        PROVIDER_FLAG: "1",
      },
      capabilities,
    );

    expect(env.OTTO_CONTEXT_KEY).toBe("runtime-context");
    expect(env.OTTO_SESSION_NAME).toBe("runtime-session");
    expect(env.OTTO_TASK_ID).toBeUndefined();
    expect(env.PROVIDER_FLAG).toBe("1");
  });
});
