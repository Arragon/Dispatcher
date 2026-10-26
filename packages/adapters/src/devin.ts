import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assessInteractionCapability, type CapabilityEvidence, type HistoryPage, type HistoryRequest, type InteractionCapabilities, type NativeAccessDescriptor, type NativeBinding, type NativeObservation } from "@dispatcher/domain";
import type { NativeInteractionPort, NativeReadRequest } from "./interaction-contracts.js";
import {freezeExecutionSelection} from "./execution-selection.js";
import {turnExecutionResource} from "./execution-resource.js";
import {
  AdapterContractError,
  assertAdapterStartAdmission,
  assertAdapterWriteAdmission,
  captureAdapterStartInput,
  AdapterStartError,
  type AdapterStartInput,
  validateManifest,
  type AdapterEvent,
  type AdapterManifest,
  type AdapterResult,
  type AdapterSession,
  type AgentAdapter,
} from "./contracts.js";
import { MemorySessionStore, startSessionId, type SessionStore } from "./generic.js";
import type { CredentialResolver } from "./ecosystem-cli.js";

export interface DevinProfileConfig {
  id: string;
  alias: string;
  organizationId: string;
  credentialRef: string;
  apiBase?: string;
  maxSessionAcu?: number;
  createAsUserId?: string;
}

export interface DevinSessionSnapshot {
  sessionId: string;
  status: string;
  url?: string;
  acusConsumed?: number;
  pullRequests: Array<{ url: string; state?: string }>;
  waitingReason?: string;
  summary?: string;
  organizationId?: string;
  userId?: string;
  serviceUserId?: string;
  statusDetail?: string;
}

export interface DevinBackend {
  /** Calls the supplied guard at its last write boundary, after async preparation. */
  readonly supportsFinalAdmission?:true;
  health(): Promise<{ ok: boolean; diagnostic?: string }>;
  create(input: { prompt: string; maxSessionAcu?: number },beforeSend?:()=>void): Promise<DevinSessionSnapshot>;
  get(sessionId: string): Promise<DevinSessionSnapshot>;
  send(sessionId: string, message: string,beforeSend?:()=>void): Promise<DevinSessionSnapshot>;
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
      maxSessionAcu: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      createAsUserId: { type: "string", minLength: 1, maxLength: 512, pattern: "^(?!.*[\\u0000\\r\\n])(?=.*\\S).*$", title: "Explicit session owner", description: "Optional human user ID; requires native ImpersonateOrgSessions permission. Omit to retain the credential principal." },
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
  readonly supportsFinalAdmission = true;
  private readonly profile: DevinProfileConfig;
  constructor(
    profile: DevinProfileConfig,
    private readonly resolveCredential: CredentialResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) { this.profile = structuredClone(profile); }

  get connectionScope(): { profileId: string; organizationId: string } {
    return { profileId: this.profile.id, organizationId: this.profile.organizationId };
  }

