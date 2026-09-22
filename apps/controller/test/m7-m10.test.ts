import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QoderBackend } from "@dispatcher/adapters";
import type { SecretAccessContext, SecretMetadata, SecretStore } from "@dispatcher/config";
import { ControllerService } from "../src/service.js";

const directories: string[] = [];
class Secrets implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string, context: SecretAccessContext): Promise<boolean> { void context; return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string, context: SecretAccessContext): Promise<string> { void context; const value = this.values.get(reference); if (!value) throw new Error("missing secret"); return value; }
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("M7-M10 Alpha control plane", () => {
  it("exposes rebuildable Fleet views and persisted typed workflows without an LLM", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-alpha-"));
    directories.push(directory);
    const service = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new Secrets() });
    await service.start({ listen: false });
    const fleet = await service.app.inject({ method: "GET", url: "/api/fleet" });
    expect(fleet.statusCode).toBe(200);
    expect(fleet.json().snapshot).toMatchObject({ version: 2, counts: { tasks: 0, activeRuns: 0 } });
    const planned = await service.app.inject({ method: "POST", url: "/api/assistant/workflows", payload: { text: "/fleet list" } });
    expect(planned.statusCode).toBe(201);
    expect(planned.json()).toMatchObject({ mode: "DEGRADED_NO_LLM", workflow: { state: "READY", toolName: "fleet.list" } });
    const executed = await service.app.inject({ method: "POST", url: `/api/assistant/workflows/${planned.json().workflow.id}/execute`, payload: { revision: planned.json().workflow.revision } });
    expect(executed.json().workflow).toMatchObject({ state: "EXECUTED", result: { version: 2 } });
    await service.stop();
    const restored = new ControllerService({ dataDirectory: directory, secretStore: new Secrets() });
    await restored.start({ listen: false });
    expect((await restored.app.inject({ method: "GET", url: `/api/assistant/workflows/${planned.json().workflow.id}` })).json().workflow.state).toBe("EXECUTED");
    await restored.stop();
  });

  it("keeps Codex and Qoder provider-neutral in Fleet and manifests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-qoder-"));
    directories.push(directory);
    const backend: QoderBackend = { start: () => ({ cancel: async () => undefined, status: () => "completed", result: async () => ({ state: "completed", summary: "done", events: [] }) }) };
    const service = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new Secrets(), qoderBackendFactory: () => backend });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.agentProfiles = [{ id: "alice", provider: "qoder", alias: "Alice", runnerId: "local", settings: { executable: "/opt/qoder" } }];
    const plan = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
    expect((await service.app.inject({ method: "GET", url: "/api/adapters/manifests" })).json().manifests.map((manifest: { id: string }) => manifest.id)).toContain("qoder");
    expect((await service.app.inject({ method: "GET", url: "/api/fleet" })).json().snapshot.profiles).toContainEqual(expect.objectContaining({ id: "alice", provider: "qoder", state: "CONFIGURED" }));
    await service.stop();
  });

  it("closes signed Slack command ingress, identity authorization, reply and restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-slack-"));
    directories.push(directory);
    const secrets = new Secrets();
    secrets.values.set("secret://slack/bot", "xoxb-hidden");
    secrets.values.set("secret://slack/signing", "signing-secret");
    const outbound = vi.fn(async (input: string | URL | Request) => String(input).endsWith("/auth.test")
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ ok: true, ts: "200.1" }), { status: 200 }));
    const configure = async (service: ControllerService): Promise<void> => {
      const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
      current.config.connectors = [{ id: "slack-main", definitionId: "messaging.slack", kind: "messaging", displayName: "Slack", enabled: true, credentialRef: "secret://slack/bot", settings: { signingSecretRef: "secret://slack/signing", alertChannel: "C-alert", apiBase: "https://slack.invalid/api" } }];
      const plan = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
      expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
      expect((await service.app.inject({ method: "POST", url: "/api/connectors/slack-main/messaging-identities", payload: { externalPrincipalId: "U1", principalId: "user-1", roles: ["operator", "admin"] } })).statusCode).toBe(201);
    };
    const first = new ControllerService({ dataDirectory: directory, secretStore: secrets, integrationFetch: outbound });
    await first.start({ listen: false });
    await configure(first);
    const send = async (service: ControllerService, eventId: string, text = "/fleet list"): Promise<number> => {
      const body = JSON.stringify({ event_id: eventId, event: { type: "message", ts: eventId === "Ev1" ? "100.1" : "100.2", channel: "C1", user: "U1", text } });
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const signature = `v0=${createHmac("sha256", "signing-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
      return (await service.app.inject({ method: "POST", url: "/api/connectors/slack-main/webhook", headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature }, payload: body })).statusCode;
    };
    expect(await send(first, "Ev1")).toBe(202);
    expect(outbound).toHaveBeenCalled();
    expect(JSON.stringify(outbound.mock.calls)).not.toContain("signing-secret");
    expect(await send(first, "EvSecret", "use xoxb-user-secret-12345678")).toBe(202);
    expect(JSON.stringify(first.database.getEntity("messaging-inbox", "slack-main:EvSecret"))).not.toContain("xoxb-user-secret");
    expect(String(outbound.mock.calls.at(-1)?.[1]?.body)).toContain("/auth/messaging?ticket=");
    expect(String(outbound.mock.calls.at(-1)?.[1]?.body)).not.toContain("xoxb-user-secret");
    const current = (await first.app.inject({ method: "GET", url: "/api/config" })).json();
    const plan = (await first.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } })).json().plan;
    const workflow = (await first.app.inject({ method: "POST", url: "/api/assistant/workflows", payload: { actor: "user-1", roles: ["operator", "admin"], channel: "messaging", intent: { version: 2, action: "config.apply", entities: [], arguments: { planId: plan.id }, confidence: 1, source: "messaging" } } })).json().workflow;
    expect(workflow.state).toBe("NEEDS_APPROVAL");
    const actionBody = JSON.stringify({ trigger_id: "T1", user: { id: "U1" }, channel: { id: "C1" }, container: { message_ts: "100.3", thread_ts: "100.3" }, actions: [{ action_id: "workflow.approve", value: JSON.stringify({ workflowId: workflow.id, expectedRevision: workflow.revision }) }] });
    const actionTimestamp = String(Math.floor(Date.now() / 1_000));
    const actionSignature = `v0=${createHmac("sha256", "signing-secret").update(`v0:${actionTimestamp}:${actionBody}`).digest("hex")}`;
    expect((await first.app.inject({ method: "POST", url: "/api/connectors/slack-main/webhook", headers: { "content-type": "application/json", "x-slack-request-timestamp": actionTimestamp, "x-slack-signature": actionSignature }, payload: actionBody })).statusCode).toBe(202);
    expect((await first.app.inject({ method: "GET", url: `/api/assistant/workflows/${workflow.id}` })).json().workflow.state).toBe("EXECUTED");
    const callsBeforeRestart = outbound.mock.calls.length;
    await first.stop();
    const second = new ControllerService({ dataDirectory: directory, secretStore: secrets, integrationFetch: outbound });
    await second.start({ listen: false });
    expect(await send(second, "Ev1")).toBe(202);
    expect(outbound).toHaveBeenCalledTimes(callsBeforeRestart);
    await second.stop();
  });
});
