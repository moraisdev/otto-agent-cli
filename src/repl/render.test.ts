import { describe, expect, it } from "bun:test";
import { borderLine, formatToolLine, formatToolResult, statusLine, stripAnsi } from "./render.js";

describe("formatToolLine", () => {
  it("shows an icon and the legible tool description", () => {
    const line = stripAnsi(formatToolLine("Edit", { file_path: "src/foo.ts" }));
    expect(line).toContain("Edit src/foo.ts");
  });

  it("renders a marker even for unknown tools", () => {
    const line = stripAnsi(formatToolLine("Whatever", {}));
    expect(line).toContain("Whatever");
    expect(line.trim().length).toBeGreaterThan(0);
  });
});

describe("formatToolResult", () => {
  it("returns a short one-line summary of output", () => {
    const line = stripAnsi(formatToolResult("line1\nline2\nline3"));
    expect(line).not.toContain("\n");
    expect(line.length).toBeGreaterThan(0);
  });

  it("returns empty for empty output", () => {
    expect(formatToolResult("")).toBe("");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    expect(stripAnsi("\x1b[2mhello\x1b[0m")).toBe("hello");
  });
});

describe("borderLine", () => {
  it("fills the full width and right-aligns the label", () => {
    const line = stripAnsi(borderLine("proj-x", 40));
    expect(line.length).toBe(40);
    expect(line.startsWith("─")).toBe(true);
    expect(line.endsWith(" proj-x ─")).toBe(true);
  });

  it("is all dashes with no label", () => {
    expect(stripAnsi(borderLine("", 20))).toBe("─".repeat(20));
  });
});

describe("statusLine", () => {
  it("joins parts with a middot and drops empties", () => {
    expect(stripAnsi(statusLine(["a", "", "b"]))).toContain("a · b");
  });
});
