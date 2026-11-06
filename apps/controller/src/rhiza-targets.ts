import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { DispatcherConfig } from "@dispatcher/config";
import { freezeExecutionSelection } from "@dispatcher/adapters";
import {admitCatalogPricing,samePricingTerms,type AccountModelCatalog,type ExecutionSelection} from "@dispatcher/domain";
import {RhizaAdmissionStore,type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import {RhizaReassignments} from "./rhiza-reassignments.js";
import {rhizaSubmissionHash} from "./rhiza-operations.js";
import type { RhizaCatalogTargetV1, RhizaTargetCatalogV1, RhizaExecutionTargetV1, RhizaWorkOrderV1, RhizaPreflightV1, RhizaSubmitRequestV1 } from "@dispatcher/protocol";
import { containsSecretLike } from "@dispatcher/observability";
import type { ControlPrincipal } from "./control-auth.js";
import { RhizaIngressError, type RhizaServiceAuth } from "./rhiza-auth.js";
import { rhizaApprovalDigest, rhizaDigest, rhizaInputHash } from "./rhiza-semantics.js";
import { assertPublicationScope } from "./task-publications.js";

export interface RhizaTargetFacts {
  executorRef: string; runnerId: string; profileId: string; harnessId: string; backendId: string;
  profileRevision: string; adapterVersion: string; cliVersion?: string; catalog?: AccountModelCatalog;
  ready: boolean; evidenceCapabilities: Array<"configuration_confirmed" | "verified">;
  repositoryIdentity?: { root: string; rootIdentity: { device: number; inode: number } };
}
export interface RhizaPreflightRecord {
  version: 1;
  clientId: string; authorizationRevision: number; workOrder: RhizaWorkOrderV1; selection: ExecutionSelection;
  receipt: RhizaPreflightV1; scopeEvidence: { root: string; rootIdentity: { device: number; inode: number } };
}
export interface RhizaTargetsOptions {
  config(): { config: DispatcherConfig; revision: number }; now(): Date;
  facts(repositoryId: string, profileId: string): RhizaTargetFacts;
  inspectScope(repositoryId: string, scopePaths: string[]): Promise<RhizaPreflightRecord["scopeEvidence"]>;
}
const fail = (code: string, message: string): never => { throw new RhizaIngressError(code, code === "INVALID_REQUEST" ? 400 : 409, message); };
const controlCharacters = (value: string): boolean => Array.from(value).some(character => { const code = character.codePointAt(0)!; return code < 32 || code === 127 || code >= 0xd800 && code <= 0xdfff; });
const safe = (value: string): boolean => value.length > 0 && value.length <= 512 && !controlCharacters(value) && !containsSecretLike(value) && !/^(?:[a-z]+:\/\/|\/|[A-Za-z]:\\)/i.test(value);
// Native catalog identities are hashes, not bearer credentials. Keep the generic
// secret heuristic for names/options. Native producers currently emit only
// these digest formats; unknown diagnostic strings must stay private.
const safeIdentity = (value: string): boolean => /^(?:sha256:)?[a-f0-9]{64}$/.test(value);
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
export function rhizaRepositoryIdentity(path: string): RhizaPreflightRecord["scopeEvidence"] | undefined {
  try { const root = realpathSync(path), info = statSync(root); return info.isDirectory() ? { root, rootIdentity: { device: info.dev, inode: info.ino } } : undefined; }
  catch { return undefined; }
}
let buildVersion: string | undefined;
/** Pin installed adapter implementation bytes, without spawning or asserting release qualification. */
export function rhizaAdapterBuildVersion(): string {
  if (buildVersion) return buildVersion;
  const root = dirname(fileURLToPath(import.meta.resolve("@dispatcher/adapters"))), files: Array<{ path: string; content: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Adapter build contains an unpinned link");
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push({ path: relative(root, path), content: readFileSync(path, "utf8") });
    }
  };
  walk(root);
  if (!files.length) throw new Error("Adapter build is unavailable");
  buildVersion = `sha256:${rhizaDigest(files)}`;
  return buildVersion;
}
function future(value: string, now: number): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now && [new Date(parsed).toISOString(), new Date(parsed).toISOString().replace(".000Z", "Z")].includes(value);
}

