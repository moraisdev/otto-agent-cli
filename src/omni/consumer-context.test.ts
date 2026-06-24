import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import type { RuntimeAbortProvenance } from "../runtime/session-dispatcher.js";
import type { MessageMetadata } from "../router/router-db.js";

const actualRouterDbModule = await import("../router/router-db.js");
const actualRouterSessionsModule = await import("../router/sessions.js");
const actualChatDbModule = await import("../db.js");
const actualDbSaveMessageMeta = actualRouterDbModule.dbSaveMessageMeta;
const actualDbGetMessageMeta = actualRouterDbModule.dbGetMessageMeta;
const actualDbUpsertChat = actualRouterDbModule.dbUpsertChat;
const actualDbUpsertChatMessage = actualRouterDbModule.dbUpsertChatMessage;
const actualDbUpsertChatParticipant = actualRouterDbModule.dbUpsertChatParticipant;
const actualDbBindSessionToChat = actualRouterDbModule.dbBindSessionToChat;
const actualDbUpsertSessionParticipant = actualRouterDbModule.dbUpsertSessionParticipant;
const actualGetOrCreateSession = actualRouterSessionsModule.getOrCreateSession;
const actualGetSession = actualRouterSessionsModule.getSession;
const actualUpdateProviderSession = actualRouterSessionsModule.updateProviderSession;

const promptCalls: Array<[string, Record<string, unknown>]> = [];
const chatMessageCalls: Array<Parameters<typeof actualDbUpsertChatMessage>[0]> = [];
const chatParticipantCalls: Array<Parameters<typeof actualDbUpsertChatParticipant>[0]> = [];
const sessionParticipantCalls: Array<Parameters<typeof actualDbUpsertSessionParticipant>[0]> = [];
const messageMetaSaveCalls: Array<[string, string, Record<string, unknown>]> = [];
const agentPlatformIdentityCalls: Array<Record<string, unknown>> = [];
const ensureContactFromInboundCalls: Array<Record<string, unknown>> = [];
const platformIdentityByUser = new Map<string, Record<string, unknown>>();
const contactByRef = new Map<string, Record<string, unknown>>();
const messageMetaById = new Map<string, MessageMetadata>();
const recordInboundCalls: string[] = [];
let stateDir: string | null = null;
let agentCwd = "/tmp/otto-agent";
let contactIntakeMode: "off" | "discovered" | "pending" = "off";
let routeResult: Record<string, unknown> | null = null;

function defaultRouteResult(): Record<string, unknown> {
  return {
    sessionKey: "agent:main:whatsapp:main:group:120363424772797713",
    sessionName: "dev",
    dmScope: "main",
    route: { pattern: "group:120363424772797713", priority: 0, session: "dev" },
    agent: {
      id: "main",
      cwd: agentCwd,
      mode: "active",
    },
  };
}

mock.module("../nats.js", () => ({
  getNats: () => {
    throw new Error("not used in this test");
  },
  publish: mock(async () => {}),
  nats: {
    emit: mock(async () => {}),
    subscribe: async function* () {},
  },
}));

mock.module("./session-stream.js", () => ({
  publishSessionPrompt: mock(async (sessionName: string, payload: Record<string, unknown>) => {
    // Always-on fusion bootstraps a read-only peer companion on first use, which
    // publishes a one-time brief to the companion session. These context tests
    // assert on the inbound (lead) prompt only, so ignore companion publishes.
    if (sessionName.startsWith("agent:peer-companion-")) return;
    promptCalls.push([sessionName, payload]);
  }),
}));

mock.module("../slash/index.js", () => ({
  handleSlashCommand: mock(async () => false),
}));

mock.module("../router/index.js", () => ({
  expandHome: (cwd: string) => cwd,
  resolveRoute: () => routeResult,
}));

mock.module("../config-store.js", () => ({
  configStore: {
    getConfig: () => ({
      instanceToAccount: { "instance-1": "main" },
      instances: {
        main: {
          name: "main",
          agent: "main",
          enabled: true,
          groupPolicy: "open",
          dmPolicy: "open",
          contactIntakeMode,
        },
      },
      routes: [],
      agents: {},
      defaultAgent: "main",
      defaultDmScope: "main",
      accountAgents: {},
      ignoredOmniInstanceIds: [],
    }),
  },
}));

