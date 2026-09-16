import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import {
  LlmRuntimeError,
  type LlmCapabilities,
  type LlmConfiguration,
  type LlmEndpoint,
  type LlmHealthRecord,
  type LlmHealthStatus,
  type LlmProfile,
  type LlmRequest,
  type LlmResponse,
  type LlmRole,
  type LlmRuntimeState,
} from "./contracts.js";
import { createProtocolAdapter, type FetchLike } from "./protocols.js";

export type SecretResolver = (reference: string) => Promise<string>;

const emptyCapabilities: LlmCapabilities = { structuredOutput: false, tools: false, streaming: false };

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function initialState(): LlmRuntimeState {
  return { mode: "DEGRADED_NO_LLM", activeProfileByRole: {}, healthByProfile: {}, circuits: {}, updatedAt: new Date(0).toISOString() };
}

export function validateLlmConfiguration(configuration: LlmConfiguration): LlmConfiguration {
  const copy = structuredClone(configuration);
  const endpointIds = new Set<string>();
  for (const endpoint of copy.endpoints) {
    if (!endpoint.id || endpointIds.has(endpoint.id)) throw new Error(`Duplicate or empty LLM endpoint id: ${endpoint.id}`);
    endpointIds.add(endpoint.id);
    const url = new URL(endpoint.baseUrl);
    if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) throw new Error(`Invalid LLM endpoint URL: ${endpoint.id}`);
    if (!/^secret:\/\/llm\/[a-z0-9][a-z0-9._/-]*$/.test(endpoint.credentialRef)) throw new Error(`Invalid LLM credential reference: ${endpoint.id}`);
  }
  const profileIds = new Set<string>();
  const aliases = new Set<string>();
  for (const profile of copy.profiles) {
    if (!profile.id || profileIds.has(profile.id)) throw new Error(`Duplicate or empty LLM profile id: ${profile.id}`);
    profileIds.add(profile.id);
    const alias = profile.alias.toLowerCase();
    if (aliases.has(alias)) throw new Error(`Duplicate LLM profile alias: ${profile.alias}`);
    aliases.add(alias);
    if (!endpointIds.has(profile.endpointId)) throw new Error(`LLM profile ${profile.id} references unknown endpoint ${profile.endpointId}`);
  }
  const poolIds = new Set<string>();
  for (const pool of copy.pools) {
    if (!pool.id || poolIds.has(pool.id)) throw new Error(`Duplicate or empty LLM pool id: ${pool.id}`);
    poolIds.add(pool.id);
    if (new Set(pool.profileIds).size !== pool.profileIds.length) throw new Error(`LLM pool ${pool.id} contains duplicate profiles`);
    for (const profileId of pool.profileIds) if (!profileIds.has(profileId)) throw new Error(`LLM pool ${pool.id} references unknown profile ${profileId}`);
  }
  if (copy.defaultPoolId && !poolIds.has(copy.defaultPoolId)) throw new Error(`Unknown default LLM pool: ${copy.defaultPoolId}`);
  const roles = new Set<LlmRole>();
  for (const binding of copy.roleBindings) {
    if (roles.has(binding.role)) throw new Error(`Duplicate LLM role binding: ${binding.role}`);
    roles.add(binding.role);
    if (!poolIds.has(binding.poolId)) throw new Error(`LLM role ${binding.role} references unknown pool ${binding.poolId}`);
  }
  return copy;
}

function healthStatus(error: LlmRuntimeError): LlmHealthStatus {
  switch (error.code) {
    case "RATE_LIMITED": return "RATE_LIMITED";
    case "QUOTA_EXHAUSTED": return "QUOTA_EXHAUSTED";
    case "AUTHENTICATION":
    case "FORBIDDEN": return "AUTH_ERROR";
    case "MODEL_MISSING": return "MODEL_UNAVAILABLE";
    case "PROVIDER_ERROR":
    case "NETWORK":
    case "TIMEOUT": return "PROVIDER_DOWN";
    default: return "DEGRADED";
  }
}

export class LlmRuntime {
  private configuration: LlmConfiguration = { endpoints: [], profiles: [], pools: [], roleBindings: [] };
  private state: LlmRuntimeState;
  private calls = 0;

  constructor(
    private readonly database: DispatcherDatabase,
    private readonly resolveSecret: SecretResolver,
    private readonly fetcher: FetchLike = fetch,
    private readonly options: { timeoutMs?: number; failureThreshold?: number; cooldownMs?: number; recoveryProbeThreshold?: number } = {},
  ) {
    this.state = database.getEntity<JsonValue>("llm-runtime-state", "current") as unknown as LlmRuntimeState | undefined ?? initialState();
  }

