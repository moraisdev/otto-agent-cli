/**
 * Learning Commands - Review and approve/reject pending skill/command proposals
 */

import "reflect-metadata";
import { Group, Command, Arg, Option } from "../decorators.js";
import { fail } from "../context.js";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { expandHome, getAgent, getDefaultAgentId } from "../../router/index.js";
import { listPending, readPending, discardPending } from "../../learning/staging.js";
import { validateSkillContent } from "../../learning/apply-skill.js";
import { dbUpsertInsightLink, dbAddInsightComment } from "../../insights/index.js";

const LEARNED_PLUGIN_NAME = "otto-learned";

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function resolveAgentCwd(agentId?: string): { id: string; cwd: string } {
  const id = agentId ?? getDefaultAgentId();
  if (!id) {
    fail("No agent specified and no default agent configured");
  }
  const agent = getAgent(id);
  if (!agent) {
    fail(`Agent not found: ${id}`);
  }
  return { id: agent.id, cwd: expandHome(agent.cwd) };
}

/**
 * Active skills directory discovered by the runtime plugin loader.
 *
 * Skills are discovered from `~/otto/plugins/<plugin>/skills/<name>/SKILL.md`
 * (see src/plugins/index.ts getUserPlugins + src/plugins/codex-skills.ts, which
 * syncs them into ~/.codex/skills on daemon start). Approved skills land in a
 * dedicated managed user plugin so they activate on the next daemon start
 * without a rebuild.
 */
function getActiveSkillsDir(): string {
  return join(homedir(), "otto", "plugins", LEARNED_PLUGIN_NAME, "skills");
}

function ensureLearnedPluginManifest(): void {
  const pluginDir = join(homedir(), "otto", "plugins", LEARNED_PLUGIN_NAME);
  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (existsSync(manifestPath)) {
    return;
  }
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify({ name: LEARNED_PLUGIN_NAME, description: "Skills approved via otto learning" }, null, 2),
  );
}

