import { RetentionPolicy, type JetStreamManager } from "nats";
import { getNats } from "../nats.js";
import { logger } from "../utils/logger.js";

const log = logger.child("events:audit-stream");

export const OTTO_EVENTS_STREAM = "OTTO_EVENTS";

export const OTTO_EVENTS_SUBJECTS = [
  "otto.session.*.response",
  "otto.session.*.runtime",
  "otto.session.*.claude",
  "otto.session.*.tool",
  "otto.session.*.stream",
  "otto.session.*.delivery",
  "otto.session.*.adapter.>",
  "otto.session.abort",
  "otto.session.reset.requested",
  "otto.session.reset.completed",
  "otto.session.delete.requested",
  "otto.session.delete.completed",
  "otto.session.model.changed",
  "otto.session.runtime.control",
  "otto.approval.>",
  "otto.audit.>",
  "otto.inbound.>",
  "otto.outbound.>",
  "otto.media.send",
  "otto.stickers.send",
  "otto.contacts.>",
  "otto.instances.>",
  "otto.whatsapp.>",
  "otto.channel.>",
  "otto.channels.>",
  "otto.config.changed",
  "otto.triggers.>",
  "otto.cron.>",
  "otto.heartbeat.>",
  "otto._cli.cli.>",
] as const;

const MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000; // 7 days
const MAX_BYTES = 512 * 1024 * 1024; // bounded replay history, not archival storage

function sorted(value: readonly string[]): string[] {
  return [...value].sort();
}

function sameSubjects(current: readonly string[] | undefined, expected: readonly string[]): boolean {
  return JSON.stringify(sorted(current ?? [])) === JSON.stringify(sorted(expected));
}

export async function ensureOttoEventsStream(jsm?: JetStreamManager): Promise<void> {
  const manager = jsm ?? (await getNats().jetstreamManager());

  try {
    const info = await manager.streams.info(OTTO_EVENTS_STREAM);
    if (sameSubjects(info.config.subjects, OTTO_EVENTS_SUBJECTS)) {
      log.debug("OTTO_EVENTS stream already exists");
      return;
    }

    await manager.streams.update(OTTO_EVENTS_STREAM, {
      ...info.config,
      subjects: [...OTTO_EVENTS_SUBJECTS],
      description: "Otto internal audit/replay events for session debugging",
      max_age: MAX_AGE_NS,
      max_bytes: MAX_BYTES,
      num_replicas: 1,
    });
    log.info("Updated OTTO_EVENTS stream subjects", {
      subjects: OTTO_EVENTS_SUBJECTS,
    });
    return;
  } catch {
    // Stream does not exist yet.
  }

  await manager.streams.add({
    name: OTTO_EVENTS_STREAM,
    description: "Otto internal audit/replay events for session debugging",
    subjects: [...OTTO_EVENTS_SUBJECTS],
    retention: RetentionPolicy.Limits,
    storage: "file" as never,
    max_age: MAX_AGE_NS,
    max_bytes: MAX_BYTES,
    num_replicas: 1,
  });

  log.info("Created OTTO_EVENTS JetStream stream", {
    subjects: OTTO_EVENTS_SUBJECTS,
    retention: "limits",
    storage: "file",
    max_age_days: 7,
    max_bytes: MAX_BYTES,
  });
}
