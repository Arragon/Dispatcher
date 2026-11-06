import { afterEach, describe, expect, it, vi } from "vitest";
import { clientHeaders, clientToken, grant, owner, rhizaServiceFixture } from "./fixtures/rhiza-service.js";
const prefix = "/api/integrations/rhiza/v1";
const fixtures: Awaited<ReturnType<typeof rhizaServiceFixture>>[] = [];
async function setup(enabled = true) { const f = await rhizaServiceFixture(enabled); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
const hello = { protocolVersions: ["1.1"], requiredCapabilities: [], requiredScopes: [] };

describe("restricted RHIZA service identity over HTTP", () => {
  it("defaults ingress off and never changes owner control authority", async () => {
    const f = await setup(false);
    const disabled = await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders });
    expect(disabled.statusCode).toBe(503); expect(disabled.json().code).toBe("INGRESS_DISABLED");
    expect((await f.service.app.inject({ url: "/api/config", headers: owner })).statusCode).toBe(200);
    expect((await f.service.app.inject({ url: "/api/config", headers: clientHeaders })).statusCode).toBe(401);
  });
  it("returns a redacted capability envelope without promising unimplemented operations", async () => {
    const f = await setup();
    const response = await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, protocolVersions: ["1.1"], eventSchemaVersion: "1", capabilities: ["targets.read","jobs.read","jobs.cancel","jobs.input","events.read","artifacts.read"], scopes: ["targets:read","jobs:read","jobs:cancel","jobs:input","events:read","artifacts:read"] });
    for(const unavailable of ["jobs.submit","model.verified"])expect(response.json().capabilities).not.toContain(unavailable);
    expect(response.body).not.toContain(clientToken); expect(response.body).not.toContain("secret://"); expect(response.body).not.toContain(f.root);
    expect(f.service.database.listEntities("run")).toEqual([]); expect(f.service.database.listCanonicalTasks()).toEqual([]);
  });
  it("binds handshake to the authenticated client without minting new authority", async () => {
    const f = await setup();
    const response = await f.service.app.inject({ method: "POST", url: `${prefix}/handshakes`, headers: { ...clientHeaders, "x-dispatcher-actor": "owner" }, payload: hello });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, protocolVersion: "1.1", clientId: "client-a", scopes: ["targets:read","jobs:read","jobs:cancel","jobs:input","events:read","artifacts:read"], capabilities: ["targets.read","jobs.read","jobs.cancel","jobs.input","events.read","artifacts.read"], expiresAt: grant.expiresAt });
    expect(response.body).not.toMatch(/owner|token|credentialRef/);
    expect((await f.service.app.inject({ method: "POST", url: `${prefix}/handshakes`, headers: clientHeaders, payload: { ...hello, actor: "owner" } })).statusCode).toBe(400);
  });
  it("rejects incompatible versions and unavailable required capabilities without enabling them", async () => {
    const f = await setup();
    const request = (payload: unknown) => f.service.app.inject({ method: "POST", url: `${prefix}/handshakes`, headers: clientHeaders, payload });
    expect((await request({ ...hello, protocolVersions: ["2.0"] })).json().code).toBe("PROTOCOL_UNSUPPORTED");
    expect((await request({ ...hello, protocolVersions: ["1.0"] })).json().code).toBe("PROTOCOL_UNSUPPORTED");
    expect((await request({ ...hello, requiredCapabilities: ["jobs.submit"] })).json().code).toBe("CAPABILITY_REQUIRED");
    expect((await request({ ...hello, requiredScopes: ["jobs:submit"] })).statusCode).toBe(403);
  });
  it("does not accept owner tokens or browser sessions as service identity", async () => {
    const f = await setup();
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: owner })).statusCode).toBe(401);
    const session = await f.service.app.inject({ method: "POST", url: "/auth/session", payload: { token: "synthetic-owner-rhiza-test" } });
    expect(session.statusCode).toBe(201);
    const cookie = [session.headers["set-cookie"] ?? []].flat().map(value => value.split(";")[0]).join("; ");
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { cookie } })).statusCode).toBe(401);
  });
  it("rejects swapped client hints and wrong service credentials", async () => {
    const f = await setup();
    const other = `rhiza.${Buffer.from("client-b").toString("base64url")}.${"a".repeat(43)}`;
    for (const token of [other, clientToken.replace(/a$/, "b"), "arbitrary-service-token"]) {
      expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    }
  });
  it("rechecks expiry and revocation after a previously successful handshake", async () => {
    const f = await setup();
    expect((await f.service.app.inject({ method: "POST", url: `${prefix}/handshakes`, headers: clientHeaders, payload: hello })).statusCode).toBe(200);
    await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; });
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(401);
    await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = true; });
    f.clock.now = new Date("2026-12-01T00:00:00.000Z");
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(401);
  });
  it("rejects grant revocation while its secret read is awaiting", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), resolve = f.secrets.resolve.bind(f.secrets);
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(200);
    vi.spyOn(f.secrets, "resolve").mockImplementation(async (reference, context) => {
      const value = await resolve(reference, context);
      if (reference === grant.credentialRef) { entered.resolve(); await release.promise; }
      return value;
    });
    const pending = f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders }).then(value => value);
    try { await entered.promise; await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; }); }
    finally { release.resolve(); }
    expect((await pending).statusCode).toBe(401);
  });
  it("keeps Host, Origin and real TLS protections on the service path", async () => {
    const f = await setup();
    const request = (headers: Record<string, string>, remoteAddress = "127.0.0.1") => f.service.app.inject({ method: "POST", url: `${prefix}/handshakes`, remoteAddress, headers: { ...clientHeaders, ...headers }, payload: hello });
    expect((await request({ host: "evil.example" })).json().code).toBe("HOST_REJECTED");
    expect((await request({ origin: "https://evil.example", host: "localhost" })).json().code).toBe("ORIGIN_REJECTED");
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { ...clientHeaders, origin: "https://evil.example" } })).json().code).toBe("ORIGIN_REJECTED");
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { ...clientHeaders, host: "localhost", origin: "https://localhost" } })).json().code).toBe("ORIGIN_REJECTED");
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { ...clientHeaders, host: "localhost:80", origin: "http://localhost" } })).statusCode).toBe(200);
    expect((await request({ host: "dispatcher.example", "x-forwarded-proto": "https" }, "192.0.2.10")).json().code).toBe("TLS_REQUIRED");
  });
  it("does not revive an in-flight grant after revoke and reenable restore identical configuration", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), resolve = f.secrets.resolve.bind(f.secrets);
    vi.spyOn(f.secrets, "resolve").mockImplementation(async (reference, context) => {
      const value = await resolve(reference, context);
      if (reference === grant.credentialRef) { entered.resolve(); await release.promise; }
      return value;
    });
    const pending = f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders }).then(value => value);
    try {
      await entered.promise;
      await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; });
      await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = true; });
    } finally { release.resolve(); }
    expect((await pending).statusCode).toBe(401);
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(200);
  });
  it("invalidates an in-flight identity when its credential is rotated through owner control", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), resolve = f.secrets.resolve.bind(f.secrets);
    const replacement = clientToken.replace(/a+$/, "b".repeat(43));
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(200);
    vi.spyOn(f.secrets, "resolve").mockImplementation(async (reference, context) => {
      const value = await resolve(reference, context);
      if (reference === grant.credentialRef) { entered.resolve(); await release.promise; }
      return value;
    });
    const pending = f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders }).then(value => value);
    try {
      await entered.promise;
      const changed = await f.service.app.inject({ method: "PUT", url: "/api/secrets/rhiza/client-a", headers: owner, payload: { value: replacement } });
      expect(changed.statusCode).toBe(201); expect(changed.body).not.toContain(replacement);
    } finally { release.resolve(); }
    expect((await pending).statusCode).toBe(401);
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders })).statusCode).toBe(401);
    expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { authorization: `Bearer ${replacement}` } })).statusCode).toBe(200);
  });
  it("limits repeated bad service credentials without granting owner fallback", async () => {
    const f = await setup();
    for (let count = 0; count < 10; count++) expect((await f.service.app.inject({ url: `${prefix}/capabilities`, headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
    const limited = await f.service.app.inject({ url: `${prefix}/capabilities`, headers: clientHeaders });
    expect(limited.statusCode).toBe(429); expect(limited.json().code).toBe("RATE_LIMITED"); expect(limited.headers["retry-after"]).toBeDefined();
  });
  it("cannot use alternate encoded paths or dot segments to gain owner access", async () => {
    const f = await setup();
    for (const path of ["/api/integrations/%72hiza/v1/capabilities", "/%61pi/integrations/rhiza/v1/capabilities"]) {
      const response = await f.service.app.inject({ url: path, headers: owner });
      expect(response.statusCode).not.toBe(200);
    }
    for (const path of ["/api/config", `${prefix}/../../../../api/config`, `${prefix}/%2e%2e/%2e%2e/%2e%2e/config`]) {
      expect((await f.service.app.inject({ url: path, headers: clientHeaders })).statusCode).not.toBe(200);
    }
  });
});
