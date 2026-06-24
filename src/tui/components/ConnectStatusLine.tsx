/** @jsxImportSource @opentui/react */

import { useEffect, useState } from "react";
import type { ConnectStatus } from "../hooks/useChannels.js";
import { THEME } from "../lib/theme.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function channelLabel(channel: string | null): string {
  if (!channel) return "canal";
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "telegram") return "Telegram";
  if (channel === "discord") return "Discord";
  return channel;
}

function errorText(reason: string | null): string {
  if (reason === "omni_offline") return "serviço (omni) offline — tente de novo";
  if (reason === "timeout") return "sem resposta (timeout)";
  if (reason && /^no_.+_instance$/.test(reason)) return "nenhuma instância configurada (use o CLI)";
  return "erro ao conectar";
}

/**
 * One live footer line for the remote-channel connect flow — a "conectando…"
 * spinner (like the working flag) that persists until it resolves to
 * connected/error. The QR itself is rendered by the QrOverlay (status "qr").
 */
export function ConnectStatusLine({
  status,
  channel,
  errorReason,
}: {
  status: ConnectStatus;
  channel: string | null;
  errorReason: string | null;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (status !== "connecting") return;
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 100);
    return () => clearInterval(id);
  }, [status]);

  if (status === "idle" || status === "qr") return null;

  const name = channelLabel(channel);

  if (status === "connecting") {
    return (
      <box height={1} width="100%" flexDirection="row">
        <text content={` ${SPINNER[frame]} `} fg={THEME.working} />
        <text content={`conectando ${name}…`} fg={THEME.working} />
      </box>
    );
  }

  if (status === "connected") {
    return (
      <box height={1} width="100%">
        <text content={` ✓ ${name} conectado`} fg={THEME.done} />
      </box>
    );
  }

  return (
    <box height={1} width="100%">
      <text content={` ✗ ${name}: ${errorText(errorReason)}`} fg={THEME.err} />
    </box>
  );
}
