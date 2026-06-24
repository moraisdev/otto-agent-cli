import { describe, expect, it } from "bun:test";
import { projectSessionName } from "./project-session.js";

describe("projectSessionName", () => {
  it("is stable for the same path", () => {
    expect(projectSessionName("/Users/me/proj")).toBe(projectSessionName("/Users/me/proj"));
  });

  it("differs for different paths", () => {
    expect(projectSessionName("/Users/me/a")).not.toBe(projectSessionName("/Users/me/b"));
  });

  it("includes a readable basename and is NATS-safe (no dots/spaces)", () => {
    const name = projectSessionName("/Users/me/My Cool App");
    expect(name).toContain("proj-");
    expect(name).not.toMatch(/[.\s]/);
    expect(name.toLowerCase()).toContain("cool");
  });

  it("handles trailing slashes consistently", () => {
    expect(projectSessionName("/Users/me/proj/")).toBe(projectSessionName("/Users/me/proj"));
  });
});
