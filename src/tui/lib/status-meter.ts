/**
 * Pure formatting helpers for the live status meter in the footer
 * (`· working… (1m12s · ↓ 18.4k tokens · opus 4.8 + gpt-5.5)`).
 * Kept separate from the React component so the number formatting is testable.
 */

/** Human elapsed time: `45s`, `1m12s`, `1h03m`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h${String(remMinutes).padStart(2, "0")}m`;
}

/** Compact token count: `947`, `18.4k`, `1.5M` (trailing `.0` trimmed). */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trimZero(n / 1000)}k`;
  return `${trimZero(n / 1_000_000)}M`;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
