/** @jsxImportSource @opentui/react */

import { useRef, useEffect, useState, useMemo } from "react";
import { useRenderer } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { SlashMenu, filterCommands } from "./SlashMenu.js";
import { inputHistory } from "../lib/input-history.js";
import { computeVisualLines } from "../lib/input-layout.js";

interface InputBarProps {
  onSend: (text: string) => void;
  onSlashCommand: (cmd: string) => void;
  onAbort: () => void;
  placeholder?: string;
  /** Whether the agent is currently working */
  isWorking?: boolean;
  /** When true, aggressively keeps focus on the input */
  active?: boolean;
  /** Extra rows above the input bar (e.g. the StatusMeter row). */
  extraOffset?: number;
  /** Called when ↓ is pressed on an empty input — hands focus to the status bar. */
  onStatusNav?: () => void;
  /** Called on Ctrl+C when idle with empty input (App decides confirm/exit). */
  onRequestExit?: () => void;
}

const textareaKeyBindings = [
  // Enter = submit (override default newline)
  { name: "return", action: "submit" as const },
  // Shift+Enter = newline (Kitty-capable terminals: iTerm2, WezTerm, Ghostty, Kitty)
  { name: "return", shift: true, action: "newline" as const },
  // Option/Alt+Enter = newline (works when "Option as Meta/Esc+" is enabled)
  { name: "return", meta: true, action: "newline" as const },
  // linefeed (0x0A) = newline (some terminals send this for Shift+Enter)
  { name: "linefeed", action: "newline" as const },
];

const INPUT_PREFIX = "❯ ";
const INPUT_PREFIX_WIDTH = 2;
const AMBER = "#FFBF00";

/**
 * Input bar for typing and sending messages.
 * Enter submits; Shift+Enter / Option+Enter insert a newline.
 * Typing `/` opens a slash command dropdown.
 */
