/** @jsxImportSource @opentui/react */

import { useCallback, useState } from "react";
import type { PeerReview } from "../hooks/useNats.js";
import type { Participant, TurnNode, TurnStep } from "../lib/group-timeline.js";
import { MARKDOWN_SYNTAX_STYLE } from "../lib/markdown-style.js";
import { formatTokens } from "../lib/status-meter.js";
import { THEME } from "../lib/theme.js";
import { formatToolInput, formatToolOutput, formatToolSummary } from "../lib/tool-format.js";

const DIM = THEME.dim;

interface TurnGroupProps {
  turn: TurnNode;
  /** Live peer review-gate status — shown on the peer's status line while the turn is active. */
  peerReview?: PeerReview | null;
}

function partColor(source: string): string {
  return source === "codex" ? THEME.codex : THEME.claude;
}

/** Maps the peer review-gate state to the peer row's status line. */
function peerReviewLabel(pr: PeerReview): { text: string; color: string } {
  switch (pr.state) {
    case "reviewing":
      return { text: "revisando…", color: THEME.working };
    case "approved":
      return { text: "✓ revisado", color: THEME.done };
    case "suggested_change":
      return { text: `✦ ${pr.summary ?? "ajustes"}`, color: THEME.codex };
    default:
      return { text: "sem revisão", color: THEME.faint };
  }
}

/** Meta suffix: `· 5 tool uses · ~12k tokens`. */
function partMeta(p: Participant): string {
  const tools = `${p.toolCount} ${p.toolCount === 1 ? "tool use" : "tool uses"}`;
  const tokens = p.tokenEstimate > 0 ? ` · ~${formatTokens(p.tokenEstimate)} tokens` : "";
  return `${tools}${tokens}`;
}

/** One step line inside an expanded participant. */
function stepLine(step: TurnStep): { text: string; color: string } {
  if (step.kind === "tool") {
    const running = step.status === "running";
    const icon = running ? "⟳" : step.isError ? "✗" : "·";
    const summary = formatToolSummary(step.toolName, step.input);
    const dur = step.durationMs != null && !running ? `  ${step.durationMs}ms` : "";
    return {
      text: `      ${icon} ${step.toolName}${summary ? ` ${summary}` : ""}${dur}`,
      color: step.isError ? "red" : DIM,
    };
  }
  const first = step.content.replace(/\s+/g, " ").trim();
  const clipped = first.length > 56 ? `${first.slice(0, 53)}...` : first;
  return { text: `      · ${clipped}`, color: DIM };
}

function StepDetail({ step }: { step: TurnStep }) {
  if (step.kind === "message") {
    return (
      <box flexDirection="column" width="100%" paddingLeft={8}>
        <markdown content={step.content} conceal syntaxStyle={MARKDOWN_SYNTAX_STYLE} />
      </box>
    );
  }
  const lines = [formatToolInput(step.toolName, step.input), formatToolOutput(step.output)].filter(Boolean).join("\n");
  if (!lines) return null;
  return (
    <box flexDirection="column" width="100%" paddingLeft={8}>
      <text
        content={lines
          .split("\n")
          .map((l) => `│ ${l}`)
          .join("\n")}
        fg={step.isError ? "red" : "white"}
      />
    </box>
  );
}

/** One participant row (Claude/Codex) + its status sub-line, expandable to steps. */
function ParticipantRow({
  p,
  last,
  working,
  peerReview,
}: {
  p: Participant;
  last: boolean;
  working: boolean;
  peerReview?: PeerReview | null;
}) {
  // Collapsed by default — the header already shows live activity ("N tool uses
  // · trabalhando"); we do NOT dump every tool step (that floods the screen with
  // dozens of "shell" lines). Click to expand.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? false;
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set());
  const branch = last ? "└" : "├";
  const stem = last ? "    " : "│   ";
  // The peer's row reflects the live review gate (revisando…/✓ revisado/✦ ajustes)
  // while the turn is active; otherwise the generic working/Done status.
  const review = peerReview && p.source === "codex" && working ? peerReviewLabel(peerReview) : null;
  const status = review ? review.text : working ? "trabalhando" : "Done";
  const statusColor = review ? review.color : working ? THEME.working : THEME.done;

  const toggleStep = useCallback((id: string) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <box flexDirection="column" width="100%">
      <box width="100%" flexDirection="row" onClick={() => setOverride((v) => !(v ?? false))}>
        <text content={`  ${branch} `} fg={DIM} />
        <text content={p.name} fg={partColor(p.source)} bold />
        <text content={` · ${partMeta(p)}`} fg={DIM} />
      </box>
      <box width="100%" flexDirection="row">
        <text content={`  ${stem}└ `} fg={DIM} />
        <text content={status} fg={statusColor} />
      </box>
      {open
        ? p.steps.map((step) => {
            const line = stepLine(step);
            return (
              <box key={step.id} flexDirection="column" width="100%">
                <box width="100%" onClick={() => toggleStep(step.id)}>
                  <text content={line.text} fg={line.color} />
                </box>
                {openSteps.has(step.id) ? <StepDetail step={step} /> : null}
              </box>
            );
          })
        : null}
    </box>
  );
}

/**
 * A turn's activity as a participant tree (the "agents") — Claude + Codex, each
 * with tool-use count, a token estimate, and a status line. Mirrors a
 * multi-agent run; Claude's final answer renders inline below this group.
 */
export function TurnGroup({ turn, peerReview }: TurnGroupProps) {
  const names = turn.participants.map((p) => p.name).join(" + ");
  const status = turn.working ? "trabalhando" : "concluído";
  const dot = turn.working ? THEME.working : THEME.done;

  return (
    <box flexDirection="column" width="100%" marginTop={1}>
      <box width="100%" flexDirection="row">
        <text content="● " fg={dot} />
        <text content={`${names} · ${status}`} fg={THEME.text} bold />
      </box>
      {turn.participants.map((p, i) => (
        <ParticipantRow
          key={p.source}
          p={p}
          last={i === turn.participants.length - 1}
          working={turn.working}
          peerReview={peerReview}
        />
      ))}
    </box>
  );
}
