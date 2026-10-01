import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SecretAccessContext, SecretMetadata, SecretStore } from "@dispatcher/config";
import type { JsonValue } from "@dispatcher/persistence";
import { ControllerService, type BackgroundWorkerOptions } from "../src/service.js";

const TOKEN = "personal-owner-token";
const OWNER = { authorization: `Bearer ${TOKEN}` };
const SLACK_SIGNING = "signing-secret";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

class Secrets implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string, context: SecretAccessContext): Promise<boolean> { void context; return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string, context: SecretAccessContext): Promise<string> { void context; const value = this.values.get(reference); if (!value) throw new Error("missing secret"); return value; }
}

const directories: string[] = [];
const services: ControllerService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function dataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-personal-"));
  directories.push(directory);
  return directory;
}

function track(service: ControllerService): ControllerService {
  services.push(service);
  return service;
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  return [setCookie ?? []].flat().map((cookie) => cookie.split(";")[0]).join("; ");
}

describe("control-plane authentication", () => {
  it("rejects unauthenticated control requests and ignores client-supplied identity", async () => {
    const service = track(new ControllerService({ ownerToken: TOKEN, dataDirectory: dataDirectory(), secretStore: new Secrets() }));
    await service.start({ listen: false });
    const protectedRoutes = [
      ["GET", "/api/runners"],
      ["POST", "/api/config/plans"],
      ["POST", "/api/tasks/task-1/dispatch"],
      ["PUT", "/api/secrets/linear/main"],
      ["POST", "/api/connectors/slack-main/messaging-identities"],
      ["POST", "/api/runners/build-01/enrollment"],
      ["POST", "/api/assistant/workflows"],
      ["POST", "/api/runs/run-1/advance"],
      ["POST", "/auth/login-codes"],
    ] as const;
    for (const [method, url] of protectedRoutes) {
      const response = await service.app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.body).not.toContain(TOKEN);
    }
    expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await service.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);

    const current = (await service.app.inject({ headers: OWNER, method: "GET", url: "/api/config" })).json();
    const plan = await service.app.inject({ headers: OWNER, method: "POST", url: "/api/config/plans", payload: { config: current.config, actor: "mallory", roles: ["admin"] } });
    expect(plan.statusCode).toBe(201);
    expect(plan.json().plan.actor).toBe("owner");
  });

  it("enforces host, origin and failed-credential lockout", async () => {
    const service = track(new ControllerService({ ownerToken: TOKEN, dataDirectory: dataDirectory(), secretStore: new Secrets() }));
    await service.start({ listen: false });
    expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: { ...OWNER, host: "evil.example" } })).statusCode).toBe(403);
    expect((await service.app.inject({ method: "POST", url: "/api/runs/run-1/advance", headers: { ...OWNER, origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: { ...OWNER, "sec-fetch-site": "cross-site" } })).statusCode).toBe(403);
    const sameOrigin = await service.app.inject({ method: "GET", url: "/api/runners", headers: { ...OWNER, origin: "http://localhost:80" } });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers).toMatchObject({ "x-frame-options": "DENY", "x-content-type-options": "nosniff", "cache-control": "no-store" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    }
    const locked = await service.app.inject({ method: "GET", url: "/api/runners", headers: OWNER });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
  });

  it("exchanges a single-use login code for an expiring HttpOnly session guarded by CSRF", async () => {
    let now = Date.parse("2026-10-01T00:00:00.000Z");
    const service = track(new ControllerService({ ownerToken: TOKEN, dataDirectory: dataDirectory(), secretStore: new Secrets(), clock: () => new Date(now) }));
    await service.start({ listen: false });
    const code = new URL(service.issueDashboardLogin("http://localhost").url).hash.slice("#login=".length);
    const created = await service.app.inject({ method: "POST", url: "/auth/session", payload: { code } });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(TOKEN);
    expect(String(created.headers["set-cookie"])).toContain("HttpOnly");
    const cookie = cookieHeader(created.headers["set-cookie"]);
    const csrf = created.json().csrfToken as string;
    expect((await service.app.inject({ method: "POST", url: "/auth/session", payload: { code } })).statusCode).toBe(401);

    expect((await service.app.inject({ method: "GET", url: "/auth/session", headers: { cookie } })).json().principal).toMatchObject({ id: "owner", authenticatedBy: "session" });
    const current = (await service.app.inject({ method: "GET", url: "/api/config", headers: { cookie } })).json();
    expect((await service.app.inject({ method: "POST", url: "/api/config/plans", headers: { cookie }, payload: { config: current.config } })).statusCode).toBe(403);
    expect((await service.app.inject({ method: "POST", url: "/api/config/plans", headers: { cookie, "x-dispatcher-csrf": csrf }, payload: { config: current.config } })).statusCode).toBe(201);

    now += 13 * 60 * 60_000;
    expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: { cookie } })).statusCode).toBe(401);
    const expiredCode = new URL(service.issueDashboardLogin("http://localhost").url).hash.slice("#login=".length);
    now += 11 * 60_000;
    expect((await service.app.inject({ method: "POST", url: "/auth/session", payload: { code: expiredCode } })).statusCode).toBe(401);
    expect((await service.app.inject({ method: "POST", url: "/auth/session", payload: { token: TOKEN } })).statusCode).toBe(201);
  });
});

