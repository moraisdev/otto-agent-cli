/** @jsxImportSource @opentui/react */

import { useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { SubagentInfo } from "../hooks/useNats.js";
import { THEME } from "../lib/theme.js";

interface SubagentOverlayProps {
  subagents: SubagentInfo[];
  onClose: () => void;
}

/**
 * Centered overlay that lists every in-flight `Task` subagent spawned by the
 * lead or the peer companion in the current session. Each row colors the source
 * (gold = Claude lead, cyan = Codex peer) and shows a live duration counter.
 *
 * Mirrors `QrOverlay`'s shell so the two stay visually consistent.
 */
export function SubagentOverlay({ subagents, onClose }: SubagentOverlayProps) {
  const renderer = useRenderer();
  // Ticking clock for the live duration column — re-renders once per second so
  // each row stays accurate without rebuilding the whole hook on every NATS
  // event.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || key.name === "enter") onClose();
  });

  const width = Math.min(80, Math.max(50, Math.floor(renderer.width * 0.7)));
  // Headroom: title + spacer + N rows + spacer + footer + padding/border.
  const rows = Math.max(1, subagents.length);
  const height = Math.min(renderer.height - 2, rows + 8);
  const left = Math.max(0, Math.floor((renderer.width - width) / 2));
  const top = Math.max(0, Math.floor((renderer.height - height) / 2));

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      flexDirection="column"
      border
      borderColor={THEME.dim}
      backgroundColor="black"
      shouldFill
      padding={1}
      zIndex={100}
    >
      <text content={`Subagents (${subagents.length})`} fg={THEME.text} bg="black" bold />
      <text content="Tarefas Task em execução nesta sessão" fg={THEME.faint} bg="black" />
      <box height={1} />
      {subagents.length === 0 ? (
        <text content="(nenhum subagent rodando)" fg={THEME.faint} bg="black" />
      ) : (
        subagents.map((s) => {
          const elapsedSec = Math.max(0, Math.floor((now - s.startedAt) / 1000));
          // source "codex" is the internal "peer" channel marker — the peer's
          // provider depends on who leads, so label it provider-neutrally as "peer"
          // (the lead side is the principal, labeled "lead").
          const sourceColor = s.source === "codex" ? THEME.codex : THEME.claude;
          const sourceLabel = s.source === "codex" ? "peer" : "lead";
          const desc = s.description.length > 40 ? `${s.description.slice(0, 39)}…` : s.description;
          return (
            <box key={s.toolId} flexDirection="row" bg="black">
              <text content={`${sourceLabel} `} fg={sourceColor} bg="black" />
              <text content={`${s.subagentType} `} fg={THEME.text} bg="black" />
              <text content={desc ? `· ${desc} ` : ""} fg={THEME.faint} bg="black" />
              <box flexGrow={1} bg="black" />
              <text content={`${elapsedSec}s`} fg={THEME.dim} bg="black" />
            </box>
          );
        })
      )}
      <box height={1} />
      <text content="Esc / Enter fecha" fg={THEME.faint} bg="black" />
    </box>
  );
}
