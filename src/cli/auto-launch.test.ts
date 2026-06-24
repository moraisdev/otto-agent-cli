import { describe, expect, it } from "bun:test";
import { planDaemonActions, resolveNatsPort } from "./auto-launch.js";

describe("planDaemonActions", () => {
  it("starts NATS and the otto bot when both are down", () => {
    expect(planDaemonActions({ ottoRunning: false, natsUp: false })).toEqual({ startNats: true, ottoAction: "start" });
  });

  it("starts NATS and restarts the bot when the bot is up but NATS is down (wedged)", () => {
    // restarting the bot is needed because it exhausts connect retries while NATS is missing
    expect(planDaemonActions({ ottoRunning: true, natsUp: false })).toEqual({ startNats: true, ottoAction: "restart" });
  });

  it("only starts the bot when NATS is up but the bot is down", () => {
    expect(planDaemonActions({ ottoRunning: false, natsUp: true })).toEqual({ startNats: false, ottoAction: "start" });
  });

  it("does nothing when NATS and the bot are both healthy", () => {
    expect(planDaemonActions({ ottoRunning: true, natsUp: true })).toEqual({ startNats: false, ottoAction: "none" });
  });
});

describe("resolveNatsPort", () => {
  it("defaults to 4222", () => {
    expect(resolveNatsPort({})).toBe(4222);
    expect(resolveNatsPort({ NATS_PORT: "not-a-number" })).toBe(4222);
    expect(resolveNatsPort({ NATS_PORT: "0" })).toBe(4222);
  });

  it("honors a valid NATS_PORT", () => {
    expect(resolveNatsPort({ NATS_PORT: "4333" })).toBe(4333);
  });
});
