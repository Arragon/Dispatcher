import { afterEach, describe, expect, it } from "vitest";
import type { ControlPrincipal } from "../src/control-auth.js";
import { RhizaServiceAuth } from "../src/rhiza-auth.js";
import { CredentialContext } from "../src/credential-context.js";
import { RhizaTargets, type RhizaTargetFacts } from "../src/rhiza-targets.js";
import { rhizaApprovalDigest, rhizaInputHash } from "../src/rhiza-semantics.js";
import type { RhizaWorkOrderV1 } from "@dispatcher/protocol";
import { clientToken, grant, rhizaServiceFixture } from "./fixtures/rhiza-service.js";

const fixtures: Awaited<ReturnType<typeof rhizaServiceFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function setup() {
  const f = await rhizaServiceFixture(); fixtures.push(f);
  await f.configure(config => { config.repositories[0]!.verificationCommands = [{ id: "test", file: "registered-test", args: [], required: true, timeoutMs: 1000, outputLimitBytes: 1000 }]; });
  const auth = new RhizaServiceAuth({ config: () => f.service.configuration.current().config, secrets: f.secrets,
    credentials: new CredentialContext(f.service.database), now: () => f.clock.now, authorizationRevision: () => f.service.configuration.current().revision, capabilities: () => ["targets.read"] });
  const authenticated = await auth.authenticate(clientToken, { method: "GET", url: "/api/integrations/rhiza/v1/targets", routePath: "/api/integrations/rhiza/v1/targets", protocol: "http", ip: "127.0.0.1", headers: { host: "localhost" } });
  expect(authenticated.kind).toBe("authenticated");
  const principal = (authenticated as { principal: ControlPrincipal }).principal;
  // Explicit synthetic native facts: not a real Provider/model or release proof.
  const facts: RhizaTargetFacts = { executorRef: "dispatcher:test", runnerId: "local", profileId: "profile-a", harnessId: "codex", backendId: "codex-exec-json", profileRevision: "profile:1", adapterVersion: "fixture-adapter:1", cliVersion: "fixture-cli:1", ready: true, evidenceCapabilities: ["configuration_confirmed"], repositoryIdentity: { root: f.repository, rootIdentity: { device: 1, inode: 1 } },
    catalog: { profileId: "profile-a", runnerId: "local", providerId: "codex", backendId: "codex-exec-json", contextFingerprint: "d".repeat(64), revision: "c".repeat(64), fetchedAt: f.clock.now.toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit",
      entries: ["model-a", "model-b"].map(id => ({ id, displayName: id, kind: "model", selectable: true, access: "account-listed", parameterOptions: { reasoningEffort: ["low", "high"] } })) } };
  const scopeGate = { inspect: async () => ({ root: f.repository, rootIdentity: { device: 1, inode: 1 } }) };
  const targets = new RhizaTargets(f.service.database, auth, { config: () => f.service.configuration.current(), now: () => f.clock.now, facts: () => structuredClone(facts), inspectScope: () => scopeGate.inspect() });
  const order = (modelId = "model-a"): RhizaWorkOrderV1 => {
    const target = { executorRef: facts.executorRef, runnerId: facts.runnerId, profileId: facts.profileId, harnessId: facts.harnessId, backendId: facts.backendId,
      modelId, modelOptions: { reasoningEffort: "high" }, profileRevision: facts.profileRevision, adapterVersion: facts.adapterVersion, cliVersion: facts.cliVersion!, catalogRevision: targets.catalog(principal, "repo-a").targets[0]!.catalogRevision!, contextFingerprint: facts.catalog!.contextFingerprint };
    const value: RhizaWorkOrderV1 = { origin: { authorityId: grant.authorityId, workspaceId: "ws-a", executionRunId: "rhiza-run", dispatchId: "dispatch-a", generation: 1 }, title: "Change fixture", description: "Exact task description", repositoryId: "repo-a", scopePaths: ["src"], constraints: ["Keep exports unchanged"], acceptanceCriteria: ["Test passes"], verificationCommandIds: ["test"], context: { packetId: "packet-a", formatVersion: "1", content: "Frozen context\r\n😀", inputHash: rhizaInputHash("Frozen context\r\n😀") }, target,
      approval: { reference: "approval-a", digest: "", expiresAt: "2026-10-23T00:00:00.000Z" }, deadline: "2026-10-23T00:00:00.000Z", evidencePolicy: { minimum: "configuration_confirmed" }, delivery: { type: "pull-request", scmConnectorId: "github-a", targetRepository: "example/repo", baseBranch: "main" } };
    value.approval.digest = rhizaApprovalDigest(value); return value;
  };
  return { ...f, targets, principal, facts, order, scopeGate };
}

