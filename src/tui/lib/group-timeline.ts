/**
 * Fold the flat NATS timeline into render nodes for the participant-tree TUI.
 *
 * A turn = your prompt → Claude's final answer. The work in between is grouped
 * by PARTICIPANT (the "agents" — Claude the lead, Codex the peer), each with its
 * tool-use count and a rough token estimate, rendered as a tree (like a
 * multi-agent run). Claude's final answer still reads inline below the tree.
 *
 * Pure and synchronous so it is trivially testable; the React layer only renders
 * whatever this returns.
 */

import type { ChatMessage, EntrySource, TimelineEntry } from "../hooks/useNats.js";

export interface ToolStep {
  kind: "tool";
  id: string;
  source: EntrySource;
  toolName: string;
  status: "running" | "done";
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export interface MessageStep {
  kind: "message";
  id: string;
  source: EntrySource;
  content: string;
  streaming?: boolean;
}

export type TurnStep = ToolStep | MessageStep;

/** One "agent" in a turn — the Claude lead or the Codex peer. */
export interface Participant {
  source: EntrySource;
  name: string;
  toolCount: number;
  /** Rough output-token estimate (text chars / 4) for this participant. */
  tokenEstimate: number;
  steps: TurnStep[];
}

export interface UserNode {
  kind: "user";
  id: string;
  content: string;
}

export interface TurnNode {
  kind: "turn";
  id: string;
  participants: Participant[];
  working: boolean;
}

export interface AnswerNode {
  kind: "answer";
  id: string;
  content: string;
  streaming?: boolean;
}

export type RenderNode = UserNode | TurnNode | AnswerNode;

interface Segment {
  user?: ChatMessage;
  items: TimelineEntry[];
}

function toStep(entry: TimelineEntry): TurnStep {
  if (entry.type === "tool") {
    return {
      kind: "tool",
      id: entry.id,
      source: entry.source ?? "lead",
      toolName: entry.toolName,
      status: entry.status,
      input: entry.input,
      output: entry.output,
      isError: entry.isError,
      durationMs: entry.durationMs,
    };
  }
  return {
    kind: "message",
    id: entry.id,
    source: entry.source ?? "lead",
    content: entry.content,
    streaming: entry.streaming,
  };
}

/**
 * System/status notes pushed by the UI (e.g. "Conectando WhatsApp…", "Aborted.")
 * — assistant messages with a `system-` id. They render inline as plain notes,
 * never folded into the activity tree as a phantom "Claude · 0 tool uses".
 */
function isNote(entry: TimelineEntry): boolean {
  return entry.type === "chat" && entry.role === "assistant" && entry.id.startsWith("system-");
}

/** The "answer" is the last lead (non-Codex) assistant message of a segment. */
function findAnswerIndex(items: TimelineEntry[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === "chat" && it.role === "assistant" && it.source !== "codex") {
      return i;
    }
  }
  return -1;
}

function buildParticipant(source: EntrySource, name: string, items: TimelineEntry[], extraText = ""): Participant {
  let chars = extraText.length;
  const tools: TimelineEntry[] = [];
  for (const e of items) {
    if (e.type === "tool") tools.push(e);
    else chars += e.content.length;
  }
  // steps are TOOL runs only — intermediate assistant/peer prose ("thinking") is
  // never surfaced; the user wants activity counts, not the reasoning stream.
  return { source, name, toolCount: tools.length, tokenEstimate: Math.ceil(chars / 4), steps: tools.map(toStep) };
}

export function groupTimeline(
  entries: TimelineEntry[],
  opts?: { working?: boolean; leadName?: string; peerName?: string },
): RenderNode[] {
  // Display names for the two participants. "lead" = the principal (editor), "codex"
  // = the peer companion — whose provider may be Claude when Codex is the principal,
  // so the names are passed in rather than hardcoded.
  const leadName = opts?.leadName ?? "Claude";
  const peerName = opts?.peerName ?? "Codex";
  // Split the flat list into segments, each starting at a user message.
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const entry of entries) {
    if (entry.type === "chat" && entry.role === "user") {
      if (current) segments.push(current);
      current = { user: entry, items: [] };
    } else {
      if (!current) current = { items: [] };
      current.items.push(entry);
    }
  }
  if (current) segments.push(current);

  const working = Boolean(opts?.working);
  const nodes: RenderNode[] = [];

  segments.forEach((seg, index) => {
    const isLast = index === segments.length - 1;
    if (seg.user) {
      nodes.push({ kind: "user", id: seg.user.id, content: seg.user.content });
    }

    // System/status notes render inline; everything else forms the turn tree.
    const notes = seg.items.filter(isNote);
    const items = seg.items.filter((e) => !isNote(e));

    const isActive = working && isLast;
    const answerIdx = findAnswerIndex(items);
    // While the turn is in flight, do NOT surface an inline answer — only the
    // activity tree shows. The final answer appears once the turn completes, so
    // intermediate "thinking" blocks never flash/change inline.
    const answer = !isActive && answerIdx >= 0 ? (items[answerIdx] as ChatMessage) : null;
    const rest = answer ? items.filter((_, j) => j !== answerIdx) : items;
    const leadItems = rest.filter((e) => (e.source ?? "lead") !== "codex");
    const codexItems = rest.filter((e) => e.source === "codex");

    const participants: Participant[] = [];
    // Attribute the final answer's tokens to the lead (it's the principal's output).
    if (leadItems.length > 0) participants.push(buildParticipant("lead", leadName, leadItems, answer?.content ?? ""));
    if (codexItems.length > 0) participants.push(buildParticipant("codex", peerName, codexItems));

    if (participants.length > 0) {
      nodes.push({
        kind: "turn",
        id: `turn-${seg.user?.id ?? `seg-${index}`}`,
        participants,
        working: working && isLast,
      });
    }

    if (answer) {
      nodes.push({ kind: "answer", id: answer.id, content: answer.content, streaming: answer.streaming });
    }

    for (const note of notes) {
      nodes.push({ kind: "answer", id: note.id, content: (note as ChatMessage).content });
    }
  });

  return nodes;
}
