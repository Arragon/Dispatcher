import {isTerminalRunState,type Run,type Session,type Task} from "@dispatcher/domain";
import {ConnectorError,type ConversationBinding,type ConversationBindingService,type MessagingAdapter} from "@dispatcher/integrations";
import {InteractionStore,type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import {redactNativeText} from "@dispatcher/observability";
import {isSafeNativeMetadataId} from "@dispatcher/runner";
import {backoffDelayMs} from "./background.js";

interface Notice {
 version:1;id:string;state:string;runId:string;sessionId:string;controlEpoch:number;
 controlRevision:number;controlState:string;code?:string;failures?:number;nextAttemptAt?:string;
}
interface Options {
 database:DispatcherDatabase;conversations:ConversationBindingService;
 conversationFor:(run:Run)=>ConversationBinding|undefined;
 connector:(id:string)=>MessagingAdapter|undefined;clock:()=>Date;warn:(error:unknown,runId:string)=>void;
}
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const conflict=()=>new ConnectorError("CONFLICT","Conversation changed during notification",{retryable:false,operation:"write"});
function verified(value:unknown,id:string,now:number):value is Notice {
 if(!value||typeof value!=="object")return false;
 const notice=value as Notice;
 const retryAt=notice.nextAttemptAt===undefined?undefined:typeof notice.nextAttemptAt==="string"?Date.parse(notice.nextAttemptAt):NaN;
 return notice.version===1&&notice.id===id&&[notice.id,notice.runId,notice.sessionId].every(isSafeNativeMetadataId)
  &&[notice.controlEpoch,notice.controlRevision].every(n=>Number.isSafeInteger(n)&&n>=1)
  &&["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"].includes(notice.controlState)
  &&(notice.code===undefined||typeof notice.code==="string"&&/^[A-Z][A-Z0-9_]{0,199}$/.test(notice.code))
  &&(notice.failures===undefined||Number.isSafeInteger(notice.failures)&&notice.failures>=0&&notice.failures<5)
  // SQLite selects the first duplicate key; JSON.parse admits the last. Recheck both fields.
  &&notice.state==="pending"&&(retryAt===undefined||Number.isFinite(retryAt)&&retryAt<=now);
}

/** Delivers existing metadata intents; NativeInteractions alone owns native control. */
export class NativeControlNotices {
 private cursor:string|undefined;
 private readonly store:InteractionStore;
 constructor(private readonly options:Options){this.store=new InteractionStore(options.database);}
 async drain():Promise<void> {
  const {database,clock}=this.options;
  const select=database.handle.prepare(`SELECT id,document_json FROM entities
   WHERE kind='native-control-outbox' AND id>?
   AND CASE WHEN length(CAST(document_json AS BLOB))<=65536 AND json_valid(document_json)
    THEN json_extract(document_json,'$.state')='pending' AND
     (json_type(document_json,'$.nextAttemptAt') IS NULL OR
      (json_type(document_json,'$.nextAttemptAt')='text' AND julianday(json_extract(document_json,'$.nextAttemptAt'))<=julianday(?)))
    ELSE 0 END ORDER BY id LIMIT 10`);
  const at=clock().toISOString();
  let rows=select.all(this.cursor??"",at) as Array<{id:string;document_json:string}>;
  if(!rows.length&&this.cursor!==undefined){this.cursor=undefined;rows=select.all("",at) as typeof rows;}
  for(const row of rows){
   this.cursor=row.id;
   const value:unknown=JSON.parse(row.document_json);
   if(!verified(value,row.id,clock().getTime()))continue;
   const notice=value;
   const run=database.getEntity<JsonValue>("run",notice.runId) as unknown as Run|undefined;
   if(!run||!this.current(notice,run)){this.save(notice,"obsolete");continue;}
   let binding:ConversationBinding|undefined;
   try{binding=this.options.conversationFor(run);}catch(error){if(error instanceof ConnectorError&&error.code==="CONFLICT")continue;throw error;}
   const connector=binding?this.options.connector(binding.connectorInstanceId):undefined;
   if(!binding||!connector?.reply)continue;
   const reply=connector.reply;
   try{
    if(this.options.connector(binding.connectorInstanceId)!==connector)throw conflict();
    if(!this.current(notice,run)){this.save(notice,"obsolete");continue;}
    const text=notice.controlState==="HUMAN"?"已验证原生控制释放。当前由你手动控制；普通线程回复不会发送给 Agent。交还时请请求只读核对。":notice.controlState==="AUTOMATED"?"当前已恢复自动控制；请以当前 Run 和最新控制状态为准。":"原生控制请求正在处理或需要核对；当前状态尚未确认交接完成。";
    await reply.call(connector,{channel:binding.conversationId,threadId:binding.threadId,text:redactNativeText(`${text}\nRun: ${run.id} / ${notice.controlState}${notice.code?` / ${notice.code}`:""}`)},`native-control:${notice.id}`);
    database.transaction(()=>{
     const boundAt=clock().toISOString();
     if(!this.current(notice,run)){this.save(notice,"obsolete");return;}
     // Reselect the exact latest route, retaining concurrent WAITING_USER and refusing replacements.
     const latest=this.options.conversationFor(run);
     if(!latest||latest.id!==binding.id||latest.runId!==binding.runId||latest.sessionId!==binding.sessionId||latest.generation!==binding.generation||latest.connectorInstanceId!==binding.connectorInstanceId||latest.conversationId!==binding.conversationId||latest.threadId!==binding.threadId||this.options.connector(binding.connectorInstanceId)!==connector||connector.reply!==reply||latest.controlEpoch!==undefined&&latest.controlEpoch>notice.controlEpoch)throw conflict();
     if(!this.current(notice,run)){this.save(notice,"obsolete");return;}
     this.options.conversations.bind({...latest,controlEpoch:notice.controlEpoch},boundAt);
     this.save(notice,"sent");
    });
   }catch(error){
    // A delivered external reply cannot be undone. Lost Run/control authority never pins a route.
    if(!this.current(notice,run)){this.save(notice,"obsolete");continue;}
    const failures=(notice.failures??0)+1,retryable=error instanceof ConnectorError&&error.options.retryable;
    const delay=Math.max(backoffDelayMs(failures,1_000,300_000),error instanceof ConnectorError?error.options.retryAfterMs??0:0);
    database.saveEntity("native-control-outbox",notice.id,json({...notice,failures,state:retryable&&failures<5?"pending":"failed",nextAttemptAt:new Date(clock().getTime()+delay).toISOString()}));
    this.options.warn(error,run.id);
   }
  }
 }
 private current(notice:Notice,expected:Run):boolean {
  const {database,clock}=this.options;
  const now=clock().getTime();
  const run=database.getEntity<JsonValue>("run",notice.runId) as unknown as Run|undefined;
  if(!run||run.id!==notice.runId||run.sessionId!==notice.sessionId||run.sessionId!==expected.sessionId||run.taskId!==expected.taskId||run.generation!==expected.generation||!Number.isSafeInteger(run.generation)||run.generation<1||run.leaseId!==expected.leaseId||!isSafeNativeMetadataId(run.leaseId)||run.profileId!==expected.profileId||run.providerId!==expected.providerId||run.runnerId!==expected.runnerId||isTerminalRunState(run.state)||!run.leaseExpiresAt||!(Date.parse(run.leaseExpiresAt)>now))return false;
  const session=database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined;
  const task=database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task|undefined;
  const control=this.store.control(notice.sessionId);
  const row=database.handle.prepare("SELECT session_id,active_run_id,epoch,revision,state FROM session_controls WHERE session_id=?").get(notice.sessionId) as {session_id:string;active_run_id:string;epoch:number;revision:number;state:string}|undefined;
  return Boolean(row&&row.session_id===control?.sessionId&&row.active_run_id===control.activeRunId&&row.epoch===control.epoch&&row.revision===control.revision&&row.state===control.state&&session?.id===run.sessionId&&session.profileId===run.profileId&&session.providerId===run.providerId&&task?.currentRunId===run.id&&control?.sessionId===run.sessionId&&control.activeRunId===run.id&&control.epoch===notice.controlEpoch&&control.revision===notice.controlRevision&&control.state===notice.controlState);
 }
 private save(notice:Notice,state:string):void {this.options.database.saveEntity("native-control-outbox",notice.id,json({...notice,state}));}
}