export function InputBar({
  onSend,
  onSlashCommand,
  onAbort,
  placeholder = "Type a message…",
  isWorking = false,
  active = true,
  extraOffset = 0,
  onStatusNav,
  onRequestExit,
}: InputBarProps) {
  const renderer = useRenderer();
  const textareaRef = useRef<TextareaRenderable>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lineCount, setLineCount] = useState(1);

  // Input history navigation
  const historyIndexRef = useRef(-1); // -1 = composing new text
  const draftRef = useRef(""); // saves current draft when entering history

  // Refs so the handleKeyPress closure always sees current values
  const onAbortRef = useRef(onAbort);
  const onStatusNavRef = useRef(onStatusNav);
  const onRequestExitRef = useRef(onRequestExit);
  const isWorkingRef = useRef(isWorking);
  const activeRef = useRef(active);
  const slashOpenRef = useRef(false);
  const filteredRef = useRef<ReturnType<typeof filterCommands>>([]);
  const selectedIndexRef = useRef(0);

  const filtered = useMemo(() => filterCommands(slashQuery), [slashQuery]);

  // Keep refs in sync
  onAbortRef.current = onAbort;
  onStatusNavRef.current = onStatusNav;
  onRequestExitRef.current = onRequestExit;
  isWorkingRef.current = isWorking;
  activeRef.current = active;
  slashOpenRef.current = slashOpen;
  filteredRef.current = filtered;
  selectedIndexRef.current = selectedIndex;

  // Aggressively keep focus on textarea when active; release it when not, so
  // overlay modals (model picker, location menu) own the keyboard — otherwise
  // arrow keys leak into history nav and Esc hits the input instead of closing.
  useEffect(() => {
    if (!active) {
      textareaRef.current?.blur();
      return;
    }
    const id = setInterval(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  // Intercept `\` key to insert newline + sync lineCount + slash detection after every keypress
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const syncLineCount = () => {
      setLineCount(computeVisualLines(ta.plainText, renderer.width - INPUT_PREFIX_WIDTH));
    };
    const origHandleKeyPress = ta.handleKeyPress.bind(ta);
    ta.handleKeyPress = (key: any) => {
      // When inactive (a modal owns the screen), don't consume keys — let the
      // overlay's keyboard handler take arrows/Esc/Enter.
      if (!activeRef.current) return false;

      // Ctrl+C cascade (Hermes-style): interrupt the running turn first, else
      // clear typed text, else ask App to confirm-exit. Never kills the process
      // mid-turn.
      if (key.ctrl && key.name === "c") {
        if (isWorkingRef.current) {
          onAbortRef.current();
          return true;
        }
        if (ta.plainText.trim()) {
          ta.clear();
          setLineCount(1);
          return true;
        }
        onRequestExitRef.current?.();
        return true;
      }

      // When slash menu is open, intercept navigation keys before textarea
      if (slashOpenRef.current) {
        if (key.name === "escape") {
          setSlashOpen(false);
          ta.clear();
          setLineCount(1);
          return true;
        }
        if (key.name === "up" || (key.ctrl && key.name === "p")) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          return true;
        }
        if (key.name === "down" || (key.ctrl && key.name === "n")) {
          setSelectedIndex((prev) => Math.min(filteredRef.current.length - 1, prev + 1));
          return true;
        }
      }

      // Escape: empty → abort; has text → save to history + clear
      if (key.name === "escape" && !slashOpenRef.current) {
        const text = ta.plainText.trim();
        if (text) {
          inputHistory.push(text);
          ta.clear();
          setLineCount(1);
        } else if (isWorkingRef.current) {
          onAbortRef.current();
        }
        historyIndexRef.current = -1;
        draftRef.current = "";
        return true;
      }

      // Up/Down: navigate input history (single-line only, not in slash menu)
      if (!slashOpenRef.current && ta.lineCount === 1) {
        const items = inputHistory.list();
        if (key.name === "up" && items.length > 0) {
          if (historyIndexRef.current === -1) {
            draftRef.current = ta.plainText;
            historyIndexRef.current = items.length - 1;
          } else if (historyIndexRef.current > 0) {
            historyIndexRef.current--;
          }
          ta.clear();
          ta.insertText(items[historyIndexRef.current]!);
          syncLineCount();
          return true;
        }
        if (key.name === "down") {
          if (historyIndexRef.current >= 0) {
            if (historyIndexRef.current < items.length - 1) {
              historyIndexRef.current++;
              ta.clear();
              ta.insertText(items[historyIndexRef.current]!);
            } else {
              historyIndexRef.current = -1;
              ta.clear();
              if (draftRef.current) ta.insertText(draftRef.current);
            }
            syncLineCount();
            return true;
          }
          // ↓ on an empty, fresh input → hand focus to the status bar.
          if (ta.plainText.trim() === "" && onStatusNavRef.current) {
            onStatusNavRef.current();
            return true;
          }
        }
      }

      const result = origHandleKeyPress(key);
      syncLineCount();

      // Any typing resets history navigation
      if (historyIndexRef.current >= 0 && key.sequence && key.sequence.length === 1) {
        historyIndexRef.current = -1;
        draftRef.current = "";
      }

      // Slash detection (textarea has no onInput event)
      const text = ta.plainText;
      if (text.startsWith("/") && !text.includes("\n")) {
        setSlashOpen(true);
        setSlashQuery(text.slice(1));
        setSelectedIndex(0);
      } else {
        setSlashOpen(false);
      }

      return result;
    };

    // Paste is dispatched through a SEPARATE handler — wrap it too so a long /
    // multi-line paste grows the box (otherwise lineCount stays stale).
    const origHandlePaste = ta.handlePaste?.bind(ta);
    if (origHandlePaste) {
      ta.handlePaste = (event: unknown) => {
        if (!activeRef.current) return;
        origHandlePaste(event);
        syncLineCount();
        const text = ta.plainText;
        if (text.startsWith("/") && !text.includes("\n")) {
          setSlashOpen(true);
          setSlashQuery(text.slice(1));
          setSelectedIndex(0);
        }
      };
    }
  }, []);

  // Wire up submit handler
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.onSubmit = () => {
      const text = ta.plainText;

      // Slash command selection
      if (slashOpen && filtered.length > 0) {
        const clamped = Math.min(selectedIndex, filtered.length - 1);
        const cmd = filtered[clamped];
        if (cmd) {
          onSlashCommand(cmd.name);
        }
        setSlashOpen(false);
        ta.clear();
        setLineCount(1);
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) return;
      inputHistory.push(trimmed);
      historyIndexRef.current = -1;
      draftRef.current = "";
      onSend(trimmed);
      ta.clear();
      setLineCount(1);
    };
  });

  // Dynamic height: border(2) + visible lines, capped at 8 lines
  const visibleLines = Math.min(lineCount, 8);
  const barHeight = visibleLines + 2;

  return (
    <box
      height={barHeight}
      width="100%"
      flexDirection="row"
      border={["top", "bottom"]}
      borderColor="gray"
      borderFocusedColor="cyan"
      title=" otto "
      titleAlignment="right"
    >
      {slashOpen && (
        <SlashMenu query={slashQuery} selectedIndex={selectedIndex} parentHeight={barHeight + extraOffset} />
      )}
      <text content={INPUT_PREFIX} width={INPUT_PREFIX_WIDTH} flexShrink={0} fg={AMBER} bold />
      <textarea
        ref={textareaRef}
        focused
        flexGrow={1}
        wrapMode="word"
        placeholder={placeholder}
        keyBindings={textareaKeyBindings}
        textColor="white"
      />
    </box>
  );
}
