/** @jsxImportSource @opentui/react */

import { useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { ChannelInfo } from "../hooks/useChannels.js";
import { THEME } from "../lib/theme.js";

export interface ChannelMenuProps {
  /** Channels the daemon manages, with live connection status. */
  channels: ChannelInfo[];
  /** Connect a remote channel (resolves the existing instance by channel). */
  onConnect: (channel: string) => void;
  onClose: () => void;
}

/** Remote channels the TUI can connect (existing omni instances). */
const SUPPORTED = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
];

/**
 * Overlay opened from the status bar "remoto" segment. Lists the remote channels
 * with their live status and connects the one you pick (WhatsApp pairs via QR;
 * an already-configured Telegram bot connects directly). "Só no terminal" closes.
 */
export function ChannelMenu({ channels, onConnect, onClose }: ChannelMenuProps) {
  const renderer = useRenderer();
  const statusFor = (id: string) => channels.find((c) => c.channel === id);
  const rows = [
    ...SUPPORTED.map((s) => ({ id: s.id, label: s.label, info: statusFor(s.id) })),
    { id: "__terminal", label: "Só no terminal", info: undefined },
  ];
  const [index, setIndex] = useState(0);

  const width = Math.min(72, Math.max(52, Math.floor(renderer.width * 0.62)));
  // border(2) + padding(2) + title + subtitle + spacer + rows + spacer + footer.
  const height = rows.length + 9;
  const left = Math.max(0, Math.floor((renderer.width - width) / 2));
  const top = Math.max(0, Math.floor((renderer.height - height) / 2));

  const activate = (id: string) => {
    if (id === "__terminal") return onClose();
    onConnect(id);
  };

  useKeyboard((key) => {
    if (key.name === "escape") return onClose();
    if (key.name === "up") return setIndex((i) => (i + rows.length - 1) % rows.length);
    if (key.name === "down") return setIndex((i) => (i + 1) % rows.length);
    if (key.name === "return" || key.name === "enter") return activate(rows[index]?.id ?? "__terminal");
  });

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      flexDirection="column"
      border
      borderColor="cyan"
      backgroundColor="black"
      shouldFill
      padding={1}
      zIndex={100}
    >
      <text content="Canal remoto" fg="cyan" bg="black" bold flexShrink={0} />
      <text
        content="Conecte um canal pra continuar do celular. Enter conecta · Esc fecha."
        fg="gray"
        bg="black"
        flexShrink={0}
      />
      <box height={1} flexShrink={0} />
      {rows.map((row, i) => {
        const selected = i === index;
        const isChannel = row.id !== "__terminal";
        const connected = row.info?.isConnected ?? false;
        const dot = !isChannel ? "🖥 " : connected ? "● " : "○ ";
        const dotColor = !isChannel ? THEME.dim : connected ? THEME.done : THEME.faint;
        const statusText = !isChannel
          ? ""
          : connected
            ? `  conectado${row.info?.profileName ? ` (${row.info.profileName})` : ""}`
            : "  desconectado";
        return (
          <box key={row.id} width="100%" height={1} flexShrink={0} flexDirection="row" onClick={() => activate(row.id)}>
            <text content={selected ? "❯ " : "  "} fg={selected ? "cyan" : "white"} bg="black" bold={selected} />
            <text content={dot} fg={dotColor} bg="black" />
            <text content={row.label} fg={selected ? "cyan" : "white"} bg="black" bold={selected} />
            {statusText ? <text content={statusText} fg={connected ? THEME.done : THEME.faint} bg="black" /> : null}
          </box>
        );
      })}
      <box height={1} flexShrink={0} />
      <text content="↑/↓ move · Enter seleciona · Esc fecha" fg="gray" bg="black" flexShrink={0} />
    </box>
  );
}
