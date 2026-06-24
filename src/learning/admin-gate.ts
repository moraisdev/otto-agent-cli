import { can } from "../permissions/engine.js";

/**
 * Resolve whether a subject has admin privilege via the real REBAC store.
 *
 * Semantics: a subject is "admin" iff it holds the `admin` relation over
 * `system:*` — the exact tuple checked by `otto permissions check
 * <subject> admin system:*` and seeded for the `main` agent in
 * `syncRelationsFromConfig`. This is the same check that gates superadmins.
 *
 * Subject formats accepted:
 *   - "agent:main"  → ("agent", "main")
 *   - "main"        → defaults to ("agent", "main")
 *
 * No new REBAC logic is implemented here; this delegates to
 * `can()` from the permissions engine.
 */
export function isSenderAdmin(subject: string): boolean {
  const { type, id } = parseSubject(subject);
  return can(type, id, "admin", "system", "*");
}

function parseSubject(subject: string): { type: string; id: string } {
  const idx = subject.indexOf(":");
  if (idx === -1) return { type: "agent", id: subject };
  return { type: subject.slice(0, idx), id: subject.slice(idx + 1) };
}