describe("authorized target snapshot and side-effect-free preflight", () => {
  it("binds the external directory revision while retaining the native catalog revision", async () => {
    const f = await setup(), order = f.order(), receipt = await f.targets.preflight(f.principal, order);
    expect(order.target.catalogRevision).not.toBe(f.facts.catalog!.revision);
    expect(f.service.database.getEntity("rhiza-preflight", receipt.preflightId)).toMatchObject({ selection: { catalogRevision: f.facts.catalog!.revision, contextFingerprint: f.facts.catalog!.contextFingerprint } });
    f.facts.repositoryIdentity!.rootIdentity.inode++;
    await expect(f.targets.preflight(f.principal, order)).rejects.toThrow(expect.objectContaining({ code: "TARGET_CHANGED" }));
  });
  it("rejects a filesystem identity that differs from the reviewed directory", async () => {
    const f = await setup(); f.scopeGate.inspect = async () => ({ root: f.repository, rootIdentity: { device: 1, inode: 2 } });
    await expect(f.targets.preflight(f.principal, f.order())).rejects.toThrow(expect.objectContaining({ code: "TARGET_CHANGED" }));
  });
  it("does not expose unsafe native revision or fingerprint strings", async () => {
    const f = await setup(); f.facts.catalog!.revision = "/Users/synthetic/private/model-cache"; f.facts.catalog!.contextFingerprint = "secret://synthetic/account/path";
    const projected = f.targets.catalog(f.principal, "repo-a");
    expect(JSON.stringify(projected)).not.toContain("private/model-cache"); expect(JSON.stringify(projected)).not.toContain("secret://");
    expect(projected.targets[0]).toMatchObject({ status: "unverified", catalogRevision: null, contextFingerprint: null, models: [] });
  });
  it("preserves SHA-256 native revisions and fingerprints as public opaque identities", async () => {
    const f = await setup(); f.facts.catalog!.revision = "a".repeat(64); f.facts.catalog!.contextFingerprint = "b".repeat(64);
    const projected = f.targets.catalog(f.principal, "repo-a");
    expect(projected.targets[0]).toMatchObject({ status: "available", contextFingerprint: "b".repeat(64) });
    const receipt = await f.targets.preflight(f.principal, f.order());
    expect(f.service.database.getEntity("rhiza-preflight", receipt.preflightId)).toMatchObject({ selection: { catalogRevision: "a".repeat(64), contextFingerprint: "b".repeat(64) } });
  });

  it("rejects diagnostic text embedded in native identity fields", async () => {
    const f = await setup(); f.facts.catalog!.contextFingerprint = "debug directory /Users/synthetic/private/account";
    const projected = f.targets.catalog(f.principal, "repo-a");
    expect(projected.targets[0]).toMatchObject({ status: "unverified", contextFingerprint: null, models: [] });
    expect(JSON.stringify(projected)).not.toContain("/Users/synthetic");
  });
  it("bounds the complete catalog projection", async () => {
    const f = await setup();
    f.facts.catalog!.entries = Array.from({ length: 200 }, (_, index) => ({ id: `model-${index}`, kind: "model", displayName: "Fixture", selectable: true, access: "account-listed", parameterOptions: { reasoningEffort: Array.from({ length: 32 }, (_, option) => `${option} ${"deliberate verbose option label ".repeat(10)}`) } }));
    expect(() => f.targets.catalog(f.principal, "repo-a")).toThrow(expect.objectContaining({ code: "TARGET_UNAVAILABLE" }));
  });
  it.each(["revoked", "drifted", "expired"])("reauthorizes and revalidates %s state after scope inspection", async state => {
    const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    f.scopeGate.inspect = async () => { entered.resolve(); await release.promise; return { root: f.repository, rootIdentity: { device: 1, inode: 1 } }; };
    const pending = f.targets.preflight(f.principal, f.order());
    try {
      await entered.promise;
      if (state === "revoked") await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; });
      else if (state === "drifted") f.facts.profileRevision = "profile:changed";
      else f.clock.now = new Date("2026-10-23T00:00:00.000Z");
    } finally { release.resolve(); }
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: state === "revoked" ? "AUTH_REQUIRED" : state === "drifted" ? "TARGET_CHANGED" : "APPROVAL_EXPIRED" }));
    expect(f.service.database.listEntities("rhiza-preflight")).toEqual([]);
  });
  it("projects only authorized metadata and independently selectable explicit models", async () => {
    const f = await setup(), catalog = f.targets.catalog(f.principal, "repo-a");
    expect(catalog.targets).toHaveLength(1); expect(catalog.targets[0]).toMatchObject({ profileId: "profile-a", status: "available", releaseQualified: false });
    expect(catalog.targets[0]!.models.map(model => model.modelId)).toEqual(["model-a", "model-b"]);
    expect(JSON.stringify(catalog)).not.toContain(f.root); expect(JSON.stringify(catalog)).not.toContain("secret://");
    expect(() => f.targets.catalog(f.principal, "other-repo")).toThrow(expect.objectContaining({ code: "ACCESS_DENIED" }));
  });
  it("freezes different models/options for one Profile without creating Task, Run or invoking execution", async () => {
    const f = await setup(), a = await f.targets.preflight(f.principal, f.order("model-a")), b = await f.targets.preflight(f.principal, f.order("model-b"));
    expect(a.target.modelId).toBe("model-a"); expect(b.target.modelId).toBe("model-b"); expect(a.target.targetHash).not.toBe(b.target.targetHash);
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.service.database.listEntities("run")).toEqual([]);
    expect(f.service.database.listEntities("rhiza-preflight")).toHaveLength(2);
    const stored = f.service.database.getEntity("rhiza-preflight", a.preflightId);
    expect(stored).toMatchObject({ selection: { requestedModel: "model-a", source: "explicit", selectionType: "explicit-model", nativeParameters: { reasoningEffort: "high" } }, workOrder: { constraints: ["Keep exports unchanged"], context: { content: "Frozen context\r\n😀" } } });
  });
  it.each(["profileRevision", "catalogRevision", "contextFingerprint", "adapterVersion", "cliVersion", "backendId", "harnessId", "runnerId", "executorRef"] as const)("rejects stale or wrong target field %s", async field => {
    const f = await setup(), order = f.order(); order.target[field] = "changed"; order.approval.digest = rhizaApprovalDigest(order);
    await expect(f.targets.preflight(f.principal, order)).rejects.toThrow(expect.objectContaining({ code: "TARGET_CHANGED" }));
    expect(f.service.database.listEntities("rhiza-preflight")).toEqual([]);
  });
  it.each([{ reasoningEffort: "unknown" }, { temperature: 0.5 }, { model: "default" }, { toString: "unknown" }, { constructor: "unknown" }])("rejects unsupported model options %j", async options => {
    const f = await setup(), order = f.order(); order.target.modelOptions = options; order.approval.digest = rhizaApprovalDigest(order);
    await expect(f.targets.preflight(f.principal, order)).rejects.toThrow(expect.objectContaining({ code: "TARGET_UNAVAILABLE" }));
  });
  it("keeps unverified catalogs, native-auto/tier targets and unconfirmed access unavailable", async () => {
    const f = await setup();
    for (const patch of [{ access: "unconfirmed" }, { kind: "native-auto" }, { kind: "tier" }, { selectable: false }] as const) {
      const entry = f.facts.catalog!.entries[0]!, original = structuredClone(entry); Object.assign(entry, patch);
      await expect(f.targets.preflight(f.principal, f.order())).rejects.toThrow(expect.objectContaining({ code: "TARGET_UNAVAILABLE" })); Object.assign(entry, original);
    }
    f.facts.ready = false;
    expect(f.targets.catalog(f.principal, "repo-a").targets[0]!.status).toBe("unverified");
    await expect(f.targets.preflight(f.principal, f.order())).rejects.toThrow(expect.objectContaining({ code: "TARGET_UNAVAILABLE" }));
  });
  it("rejects insufficient evidence without downgrading the explicit policy", async () => {
    const f = await setup(), order = f.order(); order.evidencePolicy.minimum = "verified"; order.approval.digest = rhizaApprovalDigest(order);
    await expect(f.targets.preflight(f.principal, order)).rejects.toThrow(expect.objectContaining({ code: "MODEL_EVIDENCE_REQUIRED" }));
    expect(order.evidencePolicy.minimum).toBe("verified");
  });
  it("rejects wrong authority, unknown verification, stale approval and input/approval corruption", async () => {
    const f = await setup();
    const cases: Array<[Partial<RhizaWorkOrderV1>, string]> = [
      [{ origin: { ...f.order().origin, authorityId: "other" } }, "ACCESS_DENIED"],
      [{ verificationCommandIds: ["arbitrary-shell"] }, "INVALID_REQUEST"],
      [{ scopePaths: ["../private"] }, "INVALID_REQUEST"],
      [{ approval: { ...f.order().approval, expiresAt: "2026-10-21T00:00:00.000Z" } }, "APPROVAL_EXPIRED"],
      [{ deadline: "2026-10-21T00:00:00.000Z" }, "DEADLINE_EXCEEDED"],
    ];
    for (const [patch, code] of cases) { const order = { ...f.order(), ...patch }; order.approval.digest = rhizaApprovalDigest(order); await expect(f.targets.preflight(f.principal, order)).rejects.toThrow(expect.objectContaining({ code })); }
    const input = f.order(); input.context.content += "changed";
    await expect(f.targets.preflight(f.principal, input)).rejects.toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    const approval = f.order(); approval.constraints.push("new intent");
    await expect(f.targets.preflight(f.principal, approval)).rejects.toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    const oversized = f.order(); oversized.context.content = "😀".repeat(17000); oversized.context.inputHash = rhizaInputHash(oversized.context.content); oversized.approval.digest = rhizaApprovalDigest(oversized);
    await expect(f.targets.preflight(f.principal, oversized)).rejects.toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
