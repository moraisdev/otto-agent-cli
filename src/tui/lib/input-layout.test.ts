import { describe, expect, test } from "bun:test";
import { computeVisualLines } from "./input-layout.js";

describe("computeVisualLines", () => {
  test("grows when text wraps", () => {
    expect(computeVisualLines("a".repeat(80), 80)).toBe(1);
    expect(computeVisualLines("a".repeat(81), 80)).toBe(2);
    expect(computeVisualLines("a".repeat(161), 80)).toBe(3);
  });

  test("counts explicit and empty lines", () => {
    expect(computeVisualLines("first\nsecond", 80)).toBe(2);
    expect(computeVisualLines("first\n\nthird", 80)).toBe(3);
  });

  test("uses terminal cell width for wide characters", () => {
    expect(computeVisualLines("🙂🙂🙂", 4)).toBe(2);
  });
});
