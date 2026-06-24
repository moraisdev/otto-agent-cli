/** @jsxImportSource @opentui/react */

import { useEffect, useRef, useState } from "react";
import { formatElapsed, formatTokens } from "../lib/status-meter.js";
import { THEME } from "../lib/theme.js";

export type MeterState = "thinking" | "working" | "compacting";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const AMBER = THEME.working;
const DIM = THEME.faint;

const STATE_LABEL: Record<MeterState, string> = {
  thinking: "pensando",
  working: "trabalhando",
  compacting: "compactando contexto",
};

interface StatusMeterProps {
  state: MeterState | null;
  /** Epoch ms when the current turn started; null when idle. */
  startedAt: number | null;
  /** Accumulated output tokens for the live readout (↓). */
  outputTokens: number;
  /** Models in play, e.g. "opus 4.8 + gpt-5.5". */
  models: string;
}

/**
 * Live footer meter: `· trabalhando… (1m12s · ↓ 18.4k tokens · opus 4.8 + gpt-5.5)`.
 * Owns its own ticking clock + spinner; renders nothing when idle.
 */
export function StatusMeter({ state, startedAt, outputTokens, models }: StatusMeterProps) {
  const [frame, setFrame] = useState(0);
  const [, setNow] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Depend on a stable boolean, not the state string — otherwise the timer is
  // torn down/recreated every time state flips (thinking<->working) mid-turn.
  const active = state !== null;

  useEffect(() => {
    if (!active) return;
    timerRef.current = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
      setNow(Date.now());
    }, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active]);

  if (!state) return null;

  const elapsed = startedAt ? formatElapsed(Date.now() - startedAt) : "0s";
  const parts = [elapsed, `↓ ${formatTokens(outputTokens)} tokens`, models].filter(Boolean);

  return (
    <box height={1} width="100%" flexDirection="row">
      <text content={` ${SPINNER[frame]} `} fg={AMBER} />
      <text content={`${STATE_LABEL[state]}… `} fg={AMBER} />
      <text content={`(${parts.join(" · ")})`} fg={DIM} />
    </box>
  );
}
