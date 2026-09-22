import { randomUUID } from "node:crypto";
import {
  AdapterContractError,
  validateManifest,
  type AdapterEvent,
  type AdapterManifest,
  type AdapterResult,
  type AdapterSession,
  type AgentAdapter,
} from "./contracts.js";
import type { CredentialResolver } from "./ecosystem-cli.js";
import { MemorySessionStore, type SessionStore } from "./generic.js";

export interface LocalServiceProfileConfig {
  id: string;
  alias: string;
  provider: "workbuddy" | "codebuddy";
  baseUrl: string;
  healthPath: string;
  startPath: string;
  statusPath: string;
  inputPath: string;
  cancelPath: string;
  resourcePath?: string;
  credentialRef?: string;
}

interface LocalServiceSnapshot {
  sessionId: string;
  state: string;
  summary?: string;
  artifacts: Array<{ path: string; kind: string }>;
  resource?: Record<string, unknown>;
}

export const localServiceManifest: AdapterManifest = {
  apiVersion: 1,
  id: "workbuddy-codebuddy",
  displayName: "WorkBuddy / CodeBuddy Local Service",
  platforms: ["darwin", "linux", "win32"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias", "provider", "baseUrl", "healthPath", "startPath", "statusPath", "inputPath", "cancelPath"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      provider: { enum: ["workbuddy", "codebuddy"] },
      baseUrl: { type: "string", format: "uri" },
      healthPath: { type: "string", pattern: "^/", default: "/health" },
      startPath: { type: "string", pattern: "^/" },
      statusPath: { type: "string", pattern: "^/", description: "Use {sessionId} as a complete path segment placeholder." },
      inputPath: { type: "string", pattern: "^/", description: "Use {sessionId} as a complete path segment placeholder." },
      cancelPath: { type: "string", pattern: "^/", description: "Use {sessionId} as a complete path segment placeholder." },
      resourcePath: { type: "string", pattern: "^/", description: "Optional resource endpoint; may use {sessionId}." },
      credentialRef: { type: "string", pattern: "^secret://(?:workbuddy|codebuddy)/[a-z0-9][a-z0-9._/-]*$" },
    },
  },
  uiSchema: { credentialRef: { "ui:widget": "hidden" } },
  secretFields: ["credentialRef"],
  probes: [
    { id: "local-service-health", kind: "capability", description: "Call the configured local-service health endpoint", timeoutMs: 5_000 },
    { id: "local-service-contract", kind: "capability", description: "Validate the configured run/session endpoint templates", timeoutMs: 1_000 },
  ],
  backends: [{ id: "local-service-http", kind: "daemon", priority: 1, capabilities: ["code", "start", "send", "status", "cancel", "result", "interactive-input", "artifacts", "resource-probe"] }],
  capabilities: { pause: false, resume: false, usage: true, diagnostics: true },
};

export class LocalServiceAdapter implements AgentAdapter {
  readonly manifest = validateManifest(localServiceManifest);
  private readonly snapshots = new Map<string, LocalServiceSnapshot>();

