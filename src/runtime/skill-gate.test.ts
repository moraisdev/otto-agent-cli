import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { createRuntimeContext } from "./context-registry.js";
import { dbUpsertSkillGateRule, getOrCreateSession, getSession } from "../router/index.js";
import { evaluateSkillGate, runtimeSkillGateForCommand, runtimeSkillGateForTool } from "./skill-gate.js";
import { createRuntimeHostServices } from "./host-services.js";
import type { RuntimeSkillVisibilitySnapshot } from "./types.js";

let stateDir: string | null = null;
let previousCodexHome: string | undefined;

beforeEach(async () => {
  previousCodexHome = process.env.CODEX_HOME;
  stateDir = await createIsolatedOttoState("otto-skill-gate-");
  process.env.CODEX_HOME = join(stateDir, "codex");
});

afterEach(async () => {
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }
  await cleanupIsolatedOttoState(stateDir);
  stateDir = null;
});

function writeCodexSkill(name: string): void {
  const dir = join(process.env.CODEX_HOME!, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n\n# ${name}\n\nUse this skill before running the tool.\n`,
  );
}

describe("evaluateSkillGate", () => {
  it("soft-gates a missing skill, delivers it, and marks it loaded for the session", () => {
    writeCodexSkill("demo-skill");
    getOrCreateSession("agent:main:main", "main", stateDir!, {
      name: "skill-gate-test",
      runtimeProvider: "codex",
      providerSessionId: "thread-1",
      runtimeSessionDisplayId: "thread-1",
    });
    const context = createRuntimeContext({
      kind: "agent-runtime",
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionName: "skill-gate-test",
    });

    const first = evaluateSkillGate({
      gate: { skill: "demo-skill", source: "config" },
      context,
      toolName: "demo_run",
    });

    expect(first.allowed).toBe(false);
    expect(first.code).toBe("OTTO_SKILL_REQUIRED");
    expect(first.reason).toContain("# demo-skill");

    const persisted = getSession("agent:main:main")?.runtimeSessionParams
      ?.skillVisibility as RuntimeSkillVisibilitySnapshot;
    expect(persisted.loadedSkills).toEqual(["demo-skill"]);

    const second = evaluateSkillGate({
      gate: { skill: "demo-skill", source: "config" },
      context,
      toolName: "demo_run",
    });

    expect(second.allowed).toBe(true);
  });

  it("reports configuration errors distinctly when the declared skill does not exist", () => {
    getOrCreateSession("agent:main:main", "main", stateDir!, { name: "skill-gate-test", runtimeProvider: "codex" });
    const context = createRuntimeContext({
      kind: "agent-runtime",
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionName: "skill-gate-test",
    });

    const decision = evaluateSkillGate({
      gate: { skill: "missing-skill", source: "config" },
      context,
      toolName: "demo_run",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("OTTO_SKILL_GATE_CONFIG_ERROR");
    expect(decision.reason).toContain("no installed or catalog skill provides it");
  });

  it("resolves flexible operator-configured gates for tools and external CLI commands", () => {
    dbUpsertSkillGateRule({ id: "external-lookup", tool: "external_lookup", skill: "external-skill" });
    dbUpsertSkillGateRule({ id: "github-issue", commandPrefix: "gh issue", skill: "github" });

    const toolGate = runtimeSkillGateForTool("external_lookup");
    if (!toolGate) {
      throw new Error("Expected external_lookup to resolve a configured skill gate.");
    }
    expect(toolGate).toMatchObject({
      skill: "external-skill",
      source: "config",
    });
    expect(Object.prototype.hasOwnProperty.call(toolGate, "variant")).toBe(false);
    expect(runtimeSkillGateForCommand("gh issue view 123")).toMatchObject({
      skill: "github",
      source: "config",
    });
  });

  it("applies operator overrides and removals to default Otto group gates", () => {
    dbUpsertSkillGateRule({ id: "image", skill: "custom-image-skill" });
    dbUpsertSkillGateRule({ id: "tasks", disabled: true });
    dbUpsertSkillGateRule({ id: "linear", pattern: "^linear(?:[._]|$)", skill: "linear-skill" });

    expect(runtimeSkillGateForTool("image_generate")).toMatchObject({
      skill: "custom-image-skill",
      source: "config",
      ruleId: "image",
    });
    expect(runtimeSkillGateForTool("tasks_list")).toBeUndefined();
    expect(runtimeSkillGateForCommand("otto tasks list")).toBeUndefined();
    expect(runtimeSkillGateForTool("linear_issue_list")).toMatchObject({
      skill: "linear-skill",
      source: "config",
    });
  });

  it("infers Otto CLI gates from parsed commands without matching quoted text", () => {
    expect(runtimeSkillGateForCommand("bin/otto commands list --agent dev --json")).toMatchObject({
      skill: "otto-system-commands",
      source: "inferred",
      ruleId: "commands",
    });
    expect(runtimeSkillGateForCommand("bin/otto skill-gates list --json")).toMatchObject({
      skill: "otto-system-skill-gates",
      source: "inferred",
      ruleId: "skill-gates",
    });
    expect(runtimeSkillGateForCommand("bin/otto context codex-bash-hook")).toBeUndefined();
    expect(runtimeSkillGateForCommand('echo "otto tasks list"')).toBeUndefined();
  });
});

describe("runtime host skill-gate enforcement", () => {
  it("delivers and marks a required skill loaded when a dynamic tool is attempted", async () => {
    writeCodexSkill("otto-system-image");
    getOrCreateSession("agent:main:main", "main", stateDir!, {
      name: "skill-gate-test",
      runtimeProvider: "codex",
      providerSessionId: "thread-1",
      runtimeSessionDisplayId: "thread-1",
    });
    const context = createRuntimeContext({
      kind: "agent-runtime",
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionName: "skill-gate-test",
      capabilities: [{ permission: "use", objectType: "tool", objectId: "image_generate", source: "test" }],
    });
    let callbackSnapshot: RuntimeSkillVisibilitySnapshot | undefined;
    const services = createRuntimeHostServices({
      context,
      agentId: "main",
      sessionName: "skill-gate-test",
      toolContext: {},
      onSkillGatePersisted: (skillVisibility) => {
        callbackSnapshot = skillVisibility;
      },
    });

    const result = await services.executeDynamicTool({
      toolName: "image_generate",
      arguments: { prompt: "dry-run skill gate check" },
    });

    expect(result.success).toBe(false);
    const contentItem = result.contentItems[0];
    expect(contentItem?.type).toBe("inputText");
    if (contentItem?.type !== "inputText") {
      throw new Error("Expected skill gate to return text content.");
    }
    expect(contentItem.text).toContain("OTTO_SKILL_REQUIRED: image_generate requires skill otto-system-image");
    expect(contentItem.text).toContain("# otto-system-image");
    expect(callbackSnapshot?.loadedSkills).toEqual(["otto-system-image"]);

    const persisted = getSession("agent:main:main")?.runtimeSessionParams
      ?.skillVisibility as RuntimeSkillVisibilitySnapshot;
    expect(persisted.loadedSkills).toEqual(["otto-system-image"]);
  });

  it("checks Bash permission before delivering a required skill", async () => {
    writeCodexSkill("otto-system-daemon-manager");
    getOrCreateSession("agent:main:main", "main", stateDir!, {
      name: "skill-gate-test",
      runtimeProvider: "codex",
      providerSessionId: "thread-1",
      runtimeSessionDisplayId: "thread-1",
    });
    const context = createRuntimeContext({
      kind: "agent-runtime",
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionName: "skill-gate-test",
    });
    const services = createRuntimeHostServices({
      context,
      agentId: "main",
      sessionName: "skill-gate-test",
      toolContext: {},
    });

    const decision = await services.authorizeCommandExecution({
      command: "otto daemon status",
      input: {},
    });

    expect(decision.approved).toBe(false);
    expect(decision.reason).not.toContain("OTTO_SKILL_REQUIRED");
    expect(decision.reason).toContain("No approval source available");
    expect(getSession("agent:main:main")?.runtimeSessionParams?.skillVisibility).toBeUndefined();
  });

  it("does not infer a Otto skill gate from quoted Bash text", async () => {
    writeCodexSkill("otto-system-tasks");
    getOrCreateSession("agent:main:main", "main", stateDir!, {
      name: "skill-gate-test",
      runtimeProvider: "codex",
      providerSessionId: "thread-1",
      runtimeSessionDisplayId: "thread-1",
    });
    const context = createRuntimeContext({
      kind: "agent-runtime",
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionName: "skill-gate-test",
      capabilities: [
        { permission: "use", objectType: "tool", objectId: "Bash", source: "test" },
        { permission: "execute", objectType: "executable", objectId: "echo", source: "test" },
      ],
    });
    const services = createRuntimeHostServices({
      context,
      agentId: "main",
      sessionName: "skill-gate-test",
      toolContext: {},
    });

    const decision = await services.authorizeCommandExecution({
      command: 'echo "otto tasks list"',
      input: {},
    });

    expect(decision.approved).toBe(true);
    expect(getSession("agent:main:main")?.runtimeSessionParams?.skillVisibility).toBeUndefined();
  });
});
