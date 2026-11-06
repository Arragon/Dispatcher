import { createHash, timingSafeEqual } from "node:crypto";
import type { DispatcherConfig, RhizaClientGrant, SecretStore } from "@dispatcher/config";
import { RHIZA_API_PREFIX, RHIZA_EVENT_SCHEMA_VERSION, RHIZA_PROTOCOL_VERSION, RHIZA_SCOPES, type RhizaCapability, type RhizaCapabilitiesV1, type RhizaHandshakeRequestV1, type RhizaHandshakeV1, type RhizaScope } from "@dispatcher/protocol";
import type { ControlDecision, ControlPrincipal, ControlRequest } from "./control-auth.js";
import type { CredentialContext } from "./credential-context.js";
import { contentHash } from "./task-publications.js";

export class RhizaIngressError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}
const denied = (): ControlDecision => ({ kind: "rejected", status: 401, code: "AUTH_REQUIRED", message: "A current service credential is required" });
const digest = (value: string) => createHash("sha256").update(value).digest();
const scopeFeatures: Record<RhizaScope, readonly RhizaCapability[]> = {
  "targets:read": ["targets.read"], "jobs:submit": ["jobs.preflight", "jobs.submit","jobs.reassign"], "jobs:read": ["jobs.read"],
  "jobs:cancel": ["jobs.cancel"], "jobs:input": ["jobs.input"], "events:read": ["events.read"], "artifacts:read": ["artifacts.read"],
};
export interface RhizaAuthOptions {
  config(): DispatcherConfig; secrets: SecretStore; credentials: CredentialContext; now(): Date;
  authorizationRevision(): number;
  capabilities(): readonly RhizaCapability[];
}

/** Service grants share control transport guards, never owner/session authority. */
export class RhizaServiceAuth {
  constructor(private readonly options: RhizaAuthOptions) {}