  constructor(
    readonly profile: LocalServiceProfileConfig,
    private readonly resolveCredential?: CredentialResolver,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly store: SessionStore = new MemorySessionStore(),
  ) {
    for (const path of [profile.statusPath, profile.inputPath, profile.cancelPath]) validateSessionPath(path);
  }

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const snapshot = await this.requestSnapshot(this.profile.startPath, {
      method: "POST",
      body: JSON.stringify({ runId: input.runId, workspacePath: input.workspacePath, prompt: input.prompt ?? "Inspect the task and report readiness." }),
    });
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: randomUUID(),
      runId: input.runId,
      backendId: input.backendId ?? "local-service-http",
      workspacePath: input.workspacePath,
      state: mapState(snapshot.state),
      profileId: this.profile.id,
      providerSessionId: snapshot.sessionId,
      createdAt: now,
      updatedAt: now,
    };
    this.snapshots.set(session.id, snapshot);
    this.store.save(session);
    return structuredClone(session);
  }
  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    const session = this.require(sessionId);
    const providerSessionId = requireProviderSession(session);
    const snapshot = await this.requestSnapshot(renderSessionPath(this.profile.inputPath, providerSessionId), { method: "POST", body: JSON.stringify({ message }) });
    this.snapshots.set(sessionId, snapshot);
    this.update(sessionId, { state: mapState(snapshot.state) });
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length, providerSessionId } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "The local-service contract does not declare pause"); }
  async resume(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "The local-service contract does not declare same-session resume"); }
  async cancel(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const snapshot = await this.requestSnapshot(renderSessionPath(this.profile.cancelPath, requireProviderSession(session)), { method: "POST" });
    this.snapshots.set(sessionId, snapshot);
    return this.update(sessionId, { state: snapshot.state ? mapState(snapshot.state) : "CANCELLED" });
  }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const snapshot = await this.requestSnapshot(renderSessionPath(this.profile.statusPath, requireProviderSession(session)));
    this.snapshots.set(sessionId, snapshot);
    return this.update(sessionId, { state: mapState(snapshot.state) });
  }
  async result(sessionId: string): Promise<AdapterResult> {
    const current = this.require(sessionId);
    const session = ["CANCELLED", "COMPLETED", "FAILED"].includes(current.state) ? current : await this.status(sessionId);
    const snapshot = this.snapshots.get(sessionId);
    return { sessionId, state: session.state, summary: snapshot?.summary ?? `${this.profile.provider} session ${session.state.toLowerCase()}`, artifacts: snapshot?.artifacts ?? [] };
  }
  async usage(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.require(sessionId);
    if (!this.profile.resourcePath) return { state: "UNKNOWN", reason: "No resource endpoint configured", source: "probe", confidence: "low" };
    const path = this.profile.resourcePath.includes("{sessionId}") ? renderSessionPath(this.profile.resourcePath, requireProviderSession(session)) : this.profile.resourcePath;
    const response = await this.request(path);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AdapterContractError("RESOURCE_PROBE_FAILED", `Local service returned ${response.status}`);
    return { ...body, source: typeof body.source === "string" ? body.source : "sdk", confidence: typeof body.confidence === "string" ? body.confidence : "medium" };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    this.require(sessionId);
    const health = await this.request(this.profile.healthPath);
    return { sessionId, provider: this.profile.provider, health: health.ok ? "HEALTHY" : "DEGRADED", statusCode: health.status, endpointContract: "configured-v1" };
  }

  private async requestSnapshot(path: string, init: RequestInit = {}): Promise<LocalServiceSnapshot> {
    const response = await this.request(path, init);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AdapterContractError(response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "PROVIDER_ERROR", String(body.message ?? `Local service returned ${response.status}`).slice(0, 500));
    const sessionId = stringValue(body.sessionId) ?? stringValue(body.session_id) ?? stringValue(body.id);
    if (!sessionId) throw new AdapterContractError("INVALID_PROVIDER_RESPONSE", "Local service response is missing sessionId");
    const artifacts = Array.isArray(body.artifacts) ? body.artifacts.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const path = stringValue(record.path) ?? stringValue(record.url);
      return path ? [{ path, kind: stringValue(record.kind) ?? "artifact" }] : [];
    }) : [];
    return {
      sessionId,
      state: stringValue(body.state) ?? stringValue(body.status) ?? "running",
      ...(stringValue(body.summary) ? { summary: stringValue(body.summary)! } : {}),
      artifacts,
      ...(body.resource && typeof body.resource === "object" && !Array.isArray(body.resource) ? { resource: body.resource as Record<string, unknown> } : {}),
    };
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.profile.credentialRef) {
      if (!this.resolveCredential) throw new AdapterContractError("SECRET_RESOLVER_UNAVAILABLE", "Credential references require a SecretStore resolver");
      headers.authorization = `Bearer ${await this.resolveCredential(this.profile.credentialRef)}`;
    }
    return this.fetchImpl(`${this.profile.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(10_000) });
  }
  private require(id: string): AdapterSession {
    const session = this.store.load(id);
    if (!session) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`);
    return session;
  }
  private update(id: string, changes: Partial<AdapterSession>): AdapterSession {
    const updated = { ...this.require(id), ...changes, updatedAt: new Date().toISOString() };
    this.store.save(updated);
    return structuredClone(updated);
  }
}

export async function probeLocalService(profile: LocalServiceProfileConfig, resolveCredential?: CredentialResolver, fetchImpl: typeof fetch = fetch): Promise<{ healthy: boolean; statusCode?: number; diagnostic?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (profile.credentialRef) {
      if (!resolveCredential) return { healthy: false, diagnostic: "Credential reference cannot be resolved in this runtime" };
      headers.authorization = `Bearer ${await resolveCredential(profile.credentialRef)}`;
    }
    const response = await fetchImpl(`${profile.baseUrl.replace(/\/$/, "")}${profile.healthPath}`, { headers, signal: AbortSignal.timeout(5_000) });
    return { healthy: response.ok, statusCode: response.status, ...(!response.ok ? { diagnostic: `Health endpoint returned ${response.status}` } : {}) };
  } catch (error) {
    return { healthy: false, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Health probe failed" };
  }
}

function validateSessionPath(path: string): void {
  const segments = path.split("/");
  if (!path.startsWith("/") || !segments.includes("{sessionId}")) throw new AdapterContractError("INVALID_ENDPOINT_TEMPLATE", "Session endpoint paths must contain {sessionId} as a complete path segment");
}
function renderSessionPath(path: string, sessionId: string): string { validateSessionPath(path); return path.replace("{sessionId}", encodeURIComponent(sessionId)); }
function requireProviderSession(session: AdapterSession): string {
  if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_ATTACHED", "Provider session id is missing");
  return session.providerSessionId;
}
function mapState(value: string): AdapterSession["state"] {
  const normalized = value.toLowerCase();
  if (["completed", "done", "success", "exit"].includes(normalized)) return "COMPLETED";
  if (["failed", "error"].includes(normalized)) return "FAILED";
  if (["cancelled", "canceled"].includes(normalized)) return "CANCELLED";
  if (["paused", "waiting", "waiting_for_user"].includes(normalized)) return "PAUSED";
  return "RUNNING";
}
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
