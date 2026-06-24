import { describe, expect, it } from "bun:test";
import { ContextSourceSchema } from "../router/router-db.js";
import { cliSource } from "./source.js";

describe("cliSource", () => {
  it("produces a source that passes ContextSourceSchema (non-empty fields)", () => {
    const source = cliSource("proj-otto-c6442594");
    // The daemon validates the prompt's source with ContextSourceSchema, whose
    // channel/accountId/chatId are all `.min(1)`. Empty strings throw a ZodError
    // that surfaces in the REPL as "Error: [...]". This is the regression guard.
    expect(ContextSourceSchema.safeParse(source).success).toBe(true);
  });

  it("marks the channel as cli so the gateway falls into the fan-out branch", () => {
    const source = cliSource("proj-x");
    expect(source.channel).toBe("cli");
    // accountId must be unresolvable to a real instance (so resolveInstanceId
    // returns undefined -> missing_instance -> fanoutToSessionGroups).
    expect(source.accountId.length).toBeGreaterThan(0);
  });

  it("uses the session name as the chat id for traceability", () => {
    expect(cliSource("proj-x").chatId).toBe("proj-x");
  });
});
