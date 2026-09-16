import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecretAccessContext, SecretMetadata, SecretStore } from "@dispatcher/config";
import { ControllerService } from "../src/service.js";
import { LifecycleManager } from "../src/lifecycle.js";

const temporaryDirectories: string[] = [];
function dataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-controller-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class FakeSecretStore implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string, context: SecretAccessContext): Promise<boolean> { void context; return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string, context: SecretAccessContext): Promise<string> { void context; const value = this.values.get(reference); if (!value) throw new Error("missing"); return value; }
}

describe("ControllerService", () => {
  it("starts with an Embedded Runner and distinguishes readiness", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), withRunner: true, secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const health = await service.app.inject({ method: "GET", url: "/health" });
    const ready = await service.app.inject({ method: "GET", url: "/ready" });
    const runners = await service.app.inject({ method: "GET", url: "/api/runners" });
    expect(health.json()).toMatchObject({ status: "ok", lifecycle: "READY", mode: "embedded" });
    expect(ready.statusCode).toBe(200);
    expect(runners.json().runners[0]).toMatchObject({ id: "local", state: "ONLINE" });
    await service.stop();
  });

  it("restores persisted runner state across restart", async () => {
    const directory = dataDirectory();
    const first = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore() });
    await first.start({ listen: false });
    await first.stop();
    const second = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore() });
    await second.start({ listen: false });
    const runners = await second.app.inject({ method: "GET", url: "/api/runners" });
    expect(runners.json().runners[0]).toMatchObject({ id: "local", state: "ONLINE" });
    await second.stop();
  });

  it("creates and applies configuration plans through the API", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.controller.id = "api-controller";
    const built = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect(built.statusCode).toBe(201);
    const applied = await service.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/apply`, payload: {} });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().config.controller.id).toBe("api-controller");
    await service.stop();
  });

  it("never exposes a secret read endpoint", async () => {
    const secrets = new FakeSecretStore();
    const directory = dataDirectory();
    const service = new ControllerService({ dataDirectory: directory, secretStore: secrets });
    await service.start({ listen: false });
    const saved = await service.app.inject({ method: "PUT", url: "/api/secrets/linear/main", payload: { value: "canary-secret-value" } });
    expect(saved.statusCode).toBe(201);
    expect(saved.body).not.toContain("canary-secret-value");
    expect(saved.json().secret).toMatchObject({
      reference: "secret://linear/main",
      backend: "encrypted-local",
      exists: true,
      lastTestStatus: null,
      lastTestedAt: null,
    });
    const tested = await service.app.inject({ method: "POST", url: "/api/secrets/linear/main/test" });
    expect(tested.json()).toMatchObject({ ok: true, secret: { lastTestStatus: "ok" } });
    expect(tested.body).not.toContain("canary-secret-value");
    const read = await service.app.inject({ method: "GET", url: "/api/secrets/linear/main" });
    expect(read.statusCode).toBe(404);
    expect(JSON.stringify(service.configuration.exportRedacted())).not.toContain("canary-secret-value");
    expect(JSON.stringify(service.database.listAudit())).not.toContain("canary-secret-value");
    await service.stop();
    for (const name of readdirSync(directory).filter((entry) => entry.startsWith("dispatcher.sqlite"))) {
      expect(readFileSync(join(directory, name)).toString("utf8")).not.toContain("canary-secret-value");
    }
  });

  it("blocks activation until every required secret reference exists", async () => {
    const secrets = new FakeSecretStore();
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: secrets });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.integrations.linear = { enabled: true, credentialRef: "secret://linear/main" };
    const built = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    const missing = await service.app.inject({
      method: "POST",
      url: `/api/config/plans/${built.json().plan.id}/apply`,
      payload: { confirmed: true },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: "SECRET_REFERENCE_MISSING" });
    expect((await service.app.inject({ method: "GET", url: "/api/config" })).json().revision).toBe(current.revision);
    await service.app.inject({ method: "PUT", url: "/api/secrets/linear/main", payload: { value: "canary-secret-value" } });
    const applied = await service.app.inject({
      method: "POST",
      url: `/api/config/plans/${built.json().plan.id}/apply`,
      payload: { confirmed: true },
    });
    expect(applied.statusCode).toBe(200);
    const inUse = await service.app.inject({ method: "DELETE", url: "/api/secrets/linear/main" });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toMatchObject({ code: "SECRET_IN_USE" });
    await service.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/rollback` });
    expect((await service.app.inject({ method: "DELETE", url: "/api/secrets/linear/main" })).statusCode).toBe(204);
    await service.stop();
  });

  it("returns schema validation failures as safe client errors", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.integrations.linear = { enabled: true };
    const response = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CONFIGURATION" });
    await service.stop();
  });

  it("manages Internal LLM profiles through ConfigPlan and preserves the active profile on failed switch", async () => {
    const secrets = new FakeSecretStore();
    secrets.values.set("secret://llm/primary", "primary-secret");
    secrets.values.set("secret://llm/backup", "backup-secret");
    let backupFails = false;
    const service = new ControllerService({
      dataDirectory: dataDirectory(),
      secretStore: secrets,
      llmFetch: async (input) => {
        const url = String(input);
        if (url.includes("backup") && backupFails) return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
        return url.includes("chat/completions")
          ? new Response(JSON.stringify({ choices: [{ message: { content: "backup" } }], usage: {} }), { status: 200 })
          : new Response(JSON.stringify({ output_text: "primary", usage: {} }), { status: 200 });
      },
    });
    await service.start({ listen: false });
    const config = {
      configured: true,
      endpoints: [
        { id: "primary", protocol: "openai-responses", baseUrl: "https://primary.example/v1", credentialRef: "secret://llm/primary" },
        { id: "backup", protocol: "openai-chat", baseUrl: "https://backup.example/v1", credentialRef: "secret://llm/backup" },
      ],
      profiles: [
        { id: "primary", endpointId: "primary", alias: "Primary", model: "a", enabled: true },
        { id: "backup", endpointId: "backup", alias: "Backup", model: "b", enabled: true },
      ],
      pools: [{ id: "default", profileIds: ["primary", "backup"] }],
      roleBindings: [{ role: "command_parser", poolId: "default" }],
      defaultPoolId: "default",
    };
    const applied = await service.app.inject({ method: "PUT", url: "/api/llm/config", payload: { config, confirmed: true } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().plan).toMatchObject({ risk: "sensitive", state: "PLANNED" });
    await service.app.inject({ method: "POST", url: "/api/llm/roles/command_parser/switch", payload: { profileId: "primary" } });
    backupFails = true;
    const failed = await service.app.inject({ method: "POST", url: "/api/llm/roles/command_parser/switch", payload: { profileId: "backup" } });
    expect(failed.statusCode).toBe(503);
    const view = (await service.app.inject({ method: "GET", url: "/api/llm" })).json();
    expect(view.state.activeProfileByRole.command_parser).toBe("primary");
    expect(JSON.stringify(view)).not.toContain("primary-secret");
    await service.stop();
  });

  it("persists wizard progress without draft secret data", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const setup = (await service.app.inject({ method: "GET", url: "/api/setup" })).json();
    const saved = await service.app.inject({ method: "POST", url: "/api/setup", payload: { step: 2, completed: false, configRevision: setup.config.revision } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("secret");
    expect((await service.app.inject({ method: "GET", url: "/api/setup" })).json().state.step).toBe(2);
    await service.stop();
  });

  it("restores the completed setup step and canonical config after restart", async () => {
    const directory = dataDirectory();
    const first = new ControllerService({ dataDirectory: directory, secretStore: new FakeSecretStore() });
    await first.start({ listen: false });
    const current = (await first.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.controller.id = "wizard-controller";
    const built = await first.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config, actor: "setup-wizard" } });
    const applied = await first.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/apply`, payload: {} });
    await first.app.inject({ method: "POST", url: "/api/setup", payload: { step: 4, completed: true, configRevision: applied.json().revision } });
    await first.stop();

    const second = new ControllerService({ dataDirectory: directory, secretStore: new FakeSecretStore() });
    await second.start({ listen: false });
    const restored = (await second.app.inject({ method: "GET", url: "/api/setup" })).json();
    expect(restored.state).toMatchObject({ step: 4, completed: true, configRevision: applied.json().revision });
    expect(restored.config.config.controller.id).toBe("wizard-controller");
    expect(() => JSON.parse(JSON.stringify(second.configuration.exportRedacted()))).not.toThrow();
    await second.stop();
  });
});

describe("LifecycleManager", () => {
  it("rolls back already-started modules when startup fails", async () => {
    const stopped = vi.fn();
    const lifecycle = new LifecycleManager([
      { name: "first", start: vi.fn(), stop: stopped },
      { name: "broken", start: () => { throw new Error("broken"); }, stop: vi.fn() },
    ]);
    await expect(lifecycle.start()).rejects.toThrow("broken");
    expect(stopped).toHaveBeenCalledOnce();
    expect(lifecycle.state).toBe("FAILED");
  });
});
