import {createHash} from "node:crypto";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import type {WorkspaceHandle,WorkspaceManager} from "@dispatcher/workspace";
import type {ProcessManager} from "./process.js";
import type {GitDeliveryTarget,GitPushResult,LocalCommitResult} from "@dispatcher/domain";
export type {LocalCommitResult} from "@dispatcher/domain";
export interface LocalCommitInput {runId:string;generation:number;leaseId:string;workspace:WorkspaceHandle;message:string;assertAuthority:()=>void;signal?:AbortSignal}
export interface LocalPushInput extends LocalCommitInput {target:GitDeliveryTarget}
export class LocalGitDeliveryError extends Error{constructor(readonly code:string,message:string){super(message);}}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function commitBinding(input:LocalCommitInput):string{const workspace=input.workspace;return hash({runId:input.runId,generation:input.generation,leaseId:input.leaseId,workspace:{repositoryId:workspace.repositoryId,repositoryRoot:workspace.repositoryRoot,path:workspace.path,branch:workspace.branch,baseRevision:workspace.baseRevision,runId:workspace.runId,taskId:workspace.taskId,attempt:workspace.attempt,scopePaths:workspace.scopePaths,baseRef:workspace.baseRef,baseCommit:workspace.baseCommit,targetBranch:workspace.targetBranch},message:input.message});}
interface Receipt {version:1;binding:string;state:"PENDING"|"COMPLETE";result?:LocalCommitResult}
/** Owned Git commands in a verified worktree; pushing requires its own explicit frozen target. */
export class LocalGitDelivery {
  private readonly pending=new Map<string,{binding:string;work:Promise<LocalCommitResult>}>();
  private readonly known=new Map<string,LocalCommitResult>();
  private readonly pushPending=new Map<string,{binding:string;work:Promise<GitPushResult>}>();
  private readonly pushKnown=new Map<string,GitPushResult>();
  constructor(private readonly database:DispatcherDatabase,private readonly processes:ProcessManager,private readonly workspaces:WorkspaceManager){}
  async commit(input:LocalCommitInput):Promise<LocalCommitResult>{
    this.fence(input);
    if(!input.runId||!Number.isSafeInteger(input.generation)||input.generation<1||input.workspace.runId!==input.runId||!input.message.trim()||input.message.length>1000||input.message.includes(String.fromCharCode(0)))throw new LocalGitDeliveryError("COMMIT_INPUT_INVALID","Commit requires a bound run and bounded message");
    const id=hash({runId:input.runId,generation:input.generation}),binding=commitBinding(input);
    const receipt=this.database.getEntity<JsonValue>("local-git-delivery",id) as unknown as Receipt|undefined;
    if(receipt&&receipt.binding!==binding)throw new LocalGitDeliveryError("COMMIT_IDENTITY_CONFLICT","Commit identity is already bound to another workspace or request");
    if(receipt?.state==="COMPLETE"&&receipt.result){this.fence(input);return structuredClone(receipt.result);}
    const known=this.known.get(id);
    if(known){this.fence(input);this.save(id,{version:1,binding,state:"COMPLETE",result:known});return structuredClone(known);}
    const pending=this.pending.get(id);
    if(pending){if(pending.binding!==binding)throw new LocalGitDeliveryError("COMMIT_IDENTITY_CONFLICT","Another commit is pending for this identity");return pending.work;}
    if(receipt)throw new LocalGitDeliveryError("COMMIT_OUTCOME_UNKNOWN","Prior commit outcome is unknown; inspect its managed worktree before any retry");
    const work=Promise.resolve().then(()=>this.commitOnce(id,binding,input)).finally(()=>{this.pending.delete(id);});
    this.pending.set(id,{binding,work});return work;
  }
  async push(input:LocalPushInput):Promise<GitPushResult>{
    this.fence(input);
    const id=hash({runId:input.runId,generation:input.generation}),target=input.target;
    const binding=hash({commitBinding:commitBinding(input),target:{version:target.version,host:target.host,repository:target.repository,remoteFingerprint:target.remoteFingerprint}});
    type PushReceipt={version:1;binding:string;state:"PENDING"|"COMPLETE";result?:GitPushResult};
    const save=(receipt:PushReceipt)=>this.database.saveEntity("git-push-delivery",id,JSON.parse(JSON.stringify(receipt)) as JsonValue);
    const receipt=this.database.getEntity<JsonValue>("git-push-delivery",id) as unknown as PushReceipt|undefined;
    if(receipt&&receipt.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Push identity is bound to another target or request");
    if(receipt?.state==="COMPLETE"&&receipt.result)return structuredClone(receipt.result);
    const known=this.pushKnown.get(id);if(known){save({version:1,binding,state:"COMPLETE",result:known});return structuredClone(known);}
    const pending=this.pushPending.get(id);if(pending){if(pending.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Another target is pending");return pending.work;}
    if(receipt)throw new LocalGitDeliveryError("PUSH_OUTCOME_UNKNOWN","Prior push outcome is unknown; inspect its remote before any retry");
    const work=Promise.resolve().then(async()=>{
      await this.workspaces.resolvePushTarget(input.workspace,target);this.fence(input);
      const committed=await this.commit(input);this.fence(input);
      const url=await this.workspaces.resolvePushTarget(input.workspace,target);this.fence(input);
      if(await this.git(input,["rev-parse","HEAD"])!==committed.commit||await this.git(input,["symbolic-ref","--short","HEAD"])!==committed.branch||await this.git(input,["status","--porcelain"]))throw new LocalGitDeliveryError("PUSH_WORKSPACE_CHANGED","Push requires the frozen clean managed commit");
      await this.workspaces.resultFiles(input.workspace);this.fence(input);save({version:1,binding,state:"PENDING"});this.fence(input);
      await this.git(input,["push","--porcelain","--no-force","--no-follow-tags","--recurse-submodules=no",url,`${committed.commit}:refs/heads/${committed.branch}`],120_000);
      const result:GitPushResult={version:1,runId:input.runId,generation:input.generation,commit:committed.commit,branch:committed.branch,target:structuredClone(target),pushedAt:new Date().toISOString()};
      this.pushKnown.set(id,result);this.fence(input);save({version:1,binding,state:"COMPLETE",result});this.pushKnown.delete(id);return result;
    }).finally(()=>this.pushPending.delete(id));this.pushPending.set(id,{binding,work});return work;
  }
  private fence(input:LocalCommitInput):void{
    if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");input.assertAuthority();
  }
  private save(id:string,receipt:Receipt):void{this.database.saveEntity("local-git-delivery",id,JSON.parse(JSON.stringify(receipt)) as JsonValue);}
  private async git(input:LocalCommitInput,args:string[],timeoutMs=30_000):Promise<string>{
    this.fence(input);
    const process=await this.processes.start({runId:input.runId,file:"git",args:["--literal-pathspecs",...args],cwd:input.workspace.path,timeoutMs});
    let stop:Promise<void>|undefined;
    const abort=()=>{stop??=process.cancel();void stop.catch(()=>undefined);};input.signal?.addEventListener("abort",abort,{once:true});
    try{
      if(input.signal?.aborted)abort();
      const result=await process.result();if(stop)await stop;this.fence(input);
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
      await this.git(input,["add","--all","--","."]);
      await this.workspaces.resultFiles(input.workspace);this.fence(input);
      await this.git(input,["commit","--quiet","-m",`${input.message}\n\nDispatcher-Run: ${input.runId}\nDispatcher-Generation: ${input.generation}`]);
    }
    const commit=await this.git(input,["rev-parse","--verify","HEAD"]),files=await this.workspaces.resultFiles(input.workspace);this.fence(input);
    if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)||await this.git(input,["symbolic-ref","--short","HEAD"])!==input.workspace.branch||await this.git(input,["status","--porcelain"]))throw new LocalGitDeliveryError("COMMIT_OUTCOME_UNKNOWN","Git completion did not establish a clean managed branch");
    const result:LocalCommitResult={version:1,runId:input.runId,generation:input.generation,commit,branch:input.workspace.branch,files,created:commit!==before,completedAt:new Date().toISOString()};
    // Physical completion is known in this process even if the durable receipt write fails.
    this.known.set(id,result);this.fence(input);this.save(id,{version:1,binding,state:"COMPLETE",result});this.known.delete(id);return structuredClone(result);
  }
}
