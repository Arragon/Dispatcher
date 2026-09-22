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
import { MemorySessionStore, type SessionStore } from "./generic.js";
import type { CredentialResolver } from "./ecosystem-cli.js";

export interface DevinProfileConfig {
  id: string;
  alias: string;
  organizationId: string;
  credentialRef: string;
  apiBase?: string;
  maxSessionAcu?: number;
}

export interface DevinSessionSnapshot {
  sessionId: string;
  status: string;
  url?: string;
  acusConsumed?: number;
  pullRequests: Array<{ url: string; state?: string }>;
  waitingReason?: string;
  summary?: string;
}

export interface DevinBackend {
  health(): Promise<{ ok: boolean; diagnostic?: string }>;
  create(input: { prompt: string; maxSessionAcu?: number }): Promise<DevinSessionSnapshot>;
  get(sessionId: string): Promise<DevinSessionSnapshot>;
  send(sessionId: string, message: string): Promise<DevinSessionSnapshot>;
}

export const devinManifest: AdapterManifest = {
  apiVersion: 1,
  id: "devin",
  displayName: "Devin API",
  platforms: ["darwin", "linux", "win32"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias", "organizationId", "credentialRef"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      organizationId: { type: "string", minLength: 1, pattern: "^org-" },
      credentialRef: { type: "string", pattern: "^secret://devin/[a-z0-9][a-z0-9._/-]*$" },
      apiBase: { type: "string", format: "uri", default: "https://api.devin.ai" },
      maxSessionAcu: { type: "number", exclusiveMinimum: 0 },
    },
  },
  uiSchema: { credentialRef: { "ui:widget": "hidden" } },
  secretFields: ["credentialRef"],
  probes: [
    { id: "devin-api", kind: "auth", description: "Authenticate against the Devin v3 organization sessions API", timeoutMs: 8_000 },
    { id: "devin-quota", kind: "capability", description: "Read session ACU consumption and configured budget", timeoutMs: 8_000 },
  ],
  backends: [{ id: "devin-v3-api", kind: "api", priority: 1, capabilities: ["code", "git", "start", "send", "resume", "status", "result", "waiting-user", "usage", "quota", "artifacts"] }],
  capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
};

export class HttpDevinBackend implements DevinBackend {
  constructor(
    private readonly profile: DevinProfileConfig,
    private readonly resolveCredential: CredentialResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async health(): Promise<{ ok: boolean; diagnostic?: string }> {
    const response = await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions?first=1`);
    return response.ok ? { ok: true } : { ok: false, diagnostic: `Devin API returned ${response.status}` };
  }

  async create(input: { prompt: string; maxSessionAcu?: number }): Promise<DevinSessionSnapshot> {
    const response = await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions`, {
      method: "POST",
      body: JSON.stringify({ prompt: input.prompt }),
    });
    return parseResponse(response);
  }

