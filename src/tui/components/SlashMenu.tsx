/** @jsxImportSource @opentui/react */

import { useRenderer } from "@opentui/react";
import { THEME } from "../lib/theme.js";

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "reset", description: "Reset session (clear context)" },
  { name: "model", description: "Switch provider/model" },
  { name: "fusion", description: "Toggle Claude+Codex fusion" },
  { name: "stop", description: "Interrupt the running turn" },
  { name: "cockpit", description: "Cockpit view (Ctrl+O)" },
  { name: "chat", description: "Back to chat (Ctrl+O)" },
  { name: "help", description: "List commands" },
  { name: "exit", description: "Quit the terminal UI" },
  { name: "quit", description: "Quit the terminal UI" },
];

export function filterCommands(query: string): SlashCommand[] {
  if (!query) return SLASH_COMMANDS;
  const lower = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().includes(lower));
}

interface SlashMenuProps {
  query: string;
  selectedIndex: number;
  /** Height of the parent InputBar box, so we can position flush above it */
  parentHeight?: number;
}

const NAME_COL = 9; // pad command names so descriptions line up

/**
 * Dropdown overlay above the input bar when the user types `/`.
 * Each row is exactly one line (fixed height + clip) so long descriptions can't
 * wrap and stack on top of each other. Pure visual — keys are handled in InputBar.
 */
export function SlashMenu({ query, selectedIndex, parentHeight = 3 }: SlashMenuProps) {
  const renderer = useRenderer();
  const filtered = filterCommands(query);
  if (filtered.length === 0) return null;

  const clamped = Math.min(selectedIndex, filtered.length - 1);
  const menuHeight = filtered.length + 2; // + top/bottom border
  const width = Math.min(60, Math.max(40, Math.floor(renderer.width * 0.7)));
  const inner = width - 3; // border + a little slack

  return (
    <box
      position="absolute"
      bottom={parentHeight - 1}
      left={0}
      width={width}
      height={menuHeight}
      flexDirection="column"
      border
      borderColor={THEME.codex}
      backgroundColor="black"
      shouldFill
      overflow="hidden"
    >
      {filtered.map((cmd, i) => {
        const isSelected = i === clamped;
        const line = `${isSelected ? "❯ " : "  "}/${cmd.name.padEnd(NAME_COL)}${cmd.description}`;
        const content = line.length > inner ? `${line.slice(0, inner - 1)}…` : line;
        return (
          <box key={cmd.name} height={1} flexShrink={0} backgroundColor="black">
            <text content={content} fg={isSelected ? THEME.codex : THEME.text} bg="black" bold={isSelected} />
          </box>
        );
      })}
    </box>
  );
}
