import type { HistoryPage, NativeHistoryEntry, Run, RunNativeSessionView } from "@dispatcher/domain";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Notice } from "./ui.js";
export interface HistoryEntryContext {phase:"human"|"automated"|"unknown";event?:"approval"|"error"|"interrupted"|"model-change"}
export interface NativeHistoryProps {
  nativeSessionId:string;scopeKey:string;sourceKind:"native"|"dispatcher-audit"|"export";
  readPage:(request:{cursor?:string;limit:number})=>Promise<HistoryPage>;
  context?:Readonly<Record<string,HistoryEntryContext>>;
}
export function NativeHistory(props:NativeHistoryProps):React.JSX.Element {
  return <HistoryContents key={JSON.stringify([props.scopeKey,props.nativeSessionId,props.sourceKind])} {...props}/>;
}
const sources={native:"原生历史","dispatcher-audit":"Dispatcher 审计",export:"导出记录"};
const kinds={user:"用户",assistant:"助手",tool:"工具",approval:"审批",summary:"摘要",other:"其他"};
const events={approval:"审批",error:"错误",interrupted:"中断", "model-change":"模型变化"};
const phases={human:"人工阶段",automated:"自动阶段",unknown:"阶段未记录"};
const states={deleted:"原生历史已删除，任务记录仍保留。",unreachable:"原生历史暂不可读取，请检查原生客户端。",unsupported:"此账号不支持读取原生历史。",unknown:"原生历史状态未确认。",available:""};
function HistoryContents({nativeSessionId,readPage,sourceKind,context}:NativeHistoryProps):React.JSX.Element {
  const [entries,setEntries]=useState<NativeHistoryEntry[]>([]);
  const [page,setPage]=useState<HistoryPage>();
  const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState<string>();
  const [loading,setLoading]=useState(false);
  const [requests,setRequests]=useState(0);
  const live=useRef(true),inFlight=useRef(false),requestEpoch=useRef(0);
  const readSource=useRef<string|undefined>(undefined);
  const cursors=useRef(new Set<string>());
  async function load(cursor?:string) {
    if(inFlight.current||cursor&&(requests>=10||entries.length>=500))return;
    inFlight.current=true;setLoading(true);setError(undefined);
    const epoch=++requestEpoch.current;
    try {
      const next=await readPage({limit:50,...(cursor?{cursor}:{})});
      if(!live.current||epoch!==requestEpoch.current)return;
      if(next?.version!==1||next.nativeSessionId!==nativeSessionId||readSource.current!==undefined&&next.source!==readSource.current)throw new Error("HISTORY_IDENTITY_CHANGED");
      if(!Array.isArray(next.entries)||next.entries.length>50||typeof next.source!=="string"||!Object.hasOwn(states,next.state)||next.entries.some(entry=>typeof entry?.id!=="string"||typeof entry.text!=="string"||!Object.hasOwn(kinds,entry.kind)))throw new Error("INVALID_HISTORY_PAGE");
      const freshWindow=cursor===undefined;
      readSource.current=next.source;setRequests(count=>freshWindow?1:count+1);setPage(next);
      if(freshWindow)cursors.current.clear();
      if(next.state!=="available"){setEntries([]);setWarnings([]);return;}
      setEntries(current=>{
        const replacements=new Map(next.entries.map(entry=>[entry.id,entry]));
        const combined=(freshWindow?[]:current).map(entry=>{const replacement=replacements.get(entry.id);replacements.delete(entry.id);return replacement??entry;});
        return [...combined,...replacements.values()].slice(0,500);
      });
      const flags:string[]=[];
      if(next.completeness==="partial"||next.gaps?.length)flags.push("历史范围不完整，缺失部分不能用于判断控制权。");
      if(next.completeness==="unknown")flags.push("历史完整性未确认。");
      if(next.range==="summary-only")flags.push("仅摘要：原生系统未返回完整聊天。");
      if(next.range==="retained-range")flags.push("仅保留范围：较早历史可能已压缩或移除。");
      if(next.truncation||next.entries.some(entry=>entry.truncated))flags.push("内容已截断，请在原生客户端核对完整范围。");
      setWarnings(current=>[...new Set([...(freshWindow?[]:current),...flags])]);
      if(cursor)cursors.current.add(cursor);
      if(next.nextCursor&&(next.nextCursor===cursor||cursors.current.has(next.nextCursor))){
        const {nextCursor:_cursor,...bounded}=next;void _cursor;setPage(bounded);setError("分页游标未推进，已停止加载，请核对原生历史。");
      }
    } catch(cause) {
      if(!live.current||epoch!==requestEpoch.current)return;
      setEntries([]);setPage(undefined);setWarnings([]);
      setError(cause instanceof Error&&cause.message==="HISTORY_IDENTITY_CHANGED"?"会话身份或历史来源已变化，请重新打开当前运行。":"历史读取失败，请核对访问权限并重试。");
    } finally {if(live.current&&epoch===requestEpoch.current){inFlight.current=false;setLoading(false);}}
  }
  useEffect(()=>{live.current=true;inFlight.current=false;void load();return()=>{live.current=false;requestEpoch.current++;};},[]);
  const bounded=requests>=10||entries.length>=500;
  return <section aria-label="只读会话历史" className="detail-section">
    <h3>只读会话历史</h3>
    <p>{sources[sourceKind]}{page?` · ${page.source}`:""}</p>
    <small>只显示来源实际返回的内容，未公开的思考过程无法显示。查看历史不会接管或继续会话。</small>
    {loading&&<p role="status">正在读取一页历史…</p>}
    {error&&<p role="alert">{error}</p>}
    {warnings.map(message=><p className="notice" key={message}>{message}</p>)}
    {page&&page.state!=="available"&&<p role="status">{states[page.state]}</p>}
    {page?.state==="available"&&entries.length===0&&<p>此范围没有可读的历史条目。</p>}
    {entries.map((entry,index)=>{
      const metadata=context?.[entry.id],prior=entries[index-1];
      const phase=metadata?.phase??"unknown";
      const group=index===0||entry.turnId!==prior?.turnId||phase!==(prior?context?.[prior.id]?.phase??"unknown":"unknown");
      return <article key={entry.id}>
        {group&&<h4>{phases[phase]}{entry.turnId?` · 回合 ${entry.turnId}`:""}</h4>}
        <p>{metadata?.event?events[metadata.event]:kinds[entry.kind]}{entry.occurredAt&&Number.isFinite(Date.parse(entry.occurredAt))?` · ${new Date(entry.occurredAt).toLocaleString()}`:""}</p>
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{entry.text}</pre>
        {entry.truncated&&<small>此条目已截断。</small>}
      </article>;
    })}
    {bounded&&<p className="notice">已达到本次查看上限（10 页或 500 条），请在原生客户端核对其余历史。</p>}
    <div className="detail-toolbar"><button disabled={loading} onClick={()=>void load()}>刷新只读历史</button>{page?.nextCursor&&!bounded&&<button disabled={loading} onClick={()=>void load(page.nextCursor)}>加载下一页</button>}</div>
  </section>;
}

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0;
const counter=(value:unknown):boolean=>Number.isSafeInteger(value)&&Number(value)>=0;
const optionalText=(value:unknown):boolean=>value===undefined||text(value);
const oneOf=(value:unknown,choices:readonly string[]):boolean=>typeof value==="string"&&choices.includes(value);
/** Guard the fields consumed by the saved summary and read boundary; never repair a malformed projection. */
export function validNativeSessionView(value:unknown):value is RunNativeSessionView {
  if(!record(value)||value.version!==1||value.mutationAvailable!==false||!["runId","sessionId","profileId"].every(key=>text(value[key]))||!counter(value.generation)||!counter(value.attempt)||value.completeness!=="unknown")return false;
  if(!oneOf(value.identity,["legacy","unbound","bound","deleted","unreachable","conflict"])||!oneOf(value.state,["idle","running","waiting","deleted","unreachable","unknown"])||!oneOf(value.freshness,["fresh","stale","unknown"]))return false;
  const binding=value.binding,control=value.control,execution=value.execution;
  if(binding!==null&&(!record(binding)||!["product","region","profileId","backendId","runnerId","nativeSessionId"].every(key=>text(binding[key]))||!optionalText(binding.nativeThreadId)))return false;
  if(control!==null&&(!record(control)||!oneOf(control.state,["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"])||!counter(control.epoch)||!counter(control.revision)||!oneOf(control.exclusion,["native-enforced","cooperative","none"])))return false;
  if(!record(execution)||!oneOf(execution.kind,["managed-worktree","provider-self-hosted","provider-cloud","legacy"])||!["runnerId","worktree","branch","environmentRef"].every(key=>optionalText(execution[key])))return false;
  // Summary's existing label object has a prototype; those names are not safe unknown labels.
  if(!Array.isArray(value.capabilities)||!value.capabilities.every(capability=>record(capability)&&text(capability.name)&&!Object.hasOwn(Object.prototype,capability.name)&&oneOf(capability.support,["supported","unsupported","unknown"])&&optionalText(capability.level)))return false;
  if(!Array.isArray(value.access)||!value.access.every(access=>record(access)&&oneOf(access.surface,["desktop","ide","web","mobile","tui"])&&oneOf(access.availability,["unverified","unsupported"])))return false;
  if(value.observedAt!==null&&!text(value.observedAt))return false;
  return [value.requestedModel,value.reportedModel].every(model=>model===undefined||record(model)&&text(model.id)&&optionalText(model.reasoning));
}
/** Match saved metadata without substituting Dispatcher identity for native identity. */
export function nativeSessionMatchesRun(run:Run,view:RunNativeSessionView):boolean {
  return view.runId===run.id&&view.sessionId===run.sessionId&&view.profileId===run.profileId&&view.generation===run.generation&&view.attempt===run.attempt&&(view.execution.runnerId===undefined||view.execution.runnerId===run.runnerId)&&(!view.binding||view.binding.profileId===run.profileId&&view.binding.runnerId===run.runnerId&&text(run.providerSessionId)&&view.binding.nativeSessionId===run.providerSessionId);
}
/** Preserve the bound reader's exact tuple; observation timestamps and models are not identity. */
export function nativeSessionScopeKey(taskId:string,runId:string,run:Run,view:RunNativeSessionView):string {
  const binding=view.binding,control=view.control;
  return JSON.stringify([taskId,runId,run.sessionId,run.profileId,run.generation,run.attempt,run.providerSessionId,run.runnerId,binding?.product??null,binding?.region??null,binding?.profileId??null,binding?.backendId??null,binding?.runnerId??null,binding?.nativeSessionId??null,binding?.nativeThreadId??null,control?.state??null,control?.epoch??null,control?.revision??null,control?.exclusion??null,view.capabilities.filter(capability=>capability.name==="historyRead").map(capability=>[capability.support,capability.level??null])]);
}
interface TaskHistoryProps {taskId:string;runId:string|undefined;run:Run|undefined;view:RunNativeSessionView|undefined;headerReady:boolean;open:boolean;onOpenChange:(open:boolean)=>void}
/** The server qualifies reads; this UI only matches its current public projection to the selected saved Run. */
export function TaskNativeHistory({taskId,runId,run,view,headerReady,open,onOpenChange}:TaskHistoryProps):React.JSX.Element {
  let reason:string|undefined;
  if(!headerReady)reason="当前任务或运行快照尚未成功读取。";
  else if(!run||!runId||run.id!==runId||run.taskId!==taskId)reason="运行与当前任务或所选记录不匹配。";
  else if(!validNativeSessionView(view))reason="原生会话摘要缺失或格式无效。";
  else if(view.identity!=="bound"||!view.binding)reason=({legacy:"未绑定原生会话。",unbound:"未绑定原生会话。",deleted:"原生会话已删除。",unreachable:"原生会话暂不可达。",conflict:"原生会话身份冲突，待核对。",bound:"缺少原生绑定。"})[view.identity];
  else if(!nativeSessionMatchesRun(run,view))reason="运行与已保存的原生绑定不匹配。";
  else if(!view.control||view.state==="deleted"||view.state==="unreachable")reason="原生控制或会话状态不可确认，请核对原生客户端。";
  else {
    const reads=view.capabilities.filter(capability=>capability.name==="historyRead");
    if(reads.length!==1||reads[0]?.support!=="supported")reason=reads.length===1&&reads[0]?.support==="unsupported"?"服务端不支持读取此会话的历史。":"服务端尚未确认此会话的历史读取能力。";
  }
  if(reason||!run||!view?.binding||!view.control)return <section className="detail-section" aria-label="原生历史读取"><h3>原生历史读取</h3><button disabled>查看只读历史</button><Notice>只读历史不可用：{reason}</Notice></section>;
  const scopeKey=nativeSessionScopeKey(taskId,run.id,run,view);
  return <TaskHistoryContents key={scopeKey} runId={run.id} nativeSessionId={view.binding.nativeSessionId} scopeKey={scopeKey} open={open} onOpenChange={onOpenChange}/>;
}
function validPublicPage(page:unknown,nativeSessionId:string):page is HistoryPage {
  if(!record(page)||page.version!==1||page.nativeSessionId!==nativeSessionId||!text(page.source)||!oneOf(page.state,["available","deleted","unreachable","unsupported","unknown"])||!oneOf(page.completeness,["complete","partial","unknown"])||!oneOf(page.range,["native-history","summary-only","retained-range"])||!optionalText(page.nextCursor)||page.truncation!==undefined&&typeof page.truncation!=="string"||page.gaps!==undefined&&(!Array.isArray(page.gaps)||!page.gaps.every(gap=>typeof gap==="string")))return false;
  return Array.isArray(page.entries)&&page.entries.length<=50&&page.entries.every(entry=>record(entry)&&text(entry.id)&&typeof entry.text==="string"&&typeof entry.kind==="string"&&Object.hasOwn(kinds,entry.kind)&&optionalText(entry.turnId)&&(entry.truncated===undefined||typeof entry.truncated==="boolean")&&(entry.occurredAt===undefined||typeof entry.occurredAt==="string"&&Number.isFinite(Date.parse(entry.occurredAt))));
}
function TaskHistoryContents({runId,nativeSessionId,scopeKey,open,onOpenChange}:{runId:string;nativeSessionId:string;scopeKey:string;open:boolean;onOpenChange:(open:boolean)=>void}):React.JSX.Element {
  async function readPage(request:{cursor?:string;limit:number}):Promise<HistoryPage> {
    const query=new URLSearchParams({limit:String(request.limit)});
    if(request.cursor!==undefined)query.set("cursor",request.cursor);
    const response=await api<unknown>(`/api/runs/${encodeURIComponent(runId)}/history?${query}`);
    if(!record(response)||response.source!=="native"||!validPublicPage(response.page,nativeSessionId))throw new Error("INVALID_PUBLIC_HISTORY");
    return response.page;
  }
  return <section className="detail-section" aria-label="原生历史读取"><h3>原生历史读取</h3><div className="detail-toolbar"><button onClick={()=>onOpenChange(!open)}>{open?"关闭只读历史":"查看只读历史"}</button></div>{open&&<NativeHistory nativeSessionId={nativeSessionId} scopeKey={scopeKey} sourceKind="native" readPage={readPage}/>}</section>;
}
