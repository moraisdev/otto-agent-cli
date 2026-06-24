import { getAccountForAgent, type AgentConfig } from "../router/index.js";
import { dbUpdateContextCapabilities, type ContextCapability, type ContextRecord } from "../router/router-db.js";
import type { TaskRuntimeResolution } from "../tasks/types.js";
import { buildRuntimeEnv, buildTaskRuntimeEnv } from "./host-env.js";
import type { RuntimeMessageTarget } from "./host-session.js";
import type { RuntimeLaunchPrompt } from "./message-types.js";
import {
  createRuntimeContext,
  getOrCreateAgentRuntimeContext,
  snapshotAgentCapabilities,
} from "./runtime-context-store.js";
import type { RuntimeCapabilities, RuntimeProviderId } from "./types.js";

export interface RuntimeRequestContextOptions {
  dbSessionKey: string;
  sessionName: string;
  sessionCwd: string;
  agent: AgentConfig;
  prompt: RuntimeLaunchPrompt;
  runtimeProviderId: RuntimeProviderId;
  model: string;
  runtimeResolution: TaskRuntimeResolution;
  resolvedSource?: RuntimeMessageTarget;
  approvalSource?: RuntimeMessageTarget;
}

export function buildRuntimeRequestContext(options: RuntimeRequestContextOptions) {
  const {
    dbSessionKey,
    sessionName,
    sessionCwd,
    agent,
    prompt,
    runtimeProviderId,
    model,
    runtimeResolution,
    resolvedSource,
    approvalSource,
  } = options;

  const capabilities = buildRuntimeContextCapabilities(agent.id, prompt);
  let runtimeContext = getOrCreateAgentRuntimeContext({
    agentId: agent.id,
    sessionKey: dbSessionKey,
    sessionName,
    source: resolvedSource
      ? {
          channel: resolvedSource.channel,
          accountId: resolvedSource.accountId,
          chatId: resolvedSource.chatId,
          ...(resolvedSource.threadId ? { threadId: resolvedSource.threadId } : {}),
        }
      : undefined,
    capabilities,
    metadata: {
      runtimeProvider: runtimeProviderId,
      runtimeModel: model,
      ...(runtimeResolution.options.effort ? { runtimeEffort: runtimeResolution.options.effort } : {}),
      ...(runtimeResolution.options.thinking ? { runtimeThinking: runtimeResolution.options.thinking } : {}),
      runtimeModelSource: runtimeResolution.sources.model,
      ...(approvalSource ? { approvalSource } : {}),
      ...(prompt._thread ? { ottoThread: prompt._thread } : {}),
    },
  });
  runtimeContext = refreshRuntimeContextCapabilities(runtimeContext, capabilities);

  const toolContext = {
    contextId: runtimeContext.contextId,
    context: runtimeContext,
    sessionKey: dbSessionKey,
    sessionName,
    agentId: agent.id,
    source: resolvedSource,
  };

  return {
    runtimeContext,
    toolContext,
    ottoEnv: buildOttoRuntimeEnv({
      runtimeContext,
      dbSessionKey,
      sessionName,
      sessionCwd,
      agent,
      prompt,
      resolvedSource,
    }),
  };
}

function buildRuntimeContextCapabilities(agentId: string, prompt: RuntimeLaunchPrompt): ContextCapability[] {
  return dedupeContextCapabilities([
    ...snapshotAgentCapabilities(agentId),
    ...parseObservationPermissionGrants(prompt._observation?.permissionGrants),
  ]);
}

function parseObservationPermissionGrants(values?: string[]): ContextCapability[] {
  return (values ?? []).flatMap((value) => parseObservationPermissionGrant(value));
}

function parseObservationPermissionGrant(value: string): ContextCapability[] {
  const grant = value.trim();
  if (!grant) return [];

  const direct = /^([^:\s]+):([^:\s]+):(.+)$/.exec(grant);
  if (direct) {
    return [
      {
        permission: direct[1]!,
        objectType: direct[2]!,
        objectId: direct[3]!.trim(),
        source: "observer-rule",
      },
    ];
  }

  const shortcut = /^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.*-]+)$/.exec(grant);
  if (!shortcut) return [];

  const group = normalizeCliToolNamePart(shortcut[1]!);
  const command = shortcut[2]!;
  if (command === "*") {
    return [
      { permission: "use", objectType: "tool", objectId: `${group}_*`, source: "observer-rule" },
      { permission: "execute", objectType: "group", objectId: group, source: "observer-rule" },
    ];
  }

  return [
    {
      permission: "use",
      objectType: "tool",
      objectId: `${group}_${normalizeCliToolNamePart(command)}`,
      source: "observer-rule",
    },
  ];
}

function normalizeCliToolNamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function refreshRuntimeContextCapabilities(context: ContextRecord, capabilities: ContextCapability[]): ContextRecord {
  if (contextCapabilitiesEqual(context.capabilities, capabilities)) {
    return context;
  }
  return dbUpdateContextCapabilities(context.contextId, capabilities);
}

function contextCapabilitiesEqual(left: ContextCapability[], right: ContextCapability[]): boolean {
  return JSON.stringify(sortContextCapabilities(left)) === JSON.stringify(sortContextCapabilities(right));
}

