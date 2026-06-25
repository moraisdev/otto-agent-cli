import { describe, expect, it } from "bun:test";
import {
  formatPhone,
  isGroup,
  isLid,
  isPhoneNumber,
  jidToSessionId,
  normalizePhone,
  parseJid,
  phoneToJid,
  sessionIdToPhone,
} from "./phone.js";

describe("parseJid", () => {
  it("parses a plain user JID", () => {
    expect(parseJid("5511999999999@s.whatsapp.net")).toEqual({
      user: "5511999999999",
      server: "s.whatsapp.net",
      device: undefined,
      isLid: false,
      isGroup: false,
    });
  });

  it("parses a user JID with a device suffix", () => {
    expect(parseJid("5511999999999:12@s.whatsapp.net")).toMatchObject({
      user: "5511999999999",
      device: 12,
    });
  });

  it("parses LID and group JIDs", () => {
    expect(parseJid("12345@lid")).toMatchObject({ user: "12345", isLid: true });
    expect(parseJid("120363000000000000@g.us")).toMatchObject({ user: "120363000000000000", isGroup: true });
    expect(parseJid("5511999999999-1600000000@g.us")).toMatchObject({ user: "5511999999999-1600000000", isGroup: true });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseJid("  12345@lid  ")).toMatchObject({ user: "12345", isLid: true });
  });

  it("returns null for non-JID input", () => {
    expect(parseJid("not-a-jid")).toBeNull();
    expect(parseJid("5511999999999")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("strips formatting from raw phone numbers", () => {
    expect(normalizePhone("+55 (11) 99999-9999")).toBe("5511999999999");
  });

  it("normalizes JIDs to bare identifiers", () => {
    expect(normalizePhone("5511999999999@s.whatsapp.net")).toBe("5511999999999");
    expect(normalizePhone("12345@lid")).toBe("lid:12345");
    expect(normalizePhone("120363000000000000@g.us")).toBe("group:120363000000000000");
  });

  it("preserves explicit lid: and group: prefixes", () => {
    expect(normalizePhone("lid:12345")).toBe("lid:12345");
    expect(normalizePhone("group:120363000000000000")).toBe("group:120363000000000000");
  });
});

describe("phoneToJid", () => {
  it("builds JIDs for phones, lids, and groups", () => {
    expect(phoneToJid("+55 11 99999-9999")).toBe("5511999999999@s.whatsapp.net");
    expect(phoneToJid("lid:12345")).toBe("12345@lid");
    expect(phoneToJid("group:120363000000000000")).toBe("120363000000000000@g.us");
  });

  it("returns null when there is no usable number", () => {
    expect(phoneToJid("()")).toBeNull();
    expect(phoneToJid("---")).toBeNull();
  });
});

describe("session id round-trip", () => {
  it("maps phones, lids, and groups to session ids and back", () => {
    expect(jidToSessionId("5511999999999@s.whatsapp.net")).toBe("wa-5511999999999");
    expect(jidToSessionId("12345@lid")).toBe("wa-lid-12345");
    expect(jidToSessionId("120363000000000000@g.us")).toBe("wa-group-120363000000000000");

    expect(sessionIdToPhone("wa-5511999999999")).toBe("5511999999999");
    expect(sessionIdToPhone("wa-lid-12345")).toBe("lid:12345");
    expect(sessionIdToPhone("wa-group-120363000000000000")).toBe("group:120363000000000000");
  });

  it("returns null for non-wa session ids", () => {
    expect(sessionIdToPhone("tg-12345")).toBeNull();
  });
});

describe("isGroup / isLid", () => {
  it("detects group identifiers", () => {
    expect(isGroup("120363000000000000@g.us")).toBe(true);
    expect(isGroup("group:120363000000000000")).toBe(true);
    expect(isGroup("5511999999999@s.whatsapp.net")).toBe(false);
  });

  it("detects lid identifiers", () => {
    expect(isLid("12345@lid")).toBe(true);
    expect(isLid("lid:12345")).toBe(true);
    expect(isLid("5511999999999@s.whatsapp.net")).toBe(false);
  });
});

describe("isPhoneNumber", () => {
  it("accepts numbers with common formatting", () => {
    expect(isPhoneNumber("+55 (11) 99999-9999")).toBe(true);
    expect(isPhoneNumber("5511999999999")).toBe(true);
    expect(isPhoneNumber("11 99999-9999")).toBe(true);
  });

  it("rejects punctuation-only strings that carry no digits", () => {
    // Regression: these used to pass even though they normalize to "" and
    // phoneToJid() returns null for them.
    expect(isPhoneNumber("()")).toBe(false);
    expect(isPhoneNumber("- - -")).toBe(false);
    expect(isPhoneNumber("+")).toBe(false);
    expect(isPhoneNumber("")).toBe(false);
  });

  it("rejects strings with non-phone characters", () => {
    expect(isPhoneNumber("lid:12345")).toBe(false);
    expect(isPhoneNumber("abc")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formats Brazilian mobile and landline numbers", () => {
    expect(formatPhone("5511999999999")).toBe("+55 (11) 99999-9999");
    expect(formatPhone("551199999999")).toBe("+55 (11) 9999-9999");
  });

  it("labels lids and groups", () => {
    expect(formatPhone("lid:12345")).toBe("LID:12345");
    expect(formatPhone("group:120363000000000000")).toBe("Group:120363000000000000");
  });

  it("falls back to a +-prefixed number for other lengths", () => {
    expect(formatPhone("12025550123")).toBe("+12025550123");
  });
});