  configure(configuration: LlmConfiguration): void {
    this.configuration = validateLlmConfiguration(configuration);
    const profileIds = new Set(this.configuration.profiles.map((profile) => profile.id));
    this.state.activeProfileByRole = Object.fromEntries(Object.entries(this.state.activeProfileByRole).filter(([, id]) => id && profileIds.has(id))) as Partial<Record<LlmRole, string>>;
    this.state.healthByProfile = Object.fromEntries(Object.entries(this.state.healthByProfile).filter(([id]) => profileIds.has(id)));
    this.state.circuits = Object.fromEntries(Object.entries(this.state.circuits).filter(([id]) => profileIds.has(id)));
    if (this.configuration.profiles.length === 0) this.state.mode = "DEGRADED_NO_LLM";
    this.persist();
  }

  snapshot(): { configuration: LlmConfiguration; state: LlmRuntimeState; calls: number } {
    return { configuration: structuredClone(this.configuration), state: structuredClone(this.state), calls: this.calls };
  }

  resolveProfiles(role: LlmRole): LlmProfile[] {
    const binding = this.configuration.roleBindings.find((entry) => entry.role === role);
    const poolId = binding?.poolId ?? this.configuration.defaultPoolId;
    const pool = this.configuration.pools.find((entry) => entry.id === poolId);
    if (!pool) return [];
    const profiles = pool.profileIds.flatMap((id) => {
      const profile = this.configuration.profiles.find((entry) => entry.id === id && entry.enabled);
      return profile ? [profile] : [];
    });
    const active = this.state.activeProfileByRole[role];
    if (!active) return profiles;
    return [...profiles.filter((profile) => profile.id === active), ...profiles.filter((profile) => profile.id !== active)];
  }

  async probe(profileId: string, source: LlmHealthRecord["source"] = "explicit"): Promise<LlmHealthRecord> {
    const { profile, endpoint } = this.lookup(profileId);
    if (!profile.enabled) {
      const record: LlmHealthRecord = { profileId, status: "DISABLED", checkedAt: new Date().toISOString(), source, capabilities: emptyCapabilities };
      this.state.healthByProfile[profileId] = record;
      this.persist();
      return structuredClone(record);
    }
    const adapter = createProtocolAdapter(endpoint.protocol, this.fetcher);
    try {
      const credential = await this.resolveSecret(endpoint.credentialRef);
      await adapter.invoke({ messages: [{ role: "user", content: "Return OK." }], maxOutputTokens: 8 }, { endpoint, profile, credential, timeoutMs: this.options.timeoutMs ?? 10_000 });
      const record: LlmHealthRecord = { profileId, status: "HEALTHY", checkedAt: new Date().toISOString(), source, capabilities: adapter.capabilities };
      this.state.healthByProfile[profileId] = record;
      const circuit = this.state.circuits[profileId];
      if (circuit) circuit.consecutiveRecoveryProbes += 1;
      this.persist();
      return structuredClone(record);
    } catch (error) {
      const normalized = error instanceof LlmRuntimeError ? error : new LlmRuntimeError("NETWORK", "LLM probe failed", true, true, undefined, { cause: error });
      const record: LlmHealthRecord = { profileId, status: healthStatus(normalized), checkedAt: new Date().toISOString(), source, reason: normalized.code, ...(normalized.retryAfterMs === undefined ? {} : { retryAfterMs: normalized.retryAfterMs }), capabilities: adapter.capabilities };
      this.state.healthByProfile[profileId] = record;
      this.recordFailure(profileId, normalized);
      this.persist();
      return structuredClone(record);
    }
  }

  async switchProfile(role: LlmRole, profileId: string): Promise<LlmRuntimeState> {
    const previous = this.state.activeProfileByRole[role];
    if (!this.resolveProfiles(role).some((profile) => profile.id === profileId)) throw new Error(`Profile ${profileId} is not eligible for role ${role}`);
    const health = await this.probe(profileId, "explicit");
    if (health.status !== "HEALTHY") {
      if (previous) this.state.activeProfileByRole[role] = previous;
      else delete this.state.activeProfileByRole[role];
      this.persist();
      throw new LlmRuntimeError("NO_AVAILABLE_PROFILE", `Profile ${profileId} failed safe-switch probe`, false, false);
    }
    this.state.activeProfileByRole[role] = profileId;
    this.state.mode = "ACTIVE";
    this.persist();
    return structuredClone(this.state);
  }