describe("runner enrollment", () => {
  it("issues single-use expiring codes, delivers the credential once and supports revoke and rotate", async () => {
    let now = Date.parse("2026-10-01T00:00:00.000Z");
    const secrets = new Secrets();
    const reference = "secret://runner/dispatcher/build-01";
    const service = track(new ControllerService({ ownerToken: TOKEN, dataDirectory: dataDirectory(), secretStore: secrets, clock: () => new Date(now) }));
    const next = structuredClone(service.configuration.current().config);
    next.runners.push({ id: "build-01", displayName: "Build 01", mode: "remote", capacity: 1, tags: [], credentialRef: reference });
    service.configuration.applyPlan(service.configuration.buildPlan(next, "test", "api").id, { confirmed: true });
    await service.start({ listen: false });
    const issue = (headers: Record<string, string> = OWNER) => service.app.inject({ method: "POST", url: "/api/runners/build-01/enrollment", headers, payload: { ttlMs: 60_000 } });
    const enroll = (token: string) => service.app.inject({ method: "POST", url: "/api/runners/enroll", payload: { runnerId: "build-01", token } });

    expect((await issue({})).statusCode).toBe(401);
    const expiring = (await issue()).json();
    now += 60_001;
    expect((await enroll(expiring.token)).statusCode).toBe(401);
    expect((await enroll("not-a-token")).statusCode).toBe(401);

    const issued = (await issue()).json();
    const enrolled = await enroll(issued.token);
    expect(enrolled.statusCode).toBe(201);
    const bearer = enrolled.json().bearerToken as string;
    expect(secrets.values.get(reference)).toBe(bearer);
    const replay = await enroll(issued.token);
    expect(replay.statusCode).toBe(401);
    expect(replay.body).not.toContain(bearer);
    const persisted = JSON.stringify([service.database.getEntity("runner-identity", "build-01"), service.database.listEntities("runner-enrollment")]);
    expect(persisted).not.toContain(bearer);
    expect(persisted).not.toContain(issued.token);
    expect((await service.app.inject({ method: "GET", url: "/api/runners", headers: OWNER })).body).not.toContain(bearer);

    const rotated = await service.app.inject({ method: "POST", url: "/api/runners/build-01/credential/rotate", headers: OWNER, payload: { ttlMs: 60_000 } });
    expect(rotated.statusCode).toBe(201);
    expect(secrets.values.has(reference)).toBe(false);
    const reenrolled = await enroll(rotated.json().token);
    expect(reenrolled.statusCode).toBe(201);
    expect(reenrolled.json().bearerToken).not.toBe(bearer);

    const pending = (await issue()).json();
    expect((await service.app.inject({ method: "POST", url: "/api/runners/build-01/credential/revoke", headers: OWNER })).statusCode).toBe(200);
    expect(secrets.values.has(reference)).toBe(false);
    expect((await enroll(pending.token)).statusCode).toBe(401);
  });
});

interface SlackHarness {
  service: ControllerService;
  posts(): string[];
  send(eventId: string, event?: Record<string, unknown>, options?: { timestamp?: number; headers?: Record<string, string>; payload?: Record<string, unknown> }): Promise<{ statusCode: number; json(): Record<string, unknown>; elapsedMs: number }>;
  inbox(eventId: string): Record<string, unknown> | undefined;
}

