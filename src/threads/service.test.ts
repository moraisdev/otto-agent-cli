import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { dbBindSessionToChat, dbUpsertChat } from "../router/router-db.js";
import { getOrCreateSession } from "../router/sessions.js";
import {
  addThreadEntry,
  buildThreadBrief,
  createThread,
  listThreadEntries,
  listThreadLinks,
  listThreads,
  markThreadHandoffDelivered,
  prepareThreadHandoff,
  resolveThread,
  upsertThreadLink,
} from "./index.js";

let stateDir: string | null = null;

beforeEach(async () => {
  stateDir = await createIsolatedOttoState("otto-threads-test-");
});

afterEach(async () => {
  await cleanupIsolatedOttoState(stateDir);
  stateDir = null;
});

describe("threads service", () => {
  it("creates, resolves, links, and briefs a thread without leaking private entries", () => {
    const thread = createThread({
      slug: "Spec Review",
      title: "Spec Review",
      summary: "Review the first thread spec.",
      owner: { type: "agent", id: "otto-threads" },
      scope: { type: "session", id: "otto-threads" },
      now: 1000,
    });

    expect(thread.slug).toBe("spec-review");
    expect(resolveThread("spec-review", { scope: { type: "session", id: "otto-threads" } }).id).toBe(thread.id);

    addThreadEntry({
      threadId: thread.id,
      kind: "comment",
      body: "Public context for the receiving agent.",
      actor: { type: "agent", id: "otto-threads", agentId: "otto-threads" },
      now: 1100,
    });
    addThreadEntry({
      threadId: thread.id,
      kind: "note",
      body: "secret implementation detail",
      visibility: "private",
      actor: { type: "agent", id: "otto-threads" },
      now: 1200,
    });
    const link = upsertThreadLink({
      threadId: thread.id,
      target: { type: "session", id: "otto-threads" },
      role: "origin",
      now: 1300,
    });

    const listed = listThreads({ scope: { type: "session", id: "otto-threads" } });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(thread.id);
    expect(link.role).toBe("origin");

    const brief = buildThreadBrief(thread.id);
    expect(brief.text).toContain("Public context");
    expect(brief.text).not.toContain("secret implementation detail");
    expect(brief.omitted.privateEntries).toBe(1);
    expect(brief.entries.map((entry) => entry.kind)).toEqual(["comment"]);
  });

  it("auto-creates a chat-scoped thread on handoff and reuses it on the next send", () => {
    const targetSession = getOrCreateSession("agent:main:whatsapp:group:123", "main", "/tmp/otto-main", {
      name: "main-group",
    });
    const chat = dbUpsertChat({
      channel: "whatsapp",
      instanceId: "main",
      platformChatId: "123@g.us",
      chatType: "group",
      title: "Otto Threads",
      seenAt: 1000,
    });
    dbBindSessionToChat({
      sessionKey: targetSession.sessionKey,
      chatId: chat.id,
      agentId: "main",
      bindingReason: "test",
      seenAt: 1000,
    });

    const created = prepareThreadHandoff({
      threadRef: "handoff-spec",
      prompt: "Implement the first cut.",
      targetSession,
      sourceSessionKey: "otto-threads",
      sourceSessionName: "otto-threads",
      create: {
        title: "Handoff Spec",
        summary: "Initial scope",
      },
      now: 2000,
    });

    expect(created.createdThread).toBe(true);
    expect(created.thread.scopeType).toBe("chat");
    expect(created.thread.scopeId).toBe(chat.id);
    expect(created.handoff.status).toBe("queued");
    expect(created.promptMetadata.brief.includedEntryIds).toContain(created.entry.id);
    expect(created.brief.text).toContain("Implement the first cut.");
    expect(
      listThreadLinks(created.thread.id)
        .map((link) => link.role)
        .sort(),
    ).toEqual(["assignee", "origin", "worker"]);

    const delivered = markThreadHandoffDelivered(created.handoff.id, 2100);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).toBe(2100);

    const reused = prepareThreadHandoff({
      threadRef: "handoff-spec",
      prompt: "Second comment should reuse the thread.",
      targetSession,
      sourceSessionKey: "otto-threads",
      now: 2200,
    });

    expect(reused.createdThread).toBe(false);
    expect(reused.thread.id).toBe(created.thread.id);
    expect(listThreadEntries(created.thread.id, { order: "asc" }).map((entry) => entry.body)).toEqual([
      "Implement the first cut.",
      "Second comment should reuse the thread.",
    ]);
  });

  it("requires an explicit title when sessions send would create a new thread", () => {
    const targetSession = getOrCreateSession("agent:main:test", "main", "/tmp/otto-main", { name: "main-test" });

    expect(() =>
      prepareThreadHandoff({
        threadRef: "missing-title",
        prompt: "This should not create a title implicitly.",
        targetSession,
      }),
    ).toThrow("Missing --thread-title");
  });
});