  async attemptFailback(role: LlmRole): Promise<boolean> {
    const binding = this.configuration.roleBindings.find((entry) => entry.role === role);
    const poolId = binding?.poolId ?? this.configuration.defaultPoolId;
    const preferredId = this.configuration.pools.find((pool) => pool.id === poolId)?.profileIds[0];
    if (!preferredId || this.state.activeProfileByRole[role] === preferredId) return false;
    const result = await this.probe(preferredId, "circuit");
    const recoveryCount = this.state.circuits[preferredId]?.consecutiveRecoveryProbes ?? 1;
    if (result.status !== "HEALTHY" || recoveryCount < (this.options.recoveryProbeThreshold ?? 2)) return false;
    this.state.activeProfileByRole[role] = preferredId;
    delete this.state.circuits[preferredId];
    this.persist();
    return true;
  }

  async invoke(role: LlmRole, request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    let lastError: LlmRuntimeError | undefined;
    for (const profile of this.resolveProfiles(role)) {
      if (this.inCooldown(profile.id)) continue;
      const endpoint = this.configuration.endpoints.find((entry) => entry.id === profile.endpointId);
      if (!endpoint) continue;
      const adapter = createProtocolAdapter(endpoint.protocol, this.fetcher);
      try {
        const credential = await this.resolveSecret(endpoint.credentialRef);
        this.calls += 1;
        const context = { endpoint, profile, credential, timeoutMs: this.options.timeoutMs ?? 15_000, ...(signal ? { signal } : {}) };
        const response = await adapter.invoke(request, context);
        this.state.activeProfileByRole[role] = profile.id;
        this.state.healthByProfile[profile.id] = { profileId: profile.id, status: "HEALTHY", checkedAt: new Date().toISOString(), source: "request", capabilities: adapter.capabilities };
        delete this.state.circuits[profile.id];
        this.state.mode = "ACTIVE";
        this.persist();
        return response;
      } catch (error) {
        lastError = error instanceof LlmRuntimeError ? error : new LlmRuntimeError("NETWORK", "LLM invocation failed", true, true, undefined, { cause: error });
        this.state.healthByProfile[profile.id] = { profileId: profile.id, status: healthStatus(lastError), checkedAt: new Date().toISOString(), source: "request", reason: lastError.code, ...(lastError.retryAfterMs === undefined ? {} : { retryAfterMs: lastError.retryAfterMs }), capabilities: adapter.capabilities };
        this.recordFailure(profile.id, lastError);
        if (!lastError.fallbackAllowed) break;
      }
    }
    this.state.mode = "DEGRADED_NO_LLM";
    this.persist();
    throw new LlmRuntimeError("NO_AVAILABLE_PROFILE", "No Internal LLM profile is currently available", true, false, lastError?.retryAfterMs, { cause: lastError });
  }

  private lookup(profileId: string): { profile: LlmProfile; endpoint: LlmEndpoint } {
    const profile = this.configuration.profiles.find((entry) => entry.id === profileId);
    if (!profile) throw new Error(`Unknown LLM profile: ${profileId}`);
    const endpoint = this.configuration.endpoints.find((entry) => entry.id === profile.endpointId);
    if (!endpoint) throw new Error(`Unknown LLM endpoint: ${profile.endpointId}`);
    return { profile, endpoint };
  }

  private inCooldown(profileId: string): boolean {
    const until = this.state.circuits[profileId]?.cooldownUntil;
    if (!until || Date.parse(until) <= Date.now()) return false;
    const health = this.state.healthByProfile[profileId];
    if (health) this.state.healthByProfile[profileId] = { ...health, status: "COOLDOWN", source: "circuit" };
    return true;
  }

  private recordFailure(profileId: string, error: LlmRuntimeError): void {
    const previous = this.state.circuits[profileId] ?? { failures: 0, consecutiveRecoveryProbes: 0 };
    const failures = previous.failures + 1;
    const now = new Date();
    this.state.circuits[profileId] = {
      failures,
      consecutiveRecoveryProbes: 0,
      ...(failures >= (this.options.failureThreshold ?? 2) ? { openedAt: now.toISOString(), cooldownUntil: new Date(now.getTime() + (error.retryAfterMs ?? this.options.cooldownMs ?? 30_000)).toISOString() } : {}),
    };
  }

  private persist(): void {
    this.state.updatedAt = new Date().toISOString();
    this.database.saveEntity("llm-runtime-state", "current", asJson(this.state));
  }
}
