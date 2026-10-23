import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import type {AccountQuotaState} from "@dispatcher/domain";
import {api} from "./api.js";
import {Notice} from "./ui.js";
type QuotaResponse={quota:AccountQuotaState};
const labels:Record<AccountQuotaState["status"],string>={fresh:"最近账户额度",stale:"账户额度已过期",error:"账户额度读取失败",unsupported:"此工具尚未提供账户周期额度",missing:"尚未采集账户额度"};
function checked(value:QuotaResponse,profileId:string):QuotaResponse {
 if(!value?.quota||value.quota.profileId!==profileId||!Object.hasOwn(labels,value.quota.status))throw Error("账户额度响应无效");return value;
}
export function AccountQuotaPanel({profileId}:{profileId:string}):React.JSX.Element {
 const client=useQueryClient(),query=useQuery({queryKey:["account-quota",profileId],queryFn:async()=>checked(await api<QuotaResponse>(`/api/agents/profiles/${encodeURIComponent(profileId)}/quota`),profileId),retry:false,refetchInterval:60_000});
 const refresh=useMutation({mutationFn:async(id:string)=>checked(await api<QuotaResponse>(`/api/agents/profiles/${encodeURIComponent(id)}/quota/refresh`,{method:"POST",body:"{}"}),id),onSuccess:(value,id)=>{client.setQueryData(["account-quota",id],value);}});
 const state=query.data?.quota,snapshot=state?.snapshot;
 return <section className="detail-section" aria-label="账户周期额度"><h3>账户周期额度</h3><p className="muted">各周期按原生来源分别展示。此处定期读取已保存值；查询按钮会读取当前账号。</p>
  <button disabled={query.isFetching||refresh.isPending||state?.status==="unsupported"} onClick={()=>refresh.mutate(profileId)}>{refresh.isPending?"正在查询原生账户…":"查询原生账户额度"}</button>
  {query.isLoading&&<p role="status">正在读取已保存额度…</p>}{(query.error||refresh.error)&&<Notice tone="error">账户额度读取失败，请重试。</Notice>}
  {state&&<><p role="status">{state.status==="error"&&snapshot?"额度读取失败，以下为最后成功值":labels[state.status]}</p>{state.reasonCode==="QUOTA_CONTEXT_CHANGED"&&<Notice>账号上下文已变化，请重新查询额度。</Notice>}{state.error&&<p>读取结果：{state.error.code}</p>}
   {snapshot&&<><p>来源：{snapshot.source} · 观测时间：{new Date(snapshot.collectedAt).toLocaleString()}{state.lastSuccessAt?` · 最后成功：${new Date(state.lastSuccessAt).toLocaleString()}`:""}</p>{snapshot.periods.length?<div className="table-wrap"><table className="usage-metrics"><thead><tr><th scope="col">周期</th><th scope="col">单位</th><th scope="col">已用</th><th scope="col">剩余</th><th scope="col">总量</th><th scope="col">重置时间</th></tr></thead><tbody>{snapshot.periods.map(period=><tr key={period.id}><td>{period.id}{period.windowDurationMins?` · ${period.windowDurationMins} 分钟`:""}</td><td>{period.unit}</td><td>{period.used??"未提供"}</td><td>{period.remaining??(period.unlimited?"不限额":"未提供")}</td><td>{period.total??"未提供"}</td><td>{period.resetsAt?new Date(period.resetsAt).toLocaleString():"未提供"}</td></tr>)}</tbody></table></div>:<p>原生来源未返回周期数值。</p>}</>}
  </>}
 </section>;
}
