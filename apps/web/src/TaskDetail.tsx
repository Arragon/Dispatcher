import { RoutingDecision } from "./RoutingDecision.js";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TaskContract, Run, DeliveryEvidence } from "@dispatcher/domain";
import type { FleetTaskInput, FleetProfileInput, FleetRunInput } from "@dispatcher/fleet";
import { api, ApiError, subscribeToEvents } from "./api.js";
import { Drawer } from "./Drawer.js";
import { TaskActions } from "./TaskActions.js";
import { Notice } from "./ui.js";
import { safeLink, stateLabel, terminalStates } from "./task-view.js";
interface TaskView { executionIntent?:{publicationId:string}; revision:number; document:Task; contract?:TaskContract; deliveries:DeliveryEvidence[]; runs:Run[]; archive?:{revision:number;archivedAt?:string} }
interface RunResult { worktree:string; branch:string; files:string[]; verification:Run["verification"]; summary?:string }
function Lines({items,empty="未登记"}:{items?:string[];empty?:string}):React.JSX.Element {return items?.length ? <ul className="detail-list">{items.map((item,index)=><li key={index}>{item}</li>)}</ul> : <p className="muted">{empty}</p>;}
export function TaskDetail({id,fallback,profiles,onClose,refresh}:{id:string;fallback?:FleetTaskInput;profiles:FleetProfileInput[];onClose:()=>void;refresh:()=>Promise<unknown>}):React.JSX.Element {
  const query=useQuery({queryKey:["task-detail",id],queryFn:()=>api<TaskView>(`/api/tasks/${encodeURIComponent(id)}`),retry:false});
  const [attempt,setAttempt]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const data=query.data?.document ? query.data : undefined;
  const task=data ? {...data.document,revision:data.revision,archiveRevision:data.archive?.revision??0,...(data.archive?.archivedAt?{archivedAt:data.archive.archivedAt}:{})} : fallback;
  const currentId=task?.currentRunId;
  const runId=attempt||currentId;
  const runQuery=useQuery({queryKey:["run-detail",runId],queryFn:()=>api<{run:Run;contract?:TaskContract}>(`/api/runs/${encodeURIComponent(runId!)}`),enabled:Boolean(runId),retry:false});
  const run=runQuery.data?.run;
  const result=useQuery({queryKey:["run-result",runId],queryFn:()=>api<{result:RunResult}>(`/api/runs/${encodeURIComponent(runId!)}/result`),enabled:Boolean(run&&terminalStates.has(run.state)),retry:false});
  useEffect(()=>subscribeToEvents(()=>{void query.refetch();if(runId){void runQuery.refetch();if(run&&terminalStates.has(run.state))void result.refetch();}}),[query.refetch,runQuery.refetch,result.refetch,runId,run]);
  async function reload():Promise<void>{await Promise.all([query.refetch(),...(runId?[runQuery.refetch()]:[]),refresh()]);}
  async function archive():Promise<void>{
    if(!task||!data||busy)return;setBusy(true);setMessage("");
    try{await api(`/api/tasks/${encodeURIComponent(id)}/archive`,{method:"POST",body:JSON.stringify({archived:!task.archivedAt,revision:data.revision,archiveRevision:data.archive?.revision??0})});await reload();setMessage(task.archivedAt?"任务已恢复到当前项目":"任务已归档，执行记录保留");}
    catch(error){setMessage(error instanceof Error?error.message:"归档失败");if(error instanceof ApiError&&error.status===409)await reload();}
    finally{setBusy(false);}
  }
  const activeRun=data?.runs?.find(entry=>entry.id===currentId);
  const actionsRun=activeRun ? {...activeRun,createdAt:activeRun.startedAt??"",updatedAt:activeRun.lastActivityAt??""} as FleetRunInput : undefined;
  const frozenContract=runQuery.data?.contract;
  const contract=attempt&&attempt!==currentId?frozenContract:frozenContract??data?.contract;
  const selection=run?.executionSelection;
  return <Drawer title={task?.title??(query.isLoading?"正在读取任务…":"任务详情")} onClose={onClose}>
    <div className="detail-toolbar"><span className="muted">{id}</span><button disabled={query.isFetching} onClick={()=>void reload()}>刷新详情</button></div>
    {query.error&&<Notice tone="error">{query.error instanceof ApiError&&query.error.status===404?"任务不存在或已不可访问。":"任务详情读取失败，当前内容可能已过期。"}<button onClick={()=>void reload()}>重试读取</button></Notice>}
    {data&&task&&<>
      <dl className="details-grid"><div><dt>任务状态</dt><dd><span className={`status status-${task.state.toLowerCase()}`}>{stateLabel(task.state)}</span></dd></div><div><dt>任务 / 契约版本</dt><dd>{data.revision} / {data.contract?.revision??"未登记"}</dd></div><div><dt>项目</dt><dd>{task.projectId}</dd></div><div><dt>归档版本</dt><dd>{data.archive?.revision??0}{task.archivedAt?" · 已归档":" · 当前项目"}</dd></div></dl>
      <section className="detail-section"><h3>完整任务说明</h3><pre className="task-instructions">{data.document.description??data.contract?.instructions??"历史任务未保存正文"}</pre></section>
      <section className="detail-section"><h3>执行记录</h3><label>查看运行<select value={runId??""} onChange={event=>setAttempt(event.target.value)}><option value="">{currentId?"选择运行":"尚无当前运行"}</option>{data.runs?.map(entry=><option key={entry.id} value={entry.id}>{entry.id===currentId?"当前运行":"历史尝试"} · {entry.id} · {stateLabel(entry.state)}</option>)}</select></label>
      {runQuery.isLoading&&runId&&<p role="status">正在读取运行快照…</p>}{runQuery.error&&<Notice tone="error">运行快照读取失败。<button onClick={()=>void runQuery.refetch()}>重试</button></Notice>}
      {run&&<><dl className="details-grid"><div><dt>Run 状态</dt><dd>{stateLabel(run.state)}</dd></div><div><dt>执行账号 / 提供方</dt><dd>{run.profileId} / {run.providerId??"未提供"}</dd></div><div><dt>本次请求模型</dt><dd>{selection?.requestedModel??(selection?"沿用原生配置":"历史记录未保存")}</dd></div><div><dt>运行模型证据</dt><dd>{run.model?.id??"未上报"} · {run.model?.source??"未知"}</dd></div><div><dt>参数与选择来源</dt><dd>{selection?`${JSON.stringify(selection.nativeParameters)} · ${selection.source}`:"未保存"}</dd></div><div><dt>配置 / 契约版本</dt><dd>{selection?.configRevision??"未知"} / {run.contractRevision??"未知"}</dd></div><div><dt>原生会话</dt><dd>{run.providerSessionId??"未上报"}</dd></div><div><dt>执行设备</dt><dd>{run.runnerId??"未提供"}</dd></div><div><dt>工作目录</dt><dd>{run.worktree??"未提供"}</dd></div><div><dt>分支</dt><dd>{run.branch??"未提供"}</dd></div><div><dt>输入 / 输出 token</dt><dd>{run.tokens?`${run.tokens.input} / ${run.tokens.output}`:"未提供"}</dd></div><div><dt>缓存输入 token（包含于输入）</dt><dd>{run.tokens?.cachedInput??"未提供"}</dd></div></dl><p className="muted">{run.tokenScope==="latest-turn"?"用量为最新完成回合，非运行累计。":"用量统计范围未提供。"}</p><p>{run.activitySummary??"尚无运行说明"}</p>{(run.failureReason||run.resourceBlockReason||run.recoveryReason)&&<Notice tone="warning">{[run.failureReason,run.resourceBlockReason,run.recoveryReason].filter(Boolean).join(" · ")}{run.recoveryReason==="NATIVE_OUTCOME_UNKNOWN"&&<p>先核查原生进程和会话；服务端禁止盲目恢复或重复派发。</p>}</Notice>}
      {selection?.routingDecision?<RoutingDecision decision={selection.routingDecision}/>:<p className="muted">历史运行未记录自动路由依据。</p>}
      <h3>验证证据</h3><p>{run.verification?.state??"未提供"} · {run.verification?.summary??"没有验证摘要"}</p><Lines items={run.verification?.commands}/></>}
      </section>
      <section className="detail-section"><h3>{frozenContract?"运行冻结契约":"任务契约"}</h3>{contract?<><p>{contract.goal}</p><h4>验收条件</h4><Lines items={contract.acceptanceCriteria}/><h4>允许修改范围</h4><Lines items={contract.scope}/><h4>约束</h4><Lines items={contract.constraints} empty="未登记额外约束"/>{Boolean(contract.referenceLinks?.length)&&<><h4>参考链接</h4>{contract.referenceLinks?.map(link=>safeLink(link)?<p key={link}><a href={safeLink(link)} target="_blank" rel="noreferrer">{link}</a></p>:<p key={link}>历史链接不可打开</p>)}</>}</>:<p>此记录没有可用的冻结契约。</p>}</section>
      <section className="detail-section"><h3>交付与修改文件</h3>{result.isFetching?<p role="status">正在读取结果…</p>:result.data?<><p>{result.data.result.worktree} · {result.data.result.branch}</p><Lines items={result.data.result.files} empty="没有文件变更"/></>:result.error instanceof ApiError&&result.error.code==="RUN_RESULT_UNAVAILABLE"?<p>尚无本地结果回执。</p>:result.error?<Notice tone="error">结果读取失败。<button onClick={()=>void result.refetch()}>重试读取结果</button></Notice>:<p>运行结束后读取本地结果。</p>}{data.deliveries?.filter(delivery=>!runId||delivery.runId===runId).map(delivery=><p key={delivery.id}>{delivery.kind} · {delivery.state}{safeLink(delivery.url)&&<> · <a href={safeLink(delivery.url)} target="_blank" rel="noreferrer">查看交付</a></>}</p>)}<Notice>Run 完成、验证通过与任务验收分别记录；任务为 REVIEW 时仍需人工验收。</Notice></section>
      <TaskActions key={`${id}:${data.revision}:${currentId}:${activeRun?.state}:${activeRun?.lastActivityAt}`} task={task} {...(actionsRun?{run:actionsRun}:{})} profiles={profiles} refresh={reload} publicationTask={Boolean(data.executionIntent)}/>
    </>}
    {task&&<><button disabled={busy||!data||(!task.archivedAt&&Boolean(data.runs?.some(entry=>!terminalStates.has(entry.state))))} onClick={()=>void archive()}>{busy?"处理中…":task.archivedAt?"恢复到当前项目":"归档任务"}</button><p className="muted">归档保留全部执行记录；存在未结束运行时不能归档。</p></>}
    {message&&<p role="status">{message}</p>}
  </Drawer>;
}
