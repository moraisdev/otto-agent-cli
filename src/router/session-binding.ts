/**
 * Bind a WhatsApp group to a project-scoped session (S5: group = session).
 *
 * Reuses the existing route mechanism: a route whose `session` field points at
 * the project session makes inbound group messages land in that exact session
 * (the resolver redirects on `route.session`). So a group the agent created for
 * a project becomes a window into the same session as the terminal `otto code`.
 */

import { dbCreateRoute, dbListRoutesBySessionName } from "./router-db.js";

export function groupRoutePattern(groupId: string): string {
  return groupId.startsWith("group:") ? groupId : `group:${groupId}`;
}

export function bindGroupToProjectSession(input: {
  groupId: string;
  sessionName: string;
  accountId: string;
  agentId: string;
}): void {
  dbCreateRoute({
    pattern: groupRoutePattern(input.groupId),
    accountId: input.accountId,
    agent: input.agentId,
    session: input.sessionName,
  });
}

export interface FanoutTarget {
  accountId: string;
  chatId: string;
  channel: string;
}

/**
 * The group windows bound to a session — for fan-out delivery (S3 omnipresence):
 * a reply to a terminal-driven turn is mirrored to the project's WhatsApp group
 * so you see it from your phone too. `exclude` drops the originating chat so the
 * sender isn't echoed their own turn's destination twice.
 */
export function resolveSessionGroupTargets(
  sessionName: string,
  exclude?: { accountId?: string; chatId?: string },
): FanoutTarget[] {
  const targets: FanoutTarget[] = [];
  for (const route of dbListRoutesBySessionName(sessionName)) {
    if (!route.pattern.startsWith("group:")) continue;
    const chatId = route.pattern.slice("group:".length);
    if (exclude && exclude.accountId === route.accountId && exclude.chatId === chatId) continue;
    targets.push({ accountId: route.accountId, chatId, channel: route.channel ?? "whatsapp" });
  }
  return targets;
}
