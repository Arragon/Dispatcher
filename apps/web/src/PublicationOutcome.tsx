import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PublicationReceipt } from "@dispatcher/domain";
import { api } from "./api.js";
import { Notice } from "./ui.js";
const labels:Record<PublicationReceipt["state"],string>={TASK_CREATED:"任务已创建",STARTING:"正在启动",STARTED:"原生执行已启动",START_FAILED:"启动失败，任务已保留",OUTCOME_UNKNOWN:"执行结果未知，请核查现有任务"};
export function PublicationOutcome({receipt,existingTask=false}:{receipt:PublicationReceipt;existingTask?:boolean}):React.JSX.Element {
  const run=useQuery({queryKey:["publication-run",receipt.runId],queryFn:()=>api<{run:{state:string;verification:{state:string};failureReason?:string}}>(`/api/runs/${receipt.runId}`),enabled:Boolean(receipt.runId),refetchInterval:q=>["COMPLETE","FAILED","CANCELLED"].includes(q.state.data?.run.state??"")?false:2000});
  const result=useQuery({queryKey:["publication-result",receipt.runId],queryFn:()=>api<{result:{worktree:string;branch:string;files:string[]}}>(`/api/runs/${receipt.runId}/result`),enabled:run.data?.run.state==="COMPLETE"});
  return <Notice tone={receipt.state==="START_FAILED"||receipt.state==="OUTCOME_UNKNOWN"?"warning":"neutral"}><strong>{existingTask&&receipt.state==="TASK_CREATED"?"原任务已保存":labels[receipt.state]}</strong><p>任务 ID：{receipt.taskId}{receipt.runId?` · Run：${receipt.runId}`:""}</p>{receipt.message&&<p>{receipt.message}</p>}{run.data&&<p>执行状态：{run.data.run.state} · 验证：{run.data.run.verification.state}{run.data.run.failureReason?` · ${run.data.run.failureReason}`:""}</p>}{result.data&&<><p>结果保留在：{result.data.result.worktree} · {result.data.result.branch}</p><p>修改文件：{result.data.result.files.join("、")||"没有文件变更"} · 等待人工验收</p></>}{(run.error||result.error)&&<p>状态读取失败，请在任务页核查。</p>}<Link to={`/tasks?task=${encodeURIComponent(receipt.taskId)}`}>查看已创建任务</Link></Notice>;
}
