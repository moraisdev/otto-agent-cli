import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publish, subscribe } from "../../nats.js";

export type ConnectStatus = "idle" | "connecting" | "qr" | "connected" | "error";

export interface ChannelInfo {
  instanceId: string;
  /** Normalized channel: "whatsapp" | "telegram" | "discord" | … */
  channel: string;
  name: string | null;
  isConnected: boolean;
  profileName: string | null;
}

const CONNECT_TIMEOUT_MS = 25_000; // backstop if omni never answers
const CONNECTED_DISMISS_MS = 2_500;
const ERROR_DISMISS_MS = 5_000;
const LIST_REFRESH_MS = 15_000;

/**
 * Drive the deterministic remote-channel flow for the TUI: list the channels the
 * daemon manages (with live connection status) and connect one on demand. Connect
 * is a single live status: idle → connecting → (qr | connected | error). The
 * daemon does the actual omni connect; we publish requests and reflect the events
 * it re-emits (otto.channel.qr.* / otto.channel.connected.* / .connect.result).
 */
export function useChannels(): {
  channels: ChannelInfo[];
  connectedChannels: string[];
  status: ConnectStatus;
  connectingChannel: string | null;
  qr: string | null;
  errorReason: string | null;
  connect: (channel: string) => void;
  dismiss: () => void;
  refresh: () => void;
} {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [connectingChannel, setConnectingChannel] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const refresh = useCallback(() => {
    publish("otto.channels.list.request", {}).catch(() => {});
  }, []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      for await (const evt of subscribe(
        "otto.channels.list.result",
        "otto.channel.qr.>",
        "otto.channel.connected.>",
        "otto.channel.connect.result",
      )) {
        if (stopped) break;
        const data = (evt.data ?? {}) as {
          type?: string;
          qr?: string;
          ok?: boolean;
          reason?: string;
          channels?: ChannelInfo[];
        };
        if (evt.topic.endsWith(".channels.list.result")) {
          if (Array.isArray(data.channels)) setChannels(data.channels);
        } else if (evt.topic.includes(".channel.qr.") && data.type === "qr" && typeof data.qr === "string") {
          clearTimer();
          setQr(data.qr);
          setErrorReason(null);
          setStatus("qr");
        } else if (evt.topic.includes(".channel.connected.")) {
          clearTimer();
          setQr(null);
          setErrorReason(null);
          setStatus("connected");
          timerRef.current = setTimeout(() => setStatus("idle"), CONNECTED_DISMISS_MS);
          refresh(); // pull the updated connected list
        } else if (evt.topic.endsWith(".channel.connect.result") && data.ok === false) {
          clearTimer();
          setErrorReason(data.reason ?? "connect_error");
          setStatus("error");
          timerRef.current = setTimeout(() => setStatus("idle"), ERROR_DISMISS_MS);
        }
      }
    })().catch(() => {});
    return () => {
      stopped = true;
      clearTimer();
    };
  }, [refresh]);

  // Initial + periodic refresh so the "remoto" segment reflects reality.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const connect = useCallback((channel: string) => {
    setQr(null);
    setErrorReason(null);
    setConnectingChannel(channel);
    setStatus("connecting");
    publish("otto.channel.connect.request", { channel }).catch(() => {});
    clearTimer();
    timerRef.current = setTimeout(() => {
      setErrorReason("timeout");
      setStatus("error");
      timerRef.current = setTimeout(() => setStatus("idle"), ERROR_DISMISS_MS);
    }, CONNECT_TIMEOUT_MS);
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setQr(null);
    setErrorReason(null);
    setStatus("idle");
  }, []);

  const connectedChannels = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) if (c.isConnected) set.add(c.channel);
    return [...set];
  }, [channels]);

  return { channels, connectedChannels, status, connectingChannel, qr, errorReason, connect, dismiss, refresh };
}