  async authenticate(token: string, request: ControlRequest): Promise<ControlDecision> {
    const config = this.options.config();
    const cleanup = request.method === "GET" && ["/operations/by-key/:requestId","/jobs/:jobId","/jobs/:jobId/artifacts","/events"].some(path=>request.routePath===`${RHIZA_API_PREFIX}${path}`)||request.method==="POST"&&request.routePath===`${RHIZA_API_PREFIX}/jobs/:jobId/cancellations`;
    if (!config.rhizaIngress?.enabled && !cleanup) return { kind: "rejected", status: 503, code: "INGRESS_DISABLED", message: "External ingress is disabled" };
    // Require a real registered ingress route as well as a protected raw path.
    // A dot-segment/encoded path must never carry service authority into owner APIs.
    if (!request.routePath?.startsWith(`${RHIZA_API_PREFIX}/`)) return denied();
    const hostValue = request.headers.host, host = Array.isArray(hostValue) ? hostValue[0] : hostValue;
    const localHost = host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
    const localPeer = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip);
    if (request.protocol !== "https" && !(localHost && localPeer)) return { kind: "rejected", status: 403, code: "TLS_REQUIRED", message: "Cross-host ingress requires TLS" };
    const match = /^rhiza\.([A-Za-z0-9_-]{1,300})\.([A-Za-z0-9_-]{32,256})$/.exec(token);
    if (!match || token.length > 600) return denied();
    const clientId = Buffer.from(match[1]!, "base64url").toString("utf8");
    if (Buffer.from(clientId).toString("base64url") !== match[1]) return denied();
    const grant = config.rhizaIngress?.clients.find(client => client.id === clientId);
    if (!grant?.enabled || Date.parse(grant.expiresAt) <= this.options.now().getTime()) return denied();
    try {
      this.options.credentials.assertAvailable(grant.credentialRef);
      const principal: ControlPrincipal = { id: `rhiza:${clientId}`, roles: [], channel: "api", authenticatedBy: "service-bearer",
        service: { clientId, authorityId: grant.authorityId, grantHash: this.grantHash(grant), credentialEpoch: this.options.credentials.fingerprint(grant.credentialRef), authorizationRevision: this.options.authorizationRevision() } };
      const expected = await this.options.secrets.resolve(grant.credentialRef, { principal: "controller", purpose: "integration" });
      if (!timingSafeEqual(digest(token), digest(expected))) return denied();
      this.current(principal, [], undefined, { allowDisabled: cleanup });
      return { kind: "authenticated", principal };
    } catch { return denied(); }
  }

  /** Call again after an await and immediately before any protected publication. */
  current(principal: ControlPrincipal | undefined, required: readonly RhizaScope[] = [], resource?: { repositoryId?: string; profileId?: string; authorityId?: string }, policy: { allowDisabled?: boolean } = {}): RhizaClientGrant {
    const identity = principal?.service;
    if (!identity || principal.authenticatedBy !== "service-bearer" || principal.id !== `rhiza:${identity.clientId}`) throw new RhizaIngressError("AUTH_REQUIRED", 401, "A current service credential is required");
    const config = this.options.config(), grant = config.rhizaIngress?.clients.find(client => client.id === identity.clientId);
    if ((!config.rhizaIngress?.enabled && !policy.allowDisabled) || !grant?.enabled || Date.parse(grant.expiresAt) <= this.options.now().getTime()) throw new RhizaIngressError("AUTH_REQUIRED", 401, "Service authority is expired or revoked");
    try { this.options.credentials.assertAvailable(grant.credentialRef); }
    catch { throw new RhizaIngressError("AUTH_REQUIRED", 401, "Service authority changed"); }
    // ConfigPlan's durable monotonic revision detects revoke/regrant ABA. This is
    // deliberately conservative request authority, never a target profile revision.
    if (this.options.authorizationRevision() !== identity.authorizationRevision || this.grantHash(grant) !== identity.grantHash || this.options.credentials.fingerprint(grant.credentialRef) !== identity.credentialEpoch) throw new RhizaIngressError("AUTH_REQUIRED", 401, "Service authority changed");
    if (required.some(scope => !grant.scopes.includes(scope)) || resource?.repositoryId && !grant.repositoryIds.includes(resource.repositoryId)
      || resource?.profileId && !grant.profileIds.includes(resource.profileId) || resource?.authorityId && grant.authorityId !== resource.authorityId) throw new RhizaIngressError("ACCESS_DENIED", 403, "The service grant does not authorize this operation");
    return structuredClone(grant);
  }

  capabilities(principal: ControlPrincipal | undefined): RhizaCapabilitiesV1 {
    const grant = this.current(principal), configured = this.options.capabilities();
    const capabilities = configured.filter(capability => capability.startsWith("model.")
      ? grant.scopes.includes("targets:read") || grant.scopes.includes("jobs:submit")
      : RHIZA_SCOPES.some(scope => grant.scopes.includes(scope) && scopeFeatures[scope].includes(capability)));
    return { schemaVersion: 1, protocolVersions: [RHIZA_PROTOCOL_VERSION], eventSchemaVersion: RHIZA_EVENT_SCHEMA_VERSION,
      authorityId: `dispatcher:${this.options.config().controller.id}`, capabilities: [...new Set(capabilities)],
      scopes: RHIZA_SCOPES.filter(scope => grant.scopes.includes(scope) && scopeFeatures[scope].some(capability => capabilities.includes(capability))) };
  }

  handshake(principal: ControlPrincipal | undefined, input: RhizaHandshakeRequestV1): RhizaHandshakeV1 {
    const grant = this.current(principal), offered = this.capabilities(principal);
    if (!input.protocolVersions.includes(RHIZA_PROTOCOL_VERSION)) throw new RhizaIngressError("PROTOCOL_UNSUPPORTED", 409, "No compatible ingress protocol");
    if (input.requiredCapabilities.some(capability => !offered.capabilities.includes(capability as RhizaCapability))) throw new RhizaIngressError("CAPABILITY_REQUIRED", 409, "A required capability is unavailable");
    if (input.requiredScopes.some(scope => !offered.scopes.includes(scope))) throw new RhizaIngressError("ACCESS_DENIED", 403, "A required scope is unavailable");
    return { schemaVersion: 1, protocolVersion: RHIZA_PROTOCOL_VERSION, eventSchemaVersion: RHIZA_EVENT_SCHEMA_VERSION,
      authorityId: offered.authorityId, clientId: grant.id, capabilities: offered.capabilities, scopes: offered.scopes, expiresAt: grant.expiresAt };
  }

  private grantHash(grant: RhizaClientGrant): string { return contentHash(grant); }
}
