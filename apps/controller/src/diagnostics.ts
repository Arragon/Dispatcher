import type {DiagnosticEntry,DiagnosticsSnapshot,EvidenceState,ProfileConsoleView} from "@dispatcher/domain";
export const diagnosticChecks:DiagnosticsSnapshot["checks"]=[
 {id:"controller.snapshot",label:"读取 Controller 已保存状态",cost:"read-only",entityRequired:false},
 {id:"runner.connection",label:"读取设备连接状态",cost:"read-only",entityRequired:true},
 {id:"profile.native",label:"检查已登记账号的原生安装与登录",cost:"provider-query",entityRequired:true},
 {id:"connector.health",label:"检查已登记平台连接",cost:"provider-query",entityRequired:true},
];
interface Facts {
 now:string;lifecycle:string;revision:number;profiles:ProfileConsoleView[];
 runners:Array<{id:string;connected:boolean;lastSeenAt?:string}>;
 connectors:Array<{id:string;health:string;updatedAt?:string}>;
 runs:Array<{id:string;state:string;lastActivityAt?:string;recoveryReason?:string}>;
 publications:Array<{id:string;state:string;updatedAt?:string}>;
 deliveries:Array<{id:string;state:string;updatedAt?:string}>;
 deadLetters:Array<{id:string;canRetry:boolean;createdAt:string}>;
}
const time=(value:string|undefined)=>value&&Number.isFinite(Date.parse(value))?value:undefined;
/** Projection only: no native, connector or inference calls belong in this read. */
export function buildDiagnostics(facts:Facts):DiagnosticsSnapshot{
 const entries:DiagnosticEntry[]=[];
 const add=(entry:Omit<DiagnosticEntry,"id"|"freshness">)=>entries.push({...entry,id:`${entry.entityRef.kind}:${entry.entityRef.id}:${entry.category}`,freshness:entry.status==="stale"?"stale":entry.observedAt?"fresh":"unknown"});
 add({category:"lifecycle",entityRef:{kind:"controller",id:"local"},status:facts.lifecycle==="READY"?"pass":"fail",severity:facts.lifecycle==="READY"?"info":"error",source:"controller-lifecycle",observedAt:facts.now,message:facts.lifecycle==="READY"?"Controller 已就绪；执行账号和设备另行验证。":"Controller 当前尚未就绪。",reasonCode:facts.lifecycle,actions:[]});
 for(const runner of facts.runners)add({category:"connection",entityRef:{kind:"runner",id:runner.id},status:runner.connected?"pass":"fail",severity:runner.connected?"info":"warning",source:"live-transport",observedAt:facts.now,message:runner.connected?"设备连接已建立；不代表原生工具已验证。":"设备当前未连接。",reasonCode:runner.connected?"CONNECTED":"DISCONNECTED",actions:[{label:"设备管理",href:"/devices"},{label:"检查连接",checkId:"runner.connection"}]});
 for(const profile of facts.profiles)for(const category of ["installation","compatibility","authentication","resources"] as const){
  const evidence:EvidenceState=profile[category],observedAt=time(evidence.observedAt),status:DiagnosticEntry["status"]=evidence.status==="stale"?"stale":evidence.status==="ready"&&observedAt?"pass":["missing","failed"].includes(evidence.status)?"fail":"unknown";
  add({category,entityRef:{kind:"profile",id:profile.id},status,severity:status==="fail"||status==="stale"?"warning":"info",source:evidence.source??"saved-profile-evidence",...(observedAt?{observedAt}:{}),message:status==="pass"?"已有独立验证证据，请核对其取证时间。":status==="stale"?"原证据已过期或账号上下文改变。":status==="fail"?"此项检查未通过，请查看账号详情。":"此项尚无已验证的有效证据。",reasonCode:evidence.reasonCode??"EVIDENCE_UNVERIFIED",actions:[{label:"账号详情",href:"/harnesses"},...(category==="authentication"&&profile.actions.test?.allowed?[{label:"原生检查",checkId:"profile.native"}]:[])]});
 }
 for(const connector of facts.connectors){const healthy=connector.health==="HEALTHY",unknown=["UNKNOWN","DEGRADED"].includes(connector.health),observedAt=time(connector.updatedAt),stale=connector.health==="CONTEXT_CHANGED"||Boolean(observedAt&&Date.parse(facts.now)-Date.parse(observedAt)>5*60_000);add({category:"integration",entityRef:{kind:"connector",id:connector.id},status:stale?"stale":healthy?observedAt?"pass":"unknown":unknown?"unknown":"fail",severity:healthy&&!stale?"info":"warning",source:"saved-connector-health",...(observedAt?{observedAt}:{}),message:stale?"平台连接检查已过期或配置已改变。":healthy&&observedAt?"已有平台连接检查记录。":"平台连接尚未通过有效检查。",reasonCode:connector.health==="CONTEXT_CHANGED"?"CONNECTOR_CONTEXT_CHANGED":stale?"CONNECTOR_PROBE_EXPIRED":connector.health,actions:[{label:"平台集成",href:"/integrations"},{label:"检查连接",checkId:"connector.health"}]});}
 for(const run of facts.runs)if(["RUNNER_UNAVAILABLE","RESOURCE_BLOCKED","SUSPECTED_STALL","FAILED"].includes(run.state))add({category:"execution",entityRef:{kind:"run",id:run.id},status:run.state==="FAILED"?"fail":"unknown",severity:"warning",source:"canonical-run",...(time(run.lastActivityAt)?{observedAt:run.lastActivityAt!}:{}),message:"运行需要核对；诊断读取不会恢复或重复启动。",reasonCode:run.recoveryReason??run.state,actions:[{label:"任务与运行",href:"/tasks"}]});
 for(const publication of facts.publications)if(["OUTCOME_UNKNOWN","START_FAILED","FAILED"].includes(publication.state))add({category:"publication",entityRef:{kind:"publication",id:publication.id},status:publication.state==="OUTCOME_UNKNOWN"?"unknown":"fail",severity:"warning",source:"publication-receipt",...(time(publication.updatedAt)?{observedAt:publication.updatedAt!}:{}),message:"发布回执需要核对，不能据此自动重发任务。",reasonCode:publication.state,actions:[{label:"任务与运行",href:"/tasks"}]});
 for(const delivery of facts.deliveries)if(["FAILED","PENDING"].includes(delivery.state))add({category:"delivery",entityRef:{kind:"delivery",id:delivery.id},status:delivery.state==="FAILED"?"fail":"unknown",severity:"warning",source:"delivery-evidence",...(time(delivery.updatedAt)?{observedAt:delivery.updatedAt!}:{}),message:"交付尚未确认完成，请查看原运行记录。",reasonCode:delivery.state,actions:[{label:"交付记录",href:"/tasks"}]});
 for(const dead of facts.deadLetters)add({category:"synchronization",entityRef:{kind:"dead-letter",id:dead.id},status:"fail",severity:"warning",source:"durable-sync-queue",observedAt:dead.createdAt,message:dead.canRetry?"同步事件尚未送达，可在平台集成中审阅重试。":"同步事件尚未送达，需要人工核对。",reasonCode:dead.canRetry?"RETRY_AVAILABLE":"MANUAL_RECONCILIATION",actions:[{label:"查看同步恢复",href:"/integrations"}]});
 const summary:DiagnosticsSnapshot["summary"]={pass:0,fail:0,unknown:0,stale:0};for(const entry of entries)summary[entry.status]++;
 return {generatedAt:facts.now,controllerReady:facts.lifecycle==="READY",executionReadiness:facts.lifecycle==="READY"&&facts.profiles.some(profile=>["local-ready","remote-ready"].includes(profile.executionSupport)&&[profile.installation,profile.compatibility,profile.authentication].every(evidence=>evidence.status==="ready"&&time(evidence.observedAt)))?"ready":facts.profiles.length?"unverified":"unconfigured",configRevision:facts.revision,entries,summary,checks:diagnosticChecks};
}
