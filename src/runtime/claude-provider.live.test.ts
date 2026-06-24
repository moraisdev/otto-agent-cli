import { createClaudeRuntimeProvider } from "./claude-provider.js";
import { registerLiveProviderSuite } from "./live-test-helpers.js";

const liveEnabled = process.env.OTTO_LIVE_TESTS === "1";
const hasClaudeAuth = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);

registerLiveProviderSuite({
  providerId: "claude",
  enabled: liveEnabled && hasClaudeAuth,
  model: process.env.OTTO_LIVE_CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? "haiku",
  createProvider: () => createClaudeRuntimeProvider(),
});
