import { useQuery } from "@tanstack/react-query";
import type { AccountModelCatalog } from "@dispatcher/domain";
import { api } from "./api.js";
import { Notice } from "./ui.js";
export interface NativeModelChoice {modelId:string;effort:string;catalogRevision:string;contextFingerprint:string;allowUnconfirmed:boolean}
export const nativeDefaultChoice:NativeModelChoice={modelId:"",effort:"",catalogRevision:"",contextFingerprint:"",allowUnconfirmed:false};
export function NativeModelPicker({profileId,repositoryId,configRevision,value,onChange}:{profileId:string;repositoryId:string;configRevision?:number;value:NativeModelChoice;onChange:(value:NativeModelChoice)=>void}):React.JSX.Element {
  const query=useQuery({queryKey:["native-models",profileId,repositoryId,configRevision],queryFn:()=>api<AccountModelCatalog>(`/api/agents/profiles/${encodeURIComponent(profileId)}/models?repositoryId=${encodeURIComponent(repositoryId)}`),enabled:Boolean(profileId&&repositoryId),retry:false,staleTime:0});
  const catalog=query.data;
  const entry=catalog?.entries?.find(e=>e.id===value.modelId);
  const stale=Boolean(value.modelId&&catalog&&(value.catalogRevision!==catalog.revision||value.contextFingerprint!==catalog.contextFingerprint));
  const choose=(modelId:string)=>{const model=catalog?.entries?.find(e=>e.id===modelId);onChange(modelId&&catalog?{modelId,effort:String(model?.parameterDefaults?.reasoningEffort??""),catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmed:false}:{...nativeDefaultChoice});};
  return <div className="native-model-picker"><div className="label-row"><strong>本次执行模型</strong><button disabled={!profileId||!repositoryId||query.isFetching} onClick={()=>void query.refetch()}>{query.isFetching?"正在读取…":"刷新原生目录"}</button></div>
    <label>原生模型<select value={value.modelId} disabled={!profileId||!repositoryId||query.isFetching} onChange={e=>choose(e.target.value)}><option value="">沿用原生配置 · 不指定模型</option>{value.modelId&&!entry&&<option value={value.modelId} disabled>{value.modelId} · 当前目录不可用</option>}{catalog?.entries?.map(model=><option key={model.id} value={model.id} disabled={!model.selectable||model.access==="denied"||catalog.freshness!=="native-fresh"}>{model.displayName} · {model.id}</option>)}</select></label>
    {!profileId||!repositoryId?<p>选择账号与仓库后读取对应原生目录。</p>:query.error?<Notice tone="warning">原生目录读取失败。<span> 原生配置路径仍需服务端预检。</span></Notice>:catalog?.failure?<Notice tone="warning">{catalog.failure.message}</Notice>:catalog&&<p>{catalog.freshness} · {catalog.source} · {catalog.entries?.length??0} 个模型 · {catalog.fetchedAt}</p>}
    {stale&&<Notice tone="warning">模型目录或执行上下文已变化，请重新选择并审阅。</Notice>}
    {entry&&<><label>思考强度<select value={value.effort} onChange={e=>onChange({...value,effort:e.target.value})}>{entry.parameterOptions.reasoningEffort?.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label><p>模型访问：{entry.access} · 计费：{entry.billing?.mode??"unknown"}</p>{entry.access==="unconfirmed"&&<label className="check-label"><input type="checkbox" checked={value.allowUnconfirmed} onChange={e=>onChange({...value,allowUnconfirmed:e.target.checked})}/>我理解目录列出不代表账号已获访问权限；实际调用可能被拒绝。</label>}</>}
    <p>价格未提供，费用无法估算。此选择仅用于本次发布，不修改账号默认配置。</p>
  </div>;
}
