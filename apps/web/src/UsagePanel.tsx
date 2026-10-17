import {useEffect,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {UsageObservationV1} from "@dispatcher/domain";
import {api,subscribeToEvents} from "./api.js";
import {Notice} from "./ui.js";
interface UsageReport {observations:UsageObservationV1[];totals:Array<{profileId:string;scope:string;name:string;unit:string;value:string}>;errors:Array<{reasonCode:string}>;rangeBasis:string}
const scopeNames:Record<string,string>={turn:"回合",run:"运行",session:"会话","account-period":"账户周期"};
const metricNames:Record<string,string>={input:"输入",output:"输出",cachedInput:"缓存输入",cost:"实际上报费用",remaining:"账户剩余"};
export function UsagePanel({profileId,runId,sessionId}:{profileId?:string;runId?:string;sessionId?:string}):React.JSX.Element{
 const [from,setFrom]=useState(""),[to,setTo]=useState(""),[range,setRange]=useState<{from?:string;to?:string}>({}),[message,setMessage]=useState("");
 const params=new URLSearchParams({...(profileId?{profileId}:{}),...(runId?{runId}:{}),...(sessionId?{sessionId}:{}),...range});
 const query=useQuery({queryKey:["usage",profileId,runId,sessionId,range],queryFn:async()=>{const report=await api<UsageReport>(`/api/usage?${params}`);if(!Array.isArray(report.observations)||!Array.isArray(report.totals)||!Array.isArray(report.errors))throw new Error("用量响应缺少已验证观测结构");return report;},enabled:Boolean(profileId||runId||sessionId),retry:false});
 useEffect(()=>subscribeToEvents(()=>void query.refetch()),[query.refetch]);
 function filter(event:React.FormEvent):void{event.preventDefault();try{const next={...(from?{from:new Date(from).toISOString()}:{}),...(to?{to:new Date(to).toISOString()}:{} )};if(next.from&&next.to&&next.from>next.to)throw new Error("开始时间不能晚于结束时间。");setRange(next);setMessage("");}catch(error){setMessage(error instanceof Error?error.message:"时间范围无效。");}}
 return <section className="detail-section" aria-label="实际用量"><h3>实际用量观测</h3><p className="muted">按观测时间筛选。累计快照取同一范围的最后值，缓存包含于输入时分别展示；账户周期值独立于任务。</p>
  <form className="catalog-controls" onSubmit={filter}><label>观测开始时间<input type="datetime-local" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>观测结束时间<input type="datetime-local" value={to} onChange={event=>setTo(event.target.value)}/></label><button disabled={query.isFetching}>筛选用量</button><button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新已保存观测</button></form>
  {message&&<p role="alert">{message}</p>}{query.isLoading&&<p role="status">正在读取已保存用量…</p>}{query.error&&<Notice tone="error">用量读取失败，请重试。</Notice>}
  {query.data&&<>{query.data.errors.length>0&&<Notice>部分原生用量未能验证：{query.data.errors.map(error=>error.reasonCode).join("、")}</Notice>}{!query.data.observations.length?<p>尚无已验证的原生用量；缺失值不按 0 计算。</p>:<><div className="table-wrap"><table className="usage-metrics"><thead><tr><th scope="col">范围</th><th scope="col">指标</th><th scope="col">数值</th><th scope="col">单位</th></tr></thead><tbody>{query.data.totals.map((metric,index)=><tr key={index}><td>{scopeNames[metric.scope]??metric.scope}</td><td>{metricNames[metric.name]??metric.name}</td><td>{metric.value}</td><td>{metric.unit}</td></tr>)}</tbody></table></div><details><summary>原始规范化观测 · {query.data.observations.length} 条</summary>{query.data.observations.map(observation=><article key={`${observation.sessionId}:${observation.eventId}`}><p>{scopeNames[observation.scope]} · {observation.mode} · {new Date(observation.observedAt).toLocaleString()} · {observation.source}</p>{observation.metrics.map(metric=><p key={metric.name}>{metricNames[metric.name]??metric.name}：{metric.value} {metric.unit}{metric.includedIn?`（已计入 ${metricNames[metric.includedIn]??metric.includedIn}）`:""}</p>)}</article>)}</details></>}
  </>}
  <Notice>费用估算缺少已验证计费基准时不可用。账户余额、Credits、Token 和实际上报费用分别记录。</Notice>
 </section>;
}
