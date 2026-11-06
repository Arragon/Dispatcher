import { randomUUID } from "node:crypto";
import type { PublishDraftV1, Run } from "@dispatcher/domain";
import { RhizaAdmissionStore, ModelInvocationStore, RhizaCommandStore,hasRhizaSuccessor, type DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import type {AdapterSession} from "@dispatcher/adapters";
import {projectRhizaModelEvidence} from "./rhiza-model-evidence.js";
import type { RhizaReceiptV1, RhizaSubmitRequestV1 } from "@dispatcher/protocol";
import type { ControlPrincipal } from "./control-auth.js";
import { RhizaIngressError, type RhizaServiceAuth } from "./rhiza-auth.js";
import { RhizaOperations, rhizaSubmissionHash } from "./rhiza-operations.js";
import { rhizaDigest } from "./rhiza-semantics.js";
import type { RhizaTargets } from "./rhiza-targets.js";
import { PublicationError, type PublicationRecord, type PublicationService } from "./task-publications.js";

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
export interface RhizaJobRecord {
  version: 1; jobId: string; taskId: string; publicationId: string; owner: string;
  principal: ControlPrincipal; request: RhizaSubmitRequestV1;
  dispatch: { state: "pending" | "claimed" | "observed" | "unknown"; runId?: string; code?: string };
}
interface Options { now(): Date; schedule?(operation: () => Promise<void>): void }
class AcceptedElsewhere extends Error { constructor(readonly receipt: RhizaReceiptV1) { super("Acceptance already exists"); } }

/** Canonical publication adapter and external-effect journal, not a scheduler. */
export class RhizaJobs {
  private readonly operations: RhizaOperations;
  private readonly store: RhizaAdmissionStore;
  private readonly pending = new Map<string, { hash: string; result: Promise<RhizaReceiptV1> }>();
  private readonly launches = new Set<Promise<void>>();
  private closed = false;
  constructor(private readonly db: DispatcherDatabase, private readonly auth: RhizaServiceAuth, private readonly targets: RhizaTargets, private readonly publications: PublicationService, private readonly options: Options) {
    this.operations = new RhizaOperations(db, auth); this.store = new RhizaAdmissionStore(db);
  }

  closeAdmissions(): void { this.closed = true; }
  async drain(): Promise<void> { await Promise.allSettled([...this.launches]); }
  reconcile(): void {
    for (const value of this.db.listEntities<JsonValue>("rhiza-job")) {
      const job = value as unknown as RhizaJobRecord;
      const publication = this.publications.record(job.owner, job.publicationId), runId = publication.receipt?.runId ?? job.dispatch.runId;
      const run = runId ? this.db.getEntity<JsonValue>("run", runId) as unknown as Run | undefined : undefined;
      if (job.dispatch.state === "unknown" || job.dispatch.state === "observed" && run && ["COMPLETE", "FAILED", "CANCELLED", "SUPERSEDED"].includes(run.state)) continue;
      job.dispatch = { state: "unknown", code: "LAUNCH_UNCERTAIN", ...(runId ? { runId } : {}) };
      this.db.saveEntity("rhiza-job", job.jobId, json(job));
    }
  }

  async submit(principal: ControlPrincipal | undefined, input: RhizaSubmitRequestV1): Promise<RhizaReceiptV1> {
    const request = structuredClone(input), replay = this.operations.replay(principal, request);
    if (replay) return replay;
    if (this.closed) throw new RhizaIngressError("INGRESS_DISABLED", 503, "External admission is closed");
    this.targets.review(principal, request);
    const key = rhizaDigest({ clientId: principal!.service!.clientId, scope: "jobs.submit", requestId: request.requestId }), hash = rhizaSubmissionHash(request), existing = this.pending.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new RhizaIngressError("IDEMPOTENCY_CONFLICT", 409, "The pending request binds another semantic work order");
      await existing.result;
      return this.operations.replay(principal, request)!;
    }
    const result = this.accept(principal!, request); this.pending.set(key, { hash, result });
    try { return await result; } finally { this.pending.delete(key); }
  }

  private async accept(principal: ControlPrincipal, request: RhizaSubmitRequestV1): Promise<RhizaReceiptV1> {
    const preflight = this.targets.review(principal, request), order = request.workOrder, owner = principal.id;
    const draft: PublishDraftV1 = { schemaVersion: 1, clientDraftId: rhizaDigest({ clientId: principal.service!.clientId, requestId: request.requestId }),
      title: order.title, description: order.description, projectId: `local:${order.repositoryId}`, repositoryId: order.repositoryId,
      scopePaths: [...order.scopePaths], constraints: [...order.constraints], inputContext: { ...order.context }, acceptanceCriteria: [...order.acceptanceCriteria], verificationCommandIds: [...order.verificationCommandIds],
      startMode: "dispatch", execution: { profileId: order.target.profileId, selectionMode: "manual", selectionType: "explicit-model", selectionSource: "explicit", nativeModelId: order.target.modelId, nativeParameters: { ...order.target.modelOptions },
        catalogRevision: preflight.selection.catalogRevision!, contextFingerprint: preflight.selection.contextFingerprint }, delivery: { ...order.delivery } };
    let accepted: RhizaReceiptV1 | undefined, created = false;
    try {
      const preview = await this.publications.preview(owner, draft,undefined,preflight.selection);
      this.targets.review(principal, request);
      const publicationKey = `rhiza:${rhizaDigest({ clientId: principal.service!.clientId, scope: "jobs.submit", requestId: request.requestId })}`;
      await this.publications.commit(owner, preview.publicationId, publicationKey, { revision: preview.revision, reviewHash: preview.confirmation.reviewHash, confirmation: { accepted: true } }, {
        validate: record => {
          if (this.closed) throw new RhizaIngressError("INGRESS_DISABLED", 503, "External admission is closed");
          this.targets.review(principal, request);
          if (!record.selection || rhizaDigest({ ...record.selection, selectedAt: preflight.selection.selectedAt }) !== rhizaDigest(preflight.selection)) throw new RhizaIngressError("TARGET_CHANGED", 409, "Canonical publication changed the exact target");
        },
        commit: (record, receipt) => {
          this.targets.review(principal,request);
          const grant = this.auth.current(principal, ["jobs:submit"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
          const saved = this.store.accept({ clientId: grant.id, commandScope: "jobs.submit", requestId: request.requestId }, rhizaSubmissionHash(request), () => {
            const jobId = randomUUID();
            accepted = { schemaVersion: 1, receiptId: randomUUID(), requestId: request.requestId, clientId: grant.id, requestHash: rhizaSubmissionHash(request), jobId, taskId: receipt.taskId, state: "accepted", acceptedAt: this.options.now().toISOString(), origin: structuredClone(order.origin), targetHash: request.targetHash, inputHash: order.context.inputHash,...(order.reassignment?{reassignment:structuredClone(order.reassignment)}:{}) };
            const job: RhizaJobRecord = { version: 1, jobId, taskId: receipt.taskId, publicationId: preview.publicationId, owner, principal: structuredClone(principal), request: structuredClone(request), dispatch: { state: "pending" } };
            this.db.saveEntity("rhiza-job", jobId, json(job));
            this.db.saveEntity("task-rhiza-binding", receipt.taskId, json({ version: 1, jobId, clientId: grant.id, origin: order.origin }));
            record.rhizaJobId = jobId; created = true;
            return { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId, jobId, taskId: receipt.taskId, receipt: json(accepted) };
          });
          if (saved.taskId !== receipt.taskId) throw new AcceptedElsewhere(saved.receipt as unknown as RhizaReceiptV1);
          accepted = saved.receipt as unknown as RhizaReceiptV1;
        },
      });
    } catch (error) {
      if (error instanceof AcceptedElsewhere) return error.receipt;
      if (error instanceof PublicationError) {
        this.auth.current(principal, ["jobs:submit"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
        throw new RhizaIngressError(error.code === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_CONFLICT" : error.code === "SELECTION_CHANGED" ? "TARGET_CHANGED" : "INVALID_REQUEST", 409, "Canonical publication requires a fresh valid review");
      }
      throw error;
    }
    accepted ??= this.operations.replay(principal, request);
    if (!accepted) throw new RhizaIngressError("INTERNAL_ERROR", 500, "Acceptance could not be read; query the original request key");
    if (created) {
      const jobId = accepted.jobId, launch = () => {
        const promise = this.launch(jobId); this.launches.add(promise);
        void promise.finally(() => this.launches.delete(promise)); return promise;
      };
      try { (this.options.schedule ?? (operation => queueMicrotask(() => { void operation(); })))(launch); }
      catch { this.markUnknown(jobId); }
    }
    return structuredClone(accepted);
  }

  assertPublication(record: PublicationRecord): void {
    if (!record.rhizaJobId) return;
    const job = this.job(record.rhizaJobId);
    if (hasRhizaSuccessor(this.db,job.jobId)||this.closed || job.dispatch.state !== "claimed" || job.taskId !== record.receipt?.taskId || job.publicationId !== record.preview.publicationId) throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED", 409, "External dispatch authority is not current");
    this.targets.review(job.principal, job.request);
  }

  assertTask(taskId: string): void {
    if(new RhizaCommandStore(this.db).hasCancellation(taskId))throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Cancellation forbids a later native start");
    const binding = this.db.getEntity<JsonValue>("task-rhiza-binding", taskId) as { jobId: string } | undefined;
    if (!binding) return;
    const job = this.job(binding.jobId);
    if (job.taskId !== taskId) throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED", 409, "External task binding changed");
    this.assertPublication(this.publications.record(job.owner, job.publicationId));
  }

  executionJob(run:Run):RhizaJobRecord|undefined {
    const binding=this.db.getEntity<JsonValue>("task-rhiza-binding",run.taskId) as {jobId:string}|undefined;
    if(!binding)return;
    const job=this.job(binding.jobId);if(hasRhizaSuccessor(this.db,job.jobId))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"An explicit successor owns this external attempt");const task=this.db.getCanonicalTask<JsonValue>(run.taskId)?.document as {currentRunId?:string}|undefined;
    const current=this.db.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
    const accepted=this.store.get({clientId:job.principal.service!.clientId,commandScope:"jobs.submit",requestId:job.request.requestId});
    if(job.taskId!==run.taskId||task?.currentRunId!==run.id||!current||current.sessionId!==run.sessionId||current.generation!==run.generation||current.attempt!==run.attempt||current.leaseId!==run.leaseId||rhizaDigest(current.executionSelection??null)!==rhizaDigest(run.executionSelection??null)||accepted?.jobId!==job.jobId||accepted.taskId!==run.taskId||accepted.requestHash!==rhizaSubmissionHash(job.request))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Candidate belongs to another external execution authority");
    return job;
  }
  modelEvidence(run:Run,at?:string):ReturnType<typeof projectRhizaModelEvidence>|undefined {
    const job=this.executionJob(run);if(!job)return;
    const session=this.db.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession|undefined;
    const invocation=session?.modelInvocationId?new ModelInvocationStore(this.db).get(session.modelInvocationId):undefined;
    // No currently registered producer qualifies executed-model metadata. Do not
    // use run.model, UI projection, echoed output or a filled historical baseline.
    return projectRhizaModelEvidence({order:job.request.workOrder,targetHash:job.request.targetHash,run,session,invocation,now:at===undefined?this.options.now():new Date(at)});
  }
  assertCandidate(run:Run,at?:string):void {
    if(new RhizaCommandStore(this.db).hasCancellation(run.taskId))throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Cancellation prevents candidate qualification");
    const result=this.modelEvidence(run,at);if(!result)return;
    if(!result.candidateAllowed)throw new RhizaIngressError(result.evidence.status==="mismatch"?"MODEL_EVIDENCE_MISMATCH":"MODEL_EVIDENCE_REQUIRED",409,"Frozen model evidence policy is not satisfied; no automatic downgrade");
  }
  assertTaskCandidate(taskId:string,runId:string|undefined):void {
    if(!this.db.getEntity("task-rhiza-binding",taskId))return;
    const run=runId?this.db.getEntity<JsonValue>("run",runId) as unknown as Run|undefined:undefined;
    if(!run||run.taskId!==taskId)throw new RhizaIngressError("MODEL_EVIDENCE_REQUIRED",409,"External candidate has no canonical execution proof");
    this.assertCandidate(run);
    if(run.state!=="COMPLETE")throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"External candidate execution has not completed");
  }

  private job(jobId: string): RhizaJobRecord {
    const value = this.db.getEntity<JsonValue>("rhiza-job", jobId) as unknown as RhizaJobRecord | undefined;
    if (!value || value.version !== 1) throw new RhizaIngressError("NOT_FOUND", 404, "External job is unavailable");
    return value;
  }
  private markUnknown(jobId: string): void {
    const job = this.job(jobId), publication = this.publications.record(job.owner, job.publicationId), runId = publication.receipt?.runId ?? job.dispatch.runId;
    job.dispatch = { state: "unknown", code: "LAUNCH_UNCERTAIN", ...(runId ? { runId } : {}) }; this.db.saveEntity("rhiza-job", jobId, json(job));
  }
  private async launch(jobId: string): Promise<void> {
    try {
      const claimed = this.db.transaction(() => {
        const job = this.job(jobId);
        if (job.dispatch.state !== "pending") return false;
        if (this.closed) { this.markUnknown(jobId); return false; }
        this.targets.review(job.principal, job.request);
        job.dispatch = { state: "claimed" }; this.db.saveEntity("rhiza-job", jobId, json(job)); return true;
      });
      if (!claimed) return;
      const job = this.job(jobId); this.assertPublication(this.publications.record(job.owner, job.publicationId));
      const result = await this.publications.launchAccepted(job.owner, job.publicationId);
      if (!result.runId || result.state !== "STARTED") { this.markUnknown(jobId); return; }
      const latest = this.job(jobId);
      if (latest.dispatch.state !== "claimed") return;
      latest.dispatch = { state: "observed", runId: result.runId }; this.db.saveEntity("rhiza-job", jobId, json(latest));
    } catch { this.markUnknown(jobId); }
  }
}