mock.module("../contacts.js", () => ({
  isContactAllowedForAgent: () => true,
  saveAccountPending: () => false,
  recordInbound: mock((contactRef: string) => {
    recordInboundCalls.push(contactRef);
  }),
  ensureContactFromInbound: mock((input: Record<string, unknown>) => {
    ensureContactFromInboundCalls.push(input);
    return {
      contact: {
        id: "contact_auto",
        phone: input.contactIdentity,
        name: input.displayName ?? null,
        status: input.intakeMode ?? "pending",
      },
      policy: {
        contactId: "contact_auto",
        status: input.intakeMode ?? "pending",
      },
      platformIdentity: {
        id: "pi_auto",
        ownerType: "contact",
        ownerId: "contact_auto",
        channel: input.channel,
        instanceId: input.instanceId,
        platformUserId: input.platformSenderId,
        normalizedPlatformUserId: input.contactIdentity,
        confidence: 1,
      },
      createdContact: true,
      createdPlatformIdentity: true,
      eventIds: [],
    };
  }),
  resolvePlatformIdentity: (input: { platformUserId: string }) =>
    platformIdentityByUser.get(input.platformUserId) ?? null,
  upsertAgentPlatformIdentity: mock((input: Record<string, unknown>) => {
    agentPlatformIdentityCalls.push(input);
    return {
      id: "pi_agent_connected",
      ownerType: "agent",
      ownerId: input.agentId,
      channel: input.channel,
      instanceId: input.instanceId,
      platformUserId: input.platformUserId,
      normalizedPlatformUserId: input.platformUserId,
      confidence: 1,
    };
  }),
  getContact: (identity: string) => contactByRef.get(identity) ?? { status: "allowed" },
  getContactName: (identity: string) => {
    if (identity === "group:120363424772797713") return "Otto - Dev";
    if (identity === "5511999999999") return "Pedro";
    return null;
  },
}));

mock.module("../router/router-db.js", () => ({
  ...actualRouterDbModule,
  dbSaveMessageMeta: mock((messageId: string, chatId: string, opts: Record<string, unknown>) => {
    messageMetaSaveCalls.push([messageId, chatId, opts]);
    return actualDbSaveMessageMeta(messageId, chatId, opts);
  }),
  dbGetMessageMeta: mock((messageId: string) => messageMetaById.get(messageId) ?? actualDbGetMessageMeta(messageId)),
  dbUpsertChat: mock((input: Parameters<typeof actualDbUpsertChat>[0]) => actualDbUpsertChat(input)),
  dbUpsertChatMessage: mock((input: Parameters<typeof actualDbUpsertChatMessage>[0]) => {
    chatMessageCalls.push(input);
    return actualDbUpsertChatMessage(input);
  }),
  dbUpsertChatParticipant: mock((input: Parameters<typeof actualDbUpsertChatParticipant>[0]) => {
    chatParticipantCalls.push(input);
    return actualDbUpsertChatParticipant(input);
  }),
  dbBindSessionToChat: mock((input: Parameters<typeof actualDbBindSessionToChat>[0]) =>
    actualDbBindSessionToChat(input),
  ),
  dbUpsertSessionParticipant: mock((input: Parameters<typeof actualDbUpsertSessionParticipant>[0]) => {
    sessionParticipantCalls.push(input);
    return actualDbUpsertSessionParticipant(input);
  }),
}));

mock.module("../session-trace/channel-trace.js", () => ({
  recordChannelMessageReceivedTrace: mock(() => ({})),
  recordRouteResolvedTrace: mock(() => ({})),
}));

mock.module("../session-trace/runtime-trace.js", () => ({
  recordRuntimeTraceEvent: mock(() => ({})),
}));

mock.module("../utils/media.js", () => ({
  fetchOmniMedia: mock(async () => null),
  saveToAgentAttachments: mock(async () => null),
  MAX_AUDIO_BYTES: 16 * 1024 * 1024,
}));

mock.module("../transcribe/openai.js", () => ({
  transcribeAudio: mock(async () => ""),
}));

const loggerChildSpy = spyOn(logger, "child").mockImplementation(
  () =>
    ({
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    }) as never,
);

const { OmniConsumer } = await import("./consumer.js");

afterAll(() => {
  loggerChildSpy.mockRestore();
  mock.restore();
});

