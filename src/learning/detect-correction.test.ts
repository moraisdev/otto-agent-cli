import { describe, it, expect } from "bun:test";
import { looksLikeCorrection } from "./detect-correction.js";

describe("looksLikeCorrection", () => {
  it("detects a correction message", () => {
    expect(looksLikeCorrection("não é assim, faz assim")).toBe(true);
  });

  it("ignores a normal greeting", () => {
    expect(looksLikeCorrection("bom dia")).toBe(false);
  });

  it("detects 'tá errado'", () => {
    expect(looksLikeCorrection("isso tá errado")).toBe(true);
  });

  it("detects 'na verdade'", () => {
    expect(looksLikeCorrection("na verdade o nome dele é João")).toBe(true);
  });

  it("detects 'corrige'", () => {
    expect(looksLikeCorrection("corrige isso por favor")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(looksLikeCorrection("")).toBe(false);
  });
});