function listActiveSkillNames(activeSkillsDir: string): string[] {
  if (!existsSync(activeSkillsDir)) {
    return [];
  }
  return readdirSync(activeSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

export interface ApproveResult {
  ok: boolean;
  problems: string[];
  activeFile?: string;
}

/**
 * Core approve logic (testable, no global side effects beyond the provided dirs).
 * Moves the staged SKILL.md into the active skills dir, records lineage, and
 * discards the pending item.
 */
export function runLearningApprove(cwd: string, id: string, activeSkillsDir: string, agentId: string): ApproveResult {
  const pending = readPending(cwd, id);
  if (!pending) {
    return { ok: false, problems: [`pending item not found: ${id}`] };
  }

  const content = pending.files["SKILL.md"];
  if (typeof content !== "string") {
    return { ok: false, problems: ["pending item has no SKILL.md"] };
  }

  const existingNames = listActiveSkillNames(activeSkillsDir);
  const validation = validateSkillContent({ name: pending.name, content }, existingNames);
  if (!validation.ok) {
    return { ok: false, problems: validation.problems };
  }

  const targetDir = join(activeSkillsDir, pending.name);
  const activeFile = join(targetDir, "SKILL.md");
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(activeFile, content);

  dbUpsertInsightLink({
    insightId: pending.insightId,
    targetType: "agent",
    targetId: agentId,
    label: "skill-approved",
  });

  discardPending(cwd, id);

  return { ok: true, problems: [], activeFile };
}

/**
 * Core reject logic. Discards the pending item and records the reason as a
 * comment on the originating insight (suppresses re-proposal).
 */
export function runLearningReject(cwd: string, id: string, reason: string): void {
  const pending = readPending(cwd, id);
  if (!pending) {
    throw new Error(`Pending item not found: ${id}`);
  }

  dbAddInsightComment({
    insightId: pending.insightId,
    body: `rejected: ${reason}`,
    author: { kind: "human", name: "user" },
  });

  discardPending(cwd, id);
}

@Group({
  name: "learning",
  description: "Review and approve pending skill/command proposals",
  scope: "admin",
})
export class LearningCommands {
  @Command({ name: "pending", description: "List pending skill/command proposals" })
  pending(
    @Option({ flags: "--agent <id>", description: "Agent ID" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    return this.list(agentId, undefined, undefined, asJson);
  }

  @Command({ name: "list", description: "List pending skill/command proposals" })
  list(
    @Option({ flags: "--agent <id>", description: "Agent ID" }) agentId?: string,
    @Option({ flags: "--limit <n>", description: "Page size (default: 50)" }) limit?: string,
    @Option({ flags: "--offset <n>", description: "Number of proposals to skip (default: 0)" }) offset?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const { cwd } = resolveAgentCwd(agentId);
    const all = listPending(cwd);
    const offsetN = Math.max(0, Number.parseInt(offset ?? "0", 10) || 0);
    const limitN = Math.max(1, Number.parseInt(limit ?? "50", 10) || 50);
    const pending = all.slice(offsetN, offsetN + limitN);

    if (asJson) {
      printJson(pending);
      return pending;
    }

    if (pending.length === 0) {
      console.log("No pending proposals.");
      return pending;
    }

    console.log("\nPending Proposals:\n");
    console.log("  ID        KIND     NAME                          SUMMARY");
    console.log("  --------  -------  ----------------------------  --------------------");
    for (const item of pending) {
      const id = item.id.padEnd(8);
      const kind = item.kind.padEnd(7);
      const name = item.name.padEnd(28);
      console.log(`  ${id}  ${kind}  ${name}  ${item.summary}`);
    }
    console.log(`\n  Showing ${pending.length} of ${all.length} (offset ${offsetN})`);
    console.log("\nUsage:");
    console.log("  otto learning approve <id>            # Approve and activate skill");
    console.log("  otto learning reject <id> --reason …  # Reject with a reason");
    return pending;
  }

  @Command({ name: "approve", description: "Approve a pending proposal and activate it" })
  approve(
    @Arg("id", { description: "Pending proposal ID" }) id: string,
    @Option({ flags: "--agent <id>", description: "Agent ID" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const { id: resolvedAgentId, cwd } = resolveAgentCwd(agentId);

    const pending = readPending(cwd, id);
    if (!pending) {
      fail(`Pending item not found: ${id}`);
    }

    ensureLearnedPluginManifest();
    const activeSkillsDir = getActiveSkillsDir();
    const result = runLearningApprove(cwd, id, activeSkillsDir, resolvedAgentId);

    if (!result.ok) {
      fail(`Cannot approve ${id}:\n  - ${result.problems.join("\n  - ")}`);
    }

    if (asJson) {
      printJson({ status: "approved", id, name: pending.name, ...result });
    } else {
      console.log(`✓ Approved: ${pending.name}`);
      console.log(`  Active: ${result.activeFile}`);
      console.log("  Restart the daemon to load the new skill: otto daemon restart");
    }
    return result;
  }

  @Command({ name: "reject", description: "Reject a pending proposal with a reason" })
  reject(
    @Arg("id", { description: "Pending proposal ID" }) id: string,
    @Option({ flags: "--reason <text>", description: "Reason for rejection" }) reason?: string,
    @Option({ flags: "--agent <id>", description: "Agent ID" }) agentId?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    if (!reason) {
      fail("A reason is required: otto learning reject <id> --reason <text>");
    }
    const { cwd } = resolveAgentCwd(agentId);

    const pending = readPending(cwd, id);
    if (!pending) {
      fail(`Pending item not found: ${id}`);
    }

    runLearningReject(cwd, id, reason);

    const payload = { ok: true as const, id, name: pending.name, reason };
    if (asJson) {
      printJson({ status: "rejected", ...payload });
    } else {
      console.log(`✓ Rejected: ${pending.name}`);
      console.log(`  Reason: ${reason}`);
    }
    return payload;
  }
}
