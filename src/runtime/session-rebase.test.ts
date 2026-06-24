import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { saveMessage } from "../db.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import {
  actorMetadataFromMessageMetadata,
  buildRuntimeMessageEditRebasePlan,
  renderRuntimeMessageEditRebasePrompt,
} from "./session-rebase.js";

let stateDir: string | null = null;

describe("runtime session rebase", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-runtime-session-rebase-");
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("builds a reset replay plan that replaces the edited message and preserves later user messages", () => {
    saveMessage("dev", "user", "[WhatsApp group mid:msg-prefix] Pedro: antes", "provider-1", {
      agentId: "dev",
      chatId: "chat-1",
      sourceMessageId: "msg-prefix",
    });
    saveMessage("dev", "assistant", "ok antes", "provider-1", {
      agentId: "dev",
      chatId: "chat-1",
      sourceMessageId: "msg-prefix",
    });
    saveMessage("dev", "user", "[WhatsApp group mid:msg-original] Pedro: texto antigo", "provider-1", {
      agentId: "dev",
      chatId: "chat-1",
      sourceMessageId: "msg-original",
    });
    saveMessage(
      "dev",
      "user",
      [
        "## Mensagem editada detectada pelo Omni",
        "",
        "## Runtime session rebase",
        "",
        "<runtime_rebase_transcript>",
        "texto editado velho",
        "</runtime_rebase_transcript>",
      ].join("\n"),
      "provider-1",
      {
        agentId: "dev",
        chatId: "chat-1",
        sourceMessageId: "msg-original-edit-old",
      },
    );
    saveMessage("dev", "user", "[WhatsApp group mid:msg-secret] Pedro: senha: 132", "provider-1", {
      agentId: "dev",
      chatId: "chat-1",
      sourceMessageId: "msg-secret",
    });
    saveMessage("dev", "assistant", "resposta invalida depois do original", "provider-1", {
      agentId: "dev",
      chatId: "chat-1",
      sourceMessageId: "msg-secret",
    });

    const plan = buildRuntimeMessageEditRebasePlan({
      sessionName: "dev",
      sessionKey: "agent:dev:whatsapp:main:group:chat-1",
      agentId: "dev",
      chatId: "chat-1",
      editedMessageId: "msg-original",
      editEventId: "msg-original-edit-1",
      editedPrompt: "[WhatsApp group mid:msg-original-edit-1] Pedro: [Message edited]\ntexto novo",
    });

    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.originalMessage.source_message_id).toBe("msg-original");
    expect(plan.prefixMessages.map((message) => message.source_message_id)).toEqual(["msg-prefix", "msg-prefix"]);
    expect(plan.suffixMessages.map((message) => message.source_message_id)).toEqual(["msg-secret"]);

    const prompt = renderRuntimeMessageEditRebasePrompt({
      restartNotice: "## Mensagem editada detectada pelo Omni",
      plan,
    });
    expect(prompt).toContain("## Runtime session rebase");
    expect(prompt).toContain("texto novo");
    expect(prompt).toContain("senha: 132");
    expect(prompt).not.toContain("texto editado velho");
    expect(prompt).not.toContain("texto antigo\n</message>");
    expect(prompt).not.toContain("resposta invalida depois do original");
  });

  it("fails closed when the edited source message cannot be found", () => {
    const plan = buildRuntimeMessageEditRebasePlan({
      sessionName: "dev",
      agentId: "dev",
      chatId: "chat-1",
      editedMessageId: "missing",
      editEventId: "missing-edit",
      editedPrompt: "texto editado",
    });

    expect(plan).toMatchObject({
      status: "unavailable",
      reason: "original_message_not_found",
      degradation: "unavailable",
    });
    expect(renderRuntimeMessageEditRebasePrompt({ restartNotice: "", plan })).toContain("Nao foi possivel reconstruir");
  });

  it("falls back to the chat scope when historical rows have a different agent id", () => {
    saveMessage("dev", "user", "[WhatsApp group mid:msg-original] Pedro: texto antigo", "provider-1", {
      agentId: "legacy-agent",
      chatId: "chat-1",
      sourceMessageId: "msg-original",
    });

    const plan = buildRuntimeMessageEditRebasePlan({
      sessionName: "dev",
      agentId: "current-agent",
      chatId: "chat-1",
      editedMessageId: "msg-original",
      editEventId: "msg-original-edit-1",
      editedPrompt: "[WhatsApp group mid:msg-original-edit-1] Pedro: texto novo",
    });

    expect(plan.status).toBe("ready");
  });

  it("maps message metadata into actor metadata for edited messages", () => {
    const actor = actorMetadataFromMessageMetadata({
      messageId: "msg-original",
      chatId: "chat-1",
      canonicalChatId: "chat-canonical",
      actorType: "contact",
      contactId: "contact-pedro",
      rawSenderId: "178035101794451",
      normalizedSenderId: "5511999999999",
      createdAt: Date.now(),
    });

    expect(actor).toMatchObject({
      canonicalChatId: "chat-canonical",
      actorType: "contact",
      contactId: "contact-pedro",
      rawSenderId: "178035101794451",
      normalizedSenderId: "5511999999999",
    });
  });
});
