import {isDeepStrictEqual} from "node:util";
import {isExecutionContextRef,type MutationFence,type Run,type SessionControl} from "@dispatcher/domain";
import {ConnectorError,type ConversationBinding,type MessagingIdentityService,type NormalizedMessage,type PrincipalBinding} from "@dispatcher/integrations";
import {type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import type {InteractionPrincipal,NativeInteractions} from "./native-interactions.js";

const runFields=["id","taskId","sessionId","profileId","providerId","runnerId","generation","attempt","leaseId","worktree","executionRef","executionSelection"] as const;
const scopeOf=(run:Run)=>Object.fromEntries(runFields.map(key=>[key,run[key]??null]));
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512;
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const conflict=()=>new ConnectorError("CONFLICT","Thread or control authority changed; refresh the current run",{retryable:false});
interface Capture {version:2;fence:MutationFence;conversation:ConversationBinding;identity:PrincipalBinding;run:Record<string,unknown>;control:Pick<SessionControl,"activeRunId"|"state"|"epoch"|"revision">}
interface Options {database:DispatcherDatabase;identities:MessagingIdentityService;interactions:NativeInteractions;conversationFor:(run:Run)=>ConversationBinding|undefined;clock:()=>Date}

/** Original messaging authority survives approval delays; it never adopts a newer owner. */
export class NativeWorkflowAuthority {
  constructor(private readonly options:Options){}
  capture(input:{workflowId:string;run:Run;binding:ConversationBinding;principal:PrincipalBinding;message:NormalizedMessage}):void {
    const {database,interactions}=this.options;
    database.transaction(()=>{
      if(database.handle.prepare("SELECT 1 FROM entities WHERE kind='messaging-control-authority' AND id=?").get(input.workflowId)){
        this.assert(input.workflowId,input.run,{id:input.principal.principalId,roles:input.principal.roles},false);return;
      }
      const {binding,message,run,principal}=input;
      if(binding.connectorInstanceId!==message.connectorInstanceId||binding.conversationId!==message.conversationId||binding.threadId!==message.threadId||principal.connectorInstanceId!==message.connectorInstanceId||principal.externalPrincipalId!==message.principalExternalId||message.action?.generation!==undefined&&message.action.generation!==run.generation||message.action?.controlEpoch!==undefined&&message.action.controlEpoch!==binding.controlEpoch)throw conflict();
      const control=this.control(run.sessionId);
      const record:Capture={version:2,fence:interactions.fenceFor(run,input.workflowId),conversation:structuredClone(binding),identity:structuredClone(principal),run:scopeOf(run),control};
      this.validate(record,input.workflowId,run,{id:principal.principalId,roles:principal.roles},false);
      database.saveEntity("messaging-control-authority",input.workflowId,JSON.parse(JSON.stringify(record)) as JsonValue);
    });
  }
  assert(workflowId:string,run:Run,principal:InteractionPrincipal,mutation:boolean):MutationFence {
    const row=this.options.database.handle.prepare("SELECT document_json FROM entities WHERE kind='messaging-control-authority' AND id=?").get(workflowId) as {document_json:string}|undefined;
    let captured:unknown;
    try{if(!row||Buffer.byteLength(row.document_json)>65_536)throw conflict();captured=JSON.parse(row.document_json);}catch{throw conflict();}
    this.validate(captured,workflowId,run,principal,mutation);
    return structuredClone(captured.fence);
  }
  private control(sessionId:string):Capture["control"] {
    const row=this.options.database.handle.prepare("SELECT session_id,active_run_id,epoch,revision,state,document_json FROM session_controls WHERE session_id=?").get(sessionId) as {session_id:string;active_run_id:string;epoch:number;revision:number;state:string;document_json:string}|undefined;
    try{
      const c:unknown=row?JSON.parse(row.document_json):undefined;
      if(!row||!object(c)||c.version!==1||c.sessionId!==sessionId||c.activeRunId!==row.active_run_id||c.epoch!==row.epoch||c.revision!==row.revision||c.state!==row.state||!id(c.activeRunId)||!integer(c.epoch)||!integer(c.revision)||!["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"].includes(String(c.state)))throw conflict();
      return {activeRunId:c.activeRunId,state:c.state as SessionControl["state"],epoch:c.epoch,revision:c.revision};
    }catch{throw conflict();}
  }
  private validate(value:unknown,workflowId:string,run:Run,principal:InteractionPrincipal,mutation:boolean):asserts value is Capture {
    if(!object(value)||value.version!==2||!object(value.fence)||!object(value.conversation)||!object(value.identity)||!object(value.run)||!object(value.control))throw conflict();
    const f=value.fence,c=value.conversation,i=value.identity,s=value.run;
    if(![f.runId,f.sessionId,f.commandId,f.leaseId,f.expectedCurrentRunId].every(id)||![f.generation,f.expectedTaskRevision,f.expectedControlRevision,f.expectedControlEpoch].every(integer)||f.commandId!==workflowId||!runFields.every(key=>Object.hasOwn(s,key))||![s.id,s.taskId,s.sessionId,s.profileId,s.providerId,s.runnerId,s.leaseId,s.worktree].every(id)||!integer(s.generation)||!integer(s.attempt)||s.executionRef!==null&&!isExecutionContextRef(s.executionRef)||s.executionSelection!==null&&!object(s.executionSelection)||!id(i.connectorInstanceId)||!id(i.externalPrincipalId)||!id(i.principalId)||!Array.isArray(i.roles)||!i.roles.every(id)||!id(i.approvedAt)||i.revokedAt!==undefined||!id(c.id)||!integer(c.revision)||!integer(c.generation)||!integer(c.controlEpoch)||![c.connectorInstanceId,c.conversationId,c.threadId].every(id)||!["ACTIVE","WAITING_USER"].includes(String(c.state)))throw conflict();
    const identity=this.options.identities.authorize(i.connectorInstanceId,i.externalPrincipalId);
    if(i.principalId!==principal.id||identity.principalId!==principal.id||!i.roles.every(role=>identity.roles.includes(role))||!principal.roles.every(role=>identity.roles.includes(role))||!identity.roles.some(role=>(mutation?["operator","admin"]:["viewer","operator","admin"]).includes(role)))throw new ConnectorError("AUTH","Messaging identity or permissions changed",{retryable:false});
    const {database,conversationFor,clock}=this.options;
    const current=database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
    const task=database.getCanonicalTask<JsonValue>(run.taskId),session=database.getEntity<JsonValue>("session",run.sessionId) as unknown as {id:string;profileId:string;providerId:string}|undefined;
    const profiles=(database.getConfigState()?.document as unknown as {agentProfiles?:Array<{id:string;provider:string;runnerId?:string;enabled?:boolean}>}|undefined)?.agentProfiles;
    const profile=profiles?.find(profile=>profile.id===run.profileId);
    const control=this.control(run.sessionId);
    if(!current||!isDeepStrictEqual(scopeOf(current),s)||!isDeepStrictEqual(scopeOf(run),s)||!Number.isFinite(Date.parse(current.leaseExpiresAt??""))||Date.parse(current.leaseExpiresAt!)<=clock().getTime()||current.revokedLeaseIds?.includes(current.leaseId)||!session||session.id!==run.sessionId||session.profileId!==run.profileId||session.providerId!==run.providerId||!profile||profile.enabled===false||profile.provider!==run.providerId||profile.runnerId!==undefined&&profile.runnerId!==run.runnerId||!task||task.revision!==f.expectedTaskRevision||(task.document as {currentRunId?:string}).currentRunId!==run.id||f.expectedCurrentRunId!==run.id||f.runId!==run.id||f.sessionId!==run.sessionId||f.generation!==run.generation||f.leaseId!==run.leaseId||control.activeRunId!==run.id||!isDeepStrictEqual(control,value.control)||control.epoch!==f.expectedControlEpoch||control.revision!==f.expectedControlRevision||c.controlEpoch!==control.epoch||c.runId!==run.id||c.sessionId!==run.sessionId||c.generation!==run.generation||c.taskId!==run.taskId||!isDeepStrictEqual(conversationFor(run),c))throw conflict();
    this.options.interactions.assertInteraction(principal,"history",f as unknown as MutationFence);
  }
}
