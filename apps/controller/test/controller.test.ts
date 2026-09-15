import { mkdtempSync, rmSync } from "node:fs";
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
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: secrets });
    await service.start({ listen: false });
    const saved = await service.app.inject({ method: "PUT", url: "/api/secrets/linear/main", payload: { value: "canary-secret-value" } });
    expect(saved.statusCode).toBe(201);
    expect(saved.body).not.toContain("canary-secret-value");
    const read = await service.app.inject({ method: "GET", url: "/api/secrets/linear/main" });
    expect(read.statusCode).toBe(404);
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