  async get(sessionId: string): Promise<DevinSessionSnapshot> {
    return parseResponse(await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions/${encodeURIComponent(sessionId)}`));
  }

  async send(sessionId: string, message: string): Promise<DevinSessionSnapshot> {
    return parseResponse(await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }));
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.resolveCredential(this.profile.credentialRef);
    const response = await this.fetchImpl(`${(this.profile.apiBase ?? "https://api.devin.ai").replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
    return response;
  }
}

export class DevinAdapter implements AgentAdapter {
  readonly manifest = validateManifest(devinManifest);
  private readonly backend: DevinBackend;
  private readonly snapshots = new Map<string, DevinSessionSnapshot>();

  constructor(
    readonly profile: DevinProfileConfig,
    backend?: DevinBackend,
    private readonly store: SessionStore = new MemorySessionStore(),
    resolveCredential?: CredentialResolver,
    fetchImpl?: typeof fetch,
  ) {
    if (!backend && !resolveCredential) throw new AdapterContractError("SECRET_RESOLVER_UNAVAILABLE", "Devin API requires a SecretStore resolver");
    this.backend = backend ?? new HttpDevinBackend(profile, resolveCredential!, fetchImpl);
  }

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const snapshot = await this.backend.create({ prompt: input.prompt ?? "Inspect the task and report readiness.", ...(this.profile.maxSessionAcu ? { maxSessionAcu: this.profile.maxSessionAcu } : {}) });
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: randomUUID(),
      runId: input.runId,
      backendId: input.backendId ?? "devin-v3-api",
      workspacePath: input.workspacePath,
      state: mapState(snapshot.status),
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
    if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", "Devin session id is missing");
    const snapshot = await this.backend.send(session.providerSessionId, message);
    this.snapshots.set(sessionId, snapshot);
    this.update(sessionId, { state: mapState(snapshot.status) });
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length, providerSessionId: snapshot.sessionId } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "The Devin v3 API does not expose a pause operation"); }
  async resume(sessionId: string): Promise<AdapterSession> { await this.send(sessionId, "Continue from the current session context."); return this.status(sessionId); }
  async cancel(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "The verified Devin v3 session API does not expose a cancellation endpoint"); }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    if (!session.providerSessionId) return structuredClone(session);
    const snapshot = await this.backend.get(session.providerSessionId);
    this.snapshots.set(sessionId, snapshot);
    return this.update(sessionId, { state: mapState(snapshot.status) });
  }
  async result(sessionId: string): Promise<AdapterResult> {
    const session = await this.status(sessionId);
    const snapshot = this.snapshots.get(sessionId);
    return {
      sessionId,
      state: session.state,
      summary: snapshot?.summary ?? snapshot?.waitingReason ?? `Devin session ${snapshot?.status ?? session.state.toLowerCase()}`,
      artifacts: snapshot?.pullRequests.map((pr) => ({ path: pr.url, kind: "pull-request" })) ?? [],
    };
  }
  async usage(sessionId: string): Promise<Record<string, unknown>> {
    await this.status(sessionId);
    const snapshot = this.snapshots.get(sessionId);
    const consumed = snapshot?.acusConsumed;
    const limit = this.profile.maxSessionAcu;
    return {
      state: limit && consumed !== undefined && consumed >= limit ? "QUOTA_EXHAUSTED" : limit && consumed !== undefined && consumed / limit >= 0.8 ? "LOW" : "AVAILABLE",
      ...(consumed === undefined ? {} : { consumed }),
      ...(limit === undefined ? {} : { limit, remaining: Math.max(0, limit - (consumed ?? 0)) }),
      source: "sdk",
      confidence: consumed === undefined ? "low" : "high",
    };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.require(sessionId);
    const health = await this.backend.health();
    return { sessionId, profileId: session.profileId, providerSessionId: session.providerSessionId, apiVersion: "v3", health: health.ok ? "HEALTHY" : "DEGRADED", ...(health.diagnostic ? { diagnostic: health.diagnostic } : {}) };
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

export async function probeDevinProfile(profile: DevinProfileConfig, resolveCredential: CredentialResolver, fetchImpl?: typeof fetch): Promise<{ authenticated: boolean; apiVersion: "v3"; diagnostic?: string }> {
  try {
    const health = await new HttpDevinBackend(profile, resolveCredential, fetchImpl).health();
    return { authenticated: health.ok, apiVersion: "v3", ...(health.diagnostic ? { diagnostic: health.diagnostic } : {}) };
  } catch (error) {
    return { authenticated: false, apiVersion: "v3", diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Devin API probe failed" };
  }
}

function mapState(status: string): AdapterSession["state"] {
  const normalized = status.toLowerCase();
  if (["exit", "completed", "done"].includes(normalized)) return "COMPLETED";
  if (["error", "failed"].includes(normalized)) return "FAILED";
  if (["suspended", "waiting_for_user", "waiting"].includes(normalized)) return "PAUSED";
  return "RUNNING";
}

async function parseResponse(response: Response): Promise<DevinSessionSnapshot> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(body.detail ?? body.message ?? `Devin API returned ${response.status}`);
    const code = response.status === 401 || response.status === 403 ? "AUTH_ERROR" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
    throw new AdapterContractError(code, message.slice(0, 500));
  }
  const sessionId = stringValue(body.session_id) ?? stringValue(body.devin_id);
  if (!sessionId) throw new AdapterContractError("INVALID_PROVIDER_RESPONSE", "Devin response is missing session_id");
  const pullRequests = Array.isArray(body.pull_requests) ? body.pull_requests.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const url = stringValue(record.pr_url) ?? stringValue(record.url);
    return url ? [{ url, ...(stringValue(record.pr_state) ?? stringValue(record.state) ? { state: (stringValue(record.pr_state) ?? stringValue(record.state))! } : {}) }] : [];
  }) : [];
  return {
    sessionId,
    status: stringValue(body.status) ?? "unknown",
    ...(stringValue(body.url) ? { url: stringValue(body.url)! } : {}),
    ...(numberValue(body.acus_consumed) === undefined ? {} : { acusConsumed: numberValue(body.acus_consumed)! }),
    pullRequests,
    ...(stringValue(body.waiting_reason) ? { waitingReason: stringValue(body.waiting_reason)! } : {}),
    ...(stringValue(body.summary) ? { summary: stringValue(body.summary)! } : {}),
  };
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
