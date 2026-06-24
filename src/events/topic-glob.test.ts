import { describe, expect, it } from "bun:test";

import { matchesTopicGlob } from "./topic-glob.js";

describe("matchesTopicGlob", () => {
  it("keeps * within a single topic segment", () => {
    expect(matchesTopicGlob("otto.session.dev.prompt", "otto.session.*.prompt")).toBe(true);
    expect(matchesTopicGlob("otto.session.dev.runtime.prompt", "otto.session.*.prompt")).toBe(false);
  });

  it("allows ** to span topic segments", () => {
    expect(matchesTopicGlob("otto.session.dev.runtime.prompt", "otto.session.**.prompt")).toBe(true);
    expect(matchesTopicGlob("otto.session.dev.runtime.prompt", "otto.**")).toBe(true);
  });

  it("treats regex metacharacters as literal filter text", () => {
    expect(matchesTopicGlob("otto.session.dev?prompt", "otto.session.dev?prompt")).toBe(true);
    expect(matchesTopicGlob("otto.session.devXprompt", "otto.session.dev?prompt")).toBe(false);
  });
});
