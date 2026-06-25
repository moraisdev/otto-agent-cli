import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { requestCascadingApproval, requestPollAnswer, type ApprovalTarget } from "../approval/service.js";
import { createBashPermissionHook, createToolPermissionHook } from "../bash/index.js";
import { companionAgentId, companionSessionKey, isPeerConsultCommand } from "../fusion/companion-id.js";
import { shouldFuseSession } from "../fusion/policy.js";
import { getEffectiveFusionState, isFusionDisabled, otherProvider, type FusionProvider } from "../fusion/state.js";
import { createPreCompactHook } from "../hooks/index.js";
import { createSanitizeBashHook } from "../hooks/sanitize-bash.js";
import { nats } from "../nats.js";
import type { AgentConfig } from "../router/index.js";
import { getSpecState, isSpecModeActive } from "../spec/server.js";
import { logger } from "../utils/logger.js";
import { isGroup } from "../utils/phone.js";
import type { RuntimeHostStreamingSession } from "./host-session.js";
import type { RuntimeCapabilities, RuntimeHookMatcher } from "./types.js";

const log = logger.child("runtime:host-hooks");

/**
 * In a group chat an AskUserQuestion poll often goes unanswered (members must
 * reply-quote to respond), which otherwise blocks the turn for the full 5 min
 * default. Use a shorter timeout in groups so the agent falls back to a visible
 * answer ("Timeout") instead of staying wedged while queued messages pile up.
 * Direct messages keep the default timeout.
 */
export const GROUP_POLL_TIMEOUT_MS = 2 * 60 * 1000;

export function resolvePollTimeoutMs(chatId?: string): number | undefined {
  return chatId && isGroup(chatId) ? GROUP_POLL_TIMEOUT_MS : undefined;
}

export interface RuntimeHostHooksOptions {
  runtimeCapabilities: RuntimeCapabilities;
  agent: AgentConfig;
  sessionName: string;
  sessionCwd: string;
  resolvedSource?: ApprovalTarget;
  approvalSource?: ApprovalTarget;
  /** Per-session mutable state, used by the fusion converge gate to track the per-turn consult flag. */
  streamingSession?: RuntimeHostStreamingSession;
}

export function createRuntimeHostHooks({
  runtimeCapabilities,
  agent,
  sessionName,
  sessionCwd,
  resolvedSource,
  approvalSource,
  streamingSession,
}: RuntimeHostHooksOptions): Record<string, RuntimeHookMatcher[]> {
  if (!runtimeCapabilities.supportsHostSessionHooks) {
    return {};
  }

  const hookOpts = { getAgentId: () => agent.id };
  const hooks: Record<string, RuntimeHookMatcher[]> = {
    PreToolUse: [createToolPermissionHook(hookOpts), createBashPermissionHook(hookOpts), createSanitizeBashHook()],
    PermissionRequest: [
      {
        hooks: [
          async () => ({
            hookSpecificOutput: {
              hookEventName: "PermissionRequest" as const,
              decision: { behavior: "allow" as const },
            },
          }),
        ],
      },
    ],
  };

  const preCompactHook = createPreCompactHook({ memoryModel: agent.memoryModel });
  hooks.PreCompact = [
    {
      hooks: [
        async (input, toolUseId, context) => {
          log.info("PreCompact hook called", {
            sessionName,
            agentId: agent.id,
            inputKeys: Object.keys(input),
            hookEventName: (input as any).hook_event_name,
          });
          return preCompactHook(input as any, toolUseId ?? null, context as any);
        },
      ],
    },
  ];

  hooks.PreToolUse = [
    ...(hooks.PreToolUse ?? []),
    ...(streamingSession ? [{ hooks: [createConvergeGateHook({ sessionName, agent, streamingSession })] }] : []),
    { hooks: [createSpecBlockHook(sessionName)] },
    {
      matcher: "mcp__spec__exit_spec_mode",
      hooks: [createExitSpecHook({ sessionName, agent, resolvedSource, approvalSource })],
    },
    {
      matcher: "ExitPlanMode",
      hooks: [createExitPlanHook({ sessionName, sessionCwd, agent, resolvedSource, approvalSource })],
    },
    {
      matcher: "AskUserQuestion",
      hooks: [createAskUserQuestionHook({ sessionName, agent, resolvedSource, approvalSource })],
    },
  ];

  log.info("Hooks registered", {
    sessionName,
    hookEvents: Object.keys(hooks),
  });

  return hooks;
}

