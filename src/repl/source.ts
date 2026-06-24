/**
 * The message `source` for prompts published from the `otto code` REPL.
 *
 * The daemon validates every prompt's source with `ContextSourceSchema`
 * (channel/accountId/chatId all `.min(1)`). The terminal has no real channel
 * instance, so we use a synthetic `"cli"` account: `resolveInstanceId("cli")`
 * returns undefined, which routes the gateway into its missing-instance branch
 * and mirrors the reply to any WhatsApp group bound to this session
 * (omnipresence). All three fields are non-empty so the source validates.
 */
export interface ReplSource {
  channel: string;
  accountId: string;
  chatId: string;
}

export function cliSource(sessionName: string): ReplSource {
  return { channel: "cli", accountId: "cli", chatId: sessionName };
}
