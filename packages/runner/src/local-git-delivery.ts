import {createHash} from "node:crypto";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import type {WorkspaceHandle,WorkspaceManager} from "@dispatcher/workspace";
import type {ManagedProcessHandle,ProcessManager,ProcessResult} from "./process.js";
import type {GitDeliveryTarget,GitPushResult,LocalCommitResult} from "@dispatcher/domain";
export type {LocalCommitResult} from "@dispatcher/domain";
export interface LocalCommitInput {runId:string;generation:number;leaseId:string;workspace:WorkspaceHandle;message:string;assertAuthority:()=>void;signal?:AbortSignal}
export interface LocalPushInput extends LocalCommitInput {target:GitDeliveryTarget}
export class LocalGitDeliveryError extends Error{constructor(readonly code:string,message:string){super(message);}}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function commitBinding(input:LocalCommitInput):string{const workspace=input.workspace;return hash({runId:input.runId,generation:input.generation,leaseId:input.leaseId,workspace:{repositoryId:workspace.repositoryId,repositoryRoot:workspace.repositoryRoot,path:workspace.path,branch:workspace.branch,baseRevision:workspace.baseRevision,runId:workspace.runId,taskId:workspace.taskId,attempt:workspace.attempt,scopePaths:workspace.scopePaths,baseRef:workspace.baseRef,baseCommit:workspace.baseCommit,targetBranch:workspace.targetBranch},message:input.message});}
interface Receipt {version:1;binding:string;state:"PENDING"|"COMPLETE";result?:LocalCommitResult}
type CommandPhase="stage"|"commit"|"push";
interface CommandOwner {ownerKind:"local-git-delivery"|"git-push-delivery";ownerId:string;binding:string;phase:CommandPhase;outgoing?:{commit:string;branch:string;target:GitDeliveryTarget}}
interface CommandFact extends CommandOwner {version:1;id:string;runId:string;generation:number;leaseId:string;cwd:string;commandHash:string;state:"SENDING"|"SETTLED";handle?:{id:string;pid:number};result?:Pick<ProcessResult,"sessionId"|"exitCode"|"signal"|"classification"|"durationMs">;observedAt?:string}
const commandId=(ownerKind:CommandOwner["ownerKind"],ownerId:string,phase:CommandPhase)=>hash(["local-git-command",ownerKind,ownerId,phase]);
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const record=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).sort().join(",")===expected.sort().join(",");
function validResult(handle:unknown,result:unknown):boolean{
  return record(handle)&&keys(handle,["id","pid"])&&typeof handle.id==="string"&&handle.id.length>0&&Number.isSafeInteger(handle.pid)&&Number(handle.pid)>0&&record(result)&&keys(result,["sessionId","exitCode","signal","classification","durationMs"])&&result.sessionId===handle.id&&(result.exitCode===null||Number.isSafeInteger(result.exitCode))&&(result.signal===null||typeof result.signal==="string"&&/^SIG[A-Z0-9]+$/.test(result.signal))&&typeof result.classification==="string"&&["success","cancelled","timeout","idle-timeout","nonzero","signal","spawn-error"].includes(String(result.classification))&&typeof result.durationMs==="number"&&Number.isFinite(result.durationMs)&&result.durationMs>=0;
}
/** Owned Git commands in a verified worktree; pushing requires its own explicit frozen target. */
export class LocalGitDelivery {
  private readonly pending=new Map<string,{binding:string;work:Promise<LocalCommitResult>}>();
  private readonly known=new Map<string,{result:LocalCommitResult;phases:CommandPhase[]}>();
  private readonly pushPending=new Map<string,{binding:string;work:Promise<GitPushResult>}>();
  private readonly pushKnown=new Map<string,GitPushResult>();
  constructor(private readonly database:DispatcherDatabase,private readonly processes:ProcessManager,private readonly workspaces:WorkspaceManager){}
  async commit(input:LocalCommitInput):Promise<LocalCommitResult>{
    this.fence(input);
    if(!input.runId||!Number.isSafeInteger(input.generation)||input.generation<1||input.workspace.runId!==input.runId||!input.message.trim()||input.message.length>1000||input.message.includes(String.fromCharCode(0)))throw new LocalGitDeliveryError("COMMIT_INPUT_INVALID","Commit requires a bound run and bounded message");
    const id=hash({runId:input.runId,generation:input.generation}),binding=commitBinding(input);
    const receipt=this.database.getEntity<JsonValue>("local-git-delivery",id) as unknown as Receipt|undefined;
    if(receipt&&receipt.binding!==binding)throw new LocalGitDeliveryError("COMMIT_IDENTITY_CONFLICT","Commit identity is already bound to another workspace or request");
    this.checkCommands(input,"local-git-delivery",id,binding,receipt,this.pending.get(id)?.binding===binding);
    if(receipt?.state==="COMPLETE"&&receipt.result){this.fence(input);return structuredClone(receipt.result);}
    const known=this.known.get(id);
    if(known){this.requireKnownCommands("local-git-delivery",id,known.phases);this.parent("local-git-delivery",id,binding);this.fence(input);this.save(id,{version:1,binding,state:"COMPLETE",result:known.result});return structuredClone(known.result);}
    const pending=this.pending.get(id);
    if(pending){if(pending.binding!==binding)throw new LocalGitDeliveryError("COMMIT_IDENTITY_CONFLICT","Another commit is pending for this identity");return pending.work;}
    if(receipt)throw new LocalGitDeliveryError("COMMIT_OUTCOME_UNKNOWN","Prior commit outcome is unknown; inspect its managed worktree before any retry");
    const work=Promise.resolve().then(()=>this.commitOnce(id,binding,input)).finally(()=>{this.pending.delete(id);});
    this.pending.set(id,{binding,work});return work;
  }
  async push(input:LocalPushInput):Promise<GitPushResult>{
    this.fence(input);
    const id=hash({runId:input.runId,generation:input.generation}),target=structuredClone(input.target);
    const binding=hash({commitBinding:commitBinding(input),target:{version:target.version,host:target.host,repository:target.repository,remoteFingerprint:target.remoteFingerprint}});
    type PushReceipt={version:1;binding:string;state:"PENDING"|"COMPLETE";result?:GitPushResult};
    const save=(receipt:PushReceipt)=>this.database.transaction(()=>{if(receipt.state==="COMPLETE")this.parent("git-push-delivery",id,binding);this.database.saveEntity("git-push-delivery",id,json(receipt));});
    const receipt=this.database.getEntity<JsonValue>("git-push-delivery",id) as unknown as PushReceipt|undefined;
    if(receipt&&receipt.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Push identity is bound to another target or request");
    this.checkCommands(input,"git-push-delivery",id,binding,receipt,this.pushPending.get(id)?.binding===binding,target);
    if(receipt?.state==="COMPLETE"&&receipt.result)return structuredClone(receipt.result);
    const known=this.pushKnown.get(id);if(known){this.requireKnownCommands("git-push-delivery",id,["push"]);this.parent("git-push-delivery",id,binding);save({version:1,binding,state:"COMPLETE",result:known});return structuredClone(known);}
    const pending=this.pushPending.get(id);if(pending){if(pending.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Another target is pending");return pending.work;}
    if(receipt)throw new LocalGitDeliveryError("PUSH_OUTCOME_UNKNOWN","Prior push outcome is unknown; inspect its remote before any retry");
    const work=Promise.resolve().then(async()=>{
      await this.workspaces.resolvePushTarget(input.workspace,target);this.fence(input);
      const committed=await this.commit(input);this.fence(input);
      const url=await this.workspaces.resolvePushTarget(input.workspace,target);this.fence(input);
      if(await this.git(input,["rev-parse","HEAD"])!==committed.commit||await this.git(input,["symbolic-ref","--short","HEAD"])!==committed.branch||await this.git(input,["status","--porcelain"]))throw new LocalGitDeliveryError("PUSH_WORKSPACE_CHANGED","Push requires the frozen clean managed commit");
      await this.workspaces.resultFiles(input.workspace);this.fence(input);save({version:1,binding,state:"PENDING"});this.fence(input);
      await this.git(input,["push","--porcelain","--no-force","--no-follow-tags","--recurse-submodules=no",url,`${committed.commit}:refs/heads/${committed.branch}`],120_000,{ownerKind:"git-push-delivery",ownerId:id,binding,phase:"push",outgoing:{commit:committed.commit,branch:committed.branch,target}});
      const result:GitPushResult={version:1,runId:input.runId,generation:input.generation,commit:committed.commit,branch:committed.branch,target:structuredClone(target),pushedAt:new Date().toISOString()};
      this.pushKnown.set(id,result);this.fence(input);save({version:1,binding,state:"COMPLETE",result});this.pushKnown.delete(id);return result;
    }).finally(()=>this.pushPending.delete(id));this.pushPending.set(id,{binding,work});return work;
  }
  private fence(input:LocalCommitInput):void{
    if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");input.assertAuthority();
  }
  private save(id:string,receipt:Receipt):void{this.database.transaction(()=>{if(receipt.state==="COMPLETE")this.parent("local-git-delivery",id,receipt.binding);this.database.saveEntity("local-git-delivery",id,json(receipt));});}
  private parent(ownerKind:CommandOwner["ownerKind"],id:string,binding:string):void{
    const receipt=this.database.getEntity(ownerKind,id);
    if(!record(receipt)||!keys(receipt,["version","binding","state"])||receipt.version!==1||receipt.binding!==binding||receipt.state!=="PENDING")throw this.unknown(ownerKind);
  }
  private unknown(ownerKind:CommandOwner["ownerKind"]):LocalGitDeliveryError{return new LocalGitDeliveryError(ownerKind==="local-git-delivery"?"COMMIT_OUTCOME_UNKNOWN":"PUSH_OUTCOME_UNKNOWN","Owned Git command outcome is unknown; inspect its retained physical artifacts before any retry");}
  private command(id:string,ownerKind:CommandOwner["ownerKind"]):unknown{
    const row=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get("local-git-command",id) as {document_json:string}|undefined;
    if(!row)return undefined;
    // Only malformed journal JSON is normalized; storage/reader failures retain their original error.
    try{return JSON.parse(row.document_json) as unknown;}catch(error){if(error instanceof SyntaxError)throw this.unknown(ownerKind);throw error;}
  }
  private checkCommands(input:LocalCommitInput,ownerKind:CommandOwner["ownerKind"],ownerId:string,binding:string,parent:unknown,ownedPending:boolean,target?:GitDeliveryTarget):void{
    const phases:CommandPhase[]=ownerKind==="local-git-delivery"?["stage","commit"]:["push"];
    const ids=new Set(phases.map(phase=>commandId(ownerKind,ownerId,phase)));
    // A moved SQL key must not hide a fact whose descriptor still names this exact owner.
    const ownedRows=this.database.handle.prepare("SELECT id FROM entities WHERE kind=? AND CASE WHEN json_valid(document_json) THEN json_extract(document_json,'$.ownerKind')=? AND json_extract(document_json,'$.ownerId')=? ELSE 0 END").all("local-git-command",ownerKind,ownerId) as Array<{id:string}>;
    if(ownedRows.some(row=>!ids.has(row.id)))throw this.unknown(ownerKind);
    for(const phase of phases){
      const id=commandId(ownerKind,ownerId,phase),fact=this.command(id,ownerKind);if(fact===undefined)continue;
      const baseKeys=["version","id","ownerKind","ownerId","phase","runId","generation","leaseId","binding","cwd","commandHash","state",...(phase==="push"?["outgoing"]:[])];
      if(!record(parent)||parent.version!==1||parent.binding!==binding||!["PENDING","COMPLETE"].includes(String(parent.state)))throw this.unknown(ownerKind);
      if(!record(fact)||fact.version!==1||fact.id!==id||fact.ownerKind!==ownerKind||fact.ownerId!==ownerId||fact.phase!==phase||fact.runId!==input.runId||fact.generation!==input.generation||fact.leaseId!==input.leaseId||fact.binding!==binding||fact.cwd!==input.workspace.path||typeof fact.commandHash!=="string"||! /^[a-f0-9]{64}$/.test(fact.commandHash))throw this.unknown(ownerKind);
      if(phase==="push"){
        const outgoing=fact.outgoing;if(!record(outgoing)||!keys(outgoing,["commit","branch","target"])||typeof outgoing.commit!=="string"||! /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(outgoing.commit)||outgoing.branch!==input.workspace.branch||!record(outgoing.target)||!keys(outgoing.target,["version","host","repository","remoteFingerprint"])||outgoing.target.version!==target?.version||outgoing.target.host!==target?.host||outgoing.target.repository!==target?.repository||outgoing.target.remoteFingerprint!==target?.remoteFingerprint)throw this.unknown(ownerKind);
      }else{
        const args=phase==="stage"?["add","--all","--","."]:["commit","--quiet","-m",`${input.message}\n\nDispatcher-Run: ${input.runId}\nDispatcher-Generation: ${input.generation}`];
        if(fact.commandHash!==hash({file:"git",args:["--literal-pathspecs",...args],cwd:input.workspace.path}))throw this.unknown(ownerKind);
      }
      if(fact.state==="SENDING"){if(!ownedPending||parent.state!=="PENDING"||!keys(fact,baseKeys))throw this.unknown(ownerKind);}
      else if(fact.state!=="SETTLED"||!keys(fact,[...baseKeys,"handle","result","observedAt"])||!validResult(fact.handle,fact.result)||typeof fact.observedAt!=="string"||!Number.isFinite(Date.parse(fact.observedAt)))throw this.unknown(ownerKind);
    }
  }
  private requireKnownCommands(ownerKind:CommandOwner["ownerKind"],ownerId:string,phases:CommandPhase[]):void{
    // Memory repair needs its original observed command facts; facts alone never repair a legacy receipt.
    for(const phase of phases){const fact=this.command(commandId(ownerKind,ownerId,phase),ownerKind);if(!record(fact)||fact.state!=="SETTLED"||!record(fact.result)||fact.result.classification!=="success"||fact.result.exitCode!==0)throw this.unknown(ownerKind);}
  }
  private sending(fact:CommandFact):void{
    this.database.transaction(()=>{
      this.parent(fact.ownerKind,fact.ownerId,fact.binding);
      if(!this.database.createEntityIfAbsent("local-git-command",fact.id,json(fact))||JSON.stringify(this.command(fact.id,fact.ownerKind))!==JSON.stringify(fact))throw this.unknown(fact.ownerKind);
      this.parent(fact.ownerKind,fact.ownerId,fact.binding);
    });
  }
  private settle(fact:CommandFact,handle:Pick<ManagedProcessHandle,"id"|"pid">,result:ProcessResult):void{
    if(!record(result))throw this.unknown(fact.ownerKind);
    const identity={id:handle.id,pid:handle.pid},scalars={sessionId:result.sessionId,exitCode:result.exitCode,signal:result.signal,classification:result.classification,durationMs:result.durationMs};
    if(!validResult(identity,scalars))throw this.unknown(fact.ownerKind);
    const settled:CommandFact={...fact,state:"SETTLED",handle:identity,result:scalars,observedAt:new Date().toISOString()};
    this.database.transaction(()=>{
      if(JSON.stringify(this.command(fact.id,fact.ownerKind))!==JSON.stringify(fact))throw this.unknown(fact.ownerKind);
      this.database.saveEntity("local-git-command",fact.id,json(settled));
      if(JSON.stringify(this.command(fact.id,fact.ownerKind))!==JSON.stringify(settled))throw this.unknown(fact.ownerKind);
    });
  }
  private async git(input:LocalCommitInput,args:string[],timeoutMs=30_000,owner?:CommandOwner):Promise<string>{
    const commandArgs=["--literal-pathspecs",...args],cwd=input.workspace.path,runId=input.runId;
    const fact:CommandFact|undefined=owner?{...structuredClone(owner),version:1,id:commandId(owner.ownerKind,owner.ownerId,owner.phase),runId,generation:input.generation,leaseId:input.leaseId,cwd,commandHash:hash({file:"git",args:commandArgs,cwd}),state:"SENDING"}:undefined;
    this.fence(input);if(fact){
      this.sending(fact);this.fence(input);this.parent(fact.ownerKind,fact.ownerId,fact.binding);
      // The authority callback can change either receipt synchronously; requalify without an async gap.
      if(JSON.stringify(this.command(fact.id,fact.ownerKind))!==JSON.stringify(fact))throw this.unknown(fact.ownerKind);
    }
    const process=await this.processes.start({runId,file:"git",args:commandArgs,cwd,timeoutMs}),identity={id:process.id,pid:process.pid};
    let stop:Promise<void>|undefined;
    const abort=()=>{stop??=process.cancel();void stop.catch(()=>undefined);};input.signal?.addEventListener("abort",abort,{once:true});
    try{
      if(input.signal?.aborted)abort();
      const result=await process.result();
      try{if(fact)this.settle(fact,identity,result);}finally{if(stop)await stop;}
      if(fact)this.parent(fact.ownerKind,fact.ownerId,fact.binding);this.fence(input);
      if(result.classification!=="success"||result.exitCode!==0)throw new LocalGitDeliveryError("LOCAL_GIT_FAILED","Owned Git command failed; inspect the worktree and configured Git identity/hooks");
      return result.stdoutTail.trim();
    }finally{input.signal?.removeEventListener("abort",abort);}
  }
  private async commitOnce(id:string,binding:string,input:LocalCommitInput):Promise<LocalCommitResult>{
    await this.workspaces.restore(input.workspace);this.fence(input);
    const before=await this.git(input,["rev-parse","--verify","HEAD"]),branch=await this.git(input,["symbolic-ref","--short","HEAD"]);
    if(branch!==input.workspace.branch||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(before))throw new LocalGitDeliveryError("COMMIT_WORKSPACE_CHANGED","Managed branch identity changed");
    await this.workspaces.resultFiles(input.workspace);this.fence(input);
    const dirty=Boolean(await this.git(input,["status","--porcelain"]));
    this.save(id,{version:1,binding,state:"PENDING"});this.fence(input);
    if(dirty){
      await this.git(input,["add","--all","--","."],30_000,{ownerKind:"local-git-delivery",ownerId:id,binding,phase:"stage"});
      await this.workspaces.resultFiles(input.workspace);this.fence(input);
      await this.git(input,["commit","--quiet","-m",`${input.message}\n\nDispatcher-Run: ${input.runId}\nDispatcher-Generation: ${input.generation}`],30_000,{ownerKind:"local-git-delivery",ownerId:id,binding,phase:"commit"});
    }
    const commit=await this.git(input,["rev-parse","--verify","HEAD"]),files=await this.workspaces.resultFiles(input.workspace);this.fence(input);
    if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)||await this.git(input,["symbolic-ref","--short","HEAD"])!==input.workspace.branch||await this.git(input,["status","--porcelain"]))throw new LocalGitDeliveryError("COMMIT_OUTCOME_UNKNOWN","Git completion did not establish a clean managed branch");
    const result:LocalCommitResult={version:1,runId:input.runId,generation:input.generation,commit,branch:input.workspace.branch,files,created:commit!==before,completedAt:new Date().toISOString()};
    // Repair follows the commands actually sent, even if a hook moved HEAD back to its original SHA.
    this.known.set(id,{result,phases:dirty?["stage","commit"]:[]});this.fence(input);this.save(id,{version:1,binding,state:"COMPLETE",result});this.known.delete(id);return structuredClone(result);
  }
}