/** Edit tools the converge gate blocks until the lead has consulted the peer. NOT Bash —
 * the lead needs Bash to run the consult itself (and git/tests). */
const CONVERGE_GATE_EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "str_replace_editor",
]);
/** Fail open after this many denies so a model that refuses to consult can't wedge the turn. */
const CONVERGE_GATE_MAX_DENIES = 3;

/**
 * Fusion converge gate: in continuous pairing the lead must align the approach
 * with the peer BEFORE writing code. This PreToolUse hook blocks file-mutating
 * EDIT tools until the lead has run a blocking peer consult
 * (`otto sessions send <companion> ... -w`) this turn. It records that consult
 * (a Bash call) and never blocks Bash. Skips entirely when fusion is off, the
 * peer is exhausted, the session is sentinel, or it isn't a fused session — and
 * fails open after a few denies so it can never wedge the lead.
 */
function createConvergeGateHook(options: {
  sessionName: string;
  agent: AgentConfig;
  streamingSession: RuntimeHostStreamingSession;
}) {
  const { sessionName, agent, streamingSession } = options;
  const companionKey = companionSessionKey(companionAgentId(agent.id));
  return async (input: any) => {
    const toolName = input?.tool_name as string | undefined;
    if (!toolName) return {};

    // Record the converge consult itself and always let Bash through.
    if (toolName === "Bash") {
      const command = (input?.tool_input?.command as string) ?? "";
      if (isPeerConsultCommand(command)) streamingSession.convergeConsultedThisTurn = true;
      return {};
    }

    if (!CONVERGE_GATE_EDIT_TOOLS.has(toolName)) return {};
    if (streamingSession.convergeConsultedThisTurn) return {};
    if (streamingSession.agentMode === "sentinel") return {};
    if (!shouldFuseSession({ sessionName, agentId: agent.id })) return {};
    if (isFusionDisabled(agent.id)) return {};

    // If the peer is out of quota the lead works solo — don't block edits.
    const principal: FusionProvider = agent.provider === "codex" ? "codex" : "claude";
    const peer = otherProvider(principal);
    const fusionState = getEffectiveFusionState(agent.id, principal);
    const peerExhausted = peer === "codex" ? fusionState.codexExhausted : fusionState.claudeExhausted;
    if (peerExhausted) return {};

    if ((streamingSession.convergeDenyCount ?? 0) >= CONVERGE_GATE_MAX_DENIES) return {};
    streamingSession.convergeDenyCount = (streamingSession.convergeDenyCount ?? 0) + 1;

    const peerName = peer === "codex" ? "Codex" : "Claude";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason:
          `Pareamento Fusion: alinhe a abordagem com ${peerName} ANTES de editar. ` +
          `Rode \`otto sessions send ${companionKey} "<sua abordagem + arquivos/área a checar>" -w\`, ` +
          `convirja com ele, e então implemente. (Você só edita depois de consultar o peer neste turn.)`,
      },
    };
  };
}

function createSpecBlockHook(sessionName: string) {
  return async (input: any) => {
    if (!isSpecModeActive(sessionName)) return {};

    const toolName = input.tool_name;
    const blockedInSpec = ["Edit", "Write", "Bash", "NotebookEdit", "Skill", "Task"];

    if (typeof toolName === "string" && toolName.startsWith("mcp__spec__")) return {};

    if (blockedInSpec.includes(toolName)) {
      log.info("Spec mode blocked tool", { sessionName, toolName });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Spec mode ativo. Colete informações e complete a spec antes de implementar. Use Read, Glob, Grep, WebFetch para explorar.",
        },
      };
    }
    return {};
  };
}

