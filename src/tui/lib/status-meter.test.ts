import { describe, expect, it } from "bun:test";
import { formatElapsed, formatTokens } from "./status-meter.js";

describe("formatElapsed", () => {
  it("shows seconds under a minute", () => {
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(0)).toBe("0s");
  });
  it("shows minutes+seconds under an hour", () => {
    expect(formatElapsed(72_000)).toBe("1m12s");
    expect(formatElapsed(605_000)).toBe("10m05s");
  });
  it("shows hours+minutes past an hour", () => {
    expect(formatElapsed(3_780_000)).toBe("1h03m");
  });
});

describe("formatTokens", () => {
  it("leaves small counts as-is", () => {
    expect(formatTokens(947)).toBe("947");
    expect(formatTokens(0)).toBe("0");
  });
  it("uses k for thousands and trims a trailing .0", () => {
    expect(formatTokens(18_400)).toBe("18.4k");
    expect(formatTokens(135_700)).toBe("135.7k");
    expect(formatTokens(2_000)).toBe("2k");
  });
  it("uses M for millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });
});
