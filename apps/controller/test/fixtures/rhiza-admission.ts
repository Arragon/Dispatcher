import {expect,vi} from "vitest";
import {CanonicalTaskService} from "@dispatcher/integrations";
import type {ExecutionSelection,Run,ScmDeliverySelection} from "@dispatcher/domain";
import {renderTaskContract} from "@dispatcher/scheduler";
import type {RhizaSubmitRequestV1,RhizaWorkOrderV1,RhizaCapability} from "@dispatcher/protocol";
import {RhizaJobs} from "../../src/rhiza-jobs.js";
import {RhizaTargets,rhizaRepositoryIdentity,type RhizaTargetFacts} from "../../src/rhiza-targets.js";
import {RhizaServiceAuth} from "../../src/rhiza-auth.js";
import {CredentialContext} from "../../src/credential-context.js";
import type {ControlPrincipal} from "../../src/control-auth.js";
import {PublicationService,type PublicationRecord} from "../../src/task-publications.js";
import {rhizaApprovalDigest,rhizaInputHash} from "../../src/rhiza-semantics.js";
import {workOrder} from "../../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {clientToken,rhizaServiceFixture} from "./rhiza-service.js";
// Real canonical compiler/UoW/SQLite; explicitly synthetic native/SCM boundaries.
export async function rhizaAdmissionFixture(expiryMs?: number,capabilities:RhizaCapability[]=["jobs.reassign"]) {
  const f = await rhizaServiceFixture();
  await f.configure(config => { config.repositories[0]!.verificationCommands = [{ id: "check", file: "registered-fixture-only", args: [], required: true, timeoutMs: 1000, outputLimitBytes: 1000 }]; if(expiryMs)config.rhizaIngress!.clients[0]!.expiresAt=new Date(f.clock.now.getTime()+expiryMs).toISOString(); });
  const auth = new RhizaServiceAuth({ config: () => f.service.configuration.current().config, secrets: f.secrets, credentials: new CredentialContext(f.service.database), now: () => f.clock.now, authorizationRevision: () => f.service.configuration.current().revision, capabilities: () => capabilities });
  const decision = await auth.authenticate(clientToken, { method: "POST", url: "/api/integrations/rhiza/v1/jobs", routePath: "/api/integrations/rhiza/v1/jobs", protocol: "http", ip: "127.0.0.1", headers: { host: "localhost" } });
  const principal = (decision as { principal: ControlPrincipal }).principal;
  const order: RhizaWorkOrderV1 = { ...structuredClone(workOrder), origin: { ...workOrder.origin, authorityId: "rhiza-a" }, repositoryId: "repo-a", scopePaths: ["."], verificationCommandIds: ["check"], context: { packetId: "packet-a", formatVersion: "1", content: "\nExact context 😀\r\n", inputHash: rhizaInputHash("\nExact context 😀\r\n") }, evidencePolicy: { minimum: "configuration_confirmed" }, approval: { reference: "approval-a", digest: "a".repeat(64), expiresAt: "2026-10-23T00:00:00.000Z" }, deadline: "2026-10-23T01:00:00.000Z" };
  const facts: RhizaTargetFacts = { executorRef: "dispatcher:test", runnerId: "local", profileId: "profile-a", harnessId: "codex", backendId: "codex-exec-json", profileRevision: "profile:1", adapterVersion: "fixture:1", cliVersion: "fixture:1", ready: true, evidenceCapabilities: ["configuration_confirmed"], repositoryIdentity: rhizaRepositoryIdentity(f.repository)!, catalog: { profileId: "profile-a", runnerId: "local", providerId: "codex", backendId: "codex-exec-json", revision: "c".repeat(64), contextFingerprint: "d".repeat(64), freshness: "native-fresh", fetchedAt: f.clock.now.toISOString(), source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model-a", displayName: "A", kind: "model", access: "account-listed", selectable: true, parameterOptions: {} }] } };
  const targets = new RhizaTargets(f.service.database, auth, { config: () => f.service.configuration.current(), now: () => f.clock.now, facts: () => structuredClone(facts), inspectScope: async () => rhizaRepositoryIdentity(f.repository)! });
  const row = targets.catalog(principal, "repo-a").targets[0]!;
  order.target = { executorRef: facts.executorRef, runnerId: facts.runnerId, profileId: facts.profileId, harnessId: facts.harnessId, backendId: facts.backendId, modelId: "model-a", modelOptions: {}, profileRevision: facts.profileRevision, adapterVersion: facts.adapterVersion, cliVersion: facts.cliVersion!, catalogRevision: row.catalogRevision!, contextFingerprint: row.contextFingerprint! };
  order.approval.digest = rhizaApprovalDigest(order);
  const preflight = await targets.preflight(principal, order);
  const request: RhizaSubmitRequestV1 = { requestId: "request-a", preflightId: preflight.preflightId, targetHash: preflight.target.targetHash, workOrder: order };
  const selection: ExecutionSelection = { version: 1, mode: "manual", source: "explicit", selectionType: "explicit-model", requestedModel: "model-a", nativeParameters: {}, profileId: facts.profileId, runnerId: facts.runnerId, providerId: facts.harnessId, backendId: facts.backendId, contextFingerprint: facts.catalog!.contextFingerprint, catalogRevision: facts.catalog!.revision, configRevision: f.service.configuration.current().revision, selectedAt: f.clock.now.toISOString() };
  const delivery: ScmDeliverySelection = { version: 1, scmConnectorId: order.delivery.scmConnectorId, repository: order.delivery.targetRepository, baseBranch: order.delivery.baseBranch, target: { version: 1, host: "github.com", repository: order.delivery.targetRepository, remoteFingerprint: "e".repeat(64) }, contextFingerprint: "delivery:1", configRevision: selection.configRevision, reviewedAt: f.clock.now.toISOString() };
  // Real canonical compiler/UoW/SQLite, synthetic Git/native/SCM boundaries only.
  const starts: string[] = [], scheduled: Array<() => Promise<void>> = [], runtime = { prepare: async () => structuredClone(selection), prepareDelivery: async () => structuredClone(delivery), dispatch: vi.fn(async (record: PublicationRecord) => { expect(f.service.database.handle.isTransaction).toBe(false); expect(f.service.database.handle.prepare("SELECT COUNT(*) AS n FROM rhiza_admissions").get()?.n).toBe(1); starts.push(renderTaskContract(record.contract!)); return { id: "run-a", state: "ACTIVE" } as Run; }) };
  const publications = new PublicationService(f.service.database, f.service.configuration, new CanonicalTaskService(f.service.database), { inspect: async () => ({ root: f.repository, baseCommit: "base-fixture" }) }, () => f.clock.now, runtime);
  const options = { now: () => f.clock.now, schedule: (operation: () => Promise<void>) => { scheduled.push(operation); } };
  const jobs = new RhizaJobs(f.service.database, auth, targets, publications, options);
  return { ...f, auth, principal, facts, targets, publications, jobs, request, starts, scheduled, runtime, options };
}
