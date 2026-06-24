import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { formatOmniGroupMembersForPrompt, resolveOmniGroupMetadata } from "./group-metadata-cache.js";

let stateDir: string | null = null;
const originalFetch = globalThis.fetch;
const fetchCalls: string[] = [];

describe("Omni group metadata cache", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-omni-group-cache-");
    fetchCalls.length = 0;
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      const isTargetOmniCall = url.startsWith("http://omni.local/");
      if (isTargetOmniCall) {
        fetchCalls.push(url);
      }

      if (isTargetOmniCall && url.includes("/api/v2/chats?")) {
        return Response.json({
          items: [
            {
              id: "chat-uuid",
              instanceId: "instance-1",
              externalId: "120363424772797713@g.us",
              chatType: "group",
              channel: "whatsapp-baileys",
              name: "otto - dev",
              description: "dev group",
              avatarUrl: "https://example.test/avatar.jpg",
              participantCount: 2,
              settings: { disappearing: "off" },
              platformMetadata: { source: "test" },
            },
          ],
          meta: { hasMore: false },
        });
      }

      if (isTargetOmniCall && url.includes("/api/v2/chats/chat-uuid/participants")) {
        return Response.json({
          items: [
            {
              id: "participant-1",
              platformUserId: "5511999999999",
              displayName: "Pedro Neri",
              role: "admin",
            },
            {
              id: "participant-2",
              platformUserId: "63295117615153",
              displayName: "R M",
              role: "member",
            },
            {
              id: "participant-3",
              platformUserId: "278507271802901",
              name: "-",
              role: "-",
            },
          ],
        });
      }

      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("resolves chat metadata and participants from Omni, then serves the cache locally", async () => {
    const first = await resolveOmniGroupMetadata({
      omniApiUrl: "http://omni.local",
      omniApiKey: "test-key",
      accountId: "main",
      instanceId: "instance-1",
      chatId: "120363424772797713@g.us",
      channel: "whatsapp-baileys",
      fallbackName: "otto - dev",
    });

    expect(first).toMatchObject({
      chatUuid: "chat-uuid",
      externalId: "120363424772797713@g.us",
      name: "otto - dev",
      participantCount: 2,
    });
    expect(first?.participants).toHaveLength(3);
    expect(formatOmniGroupMembersForPrompt(first)).toEqual(["Pedro Neri (admin)", "R M", "278507271802901"]);
    expect(fetchCalls).toHaveLength(2);

    const second = await resolveOmniGroupMetadata({
      omniApiUrl: "http://omni.local",
      omniApiKey: "test-key",
      accountId: "main",
      instanceId: "instance-1",
      chatId: "120363424772797713@g.us",
    });

    expect(second?.participants).toHaveLength(3);
    expect(fetchCalls).toHaveLength(2);
  });
});
