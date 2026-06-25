/** @jsxImportSource @opentui/react */

import type { RuntimeDisplayLabel } from "../hooks/runtime-display.js";
import type { TokenUsage } from "../hooks/useNats.js";
import { THEME } from "../lib/theme.js";

export interface StatusBarProps {
  sessionName: string;
  agentId: string;
  isConnected: boolean;
  runtimeLabel: RuntimeDisplayLabel;
  isTyping: boolean;
  isCompacting: boolean;
  totalTokens: TokenUsage;
  /** Whether fusion (principal + peer) is on for this session's agent. */
  fusionEnabled?: boolean;
  /** Peer provider running alongside the principal (e.g. "codex" or "claude"). */
  companionProvider?: string | null;
  /** Peer model running alongside the principal (shown only when fusion is on). */
  companionModel?: string | null;
  /** True when the peer provider is out of quota — shown degraded ("sem cota"). */
  peerExhausted?: boolean;
  /** Connected remote channel(s) label, e.g. "remoto" | "whatsapp" | "2 canais". */
  remoteLabel?: string;
  /** Whether any remote channel is connected (drives the ● + color). */
  remoteConnected?: boolean;
  /** Number of `Task` subagents currently in flight (lead + peer combined). */
  activeSubagentsCount?: number;
  /** Click handlers for the interactive segments. */
  onModelClick?: () => void;
  onFusionClick?: () => void;
  onRemoteClick?: () => void;
  onAgentsClick?: () => void;
  /** Keyboard-focused segment: null=none, 0=model, 1=fusion, 2=remote, 3=agents. */
  focusIndex?: number | null;
}

const CODEX = THEME.codex;
const GOLD = THEME.claude;
const BG = THEME.statusBg;
// Fixed width of the left column so the two rows line up in a grid.
const LEFT_COL = 24;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Fixed-height status bar (footer).
 *
 *   Left:  session: <name> · claude/opus + codex/gpt-5.5 · fusion state · where
 *   Right: peer activity · compacting · context tokens · connection dot
 */
export function StatusBar({
  sessionName,
  agentId,
  isConnected,
  runtimeLabel,
  isTyping: _isTyping,
  isCompacting,
  totalTokens,
  fusionEnabled = true,
  companionProvider,
  companionModel,
  peerExhausted = false,
  remoteLabel = "remoto",
  remoteConnected = false,
  activeSubagentsCount = 0,
  onModelClick,
  onFusionClick,
  onRemoteClick,
  onAgentsClick,
  focusIndex = null,
}: StatusBarProps) {
  const statusDot = isConnected ? "●" : "○";
  const ctx = totalTokens.contextTokens;
  // `session: <name>` — append the agent only when it differs (avoids "main (main)").
  const sessionLabel = agentId && agentId !== sessionName ? `${sessionName} · ${agentId}` : sessionName;
  // The peer's provider colors its segment (cyan for Codex, gold for Claude).
  const peerProvider = companionProvider ?? "codex";
  const peerColor = peerProvider === "codex" ? CODEX : GOLD;
  // Focused segment gets a subtle (muted) highlight so keyboard nav is visible.
  const focusBg = (i: number) => (focusIndex === i ? THEME.dim : undefined);
  const focusFg = (i: number, normal: string) => (focusIndex === i ? "black" : normal);

  // Single left-flowing row (NOT space-between): on a narrow terminal it clips
  // cleanly at the edge instead of the two groups overlapping into garbage.
  // 2×2 grid: a fixed-width left column keeps the two rows aligned.
  //   row 1:  session: <name>       model (+ peer)               ● dot
  //   row 2:  ● fusion              remoto / ● whatsapp          ▦ ctx · peer⟳
  return (
    <box flexDirection="column" width="100%" height={2} flexShrink={0} bg={BG}>
      {/* row 1 */}
      <box flexDirection="row" width="100%" height={1} bg={BG} overflow="hidden">
        <box width={LEFT_COL} flexShrink={0} bg={BG}>
          <text content={` session: ${sessionLabel}`} fg={THEME.statusFg} bg={BG} bold />
        </box>
        <box flexDirection="row" onClick={onModelClick} bg={focusBg(0)} flexShrink={0}>
          <text content={`${runtimeLabel.provider}/${runtimeLabel.model}`} fg={focusFg(0, GOLD)} bg={focusBg(0)} />
          {fusionEnabled && companionModel && !peerExhausted ? (
            // Only the peer with quota is shown. When it's out of quota we hide
            // the segment entirely so the bar reflects what can actually run.
            <text content={` + ${peerProvider}/${companionModel}`} fg={focusFg(0, peerColor)} bg={focusBg(0)} />
          ) : null}
        </box>
        <box flexGrow={1} bg={BG} />
        <text content={`${statusDot} `} fg={isConnected ? THEME.codex : THEME.err} bg={BG} flexShrink={0} />
      </box>
      {/* row 2 */}
      <box flexDirection="row" width="100%" height={1} bg={BG} overflow="hidden">
        <box width={LEFT_COL} flexShrink={0} bg={BG}>
          <box onClick={onFusionClick} bg={focusBg(1)}>
            <text
              content={` ${fusionEnabled ? "● fusion" : "○ fusion off"}`}
              fg={focusFg(1, fusionEnabled ? THEME.working : THEME.faint)}
              bg={focusBg(1)}
            />
          </box>
        </box>
        <box onClick={onRemoteClick} bg={focusBg(2)} flexShrink={0}>
          <text
            content={`${remoteConnected ? "● " : ""}${remoteLabel}`}
            fg={focusFg(2, remoteConnected ? THEME.done : THEME.dim)}
            bg={focusBg(2)}
          />
        </box>
        {activeSubagentsCount > 0 ? (
          <box onClick={onAgentsClick} bg={focusBg(3)} flexShrink={0}>
            <text content={` · agents · ${activeSubagentsCount}`} fg={focusFg(3, THEME.working)} bg={focusBg(3)} />
          </box>
        ) : null}
        <box flexGrow={1} bg={BG} />
        {isCompacting ? <text content="compacting  " fg={THEME.working} bg={BG} flexShrink={0} /> : null}
        {ctx > 0 ? <text content={`▦ ${formatTokens(ctx)} `} fg={THEME.dim} bg={BG} flexShrink={0} /> : null}
      </box>
    </box>
  );
}
