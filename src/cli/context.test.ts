import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterAll(() => mock.restore());

const actualRuntimeContextRegistryModule = await import("../runtime/context-registry.js");

let resolvedContext:
  | {
      contextId: string;
      agentId?: string;
      sessionKey?: string;
      sessionName?: string;
      source?: { channel: string; accountId: string; chatId: string };
      capabilities: unknown[];
      kind: string;
      createdAt: number;
    }
  | undefined;

mock.module("../runtime/context-registry.js", () => ({
  ...actualRuntimeContextRegistryModule,
  OTTO_CONTEXT_KEY_ENV: "OTTO_CONTEXT_KEY",
  getRuntimeContextFromEnv: () => resolvedContext,
}));

const { getContext } = await import("./context.js");

describe("cli context resolution", () => {
  const originalEnv = {
    OTTO_CONTEXT_KEY: process.env.OTTO_CONTEXT_KEY,
    OTTO_SESSION_KEY: process.env.OTTO_SESSION_KEY,
    OTTO_SESSION_NAME: process.env.OTTO_SESSION_NAME,
    OTTO_AGENT_ID: process.env.OTTO_AGENT_ID,
    OTTO_CHANNEL: process.env.OTTO_CHANNEL,
    OTTO_ACCOUNT_ID: process.env.OTTO_ACCOUNT_ID,
    OTTO_CHAT_ID: process.env.OTTO_CHAT_ID,
    OTTO_CREDENTIALS_PATH: process.env.OTTO_CREDENTIALS_PATH,
  };

  beforeEach(() => {
    resolvedContext = undefined;
    delete process.env.OTTO_CONTEXT_KEY;
    delete process.env.OTTO_SESSION_KEY;
    delete process.env.OTTO_SESSION_NAME;
    delete process.env.OTTO_AGENT_ID;
    delete process.env.OTTO_CHANNEL;
    delete process.env.OTTO_ACCOUNT_ID;
    delete process.env.OTTO_CHAT_ID;
    process.env.OTTO_CREDENTIALS_PATH = join(tmpdir(), `otto-cli-context-test-missing-${process.pid}.json`);
  });

  afterEach(() => {
    restoreEnv("OTTO_CONTEXT_KEY", originalEnv.OTTO_CONTEXT_KEY);
    restoreEnv("OTTO_SESSION_KEY", originalEnv.OTTO_SESSION_KEY);
    restoreEnv("OTTO_SESSION_NAME", originalEnv.OTTO_SESSION_NAME);
    restoreEnv("OTTO_AGENT_ID", originalEnv.OTTO_AGENT_ID);
    restoreEnv("OTTO_CHANNEL", originalEnv.OTTO_CHANNEL);
    restoreEnv("OTTO_ACCOUNT_ID", originalEnv.OTTO_ACCOUNT_ID);
    restoreEnv("OTTO_CHAT_ID", originalEnv.OTTO_CHAT_ID);
    restoreEnv("OTTO_CREDENTIALS_PATH", originalEnv.OTTO_CREDENTIALS_PATH);
  });

  it("prefers resolved runtime context when OTTO_CONTEXT_KEY is present", () => {
    process.env.OTTO_CONTEXT_KEY = "rctx_123";
    resolvedContext = {
      contextId: "ctx_123",
      kind: "agent-runtime",
      agentId: "dev",
      sessionKey: "agent:dev:main",
      sessionName: "dev-main",
      source: { channel: "whatsapp", accountId: "main", chatId: "5511999999999" },
      capabilities: [],
      createdAt: 1000,
    };

    const ctx = getContext();
    expect(ctx).toMatchObject({
      contextId: "ctx_123",
      agentId: "dev",
      sessionKey: "agent:dev:main",
      sessionName: "dev-main",
      source: { channel: "whatsapp", accountId: "main", chatId: "5511999999999" },
    });
  });

  it("falls back to legacy OTTO_* env vars when no runtime context is available", () => {
    process.env.OTTO_SESSION_KEY = "agent:main:main";
    process.env.OTTO_SESSION_NAME = "main";
    process.env.OTTO_AGENT_ID = "main";
    process.env.OTTO_CHANNEL = "whatsapp";
    process.env.OTTO_ACCOUNT_ID = "main";
    process.env.OTTO_CHAT_ID = "5511888888888";

    const ctx = getContext();
    expect(ctx).toMatchObject({
      sessionKey: "agent:main:main",
      sessionName: "main",
      agentId: "main",
      source: { channel: "whatsapp", accountId: "main", chatId: "5511888888888" },
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