async function slackHarness(input: { directory?: string; secrets?: Secrets; fetch?: Fetch; clock?: () => Date; backgroundWorker?: BackgroundWorkerOptions; configure?: boolean; calls?: { url: string; body: string }[] } = {}): Promise<SlackHarness> {
  const secrets = input.secrets ?? new Secrets();
  secrets.values.set("secret://slack/bot", "xoxb-hidden");
  secrets.values.set("secret://slack/signing", SLACK_SIGNING);
  const calls = input.calls ?? [];
  const respond: Fetch = input.fetch ?? (async () => new Response(JSON.stringify({ ok: true, ts: "200.1" }), { status: 200 }));
  const integrationFetch: Fetch = async (request, init) => {
    const url = String(request);
    if (url.endsWith("/auth.test")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    calls.push({ url, body: String(init?.body ?? "") });
    return respond(request, init);
  };
  const service = track(new ControllerService({
    ownerToken: TOKEN,
    dataDirectory: input.directory ?? dataDirectory(),
    secretStore: secrets,
    integrationFetch,
    ...(input.clock ? { clock: input.clock } : {}),
    ...(input.backgroundWorker ? { backgroundWorker: input.backgroundWorker } : {}),
  }));
  await service.start({ listen: false });
  if (input.configure !== false) {
    const current = (await service.app.inject({ headers: OWNER, method: "GET", url: "/api/config" })).json();
    current.config.connectors = [{ id: "slack-main", definitionId: "messaging.slack", kind: "messaging", displayName: "Slack", enabled: true, credentialRef: "secret://slack/bot", settings: { signingSecretRef: "secret://slack/signing", alertChannel: "C-alert", apiBase: "https://slack.invalid/api" } }];
    const plan = await service.app.inject({ headers: OWNER, method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await service.app.inject({ headers: OWNER, method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
    expect((await service.app.inject({ headers: OWNER, method: "POST", url: "/api/connectors/slack-main/messaging-identities", payload: { externalPrincipalId: "U1", principalId: "owner", roles: ["operator", "admin"] } })).statusCode).toBe(201);
  }
  return {
    service,
    posts: () => calls.filter((call) => call.url.endsWith("/chat.postMessage")).map((call) => call.body),
    inbox: (eventId) => service.database.getEntity<Record<string, unknown>>("messaging-inbox", `slack-main:${eventId}`),
    async send(eventId, event = {}, options = {}) {
      const body = JSON.stringify({ event_id: eventId, event: { type: "message", ts: "100.1", channel: "C1", user: "U1", text: "/fleet list", ...event }, ...options.payload });
      const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1_000));
      const signature = `v0=${createHmac("sha256", SLACK_SIGNING).update(`v0:${timestamp}:${body}`).digest("hex")}`;
      const started = performance.now();
      const response = await service.app.inject({ method: "POST", url: "/api/connectors/slack-main/webhook", headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature, ...options.headers }, payload: body });
      return { statusCode: response.statusCode, json: () => response.json(), elapsedMs: performance.now() - started };
    },
  };
}

describe("Slack ingress", () => {
  it("acknowledges within one second while slow replies run in the background", async () => {
    const slack = await slackHarness({ fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 1_500)); return new Response(JSON.stringify({ ok: true, ts: "200.1" }), { status: 200 }); } });
    const acked = await slack.send("EvSlow");
    expect(acked.statusCode).toBe(202);
    expect(acked.elapsedMs).toBeLessThan(1_000);
    expect(acked.json()).toMatchObject({ accepted: true, duplicate: false, status: "RECEIVED" });
    expect(slack.posts()).toHaveLength(0);
    await slack.service.runBackgroundCycle();
    expect(slack.inbox("EvSlow")).toMatchObject({ status: "DONE", outcome: "REPLIED" });
    expect(slack.posts()).toHaveLength(1);
  });

  it("acks duplicates, retries and bot or non-command events without executing them", async () => {
    const slack = await slackHarness();
    const now = Math.floor(Date.now() / 1_000);
    expect((await slack.send("Ev1", {}, { timestamp: now })).json()).toMatchObject({ duplicate: false });
    const retried = await slack.send("Ev1", {}, { timestamp: now - 1, headers: { "x-slack-retry-num": "1", "x-slack-retry-reason": "http_timeout" } });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toMatchObject({ duplicate: true });
    const replayed = await slack.send("Ev1", {}, { timestamp: now });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ duplicate: true });
    expect(slack.inbox("Ev1")).toMatchObject({ deliveries: 2, lastRetryAttempt: 1, lastRetryReason: "http_timeout" });

    const ignored = [
      ["EvBot", { bot_id: "B1" }, undefined, "bot-message"],
      ["EvBotSubtype", { subtype: "bot_message" }, undefined, "bot-message"],
      ["EvSelf", { user: "UBOT" }, { authorizations: [{ user_id: "UBOT", is_bot: true }] }, "self-message"],
      ["EvChanged", { subtype: "message_changed" }, undefined, "subtype:message_changed"],
      ["EvDeleted", { subtype: "message_deleted" }, undefined, "subtype:message_deleted"],
      ["EvJoin", { subtype: "channel_join" }, undefined, "subtype:channel_join"],
    ] as const;
    for (const [eventId, event, payload, reason] of ignored) {
      const response = await slack.send(eventId, event, payload ? { payload } : {});
      expect(response.statusCode, eventId).toBe(202);
      expect(response.json(), eventId).toMatchObject({ ignored: true, reason });
    }
    await slack.service.runBackgroundCycle();
    await slack.service.runBackgroundCycle();
    expect(slack.posts()).toHaveLength(1);
  });

  it("rejects invalid signatures and stale timestamps before storing anything", async () => {
    const slack = await slackHarness();
    expect((await slack.send("EvForged", {}, { headers: { "x-slack-signature": "v0=00" } })).statusCode).toBe(401);
    expect((await slack.send("EvStale", {}, { timestamp: Math.floor(Date.now() / 1_000) - 600 })).statusCode).toBe(401);
    expect(slack.inbox("EvForged")).toBeUndefined();
    expect(slack.inbox("EvStale")).toBeUndefined();
  });

  it("replies once to an unlinked principal without leaking internals", async () => {
    const slack = await slackHarness();
    await slack.send("EvA", { user: "U2", ts: "500.2", thread_ts: "500.1", text: "/fleet list" });
    await slack.send("EvB", { user: "U2", ts: "500.3", thread_ts: "500.1", text: "/config apply" });
    await slack.service.runBackgroundCycle();
    expect(slack.inbox("EvA")).toMatchObject({ status: "DONE", outcome: "UNAUTHORIZED" });
    expect(slack.inbox("EvB")).toMatchObject({ status: "DONE", outcome: "UNAUTHORIZED" });
    expect(slack.posts()).toHaveLength(1);
    expect(slack.posts()[0]).not.toMatch(/secret:\/\/|\bat .+:\d+:\d+/);
  });

  it("recovers PROCESSING records left by a crashed controller", async () => {
    const directory = dataDirectory();
    const secrets = new Secrets();
    const calls: { url: string; body: string }[] = [];
    const first = await slackHarness({ directory, secrets, calls });
    await first.send("EvCrash");
    const record = first.inbox("EvCrash")!;
    first.service.database.saveEntity("messaging-inbox", "slack-main:EvCrash", { ...record, status: "PROCESSING", attempts: 1, claimedBy: "crashed-worker", claimedAt: new Date().toISOString() } as unknown as JsonValue);
    await first.service.stop();
    const second = await slackHarness({ directory, secrets, calls, configure: false });
    await second.service.runBackgroundCycle();
    expect(second.inbox("EvCrash")).toMatchObject({ status: "DONE", outcome: "REPLIED", attempts: 2 });
    expect(second.posts()).toHaveLength(1);
  });

  it("dead-letters after bounded retries with backoff and supports requeue", async () => {
    let now = Date.now();
    const slack = await slackHarness({
      clock: () => new Date(now),
      backgroundWorker: { inboxMaxAttempts: 2, inboxBaseDelayMs: 1_000 },
      fetch: async () => new Response("unavailable", { status: 500 }),
    });
    await slack.send("EvFail");
    await slack.service.runBackgroundCycle();
    expect(slack.inbox("EvFail")).toMatchObject({ status: "FAILED", attempts: 1 });
    await slack.service.runBackgroundCycle();
    expect(slack.inbox("EvFail")).toMatchObject({ status: "FAILED", attempts: 1 });
    now += 1_001;
    await slack.service.runBackgroundCycle();
    expect(slack.inbox("EvFail")).toMatchObject({ status: "DEAD_LETTER", attempts: 2 });
    const deadLetters = (await slack.service.app.inject({ headers: OWNER, method: "GET", url: "/api/connectors/dead-letters" })).json().deadLetters as { id: string; sourceId: string; reason: string }[];
    const deadLetter = deadLetters.find((entry) => entry.sourceId === "messaging-inbox:slack-main:EvFail");
    expect(deadLetter).toMatchObject({ reason: "MAX_ATTEMPTS_EXCEEDED" });
    expect(JSON.stringify(deadLetters)).not.toContain("xoxb-hidden");
    const retried = await slack.service.app.inject({ headers: OWNER, method: "POST", url: `/api/connectors/dead-letters/${encodeURIComponent(deadLetter!.id)}/retry` });
    expect(retried.json()).toMatchObject({ retried: true });
    expect(slack.inbox("EvFail")).toMatchObject({ status: "RECEIVED", attempts: 0 });
  });
});
