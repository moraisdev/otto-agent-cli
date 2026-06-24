/** @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { logger } from "../utils/logger.js";
import { App } from "./App.js";

// The opentui TUI owns the terminal — any stray write to stdout/stderr corrupts
// the rendered screen. Silence the logger's terminal output (it still reaches
// the daemon's file log) and neuter the chatty console methods as defense.
logger.setTerminalEnabled(false);
const noop = () => {};
console.log = noop;
console.info = noop;
console.warn = noop;
console.debug = noop;

async function main() {
  const renderer = await createCliRenderer({
    // We handle Ctrl+C ourselves: interrupt the running turn first, then clear
    // input, then (idle) confirm-exit — instead of always killing the process.
    exitOnCtrlC: false,
    // Mouse capture powers in-app clicks + opentui's drag-select (auto-copied via
    // OSC52). It also suppresses the terminal's NATIVE click-drag selection (you'd
    // need Shift/Option). Set OTTO_TUI_MOUSE=0 to release the mouse and get plain
    // native selection/copy instead (at the cost of in-app clicks).
    useMouse: process.env.OTTO_TUI_MOUSE !== "0",
  });

  const root = createRoot(renderer);
  root.render(<App />);
}

main().catch((err) => {
  // Restore stderr for a fatal startup error the user must see.
  logger.setTerminalEnabled(true);
  process.stderr.write(`Failed to start TUI: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
