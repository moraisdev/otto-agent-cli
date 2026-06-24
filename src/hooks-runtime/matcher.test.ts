import { describe, expect, it } from "bun:test";
import { matchesHook, resolveChangedCwd, resolveToolFilePaths } from "./matcher.js";
import type { HookRecord, NormalizedHookEvent } from "./types.js";

function makeHook(overrides: Partial<HookRecord> = {}): HookRecord {
  return {
    id: "hook_1",
    name: "workspace bridge",
    eventName: "FileChanged",
    scopeType: "workspace",
    scopeValue: "/tmp/otto-workspace",
    actionType: "inject_context",
    actionPayload: { message: "hi" },
    enabled: true,
    async: false,
    cooldownMs: 0,
    fireCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("hooks-runtime matcher", () => {
  it("matches workspace-scoped file events by path prefix", () => {
    const hook = makeHook({ matcher: "**/*.ts" });
    const event: NormalizedHookEvent = {
      eventName: "FileChanged",
      source: "test",
      sessionName: "dev",
      cwd: "/tmp/otto-workspace",
      workspace: "/tmp/otto-workspace",
      path: "/tmp/otto-workspace/src/index.ts",
      paths: ["/tmp/otto-workspace/src/index.ts"],
    };

    expect(matchesHook(hook, event)).toBe(true);
  });

  it("does not match files outside the configured workspace", () => {
    const hook = makeHook({ matcher: "**/*.ts" });
    const event: NormalizedHookEvent = {
      eventName: "FileChanged",
      source: "test",
      sessionName: "dev",
      cwd: "/tmp/other",
      workspace: "/tmp/other",
      path: "/tmp/other/src/index.ts",
      paths: ["/tmp/other/src/index.ts"],
    };

    expect(matchesHook(hook, event)).toBe(false);
  });

  it("extracts changed file paths from write tools", () => {
    expect(
      resolveToolFilePaths({
        toolName: "Write",
        toolInput: { file_path: "src/runtime.ts" },
        cwd: "/tmp/otto-workspace",
      }),
    ).toEqual(["/tmp/otto-workspace/src/runtime.ts"]);
  });

  it("detects cwd changes from EnterWorktree and Bash", () => {
    expect(
      resolveChangedCwd({
        toolName: "EnterWorktree",
        toolInput: { path: "packages/core" },
        cwd: "/tmp/otto-workspace",
      }),
    ).toBe("/tmp/otto-workspace/packages/core");

    expect(
      resolveChangedCwd({
        toolName: "Bash",
        toolInput: { command: "cd scripts && bun test" },
        cwd: "/tmp/otto-workspace",
      }),
    ).toBe("/tmp/otto-workspace/scripts");
  });
});
