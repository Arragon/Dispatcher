import {useEffect,useRef,useState} from "react";
import type {LocalResultReview as Review,LocalVerificationRequest,LocalAcceptanceRequest,Run} from "@dispatcher/domain";
import {api,ApiError} from "./api.js";
import {Notice} from "./ui.js";
type Pending={version:1;runId:string;kind:"verify";body:LocalVerificationRequest}|{version:1;runId:string;kind:"accept";body:LocalAcceptanceRequest};
const storageKey=(id:string)=>`dispatcher-local-review:${id}`;
function restored(id:string):Pending|undefined {try{const raw=sessionStorage.getItem(storageKey(id));if(!raw||raw.length>8192)return;const value=JSON.parse(raw) as Pending;if(value.version===1&&value.runId===id&&["verify","accept"].includes(value.kind)&&typeof value.body?.idempotencyKey==="string"&&value.body.confirmed===true)return value;}catch{/* Server receipts still prevent replay when browser storage is unavailable. */}}
const messages:Record<Review["state"],string>={unverified:"当前候选尚无可用于接受的验证。",verified:"当前候选与验证时的内容一致。",changed:"候选已变化，旧验证不能用于接受。",failed:"本次候选验证未通过。",running:"正在执行已登记的验证。",unknown:"验证结果待核对；不会自动重新执行。",accepted:"当前候选已人工接受。",unavailable:"当前候选暂不可验收，请先核对运行与验证上下文。"};
export function LocalResultReview({run,taskRevision,taskState,view,refresh}:{run:Pick<Run,"id"|"generation"|"leaseId">;taskRevision:number;taskState:string;view?:Review|undefined;refresh:()=>Promise<unknown>}):React.JSX.Element {
 const [pending,setPending]=useState<Pending|undefined>(()=>restored(run.id)),[busy,setBusy]=useState(false),[cancelBusy,setCancelBusy]=useState(false),[message,setMessage]=useState(""),[confirmedFor,setConfirmedFor]=useState("");const lock=useRef(false);
 const matches=view?.version===1&&view.runId===run.id&&view.authority?.taskRevision===taskRevision&&view.authority.generation===run.generation&&view.authority.leaseId===run.leaseId;
 const confirmation=JSON.stringify([run.id,run.generation,run.leaseId,taskRevision,view?.candidate?.id,view?.verification?.id,view?.authority?.controlEpoch,view?.authority?.controlRevision]);
 const valid=matches&&taskState==="REVIEW",confirmed=confirmedFor===confirmation;
 function remember(value:Pending|undefined):void {setPending(value);try{if(value)sessionStorage.setItem(storageKey(run.id),JSON.stringify(value));else sessionStorage.removeItem(storageKey(run.id));}catch{/* Durable server receipts remain authoritative. */}}
 useEffect(()=>{if(view?.state==="accepted"&&pending)remember(undefined);},[view?.state,pending]);
 useEffect(()=>{if(view?.state!=="running"&&!(pending?.kind==="verify"&&busy))return;let reading=false;const timer=setInterval(()=>{if(reading)return;reading=true;void refresh().catch(()=>undefined).finally(()=>{reading=false;});},1500);return ()=>clearInterval(timer);},[pending?.kind,busy,view?.state,refresh]);
 async function reload():Promise<void>{try{await refresh();setConfirmedFor("");}catch{setMessage("读取结果失败，请重试核对。");}}
 async function submit(request:Pending):Promise<void>{
  if(lock.current)return;lock.current=true;setBusy(true);remember(request);setMessage("");let acknowledged=false;
  try{
   if(request.kind==="accept"){const result=await api<{acceptance:{runId:string;generation:number;candidateId:string;verificationId:string};revision:number}>(`/api/runs/${encodeURIComponent(run.id)}/accept-local-result`,{method:"POST",body:JSON.stringify(request.body)});if(result.acceptance?.runId!==run.id||result.acceptance.generation!==request.body.generation||result.acceptance.candidateId!==request.body.candidateId||result.acceptance.verificationId!==request.body.verificationId||!Number.isSafeInteger(result.revision))throw Error("接受回执未确认");acknowledged=true;remember(undefined);setConfirmedFor("");setMessage("已记录人工接受。");}
   else {const result=await api<{review:Review}>(`/api/runs/${encodeURIComponent(run.id)}/local-verification`,{method:"POST",body:JSON.stringify(request.body)});if(!result.review||result.review.version!==1||result.review.runId!==run.id)throw Error("验证回执未确认");acknowledged=true;if(!["unknown","running"].includes(result.review.state))remember(undefined);setMessage(messages[result.review.state]);}
  }catch(error){
   if(error instanceof ApiError&&error.status<500&&error.code!=="VERIFICATION_OUTCOME_UNKNOWN"){remember(undefined);setConfirmedFor("");setMessage(error.message);}
   else setMessage("操作结果未确认，请核对原请求；不会自动重新提交。");
  }finally{lock.current=false;setBusy(false);}
  try{await refresh();}catch{if(acknowledged)setMessage("操作回执已确认，详情读取失败，请重新读取结果。");}
 }
 function start(kind:"verify"|"accept"):void{
  if(!valid||!view?.candidate||!view.authority||pending||busy)return;
  const body:LocalVerificationRequest={...view.authority,candidateId:view.candidate.id,idempotencyKey:crypto.randomUUID(),confirmed:true};
  if(kind==="accept"){if(!confirmed||view.state!=="verified"||!view.verification)return;void submit({version:1,runId:run.id,kind,body:{...body,verificationId:view.verification.id}});}
  else if(["unverified","verified","changed","failed"].includes(view.state))void submit({version:1,runId:run.id,kind,body});
 }
 async function cancel():Promise<void>{const verification=view?.pendingVerification;if(!verification?.owned||cancelBusy)return;setCancelBusy(true);try{const result=await api<{review:Review}>(`/api/runs/${encodeURIComponent(run.id)}/local-verification/cancel`,{method:"POST",body:JSON.stringify({verificationId:verification.id})});setMessage(result.review.state==="unknown"?messages.unknown:"本次验证已结束。");await refresh();}catch{setMessage("停止结果未确认，请重新读取验证状态。");}finally{setCancelBusy(false);}}
 const canVerify=valid&&Boolean(view?.candidate)&&Boolean(view&&["unverified","verified","changed","failed"].includes(view.state))&&!busy&&!pending&&!cancelBusy;
 const canAccept=valid&&view?.state==="verified"&&confirmed&&!busy&&!pending&&!cancelBusy;
 return <section className="detail-section" aria-label="本地结果与验收"><h3>本地结果与验收</h3>
 {!view?<Notice>尚无当前候选的验收状态，请重新读取结果。</Notice>:<><p>{messages[view.state]}</p>{view.candidate&&<><p className="muted">候选 <code>{view.candidate.id}</code></p><ul className="detail-list">{view.candidate.files.map(file=><li key={file}>{file}</li>)}</ul></>}{view.verification&&<p>候选验证：{view.verification.commandIds.join("、")} · {new Date(view.verification.verifiedAt).toLocaleString()}</p>}{view.acceptance&&<p>接受记录：{view.acceptance.actor} · {new Date(view.acceptance.acceptedAt).toLocaleString()}</p>}{view.reasonCode&&<details><summary>核对原因</summary><code>{view.reasonCode}</code></details>}</>}
 <p className="muted">验证会保留内容快照，并核对执行工作区在验证前后的内容。人工接受针对这份候选。</p>
 {view?.state!=="accepted"&&<label className="check-label"><input type="checkbox" checked={confirmed} disabled={!valid||view?.state!=="verified"||busy||Boolean(pending)} onChange={event=>setConfirmedFor(event.target.checked?confirmation:"")}/>我已检查当前候选文件与验证记录</label>}
 <div className="secure-actions"><button disabled={cancelBusy} onClick={()=>void reload()}>重新读取结果</button>{view?.state!=="accepted"&&<><button disabled={!canVerify} onClick={()=>start("verify")}>{busy&&pending?.kind==="verify"?"正在验证…":"验证当前候选"}</button><button disabled={!canAccept} onClick={()=>start("accept")}>接受当前候选</button></>}{view?.runId===run.id&&view.pendingVerification?.owned&&<button disabled={cancelBusy} onClick={()=>void cancel()}>{cancelBusy?"正在停止…":"停止本次验证"}</button>}{pending&&!busy&&<button disabled={cancelBusy||view?.state==="running"} onClick={()=>void submit(pending)}>{pending.kind==="accept"?"重试原接受请求":"重试原验证请求"}</button>}</div>
 {pending&&!busy&&<Notice>存在未核对的{pending.kind==="accept"?"接受":"验证"}请求，请保留原请求标识并核对结果。</Notice>}{message&&<p role="status">{message}</p>}
 </section>;
}
