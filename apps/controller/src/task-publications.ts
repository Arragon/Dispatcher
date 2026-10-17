import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { ConfigurationEngine, RepositoryConfig } from "@dispatcher/config";
import type { PublishDraftV1, PublicationPreview, PublicationReceipt, Task, TaskContract, ExecutionSelection, Run, ModelRoutingDecision } from "@dispatcher/domain";
import type { CanonicalTaskService } from "@dispatcher/integrations";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { TaskContractCompiler } from "@dispatcher/semantic";
import type { WorkspaceManager } from "@dispatcher/workspace";
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const startupState = (run: Run): PublicationReceipt["state"] => run.state === "RUNNER_UNAVAILABLE" ? "OUTCOME_UNKNOWN" : run.state === "FAILED" ? "START_FAILED" : "STARTED";
export function contentHash(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))??"undefined").digest("hex");
}
export class PublicationError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string,readonly routingDecision?:ModelRoutingDecision) { super(message); }
}
export interface PublicationRecord {
  owner: string; draft: PublishDraftV1; preview: PublicationPreview; configRevision: number;
  selection?: ExecutionSelection; contract?: TaskContract; baseCommit?: string; repository?: RepositoryConfig; receipt?: PublicationReceipt;
  taskBinding?:{taskId:string;taskRevision:number;contractHash:string};
}
export function assertPublicationScope(scopes:string[],allowed:string[]):void {
  if(allowed.length && scopes.some(scope=>!allowed.some(parent=>{const rel=posix.relative(parent,scope);return rel===""||(!rel.startsWith("../")&&rel!==".."&&!posix.isAbsolute(rel));})))throw new PublicationError("INVALID_SCOPE",400,"Requested scope exceeds registered scope");
}
export class PublicationService {
  private readonly pending = new Map<string, Promise<PublicationReceipt>>();
  constructor(private readonly db: DispatcherDatabase, private readonly config: ConfigurationEngine, private readonly tasks: CanonicalTaskService, private readonly workspaces: Pick<WorkspaceManager,"inspect">, private readonly now: () => Date, private readonly runtime: {
    prepare(draft: PublishDraftV1, repository: RepositoryConfig, workspacePath?: string,context?:{owner:string;reviewed?:ExecutionSelection}): Promise<ExecutionSelection>;
    dispatch(record: PublicationRecord, taskId: string): Promise<Run>;
  }) {}
  reconcile(): void {
    for (const value of this.db.listEntities<JsonValue>("task-publication")) {
      const r=value as unknown as PublicationRecord;
      if(!r.receipt)continue;
      const existingRun=r.receipt?.runId ? this.db.getEntity<JsonValue>("run",r.receipt.runId) as unknown as Run|undefined : undefined;
      const detached=r.receipt?.state==="STARTED"&&existingRun&&["ACTIVE","STARTING"].includes(existingRun.state);
      if(!detached&&r.receipt?.state!=="STARTING" && !(r.receipt?.state==="TASK_CREATED" && r.draft.startMode==="dispatch"))continue;
      const run=r.receipt.runId ? this.db.getEntity<JsonValue>("run",r.receipt.runId) as unknown as Run|undefined : undefined;
      r.receipt.state=!detached && run && !run.sessionId.startsWith("unstarted:") ? run.state==="FAILED"?"START_FAILED":"STARTED" : "OUTCOME_UNKNOWN";
      r.receipt.message="Recovered after interruption; execution is never automatically retried";
      if(r.receipt.state==="OUTCOME_UNKNOWN"&&run&&["STARTING","ACTIVE"].includes(run.state)){
        const remote=this.config.current().config.runners.some(runner=>runner.id===run.runnerId&&runner.mode==="remote");
        run.recoveryState=run.state;run.state="RUNNER_UNAVAILABLE";run.resumePolicy="manual";run.recoveryReason=remote?"REMOTE_RECONCILE_REQUIRED":"NATIVE_OUTCOME_UNKNOWN";if(!remote)run.activitySummary="Native process liveness is unknown after Controller restart; inspect the original native session and worktree before further execution";
        this.db.transaction(()=>{
          this.db.saveEntity("run",run.id,json(run));
          const current=this.db.getCanonicalTask<JsonValue>(run.taskId);const task=current?.document as unknown as Task|undefined;
          if(current&&task?.currentRunId===run.id&&["RUNNING","QUEUED"].includes(task.state))this.tasks.execute({id:`recovery:${run.id}:${current.revision}`,taskId:run.taskId,baseRevision:current.revision,actor:"publication-recovery",command:{type:"task.transition",state:task.state==="RUNNING"?"WAITING_USER":"WAITING_RESOURCE"}});
          this.db.saveEntity("task-publication",r.preview.publicationId,json(r));
        });
      }else this.db.saveEntity("task-publication",r.preview.publicationId,json(r));
    }
  }
  markStarting(owner:string,id:string,run:Run):void {
    const r=this.record(owner,id);if(!r.receipt || r.receipt.state!=="TASK_CREATED")throw new PublicationError("PUBLICATION_CHANGED",409,"Publication startup already reserved");
    r.receipt={...r.receipt,state:"STARTING",runId:run.id};this.db.saveEntity("task-publication",id,json(r));
  }
  markOutcome(owner:string,id:string,run:Run):void {
    const r=this.record(owner,id);if(r.receipt?.runId!==run.id)throw new PublicationError("PUBLICATION_CHANGED",409,"Run is not the publication startup");
    if(!run.failureReason)delete r.receipt.message;
    r.receipt={...r.receipt,state:startupState(run),...(run.failureReason?{message:run.failureReason}:{})};this.db.saveEntity("task-publication",id,json(r));
  }
  get(owner: string, id: string): PublicationPreview | PublicationReceipt {
    const record = this.record(owner,id); return record.receipt ?? record.preview;
  }
  record(owner: string, id: string): PublicationRecord {
    const record = this.db.getEntity<JsonValue>("task-publication",id) as unknown as PublicationRecord | undefined;
    if (!record || record.owner !== owner) throw new PublicationError("PUBLICATION_NOT_FOUND",404,"Publication not found"); return record;
  }
  private assertCurrentDraft(record:PublicationRecord):void {
    const identity=contentHash({owner:record.owner,clientDraftId:record.draft.clientDraftId,inputHash:record.preview.inputHash});
    const binding=this.db.getEntity<JsonValue>("publication-draft",identity) as {publicationId:string}|undefined;
    if(binding?.publicationId!==record.preview.publicationId)throw new PublicationError("STALE_REVIEW",409,"A newer review superseded this draft publication");
  }
  private assertTaskBinding(binding:NonNullable<PublicationRecord["taskBinding"]>):void {
    const stored=this.db.getCanonicalTask<JsonValue>(binding.taskId),task=stored?.document as unknown as Task|undefined;
    if(!stored||stored.revision!==binding.taskRevision||task?.state!=="READY"||contentHash(this.db.getTaskContract(binding.taskId))!==binding.contractHash)throw new PublicationError("TASK_CHANGED",409,"Task or contract changed; review this task again");
  }
  async previewTask(owner:string,taskId:string,expectedRevision:number,execution:PublishDraftV1["execution"]):Promise<PublicationPreview>{
    const stored=this.db.getCanonicalTask<JsonValue>(taskId),task=stored?.document as unknown as Task|undefined;
    const contract=this.db.getTaskContract<JsonValue>(taskId) as unknown as TaskContract|undefined;
    const intent=this.db.getEntity<JsonValue>("task-execution-intent",taskId) as {publicationId:string}|undefined;
    if(!stored||!task||!contract?.workspace||!intent)throw new PublicationError("TASK_REVIEW_UNAVAILABLE",409,"Task does not have a local publication workspace contract");
    this.record(owner,intent.publicationId);
    const taskBinding={taskId,taskRevision:expectedRevision,contractHash:contentHash(contract)};this.assertTaskBinding(taskBinding);
    const draft:PublishDraftV1={schemaVersion:1,clientDraftId:`task:${taskId}:${expectedRevision}`,title:task.title,description:contract.instructions??task.description??"",projectId:task.projectId,repositoryId:contract.workspace.repositoryId,baseRef:contract.workspace.baseRef,...(contract.workspace.targetBranch?{targetBranch:contract.workspace.targetBranch}:{}),scopePaths:contract.scope,acceptanceCriteria:contract.acceptanceCriteria,referenceLinks:contract.referenceLinks??[],verificationCommandIds:contract.verification,startMode:"dispatch",execution:structuredClone(execution),delivery:{type:contract.delivery.type,...(contract.delivery.repository?{targetRepository:contract.delivery.repository}:{}),...(contract.delivery.baseBranch?{baseBranch:contract.delivery.baseBranch}:{})}};
    return this.preview(owner,draft,{taskBinding,contract});
  }
  async preview(owner: string, draft: PublishDraftV1,existing?:{taskBinding:NonNullable<PublicationRecord["taskBinding"]>;contract:TaskContract}): Promise<PublicationPreview> {
    if (!draft.description.trim()) throw new PublicationError("INVALID_DRAFT",400,"Task description must not be blank");
    for (const [values,max] of [[draft.acceptanceCriteria,8000],[draft.referenceLinks??[],2000],[draft.scopePaths??[],4000]] as const) if (Array.from(values.join("\n")).length > max) throw new PublicationError("INVALID_DRAFT",400,"Draft field exceeds its length limit");
    for (const link of draft.referenceLinks??[]) { let url: URL; try {url=new URL(link);} catch {throw new PublicationError("INVALID_LINK",400,"Invalid reference link");} if (!["http:","https:"].includes(url.protocol)||url.username||url.password) throw new PublicationError("INVALID_LINK",400,"References require http(s) without credentials"); }
    const snapshot = this.config.current();
    const repository = snapshot.config.repositories.find(r=>r.id===draft.repositoryId);
    if (draft.repositoryId && !repository) throw new PublicationError("REPOSITORY_NOT_FOUND",400,"Select a registered repository");
    // Local projects have an explicit server-derived repository identity, independent of remote delivery names.
    if (draft.projectId !== (repository ? `local:${repository.id}` : "local:inbox")) throw new PublicationError("PROJECT_REPOSITORY_MISMATCH",400,"Local project does not own this repository");
    const scopes=draft.scopePaths??repository?.scopePaths??[];
    if(repository)assertPublicationScope(scopes,repository.scopePaths);
    const verification=draft.verificationCommandIds??repository?.verificationCommands.map(c=>c.id)??[];
    if (verification.some(id=>!repository?.verificationCommands.some(c=>c.id===id)) || repository?.verificationCommands.some(c=>c.required&&!verification.includes(c.id))) throw new PublicationError("INVALID_VERIFICATION",400,"Select registered verification commands, including every required command");
    const baseRef=draft.baseRef??repository?.defaultBaseRef??"";
    let baseCommit: string|undefined;
    if(repository) { try { baseCommit=(await this.workspaces.inspect({repositoryId:repository.id,baseRef:existing?.contract.workspace?.baseCommit??baseRef,scopePaths:scopes,...(draft.targetBranch?{targetBranch:draft.targetBranch}:{})})).baseCommit; } catch(error) { throw new PublicationError("INVALID_WORKSPACE",400,error instanceof Error?error.message:"Repository cannot be inspected"); } }
    const first=draft.description.split(/\r?\n/).find(line=>line.trim())?.trim()??"Task";
    const chars=Array.from(first); const title=draft.title?.trim() || chars.slice(0,80).join("")+(chars.length>80?"…":"");
    const compiled=new TaskContractCompiler().compile({externalId:draft.clientDraftId,title,description:draft.description,labels:[],dependencies:[],...(repository?{repository:repository.id}:{}),scope:scopes,acceptanceCriteria:draft.acceptanceCriteria.filter(s=>s.trim()),verification,constraints:[],delivery:{type:draft.delivery.type},extensions:{}},1,repository?{workspace:{repositoryId:repository.id,baseRef,...(baseCommit?{baseCommit}:{}),...(draft.targetBranch?{targetBranch:draft.targetBranch}:{})},...(draft.referenceLinks?{referenceLinks:draft.referenceLinks}:{})}:undefined);
    if(existing){this.assertTaskBinding(existing.taskBinding);compiled.contract=structuredClone(existing.contract);}
    const checks:PublicationPreview["checks"]=[{id:"workspace",status:repository?"passed":"warning",message:repository?"Registered physical Git root and base commit verified":"No repository; task needs specification"}];
    if (draft.delivery.type==="pull-request") checks.push({id:"delivery",status:"blocked",code:"DELIVERY_UNSUPPORTED",message:"Explicit pull-request delivery is not qualified yet"});
    if(draft.delivery.type==="commit")checks.push({id:"delivery",status:"passed",message:"Create a local commit in the owning Runner's managed worktree; no push or pull request"});
    let selection:ExecutionSelection|undefined;
    let routingDecision:ModelRoutingDecision|undefined;
    if(draft.startMode==="dispatch") {
      if(compiled.state!=="READY"||!repository)checks.push({id:"contract",status:"blocked",code:"NEEDS_SPEC",message:"Complete the task contract before dispatch"});
      else try {selection=await this.runtime.prepare(draft,repository,undefined,{owner});routingDecision=selection.routingDecision;checks.push({id:"dispatch",status:"passed",message:"Routing and native selection passed"});checks.push({id:"model-evidence",status:"warning",message:selection.selectionType==="native-default"?"Native configuration will choose the model; access, remaining quota and price are not confirmed":"Native catalog listing does not prove model access; remaining quota and price are not reported"});} catch(error){if(error instanceof PublicationError)routingDecision=error.routingDecision;checks.push({id:"dispatch",status:"blocked",code:error instanceof PublicationError?error.code:"DISPATCH_UNAVAILABLE",message:error instanceof Error?error.message:"Dispatch unavailable"});}
    }
    const publicationId=randomUUID(); const inputHash=contentHash(draft); const expiresAt=new Date(this.now().getTime()+600000).toISOString();
    if(existing)this.assertTaskBinding(existing.taskBinding);
    const reviewHash=contentHash({draft,taskBinding:existing?.taskBinding,configRevision:snapshot.revision,baseCommit,contract:compiled.contract,checks,selection:selection?{...selection,selectedAt:undefined}:undefined});
    const canCommit=!checks.some(c=>c.status==="blocked");
    const preview:PublicationPreview={publicationId,revision:1,state:canCommit?"PREVIEW":"NEEDS_INPUT",expiresAt,inputHash,...(routingDecision?{routingDecision}:{}),effectiveTask:{title,description:draft.description,contractState:compiled.state,missing:compiled.missing},...(selection&&baseCommit?{effectiveExecution:{profileId:selection.profileId,runnerId:selection.runnerId,providerId:selection.providerId,backendId:selection.backendId,selectionType:selection.selectionType,nativeParameters:selection.nativeParameters,selectionSource:selection.source,configRevision:selection.configRevision,contextFingerprint:selection.contextFingerprint,repositoryBaseCommit:baseCommit,...(selection.requestedModel?{nativeModelId:selection.requestedModel}:{}),...(selection.catalogRevision?{catalogRevision:selection.catalogRevision}:{})}}:{}),checks,confirmation:{required:true,reviewHash,reasons:[draft.startMode==="dispatch"?"Start a native agent in a managed worktree":"Create a canonical task"]},canCommit};
    if(existing)preview.taskBinding={taskId:existing.taskBinding.taskId,taskRevision:existing.taskBinding.taskRevision};
    const record:PublicationRecord={owner,draft:structuredClone(draft),preview,configRevision:snapshot.revision,...(existing?{taskBinding:existing.taskBinding}:{}),...(selection?{selection}:{}),...(compiled.contract?{contract:compiled.contract}:{}),...(repository?{repository}:{}),...(baseCommit?{baseCommit}:{})};
    return this.db.transaction(()=>{
      const draftIdentity=contentHash({owner,clientDraftId:draft.clientDraftId,inputHash});
      const binding=this.db.getEntity<JsonValue>("publication-draft",draftIdentity) as {publicationId:string}|undefined;
      const previous=binding?this.record(owner,binding.publicationId):undefined;
      if(previous&&(previous.receipt || (previous.preview.state==="PREVIEW"&&previous.preview.confirmation.reviewHash===reviewHash&&Date.parse(previous.preview.expiresAt)>this.now().getTime())))return previous.preview;
      if(!this.db.createEntityIfAbsent("task-publication",publicationId,json(record)))throw new PublicationError("PUBLICATION_CONFLICT",409,"Publication already exists");
      this.db.saveEntity("publication-draft",draftIdentity,json({publicationId}));return preview;
    });
  }
  async commit(owner: string,id: string,key: string|undefined,body: unknown): Promise<PublicationReceipt> {
    if(!key || key.length>200) throw new PublicationError("IDEMPOTENCY_KEY_REQUIRED",400,"Supply a stable Idempotency-Key");
    if(!body || typeof body!=="object") throw new PublicationError("INVALID_COMMIT",400,"Commit body is required");
    const input=body as {revision?:number;reviewHash?:string;confirmation?:{accepted?:boolean;routingAccepted?:boolean}};
    const receiptId=contentHash({owner,key});const requestHash=contentHash({id,body});
    const replay=()=>{const r=this.db.getEntity<JsonValue>("operation-receipt",receiptId) as unknown as {requestHash:string;publicationId:string}|undefined;if(r){if(r.requestHash!==requestHash)throw new PublicationError("IDEMPOTENCY_CONFLICT",409,"Key was used for a different commit");return this.record(owner,r.publicationId).receipt;}return undefined;};
    const existing=replay();if(existing)return existing;
    const pending=this.pending.get(id);if(pending){await pending;return this.commit(owner,id,key,body);}
    const operation=this.commitOnce(owner,id,input,receiptId,requestHash);this.pending.set(id,operation);
    try{return await operation;}catch(error){
      if(error instanceof PublicationError&&!["CONFIRMATION_REQUIRED","ROUTING_CONFIRMATION_REQUIRED","STALE_REVIEW","IDEMPOTENCY_CONFLICT"].includes(error.code)){
        const record=this.record(owner,id);
        if(!record.receipt){record.preview.state="NEEDS_REVIEW";record.preview.canCommit=false;record.preview.checks.push({id:"commit-review",status:"blocked",code:error.code,message:error.message});this.db.saveEntity("task-publication",id,json(record));}
      }
      throw error;
    }finally{this.pending.delete(id);}
  }
  private async commitOnce(owner:string,id:string,input:{revision?:number;reviewHash?:string;confirmation?:{accepted?:boolean;routingAccepted?:boolean}},receiptId:string,requestHash:string):Promise<PublicationReceipt>{
    let r=this.record(owner,id);
    if(input.confirmation?.accepted!==true)throw new PublicationError("CONFIRMATION_REQUIRED",400,"Review and confirm the publication");
    if(input.revision!==r.preview.revision||input.reviewHash!==r.preview.confirmation.reviewHash)throw new PublicationError("STALE_REVIEW",409,"Review revision changed");
    if(r.receipt){this.db.createEntityIfAbsent("operation-receipt",receiptId,json({requestHash,publicationId:id}));return r.receipt;}
    this.assertCurrentDraft(r);
    if(r.taskBinding)this.assertTaskBinding(r.taskBinding);
    if(r.selection?.routingDecision?.confirmation.required&&input.confirmation?.routingAccepted!==true)throw new PublicationError("ROUTING_CONFIRMATION_REQUIRED",400,"Review and approve the automatic model routing separately");
    if(this.now().getTime()>=Date.parse(r.preview.expiresAt))throw new PublicationError("PREVIEW_EXPIRED",409,"Preview expired; review again");
    if(!r.preview.canCommit)throw new PublicationError("PRECHECK_BLOCKED",409,"Resolve blocked preflight checks");
    if(this.config.current().revision!==r.configRevision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed; review again");
    if(r.repository){const current=await this.workspaces.inspect({repositoryId:r.repository.id,baseRef:(r.taskBinding?r.contract?.workspace?.baseCommit:undefined)??r.contract?.workspace?.baseRef??r.draft.baseRef??r.repository.defaultBaseRef,scopePaths:r.draft.scopePaths??r.repository.scopePaths,...(r.draft.targetBranch?{targetBranch:r.draft.targetBranch}:{})});if(current.baseCommit!==r.baseCommit)throw new PublicationError("SELECTION_CHANGED",409,"Repository baseline changed; review again");}
    if(r.selection&&r.repository) {
      const selection=await this.runtime.prepare(r.draft,r.repository,undefined,{owner,reviewed:r.selection});
      if(contentHash({...selection,selectedAt:undefined})!==contentHash({...r.selection,selectedAt:undefined}))throw new PublicationError("SELECTION_CHANGED",409,"Execution selection changed; review again");
    }
    const receipt=this.db.transaction(()=>{
      r=this.record(owner,id);if(r.receipt)return r.receipt;
      this.assertCurrentDraft(r);
      if(r.taskBinding)this.assertTaskBinding(r.taskBinding);
      if(this.now().getTime()>=Date.parse(r.preview.expiresAt))throw new PublicationError("PREVIEW_EXPIRED",409,"Preview expired during preflight");
      if(this.config.current().revision!==r.configRevision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed during preflight");
      if(r.selection?.routingDecision){
        const decision=r.selection.routingDecision;
        const use=this.db.getEntity<JsonValue>("model-routing-use",decision.id) as {publicationId:string}|undefined;
        if(use&&use.publicationId!==id)throw new PublicationError("ROUTING_DECISION_CONSUMED",409,"Routing decision was already used by another publication");
        this.db.saveEntity("model-routing-use",decision.id,json({publicationId:id}));
        decision.confirmation={required:decision.confirmation.required,mode:decision.confirmation.required?"user-confirmed":"policy-exempt",actorId:owner,confirmedAt:this.now().toISOString()};
      }
      if(!this.db.createEntityIfAbsent("operation-receipt",receiptId,json({requestHash,publicationId:id})))throw new PublicationError("IDEMPOTENCY_CONFLICT",409,"Commit already reserved");
      const taskId=r.taskBinding?.taskId??randomUUID();
      if(!r.taskBinding){const now=this.now().toISOString();const task:Task={id:taskId,projectId:r.draft.projectId,title:r.preview.effectiveTask.title,description:r.draft.description,state:r.preview.effectiveTask.contractState,createdAt:now,updatedAt:now};
        if(!this.db.getEntity("project",task.projectId))this.db.saveEntity("project",task.projectId,json({id:task.projectId,name:r.repository?.id??"本地收件箱",...(r.repository?{repository:r.repository.id}:{}),revision:1,updatedAt:now}));
        this.tasks.execute({id:`publication:${id}`,taskId,baseRevision:0,actor:owner,command:{type:"task.create",task}});
        if(r.contract)this.db.saveTaskContract(taskId,json(r.contract));
      }
      this.db.saveEntity("task-execution-intent",taskId,json({publicationId:id,execution:r.draft.execution}));
      r.receipt={publicationId:id,revision:r.preview.revision,state:"TASK_CREATED",taskId};this.db.saveEntity("task-publication",id,json(r));return r.receipt;
    });
    if(r.draft.startMode!=="dispatch")return receipt;
    try {
      const run=await this.runtime.dispatch(r,receipt.taskId);
      const latest=this.record(owner,id);latest.receipt={...receipt,runId:run.id,state:startupState(run),...(run.failureReason?{message:run.failureReason}:{})};this.db.saveEntity("task-publication",id,json(latest));return latest.receipt;
    } catch(error) {
      const latest=this.record(owner,id);latest.receipt={...latest.receipt!,state:latest.receipt?.runId?"OUTCOME_UNKNOWN":"START_FAILED",message:error instanceof PublicationError?error.message:"Startup could not be confirmed; inspect the retained task before any further action"};this.db.saveEntity("task-publication",id,json(latest));return latest.receipt;
    }
  }
}