/** Reads applied snapshots only; native/SCM probes are never triggered here. */
export class RhizaTargets {
  constructor(private readonly db: DispatcherDatabase, private readonly auth: RhizaServiceAuth, private readonly options: RhizaTargetsOptions) {}

  review(principal: ControlPrincipal | undefined, input: RhizaSubmitRequestV1): RhizaPreflightRecord {
    const order = input.workOrder, grant = this.auth.current(principal, ["jobs:submit", "targets:read"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
    const record = this.db.getEntity<JsonValue>("rhiza-preflight", input.preflightId) as unknown as RhizaPreflightRecord | undefined;
    if (!record || record.version !== 1 || record.clientId !== grant.id) throw new RhizaIngressError("NOT_FOUND", 404, "Preflight is unavailable");
    if (Date.parse(record.receipt.expiresAt) <= this.options.now().getTime()) fail("PREFLIGHT_EXPIRED", "Preflight expired; refresh and approve again");
    if (record.authorizationRevision !== principal!.service!.authorizationRevision) fail("TARGET_CHANGED", "Preflight authority changed; refresh and approve again");
    if (rhizaDigest(order) !== record.receipt.workOrderHash || rhizaDigest(order.target) !== input.targetHash || input.targetHash !== record.receipt.target.targetHash) fail("INVALID_REQUEST", "Submission differs from its approved preflight");
    const accepted=new RhizaAdmissionStore(this.db).get({clientId:grant.id,commandScope:"jobs.submit",requestId:input.requestId});
    if(accepted&&accepted.requestHash!==rhizaSubmissionHash(input))fail("IDEMPOTENCY_CONFLICT","The request key already belongs to another work order");
    const selection = this.resolve(principal, order,accepted?.jobId,record.selection);
    if (rhizaDigest({ ...selection, selectedAt: record.selection.selectedAt }) !== rhizaDigest(record.selection)
      || rhizaDigest(rhizaRepositoryIdentity(record.scopeEvidence.root) ?? null) !== rhizaDigest(record.scopeEvidence)) fail("TARGET_CHANGED", "Frozen selection or physical repository changed");
    return structuredClone(record);
  }

  catalog(principal: ControlPrincipal | undefined, repositoryId: string): RhizaTargetCatalogV1 {
    const grant = this.auth.current(principal, ["targets:read"], { repositoryId });
    const targets: RhizaCatalogTargetV1[] = []; let bytes = 0;
    for (const profileId of grant.profileIds) {
      const row = this.project(repositoryId, this.options.facts(repositoryId, profileId));
      bytes += Buffer.byteLength(JSON.stringify(row), "utf8");
      if (bytes > 1024 * 1024) fail("TARGET_UNAVAILABLE", "The authorized catalog exceeds the bounded projection size");
      targets.push(row);
    }
    this.auth.current(principal, ["targets:read"], { repositoryId });
    return { schemaVersion: 1, repositoryId, revision: rhizaDigest({ repositoryId, targets }), targets };
  }

  private project(repositoryId: string, facts: RhizaTargetFacts): RhizaCatalogTargetV1 {
    const catalog = facts.catalog;
    const fresh = !!catalog && safeIdentity(catalog.revision) && safeIdentity(catalog.contextFingerprint) && catalog.entries.length <= 1000 && catalog.freshness === "native-fresh" && !catalog.failure && catalog.selectionSupport === "explicit"
      && Number.isFinite(Date.parse(catalog.fetchedAt)) && Date.parse(catalog.fetchedAt) <= this.options.now().getTime()
      && this.options.now().getTime() - Date.parse(catalog.fetchedAt) <= 300000
      && catalog.profileId === facts.profileId && catalog.runnerId === facts.runnerId && catalog.providerId === facts.harnessId && catalog.backendId === facts.backendId;
    const ready = facts.ready && fresh && !!facts.repositoryIdentity && !!facts.cliVersion && safe(facts.cliVersion);
    const models = fresh ? catalog.entries.filter(entry => safe(entry.id) && entry.kind === "model" && ["account-listed", "unconfirmed", "denied"].includes(entry.access)).map(entry => {
      const options = Object.fromEntries(Object.entries(entry.parameterOptions).filter(([key, values]) => safe(key) && values.length <= 32 && values.every(value => typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean" || safe(value))));
      const complete = Object.keys(entry.parameterOptions).length <= 20 && Object.keys(options).length === Object.keys(entry.parameterOptions).length;
      return { modelId: entry.id, selectable: ready && complete && entry.selectable && entry.access === "account-listed", access: entry.access, modelOptions: complete ? options : {} };
    }) : [];
    return { repositoryId, executorRef: facts.executorRef, runnerId: facts.runnerId, profileId: facts.profileId, harnessId: facts.harnessId, backendId: facts.backendId,
      profileRevision: facts.profileRevision, adapterVersion: facts.adapterVersion, cliVersion: facts.cliVersion && safe(facts.cliVersion) ? facts.cliVersion : null,
      catalogRevision: fresh && facts.repositoryIdentity ? rhizaDigest({ nativeRevision: catalog.revision, repositoryIdentity: facts.repositoryIdentity }) : null, contextFingerprint: fresh ? catalog.contextFingerprint : null,
      status: ready && models.some(model => model.selectable) ? "available" : "unverified", releaseQualified: false,
      evidenceCapabilities: ready ? [...facts.evidenceCapabilities] : [], models };
  }

  private resolve(principal: ControlPrincipal | undefined, order: RhizaWorkOrderV1,acceptedJobId?:string,reviewed?:ExecutionSelection): ExecutionSelection {
    this.auth.current(principal, ["targets:read", "jobs:submit"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
    new RhizaReassignments(this.db,this.auth,this.options.now).check(principal,order,acceptedJobId);
    const now = this.options.now().getTime(), snapshot = this.options.config();
    const repository = snapshot.config.repositories.find(repo => repo.id === order.repositoryId);
    if (!repository) return fail("TARGET_UNAVAILABLE", "The registered repository is unavailable");
    if (!future(order.approval.expiresAt, now)) fail("APPROVAL_EXPIRED", "The approval is invalid or expired");
    if (!future(order.deadline, now)) fail("DEADLINE_EXCEEDED", "The work order deadline is invalid or expired");
    if (Buffer.byteLength(order.context.content, "utf8") > 65536 || rhizaInputHash(order.context.content) !== order.context.inputHash || rhizaApprovalDigest(order) !== order.approval.digest) fail("INVALID_REQUEST", "Context or approval does not bind this exact work order");
    if (order.scopePaths.some(path => !path || path.startsWith("/") || /[\\:]/.test(path) || controlCharacters(path) || path.split("/").some(part => part === ".." || part === ".git") || posix.normalize(path) !== path)
      || order.verificationCommandIds.some(id => !repository.verificationCommands.some(command => command.id === id))) fail("INVALID_REQUEST", "The scope or registered verification selection is invalid");
    try { assertPublicationScope(order.scopePaths, repository.scopePaths); } catch { fail("INVALID_REQUEST", "The scope exceeds the registered boundary"); }
    const facts = this.options.facts(order.repositoryId, order.target.profileId), projected = this.project(order.repositoryId, facts);
    const expected = { executorRef: facts.executorRef, runnerId: facts.runnerId, profileId: facts.profileId, harnessId: facts.harnessId, backendId: facts.backendId,
      profileRevision: facts.profileRevision, adapterVersion: facts.adapterVersion, cliVersion: projected.cliVersion, catalogRevision: projected.catalogRevision, contextFingerprint: projected.contextFingerprint };
    if (Object.entries(expected).some(([key, value]) => order.target[key as keyof RhizaExecutionTargetV1] !== value)) fail("TARGET_CHANGED", "The execution target changed; refresh and approve again");
    const model = projected.models.find(model => model.modelId === order.target.modelId);
    if (projected.status !== "available" || !model?.selectable || Object.entries(order.target.modelOptions).some(([key, value]) => !Object.hasOwn(model.modelOptions, key) || !model.modelOptions[key]!.includes(value))) fail("TARGET_UNAVAILABLE", "The explicit model or options are unavailable");
    if (!projected.evidenceCapabilities.includes(order.evidencePolicy.minimum)) fail("MODEL_EVIDENCE_REQUIRED", "The requested model evidence policy cannot be fulfilled");
    const price=admitCatalogPricing(facts.catalog!,order.target.modelId,order.target.modelOptions,this.options.now().toISOString());
    const pricingSnapshot=price.status==="available"?reviewed?.pricingSnapshot&&samePricingTerms(reviewed.pricingSnapshot,price.snapshot)?structuredClone(reviewed.pricingSnapshot):price.snapshot:undefined;
    const selection: ExecutionSelection = { ...(pricingSnapshot?{pricingSnapshot}:{}),version: 1, mode: "manual", source: "explicit", selectionType: "explicit-model", requestedModel: order.target.modelId,
      nativeParameters: { ...order.target.modelOptions }, profileId: facts.profileId, runnerId: facts.runnerId, providerId: facts.harnessId, backendId: facts.backendId,
      contextFingerprint: order.target.contextFingerprint, catalogRevision: facts.catalog!.revision, configRevision: snapshot.revision, selectedAt: this.options.now().toISOString() };
    try { return freezeExecutionSelection(selection, { profileId: facts.profileId, providerId: facts.harnessId, backendId: facts.backendId, selection: true, reasoning: true })!; }
    catch { return fail("TARGET_UNAVAILABLE", "The native backend cannot transmit the selected model parameters"); }
  }

  async preflight(principal: ControlPrincipal | undefined, input: RhizaWorkOrderV1): Promise<RhizaPreflightV1> {
    const order = structuredClone(input), selection = this.resolve(principal, order), workOrderHash = rhizaDigest(order);
    let scopeEvidence: RhizaPreflightRecord["scopeEvidence"];
    try { scopeEvidence = await this.options.inspectScope(order.repositoryId, order.scopePaths); }
    catch { return fail("INVALID_REQUEST", "The physical repository scope could not be verified"); }
    // Revoke, catalog/profile drift and expiry can occur during filesystem reads.
    const current=this.resolve(principal,order,undefined,selection);
    if(rhizaDigest({...current,selectedAt:selection.selectedAt})!==rhizaDigest(selection))fail("TARGET_CHANGED","Frozen native selection or price changed during preflight");
    if (rhizaDigest(this.options.facts(order.repositoryId, order.target.profileId).repositoryIdentity ?? null) !== rhizaDigest(scopeEvidence)) fail("TARGET_CHANGED", "The physical repository identity changed; refresh and approve again");
    const grant = this.auth.current(principal, ["targets:read", "jobs:submit"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
    const receipt: RhizaPreflightV1 = { schemaVersion: 1, preflightId: randomUUID(), inputHash: order.context.inputHash, workOrderHash,
      target: { ...order.target, targetHash: rhizaDigest(order.target) }, expiresAt: new Date(Math.min(this.options.now().getTime() + 300000, Date.parse(grant.expiresAt), Date.parse(order.approval.expiresAt), Date.parse(order.deadline))).toISOString() };
    const record: RhizaPreflightRecord = { version: 1, clientId: grant.id, authorizationRevision: principal!.service!.authorizationRevision, workOrder: order, selection, receipt, scopeEvidence };
    this.db.saveEntity("rhiza-preflight", receipt.preflightId, json(record));
    return structuredClone(receipt);
  }
}
