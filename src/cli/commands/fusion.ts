/**
 * Fusion Commands — turn the always-on Claude+Codex pairing on/off per agent.
 */

import "reflect-metadata";
import { configStore } from "../../config-store.js";
import {
  type FusionProvider,
  getEffectiveFusionState,
  isFusionDisabled,
  setFusionDisabled,
} from "../../fusion/state.js";
import { nats } from "../../nats.js";
import { dbGetAgent } from "../../router/router-db.js";
import { Command, Group, Option } from "../decorators.js";

function resolveAgentId(explicit?: string): string {
  return explicit?.trim() || configStore.getConfig().defaultAgent;
}

/** The configured principal (lead provider) for an agent — defaults to Claude. */
function resolvePrincipal(agentId: string): FusionProvider {
  return (dbGetAgent(agentId)?.provider ?? "").toLowerCase() === "codex" ? "codex" : "claude";
}

function announce(agentId: string): void {
  // Invalidate any cached config in the live daemon so the change takes effect.
  nats.emit("otto.config.changed", { reason: "fusion", agentId }).catch(() => {});
}

@Group({
  name: "fusion",
  description: "Toggle the always-on Claude+Codex pairing per agent",
  scope: "open",
})
export class FusionCommands {
  @Command({ name: "status", description: "Show whether fusion is on for an agent" })
  async status(
    @Option({ flags: "--agent <id>", description: "Agent id (default: default agent)" }) agent?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agentId = resolveAgentId(agent);
    const disabled = isFusionDisabled(agentId);
    const principal = resolvePrincipal(agentId);
    const state = getEffectiveFusionState(agentId, principal);
    if (asJson) {
      console.log(JSON.stringify({ agentId, fusion: disabled ? "off" : "on", principal, ...state }, null, 2));
      return;
    }
    console.log(`Fusion for agent '${agentId}': ${disabled ? "OFF" : "ON"} (principal: ${principal})`);
    if (!disabled) {
      console.log(`  editor: ${state.editor}`);
      if (state.claudeExhausted) console.log("  ⚠ claude at quota");
      if (state.codexExhausted) console.log("  ⚠ codex at quota");
    }
  }

  @Command({ name: "on", description: "Enable fusion for an agent" })
  async on(
    @Option({ flags: "--agent <id>", description: "Agent id (default: default agent)" }) agent?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agentId = resolveAgentId(agent);
    setFusionDisabled(agentId, false);
    announce(agentId);
    if (asJson) {
      console.log(JSON.stringify({ agentId, fusion: "on" }, null, 2));
      return;
    }
    console.log(`✓ Fusion ON for agent '${agentId}' (Claude + Codex).`);
  }

  @Command({ name: "off", description: "Disable fusion for an agent (Claude works solo)" })
  async off(
    @Option({ flags: "--agent <id>", description: "Agent id (default: default agent)" }) agent?: string,
    @Option({ flags: "--json", description: "Print raw JSON result" }) asJson?: boolean,
  ) {
    const agentId = resolveAgentId(agent);
    setFusionDisabled(agentId, true);
    announce(agentId);
    if (asJson) {
      console.log(JSON.stringify({ agentId, fusion: "off" }, null, 2));
      return;
    }
    console.log(`✓ Fusion OFF for agent '${agentId}' — the principal works solo.`);
  }
}
