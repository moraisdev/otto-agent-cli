/**
 * Build the "recent conversations" list for the `otto --resume` picker.
 *
 * Pure helpers (filtering, labels, relative time) are unit-tested; loadRecentSessions
 * is the thin DB-backed wrapper that the TUI calls.
 */

import { getRecentHistory } from "../../db.js";
import { listSessions } from "../../router/sessions.js";

export interface RecentSession {
  sessionName: string;
  label: string;
  agentId: string;
  preview: string;
  updatedAt: number;
}

/** Keep only real conversations — hide internal/automation sessions. */
export function isUserFacingSession(name: string | undefined): boolean {
  if (!name) return false;
  if (name.includes("-companion-")) return false; // the fusion peer (peer-companion-* / legacy codex-companion-*)
  if (name.startsWith("obs:")) return false; // observer sidecars
  if (name.includes(":cron:") || name.includes(":trigger:")) return false; // automation
  return true;
}

/** Compact relative age: 12s, 5m, 3h, 2d. */
export function formatRelativeTime(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Friendly label for the common session shapes. */
export function sessionLabel(s: { name?: string; sessionKey: string; agentId: string }): string {
  const raw = s.name ?? s.sessionKey;
  if (raw.includes(":whatsapp:group:")) return `whatsapp · grupo (${s.agentId})`;
  if (raw.includes(":dm:")) return `whatsapp · dm (${s.agentId})`;
  if (raw === `agent:${s.agentId}:main` || raw === "main" || raw === s.agentId) return s.agentId;
  return raw; // proj-*, custom names, etc.
}

function previewOf(sessionName: string): string {
  try {
    const last = getRecentHistory(sessionName, 1)[0];
    return last?.content ? last.content.replace(/\s+/g, " ").trim() : "";
  } catch {
    return "";
  }
}

/** Recent user-facing conversations, newest first (listSessions is sorted). */
export function loadRecentSessions(limit = 25): RecentSession[] {
  const out: RecentSession[] = [];
  for (const s of listSessions()) {
    const name = s.name ?? s.sessionKey;
    if (!isUserFacingSession(name)) continue;
    out.push({
      sessionName: name,
      label: sessionLabel(s),
      agentId: s.agentId,
      preview: previewOf(name),
      updatedAt: s.updatedAt,
    });
    if (out.length >= limit) break;
  }
  return out;
}
