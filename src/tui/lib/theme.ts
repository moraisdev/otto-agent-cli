/**
 * Palette mirrored from Hermes' TUI (ui-tui/src/theme.ts DARK_THEME): a warm
 * gold theme with soft-white (cornsilk) body text. We keep Hermes' values and
 * only avoid leaning on bright green/amber as prominent status decoration —
 * "done" reads as muted gold rather than a loud green.
 */
export const THEME = {
  text: "#FFF8DC", // cornsilk — body / white text (Hermes `text`)
  dim: "#CC9B1F", // muted gold — metadata, labels (Hermes `muted`)
  faint: "#9a875a", // dim gold — separators, tertiary detail
  claude: "#FFD700", // gold — lead marker (Hermes `primary`)
  codex: "#4dd0e1", // cyan — peer marker (distinct second voice)
  working: "#FFBF00", // amber — working spinner (Hermes `accent`)
  done: "#CC9B1F", // muted gold — finished (no loud green)
  err: "#ef5350", // red — error / disconnected (Hermes `error`)
  statusBg: "#1a1a2e", // status bar background (Hermes `statusBg`)
  statusFg: "#FFF8DC", // status bar text — soft white
} as const;
