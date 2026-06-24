import { describe, expect, it } from "bun:test";
import { classifyProviderLimit, isProviderLimit } from "./limit-detect.js";

describe("classifyProviderLimit", () => {
  it("returns negative for empty / non-limit text", () => {
    expect(classifyProviderLimit()).toEqual({ limited: false, kind: null });
    expect(classifyProviderLimit("", null, undefined)).toEqual({ limited: false, kind: null });
    expect(classifyProviderLimit("TypeError: cannot read property")).toEqual({ limited: false, kind: null });
    expect(classifyProviderLimit("file not found")).toEqual({ limited: false, kind: null });
  });

  it("detects generic rate limits (429 / too many requests)", () => {
    expect(classifyProviderLimit("Error 429: Too Many Requests").kind).toBe("rate_limit");
    expect(classifyProviderLimit("rate_limit_error").kind).toBe("rate_limit");
    expect(classifyProviderLimit("you are being rate limited").kind).toBe("rate_limit");
    expect(isProviderLimit("429")).toBe(true);
  });

  it("detects subscription usage limits", () => {
    expect(classifyProviderLimit("You've reached your usage limit").kind).toBe("usage_limit");
    expect(classifyProviderLimit("Claude usage limit reached. Limit will reset at 5pm").kind).toBe("usage_limit");
    expect(classifyProviderLimit("weekly limit hit").kind).toBe("usage_limit");
  });

  it("detects quota / billing exhaustion", () => {
    expect(classifyProviderLimit("insufficient_quota").kind).toBe("quota");
    expect(classifyProviderLimit("You are out of credits").kind).toBe("quota");
    expect(classifyProviderLimit("quota exceeded for this org").kind).toBe("quota");
  });

  it("detects server overload (529)", () => {
    expect(classifyProviderLimit("Overloaded").kind).toBe("overloaded");
    expect(classifyProviderLimit("Error 529: server is temporarily overloaded").kind).toBe("overloaded");
  });

  it("classifies across multiple parts (message + stderr + json)", () => {
    const c = classifyProviderLimit("turn failed", null, '{"error":{"type":"rate_limit_error"}}');
    expect(c.limited).toBe(true);
    expect(c.kind).toBe("rate_limit");
  });

  it("prefers the more specific usage_limit over rate_limit when both present", () => {
    // "limit will reset" is a usage-limit signal and is checked before rate_limit.
    expect(classifyProviderLimit("rate limited; your usage limit will reset soon").kind).toBe("usage_limit");
  });

  it("extracts a Retry-After hint when present", () => {
    expect(classifyProviderLimit("429 rate limit, retry-after: 30").retryAfterMs).toBe(30_000);
    expect(classifyProviderLimit("Too many requests. Try again in 12 seconds").retryAfterMs).toBe(12_000);
    expect(classifyProviderLimit("rate limit; backoff 1500 ms").retryAfterMs).toBe(1500);
  });

  it("omits retryAfterMs when no hint is present", () => {
    expect(classifyProviderLimit("429 too many requests").retryAfterMs).toBeUndefined();
  });

  it("does NOT mis-classify ordinary errors that merely mention loose words", () => {
    // bare "billing" / "529" substrings must not trigger a wrongful failover
    expect(classifyProviderLimit("Updated billing address in settings").limited).toBe(false);
    expect(classifyProviderLimit("billing.ts: TypeError at line 12").limited).toBe(false);
    expect(classifyProviderLimit("compiled 5290 modules").limited).toBe(false);
    expect(classifyProviderLimit("the rate of the limit will reset the counter").limited).toBe(false);
    expect(classifyProviderLimit("set the speed limit reset flag").limited).toBe(false);
  });

  it("still catches real billing/credit exhaustion phrasing", () => {
    expect(classifyProviderLimit("your credit balance is too low").kind).toBe("quota");
    expect(classifyProviderLimit("billing hard limit reached").kind).toBe("quota");
  });
});
