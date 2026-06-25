/** @jsxImportSource @opentui/react */

import { useEffect, useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { MessageBubble } from "./MessageBubble.js";
import { TurnGroup } from "./TurnGroup.js";
import { groupTimeline } from "../lib/group-timeline.js";
import { THEME } from "../lib/theme.js";
import type { ChatMessage, PeerReview, TimelineEntry } from "../hooks/useNats.js";

interface ChatViewProps {
  messages: TimelineEntry[];
  /** True while the current turn is in flight (drives the live step group). */
  working: boolean;
  /** Display name for the principal (lead/editor) participant. */
  leadName?: string;
  /** Display name for the peer (reviewer) participant. */
  peerName?: string;
  /** Live peer review-gate status, shown on the peer's row of the active turn. */
  peerReview?: PeerReview | null;
}

const userBubble = (id: string, content: string): ChatMessage => ({
  id,
  type: "chat",
  role: "user",
  content,
  timestamp: 0,
});

const answerBubble = (id: string, content: string, streaming?: boolean): ChatMessage => ({
  id,
  type: "chat",
  role: "assistant",
  content,
  streaming,
  timestamp: 0,
  source: "lead",
});

/**
 * Scrollable chat view. The flat timeline is folded into a quiet step tree
 * (groupTimeline): your prompts and Claude's final answers read inline; all
 * tool runs and the Codex peer collapse into expandable turn groups.
 */
export function ChatView({ messages, working, leadName, peerName, peerReview }: ChatViewProps) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  // The peer keeps the turn "in flight" while it is evaluating the approach or
  // reviewing the diff — even after the lead's own turn.complete — so the tree
  // shows the live peer phase instead of flipping to "concluído" too early.
  const peerActive = peerReview?.state === "evaluating" || peerReview?.state === "reviewing";
  const nodes = groupTimeline(messages, { working: working || peerActive, leadName, peerName });
  // peerReview is always about the CURRENT turn — only the last turn node shows it.
  const lastTurnId = [...nodes].reverse().find((n) => n.kind === "turn")?.id;

  // Auto-scroll to bottom when the rendered node count changes.
  useEffect(() => {
    const scrollBox = scrollRef.current;
    if (scrollBox) {
      scrollBox.stickyScroll = true;
    }
  }, [nodes.length]);

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      width="100%"
      stickyScroll
      stickyStart="bottom"
      scrollY
    >
      <box flexDirection="column" width="100%" padding={1}>
        {/* ASCII logo */}
        <box flexDirection="column" width="100%" marginBottom={3}>
          <text
            content={[
              "       _   _        ",
              "  ___ | |_| |_ ___  ",
              " / _ \\| __| __/ _ \\ ",
              "| (_) | |_| || (_) |",
              " \\___/ \\__|\\__\\___/ ",
            ].join("\n")}
            fg={THEME.working}
          />
          <text content=" claude + codex · fusion" fg={THEME.codex} />
        </box>

        {nodes.length === 0
          ? null
          : nodes.map((node) => {
              if (node.kind === "turn") {
                return <TurnGroup key={node.id} turn={node} peerReview={node.id === lastTurnId ? peerReview : null} />;
              }
              if (node.kind === "user") {
                return <MessageBubble key={node.id} message={userBubble(node.id, node.content)} />;
              }
              return <MessageBubble key={node.id} message={answerBubble(node.id, node.content, node.streaming)} />;
            })}
      </box>
    </scrollbox>
  );
}
