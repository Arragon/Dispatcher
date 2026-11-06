import type {NativeControlView,Run,RunNativeSessionView} from "@dispatcher/domain";
import {useId,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {ApiError,readNativeControl} from "./api.js";
import {TaskNativeHistory,nativeSessionMatchesRun,nativeSessionScopeKey,validNativeSessionView} from "./NativeHistory.js";
import {NativeSessionSummary} from "./NativeSessionSummary.js";
import {HandoffDialog} from "./HandoffDialog.js";
import {Drawer} from "./Drawer.js";

interface NativeSessionPanelProps {
  taskId:string;runId:string|undefined;run:Run|undefined;view:unknown;headerReady:boolean;
  errorStatus?:number|undefined;onRefresh:()=>void|Promise<unknown>;
}
const surfaces={desktop:"桌面",ide:"IDE",web:"网页",mobile:"移动端",tui:"终端"};
/** Saved native facts consume the canonical TaskDetail snapshot; opening is the only native read trigger. */
export function NativeSessionPanel(props:NativeSessionPanelProps):React.JSX.Element {
  const {taskId,runId,run,view,headerReady,errorStatus,onRefresh}=props;
  const valid=validNativeSessionView(view)?view:undefined;
  let message:string|undefined;
  if(errorStatus===401||errorStatus===403)message="没有读取此原生会话的权限。";
  else if(!headerReady||errorStatus!==undefined)message="原生会话摘要读取失败，请刷新后重试。";
  else if(!run||!runId||run.id!==runId||run.taskId!==taskId||valid&&!nativeSessionMatchesRun(run,valid))message="运行已变化，请刷新当前任务后查看会话。";
  else if(view!==null&&view!==undefined&&!valid)message="原生会话摘要读取失败，请刷新后重试。";
  if(message||!valid||!run||!runId)return <>
    <NativeSessionSummary/>
    {message&&<section className="detail-section"><p role="status">{message}</p><button onClick={()=>void onRefresh()}>刷新会话摘要</button></section>}
    <TaskNativeHistory taskId={taskId} runId={runId} run={run} view={valid} headerReady={headerReady&&errorStatus===undefined} open={false} onOpenChange={()=>undefined}/>
  </>;
  const scopeKey=nativeSessionScopeKey(taskId,runId,run,valid);
  // Identity/readability and lease revocation must also discard an opening before a new child can read.
  const ownerKey=JSON.stringify([scopeKey,valid.identity,valid.state==="deleted"||valid.state==="unreachable"?valid.state:null,run.leaseId]);
  return <SessionContents key={ownerKey} taskId={taskId} runId={runId} run={run} view={valid} scopeKey={scopeKey} onRefresh={onRefresh}/>;
}
function SessionContents({taskId,runId,run,view,scopeKey,onRefresh}:{taskId:string;runId:string;run:Run;view:RunNativeSessionView;scopeKey:string;onRefresh:()=>void|Promise<unknown>}):React.JSX.Element {
  const [historyOpen,setHistoryOpen]=useState(false),[controlOpen,setControlOpen]=useState(false);
  const age=view.observedAt?Date.now()-Date.parse(view.observedAt):NaN;
  const stale=view.freshness==="stale"||view.freshness==="fresh"&&Number.isFinite(age)&&age>60_000;
  const known=view.freshness==="fresh"&&!stale&&Number.isFinite(age)&&age>=0;
  // Freshness affects presentation only; history still consumes the original saved read projection.
  const display:RunNativeSessionView={...view,freshness:stale?"stale":known?"fresh":"unknown",state:!known&&["idle","running","waiting"].includes(view.state)?"unknown":view.state};
  const location=view.execution.kind==="managed-worktree"?"本机托管工作区":view.execution.kind==="provider-self-hosted"?"Provider 自托管环境":view.execution.kind==="provider-cloud"?"Provider 云端环境":"执行位置未记录";
  return <>
    <NativeSessionSummary view={display}/>
    <section className="detail-section" aria-label="原生会话位置与读取">
      {stale&&<p className="notice" role="alert">观察已过期，不能据此判断当前状态或控制权。刷新摘要后仍需新的原生观察。</p>}
      {view.identity==="legacy"?<p>此运行未记录原生会话绑定。可查看工作目录，并在原生客户端核对当前工作。</p>:view.identity==="unbound"?<p>原生会话绑定尚未验证。请在当前账号的原生客户端核对身份。</p>:view.identity==="conflict"?<p role="alert">会话身份不一致，请核对当前运行和账号。</p>:view.identity==="deleted"||view.state==="deleted"?<p>原生会话已删除；任务记录保留，请勿继续旧会话。</p>:view.identity==="unreachable"||view.state==="unreachable"?<p>原生会话暂不可读取，请检查对应 Runner 和原生客户端。</p>:!known||view.state==="unknown"?<p>当前原生状态未确认。请刷新并在原生客户端核对，任务完成不代表原生工作已停止。</p>:null}
      <dl className="details-grid">
        <div><dt>执行位置</dt><dd>{location}{view.execution.runnerId?` · ${view.execution.runnerId}`:""}</dd></div>
        {view.execution.environmentRef&&<div><dt>环境引用</dt><dd>{view.execution.environmentRef}</dd></div>}
        {view.binding&&<><div><dt>原生产品与账号</dt><dd>{view.binding.product} · {view.binding.profileId} · {view.binding.region}</dd></div>{view.binding.nativeThreadId&&<div><dt>原生线程 ID</dt><dd>{view.binding.nativeThreadId}</dd></div>}</>}
      </dl>
      <p>历史完整性未确认</p>
      {view.control?.exclusion==="cooperative"&&<small>协作隔离，未声明原生排他锁。</small>}
      {view.access.map((item,index)=><p key={index}>{surfaces[item.surface]}入口：{item.availability==="unsupported"?"不支持":"尚未验证，请在原生客户端定位现有会话。"}</p>)}
      <div className="page-actions"><button onClick={()=>void onRefresh()}>刷新会话摘要</button>{view.identity==="bound"&&view.binding&&view.control&&view.state!=="deleted"&&view.state!=="unreachable"&&<button onClick={()=>setControlOpen(true)}>查看原生控制状态</button>}</div>
    </section>
    <TaskNativeHistory taskId={taskId} runId={runId} run={run} view={view} headerReady open={historyOpen} onOpenChange={setHistoryOpen}/>
    {controlOpen&&<NativeControlDialog run={run} sessionId={view.sessionId} scopeKey={scopeKey} onClose={()=>setControlOpen(false)} onViewHistory={()=>{setControlOpen(false);setHistoryOpen(true);}}/>}
  </>;
}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0;
const counter=(value:unknown):boolean=>Number.isSafeInteger(value)&&Number(value)>=0;
const oneOf=(value:unknown,choices:readonly string[]):boolean=>typeof value==="string"&&choices.includes(value);
function validNativeControl(value:unknown,run:Run,sessionId:string):value is NativeControlView {
  if(!record(value)||value.version!==1||value.runId!==run.id||value.profileId!==run.profileId||value.generation!==run.generation||value.attempt!==run.attempt||value.mutationAvailable!==false)return false;
  if(value.control===null&&value.fence===null)return value.reasonCode==="NATIVE_CONTROL_UNAVAILABLE";
  if(value.reasonCode!=="NATIVE_CONTROL_COORDINATOR_UNAVAILABLE")return false;
  const control=value.control,fence=value.fence;
  if(!record(control)||control.version!==1||control.sessionId!==sessionId||control.sessionId!==run.sessionId||control.activeRunId!==run.id||!oneOf(control.state,["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"])||!oneOf(control.exclusion,["native-enforced","cooperative","none"])||!counter(control.epoch)||!counter(control.revision)||!text(control.updatedAt))return false;
  return record(fence)&&fence.runId===run.id&&fence.sessionId===sessionId&&fence.expectedCurrentRunId===run.id&&fence.generation===run.generation&&text(fence.leaseId)&&fence.leaseId===run.leaseId&&counter(fence.expectedTaskRevision)&&fence.expectedControlEpoch===control.epoch&&fence.expectedControlRevision===control.revision;
}
function NativeControlDialog({run,sessionId,scopeKey,onClose,onViewHistory}:{run:Run;sessionId:string;scopeKey:string;onClose:()=>void;onViewHistory:()=>void}):React.JSX.Element {
  // A mounted opening owns a distinct cache/in-flight identity, including pending close/reopen.
  const opening=useId();
  const query=useQuery({queryKey:["native-control",scopeKey,run.leaseId,opening],queryFn:()=>readNativeControl(run.id),retry:false,refetchOnMount:"always",refetchInterval:30_000});
  const value:unknown=query.data;
  let message:string|undefined;
  if(!query.isFetchedAfterMount||query.isFetching)message="正在读取控制快照…";
  else if(query.error)message=query.error instanceof ApiError&&[401,403].includes(query.error.status)?"没有读取此控制快照的权限。":"控制快照读取失败，请刷新后重试。";
  else if(!validNativeControl(value,run,sessionId))message="运行已变化，请重新打开控制状态。";
  else if(!value.control||!value.fence)message="此运行没有已验证的原生控制记录。";
  if(message||!validNativeControl(value,run,sessionId)||!value.control||!value.fence)return <Drawer title="原生会话控制" onClose={onClose}><p role="status">{message}</p><button disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新控制快照</button></Drawer>;
  return <HandoffDialog control={value.control} fence={value.fence} qualified={false} unavailableReason="当前运行尚不支持控制交接，可查看控制状态与只读历史。" onClose={onClose} onViewHistory={onViewHistory} onRefresh={()=>void query.refetch()}/>;
}
