import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretAccessContext, SecretMetadata, SecretStore } from "@dispatcher/config";
import type { DevinProfileConfig } from "@dispatcher/adapters";
import { ControllerService } from "../src/service.js";

const TEST_OWNER_TOKEN = "test-owner-token";
const OWNER = { authorization: `Bearer ${TEST_OWNER_TOKEN}` };

const temporaryDirectories: string[] = [];
function dataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-controller-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) { captureTree(directory, "before-remove"); rmSync(directory, { recursive: true, force: true }); }
  vi.unstubAllGlobals();
});

class FakeSecretStore implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string, context: SecretAccessContext): Promise<boolean> { void context; return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string, context: SecretAccessContext): Promise<string> { void context; const value = this.values.get(reference); if (!value) throw new Error("missing"); return value; }
}

let captureIndex = 0;
function captureTree(directory: string, phase: string): void {
  const root = process.env.DISPATCHER_DEVIN_FIXTURE_EVIDENCE; if (!root) return;
  const destination = join(root, "controller-" + process.pid + "-" + (++captureIndex) + "-" + phase); mkdirSync(destination, { recursive: true });
  const identities: Record<string, unknown> = {};
  const walk = (path: string, relative = "") => {
    const stat = statSync(path); identities[relative || "."] = { dev: stat.dev, ino: stat.ino, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs };
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name), join(relative, name));
    else { const bytes = readFileSync(path); identities[relative] = { ...identities[relative] as object, payloadBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; }
  };
  walk(directory); cpSync(directory, join(destination, "payload"), { recursive: true });
  writeFileSync(join(destination, "capture.json"), JSON.stringify({ identities, directory, utc: new Date().toISOString(), phase, test: expect.getState().currentTestName, scope: "controlled local fixture, not atomic database backup or provider evidence" }));
}
function retainApi(value: Record<string, unknown>): void {
  const root = process.env.DISPATCHER_DEVIN_FIXTURE_EVIDENCE; if (!root) return;
  mkdirSync(root, { recursive: true }); appendFileSync(join(root, "controller-api-" + process.pid + ".jsonl"), JSON.stringify({ utc: new Date().toISOString(), test: expect.getState().currentTestName, ...value }) + "\n");
}
async function inject(service: ControllerService, input: Parameters<ControllerService["app"]["inject"]>[0]) {
  retainApi({ phase: "request", input }); const response = await service.app.inject(input);
  retainApi({ phase: "response", status: response.statusCode, body: response.body }); return response;
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real I/O"); })); });
describe("Devin v3 Controller composition", () => {
  it.each([123, true, null, "", " ", "\nuser", "x".repeat(513)])("rejects invalid explicit Devin owner %j before applying ConfigPlan", async createAsUserId => {
    const directory = dataDirectory();
    const factory = vi.fn(), fetchImpl = vi.fn();
    const service = new ControllerService({ ownerToken: TEST_OWNER_TOKEN, dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore(), devinBackendFactory: factory, integrationFetch: fetchImpl });
    await service.start({ listen: false });
    try {
      const revision = service.configuration.current().revision;
      const created = await inject(service, { headers: OWNER, method: "POST", url: "/api/agents/devin/profiles", payload: { id: "devin-invalid", alias: "Devin", organizationId: "org-test", credentialRef: "secret://devin/main", createAsUserId } });
      expect(created.statusCode).toBe(400); expect(created.json()).toMatchObject({ code: "INVALID_DEVIN_ATTRIBUTION" }); expect(service.configuration.current().revision).toBe(revision); expect(factory).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    } finally { captureTree(directory, "before-stop"); await service.stop(); }
  });
  it("retains explicit Devin attribution through ConfigPlan composition and restart", async () => {
    const directory = dataDirectory(); const secrets = new FakeSecretStore();
    secrets.values.set("secret://devin/main", "cog-attribution-fixture");
    const configured: DevinProfileConfig[] = [];
    const create = vi.fn(async () => ({ sessionId: "devin-1", status: "running", pullRequests: [] }));
    const devinBackendFactory = (profile: DevinProfileConfig) => {
      configured.push(structuredClone(profile));
      return { health: async () => ({ ok: true }), create, get: async () => ({ sessionId: "devin-1", status: "running", pullRequests: [] }), send: async () => ({ sessionId: "devin-1", status: "running", pullRequests: [] }) };
    };
    const first = new ControllerService({ ownerToken: TEST_OWNER_TOKEN, dataDirectory: directory, withRunner: true, secretStore: secrets, devinBackendFactory });
    await first.start({ listen: false });
    try {
      const created = await inject(first, { headers: OWNER, method: "POST", url: "/api/agents/devin/profiles", payload: { id: "devin-main", alias: "Devin", organizationId: "org-test", credentialRef: "secret://devin/main", createAsUserId: "user-exact", maxSessionAcu: 12 } });
      expect(created.statusCode).toBe(201);
      const config = (await inject(first, { headers: OWNER, method: "GET", url: "/api/config" })).json();
      expect(config.config.agentProfiles.find((p: { id: string }) => p.id === "devin-main").settings).toMatchObject({ organizationId: "org-test", createAsUserId: "user-exact", maxSessionAcu: 12 });
      expect(configured.at(-1)).toMatchObject({ createAsUserId: "user-exact" });
      expect((await inject(first, { headers: OWNER, method: "POST", url: "/api/agents/profiles/devin-main/test" })).statusCode).toBe(200);
      expect(configured.at(-1)).toMatchObject({ createAsUserId: "user-exact", maxSessionAcu: 12 });
      const revision = first.configuration.current().revision;
      const preview = await inject(first, { headers: OWNER, method: "POST", url: "/api/agents/devin/profiles", payload: { id: "devin-preview", alias: "Preview", organizationId: "org-test", credentialRef: "secret://devin/main", createAsUserId: "user-preview", maxSessionAcu: 8, previewOnly: true, baseRevision: revision } });
      expect(preview.statusCode).toBe(201); expect(first.configuration.current().revision).toBe(revision);
      expect(first.configuration.proposedConfig(preview.json().plan.id).agentProfiles.find(profile => profile.id === "devin-preview")?.settings).toMatchObject({ createAsUserId: "user-preview", maxSessionAcu: 8 });
      const exported = await inject(first, { headers: OWNER, url: "/api/config/export" }); expect(exported.statusCode).toBe(200); expect(exported.body).not.toContain("cog-attribution-fixture"); expect(exported.body).not.toContain("user-exact"); expect(create).not.toHaveBeenCalled();
    } finally { captureTree(directory, "before-first-stop"); await first.stop(); }
    const second = new ControllerService({ ownerToken: TEST_OWNER_TOKEN, dataDirectory: directory, withRunner: true, secretStore: secrets, devinBackendFactory });
    await second.start({ listen: false });
    try { expect(configured.at(-1)).toMatchObject({ createAsUserId: "user-exact", organizationId: "org-test", maxSessionAcu: 12 }); expect(create).not.toHaveBeenCalled(); }
    finally { captureTree(directory, "before-second-stop"); await second.stop(); }
  });
});

it.each([0, -1, 12.5, "12", null])("refuses invalid Devin budget before ConfigPlan or discovery %j", async maxSessionAcu => {
  const directory = dataDirectory(), secrets = new FakeSecretStore(), factory = vi.fn(), fetchImpl = vi.fn();
  secrets.values.set("secret://devin/main", "controlled-token");
  const service = new ControllerService({ ownerToken: TEST_OWNER_TOKEN, dataDirectory: directory, withRunner: true, secretStore: secrets, devinBackendFactory: factory, integrationFetch: fetchImpl });
  await service.start({ listen: false });
  try {
    const before = service.configuration.current();
    for (const path of ["profiles", "discover"]) {
      const response = await inject(service, { headers: OWNER, method: "POST", url: "/api/agents/devin/" + path, payload: { id: "invalid", alias: "Invalid", organizationId: "org-test", credentialRef: "secret://devin/main", maxSessionAcu } });
      expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ code: "INVALID_DEVIN_ACU_LIMIT" });
    }
    expect(service.configuration.current()).toEqual(before); expect(factory).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  } finally { captureTree(directory, "before-stop"); await service.stop(); }
});
it("keeps draft discovery read-only and refuses invalid owner before probing", async () => {
  const directory = dataDirectory(), secrets = new FakeSecretStore(), fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => { retainApi({ phase: "controlled-fetch", url: _url, method: init?.method ?? "GET", body: init?.body, signalAborted: init?.signal?.aborted, responseStatus: 200, responseBody: { items: [] } }); return Response.json({ items: [] }); });
  secrets.values.set("secret://devin/main", "controlled-token");
  const service = new ControllerService({ ownerToken: TEST_OWNER_TOKEN, dataDirectory: directory, withRunner: true, secretStore: secrets, integrationFetch: fetchImpl });
  await service.start({ listen: false });
  try {
    const revision = service.configuration.current().revision;
    const input = { alias: "Draft", organizationId: "org-test", credentialRef: "secret://devin/main" };
    const invalid = await inject(service, { headers: OWNER, method: "POST", url: "/api/agents/devin/discover", payload: { ...input, createAsUserId: "\nuser" } });
    expect(invalid.statusCode).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
    const response = await inject(service, { headers: OWNER, method: "POST", url: "/api/agents/devin/discover", payload: { ...input, createAsUserId: "user-explicit" } });
    expect(response.json()).toMatchObject({ authenticated: true }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0]![1]?.method).toBeUndefined(); expect(fetchImpl.mock.calls[0]![1]?.body).toBeUndefined(); expect(service.configuration.current().revision).toBe(revision);
  } finally { captureTree(directory, "before-stop"); await service.stop(); }
});
