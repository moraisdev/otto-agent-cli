import { describe, expect, it } from "bun:test";
import { classifySessionEvent } from "./events.js";

describe("classifySessionEvent", () => {
  it("classifies a stream chunk", () => {
    expect(classifySessionEvent("stream", { chunk: "hello" })).toEqual({ kind: "stream", text: "hello" });
  });

  it("ignores an empty stream chunk", () => {
    expect(classifySessionEvent("stream", { chunk: "" })).toEqual({ kind: "ignore" });
  });

  it("classifies a tool start", () => {
    expect(classifySessionEvent("tool", { event: "start", toolName: "Edit", input: { file_path: "a.ts" } })).toEqual({
      kind: "tool-start",
      toolName: "Edit",
      input: { file_path: "a.ts" },
    });
  });

  it("classifies a tool end", () => {
    expect(classifySessionEvent("tool", { event: "end", toolName: "Bash", output: "ok", isError: false })).toEqual({
      kind: "tool-end",
      toolName: "Bash",
      output: "ok",
      isError: false,
    });
  });

  it("classifies the final response and marks the turn done", () => {
    expect(classifySessionEvent("response", { response: "all done" })).toEqual({ kind: "response", text: "all done" });
  });

  it("classifies the user echo (own prompt coming back)", () => {
    expect(classifySessionEvent("prompt", { prompt: "do X" })).toEqual({ kind: "user-echo", text: "do X" });
  });

  it("ignores runtime/claude provider noise", () => {
    expect(classifySessionEvent("runtime", { type: "typing" })).toEqual({ kind: "ignore" });
    expect(classifySessionEvent("claude", { type: "whatever" })).toEqual({ kind: "ignore" });
  });
});
