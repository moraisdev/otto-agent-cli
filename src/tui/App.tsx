/** @jsxImportSource @opentui/react */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { ChatView } from "./components/ChatView.js";
import {
  CockpitView,
  type CockpitActionsSnapshot,
  type CockpitActivitySnapshot,
  type CockpitStatusSnapshot,
} from "./components/CockpitView.js";
import { ConnectStatusLine } from "./components/ConnectStatusLine.js";
import { InputBar } from "./components/InputBar.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { QrOverlay } from "./components/QrOverlay.js";
import { SubagentOverlay } from "./components/SubagentOverlay.js";
import { ChannelMenu } from "./components/ChannelMenu.js";
import { SessionPicker } from "./components/SessionPicker.js";
import { StatusBar } from "./components/StatusBar.js";
import { StatusMeter, type MeterState } from "./components/StatusMeter.js";
import { SLASH_COMMANDS } from "./components/SlashMenu.js";
import { useRc505Bridge } from "./hooks/useRc505Bridge.js";
import { useNats, type TimelineEntry } from "./hooks/useNats.js";
import { useSessionMetadata } from "./hooks/useSessionMetadata.js";
import { useChannels } from "./hooks/useChannels.js";
import { loadRecentSessions } from "./lib/recent-sessions.js";
import { THEME } from "./lib/theme.js";
import { resolveRuntimeDisplayLabel } from "./hooks/runtime-display.js";
import { applyAgentRuntimeSelection } from "./runtime-config.js";
import { peerModelFor } from "../fusion/companion.js";
import { type FusionProvider, isFusionDisabled, otherProvider, setFusionDisabled } from "../fusion/state.js";
import { publish, subscribe } from "../nats.js";
import { resetSession } from "../router/sessions.js";

// `otto --resume` launches the TUI with this sentinel as the session arg, which
// opens the session picker first instead of jumping straight into a session.
const INITIAL_ARG = process.argv[2] || "main";
const RESUME_MODE = INITIAL_ARG === "--resume";
const INITIAL_SESSION = RESUME_MODE ? "main" : INITIAL_ARG;
type ActiveView = "chat" | "cockpit";

function summarizeCockpitActivity(entry: TimelineEntry): string {
  if (entry.type === "tool") {
    const status = entry.isError ? "error" : entry.status;
    return truncateCockpitLine(`tool ${entry.toolName} ${status}`);
  }

  const role = entry.role === "user" ? "user" : entry.streaming ? "assistant..." : "assistant";
  return truncateCockpitLine(`${role}: ${entry.content.replace(/\s+/g, " ").trim()}`);
}

function truncateCockpitLine(value: string, max = 56): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

/** Display name for a fusion provider. */
function providerName(p: FusionProvider): string {
  return p === "codex" ? "Codex" : "Claude";
}