  async health(): Promise<{ ok: boolean; diagnostic?: string }> {
    validateCreationProfile(this.profile);
    const response = await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions?first=1`);
    void response.body?.cancel().catch(() => {});
    return response.ok ? { ok: true } : { ok: false, diagnostic: `Devin API returned ${response.status}` };
  }

  async create(input: { prompt: string; maxSessionAcu?: number }, beforeSend?: () => void): Promise<DevinSessionSnapshot> {
    input = structuredClone(input);
    validateCreationProfile(this.profile);
    const cap = this.profile.maxSessionAcu === undefined ? input.maxSessionAcu : input.maxSessionAcu === undefined ? this.profile.maxSessionAcu : Math.min(this.profile.maxSessionAcu, input.maxSessionAcu);
    if (input.maxSessionAcu !== undefined && (!Number.isSafeInteger(input.maxSessionAcu) || input.maxSessionAcu <= 0)) throw new AdapterStartError("not-created", "DEVIN_ACU_LIMIT_INVALID", "Devin ACU limit must be a positive native integer");
    const signal = AbortSignal.timeout(10_000);
    const response = await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions`, {
      method: "POST",
      signal,
      body: JSON.stringify({ prompt: input.prompt, ...(this.profile.createAsUserId ? { create_as_user_id: this.profile.createAsUserId } : {}), ...(cap === undefined ? {} : { max_acu_limit: cap }) }),
    }, beforeSend, true);
    return parseResponse(response, this.profile, undefined, true, signal);
  }

  async get(sessionId: string, signal = AbortSignal.timeout(10_000)): Promise<DevinSessionSnapshot> {
    return parseResponse(await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions/${encodeURIComponent(sessionId)}`, { signal }), this.profile, sessionId, false, signal);
  }

  async send(sessionId: string, message: string, beforeSend?: () => void): Promise<DevinSessionSnapshot> {
    const signal = AbortSignal.timeout(10_000);
    return parseResponse(await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      signal,
      body: JSON.stringify({ message }),
    }, beforeSend), this.profile, sessionId, false, signal);
  }

  async messages(sessionId: string, input: HistoryRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ first: String(input.limit), ...(input.cursor === undefined ? {} : { after: input.cursor }) });
    const response = await this.request(`/v3/organizations/${encodeURIComponent(this.profile.organizationId)}/sessions/${encodeURIComponent(sessionId)}/messages?${query}`, { signal });
    assertResponse(response);
    return readJson(response, signal);
  }

  private async request(path: string, init: RequestInit = {}, beforeSend?: () => void, creation = false): Promise<Response> {
    const signal = init.signal ?? AbortSignal.timeout(10_000);
    checkRead(signal);
    let token: string;
    try { token = await abortable(this.resolveCredential(this.profile.credentialRef), signal); }
    catch {
      if (signal.aborted) throw failure("DEVIN_READ_CANCELLED");
      if (creation) throw new AdapterStartError("not-created", "START_PREPARATION_FAILED", "Devin credential is unavailable before creation");
      throw failure("DEVIN_CREDENTIAL_UNAVAILABLE");
    }
    checkRead(signal);
    const options: RequestInit = {
      ...init,
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal,
    };
    if (creation) assertAdapterStartAdmission(beforeSend); else assertAdapterWriteAdmission(beforeSend);
    try { return await abortable(this.fetchImpl(`${(this.profile.apiBase ?? "https://api.devin.ai").replace(/\/$/, "")}${path}`, options), signal); }
    catch {
      if (signal.aborted) throw failure("DEVIN_READ_CANCELLED");
      // A written request may have reached the provider. Preserve its delivery uncertainty.
      if (init.method === "POST") throw new AdapterContractError("DEVIN_WRITE_UNAVAILABLE", "Devin write response is unavailable; delivery is unconfirmed");
      throw failure("DEVIN_READ_UNAVAILABLE");
    }
  }
}

export class DevinAdapter implements AgentAdapter {
  readonly manifest = validateManifest(devinManifest);
  private readonly backend: DevinBackend;
  private readonly snapshots = new Map<string, DevinSessionSnapshot>();

  readonly profile: DevinProfileConfig;

  constructor(
    profile: DevinProfileConfig,
    backend?: DevinBackend,
    private readonly store: SessionStore = new MemorySessionStore(),
    resolveCredential?: CredentialResolver,
    fetchImpl?: typeof fetch,
  ) {
    this.profile = structuredClone(profile);
    if (!backend && !resolveCredential) throw new AdapterContractError("SECRET_RESOLVER_UNAVAILABLE", "Devin API requires a SecretStore resolver");
    this.backend = backend ?? new HttpDevinBackend(this.profile, resolveCredential!, fetchImpl);
  }

  async start(input: AdapterStartInput): Promise<AdapterSession> {
    input=captureAdapterStartInput(input);
    validateCreationProfile(this.profile);
    if (input.backendId !== undefined && input.backendId !== "devin-v3-api") throw new AdapterStartError("not-created", "DEVIN_BACKEND_MISMATCH", "Cloud Devin requires its organization API backend");
    const backendId=input.backendId??"devin-v3-api";
    const selection=freezeExecutionSelection(input.executionSelection,{profileId:this.profile.id,providerId:this.manifest.id,backendId,selection:false,reasoning:false});
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: startSessionId(this.store,input.sessionId),
      runId: input.runId,
      ...(input.execution?{execution:input.execution}:{}),
      backendId: input.backendId ?? "devin-v3-api",
      workspacePath: input.workspacePath,
      state: "STARTING",
      profileId: this.profile.id,
      ...(selection?{executionSelection:selection}:{}),
      createdAt: now,
      updatedAt: now,
    };
    this.store.save(session);
    if(input.beforeSend&&this.backend.supportsFinalAdmission!==true)throw new AdapterStartError("not-created","NATIVE_CAPABILITY_UNVERIFIED","Async backend does not support final write admission");
    const payload={prompt:input.prompt??"Inspect the task and report readiness.",...(this.profile.maxSessionAcu?{maxSessionAcu:this.profile.maxSessionAcu}:{})};
    const snapshot=structuredClone(input.beforeSend?await this.backend.create(payload,input.beforeSend):await this.backend.create(payload));
    assertSnapshotIdentity(snapshot, this.profile, snapshot.sessionId);
    session.state=mapState(snapshot.status);session.providerSessionId=snapshot.sessionId;session.updatedAt=new Date().toISOString();
    this.snapshots.set(session.id, snapshot);
    this.store.save(session);
    return structuredClone(session);
  }

  async send(sessionId: string, message: string,beforeSend?:()=>void): Promise<AdapterEvent> {
    const session = this.require(sessionId);
    if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", "Devin session id is missing");
    if(beforeSend&&this.backend.supportsFinalAdmission!==true)throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Async backend does not support final write admission");
    const snapshot=structuredClone(beforeSend?await this.backend.send(session.providerSessionId,message,beforeSend):await this.backend.send(session.providerSessionId,message));
    assertSnapshotIdentity(snapshot, this.profile, session.providerSessionId);
    this.snapshots.set(sessionId, snapshot);
    this.update(sessionId, { state: mapState(snapshot.status) });
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length, providerSessionId: snapshot.sessionId } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "The Devin v3 API does not expose a pause operation"); }
  async resume(sessionId: string,beforeSend?:()=>void): Promise<AdapterSession> { await this.send(sessionId, "Continue from the current session context.",beforeSend); return this.status(sessionId); }
  async cancel(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Native Devin termination and tool/writer release are not qualified for this adapter"); }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    if (!session.providerSessionId) return structuredClone(session);
    const snapshot = structuredClone(await this.backend.get(session.providerSessionId));
    assertSnapshotIdentity(snapshot, this.profile, session.providerSessionId);
    this.snapshots.set(sessionId, snapshot);
    const resource=turnExecutionResource([],snapshot.status,new Date().toISOString()),consumed=snapshot.acusConsumed,limit=this.profile.maxSessionAcu;
    if(limit&&consumed!==undefined){resource.state=consumed>=limit?"QUOTA_EXHAUSTED":consumed/limit>=0.8?"LOW":resource.state;resource.confidence="high";if(consumed>=limit)resource.reason="Native session reached its configured execution budget";}
    return this.update(sessionId, { state: mapState(snapshot.status),executionResource:resource });
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
      state: consumed===undefined?"UNKNOWN":limit && consumed >= limit ? "QUOTA_EXHAUSTED" : limit && consumed / limit >= 0.8 ? "LOW" : "AVAILABLE",
      ...(consumed === undefined ? {} : { consumed }),
      ...(limit === undefined ? {} : { limit,...(consumed!==undefined?{remaining:Math.max(0,limit-consumed)}:{}) }),
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
    if (session.profileId !== this.profile.id) throw new AdapterContractError("SESSION_PROFILE_MISMATCH", "Session belongs to another configured account");
    if (session.backendId !== "devin-v3-api") throw failure("DEVIN_IDENTITY_CHANGED");
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
    return { authenticated: false, apiVersion: "v3", diagnostic: error instanceof AdapterContractError ? error.code : "DEVIN_PROBE_UNAVAILABLE" };
  }
}

function mapState(status: string): AdapterSession["state"] {
  const normalized = status.toLowerCase();
  if (["exit", "completed", "done"].includes(normalized)) return "COMPLETED";
  if (["error", "failed"].includes(normalized)) return "FAILED";
  if (["suspended", "waiting_for_user", "waiting"].includes(normalized)) return "PAUSED";
  return "RUNNING";
}

async function parseResponse(response: Response, profile: DevinProfileConfig, expectedSessionId?: string, creating = false, signal = AbortSignal.timeout(10_000)): Promise<DevinSessionSnapshot> {
  if (!response.ok) {
    if (response.status === 403 && creating && profile.createAsUserId) { void response.body?.cancel().catch(() => {}); throw new AdapterContractError("DEVIN_ATTRIBUTION_DENIED", "Devin user attribution was denied"); }
    assertResponse(response);
  }
  const body = await readJson(response, signal);
  const sessionId = stringValue(body.session_id) ?? stringValue(body.devin_id);
  if (!sessionId) throw new AdapterContractError("INVALID_PROVIDER_RESPONSE", "Devin response is missing session_id");
  if (body.org_id !== profile.organizationId || expectedSessionId !== undefined && sessionId !== expectedSessionId) throw new AdapterContractError("DEVIN_IDENTITY_CHANGED", "Devin organization or session identity changed");
  if (profile.createAsUserId && body.user_id !== profile.createAsUserId) throw new AdapterContractError("DEVIN_ATTRIBUTION_CHANGED", "Devin human attribution could not be verified");
  const pullRequests = Array.isArray(body.pull_requests) ? body.pull_requests.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const url = stringValue(record.pr_url) ?? stringValue(record.url);
    return url ? [{ url, ...(stringValue(record.pr_state) ?? stringValue(record.state) ? { state: (stringValue(record.pr_state) ?? stringValue(record.state))! } : {}) }] : [];
  }) : [];
  return {
    sessionId,
    status: stringValue(body.status) ?? "unknown",
    organizationId: profile.organizationId,
    ...(stringValue(body.user_id) ? { userId: stringValue(body.user_id)! } : {}),
    ...(stringValue(body.service_user_id) ? { serviceUserId: stringValue(body.service_user_id)! } : {}),
    ...(stringValue(body.status_detail) ? { statusDetail: stringValue(body.status_detail)! } : {}),
    ...(stringValue(body.url) ? { url: stringValue(body.url)! } : {}),
    ...(numberValue(body.acus_consumed) === undefined ? {} : { acusConsumed: numberValue(body.acus_consumed)! }),
    pullRequests,
    ...(stringValue(body.waiting_reason) ? { waitingReason: stringValue(body.waiting_reason)! } : {}),
    ...(stringValue(body.summary) ? { summary: stringValue(body.summary)! } : {}),
  };
}

function assertSnapshotIdentity(snapshot: DevinSessionSnapshot, profile: DevinProfileConfig, sessionId: string): void {
  if (typeof snapshot.sessionId !== "string" || !snapshot.sessionId || /[\0\r\n]/.test(snapshot.sessionId)) throw failure("DEVIN_IDENTITY_CHANGED");
  if (snapshot.sessionId !== sessionId || snapshot.organizationId !== undefined && snapshot.organizationId !== profile.organizationId) throw new AdapterContractError("DEVIN_IDENTITY_CHANGED", "Devin organization or session identity changed");
  if (profile.createAsUserId && snapshot.userId !== profile.createAsUserId) throw new AdapterContractError("DEVIN_ATTRIBUTION_CHANGED", "Devin human attribution could not be verified");
}

function validateCreationProfile(profile: DevinProfileConfig): void {
  const owner = profile.createAsUserId;
  if (owner !== undefined && (typeof owner !== "string" || !owner.trim() || owner.length > 512 || /[\0\r\n]/.test(owner))) throw new AdapterStartError("not-created", "DEVIN_ATTRIBUTION_INVALID", "Devin attribution must be an explicit nonempty user ID");
  const cap = profile.maxSessionAcu;
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap <= 0)) throw new AdapterStartError("not-created", "DEVIN_ACU_LIMIT_INVALID", "Devin ACU limit must be a positive native integer");
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

function failure(code: string): AdapterContractError { return new AdapterContractError(code, code); }
function checkRead(signal: AbortSignal): void { if (signal.aborted) throw failure("DEVIN_READ_CANCELLED"); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(failure("DEVIN_READ_CANCELLED")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); if (signal.aborted) reject(failure("DEVIN_READ_CANCELLED")); else resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
function assertResponse(response: Response): void {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  const code = response.status === 401 || response.status === 403 ? "AUTH_ERROR" : response.status === 404 ? "SESSION_NOT_FOUND" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
  throw new AdapterContractError(code, "Devin API returned " + response.status);
}
async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw failure("INVALID_PROVIDER_RESPONSE");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      checkRead(signal); const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 1_048_576) throw failure("DEVIN_RESPONSE_TOO_LARGE"); chunks.push(chunk.value);
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("INVALID_PROVIDER_RESPONSE");
    return body as Record<string, unknown>;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof AdapterContractError) throw error;
    throw failure("INVALID_PROVIDER_RESPONSE");
  } finally { reader.releaseLock(); }
}

export interface DevinV3InteractionScope {
  binding: NativeBinding; organizationId: string; scopeFingerprint: string;
  evidence?: Partial<InteractionCapabilities>;
}
/** Cloud identity is distinct from Local ACP. Read qualification never grants writer authority. */
export class DevinV3InteractionPort implements NativeInteractionPort {
  private readonly scope: DevinV3InteractionScope;
  constructor(scope: DevinV3InteractionScope, private readonly backend: HttpDevinBackend) {
    this.scope = structuredClone(scope); const b = this.scope.binding, native = backend.connectionScope;
    if (b.version !== 1 || b.product !== "devin" || b.region !== "global" || b.backendId !== "devin-v3-api" || b.identityState !== "bound" || b.nativeThreadId !== undefined || b.parentSessionId !== undefined || b.profileId !== native.profileId || this.scope.organizationId !== native.organizationId || b.nativeStoreRef !== "devin-org:" + native.organizationId || ![b.nativeSessionId, b.runnerId, b.executionRefId, this.scope.scopeFingerprint].every(value => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/.test(value))) throw failure("DEVIN_IDENTITY_CHANGED");
  }
  capabilities(): InteractionCapabilities {
    const unknown: CapabilityEvidence = { version: 1, support: "unknown", level: "documented", scopeFingerprint: this.scope.scopeFingerprint, reasonCode: "DEVIN_RUNTIME_UNQUALIFIED" };
    const qualified = (name: "durableIdentity" | "historyRead") => {
      const e = this.scope.evidence?.[name]; return assessInteractionCapability(e, this.scope.scopeFingerprint, "runtime-verified").supported ? structuredClone(e!) : { ...unknown };
    };
    return { version: 1, durableIdentity: qualified("durableIdentity"), historyRead: qualified("historyRead"), sameSessionContinue: { ...unknown }, liveSteer: { ...unknown }, interruptTurn: { ...unknown }, nativeApproval: { ...unknown }, observeExternalChanges: { ...unknown }, releaseControl: { ...unknown }, reclaimControl: { ...unknown }, restartReattach: { ...unknown }, surfaces: {} };
  }
  private identity(ref: NativeBinding): void { if (!isDeepStrictEqual(ref, this.scope.binding)) throw failure("DEVIN_IDENTITY_CHANGED"); }
  private guard(ref: NativeBinding, history: boolean, signal: AbortSignal): void {
    checkRead(signal); this.identity(ref); const caps = this.capabilities();
    if (!assessInteractionCapability(caps.durableIdentity, this.scope.scopeFingerprint, "runtime-verified").supported || history && !assessInteractionCapability(caps.historyRead, this.scope.scopeFingerprint, "runtime-verified").supported) throw failure("NATIVE_CAPABILITY_UNVERIFIED");
  }
  async inspect(ref: NativeBinding, request?: NativeReadRequest): Promise<NativeObservation> {
    const selected = structuredClone(ref), signal = AbortSignal.any([AbortSignal.timeout(5_000), ...(request ? [request.signal] : [])]);
    this.guard(selected, false, signal); const snapshot = await this.backend.get(selected.nativeSessionId, signal); this.guard(selected, false, signal);
    return { version: 1, id: randomUUID(), nativeSessionId: selected.nativeSessionId, scopeFingerprint: this.scope.scopeFingerprint, executionRefId: selected.executionRefId, observedAt: new Date().toISOString(), state: ["new", "claimed", "running", "resuming"].includes(snapshot.status) ? "running" : snapshot.status === "exit" || snapshot.status === "suspended" ? "idle" : "unknown", pendingTools: "unknown", pendingApprovals: snapshot.statusDetail === "waiting_for_approval" ? "present" : "unknown", historyMode: "snapshot-only" };
  }
  async history(ref: NativeBinding, request: HistoryRequest, read?: NativeReadRequest): Promise<HistoryPage> {
    const selected = structuredClone(ref), input = structuredClone(request), signal = AbortSignal.any([AbortSignal.timeout(5_000), ...(read ? [read.signal] : [])]);
    this.guard(selected, true, signal);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor || Buffer.byteLength(input.cursor) > 1_024 || /[\0\r\n]/.test(input.cursor))) throw failure("INVALID_HISTORY_REQUEST");
    const before = await this.backend.get(selected.nativeSessionId, signal); this.guard(selected, true, signal);
    const body = await this.backend.messages(selected.nativeSessionId, input, signal); this.guard(selected, true, signal);
    const after = await this.backend.get(selected.nativeSessionId, signal); this.guard(selected, true, signal);
    if (before.userId !== after.userId || before.serviceUserId !== after.serviceUserId) throw failure("DEVIN_ATTRIBUTION_CHANGED");
    if (!Array.isArray(body.items) || body.items.length > input.limit || body.has_next_page !== undefined && typeof body.has_next_page !== "boolean" || body.has_next_page === true && (typeof body.end_cursor !== "string" || !body.end_cursor || Buffer.byteLength(body.end_cursor) > 1_024 || body.end_cursor === input.cursor || !body.items.length || /[\0\r\n]/.test(body.end_cursor))) throw failure("INVALID_PROVIDER_RESPONSE");
    const ids = new Set<string>(), perEntry = Math.floor(240_000 / Math.max(1, body.items.length));
    const entries = body.items.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_PROVIDER_RESPONSE");
      const item = value as Record<string, unknown>;
      if (typeof item.event_id !== "string" || !item.event_id || item.event_id.length > 256 || /[\0\r\n]/.test(item.event_id) || ids.has(item.event_id) || typeof item.source !== "string" || !["user", "devin"].includes(item.source) || typeof item.message !== "string" || typeof item.created_at !== "number" || !Number.isSafeInteger(item.created_at) || !Number.isFinite(new Date(item.created_at * 1_000).getTime())) throw failure("INVALID_PROVIDER_RESPONSE");
      ids.add(item.event_id);
      const entry = { id: item.event_id, kind: item.source === "user" ? "user" as const : "assistant" as const, text: "", occurredAt: new Date(item.created_at * 1_000).toISOString(), truncated: true };
      const messageBudget = perEntry - Buffer.byteLength(JSON.stringify(entry)) + 2;
      const retained = retainMessage(item.message, messageBudget);
      return { ...entry, text: retained.text, ...(retained.truncated ? {} : { truncated: false }) };
    });
    return { version: 1, nativeSessionId: selected.nativeSessionId, source: "devin", state: "available", completeness: "partial", range: "native-history", entries, ...(body.has_next_page === true ? { nextCursor: body.end_cursor as string } : {}), gaps: ["Native messages do not prove full tool, attachment or system history"], ...(entries.some(entry => entry.truncated) ? { truncation: "Native message text exceeds the retained page bound" } : {}) };
  }
  async access(ref: NativeBinding): Promise<NativeAccessDescriptor[]> {
    this.identity(ref);
    return [{ version: 1, id: "devin-cloud-instructions", surface: "web", runnerId: ref.runnerId, nativeSessionId: ref.nativeSessionId, availability: "unverified", reasonCode: "DEVIN_WEB_ENTRY_UNQUALIFIED", action: { kind: "instructions", text: "Select existing cloud session " + ref.nativeSessionId + " in organization " + this.scope.organizationId + ". Its human or service-user listing and exact Web entry require native qualification." } }];
  }
}

function retainMessage(message: string, jsonBytes: number): { text: string; truncated: boolean } {
  const raw = Buffer.from(message);
  if (raw.byteLength <= 16_384 && Buffer.byteLength(JSON.stringify(message)) <= jsonBytes) return { text: message, truncated: false };
  let low = 0, high = Math.min(raw.byteLength, 16_384), text = "";
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    // A streaming decode drops an incomplete final code point, preserving the native prefix.
    const candidate = new TextDecoder().decode(raw.subarray(0, midpoint), { stream: true });
    if (Buffer.byteLength(JSON.stringify(candidate)) <= jsonBytes) { text = candidate; low = midpoint + 1; }
    else high = midpoint - 1;
  }
  return { text, truncated: true };
}