describe("OmniConsumer channel context", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-omni-consumer-context-");
    agentCwd = join(stateDir, "agent");
    routeResult = defaultRouteResult();
    contactIntakeMode = "off";
    actualGetOrCreateSession("agent:main:whatsapp:main:group:120363424772797713", "main", agentCwd);
    promptCalls.length = 0;
    chatMessageCalls.length = 0;
    chatParticipantCalls.length = 0;
    sessionParticipantCalls.length = 0;
    messageMetaSaveCalls.length = 0;
    agentPlatformIdentityCalls.length = 0;
    ensureContactFromInboundCalls.length = 0;
    platformIdentityByUser.clear();
    contactByRef.clear();
    messageMetaById.clear();
    recordInboundCalls.length = 0;
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("publishes group and sender metadata from the omni message payload", async () => {
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => ({
        accountId: "main",
        instanceId: "instance-1",
        chatId: "120363424772797713@g.us",
        name: "otto - dev",
        participants: [
          { platformUserId: "5511999999999", displayName: "Pedro Neri", role: "-" },
          { platformUserId: "63295117615153", displayName: "R M", role: "-" },
        ],
        fetchedAt: Date.now(),
      }),
      formatGroupMembers: (metadata) =>
        metadata?.participants?.map((participant) => participant.displayName ?? participant.platformUserId),
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-1",
      type: "message.received",
      payload: {
        externalId: "msg-1",
        chatId: "120363424772797713@g.us",
        from: "178035101794451",
        content: {
          type: "text",
          text: "oi",
        },
        rawPayload: {
          pushName: "Pedro Neri",
          chatName: "otto - dev",
          resolvedSenderPhone: "5511999999999",
          isGroup: true,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(1);
    const [, prompt] = promptCalls[0];
    expect(prompt.context).toMatchObject({
      channelId: "whatsapp-baileys",
      channelName: "WhatsApp",
      accountId: "main",
      instanceId: "instance-1",
      chatId: "120363424772797713@g.us",
      messageId: "msg-1",
      senderId: "178035101794451",
      senderName: "Pedro Neri",
      senderPhone: "5511999999999",
      isGroup: true,
      groupName: "otto - dev",
      groupId: "120363424772797713",
      groupMembers: ["Pedro Neri", "R M"],
    });
  });

  it("stores inbound DM messages and runs contact intake before no-route return", async () => {
    routeResult = null;
    contactIntakeMode = "pending";
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-intake-dm",
      type: "message.received",
      payload: {
        externalId: "msg-intake-dm",
        chatId: "5511999901234@s.whatsapp.net",
        from: "5511999901234@s.whatsapp.net",
        content: {
          type: "text",
          text: "olá, quero orçamento",
        },
        rawPayload: {
          pushName: "Lead Novo",
          resolvedSenderPhone: "5511999901234",
          isGroup: false,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(0);
    expect(ensureContactFromInboundCalls).toHaveLength(1);
    expect(ensureContactFromInboundCalls[0]).toMatchObject({
      channel: "whatsapp",
      instanceId: "instance-1",
      platformSenderId: "5511999901234@s.whatsapp.net",
      contactIdentity: "5511999901234",
      displayName: "Lead Novo",
      chatType: "dm",
      providerMessageId: "msg-intake-dm",
      intakeMode: "pending",
    });
    expect(chatMessageCalls).toHaveLength(1);
    expect(chatMessageCalls[0]).toMatchObject({
      providerMessageId: "msg-intake-dm",
      rawChatId: "5511999901234@s.whatsapp.net",
      rawSenderId: "5511999901234",
      normalizedSenderId: "5511999901234",
      actorType: "contact",
      contactId: "contact_auto",
      platformIdentityId: "pi_auto",
      messageType: "text",
    });
  });

  it("captures history-sync messages without replaying them to runtime", async () => {
    contactIntakeMode = "pending";
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-history-sync-dm",
      type: "message.received",
      payload: {
        externalId: "msg-history-sync-dm",
        chatId: "5511999904321@s.whatsapp.net",
        from: "5511999904321@s.whatsapp.net",
        content: {
          type: "text",
          text: "mensagem antiga importada",
        },
        rawPayload: {
          pushName: "Lead Importado",
          resolvedSenderPhone: "5511999904321",
          isGroup: false,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "history-sync",
      },
      timestamp: Date.now(),
    });

    expect(ensureContactFromInboundCalls).toHaveLength(1);
    expect(chatMessageCalls).toHaveLength(1);
    expect(chatParticipantCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(0);
    expect(sessionParticipantCalls).toHaveLength(0);
    expect(chatMessageCalls[0]).toMatchObject({
      providerMessageId: "msg-history-sync-dm",
      actorType: "contact",
      contactId: "contact_auto",
      platformIdentityId: "pi_auto",
      rawProvenance: {
        ingestMode: "history-sync",
      },
    });
  });

  it("captures old timestamp messages without replaying them to runtime", async () => {
    contactIntakeMode = "pending";
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-old-timestamp-dm",
      type: "message.received",
      payload: {
        externalId: "msg-old-timestamp-dm",
        chatId: "5511999909876@s.whatsapp.net",
        from: "5511999909876@s.whatsapp.net",
        content: {
          type: "text",
          text: "mensagem antiga sem flag",
        },
        rawPayload: {
          pushName: "Lead Antigo",
          resolvedSenderPhone: "5511999909876",
          isGroup: false,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now() - 60_000,
    });

    expect(ensureContactFromInboundCalls).toHaveLength(1);
    expect(chatMessageCalls).toHaveLength(1);
    expect(chatParticipantCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(0);
    expect(sessionParticipantCalls).toHaveLength(0);
    expect(chatMessageCalls[0]).toMatchObject({
      providerMessageId: "msg-old-timestamp-dm",
      actorType: "contact",
      contactId: "contact_auto",
      platformIdentityId: "pi_auto",
      rawProvenance: {
        ingestMode: "realtime",
      },
    });
  });

  it("expands registered Otto commands before building the channel envelope", async () => {
    const commandsDir = join(agentCwd, ".otto", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "restart.md"),
      [
        "---",
        "description: Restart with a reason.",
        "arguments:",
        "  - reason",
        "---",
        'Use `otto daemon restart -m "$reason"`.',
        "",
      ].join("\n"),
    );

    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-command",
      type: "message.received",
      payload: {
        externalId: "msg-command",
        chatId: "120363424772797713@g.us",
        from: "178035101794451",
        content: {
          type: "text",
          text: '#restart "ativar commands"',
        },
        rawPayload: {
          pushName: "Pedro Neri",
          chatName: "otto - dev",
          resolvedSenderPhone: "5511999999999",
          isGroup: true,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(1);
    const [, prompt] = promptCalls[0];
    expect(prompt.prompt).toContain("Pedro Neri:");
    expect(prompt.prompt).toContain("## Otto Command: #restart");
    expect(prompt.prompt).toContain('Use `otto daemon restart -m "ativar commands"`.');
    expect(prompt.commands).toMatchObject([
      {
        id: "restart",
        scope: "agent",
        originalText: '#restart "ativar commands"',
        arguments: '"ativar commands"',
      },
    ]);
  });

  it("resets the runtime session and republishes an Omni message edit as a rebase replay", async () => {
    const sessionKey = "agent:main:whatsapp:main:group:120363424772797713";
    actualUpdateProviderSession(sessionKey, "codex", "provider-before-edit");
    actualChatDbModule.saveMessage("dev", "user", "[WhatsApp Otto - Dev mid:msg-original] Pedro: texto antigo", null, {
      agentId: "main",
      channel: "whatsapp-baileys",
      accountId: "main",
      chatId: "120363424772797713@g.us",
      sourceMessageId: "msg-original",
    });
    actualChatDbModule.saveMessage("dev", "user", "[WhatsApp Otto - Dev mid:msg-secret] Pedro: senha: 132", null, {
      agentId: "main",
      channel: "whatsapp-baileys",
      accountId: "main",
      chatId: "120363424772797713@g.us",
      sourceMessageId: "msg-secret",
    });
    messageMetaById.set("msg-original", {
      messageId: "msg-original",
      chatId: "120363424772797713@g.us",
      canonicalChatId: "chat_otto_dev",
      actorType: "contact",
      contactId: "contact_pedro",
      rawSenderId: "178035101794451",
      normalizedSenderId: "5511999999999",
      createdAt: Date.now(),
    });
    const abortRuntimeSession = mock((_sessionName: string, _provenance: RuntimeAbortProvenance) => true);
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
      abortRuntimeSession,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-edit",
      type: "message.received",
      payload: {
        externalId: "msg-original-edit-1",
        chatId: "120363424772797713@g.us",
        from: "120363424772797713@g.us",
        content: {
          type: "edit",
          text: "texto editado",
        },
        rawPayload: {
          editedMessageId: "msg-original",
          newText: "texto editado",
          editedAt: 1778000000000,
          isGroup: true,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(abortRuntimeSession.mock.calls[0]?.[0]).toBe("dev");
    expect(abortRuntimeSession.mock.calls[0]?.[1]).toMatchObject({
      source: "omni",
      action: "message.edited",
      reason: "message_edited_restart",
      correlationId: "msg-original-edit-1",
      request: {
        messageId: "msg-original",
        editEventId: "msg-original-edit-1",
      },
    });
    expect(actualGetSession(sessionKey)?.sdkSessionId).toBeUndefined();
    expect(actualGetSession(sessionKey)?.runtimeProvider).toBeUndefined();
    expect(promptCalls).toHaveLength(1);
    const [, prompt] = promptCalls[0];
    expect(prompt.prompt).toContain("## Mensagem editada detectada pelo Omni");
    expect(prompt.prompt).toContain("## Runtime session rebase");
    expect(prompt.prompt).toContain("Mensagem original: msg-original");
    expect(prompt.prompt).toContain("[Message edited]\ntexto editado");
    expect(prompt.prompt).toContain("senha: 132");
    expect(prompt.prompt).not.toContain("texto antigo\n</message>");
    expect(prompt._humanUrgent).toBe(true);
    expect(prompt.context).toMatchObject({
      isEditedMessage: true,
      editedMessageId: "msg-original",
      editEventId: "msg-original-edit-1",
      editedAt: 1778000000000,
      actorType: "contact",
      contactId: "contact_pedro",
      rawSenderId: "178035101794451",
      normalizedSenderId: "5511999999999",
    });
  });

  it("resolves an agent-owned platform identity as an agent actor", async () => {
    platformIdentityByUser.set("5511000000000", {
      id: "pi_agent_sender",
      ownerType: "agent",
      ownerId: "dev",
      channel: "whatsapp",
      instanceId: "instance-1",
      platformUserId: "5511000000000@s.whatsapp.net",
      normalizedPlatformUserId: "5511000000000",
      confidence: 1,
    });

    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-agent",
      type: "message.received",
      payload: {
        externalId: "msg-agent",
        chatId: "5511999999999@s.whatsapp.net",
        from: "5511000000000@s.whatsapp.net",
        content: {
          type: "text",
          text: "status",
        },
        rawPayload: {
          pushName: "Otto Dev",
          isGroup: false,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0][1].context).toMatchObject({
      actorType: "agent",
      actorAgentId: "dev",
      platformIdentityId: "pi_agent_sender",
      rawSenderId: "5511000000000",
      normalizedSenderId: "5511000000000",
    });
    expect(chatParticipantCalls[0]).toMatchObject({
      agentId: "dev",
      contactId: null,
      platformIdentityId: "pi_agent_sender",
      role: "agent",
    });
    expect(sessionParticipantCalls[0]).toMatchObject({
      ownerType: "agent",
      ownerId: "dev",
      platformIdentityId: "pi_agent_sender",
      role: "agent",
    });
    expect(messageMetaSaveCalls[0][2]).toMatchObject({
      actorType: "agent",
      agentId: "dev",
      platformIdentityId: "pi_agent_sender",
    });
  });

  it("updates inbound contact interaction when a group sender resolves to a contact", async () => {
    contactByRef.set("contact_pedro", {
      id: "contact_pedro",
      status: "allowed",
      name: "Pedro",
    });
    platformIdentityByUser.set("5511999999999", {
      id: "pi_pedro",
      ownerType: "contact",
      ownerId: "contact_pedro",
      channel: "whatsapp",
      instanceId: "instance-1",
      platformUserId: "5511999999999@s.whatsapp.net",
      normalizedPlatformUserId: "5511999999999",
      confidence: 1,
    });

    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-contact-inbound",
      type: "message.received",
      payload: {
        externalId: "msg-contact-inbound",
        chatId: "120363424772797713@g.us",
        from: "178035101794451",
        content: {
          type: "text",
          text: "oi",
        },
        rawPayload: {
          pushName: "Pedro Neri",
          resolvedSenderPhone: "5511999999999",
          isGroup: true,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(recordInboundCalls).toEqual(["contact_pedro"]);
    expect(messageMetaSaveCalls[0][2]).toMatchObject({
      actorType: "contact",
      contactId: "contact_pedro",
      platformIdentityId: "pi_pedro",
    });
    expect(sessionParticipantCalls[0]).toMatchObject({
      ownerType: "contact",
      ownerId: "contact_pedro",
      platformIdentityId: "pi_pedro",
      role: "human",
    });
  });

  it("registers a connected channel account as an agent platform identity", async () => {
    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key");

    await consumer["handleInstanceEvent"]("instance.connected.whatsapp-baileys.instance-1", {
      id: "evt-connected",
      type: "instance.connected",
      payload: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        profileName: "Otto Dev",
        ownerIdentifier: "5511000000000@s.whatsapp.net",
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
      },
      timestamp: Date.now(),
    });

    expect(agentPlatformIdentityCalls[0]).toMatchObject({
      agentId: "main",
      channel: "whatsapp-baileys",
      instanceId: "instance-1",
      platformUserId: "5511000000000@s.whatsapp.net",
      platformDisplayName: "Otto Dev",
      linkedBy: "auto",
      linkReason: "omni_instance_connected",
    });
  });

  it("includes stored audio transcription when replying to a quoted WhatsApp audio", async () => {
    messageMetaById.set("quoted-audio-1", {
      messageId: "quoted-audio-1",
      chatId: "120363424772797713@g.us",
      transcription: "transcrição completa do áudio citado",
      mediaType: "audio",
      createdAt: Date.now(),
    });

    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-quoted-audio",
      type: "message.received",
      payload: {
        externalId: "reply-1",
        chatId: "120363424772797713@g.us",
        from: "178035101794451",
        content: {
          type: "text",
          text: "ouviu?",
        },
        replyToId: "quoted-audio-1",
        rawPayload: {
          pushName: "Pedro Neri",
          resolvedSenderPhone: "5511999999999",
          isGroup: true,
          message: {
            extendedTextMessage: {
              text: "ouviu?",
              contextInfo: {
                stanzaId: "quoted-audio-1",
                participant: "5511999999999@s.whatsapp.net",
                quotedMessage: {
                  audioMessage: {
                    mimetype: "audio/ogg; codecs=opus",
                  },
                },
              },
            },
          },
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(1);
    const [, prompt] = promptCalls[0];
    expect(prompt.prompt).toContain("[Replying to Pedro mid:quoted-audio-1]");
    expect(prompt.prompt).toContain("[Audio]\nTranscript:\ntranscrição completa do áudio citado");
    expect(prompt.prompt).not.toContain("\n[audio]\n");
  });

  it("uses stored transcription when only normalized replyToId is available", async () => {
    messageMetaById.set("quoted-audio-2", {
      messageId: "quoted-audio-2",
      chatId: "120363424772797713@g.us",
      transcription: "histórico recuperado pelo metadata db",
      mediaType: "audio",
      createdAt: Date.now(),
    });

    const sender = {
      send: mock(async () => {}),
      sendTyping: mock(async () => {}),
      markRead: mock(async () => {}),
    };
    const consumer = new OmniConsumer(sender as never, "http://omni.local", "test-key", {
      resolveGroupMetadata: async () => null,
    });

    await consumer["handleMessageEvent"]("message.received.whatsapp-baileys.instance-1", {
      id: "evt-reply-id-only",
      type: "message.received",
      payload: {
        externalId: "reply-2",
        chatId: "120363424772797713@g.us",
        from: "178035101794451",
        content: {
          type: "text",
          text: "sim",
        },
        replyToId: "quoted-audio-2",
        rawPayload: {
          pushName: "Pedro Neri",
          resolvedSenderPhone: "5511999999999",
          isGroup: true,
        },
      },
      metadata: {
        instanceId: "instance-1",
        channelType: "whatsapp-baileys",
        ingestMode: "realtime",
      },
      timestamp: Date.now(),
    });

    expect(promptCalls).toHaveLength(1);
    const [, prompt] = promptCalls[0];
    expect(prompt.prompt).toContain("[Replying to unknown mid:quoted-audio-2]");
    expect(prompt.prompt).toContain("[Audio]\nTranscript:\nhistórico recuperado pelo metadata db");
  });
});
