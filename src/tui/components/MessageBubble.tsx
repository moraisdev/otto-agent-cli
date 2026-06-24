/** @jsxImportSource @opentui/react */

import type { ChatMessage } from "../hooks/useNats.js";
import { MARKDOWN_SYNTAX_STYLE } from "../lib/markdown-style.js";
import { THEME } from "../lib/theme.js";

// Warm Hermes palette — identity comes from the bullet color, body stays white.
const GOLD = THEME.claude; // Claude (lead) marker — gold
const AMBER = THEME.working; // user prompt marker — amber
const BODY = THEME.text; // body text — cornsilk white

/**
 * One chat turn, clean (no boxes):
 * - User:   amber `❯` + text
 * - Claude: gold `⏺` + markdown (the lead's final answer)
 *
 * Codex never renders here — its activity lives inside the TurnGroup step tree.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <box width="100%" marginTop={1} flexDirection="row">
        <text content="❯ " fg={AMBER} bold />
        <text content={message.content} fg={BODY} />
      </box>
    );
  }

  return (
    <box width="100%" marginTop={1} flexDirection="row">
      <text content="⏺ " fg={GOLD} bold />
      <box flexDirection="column" flexGrow={1}>
        {message.streaming ? (
          <text content={message.content} fg={BODY} />
        ) : (
          <markdown content={message.content} conceal syntaxStyle={MARKDOWN_SYNTAX_STYLE} />
        )}
      </box>
    </box>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}
