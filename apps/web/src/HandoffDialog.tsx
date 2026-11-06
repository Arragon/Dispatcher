import type { MutationFence, NativeCommandReceipt, SessionControl } from "@dispatcher/domain";
import { useRef, useState } from "react";
import { Drawer } from "./Drawer.js";

/** A projection of the authoritative return report, tied to its reviewed epoch. */
export interface ReturnReview {
  id:string;ready:boolean;code?:string;controlRevision:number;controlEpoch:number;
  identity:string;model:string;workspace:string;permissions:string;queue:string;
}
export interface HandoffDialogProps {
  control:SessionControl;fence:Omit<MutationFence,"commandId">;qualified:boolean;unavailableReason?:string;
  receipt?:NativeCommandReceipt;review?:ReturnReview;
  onClose:()=>void;onViewHistory:()=>void;onRefresh:()=>void;
  onRequestHandoff?:(fence:MutationFence,settlePolicy:"wait"|"interrupt")=>Promise<NativeCommandReceipt>;
  onRequestReturn?:(fence:MutationFence)=>Promise<NativeCommandReceipt>;
  onConfirmReturn?:(input:{fence:MutationFence;reportId:string;action:"continue"|"verify"})=>Promise<void>;
}
export function HandoffDialog(props:HandoffDialogProps):React.JSX.Element {
  // A different Run must not inherit an in-flight command or reviewed report.
  return <HandoffContents key={JSON.stringify([props.control.sessionId,props.control.activeRunId,props.fence.generation,props.fence.leaseId])} {...props}/>;
}
function HandoffContents({control,fence,qualified,unavailableReason,receipt,review,onClose,onViewHistory,onRefresh,onRequestHandoff,onRequestReturn,onConfirmReturn}:HandoffDialogProps):React.JSX.Element {
  const [settlePolicy,setSettlePolicy]=useState<"wait"|"interrupt">("wait");
  const [choice,setChoice]=useState<{reportKey:string;action:"continue"|"verify"}>();
  const [busy,setBusy]=useState(false);
  const [submitted,setSubmitted]=useState<{revision:number;epoch:number;kind:"handoff"|"return"|"confirm";receipt?:NativeCommandReceipt}>();
  const [failure,setFailure]=useState<{revision:number;epoch:number}>();
  const lock=useRef(false);
  const matches=fence.sessionId===control.sessionId&&fence.runId===control.activeRunId&&fence.expectedCurrentRunId===control.activeRunId&&fence.expectedControlRevision===control.revision&&fence.expectedControlEpoch===control.epoch;
  const sameSubmission=submitted?.revision===control.revision&&submitted.epoch===control.epoch;
  const pending=busy||Boolean(sameSubmission)||control.state==="HANDOFF_REQUESTED";
  const failed=Boolean(failure&&!(control.revision>failure.revision&&control.epoch>failure.epoch));
  const handlersReady=Boolean(onRequestHandoff&&onRequestReturn&&onConfirmReturn);
  const blocked=!qualified||!handlersReady||!matches||pending||failed;
  const reportCurrent=review?.controlRevision===control.revision&&review.controlEpoch===control.epoch;
  const canConfirm=control.state==="RECONCILING"&&reportCurrent&&review?.ready;
  const reportKey=JSON.stringify(review?[review.id,review.ready,review.code??null,review.controlRevision,review.controlEpoch,review.identity,review.model,review.workspace,review.permissions,review.queue]:null);
  // A reused report ID cannot retain consent to a different reviewed result, even if it later reverts.
  if(choice&&choice.reportKey!==reportKey)setChoice(undefined);
  const action=choice?.reportKey===reportKey?choice.action:undefined;
  async function submit(kind:"handoff"|"return"|"confirm") {
    if(lock.current||blocked||kind==="confirm"&&(!canConfirm||!action))return;
    lock.current=true;setBusy(true);
    const captured={...fence,commandId:crypto.randomUUID()};
    try {
      if(kind==="confirm") {
        await onConfirmReturn!({fence:captured,reportId:review!.id,action:action!});
        setSubmitted({revision:control.revision,epoch:control.epoch,kind});
      } else {
        const result=await (kind==="handoff"?onRequestHandoff!(captured,settlePolicy):onRequestReturn!(captured));
        if(result.version!==1||result.commandId!==captured.commandId||!["accepted","queued"].includes(result.state))throw new Error("UNCONFIRMED_RECEIPT");
        setSubmitted({revision:control.revision,epoch:control.epoch,kind,receipt:result});
      }
    } catch {setFailure({revision:control.revision,epoch:control.epoch});} finally {lock.current=false;setBusy(false);}
  }
  const accepted=receipt?.state==="accepted"||sameSubmission&&submitted?.receipt?.state==="accepted";
  return <Drawer title="原生会话控制" onClose={onClose}>
    <p role="status">{control.state==="HUMAN"?"已交给你控制":control.state==="AUTOMATED"?"Dispatcher 正在控制此会话":control.state==="RECONCILING"?"正在核对交还条件":control.state==="CONFLICT"?"控制状态冲突":"正在等待控制权交接"}</p>
    <p>{control.exclusion==="native-enforced"?"原生独占锁已生效":control.exclusion==="cooperative"?"协作隔离：请避免同时在其他客户端写入此会话。":"当前没有已验证的独占隔离。"}</p>
    {(!qualified||!handlersReady)&&<p role="alert">{unavailableReason??"此账号的原生控制能力尚未验证，请刷新并核对原生客户端。"}</p>}
    {!matches&&<p role="alert">运行或控制权已变化，请刷新并核对后操作。</p>}
    {failed&&<p role="alert">操作结果未确认，请刷新并核对当前控制权。保留任务正文，不重复发送指令。</p>}
    {busy&&<p role="status">正在提交请求，结果尚未确认…</p>}
    {!busy&&control.state!=="HUMAN"&&(accepted||pending)&&<p role="status">{sameSubmission&&submitted?.kind==="confirm"?"已提交交还确认，等待新的控制快照。":"请求已接受，正在等待控制权；打开原生应用不代表交接完成。"}</p>}
    {control.state==="AUTOMATED"&&<>
      <fieldset disabled={blocked}><legend>手动接管方式</legend>
        <label className="check-label"><input type="radio" name="settle-policy" checked={settlePolicy==="wait"} onChange={()=>setSettlePolicy("wait")}/>等待当前回合结束后接管</label>
        <label className="check-label"><input type="radio" name="settle-policy" checked={settlePolicy==="interrupt"} onChange={()=>setSettlePolicy("interrupt")}/>中断当前回合后接管</label>
      </fieldset>
      <p>{settlePolicy==="wait"?"等待正在进行的命令完成，确认停止写入后交接。":"可能打断正在进行的工作；仍需确认原生写入停止后才能接管。"}</p>
      <button disabled={blocked||receipt?.state==="accepted"} onClick={()=>void submit("handoff")}>请求手动接管</button>
    </>}
    {(control.state==="HUMAN"||control.state==="CONFLICT")&&!review&&<button disabled={blocked} onClick={()=>void submit("return")}>只读核对交还条件</button>}
    {review&&<>
      <dl className="details-grid">{Object.entries({"身份与账号":review.identity,"模型":review.model,"工作目录":review.workspace,"权限":review.permissions,"命令队列":review.queue}).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {(!review.ready||!reportCurrent)&&<p role="alert">交还条件未满足，请刷新并核对原生会话。{review.code?` ${review.code}`:"核对报告已过期。"}</p>}
      {canConfirm&&<><fieldset disabled={blocked}><legend>交还后执行</legend>
        <label className="check-label"><input type="radio" name="return-action" checked={action==="continue"} onChange={()=>setChoice({reportKey,action:"continue"})}/>继续同一原生会话</label>
        <label className="check-label"><input type="radio" name="return-action" checked={action==="verify"} onChange={()=>setChoice({reportKey,action:"verify"})}/>仅运行验证</label>
      </fieldset><p>确认会授予 Dispatcher 新的控制权；核对本身不会发送任务正文。</p><button disabled={blocked||!action} onClick={()=>void submit("confirm")}>确认交还控制</button></>}
    </>}
    <div className="page-actions"><button onClick={onViewHistory}>查看只读历史</button><button disabled={busy} onClick={onRefresh}>刷新控制快照</button></div>
  </Drawer>;
}
