import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { closeContacts, getContact, upsertContact } from "./contacts.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "./test/otto-state.js";

let stateDir: string | null = null;

setDefaultTimeout(20_000);

beforeEach(async () => {
  stateDir = await createIsolatedOttoState("otto-contacts-state-test-");
});

afterEach(async () => {
  closeContacts();
  await cleanupIsolatedOttoState(stateDir);
  stateDir = null;
});

describe("contacts state dir", () => {
  it("uses the active OTTO_STATE_DIR even when the module was imported before test setup", () => {
    upsertContact("5511999999999", "Alice");

    expect(getContact("5511999999999")?.name).toBe("Alice");

    const chatDb = new Database(join(stateDir!, "chat.db"));
    const row = chatDb.prepare("SELECT display_name AS name FROM contacts WHERE display_name = ?").get("Alice") as {
      name: string;
    } | null;
    chatDb.close();

    expect(row?.name).toBe("Alice");
  });
});
