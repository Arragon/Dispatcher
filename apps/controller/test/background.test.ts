import { describe, expect, it } from "vitest";
import { BackgroundLoop, backoffDelayMs, runBounded } from "../src/background.js";
import { classifyControlRoute } from "../src/control-auth.js";

describe("BackgroundLoop", () => {
  it("coalesces overlapping ticks and isolates job failures", async () => {
    let runs = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const errors: string[] = [];
    const loop = new BackgroundLoop([
      { name: "fails", run: async () => { throw new Error("boom"); } },
      { name: "slow", run: async () => { runs += 1; await gate; } },
    ], { intervalMs: 10, onError: (job) => errors.push(job) });
    const first = loop.tick();
    expect(loop.tick()).toBe(first);
    release();
    await first;
    expect(runs).toBe(1);
    expect(errors).toEqual(["fails"]);
  });

  it("waits for in-flight work on stop and schedules nothing afterwards", async () => {
    let runs = 0;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loop = new BackgroundLoop([{ name: "job", run: async () => { runs += 1; started(); await gate; } }], { intervalMs: 10, onError: () => undefined });
    loop.start();
    await running;
    let stopped = false;
    const stopping = loop.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(runs).toBe(1);
    expect(loop.active).toBe(false);
  });

  it("bounds concurrency and caps exponential backoff", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runBounded([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      active -= 1;
    });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1, 2, 3, 10].map((attempt) => backoffDelayMs(attempt, 100, 1_000))).toEqual([100, 200, 400, 1_000]);
  });
});

describe("classifyControlRoute", () => {
  it("only exempts signed ingress, login and messaging tickets from the owner principal", () => {
    expect(classifyControlRoute("POST", "/api/connectors/slack-main/webhook")).toBe("signed");
    expect(classifyControlRoute("POST", "/api/runners/enroll")).toBe("signed");
    expect(classifyControlRoute("GET", "/auth/messaging?ticket=x")).toBe("public");
    expect(classifyControlRoute("POST", "/auth/session")).toBe("login");
    expect(classifyControlRoute("GET", "/health")).toBe("public");
    for (const [method, url] of [["GET", "/api/connectors/slack-main/webhook"], ["POST", "/api/runners/build-01/enrollment"], ["POST", "/api/secrets/a/b"], ["GET", "/api/events"], ["POST", "/auth/login-codes"]] as const) {
      expect(classifyControlRoute(method, url), `${method} ${url}`).toBe("protected");
    }
  });
});
