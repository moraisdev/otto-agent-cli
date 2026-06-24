import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { buildClaudeCodeEnvironment, resolveClaudeCodeExecutable } from "../runtime/claude-provider.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface OneShotRunPromptOptions {
  model?: string;
  timeoutMs?: number;
}

/**
 * Build a minimal single-turn `runPrompt` backed by the Claude Agent SDK.
 *
 * Runs an isolated, tool-less query (no MCP, no hooks, no plugins) and returns
 * the concatenated assistant text. Uses the same SDK import, environment, and
 * executable resolution as the heavy runtime provider, so it inherits the
 * daemon's auth (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY) without spinning
 * up a full session. Throws on timeout or SDK error — callers such as
 * `createProviderClassifier` degrade to [] on throw.
 */
export function createOneShotRunPrompt(options: OneShotRunPromptOptions = {}): (prompt: string) => Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (prompt: string): Promise<string> => {
    const env = buildClaudeCodeEnvironment();
    const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable(env);
    const abortController = new AbortController();

    const queryOptions: Options = {
      ...(options.model ? { model: options.model } : {}),
      abortController,
      env,
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      settingSources: [],
    };

    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const result = query({ prompt, options: queryOptions });
      let text = "";

      for await (const message of result as AsyncIterable<any>) {
        if (message.type === "assistant") {
          const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
          for (const block of blocks) {
            if (block?.type === "text" && typeof block.text === "string") {
              text += block.text;
            }
          }
        }
      }

      return text;
    } finally {
      clearTimeout(timer);
    }
  };
}
