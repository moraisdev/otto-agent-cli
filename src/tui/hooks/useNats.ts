import { useState, useEffect, useCallback, useRef } from "react";
import { subscribe } from "../../nats.js";
import { getRecentHistory } from "../../db.js";
import { configStore } from "../../config-store.js";
import { ensureFusionForTurn, leadAgentIdForSession } from "../../fusion/activate.js";
import { companionAgentId, companionSessionKey } from "../../fusion/companion-id.js";
import { publishSessionPrompt } from "../../omni/session-stream.js";
import { createThrottledFlush, type ThrottledFlush } from "../lib/throttle.js";
import { applyTerminalUsage, isTerminalRuntimeEvent, type RuntimeFeedUsage } from "./runtime-feed.js";

/** Which model produced a timeline entry: the Claude lead or the Codex peer. */
export type EntrySource = "lead" | "codex";

export interface ChatMessage {
  id: string;
  type: "chat";
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: number;
  /** Defaults to the lead (Claude); "codex" marks the read-only GPT-5.5 peer. */
  source?: EntrySource;
}

export interface ToolMessage {
  id: string;
  type: "tool";
  toolId: string;
  toolName: string;
  status: "running" | "done";
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
  timestamp: number;
  source?: EntrySource;
}

export type TimelineEntry = ChatMessage | ToolMessage;

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  /** input_tokens from the last turn (= current context size) */
  contextTokens: number;
}

/**
 * A Task-tool spawn currently in flight. The TUI tracks these so the operator
 * can see how many subagents are running and what they're doing without having
 * to scroll the timeline. Cleared as soon as the matching tool `end` event lands.
 */
export interface SubagentInfo {
  toolId: string;
  /** Which side spawned it — colors the entry in the overlay. */
  source: EntrySource;
  /** The agent type passed to the Task tool (e.g. "general-purpose", "Explore"). */
  subagentType: string;
  /** Short human-readable description from the Task call. */
  description: string;
  /** When the spawn started, for the live duration counter. */
  startedAt: number;
}

export interface RuntimeDisplayInfo {
  provider: "claude" | "codex" | null;
  executionModel: string | null;
}

export interface UseNatsResult {
  messages: TimelineEntry[];
  sendMessage: (text: string, displayText?: string) => void;
  clearMessages: () => void;
  pushMessage: (entry: TimelineEntry) => void;
  isConnected: boolean;
  isTyping: boolean;
  isCompacting: boolean;
  isWorking: boolean;
  stopWorking: () => void;
  totalTokens: TokenUsage;
  runtimeInfo: RuntimeDisplayInfo;
  /** Epoch ms when the current turn started; null when idle (for the footer clock). */
  turnStartedAt: number | null;
  /** Live output-token estimate for the current turn (footer meter readout). */
  liveTokens: number;
  /**
   * Currently in-flight `Task` subagent spawns for this session (lead + peer).
   * Drives the StatusBar agents segment and the subagent overlay.
   */
  activeSubagents: SubagentInfo[];
  /**
   * Live peer review-gate status, driven by `peer.status` runtime events from the
   * synchronous fusion gate: the peer reviewing the lead's diff, its verdict, or
   * that it was unavailable (out of quota). Null when idle.
   */
  peerReview: PeerReview | null;
}

/** Live status of the fusion peer for the current turn. `evaluating` = converge
 * consult (peer weighing the approach); `reviewing` = end-of-turn diff review. */
export interface PeerReview {
  state: "evaluating" | "reviewing" | "approved" | "suggested_change" | "unavailable";
  provider?: string;
  summary?: string;
}

const MAX_MESSAGES = 500;
const STREAMING_ID = "streaming-assistant";
const CODEX_STREAMING_ID = "streaming-codex";

