const BLOCKED_TRIGGER_TOPIC_PREFIXES = ["otto.session."];

export function isBlockedTriggerTopic(topic: string): boolean {
  return BLOCKED_TRIGGER_TOPIC_PREFIXES.some((prefix) => topic.startsWith(prefix));
}

export function getBlockedTriggerTopicReason(topic: string): string | undefined {
  if (!isBlockedTriggerTopic(topic)) return undefined;
  return `Triggers cannot subscribe to '${topic}' because otto.session.* topics are reserved and skipped by the trigger runner to prevent loops`;
}
