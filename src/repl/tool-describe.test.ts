import { describe, expect, it } from "bun:test";
import { describeToolCall } from "./tool-describe.js";

describe("describeToolCall", () => {
  it("describes a file edit by its path", () => {
    expect(describeToolCall("Edit", { file_path: "src/foo.ts" })).toBe("Edit src/foo.ts");
  });

  it("describes a write by its path", () => {
    expect(describeToolCall("Write", { file_path: "src/new.ts" })).toBe("Write src/new.ts");
  });

  it("describes a read by its path", () => {
    expect(describeToolCall("Read", { file_path: "README.md" })).toBe("Read README.md");
  });

  it("describes a bash call by its command", () => {
    expect(describeToolCall("Bash", { command: "bun test" })).toBe("Bash bun test");
  });

  it("describes a grep by its pattern", () => {
    expect(describeToolCall("Grep", { pattern: "TODO" })).toBe("Grep TODO");
  });

  it("truncates long arguments", () => {
    const long = "x".repeat(200);
    const out = describeToolCall("Bash", { command: long });
    expect(out.length).toBeLessThan(90);
    expect(out.endsWith("…")).toBe(true);
  });

  it("falls back to just the tool name when no known arg is present", () => {
    expect(describeToolCall("SomeTool", { whatever: 1 })).toBe("SomeTool");
  });

  it("handles missing/empty input", () => {
    expect(describeToolCall("Read", undefined)).toBe("Read");
    expect(describeToolCall("Read", {})).toBe("Read");
  });
});