/**
 * React hook that manages NATS connection and message state for a session.
 *
 * Subscribes to:
 *  - otto.session.{name}.prompt   (user messages)
 *  - otto.session.{name}.response (complete assistant messages)
 *  - otto.session.{name}.stream   (text delta chunks for live streaming)
 *  - otto.session.{name}.tool     (tool start/end events)
 *  - otto.session.{name}.runtime  (provider events: typing, compacting)
 *  - otto.session.{name}.claude   (legacy Claude compatibility events)
 *
 * Streaming: `.stream` chunks are accumulated into a single in-progress
 * message. A final `.response` event replaces it with the complete text.
 */
export function useNats(sessionName: string): UseNatsResult {
  const [messages, setMessages] = useState<TimelineEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [totalTokens, setTotalTokens] = useState<TokenUsage>({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    contextTokens: 0,
  });
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeDisplayInfo>({
    provider: null,
    executionModel: null,
  });
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [activeSubagents, setActiveSubagents] = useState<SubagentInfo[]>([]);
  const [peerReview, setPeerReview] = useState<PeerReview | null>(null);
  const peerReviewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Live output-token estimate for the footer meter (chars/4), so it ticks up
  // during the turn instead of freezing on the previous turn's terminal total.
  const [liveTokens, setLiveTokens] = useState(0);
  const abortRef = useRef(false);
  // Accumulate streaming text in a ref to avoid stale closures
  const streamBuf = useRef("");
  const streamDone = useRef(false);
  const terminalUsageCounted = useRef(false);
  // Trailing-edge throttle for stream chunk -> setMessages flush.
  // Without this, every text.delta from NATS triggers a full React re-render.
  const streamFlush = useRef<ThrottledFlush | null>(null);
  // Independent streaming state for the Codex peer (kept separate from the lead
  // so the two never clobber each other's in-flight buffers).
  const codexStreamBuf = useRef("");
  const codexStreamFlush = useRef<ThrottledFlush | null>(null);
  // Cumulative output chars for THIS turn (lead + codex), for the live token
  // estimate. Accumulated as chunks arrive and reset only at turn boundaries —
  // NOT on tool-start (the per-segment buffers clear there, which would sawtooth).
  const turnOutChars = useRef(0);

  useEffect(() => {
    abortRef.current = false;
    streamBuf.current = "";
    streamDone.current = false;
    terminalUsageCounted.current = false;
    setIsConnected(false);
    setIsTyping(false);
    setIsCompacting(false);
    setIsWorking(false);
    setTotalTokens({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, contextTokens: 0 });
    setRuntimeInfo({ provider: null, executionModel: null });
    setTurnStartedAt(null);
    setLiveTokens(0);
    setActiveSubagents([]);
    setPeerReview(null);
    turnOutChars.current = 0;
    codexStreamBuf.current = "";

    // Load recent chat history from SQLite
    try {
      const history = getRecentHistory(sessionName, 50);
      const restored: TimelineEntry[] = history
        .filter((msg) => msg.content.trim().length > 0) // skip hidden/UI-action prompts
        .map((msg, i) => ({
          id: `history-${msg.id}-${i}`,
          type: "chat" as const,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
        }));
      setMessages(restored);
    } catch {
      setMessages([]);
    }

    const promptTopic = `otto.session.${sessionName}.prompt`;
    const responseTopic = `otto.session.${sessionName}.response`;
    const streamTopic = `otto.session.${sessionName}.stream`;
    const toolTopic = `otto.session.${sessionName}.tool`;
    const runtimeTopic = `otto.session.${sessionName}.runtime`;
    const claudeTopic = `otto.session.${sessionName}.claude`;

    // Also watch the peer companion's session so its work is visible live. (The
    // peer's provider is whichever one is NOT the principal; events are tagged
    // source:"codex" purely as the internal "peer" channel marker.)
    const leadAgentId = leadAgentIdForSession(sessionName, configStore.getConfig().defaultAgent);
    const codexSession = companionSessionKey(companionAgentId(leadAgentId));
    const watchCodex = codexSession !== sessionName; // don't watch ourselves
    const codexStreamTopic = `otto.session.${codexSession}.stream`;
    const codexResponseTopic = `otto.session.${codexSession}.response`;
    const codexToolTopic = `otto.session.${codexSession}.tool`;
    const codexRuntimeTopic = `otto.session.${codexSession}.runtime`;

    const pushCodex = (entry: TimelineEntry) =>
      setMessages((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });

    // Handle the Codex peer's events on its own session — kept fully separate
    // from the lead's streaming state, tagged source:"codex" for the UI.
    const handleCodexEvent = (topic: string, data: unknown) => {
      if (topic === codexStreamTopic) {
        const chunk = (data as { chunk?: string }).chunk;
        if (!chunk) return;
        codexStreamBuf.current += chunk;
        turnOutChars.current += chunk.length;
        if (codexStreamFlush.current === null) {
          codexStreamFlush.current = createThrottledFlush(() => {
            const text = codexStreamBuf.current;
            if (!text) return;
            setLiveTokens(Math.round(turnOutChars.current / 4));
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === CODEX_STREAMING_ID);
              const entry: ChatMessage = {
                id: CODEX_STREAMING_ID,
                type: "chat",
                role: "assistant",
                content: text,
                streaming: true,
                timestamp: Date.now(),
                source: "codex",
              };
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = entry;
                return next;
              }
              const next = [...prev, entry];
              return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
            });
          }, 50);
        }
        codexStreamFlush.current.schedule();
      } else if (topic === codexResponseTopic) {
        const response = (data as { response?: string }).response;
        codexStreamFlush.current?.cancel();
        codexStreamBuf.current = "";
        if (!response) {
          setMessages((prev) => prev.filter((m) => m.id !== CODEX_STREAMING_ID));
          return;
        }
        const finalMsg: ChatMessage = {
          id: `codex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: "chat",
          role: "assistant",
          content: response,
          timestamp: Date.now(),
          source: "codex",
        };
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== CODEX_STREAMING_ID);
          const next = [...filtered, finalMsg];
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        });
      } else if (topic === codexToolTopic) {
        const t = data as {
          event?: string;
          toolId?: string;
          toolName?: string;
          input?: unknown;
          output?: unknown;
          isError?: boolean;
          durationMs?: number;
        };
        if (t.event === "start" && t.toolId) {
          if (t.toolName === "Task") {
            const taskInput = (t.input ?? {}) as Record<string, unknown>;
            const entry: SubagentInfo = {
              toolId: t.toolId,
              source: "codex",
              subagentType: String(taskInput.subagent_type ?? "agent"),
              description: String(taskInput.description ?? ""),
              startedAt: Date.now(),
            };
            setActiveSubagents((prev) => [...prev.filter((s) => s.toolId !== entry.toolId), entry]);
          }
          pushCodex({
            id: `codex-tool-${t.toolId}`,
            type: "tool",
            toolId: t.toolId,
            toolName: t.toolName ?? "unknown",
            status: "running",
            input: t.input,
            timestamp: Date.now(),
            source: "codex",
          });
        } else if (t.event === "end" && t.toolId) {
          setActiveSubagents((prev) => prev.filter((s) => s.toolId !== t.toolId));
          setMessages((prev) =>
            prev.map((m) =>
              m.type === "tool" && m.toolId === t.toolId && m.source === "codex"
                ? { ...m, status: "done" as const, output: t.output, isError: t.isError, durationMs: t.durationMs }
                : m,
            ),
          );
        }
      } else if (topic === codexRuntimeTopic) {
        const r = data as { type?: string };
        if (isTerminalRuntimeEvent(r.type)) {
          codexStreamFlush.current?.cancel();
          codexStreamBuf.current = "";
          setMessages((prev) => prev.filter((m) => m.id !== CODEX_STREAMING_ID));
        }
      }
    };

    const run = async () => {
      try {
        setIsConnected(true);

        const topics = [promptTopic, responseTopic, streamTopic, toolTopic, runtimeTopic, claudeTopic];
        if (watchCodex) {
          topics.push(codexStreamTopic, codexResponseTopic, codexToolTopic, codexRuntimeTopic);
        }

        for await (const event of subscribe(...topics)) {
          if (abortRef.current) break;

          const { topic, data } = event;

          if (topic === promptTopic) {
            const promptData = data as { prompt?: string; _displayText?: string };
            // Show the clean user text, never the internal fusion playbook prefix.
            const prompt = promptData._displayText ?? promptData.prompt;
            if (!prompt) continue;
            // New turn — allow streaming again
            streamDone.current = false;
            streamBuf.current = "";
            terminalUsageCounted.current = false;
            setIsWorking(true);
            setTurnStartedAt(Date.now());
            setLiveTokens(0);
            turnOutChars.current = 0;
            // Drop any peer review state from the previous turn so a fresh turn
            // never shows a stale verdict.
            if (peerReviewTimer.current) clearTimeout(peerReviewTimer.current);
            setPeerReview(null);
            // Cancel BOTH in-flight stream flushes and drop any lingering
            // streaming placeholders from a prior turn that never finalized —
            // otherwise the new turn's deltas write into the old bubble (the
            // "new message lands in the middle of the previous one" bug).
            streamFlush.current?.cancel();
            codexStreamFlush.current?.cancel();
            codexStreamBuf.current = "";
            const msg: ChatMessage = {
              id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: "chat",
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            };
            setMessages((prev) => {
              const cleaned = prev.filter((m) => m.id !== STREAMING_ID && m.id !== CODEX_STREAMING_ID);
              const next = [...cleaned, msg];
              return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
            });
          } else if (topic === streamTopic) {
            // Streaming text delta chunk — ignore stale chunks after response
            if (streamDone.current) continue;
            const chunk = (data as { chunk?: string }).chunk;
            if (!chunk) continue;
            streamBuf.current += chunk;
            turnOutChars.current += chunk.length;
            if (streamFlush.current === null) {
              streamFlush.current = createThrottledFlush(() => {
                const text = streamBuf.current;
                if (!text) return;
                setIsTyping(true);
                setLiveTokens(Math.round(turnOutChars.current / 4));
                setMessages((prev) => {
                  const existing = prev.findIndex((m) => m.id === STREAMING_ID);
                  const entry: ChatMessage = {
                    id: STREAMING_ID,
                    type: "chat",
                    role: "assistant",
                    content: text,
                    streaming: true,
                    timestamp: Date.now(),
                  };
                  if (existing >= 0) {
                    const next = [...prev];
                    next[existing] = entry;
                    return next;
                  }
                  const next = [...prev, entry];
                  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
                });
              }, 50);
            }
            streamFlush.current.schedule();
          } else if (topic === responseTopic) {
            const responseData = data as { response?: string };
            const response = responseData.response;
            if (!response) continue;

            // The daemon emits one `.response` per assistant content BLOCK (a
            // tool-using turn has many). Commit this block as an immutable bubble
            // and clear the live placeholder — but DO NOT end the turn. Turn-end
            // is driven solely by the terminal runtime event below. (Treating
            // every block as turn-end is what caused the flicker.)
            streamFlush.current?.cancel();
            streamBuf.current = "";
            const finalMsg: ChatMessage = {
              id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: "chat",
              role: "assistant",
              content: response,
              timestamp: Date.now(),
            };
            setIsTyping(false);
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== STREAMING_ID);
              const next = [...filtered, finalMsg];
              return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
            });
          } else if (topic === toolTopic) {
            const toolData = data as {
              event?: string;
              toolId?: string;
              toolName?: string;
              input?: unknown;
              output?: unknown;
              isError?: boolean;
              durationMs?: number;
            };

            if (toolData.event === "start" && toolData.toolId) {
              // Tool starting — clear any streaming message and buffer.
              // Also drop "thinking" state so the meter reads "working" during tools.
              setIsTyping(false);
              // Lead activity ⇒ the turn is in flight — covers fusion revision
              // rounds, which continue in-process without a fresh `.prompt`.
              setIsWorking(true);
              streamBuf.current = "";
              if (toolData.toolName === "Task") {
                const taskInput = (toolData.input ?? {}) as Record<string, unknown>;
                const startedAt = Date.now();
                const entry: SubagentInfo = {
                  toolId: toolData.toolId,
                  source: "lead",
                  subagentType: String(taskInput.subagent_type ?? "agent"),
                  description: String(taskInput.description ?? ""),
                  startedAt,
                };
                setActiveSubagents((prev) => [...prev.filter((s) => s.toolId !== entry.toolId), entry]);
              }
              const entry: ToolMessage = {
                id: `tool-${toolData.toolId}`,
                type: "tool",
                toolId: toolData.toolId,
                toolName: toolData.toolName ?? "unknown",
                status: "running",
                input: toolData.input,
                timestamp: Date.now(),
              };
              setMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== STREAMING_ID);
                const next = [...filtered, entry];
                return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
              });
            } else if (toolData.event === "end" && toolData.toolId) {
              setActiveSubagents((prev) => prev.filter((s) => s.toolId !== toolData.toolId));
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.type === "tool" && m.toolId === toolData.toolId) {
                    return {
                      ...m,
                      status: "done" as const,
                      output: toolData.output,
                      isError: toolData.isError,
                      durationMs: toolData.durationMs,
                    };
                  }
                  return m;
                }),
              );
            }
          } else if (topic === runtimeTopic || topic === claudeTopic) {
            const runtimeData = data as {
              type?: string;
              subtype?: string;
              status?: string;
              usage?: RuntimeFeedUsage;
              provider?: string;
              state?: string;
              summary?: string;
              peerProvider?: string;
              execution?: {
                provider?: string | null;
                model?: string | null;
              };
            };

            const runtimeProvider = normalizeRuntimeProvider(runtimeData.provider);
            if (runtimeProvider) {
              setRuntimeInfo((prev) => ({
                ...prev,
                provider: runtimeProvider,
              }));
            }

            if (runtimeData.type === "assistant" || runtimeData.type === "assistant.message") {
              streamDone.current = false;
              setIsTyping(true);
              setIsWorking(true);
            } else if (runtimeData.type === "peer.status") {
              // Live fusion peer status. Active phases ("evaluating"/"reviewing")
              // persist until cleared by their own end signal; verdicts auto-clear
              // after a few seconds; "idle" clears immediately.
              if (peerReviewTimer.current) clearTimeout(peerReviewTimer.current);
              const state = runtimeData.state as PeerReview["state"] | "idle" | undefined;
              if (!state || state === "idle") {
                setPeerReview(null);
              } else {
                setPeerReview({ state, provider: runtimeData.peerProvider, summary: runtimeData.summary });
                const active = state === "reviewing" || state === "evaluating";
                peerReviewTimer.current = setTimeout(() => setPeerReview(null), active ? 6 * 60 * 1000 : 8000);
              }
            } else if (isTerminalRuntimeEvent(runtimeData.type)) {
              // The real turn end. Commit any uncommitted streamed tail (a last
              // block that arrived only via deltas, no `.response`) so it is never
              // dropped, then clear the live state.
              streamFlush.current?.cancel();
              const tail = streamBuf.current;
              streamBuf.current = "";
              streamDone.current = true;
              setIsTyping(false);
              setIsCompacting(false);
              setIsWorking(false);
              setTurnStartedAt(null);
              // Retire any lingering peer phase (e.g. a lost "avaliando…" idle) at
              // the real turn end; the review gate re-emits "reviewing" right after
              // if it runs.
              if (peerReviewTimer.current) clearTimeout(peerReviewTimer.current);
              setPeerReview(null);
              setMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== STREAMING_ID);
                if (!tail.trim()) return filtered;
                const committed: ChatMessage = {
                  id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  type: "chat",
                  role: "assistant",
                  content: tail,
                  timestamp: Date.now(),
                };
                const next = [...filtered, committed];
                return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
              });
              setRuntimeInfo((prev) => ({
                provider: runtimeProvider ?? prev.provider,
                executionModel: normalizeExecutionModel(runtimeData.execution?.model),
              }));
              setTotalTokens((prev) => {
                const next = applyTerminalUsage(prev, runtimeData.usage, terminalUsageCounted.current);
                terminalUsageCounted.current = next.counted;
                return next.total;
              });
            } else if (
              (runtimeData.type === "system" && runtimeData.subtype === "status") ||
              runtimeData.type === "status"
            ) {
              if (runtimeData.status === "compacting") {
                setIsCompacting(true);
              } else if (runtimeData.status === "idle") {
                setIsCompacting(false);
              }
            }
          } else if (
            watchCodex &&
            (topic === codexStreamTopic ||
              topic === codexResponseTopic ||
              topic === codexToolTopic ||
              topic === codexRuntimeTopic)
          ) {
            handleCodexEvent(topic, data);
          }
        }
      } catch {
        // subscription ended or failed
      } finally {
        if (!abortRef.current) {
          setIsConnected(false);
        }
      }
    };

    run();

    return () => {
      abortRef.current = true;
      streamFlush.current?.cancel();
      streamFlush.current = null;
      codexStreamFlush.current?.cancel();
      codexStreamFlush.current = null;
      if (peerReviewTimer.current) {
        clearTimeout(peerReviewTimer.current);
        peerReviewTimer.current = undefined;
      }
      setIsConnected(false);
    };
  }, [sessionName]);

  const sendMessage = useCallback(
    // `displayText` overrides what shows in the chat (pass "" to show nothing —
    // e.g. UI-triggered actions where only the working state should appear).
    (text: string, displayText?: string) => {
      // Always-on fusion: pair Claude (editor) with the Codex peer for every TUI
      // turn too, with failover, identical to WhatsApp and `otto code`.
      void (async () => {
        const config = configStore.getConfig();
        const agentId = leadAgentIdForSession(sessionName, config.defaultAgent);
        const agent = config.agents[agentId];
        const fusion = await ensureFusionForTurn({
          leadAgent: { id: agentId, cwd: agent?.cwd ?? process.cwd(), provider: agent?.provider },
          leadSessionName: sessionName,
        });
        const promptText = fusion.playbookPrefix ? `${fusion.playbookPrefix}\n\n${text}` : text;
        await publishSessionPrompt(sessionName, {
          prompt: promptText,
          _displayText: displayText ?? text,
          source: { channel: "tui", accountId: "", chatId: "" },
          ...(fusion.runtimeProviderId
            ? {
                _runtimeProviderId: fusion.runtimeProviderId,
                _fusion: { editor: fusion.editor ?? fusion.runtimeProviderId },
                ...(fusion.runtimeModel ? { _runtimeModel: fusion.runtimeModel } : {}),
              }
            : {}),
        });
      })().catch(() => {
        // publish failed silently
      });
    },
    [sessionName],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const pushMessage = useCallback((entry: TimelineEntry) => {
    setMessages((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
    });
  }, []);

  const stopWorking = useCallback(() => {
    streamFlush.current?.cancel();
    streamBuf.current = "";
    streamDone.current = true;
    setIsWorking(false);
    setIsTyping(false);
    setTurnStartedAt(null);
    if (peerReviewTimer.current) {
      clearTimeout(peerReviewTimer.current);
      peerReviewTimer.current = undefined;
    }
    setPeerReview(null);
    // Remove in-progress streaming message
    setMessages((prev) => prev.filter((m) => m.id !== STREAMING_ID));
  }, []);

  return {
    messages,
    sendMessage,
    clearMessages,
    pushMessage,
    isConnected,
    isTyping,
    isCompacting,
    isWorking,
    stopWorking,
    totalTokens,
    runtimeInfo,
    turnStartedAt,
    liveTokens,
    activeSubagents,
    peerReview,
  };
}

function normalizeRuntimeProvider(value?: string): "claude" | "codex" | null {
  return value === "claude" || value === "codex" ? value : null;
}

function normalizeExecutionModel(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
