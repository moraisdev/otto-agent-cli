import { describe, expect, it } from "bun:test";
import { GROUP_POLL_TIMEOUT_MS, resolvePollTimeoutMs } from "./host-hooks.js";

describe("resolvePollTimeoutMs", () => {
  it("uses the shorter group timeout for WhatsApp group chats", () => {
    expect(resolvePollTimeoutMs("120363000000000000@g.us")).toBe(GROUP_POLL_TIMEOUT_MS);
  });

  it("uses the shorter group timeout for group: chat ids", () => {
    expect(resolvePollTimeoutMs("group:120363000000000000")).toBe(GROUP_POLL_TIMEOUT_MS);
  });

  it("keeps the default (undefined) timeout for direct messages", () => {
    expect(resolvePollTimeoutMs("5511999999999")).toBeUndefined();
  });

  it("keeps the default timeout when no chat id is available", () => {
    expect(resolvePollTimeoutMs(undefined)).toBeUndefined();
  });

  it("uses a group timeout that is well under the 5 minute default", () => {
    expect(GROUP_POLL_TIMEOUT_MS).toBeLessThan(5 * 60 * 1000);
  });
});