function createExitPlanHook(options: {
  sessionName: string;
  sessionCwd: string;
  agent: AgentConfig;
  resolvedSource?: ApprovalTarget;
  approvalSource?: ApprovalTarget;
}) {
  return async (input: any) => {
    let planText = "";
    const toolInput = input.tool_input as Record<string, unknown> | undefined;

    try {
      const planDir = join(options.sessionCwd, ".claude", "plans");
      const files = (() => {
        try {
          return readdirSync(planDir)
            .filter((f: string) => f.endsWith(".md"))
            .map((f: string) => ({ name: f, mtime: statSync(join(planDir, f)).mtimeMs }))
            .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);
        } catch {
          return [];
        }
      })();
      if (files.length > 0) {
        planText = readFileSync(join(planDir, files[0].name), "utf-8");
      }
    } catch {
      /* fallback below */
    }

    if (!planText && toolInput) {
      if (typeof toolInput.plan === "string") {
        planText = toolInput.plan;
      } else {
        const {
          allowedPrompts: _allowedPrompts,
          pushToRemote: _pushToRemote,
          remoteSessionId: _remoteSessionId,
          remoteSessionTitle: _remoteSessionTitle,
          remoteSessionUrl: _remoteSessionUrl,
          ...rest
        } = toolInput;
        planText = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "(plano vazio)";
      }
    }
    if (!planText) planText = "(plano vazio)";

    const result = await requestCascadingApproval({
      resolvedSource: options.resolvedSource,
      approvalSource: options.approvalSource,
      type: "plan",
      sessionName: options.sessionName,
      agentId: options.agent.id,
      text: planText,
    });

    if (result.approved) return {};

    const reason = result.reason ? `Plano rejeitado: ${result.reason}` : "Plano rejeitado pelo usuário.";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}

function createAskUserQuestionHook(options: {
  sessionName: string;
  agent: AgentConfig;
  resolvedSource?: ApprovalTarget;
  approvalSource?: ApprovalTarget;
}) {
  return async (input: any) => {
    const targetSource = options.resolvedSource ?? options.approvalSource;
    if (!targetSource) {
      log.info("AskUserQuestion auto-approved (no source available)", { sessionName: options.sessionName });
      return {};
    }

    const isDelegated = !options.resolvedSource && !!options.approvalSource;
    const toolInput = input.tool_input as Record<string, unknown> | undefined;
    const questions = toolInput?.questions as
      | Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description: string }>;
          multiSelect: boolean;
        }>
      | undefined;

    if (!questions || questions.length === 0) return {};

    log.info("AskUserQuestion hook: sending polls", {
      sessionName: options.sessionName,
      questionCount: questions.length,
      isDelegated,
    });

    nats
      .emit("otto.approval.request", {
        type: "question",
        sessionName: options.sessionName,
        agentId: options.agent.id,
        delegated: isDelegated,
        channel: targetSource.channel,
        chatId: targetSource.chatId,
        questionCount: questions.length,
        timestamp: Date.now(),
      })
      .catch(() => {});

    const answers: Record<string, string> = {};
    for (const q of questions) {
      const optionLabels = q.options.map((o) => o.label);
      const hasDescriptions = q.options.some((o) => o.description);
      let pollName = isDelegated ? `[${options.agent.id}] ${q.question}` : q.question;
      if (hasDescriptions) {
        const descLines = q.options.map((o) => `• ${o.label} — ${o.description}`).join("\n");
        pollName += "\n\n" + descLines;
      }
      pollName += "\n(responda a mensagem para outro)";

      const groupTimeoutMs = resolvePollTimeoutMs(targetSource.chatId);
      const result = await requestPollAnswer(targetSource, pollName, optionLabels, {
        selectableCount: q.multiSelect ? optionLabels.length : 1,
        ...(groupTimeoutMs ? { timeoutMs: groupTimeoutMs } : {}),
      });

      answers[q.question] = "selectedLabels" in result ? result.selectedLabels.join(", ") : result.freeText;
    }

    nats
      .emit("otto.approval.response", {
        type: "question",
        sessionName: options.sessionName,
        agentId: options.agent.id,
        approved: true,
        answers,
        timestamp: Date.now(),
      })
      .catch(() => {});

    log.info("AskUserQuestion answers collected", { sessionName: options.sessionName, answers, isDelegated });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        updatedInput: { ...toolInput, answers },
      },
    };
  };
}

function createExitSpecHook(options: {
  sessionName: string;
  agent: AgentConfig;
  resolvedSource?: ApprovalTarget;
  approvalSource?: ApprovalTarget;
}) {
  return async (input: any) => {
    const spec = (input.tool_input as Record<string, unknown> | undefined)?.spec as string | undefined;
    if (!spec) return {};

    const result = await requestCascadingApproval({
      resolvedSource: options.resolvedSource,
      approvalSource: options.approvalSource,
      type: "spec",
      sessionName: options.sessionName,
      agentId: options.agent.id,
      text: spec,
    });

    if (result.approved) {
      const state = getSpecState(options.sessionName);
      if (state) state.active = false;
      return {};
    }

    const reason = result.reason ? `Spec rejeitada: ${result.reason}` : "Spec rejeitada pelo usuário.";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}
