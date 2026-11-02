import {isAbsolute} from "node:path";
import {createHash} from "node:crypto";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import {WorkspacePolicyError,isDeliveryGitContext,sameGitWorktreeContext,type DeliveryCandidate,type SnapshotCommitObservation,type WorkspaceHandle,type WorkspaceManager} from "@dispatcher/workspace";
import type {ManagedProcessHandle,ProcessManager,ProcessResult} from "./process.js";
import {isGitDeliveryTarget,type GitDeliveryTarget,type GitPushResult,type LocalCommitResult,type RunGitDelivery} from "@dispatcher/domain";
export type {LocalCommitResult} from "@dispatcher/domain";
export interface LocalCommitInput {runId:string;generation:number;leaseId:string;workspace:WorkspaceHandle;message:string;verifiedTree?:string;assertAuthority:()=>void;signal?:AbortSignal}
export interface LocalSnapshotCommitInput extends LocalCommitInput {proof:{id:string;hash:string};candidate:DeliveryCandidate;assertSource:()=>Promise<void>;assertSnapshot:()=>Promise<void>}
export interface LocalSnapshotPushInput extends LocalSnapshotCommitInput {target:GitDeliveryTarget}
export interface LocalPushInput extends LocalCommitInput {target:GitDeliveryTarget}
export class LocalGitDeliveryError extends Error{constructor(readonly code:string,message:string){super(message);}}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function commitBinding(input:LocalCommitInput):string{const workspace=input.workspace;return hash({runId:input.runId,generation:input.generation,leaseId:input.leaseId,workspace:{repositoryId:workspace.repositoryId,repositoryRoot:workspace.repositoryRoot,path:workspace.path,branch:workspace.branch,baseRevision:workspace.baseRevision,runId:workspace.runId,taskId:workspace.taskId,attempt:workspace.attempt,scopePaths:workspace.scopePaths,baseRef:workspace.baseRef,baseCommit:workspace.baseCommit,targetBranch:workspace.targetBranch},message:input.message,...(input.verifiedTree?{verifiedTree:input.verifiedTree}:{})});}
interface Receipt {version:1;binding:string;state:"PENDING"|"COMPLETE";result?:LocalCommitResult}
interface PushReceipt {version:1;binding:string;state:"PENDING"|"COMPLETE";result?:GitPushResult}
const pushBinding=(commitIdentity:string,target:GitDeliveryTarget)=>hash({commitBinding:commitIdentity,target:{version:target.version,host:target.host,repository:target.repository,remoteFingerprint:target.remoteFingerprint}});
type CommandPhase="stage"|"commit"|"push";
interface CommandOwner {ownerKind:"local-git-delivery"|"git-push-delivery"|"native-snapshot-commit";ownerId:string;binding:string;phase:CommandPhase;outgoing?:{commit:string;branch:string;target:GitDeliveryTarget}}
interface CommandFact extends CommandOwner {version:1;id:string;runId:string;generation:number;leaseId:string;cwd:string;commandHash:string;state:"SENDING"|"SETTLED";handle?:{id:string;pid:number};result?:Pick<ProcessResult,"sessionId"|"exitCode"|"signal"|"classification"|"durationMs">;observedAt?:string}
const commandId=(ownerKind:CommandOwner["ownerKind"],ownerId:string,phase:CommandPhase)=>hash(["local-git-command",ownerKind,ownerId,phase]);
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const record=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).sort().join(",")===expected.sort().join(",");
function validResult(handle:unknown,result:unknown):boolean{
  return record(handle)&&keys(handle,["id","pid"])&&typeof handle.id==="string"&&handle.id.length>0&&Number.isSafeInteger(handle.pid)&&Number(handle.pid)>0&&record(result)&&keys(result,["sessionId","exitCode","signal","classification","durationMs"])&&result.sessionId===handle.id&&(result.exitCode===null||Number.isSafeInteger(result.exitCode))&&(result.signal===null||typeof result.signal==="string"&&/^SIG[A-Z0-9]+$/.test(result.signal))&&typeof result.classification==="string"&&["success","cancelled","timeout","idle-timeout","nonzero","signal","spawn-error"].includes(String(result.classification))&&typeof result.durationMs==="number"&&Number.isFinite(result.durationMs)&&result.durationMs>=0;
}
const strictKind="native-snapshot-commit";
const sha=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const digest=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const bounded=(value:unknown,max=Number.MAX_SAFE_INTEGER):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!value.includes("\0");
const absolute=(value:unknown):value is string=>bounded(value)&&isAbsolute(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==="string"&&!item.includes("\0"));
const directoryIdentity=(value:unknown):boolean=>record(value)&&keys(value,["device","inode"])&&typeof value.device==="number"&&Number.isSafeInteger(value.device)&&value.device>=0&&typeof value.inode==="number"&&Number.isSafeInteger(value.inode)&&value.inode>=0;
function validSnapshotCandidate(value:Record<string,unknown>):boolean{
 const source=value.source,candidate=value.candidate;
 return keys(value,["version","id","source","candidate","commit","tree","path","rootIdentity","commonDirectory","contentFingerprint","pushRemoteFingerprint",...(Object.hasOwn(value,"pushUrl")?["pushUrl"]:[]),...(Object.hasOwn(value,"gitContext")?["gitContext"]:[])])&&value.version===1&&bounded(value.id)&&sha(value.commit)&&sha(value.tree)&&absolute(value.path)&&absolute(value.commonDirectory)&&directoryIdentity(value.rootIdentity)&&digest(value.contentFingerprint)&&digest(value.pushRemoteFingerprint)&&(!Object.hasOwn(value,"pushUrl")||bounded(value.pushUrl))&&record(source)&&keys(source,["repositoryId","worktree","branch","scopePaths","repositoryScopePaths"])&&bounded(source.repositoryId)&&absolute(source.worktree)&&bounded(source.branch)&&strings(source.scopePaths)&&strings(source.repositoryScopePaths)&&record(candidate)&&keys(candidate,["version","id","headRevision","rootIdentity","changedFiles"])&&candidate.version===1&&digest(candidate.id)&&sha(candidate.headRevision)&&directoryIdentity(candidate.rootIdentity)&&strings(candidate.changedFiles);
}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const same=(left:unknown,right:unknown)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
interface SnapshotOutcome {result:LocalCommitResult;observation:SnapshotCommitObservation}
interface SnapshotReceipt {version:1;runId:string;generation:number;leaseId:string;proof:{id:string;hash:string};candidateId:string;binding:string;state:"PENDING"|"COMPLETE";outcome?:SnapshotOutcome}
interface SnapshotAttempt {input:LocalSnapshotCommitInput;binding:string;sent:boolean;outcome?:SnapshotOutcome}
const groupId=(runId:string,generation:number)=>hash([strictKind,runId,generation]);
const snapshotId=(input:Pick<LocalSnapshotCommitInput,"runId"|"generation"|"proof">)=>`${groupId(input.runId,input.generation)}:${hash([input.proof.id,input.proof.hash])}`;
function validSnapshotReceipt(value:unknown):value is SnapshotReceipt{
 if(!record(value)||!keys(value,["version","runId","generation","leaseId","proof","candidateId","binding","state",...(value.state==="COMPLETE"?["outcome"]:[])])||value.version!==1||!bounded(value.runId)||!Number.isSafeInteger(value.generation)||Number(value.generation)<1||!bounded(value.leaseId)||!bounded(value.candidateId)||!digest(value.binding)||!record(value.proof)||!keys(value.proof,["id","hash"])||!bounded(value.proof.id,256)||!digest(value.proof.hash)||!["PENDING","COMPLETE"].includes(String(value.state)))return false;
 if(value.state==="PENDING")return true;
 const outcome=value.outcome;if(!record(outcome)||!keys(outcome,["result","observation"]))return false;
 const r=outcome.result,o=outcome.observation;
 return record(r)&&keys(r,["version","runId","generation","commit","branch","files","created","completedAt"])&&r.version===1&&r.runId===value.runId&&r.generation===value.generation&&sha(r.commit)&&bounded(r.branch,1024)&&typeof r.created==="boolean"&&typeof r.completedAt==="string"&&Number.isFinite(Date.parse(r.completedAt))&&Array.isArray(r.files)&&r.files.every(f=>typeof f==="string"&&f.length>0&&!f.includes("\0"))&&record(o)&&keys(o,["context","head","tree","parents","branch","status","files","indexMatches"])&&isDeliveryGitContext({version:1,source:o.context,snapshot:o.context})&&o.head===r.commit&&sha(o.tree)&&Array.isArray(o.parents)&&o.parents.every(sha)&&(!r.created||o.parents.length===1)&&o.branch===r.branch&&o.status===""&&o.indexMatches===true&&same(o.files,r.files);
}
/** Owned Git commands in a verified worktree; pushing requires its own explicit frozen target. */
export class LocalGitDelivery {
  private readonly snapshotPending=new Map<string,{binding:string;work:Promise<LocalCommitResult>}>();
  private readonly snapshotAttempts=new Map<string,SnapshotAttempt>();
  private readonly pending=new Map<string,{binding:string;work:Promise<LocalCommitResult>}>();
  private readonly known=new Map<string,{result:LocalCommitResult;phases:CommandPhase[]}>();
  private readonly pushPending=new Map<string,{binding:string;work:Promise<GitPushResult>}>();
  private readonly pushKnown=new Map<string,GitPushResult>();
  constructor(private readonly database:DispatcherDatabase,private readonly processes:ProcessManager,private readonly workspaces:WorkspaceManager){}
  private snapshotError(code:"INPUT_INVALID"|"CONTEXT_CHANGED"|"ENVIRONMENT_UNAVAILABLE"|"CHANGED"|"OUTCOME_UNKNOWN"):LocalGitDeliveryError{return new LocalGitDeliveryError(`SNAPSHOT_COMMIT_${code}`,"Strict snapshot commit cannot qualify the current request and retained evidence");}
  private snapshotInput(input:LocalSnapshotCommitInput):{input:LocalSnapshotCommitInput;id:string;binding:string}{
    if(!record(input)||!bounded(input.runId)||!Number.isSafeInteger(input.generation)||input.generation<1||!bounded(input.leaseId)||!bounded(input.message,1000)||!input.message.trim()||typeof input.assertAuthority!=="function"||typeof input.assertSource!=="function"||typeof input.assertSnapshot!=="function"||!record(input.workspace)||input.workspace.runId!==input.runId||!record(input.proof)||!keys(input.proof,["id","hash"])||!bounded(input.proof.id,256)||!digest(input.proof.hash)||!record(input.candidate))throw this.snapshotError("INPUT_INVALID");
    const candidate=input.candidate;
    if(!validSnapshotCandidate(candidate)||!absolute(input.workspace.path)||!bounded(input.workspace.branch)||!strings(input.workspace.scopePaths)||candidate.version!==1||!bounded(candidate.id)||!sha(candidate.tree)||!sha(candidate.commit)||!record(candidate.candidate)||candidate.candidate.version!==1||!digest(candidate.candidate.id)||!sha(candidate.candidate.headRevision)||!record(candidate.source)||candidate.source.worktree!==input.workspace.path||candidate.source.branch!==input.workspace.branch||candidate.source.repositoryId!==input.workspace.repositoryId||!same(candidate.source.scopePaths,input.workspace.scopePaths))throw this.snapshotError("INPUT_INVALID");
    if(!isDeliveryGitContext(candidate.gitContext))throw this.snapshotError("CONTEXT_CHANGED");
    let captured:LocalSnapshotCommitInput;try{captured={...input,workspace:structuredClone(input.workspace),candidate:structuredClone(candidate),proof:structuredClone(input.proof)};}catch{throw this.snapshotError("INPUT_INVALID");}
    const binding=hash(canonical({runId:captured.runId,generation:captured.generation,leaseId:captured.leaseId,workspace:captured.workspace,message:captured.message,proof:captured.proof,candidate:captured.candidate}));
    return {input:captured,id:snapshotId(captured),binding};
  }
  private snapshotRead(id:string):unknown{
    const row=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get(strictKind,id) as {document_json:unknown}|undefined;
    if(!row)return undefined;return this.snapshotParse(row.document_json);
  }
  private snapshotParse(raw:unknown):unknown{if(typeof raw!=="string")throw this.snapshotError("OUTCOME_UNKNOWN");try{return JSON.parse(raw) as unknown;}catch(error){if(error instanceof SyntaxError)throw this.snapshotError("OUTCOME_UNKNOWN");throw error;}}
  /** Read every row: NULL, malformed JSON, moved keys and missing parents cannot disappear in SQL filters. */
  private snapshotBarriers(input:LocalSnapshotCommitInput,id:string,binding:string,allowPending:boolean):SnapshotReceipt|undefined{
    const rows=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind=?").all(strictKind) as Array<{id:string;document_json:unknown}>;
    const parents=new Map<string,SnapshotReceipt>();let current:SnapshotReceipt|undefined;
    for(const row of rows){
      const value=this.snapshotParse(row.document_json);if(!validSnapshotReceipt(value))throw this.snapshotError("OUTCOME_UNKNOWN");
      const related=value.runId===input.runId&&value.generation===input.generation||row.id.startsWith(`${groupId(input.runId,input.generation)}:`);
      if(!related)continue;
      if(snapshotId(value)!==row.id)throw this.snapshotError("OUTCOME_UNKNOWN");parents.set(row.id,value);
      if(value.proof.id===input.proof.id&&(value.proof.hash!==input.proof.hash||value.binding!==binding))throw this.snapshotError("OUTCOME_UNKNOWN");
      if(row.id===id){if(value.binding!==binding||value.leaseId!==input.leaseId||value.candidateId!==input.candidate.id)throw this.snapshotError("OUTCOME_UNKNOWN");current=value;}
      if(value.state!=="COMPLETE"&&!(row.id===id&&allowPending))throw this.snapshotError("OUTCOME_UNKNOWN");
    }
    const legacyId=hash({runId:input.runId,generation:input.generation});
    const legacyRows=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind=?").all("local-git-delivery") as Array<{id:string;document_json:unknown}>;
    let legacy:Record<string,unknown>|undefined;
    for(const row of legacyRows){
      const value=this.snapshotParse(row.document_json);
      // Incomplete legacy receipts contain no run/generation: a moved key cannot safely scope their uncertainty.
      if(!record(value)||!keys(value,["version","binding","state","result"])||value.version!==1||value.state!=="COMPLETE"||!digest(value.binding)||!record(value.result)||!keys(value.result,["version","runId","generation","commit","branch","files","created","completedAt",...(Object.hasOwn(value.result,"tree")?["tree"]:[])])||(Object.hasOwn(value.result,"tree")&&!sha(value.result.tree))||value.result.version!==1||!bounded(value.result.runId)||!Number.isSafeInteger(value.result.generation)||Number(value.result.generation)<1||!sha(value.result.commit)||!bounded(value.result.branch,1024)||!Array.isArray(value.result.files)||!value.result.files.every(file=>typeof file==="string")||typeof value.result.created!=="boolean"||typeof value.result.completedAt!=="string"||!Number.isFinite(Date.parse(value.result.completedAt)))throw this.snapshotError("OUTCOME_UNKNOWN");
      if(row.id===legacyId){if(value.result.runId!==input.runId||value.result.generation!==input.generation)throw this.snapshotError("OUTCOME_UNKNOWN");legacy=value;}
    }
    const commands=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind=?").all("local-git-command") as Array<{id:string;document_json:unknown}>;
    const seen=new Set<string>();
    for(const row of commands){
      const fact=this.snapshotParse(row.document_json);if(!record(fact)||![strictKind,"local-git-delivery","git-push-delivery"].includes(String(fact.ownerKind))||!bounded(fact.ownerId,1024)||!bounded(fact.runId)||!Number.isSafeInteger(fact.generation)||Number(fact.generation)<1)throw this.snapshotError("OUTCOME_UNKNOWN");
      const strict=fact.ownerKind===strictKind,related=fact.runId===input.runId&&fact.generation===input.generation||strict&&typeof fact.ownerId==="string"&&fact.ownerId.startsWith(`${groupId(input.runId,input.generation)}:`)||fact.ownerKind==="local-git-delivery"&&fact.ownerId===legacyId;
      if(!related)continue;
      if(!strict&&fact.ownerKind!=="local-git-delivery")continue;
      const parent=strict?parents.get(String(fact.ownerId)):legacy;
      if(!record(parent)||fact.version!==1||fact.id!==row.id||typeof fact.ownerId!=="string"||!["stage","commit"].includes(String(fact.phase))||commandId(strict?strictKind:"local-git-delivery",fact.ownerId,fact.phase as CommandPhase)!==row.id||fact.runId!==input.runId||fact.generation!==input.generation||fact.binding!==parent.binding||!digest(fact.commandHash))throw this.snapshotError("OUTCOME_UNKNOWN");
      const baseKeys=["version","id","ownerKind","ownerId","phase","runId","generation","leaseId","binding","cwd","commandHash","state"];
      if(!bounded(fact.leaseId)||typeof fact.cwd!=="string"||!fact.cwd.startsWith("/")||strict&&fact.leaseId!==parent.leaseId)throw this.snapshotError("OUTCOME_UNKNOWN");
      if(fact.phase==="stage"&&fact.commandHash!==hash({file:"git",args:["--literal-pathspecs","add","--all","--","."],cwd:fact.cwd}))throw this.snapshotError("OUTCOME_UNKNOWN");
      if(fact.state==="SENDING"){if(!keys(fact,baseKeys)||!strict||fact.ownerId!==id||!allowPending||parent.state!=="PENDING")throw this.snapshotError("OUTCOME_UNKNOWN");}
      else if(fact.state!=="SETTLED"||!keys(fact,[...baseKeys,"handle","result","observedAt"])||typeof fact.observedAt!=="string"||!Number.isFinite(Date.parse(fact.observedAt))||!validResult(fact.handle,fact.result)||!record(fact.result)||fact.result.classification!=="success"||fact.result.exitCode!==0)throw this.snapshotError("OUTCOME_UNKNOWN");
      seen.add(row.id);
    }
    for(const [ownerId,parent] of parents)if(parent.state==="COMPLETE")for(const phase of ["stage","commit"] as const)if(seen.has(commandId(strictKind,ownerId,phase))!==parent.outcome!.result.created)throw this.snapshotError("OUTCOME_UNKNOWN");
    if(current){this.checkCommands(input,strictKind,id,binding,current,allowPending);if(current.outcome){try{this.snapshotAuthored(input,current.outcome.observation,current.outcome.result.created,current.outcome.result.files);}catch(error){if(error instanceof LocalGitDeliveryError)throw this.snapshotError("OUTCOME_UNKNOWN");throw error;}}}
    return current;
  }
  snapshotCommitOutcome(original:LocalSnapshotCommitInput):"not-sent"|"observed"|"unknown"{
    const {input,id,binding}=this.snapshotInput(original),attempt=this.snapshotAttempts.get(id);
    try{const receipt=this.snapshotBarriers(input,id,binding,Boolean(attempt&&attempt.binding===binding));
      if(attempt?.binding===binding&&attempt.outcome&&receipt&&same(receipt.proof,input.proof)){this.requireKnownCommands(strictKind,id,attempt.outcome.result.created?["stage","commit"]:[]);return "observed";}
      if(receipt?.state==="COMPLETE")return "observed";
      if(receipt||attempt?.sent)return "unknown";return "not-sent";
    }catch(error){if(error instanceof LocalGitDeliveryError)return "unknown";throw error;}
  }
  async commitSnapshot(original:LocalSnapshotCommitInput):Promise<LocalCommitResult>{
    const {input,id,binding}=this.snapshotInput(original),environment=Object.freeze({...process.env});
    return this.commitCapturedSnapshot(input,id,binding,environment);
  }
  private async commitCapturedSnapshot(input:LocalSnapshotCommitInput,id:string,binding:string,environment:Readonly<Record<string,string|undefined>>):Promise<LocalCommitResult>{
    const pending=this.snapshotPending.get(id);
    if(pending){if(pending.binding!==binding)throw this.snapshotError("OUTCOME_UNKNOWN");return pending.work;}
    const existing=this.snapshotAttempts.get(id);if(existing&&existing.binding!==binding)throw this.snapshotError("OUTCOME_UNKNOWN");
    const attempt=existing??{input,binding,sent:false};this.snapshotAttempts.set(id,attempt);
    const work=Promise.resolve().then(()=>this.snapshotOnce(input,id,binding,environment,attempt)).finally(()=>this.snapshotPending.delete(id));this.snapshotPending.set(id,{binding,work});return work;
  }
  private snapshotFence(input:LocalSnapshotCommitInput):void{this.fence(input);if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");}
  private async snapshotRetained(input:LocalSnapshotCommitInput):Promise<void>{this.snapshotFence(input);await input.assertSnapshot();this.snapshotFence(input);}
  private snapshotQualified(input:LocalSnapshotCommitInput,observation:SnapshotCommitObservation,files?:string[]):void{
    if(!sameGitWorktreeContext(input.candidate.gitContext!.source,observation.context))throw this.snapshotError("CONTEXT_CHANGED");
    if(observation.branch!==input.workspace.branch||files&&!same(files,observation.files))throw this.snapshotError("CHANGED");
  }
  private stagedStatus(status:string):boolean{
    if(!status)return true;if(!status.endsWith("\0"))return false;const fields=status.slice(0,-1).split("\0");
    const path=(value:string|undefined)=>Boolean(value&&!value.startsWith("/")&&!value.split("/").some(part=>!part||part==="."||part===".."));
    for(let i=0;i<fields.length;i++){const entry=fields[i]!;if(entry.length<4||entry[1]!==" "||entry[2]!==" "||!"AMDRCT".includes(entry[0]!)||!path(entry.slice(3)))return false;if("RC".includes(entry[0]!)&&!path(fields[++i]))return false;}return true;
  }
  private async snapshotOnce(input:LocalSnapshotCommitInput,id:string,binding:string,environment:Readonly<Record<string,string|undefined>>,attempt:SnapshotAttempt):Promise<LocalCommitResult>{
    this.snapshotFence(input);
    if(!same(this.workspaces.get(input.workspace.path),input.workspace))throw this.snapshotError("CONTEXT_CHANGED");
    if(["GIT_NAMESPACE","GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_REPLACE_REF_BASE"].some(key=>environment[key]))throw this.snapshotError("ENVIRONMENT_UNAVAILABLE");
    const previous=this.snapshotBarriers(input,id,binding,Boolean(attempt.outcome));
    const known=attempt.outcome??previous?.outcome;
    const observe=async()=>{await this.snapshotRetained(input);let value:SnapshotCommitObservation;try{value=await this.workspaces.observeSnapshotCommit(input.workspace,input.candidate.tree,environment);}catch(error){if(error instanceof WorkspacePolicyError&&error.code==="SNAPSHOT_COMMIT_ENVIRONMENT_UNAVAILABLE")throw this.snapshotError("ENVIRONMENT_UNAVAILABLE");throw error;}this.snapshotFence(input);await this.snapshotRetained(input);this.snapshotQualified(input,value);return value;};
    if(known){
      this.requireKnownCommands(strictKind,id,known.result.created?["stage","commit"]:[]);
      const actual=await observe();if(!same(actual,known.observation))throw this.snapshotError("CHANGED");
      this.snapshotAuthored(input,actual,known.result.created,known.result.files);attempt.outcome=structuredClone(known);this.snapshotFence(input);
      if(previous?.state!=="COMPLETE")this.snapshotComplete(input,id,binding,known);return structuredClone(known.result);
    }
    if(previous||attempt.sent)throw this.snapshotError("OUTCOME_UNKNOWN");
    await this.snapshotRetained(input);await input.assertSource();this.snapshotFence(input);
    const before=await observe();if(before.head!==input.candidate.candidate.headRevision)throw this.snapshotError("CHANGED");
    const files=[...before.files],created=before.tree!==input.candidate.tree;
    if(!created&&(before.status!==""||!before.indexMatches))throw this.snapshotError("CHANGED");
    const receipt:SnapshotReceipt={version:1,runId:input.runId,generation:input.generation,leaseId:input.leaseId,proof:input.proof,candidateId:input.candidate.id,binding,state:"PENDING"};
    this.database.transaction(()=>{this.snapshotFence(input);if(this.snapshotBarriers(input,id,binding,false)||!this.database.createEntityIfAbsent(strictKind,id,json(receipt)))throw this.snapshotError("OUTCOME_UNKNOWN");});
    let actual=before;
    if(created){
      await this.git(input,["add","--all","--","."],30_000,{ownerKind:strictKind,ownerId:id,binding,phase:"stage"},environment);
      actual=await observe();this.snapshotQualified(input,actual,files);
      if(actual.head!==before.head||!actual.indexMatches||!this.stagedStatus(actual.status))throw this.snapshotError("CHANGED");
      await this.git(input,["commit","--quiet","-m",`${input.message}\n\nDispatcher-Run: ${input.runId}\nDispatcher-Generation: ${input.generation}`],30_000,{ownerKind:strictKind,ownerId:id,binding,phase:"commit"},environment);
      actual=await observe();
    }
    this.snapshotAuthored(input,actual,created,files);
    const result:LocalCommitResult={version:1,runId:input.runId,generation:input.generation,commit:actual.head,branch:actual.branch,files,created,completedAt:new Date().toISOString()},outcome={result,observation:actual};
    attempt.outcome=structuredClone(outcome);this.snapshotFence(input);this.snapshotComplete(input,id,binding,outcome);return structuredClone(result);
  }
  private snapshotAuthored(input:LocalSnapshotCommitInput,actual:SnapshotCommitObservation,created:boolean,files:string[]):void{
    this.snapshotQualified(input,actual,files);if(actual.tree!==input.candidate.tree||actual.status!==""||!actual.indexMatches||(created?(actual.head===input.candidate.candidate.headRevision||!same(actual.parents,[input.candidate.candidate.headRevision])):actual.head!==input.candidate.candidate.headRevision))throw this.snapshotError("CHANGED");
  }
  private snapshotComplete(input:LocalSnapshotCommitInput,id:string,binding:string,outcome:SnapshotOutcome):void{
    this.database.transaction(()=>{this.snapshotFence(input);this.parent(strictKind,id,binding);const receipt=this.snapshotRead(id) as SnapshotReceipt;this.database.saveEntity(strictKind,id,json({...receipt,state:"COMPLETE",outcome}));if(!same(this.snapshotRead(id),{...receipt,state:"COMPLETE",outcome}))throw this.snapshotError("OUTCOME_UNKNOWN");});
  }
  async commit(input:LocalCommitInput):Promise<LocalCommitResult>{
    this.fence(input);
    if(!input.runId||!Number.isSafeInteger(input.generation)||input.generation<1||input.workspace.runId!==input.runId||!input.message.trim()||input.message.length>1000||input.message.includes(String.fromCharCode(0))||input.verifiedTree!==undefined&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.verifiedTree))throw new LocalGitDeliveryError("COMMIT_INPUT_INVALID","Commit requires a bound run and bounded message");
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
    return this.pushOwned(input);
  }
  async pushSnapshot(original:LocalSnapshotPushInput):Promise<RunGitDelivery>{
    const captured=this.snapshotInput(original);
    if(!isGitDeliveryTarget(original.target))throw this.snapshotError("INPUT_INVALID");
    const input={...captured.input,target:structuredClone(original.target)},environment=Object.freeze({...process.env});
    const outcome=this.snapshotPushOutcome(input),id=hash({runId:input.runId,generation:input.generation}),binding=pushBinding(captured.binding,input.target);
    if(outcome==="unknown"&&this.pushPending.get(id)?.binding!==binding)throw this.unknown("git-push-delivery");
    const authorize=captured.input.assertAuthority,guard=()=>{authorize.call(captured.input);this.snapshotPushReceipt(captured.input,id,binding,input.target);if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");};
    captured.input.assertAuthority=guard;input.assertAuthority=guard;
    const commit=()=>this.commitCapturedSnapshot(captured.input,captured.id,captured.binding,environment);
    const result=await this.pushOwned(input,{binding:captured.binding,environment,commit});
    // Replay is factual only after the retained proof/source and target still qualify.
    const committed=await commit();await this.workspaces.resolvePushTarget(input.workspace,input.target,environment);this.snapshotFence(input);
    if(result.commit!==committed.commit||this.snapshotPushOutcome(input)!=="observed")throw this.unknown("git-push-delivery");
    return {version:1,commit:{...committed,tree:input.candidate.tree},push:result};
  }
  snapshotPushOutcome(original:LocalSnapshotPushInput):"not-sent"|"observed"|"unknown"{
    try{
      const captured=this.snapshotInput(original),input=captured.input,target=original.target;
      if(!isGitDeliveryTarget(target))return "unknown";
      const id=hash({runId:input.runId,generation:input.generation}),binding=pushBinding(captured.binding,target);
      const receipt=this.snapshotPushReceipt(input,id,binding,target);
      this.checkCommands(input,"git-push-delivery",id,binding,receipt,this.pushPending.get(id)?.binding===binding,target);
      const result=receipt?.state==="COMPLETE"?receipt.result:this.pushKnown.get(id);
      if(result){
        if(!this.validPushResult(result)||result.runId!==input.runId||result.generation!==input.generation||result.branch!==input.workspace.branch||!same(result.target,target)||this.snapshotCommitOutcome(input)!=="observed")return "unknown";
        const attempt=this.snapshotAttempts.get(captured.id),saved=this.snapshotBarriers(input,captured.id,captured.binding,Boolean(attempt?.outcome)),committed=attempt?.outcome??saved?.outcome;
        if(result.commit!==committed?.result.commit)return "unknown";
        this.requireKnownCommands("git-push-delivery",id,["push"]);return "observed";
      }
      return receipt||this.pushPending.has(id)?"unknown":"not-sent";
    }catch(error){if(error instanceof LocalGitDeliveryError)return "unknown";throw error;}
  }
  private snapshotPushReceipt(input:LocalSnapshotCommitInput,id:string,binding:string,target:GitDeliveryTarget):PushReceipt|undefined{
    const rows=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind='git-push-delivery'").all() as Array<{id:string;document_json:unknown}>;
    let receipt:PushReceipt|undefined;
    for(const row of rows){
      const value=this.snapshotParse(row.document_json);
      if(!record(value)||value.version!==1||!digest(value.binding)||!["PENDING","COMPLETE"].includes(String(value.state))||!keys(value,["version","binding","state",...(value.state==="COMPLETE"?["result"]:[])]))throw this.unknown("git-push-delivery");
      if(row.id===id){
        if(value.binding!==binding||value.state==="PENDING"&&this.pushPending.get(id)?.binding!==binding&&!this.pushKnown.has(id))throw this.unknown("git-push-delivery");
        if(value.state==="COMPLETE"&&(!this.validPushResult(value.result)||value.result.runId!==input.runId||value.result.generation!==input.generation||value.result.branch!==input.workspace.branch||!same(value.result.target,target)))throw this.unknown("git-push-delivery");
        receipt=value as unknown as PushReceipt;
      }else if(value.state!=="COMPLETE"||!this.validPushResult(value.result)||value.result.runId===input.runId&&value.result.generation===input.generation)throw this.unknown("git-push-delivery");
    }
    return receipt;
  }
  private validPushResult(value:unknown):value is GitPushResult{
    return record(value)&&keys(value,["version","runId","generation","commit","branch","target","pushedAt"])&&value.version===1&&bounded(value.runId)&&Number.isSafeInteger(value.generation)&&Number(value.generation)>0&&sha(value.commit)&&bounded(value.branch,1024)&&isGitDeliveryTarget(value.target)&&typeof value.pushedAt==="string"&&Number.isFinite(Date.parse(value.pushedAt));
  }
  private async pushOwned(input:LocalPushInput,strict?:{binding:string;environment:Readonly<Record<string,string|undefined>>;commit:()=>Promise<LocalCommitResult>}):Promise<GitPushResult>{
    this.fence(input);
    const id=hash({runId:input.runId,generation:input.generation}),target=structuredClone(input.target);
    const binding=pushBinding(strict?.binding??commitBinding(input),target);
    const save=(receipt:PushReceipt)=>this.database.transaction(()=>{if(receipt.state==="COMPLETE")this.parent("git-push-delivery",id,binding);this.database.saveEntity("git-push-delivery",id,json(receipt));});
    const receipt=this.database.getEntity<JsonValue>("git-push-delivery",id) as unknown as PushReceipt|undefined;
    if(receipt&&receipt.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Push identity is bound to another target or request");
    this.checkCommands(input,"git-push-delivery",id,binding,receipt,this.pushPending.get(id)?.binding===binding,target);
    if(receipt?.state==="COMPLETE"&&receipt.result)return structuredClone(receipt.result);
    const known=this.pushKnown.get(id);if(known){this.requireKnownCommands("git-push-delivery",id,["push"]);this.parent("git-push-delivery",id,binding);save({version:1,binding,state:"COMPLETE",result:known});return structuredClone(known);}
    const pending=this.pushPending.get(id);if(pending){if(pending.binding!==binding)throw new LocalGitDeliveryError("PUSH_IDENTITY_CONFLICT","Another target is pending");return pending.work;}
    if(receipt)throw new LocalGitDeliveryError("PUSH_OUTCOME_UNKNOWN","Prior push outcome is unknown; inspect its remote before any retry");
    const work=Promise.resolve().then(async()=>{
      await this.workspaces.resolvePushTarget(input.workspace,target,strict?.environment);this.fence(input);
      const committed=strict?await strict.commit():await this.commit(input);this.fence(input);
      const url=await this.workspaces.resolvePushTarget(input.workspace,target,strict?.environment);this.fence(input);
      const git=(args:string[])=>this.git(input,args,30_000,undefined,strict?.environment);
      if(await git(["rev-parse","HEAD"])!==committed.commit||await git(["symbolic-ref","--short","HEAD"])!==committed.branch||await git(["status","--porcelain"]))throw new LocalGitDeliveryError("PUSH_WORKSPACE_CHANGED","Push requires the frozen clean managed commit");
      await this.workspaces.resultFiles(input.workspace,strict?.environment);this.fence(input);save({version:1,binding,state:"PENDING"});this.fence(input);
      await this.git(input,["push","--porcelain","--no-force","--no-follow-tags","--recurse-submodules=no",url,`${committed.commit}:refs/heads/${committed.branch}`],120_000,{ownerKind:"git-push-delivery",ownerId:id,binding,phase:"push",outgoing:{commit:committed.commit,branch:committed.branch,target}},strict?.environment);
      const result:GitPushResult={version:1,runId:input.runId,generation:input.generation,commit:committed.commit,branch:committed.branch,target:structuredClone(target),pushedAt:new Date().toISOString()};
      this.pushKnown.set(id,result);this.fence(input);save({version:1,binding,state:"COMPLETE",result});this.pushKnown.delete(id);return result;
    }).finally(()=>this.pushPending.delete(id));this.pushPending.set(id,{binding,work});return work;
  }
  private fence(input:LocalCommitInput):void{
    if(input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");input.assertAuthority();
  }
  private save(id:string,receipt:Receipt):void{this.database.transaction(()=>{if(receipt.state==="COMPLETE")this.parent("local-git-delivery",id,receipt.binding);this.database.saveEntity("local-git-delivery",id,json(receipt));});}
  private parent(ownerKind:CommandOwner["ownerKind"],id:string,binding:string):void{
    if(ownerKind===strictKind){const attempt=this.snapshotAttempts.get(id);if(!attempt||attempt.binding!==binding)throw this.unknown(ownerKind);const receipt=this.snapshotBarriers(attempt.input,id,binding,true);if(receipt?.state!=="PENDING")throw this.unknown(ownerKind);return;}
    const receipt=this.database.getEntity(ownerKind,id);
    if(!record(receipt)||!keys(receipt,["version","binding","state"])||receipt.version!==1||receipt.binding!==binding||receipt.state!=="PENDING")throw this.unknown(ownerKind);
  }
  private unknown(ownerKind:CommandOwner["ownerKind"]):LocalGitDeliveryError{return new LocalGitDeliveryError(ownerKind===strictKind?"SNAPSHOT_COMMIT_OUTCOME_UNKNOWN":ownerKind==="local-git-delivery"?"COMMIT_OUTCOME_UNKNOWN":"PUSH_OUTCOME_UNKNOWN","Owned Git command outcome is unknown; inspect its retained physical artifacts before any retry");}
  private command(id:string,ownerKind:CommandOwner["ownerKind"]):unknown{
    const row=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get("local-git-command",id) as {document_json:string}|undefined;
    if(!row)return undefined;
    // Only malformed journal JSON is normalized; storage/reader failures retain their original error.
    try{return JSON.parse(row.document_json) as unknown;}catch(error){if(error instanceof SyntaxError)throw this.unknown(ownerKind);throw error;}
  }
  private checkCommands(input:LocalCommitInput,ownerKind:CommandOwner["ownerKind"],ownerId:string,binding:string,parent:unknown,ownedPending:boolean,target?:GitDeliveryTarget):void{
    const phases:CommandPhase[]=ownerKind!=="git-push-delivery"?["stage","commit"]:["push"];
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
  private async git(input:LocalCommitInput,args:string[],timeoutMs=30_000,owner?:CommandOwner,environment?:Readonly<Record<string,string|undefined>>):Promise<string>{
    const commandArgs=["--literal-pathspecs",...args],cwd=input.workspace.path,runId=input.runId;
    const fact:CommandFact|undefined=owner?{...structuredClone(owner),version:1,id:commandId(owner.ownerKind,owner.ownerId,owner.phase),runId,generation:input.generation,leaseId:input.leaseId,cwd,commandHash:hash({file:"git",args:commandArgs,cwd}),state:"SENDING"}:undefined;
    this.fence(input);if(fact){
      this.sending(fact);if(fact.ownerKind===strictKind)this.snapshotAttempts.get(fact.ownerId)!.sent=true;
      this.fence(input);if(fact.ownerKind===strictKind&&input.signal?.aborted)throw new LocalGitDeliveryError("COMMIT_ABORTED","Commit operation was cancelled");this.parent(fact.ownerKind,fact.ownerId,fact.binding);
      // The authority callback can change either receipt synchronously; requalify without an async gap.
      if(JSON.stringify(this.command(fact.id,fact.ownerKind))!==JSON.stringify(fact))throw this.unknown(fact.ownerKind);
    }
    const process=await this.processes.start({runId,file:"git",args:commandArgs,cwd,timeoutMs,...(environment?{env:environment}:{})}),identity={id:process.id,pid:process.pid};
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
      if(input.verifiedTree&&await this.git(input,["write-tree"])!==input.verifiedTree)throw new LocalGitDeliveryError("VERIFIED_TREE_CHANGED","Staged content differs from the verified source tree");
      await this.git(input,["commit","--quiet","-m",`${input.message}\n\nDispatcher-Run: ${input.runId}\nDispatcher-Generation: ${input.generation}`],30_000,{ownerKind:"local-git-delivery",ownerId:id,binding,phase:"commit"});
    }
    const commit=await this.git(input,["rev-parse","--verify","HEAD"]),files=await this.workspaces.resultFiles(input.workspace);this.fence(input);
    if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)||await this.git(input,["symbolic-ref","--short","HEAD"])!==input.workspace.branch||await this.git(input,["status","--porcelain"]))throw new LocalGitDeliveryError("COMMIT_OUTCOME_UNKNOWN","Git completion did not establish a clean managed branch");
    const tree=input.verifiedTree?await this.git(input,["rev-parse",`${commit}^{tree}`]):undefined;
    if(tree!==input.verifiedTree)throw new LocalGitDeliveryError("VERIFIED_TREE_CHANGED","Committed content differs from the verified source tree");
    const result:LocalCommitResult={version:1,runId:input.runId,generation:input.generation,commit,...(tree?{tree}:{}),branch:input.workspace.branch,files,created:commit!==before,completedAt:new Date().toISOString()};
    // Repair follows the commands actually sent, even if a hook moved HEAD back to its original SHA.
    this.known.set(id,{result,phases:dirty?["stage","commit"]:[]});this.fence(input);this.save(id,{version:1,binding,state:"COMPLETE",result});this.known.delete(id);return structuredClone(result);
  }
}
