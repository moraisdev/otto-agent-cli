import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// Isolated in-memory relations store. We mock only the storage layer
// (router-db's getDb) so the real REBAC engine (`can`, `hasRelation`,
// `isSuperadmin`) runs unmodified against populated relations.
let db: Database;

function freshDb(): Database {
  const d = new Database(":memory:");
  d.run(`
    CREATE TABLE relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      UNIQUE(subject_type, subject_id, relation, object_type, object_id)
    );
  `);
  return d;
}

const actualRouterDb = await import("../router/router-db.js");
mock.module("../router/router-db.js", () => ({
  ...actualRouterDb,
  getDb: () => db,
  dbListAgents: () => [],
}));

// Tool registry is pulled in transitively by the engine; stub the only
// symbol it uses so the import graph resolves without a real registry.
mock.module("../cli/tool-registry.js", () => ({
  resolveToolGroup: () => undefined,
}));

// CLI context is consulted by the engine's scope helpers; default to none.
mock.module("../cli/context.js", () => ({
  getContext: () => undefined,
}));

const { isSenderAdmin } = await import("./admin-gate.js");
const { grantRelation } = await import("../permissions/relations.js");

describe("isSenderAdmin", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("returns true for a subject with admin over system:*", () => {
    grantRelation("agent", "main", "admin", "system", "*");
    expect(isSenderAdmin("agent:main")).toBe(true);
  });

  it("accepts a bare id, defaulting to agent type", () => {
    grantRelation("agent", "boss", "admin", "system", "*");
    expect(isSenderAdmin("boss")).toBe(true);
  });

  it("returns false for an ordinary subject without admin", () => {
    grantRelation("agent", "pm", "execute", "executable", "clickup");
    expect(isSenderAdmin("agent:pm")).toBe(false);
  });

  it("returns false for an unknown subject", () => {
    expect(isSenderAdmin("agent:ghost")).toBe(false);
  });
});
