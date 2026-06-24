/** @jsxImportSource @opentui/react */

import { useMemo, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { formatRelativeTime, type RecentSession } from "../lib/recent-sessions.js";
import { THEME } from "../lib/theme.js";

interface SessionPickerProps {
  sessions: RecentSession[];
  now: number;
  onPick: (sessionName: string) => void;
  onCancel: () => void;
}

/**
 * `otto --resume` picker: a full-screen list of recent conversations. ↑/↓ to
 * move, type to filter, Enter to open, Esc to cancel.
 */
export function SessionPicker({ sessions, now, onPick, onCancel }: SessionPickerProps) {
  const renderer = useRenderer();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.label.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q));
  }, [sessions, query]);
  const clamped = Math.min(index, Math.max(0, filtered.length - 1));

  useKeyboard((key) => {
    if (key.name === "escape") return onCancel();
    if (key.name === "up" || (key.ctrl && key.name === "p")) return setIndex((i) => Math.max(0, i - 1));
    if (key.name === "down" || (key.ctrl && key.name === "n"))
      return setIndex((i) => Math.min(filtered.length - 1, i + 1));
    if (key.name === "return" || key.name === "enter") {
      const s = filtered[clamped];
      if (s) onPick(s.sessionName);
      return;
    }
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      return;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.sequence);
      setIndex(0);
    }
  });

  const width = renderer.width;
  // Window the list so the selection stays visible on short terminals.
  const visible = Math.max(3, renderer.height - 5);
  const start = clamped < visible ? 0 : Math.min(clamped - visible + 1, Math.max(0, filtered.length - visible));
  const windowed = filtered.slice(start, start + visible);

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} overflow="hidden">
      <text content="Retomar conversa" fg={THEME.claude} bold />
      <text
        content={query ? ` filtro: ${query}` : " ↑/↓ navega · digite p/ filtrar · Enter abre · Esc cancela"}
        fg={THEME.dim}
      />
      <box height={1} />
      {filtered.length === 0 ? (
        <text content=" nenhuma conversa encontrada" fg={THEME.dim} />
      ) : (
        windowed.map((s, i) => {
          const sel = i + start === clamped;
          const time = formatRelativeTime(s.updatedAt, now).padStart(3);
          const base = `${sel ? "❯" : " "} ${time}  ${s.label}`;
          const line = s.preview ? `${base}   ${s.preview}` : base;
          const content = line.length > width - 2 ? `${line.slice(0, width - 3)}…` : line;
          return (
            <box key={s.sessionName} height={1} flexShrink={0}>
              <text content={content} fg={sel ? THEME.text : THEME.dim} bold={sel} bg={sel ? THEME.faint : undefined} />
            </box>
          );
        })
      )}
    </box>
  );
}
