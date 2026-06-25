import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../../test/otto-state.js";

let stateDir: string | null = null;

interface PublishedPrompt {
  sessionName: string;
  payload: Record<string, unknown>;
}

const publishedPrompts: PublishedPrompt[] = [];

mock.module("../../omni/session-stream.js", () => ({
  publishSessionPrompt: async (sessionName: string, payload: Record<string, unknown>) => {
    publishedPrompts.push({ sessionName, payload });
  },
}));

const { dbCreateAgent } = await import("../../router/router-db.js");
const { companionAgentId } = await import("../../fusion/companion-id.js");
const { setFusionDisabled } = await import("../../fusion/state.js");
const { createFusionConsultNudgeHook, resetFusionNudgeState, NUDGE_THRESHOLD } = await import(
  "../fusion-consult-nudge.js"
);

async function runHook(
  hook: ReturnType<typeof createFusionConsultNudgeHook>,
  toolName: string,
  toolInput: Record<string, unknown> = {},
): Promise<unknown> {
  return hook.hooks[0]({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput }, null, {
    signal: new AbortController().signal,
  });
}

function seedFusionActiveAgent(agentId: string): void {
  dbCreateAgent({ id: agentId, cwd: "/tmp/otto-fusion-nudge", provider: "claude", model: "opus" });
  dbCreateAgent({
    id: companionAgentId(agentId),
    cwd: "/tmp/otto-fusion-nudge",
    provider: "codex",
    model: "gpt-5.5",
    mode: "sentinel",
  });
}

describe("fusion-consult-nudge hook", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-fusion-nudge-test-");
    publishedPrompts.length = 0;
    resetFusionNudgeState();
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("is a no-op when fusion is not active for the agent (no companion exists)", async () => {
    dbCreateAgent({ id: "lone", cwd: "/tmp/otto-fusion-nudge", provider: "claude", model: "opus" });
    const hook = createFusionConsultNudgeHook({ agentId: "lone", sessionName: "agent:lone:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 2; i += 1) {
      await runHook(hook, "Edit", { file_path: "/tmp/x.ts", old_string: "a", new_string: "b" });
    }

    expect(publishedPrompts).toHaveLength(0);
  });

  it("fires exactly one nudge after the threshold of unbroken edits", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 2; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/${i}.ts` });
    }

    expect(publishedPrompts).toHaveLength(1);
    const nudge = publishedPrompts[0];
    expect(nudge.sessionName).toBe("agent:lead:main");
    expect(nudge.payload.deliveryBarrier).toBe("after_tool");
    expect(String(nudge.payload.prompt)).toContain("without consulting the peer");
    expect(String(nudge.payload.prompt)).toContain("peer-companion-lead");
  });

  it("does not count read-only tools toward the edit budget", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 5; i += 1) {
      await runHook(hook, "Read", { file_path: "/tmp/x.ts" });
      await runHook(hook, "Grep", { pattern: "foo" });
      await runHook(hook, "Glob", { pattern: "*.ts" });
    }

    expect(publishedPrompts).toHaveLength(0);
  });

  it("resets the counter when the lead consults the peer companion via Bash", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD - 1; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/${i}.ts` });
    }
    await runHook(hook, "Bash", {
      command: 'otto sessions send agent:peer-companion-lead:main "review?" -w --timeout 90',
    });
    // After the consult the counter is back to zero, so the next two edits
    // must not trigger a nudge.
    await runHook(hook, "Edit", { file_path: "/tmp/post.ts" });
    await runHook(hook, "Edit", { file_path: "/tmp/post2.ts" });

    expect(publishedPrompts).toHaveLength(0);
  });

  it("does not retrigger after a single nudge until the lead consults again", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 10; i += 1) {
      await runHook(hook, "Write", { file_path: `/tmp/${i}.ts`, content: "" });
    }

    expect(publishedPrompts).toHaveLength(1);
  });

  it("rearms after a consult so the next streak can nudge again", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 1; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/${i}.ts` });
    }
    expect(publishedPrompts).toHaveLength(1);

    await runHook(hook, "Bash", {
      command: 'otto sessions send agent:peer-companion-lead:main "follow-up" -w',
    });
    for (let i = 0; i < NUDGE_THRESHOLD + 1; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/post-${i}.ts` });
    }

    expect(publishedPrompts).toHaveLength(2);
  });

  it("respects the per-agent fusion off switch", async () => {
    seedFusionActiveAgent("lead");
    setFusionDisabled("lead", true);
    const hook = createFusionConsultNudgeHook({ agentId: "lead", sessionName: "agent:lead:main" });

    for (let i = 0; i < NUDGE_THRESHOLD + 5; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/${i}.ts` });
    }

    expect(publishedPrompts).toHaveLength(0);
  });

  it("is a no-op for the companion's own session (no recursive nudge)", async () => {
    seedFusionActiveAgent("lead");
    const hook = createFusionConsultNudgeHook({
      agentId: "peer-companion-lead",
      sessionName: "agent:peer-companion-lead:main",
    });

    for (let i = 0; i < NUDGE_THRESHOLD + 5; i += 1) {
      await runHook(hook, "Edit", { file_path: `/tmp/${i}.ts` });
    }

    expect(publishedPrompts).toHaveLength(0);
  });
});