export function App() {
  const renderer = useRenderer();
  // The active session (switchable at runtime via the --resume picker).
  const [sessionName, setSessionName] = useState(INITIAL_SESSION);
  const [pickerOpen, setPickerOpen] = useState(RESUME_MODE);
  const recentSessions = useMemo(() => (pickerOpen ? loadRecentSessions(25) : []), [pickerOpen]);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const lastRcEventAtRef = useRef<number | null>(null);
  const rc505 = useRc505Bridge();

  // Auto-copy selected text to clipboard via OSC 52
  useEffect(() => {
    const onSelection = () => {
      const sel = renderer.getSelection();
      if (!sel) return;
      const text = sel.getSelectedText();
      if (text) {
        renderer.copyToClipboardOSC52(text);
      }
    };
    renderer.on("selection", onSelection);
    return () => {
      renderer.off("selection", onSelection);
    };
  }, [renderer]);

  const {
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
    codexWorking,
    turnStartedAt,
    liveTokens,
    activeSubagents,
    peerInsight,
  } = useNats(sessionName);

  // Cached session/agent/config metadata. Refreshed on `otto.config.changed`
  // — see `useSessionMetadata`. Previously these were synchronous SQLite
  // queries on every render and dominated CPU during streaming.
  const { session: currentSession, agent, defaultModel } = useSessionMetadata(sessionName);
  const agentId = currentSession?.agentId ?? "unknown";

  // Remote-channel flow (deterministic): list channels + a single live connect
  // status — idle → connecting → (qr | connected | error). No LLM, no stacked notes.
  const ch = useChannels();

  // Fusion on/off for this session's agent.
  const [fusionEnabled, setFusionEnabled] = useState(true);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [subagentOverlayOpen, setSubagentOverlayOpen] = useState(false);
  // Status-bar keyboard focus: null = input focused; 0=model, 1=fusion, 2=remote.
  const [statusFocus, setStatusFocus] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => {
      try {
        setFusionEnabled(!isFusionDisabled(agentId));
      } catch {
        /* db not ready */
      }
    };
    refresh();
    let stopped = false;
    (async () => {
      for await (const evt of subscribe("otto.config.changed")) {
        void evt;
        if (stopped) break;
        refresh();
      }
    })().catch(() => {});
    return () => {
      stopped = true;
    };
  }, [agentId]);

  const runtimeLabel = useMemo(
    () =>
      resolveRuntimeDisplayLabel({
        configuredProvider: agent?.provider ?? "claude",
        runtimeProvider: runtimeInfo.provider ?? currentSession?.runtimeProvider ?? null,
        configuredModel: currentSession?.modelOverride ?? agent?.model ?? defaultModel,
        executionModel: runtimeInfo.executionModel,
      }),
    [
      agent?.provider,
      agent?.model,
      runtimeInfo.provider,
      runtimeInfo.executionModel,
      currentSession?.runtimeProvider,
      currentSession?.modelOverride,
      defaultModel,
    ],
  );

  const channelParts = useMemo(
    () =>
      [
        currentSession?.lastChannel ?? currentSession?.channel,
        currentSession?.chatType,
        currentSession?.accountId,
      ].filter(Boolean) as string[],
    [currentSession?.lastChannel, currentSession?.channel, currentSession?.chatType, currentSession?.accountId],
  );

  const alerts = useMemo(() => {
    const out: string[] = [];
    if (!isConnected) out.push("session bus disconnected");
    if (currentSession?.abortedLastRun) out.push("last run aborted");
    return out;
  }, [isConnected, currentSession?.abortedLastRun]);

  const cockpitStatus = useMemo<CockpitStatusSnapshot>(
    () => ({
      daemon: isConnected ? "reachable via NATS" : "unreachable",
      runtime: `${runtimeLabel.provider}/${runtimeLabel.model}`,
      channel: channelParts.length > 0 ? channelParts.join(" / ") : undefined,
      activity: isCompacting ? "compacting" : isWorking ? "working" : isTyping ? "typing" : "idle",
      alerts,
      session: `${sessionName} (${agentId})`,
    }),
    [isConnected, runtimeLabel, channelParts, isCompacting, isWorking, isTyping, alerts, agentId],
  );

  const cockpitActions = useMemo<CockpitActionsSnapshot>(
    () => ({
      items: [
        { id: "reset", label: "Reset", trigger: "/reset", enabled: Boolean(currentSession?.sessionKey) },
        { id: "model", label: "Model", trigger: "/model", enabled: Boolean(currentSession && agent) },
      ],
    }),
    [currentSession?.sessionKey, currentSession, agent],
  );

  const cockpitActivity = useMemo<CockpitActivitySnapshot>(() => {
    const feed = messages.slice(-3).map(summarizeCockpitActivity);
    if (rc505.lastEvent) {
      feed.push(truncateCockpitLine(`rc505 ${rc505.lastEvent.kind}: ${rc505.lastEvent.summary}`));
    } else if (rc505.message) {
      feed.push(truncateCockpitLine(`rc505 bridge: ${rc505.message}`));
    }
    return { feed: feed.slice(-4) };
  }, [messages, rc505.lastEvent, rc505.message]);

  useEffect(() => {
    const lastEventAt = rc505.lastEvent?.receivedAt;
    if (!lastEventAt || lastRcEventAtRef.current === lastEventAt) {
      return;
    }
    lastRcEventAtRef.current = lastEventAt;
    setActiveView("cockpit");
  }, [rc505.lastEvent?.receivedAt]);

  useKeyboard((key) => {
    // Ctrl+C is global: it must work even when a modal/overlay has the keyboard
    // or the input is blurred (the InputBar handles it while focused). Close an
    // open overlay first; else interrupt a running turn; else confirm-exit.
    if (key.ctrl && key.name === "c") {
      if (pickerOpen) return requestExit();
      if (modelPickerOpen) return setModelPickerOpen(false);
      if (channelMenuOpen) return setChannelMenuOpen(false);
      if (ch.status === "qr") return ch.dismiss();
      if (isWorking) return handleAbort();
      return requestExit();
    }

    // The session picker owns the keyboard while open.
    if (pickerOpen) return;

    if (modelPickerOpen || channelMenuOpen || ch.status === "qr") return;

    // Status-bar navigation mode (entered via ↓ on an empty input).
    if (statusFocus !== null) {
      if (key.name === "escape" || key.name === "up") {
        setStatusFocus((f) => ((f ?? 0) <= 0 ? null : (f ?? 0) - 1));
        return;
      }
      if (key.name === "down" || key.name === "right" || key.name === "tab") {
        setStatusFocus((f) => Math.min(2, (f ?? 0) + 1));
        return;
      }
      if (key.name === "left") {
        setStatusFocus((f) => Math.max(0, (f ?? 0) - 1));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const f = statusFocus;
        setStatusFocus(null);
        if (f === 0) setModelPickerOpen(true);
        else if (f === 1) toggleFusion();
        else if (f === 2) setChannelMenuOpen(true);
        return;
      }
      return; // swallow other keys while the status bar is focused
    }

    if (key.ctrl && key.name === "o") {
      setActiveView((prev) => (prev === "chat" ? "cockpit" : "chat"));
    }
  });

  const handleAbort = useCallback(() => {
    if (!isWorking) return;
    const sk = currentSession?.sessionKey;
    if (sk) {
      publish("otto.session.abort", {
        sessionKey: sk,
        sessionName,
        source: "tui",
        action: "abort",
        reason: "tui_abort",
        actor: "operator",
      }).catch(() => {});
    }
    stopWorking();
    pushMessage({
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "chat",
      role: "assistant",
      content: "Aborted.",
      timestamp: Date.now(),
    });
  }, [currentSession, sessionName, isWorking, stopWorking, pushMessage]);

  const doExit = useCallback(() => {
    try {
      renderer.stop?.();
      renderer.destroy?.();
    } catch {
      // ignore — exiting regardless
    }
    process.exit(0);
  }, [renderer]);

  // Ctrl+C when idle+empty: first press arms + hints, a second within 3s exits.
  const exitArmedRef = useRef(0);
  const requestExit = useCallback(() => {
    const now = Date.now();
    if (exitArmedRef.current && now - exitArmedRef.current < 3000) {
      doExit();
      return;
    }
    exitArmedRef.current = now;
    pushMessage({
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "chat",
      role: "assistant",
      content: "Pressione Ctrl+C de novo para sair (ou /exit).",
      timestamp: Date.now(),
    });
  }, [doExit, pushMessage]);

  // Queue messages typed while a turn is in flight (Hermes-style): hold them as
  // "em espera" and drain one when the turn settles — never interrupt/interleave.
  const [queued, setQueued] = useState<{ id: string; text: string }[]>([]);
  const queuedRef = useRef<{ id: string; text: string }[]>([]);
  queuedRef.current = queued;

  const handleSend = useCallback(
    (text: string) => {
      if (isWorking) {
        setQueued((q) => [...q, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text }]);
        return;
      }
      sendMessage(text);
      if (activeView === "cockpit") {
        setActiveView("chat");
      }
    },
    [isWorking, sendMessage, activeView],
  );

  // Drain on the working→idle edge (deps intentionally exclude `queued` so this
  // fires once per settle, not per enqueue — otherwise the whole queue flushes
  // at once before isWorking flips back to true).
  useEffect(() => {
    if (isWorking || queuedRef.current.length === 0) return;
    const [next, ...rest] = queuedRef.current;
    setQueued(rest);
    if (next) sendMessage(next.text);
  }, [isWorking, sendMessage]);

  // Agent that fusion toggles apply to (this session's owner).
  const fusionAgentId = useMemo(
    () =>
      agentId !== "unknown"
        ? agentId
        : sessionName.startsWith("agent:")
          ? (sessionName.split(":")[1] ?? "main")
          : "main",
    [agentId],
  );

  const toggleFusion = useCallback(() => {
    const wasDisabled = isFusionDisabled(fusionAgentId);
    setFusionDisabled(fusionAgentId, !wasDisabled);
    setFusionEnabled(wasDisabled);
    publish("otto.config.changed", { reason: "fusion", agentId: fusionAgentId }).catch(() => {});
    // Symmetric: name the configured principal + its peer (not a hardcoded Claude/Codex).
    const principal: FusionProvider = runtimeLabel.provider === "codex" ? "codex" : "claude";
    const peer = otherProvider(principal);
    pushMessage({
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "chat",
      role: "assistant",
      content: wasDisabled
        ? `⚡ Fusion ON — ${providerName(principal)} + ${providerName(peer)} (${peerModelFor(peer)}).`
        : `○ Fusion OFF — ${providerName(principal)} solo.`,
      timestamp: Date.now(),
    });
  }, [fusionAgentId, pushMessage, runtimeLabel.provider]);

  // Ask the agent to mirror this session to a WhatsApp group (it has the tools).
  // Deterministic remote-channel connect — NO LLM. The daemon connects the
  // instance and the pairing QR (or "connected") flows back to the QrOverlay. We
  // just fire the request and show a one-line status.
  const connectChannel = useCallback(
    (channel: string) => {
      setChannelMenuOpen(false);
      ch.connect(channel);
    },
    [ch],
  );

  const handleSlashCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "reset": {
          const sk = currentSession?.sessionKey;
          if (sk) {
            publish("otto.session.abort", {
              sessionKey: sk,
              sessionName,
              source: "tui",
              action: "reset",
              reason: "tui_reset",
              actor: "operator",
            }).catch(() => {});
            resetSession(sk);
          }
          clearMessages();
          pushMessage({
            id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: "chat",
            role: "assistant",
            content: "Session reset.",
            timestamp: Date.now(),
          });
          break;
        }
        case "help": {
          const lines = SLASH_COMMANDS.map((c) => `  /${c.name}  — ${c.description}`).join("\n");
          pushMessage({
            id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: "chat",
            role: "assistant",
            content: `Available commands:\n${lines}`,
            timestamp: Date.now(),
          });
          break;
        }
        case "model":
          setModelPickerOpen(true);
          break;
        case "cockpit":
          setActiveView("cockpit");
          break;
        case "chat":
          setActiveView("chat");
          break;
        case "fusion":
          toggleFusion();
          break;
        case "exit":
        case "quit": {
          doExit();
          break;
        }
        case "stop": {
          handleAbort();
          break;
        }
      }
    },
    [clearMessages, pushMessage, currentSession, sessionName, toggleFusion, doExit, handleAbort],
  );

  const meterState: MeterState | null = isCompacting
    ? "compacting"
    : isWorking
      ? isTyping
        ? "thinking"
        : "working"
      : null;
  // Remote-channel segment: "remoto" when nothing is connected, else the
  // connected channel's name (or "N canais" when more than one).
  const remoteConnected = ch.connectedChannels.length > 0;
  const remoteLabel =
    ch.connectedChannels.length === 0
      ? "remoto"
      : ch.connectedChannels.length === 1
        ? (ch.connectedChannels[0] ?? "remoto")
        : `${ch.connectedChannels.length} canais`;

  // Principal (lead) provider + the peer (the other one), symmetric.
  const principalProvider: FusionProvider = runtimeLabel.provider === "codex" ? "codex" : "claude";
  const peerProvider = otherProvider(principalProvider);
  const peerModel = peerModelFor(peerProvider);
  // Principal model, plus the peer's model when fusion is on.
  const meterModels = runtimeLabel.model + (fusionEnabled ? ` + ${peerModel}` : "");

  // `otto --resume`: show the conversation picker before the chat. Picking
  // switches the live session; Esc keeps the current (main) session.
  if (pickerOpen) {
    return (
      <SessionPicker
        sessions={recentSessions}
        now={Date.now()}
        onPick={(name) => {
          setSessionName(name);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {activeView === "cockpit" ? (
        <CockpitView status={cockpitStatus} actions={cockpitActions} activity={cockpitActivity} />
      ) : (
        <ChatView
          messages={messages}
          working={isWorking}
          leadName={providerName(principalProvider)}
          peerName={providerName(peerProvider)}
        />
      )}

      {/* Live status meter (elapsed · tokens · models) */}
      <StatusMeter state={meterState} startedAt={turnStartedAt} outputTokens={liveTokens} models={meterModels} />

      {/* WhatsApp connect: live "conectando…" until qr/connected/error */}
      <ConnectStatusLine status={ch.status} channel={ch.connectingChannel} errorReason={ch.errorReason} />

      {/* Messages typed while busy — held "em espera", drained on settle */}
      {queued.length > 0 && (
        <box flexDirection="column" width="100%">
          {queued.map((q) => (
            <text
              key={q.id}
              content={` ⏳ em espera: ${q.text.length > 64 ? `${q.text.slice(0, 61)}...` : q.text}`}
              fg={THEME.dim}
            />
          ))}
        </box>
      )}

      {/* Input bar */}
      <InputBar
        onSend={handleSend}
        onSlashCommand={handleSlashCommand}
        onAbort={handleAbort}
        placeholder={activeView === "cockpit" ? "Cockpit mode. Use /chat or Ctrl+O to return." : "Type a message…"}
        isWorking={isWorking}
        active={!modelPickerOpen && !channelMenuOpen && ch.status !== "qr" && statusFocus === null}
        extraOffset={isCompacting || isWorking ? 1 : 0}
        onStatusNav={() => setStatusFocus(0)}
        onRequestExit={requestExit}
      />

      {/* Status bar (footer) */}
      <StatusBar
        sessionName={sessionName}
        agentId={agentId}
        isConnected={isConnected}
        runtimeLabel={runtimeLabel}
        isTyping={isTyping}
        isCompacting={isCompacting}
        totalTokens={totalTokens}
        codexWorking={codexWorking}
        fusionEnabled={fusionEnabled}
        companionProvider={fusionEnabled ? peerProvider : null}
        companionModel={fusionEnabled ? peerModel : null}
        remoteLabel={remoteLabel}
        remoteConnected={remoteConnected}
        activeSubagentsCount={activeSubagents.length}
        peerInsight={peerInsight}
        onModelClick={() => setModelPickerOpen(true)}
        onFusionClick={toggleFusion}
        onRemoteClick={() => setChannelMenuOpen(true)}
        onAgentsClick={() => setSubagentOverlayOpen(true)}
        focusIndex={statusFocus}
      />

      {/* small breathing room so the status grid isn't glued to the bottom */}
      <box height={1} width="100%" flexShrink={0} />

      {modelPickerOpen && currentSession && agent && (
        <>
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            backgroundColor="black"
            shouldFill
            opacity={0.5}
            zIndex={99}
          />
          <ModelPicker
            agentId={agent.id}
            currentProvider={agent.provider ?? "claude"}
            currentModel={currentSession.modelOverride ?? agent.model ?? null}
            onClose={() => setModelPickerOpen(false)}
            onApply={({ provider, model }) => {
              void (async () => {
                try {
                  await applyAgentRuntimeSelection({
                    agentId: agent.id,
                    sessionKey: currentSession.sessionKey,
                    provider,
                    model,
                  });
                  setModelPickerOpen(false);
                  pushMessage({
                    id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    type: "chat",
                    role: "assistant",
                    content: `Agent ${agent.id} now uses ${provider}/${model}. Next turn will use the new runtime settings.`,
                    timestamp: Date.now(),
                  });
                } catch (error) {
                  setModelPickerOpen(false);
                  pushMessage({
                    id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    type: "chat",
                    role: "assistant",
                    content: `Failed to update runtime: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp: Date.now(),
                  });
                }
              })();
            }}
          />
        </>
      )}

      {channelMenuOpen && (
        <>
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            backgroundColor="black"
            shouldFill
            opacity={0.5}
            zIndex={99}
          />
          <ChannelMenu channels={ch.channels} onConnect={connectChannel} onClose={() => setChannelMenuOpen(false)} />
        </>
      )}

      {ch.status === "qr" && ch.qr && (
        <>
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            backgroundColor="black"
            shouldFill
            opacity={0.5}
            zIndex={99}
          />
          <QrOverlay qr={ch.qr} onClose={ch.dismiss} />
        </>
      )}

      {subagentOverlayOpen && (
        <>
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            backgroundColor="black"
            shouldFill
            opacity={0.5}
            zIndex={99}
          />
          <SubagentOverlay subagents={activeSubagents} onClose={() => setSubagentOverlayOpen(false)} />
        </>
      )}
    </box>
  );
}
