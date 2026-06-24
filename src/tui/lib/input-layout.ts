/**
 * OpenTUI only refreshes virtualLineCount during its layout pass. Keyboard and
 * paste callbacks run before that pass, so derive the next height from the
 * buffer itself instead of reading a stale render metric.
 */
export function computeVisualLines(text: string, width: number): number {
  const availableWidth = Math.max(1, width);
  let total = 0;

  for (const line of text.split("\n")) {
    // biome-ignore lint/correctness/noUndeclaredVariables: Otto's TUI runs on Bun.
    total += Math.max(1, Math.ceil(Bun.stringWidth(line) / availableWidth));
  }

  return Math.max(1, total);
}
