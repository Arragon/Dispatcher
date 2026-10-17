import {createHash} from "node:crypto";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import type {WorkspaceHandle,WorkspaceManager} from "@dispatcher/workspace";
import type {ProcessManager} from "./process.js";
import type {LocalCommitResult} from "@dispatcher/domain";
export type {LocalCommitResult} from "@dispatcher/domain";
export interface LocalCommitInput {runId:string;generation:number;leaseId:string;workspace:WorkspaceHandle;message:string;assertAuthority:()=>void;signal?:AbortSignal}
export class LocalGitDeliveryError extends Error{constructor(readonly code:string,message:string){super(message);}}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface Receipt {version:1;binding:string;state:"PENDING"|"COMPLETE";result?:LocalCommitResult}
/** Owned Git commands in a verified worktree; this service has no push or provider API. */
export class LocalGitDelivery {
  private readonly pending=new Map<string,{binding:string;work:Promise<LocalCommitResult>}>();
  private readonly known=new Map<string,LocalCommitResult>();
  constructor(private readonly database:DispatcherDatabase,private readonly processes:ProcessManager,private readonly workspaces:WorkspaceManager){}
  async commit(input:LocalCommitInput):Promise<LocalCommitResult>{
    this.fence(input);
    if(!input.runId||!Number.isSafeInteger(input.generation)||input.generation<1||input.workspace.runId!==input.runId||!input.message.trim()||input.message.length>1000||input.message.includes(String.fromCharCode(0)))throw new LocalGitDeliveryError("COMMIT_INPUT_INVALID","Commit requires a bound run and bounded message");
    const workspace=input.workspace;
    const id=hash({runId:input.runId,generation:input.generation}),binding=hash({runId:input.runId,generation:input.generation,leaseId:input.leaseId,workspace:{repositoryId:workspace.repositoryId,repositoryRoot:workspace.repositoryRoot,path:workspace.path,branch:workspace.branch,baseRevision:workspace.baseRevision,runId:workspace.runId,taskId:workspace.taskId,attempt:workspace.attempt,scopePaths:workspace.scopePaths,baseRef:workspace.baseRef,baseCommit:workspace.baseCommit,targetBranch:workspace.targetBranch},message:input.message});
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
  private fence(input:LocalCommitInput):void{
    if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");input.assertAuthority();
  }
  private save(id:string,receipt:Receipt):void{this.database.saveEntity("local-git-delivery",id,JSON.parse(JSON.stringify(receipt)) as JsonValue);}
  private async git(input:LocalCommitInput,args:string[]):Promise<string>{
    this.fence(input);
    const process=await this.processes.start({runId:input.runId,file:"git",args:["--literal-pathspecs",...args],cwd:input.workspace.path,timeoutMs:30_000});
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
