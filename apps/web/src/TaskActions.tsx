import {Link} from "react-router-dom";
import { useState, type FormEvent } from "react";
import type { FleetTaskInput, FleetRunInput, FleetProfileInput } from "@dispatcher/fleet";
import { api,ApiError } from "./api.js";
import { terminalStates } from "./task-view.js";
interface Workflow { id: string; revision: number; state: string; toolName: string; questions: string[] }
interface PendingInput {inputId:string;message:string;sessionId:string;authority:{runId:string;generation:number;leaseId:string;taskRevision:number;lastActivityAt?:string};unknown?:boolean}
function readInputDraft(key:string):PendingInput|undefined{try{const value=JSON.parse(sessionStorage.getItem(key)??"null") as PendingInput|null;return value&&typeof value.inputId==="string"&&typeof value.message==="string"&&typeof value.sessionId==="string"&&value.authority?.runId?value:undefined;}catch{return;}}

/** Mutations use existing Controller commands and durable approval revisions. */
export function TaskActions({ task, run, profiles, refresh, publicationTask }: { task: FleetTaskInput; run?: FleetRunInput; profiles: FleetProfileInput[]; refresh: () => Promise<unknown>;publicationTask?:boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [message, setMessage] = useState("");
  const inputKey=`dispatcher-run-input:${task.id}:${run?.id??"none"}`;
  const [pendingInput,setPendingInput]=useState<PendingInput|undefined>(()=>readInputDraft(inputKey));
  const [answer, setAnswer] = useState(()=>readInputDraft(inputKey)?.message??"");
  const [workflow, setWorkflow] = useState<Workflow>();
  function rememberInput(input:PendingInput|undefined):void{setPendingInput(input);try{if(input)sessionStorage.setItem(inputKey,JSON.stringify(input));else sessionStorage.removeItem(inputKey);}catch{/* Server receipts still fence the waiting episode if browser storage is unavailable. */}}
  async function sendInput(input:PendingInput):Promise<void>{
    try{await api(`/api/agents/profiles/${encodeURIComponent(run!.profileId)}/sessions/${encodeURIComponent(input.sessionId)}/input`,{method:"POST",body:JSON.stringify({inputId:input.inputId,message:input.message,authority:input.authority})});rememberInput(undefined);setAnswer("");setMessage("回复已发送到原 Agent 会话。");await refresh();}
    catch(error){if(error instanceof ApiError&&error.code==="INPUT_OUTCOME_UNKNOWN")rememberInput({...input,unknown:true});throw error;}
  }
  async function checkInput():Promise<void>{
    if(!pendingInput||!run||busy)return;setBusy(true);
    try{const {receipt}=await api<{receipt:{state:string}}>(`/api/runs/${encodeURIComponent(run.id)}/inputs/${encodeURIComponent(pendingInput.inputId)}`);
      if(receipt.state==="ACCEPTED"){rememberInput(undefined);setAnswer("");setMessage("服务端已确认原回复，无需再次发送。");await refresh();}
      else{if(receipt.state==="OUTCOME_UNKNOWN")rememberInput({...pendingInput,unknown:true});setMessage(receipt.state==="OUTCOME_UNKNOWN"?"回复结果未确认，请先核对原生会话；不会自动再次发送。":"原回复仍在处理中，请稍后核对。");}
    }catch(error){setMessage(error instanceof ApiError&&error.status===404?"服务端尚无回执，可以重试同一回复。":error instanceof Error?error.message:"回执查询失败");}finally{setBusy(false);}
  }
  async function prepare(action: string, target: string, kind: "task" | "run"): Promise<void> {
    if (busy) return;
    setBusy(true); setWorkflow(undefined); setMessage("正在校验操作…");
    try {
      const result = await api<{ workflow: Workflow }>("/api/assistant/workflows", { method: "POST", body: JSON.stringify({ intent: { version: 2, action, entities: [{kind, value: target, id: target}], arguments: {target, ...(action === "task.dispatch" && profileId ? {profileId} : {})}, confidence: 1, source: "ui", ...(kind === "task" && task.revision !== undefined ? {expectedRevision: task.revision} : {}) } }) });
      setWorkflow(result.workflow); setMessage("请确认目标和操作后继续。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作计划失败"); }
    finally { setBusy(false); }
  }
  async function act(action: "approve" | "execute"): Promise<void> {
    if (!workflow || busy) return;
    setBusy(true);
    try {
      const result = await api<{ workflow: Workflow }>(`/api/assistant/workflows/${encodeURIComponent(workflow.id)}/${action}`, { method: "POST", body: JSON.stringify({ revision: workflow.revision }) });
      setWorkflow(result.workflow); setMessage(action === "approve" ? "已确认计划，点击执行提交操作。" : "操作已提交，状态由服务端更新。");
      if (action === "execute") await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请刷新后重试"); }
    finally { setBusy(false); }
  }
  async function reply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!run || busy || !answer.trim()) return;
    setBusy(true);
    try {
      if(pendingInput){await sendInput(pendingInput);return;}
      const currentTask = await api<{ revision: number; document: { currentRunId?: string } }>(`/api/tasks/${encodeURIComponent(task.id)}`);
      if (currentTask.document.currentRunId !== run.id || currentTask.revision !== task.revision) throw new Error("当前运行已改变，请刷新后重新回复。");
      const current = await api<{ run: { state: string; sessionId: string; profileId: string; generation: number; leaseId: string; lastActivityAt?: string } }>(`/api/runs/${encodeURIComponent(run.id)}`);
      if (current.run.state !== "WAITING_USER" || current.run.profileId !== run.profileId || current.run.lastActivityAt !== run.lastActivityAt) throw new Error("当前运行已不再等待回复，请刷新后检查。");
      const input:PendingInput={inputId:crypto.randomUUID(),message:answer,sessionId:current.run.sessionId,authority:{runId:run.id,generation:current.run.generation,leaseId:current.run.leaseId,taskRevision:currentTask.revision,...(current.run.lastActivityAt?{lastActivityAt:current.run.lastActivityAt}:{})}};
      rememberInput(input);await sendInput(input);
    } catch (error) { setMessage(error instanceof Error ? error.message : "回复失败"); }
    finally { setBusy(false); }
  }
  return <div className="workflow-card"><h3>任务操作</h3>
    {task.state==="NEEDS_SPEC"&&!task.archivedAt&&publicationTask&&<Link className="button-link" to={`/publish?task=${encodeURIComponent(task.id)}`}>完善并审阅现有任务</Link>}
    {task.state === "READY" && !task.archivedAt && (publicationTask?<Link className="button-link" to={`/publish?task=${encodeURIComponent(task.id)}`}>审阅并派发现有任务</Link>:<><label>执行账号<select disabled={busy} value={profileId} onChange={(event) => {setProfileId(event.target.value); setWorkflow(undefined);}}><option value="">自动选择可用账号</option>{profiles.filter((profile) => profile.state === "CONFIGURED").map((profile) => <option key={profile.id} value={profile.id}>{profile.alias} · {profile.provider}</option>)}</select></label><button disabled={busy} onClick={() => void prepare("task.dispatch", task.id, "task")}>派发任务</button></>)}
    {run && !terminalStates.has(run.state) && <div className="secure-actions"><button disabled={busy} onClick={() => void prepare("task.cancel", task.id, "task")}>取消任务…</button>{["RESOURCE_BLOCKED", "RUNNER_UNAVAILABLE", "SUSPECTED_STALL"].includes(run.state) && <button disabled={busy} onClick={() => void prepare("run.resume", run.id, "run")}>恢复运行…</button>}</div>}
    {run?.state === "WAITING_USER" && <form onSubmit={(event) => void reply(event)}><label>回复 Agent 的决策请求<textarea disabled={busy||Boolean(pendingInput)} value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label><button className="primary" disabled={busy || !answer.trim()||pendingInput?.unknown} type="submit">{pendingInput?"重试同一回复":"发送回复并继续"}</button></form>}
    {pendingInput&&<div className="notice"><p>已保留原回复及回执编号。请核对发送结果后再继续。</p><button disabled={busy} onClick={()=>void checkInput()}>核对上次回复</button></div>}
    {workflow && <div className="workflow-card"><strong>{workflow.toolName}</strong><small>目标：{task.title} · {task.id}</small>{workflow.questions.map((question) => <p key={question}>{question}</p>)}{workflow.state === "NEEDS_APPROVAL" && <button disabled={busy} onClick={() => void act("approve")}>确认本次操作</button>}{workflow.state === "READY" && <button disabled={busy} className="primary" onClick={() => void act("execute")}>执行已确认操作</button>}<small>{workflow.state}</small></div>}
    <p role="status">{busy ? "处理中…" : message || "所有操作由服务端校验权限与当前任务状态。"}</p>
  </div>;
}