function dedupeContextCapabilities(capabilities: ContextCapability[]): ContextCapability[] {
  const seen = new Set<string>();
  const result: ContextCapability[] = [];
  for (const capability of capabilities) {
    const key = `${capability.permission}:${capability.objectType}:${capability.objectId}:${capability.source ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(capability);
  }
  return result;
}

function sortContextCapabilities(capabilities: ContextCapability[]): ContextCapability[] {
  return [...capabilities].sort((a, b) =>
    `${a.permission}:${a.objectType}:${a.objectId}:${a.source ?? ""}`.localeCompare(
      `${b.permission}:${b.objectType}:${b.objectId}:${b.source ?? ""}`,
    ),
  );
}

export function buildRuntimeRequestEnv(options: {
  ottoEnv: Record<string, string>;
  providerEnv?: Record<string, string>;
  runtimeCapabilities: RuntimeCapabilities;
}): Record<string, string> {
  const baseRuntimeEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return buildRuntimeEnv(baseRuntimeEnv, options.ottoEnv, options.providerEnv, options.runtimeCapabilities);
}

function buildOttoRuntimeEnv(options: {
  runtimeContext: ReturnType<typeof createRuntimeContext>;
  dbSessionKey: string;
  sessionName: string;
  sessionCwd: string;
  agent: AgentConfig;
  prompt: RuntimeLaunchPrompt;
  resolvedSource?: RuntimeMessageTarget;
}): Record<string, string> {
  const { runtimeContext, dbSessionKey, sessionName, sessionCwd, agent, prompt, resolvedSource } = options;
  const ottoEnv: Record<string, string> = {
    OTTO_CONTEXT_KEY: runtimeContext.contextKey,
    OTTO_SESSION_KEY: dbSessionKey,
    OTTO_SESSION_NAME: sessionName,
    OTTO_AGENT_ID: agent.id,
  };

  if (resolvedSource) {
    ottoEnv.OTTO_CHANNEL = resolvedSource.channel;
    ottoEnv.OTTO_ACCOUNT_ID = resolvedSource.accountId;
    ottoEnv.OTTO_CHAT_ID = resolvedSource.chatId;
    if (resolvedSource.instanceId) ottoEnv.OTTO_INSTANCE_ID = resolvedSource.instanceId;
  } else if (prompt.context?.accountId) {
    ottoEnv.OTTO_ACCOUNT_ID = prompt.context.accountId;
    if (prompt.context.channelId) ottoEnv.OTTO_CHANNEL = prompt.context.channelId;
    if (prompt.context.instanceId) ottoEnv.OTTO_INSTANCE_ID = prompt.context.instanceId;
    if (prompt.context.chatId) ottoEnv.OTTO_CHAT_ID = prompt.context.chatId;
  } else if (agent.mode === "sentinel") {
    const accountId = getAccountForAgent(agent.id);
    if (accountId) ottoEnv.OTTO_ACCOUNT_ID = accountId;
  }

  const actorMetadata = resolvedSource ?? prompt.context;
  if (actorMetadata) {
    if (actorMetadata.canonicalChatId) ottoEnv.OTTO_CANONICAL_CHAT_ID = actorMetadata.canonicalChatId;
    if (actorMetadata.actorType) ottoEnv.OTTO_ACTOR_TYPE = actorMetadata.actorType;
    if (actorMetadata.contactId) ottoEnv.OTTO_CONTACT_ID = actorMetadata.contactId;
    if (actorMetadata.actorAgentId) ottoEnv.OTTO_ACTOR_AGENT_ID = actorMetadata.actorAgentId;
    if (actorMetadata.platformIdentityId) ottoEnv.OTTO_PLATFORM_IDENTITY_ID = actorMetadata.platformIdentityId;
    if (actorMetadata.rawSenderId) ottoEnv.OTTO_RAW_SENDER_ID = actorMetadata.rawSenderId;
    if (actorMetadata.normalizedSenderId) ottoEnv.OTTO_NORMALIZED_SENDER_ID = actorMetadata.normalizedSenderId;
  }

  if (prompt.context) {
    ottoEnv.OTTO_SENDER_ID = prompt.context.senderId;
    if (prompt.context.senderName) ottoEnv.OTTO_SENDER_NAME = prompt.context.senderName;
    if (prompt.context.senderPhone) ottoEnv.OTTO_SENDER_PHONE = prompt.context.senderPhone;
    if (prompt.context.isGroup) {
      if (prompt.context.groupId) ottoEnv.OTTO_GROUP_ID = prompt.context.groupId;
      if (prompt.context.groupName) ottoEnv.OTTO_GROUP_NAME = prompt.context.groupName;
    }
  }

  if (prompt._thread) {
    ottoEnv.OTTO_THREAD_ID = prompt._thread.id;
    ottoEnv.OTTO_THREAD_HANDOFF_ID = prompt._thread.handoffId;
    if (prompt._thread.slug) ottoEnv.OTTO_THREAD_SLUG = prompt._thread.slug;
  }

  Object.assign(ottoEnv, buildTaskRuntimeEnv(sessionName, sessionCwd, prompt.taskBarrierTaskId));
  return ottoEnv;
}
