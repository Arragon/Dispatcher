import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountModelCatalog } from "@dispatcher/domain";
import { api, createConfigurationPlan, refreshConfiguration, type ConfigResponse } from "./api.js";
import { NativeModelPicker, nativeDefaultChoice } from "./NativeModelPicker.js";
import { Drawer } from "./Drawer.js";
import { Notice, Tabs } from "./ui.js";
const LlmPage=lazy(()=>import("./LlmPage.js"));
interface ModelConfig extends Record<string,unknown> {agentProfiles:Array<{id:string;alias:string;enabled?:boolean;settings?:Record<string,unknown>}>;repositories:Array<{id:string}>}
interface Plan {id:string;risk:string;requiresConfirmation:boolean;changes:Array<{path:string}>}
export default function ModelsPage():React.JSX.Element {
  const client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const view=params.get("tab")==="internal"?"internal":"native";
  const [profile,setProfile]=useState(params.get("profile")??""),[repository,setRepository]=useState("");
  const [choice,setChoice]=useState({...nativeDefaultChoice});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [plan,setPlan]=useState<Plan>();
  const [reviewTarget,setReviewTarget]=useState("");
  const query=useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<ModelConfig>>("/api/config?view=console")});
  const account=query.data?.config.agentProfiles.find(entry=>entry.id===profile);
  async function planDefault(clear=false):Promise<void>{
    if(!query.data||!account||busy)return;setBusy(true);setMessage("");
    try{
      if(!clear){
        const catalog=await api<AccountModelCatalog>(`/api/agents/profiles/${encodeURIComponent(profile)}/models?repositoryId=${encodeURIComponent(repository)}`);
        const model=catalog.entries?.find(entry=>entry.id===choice.modelId);
        if(catalog.revision!==choice.catalogRevision||catalog.contextFingerprint!==choice.contextFingerprint||catalog.freshness!=="native-fresh"||!model?.selectable||model.access==="denied"||model.access==="unconfirmed"&&!choice.allowUnconfirmed)throw new Error("目录或访问证据已变化，请刷新并重新选择模型。");
      }
      const next=structuredClone(query.data.config);
      const target=next.agentProfiles.find(entry=>entry.id===profile)!;
      target.settings={...target.settings};
      if(clear)delete target.settings.model;else target.settings.model=choice.modelId;
      const built=await createConfigurationPlan(query.data,next);
      setReviewTarget(`${account.alias} · ${clear?"移除覆盖，沿用原生配置":choice.modelId}`);setPlan(built.plan);
    }catch(error){setMessage(error instanceof Error?error.message:"默认模型计划生成失败");}finally{setBusy(false);}
  }
  async function apply():Promise<void>{
    if(!plan||busy)return;setBusy(true);
    try{await api(`/api/config/plans/${encodeURIComponent(plan.id)}/apply?view=console`,{method:"POST",body:JSON.stringify({confirmed:plan.requiresConfirmation})});setPlan(undefined);setChoice({...nativeDefaultChoice});await refreshConfiguration(client);setMessage("账号默认模型已应用，已有 Run 保留原选择。");}
    catch(error){setMessage(error instanceof Error?error.message:"应用失败");}finally{setBusy(false);}
  }
  return <section><header className="page-header"><div><h1>模型管理</h1><p>按账号与项目读取原生模型，或配置 Dispatcher 自身的内部模型。</p></div></header><Tabs label="模型类型" value={view} onChange={tab=>setParams(previous=>{const next=new URLSearchParams(previous);next.set("tab",tab);return next;})} items={[["native","原生模型目录"],["internal","内部模型与路由"]]}/>{view==="internal"?<Suspense fallback={<p>正在读取内部模型…</p>}><LlmPage/></Suspense>:<article className="panel"><Notice>目录读取不启动推理。权限未确认、价格缺失与不支持的账号会按实际情况显示。</Notice>{query.isLoading&&<p role="status">正在读取账号与仓库…</p>}{query.error&&<Notice tone="error">账号与仓库读取失败。<button onClick={()=>void query.refetch()}>重试读取</button></Notice>}
    {query.data&&<>{!query.data.config.agentProfiles.length&&<p>尚无账号，<Link to="/harnesses">接入 Harness</Link>。</p>}{!query.data.config.repositories.length&&<p>尚无仓库，<Link to="/repositories">登记项目仓库</Link>。</p>}</>}
    <fieldset className="catalog-controls" disabled={busy}><div className="details-grid"><label>Harness 账号<select disabled={busy||query.isLoading} value={profile} onChange={event=>{setProfile(event.target.value);setChoice({...nativeDefaultChoice});setPlan(undefined);setMessage("");}}><option value="">选择账号</option>{query.data?.config.agentProfiles.map(entry=><option key={entry.id} value={entry.id} disabled={entry.enabled===false}>{entry.alias}{entry.enabled===false?"（已停用）":""}</option>)}</select></label><label>项目仓库<select disabled={busy||query.isLoading} value={repository} onChange={event=>{setRepository(event.target.value);setChoice({...nativeDefaultChoice});setPlan(undefined);}}><option value="">选择仓库</option>{query.data?.config.repositories.map(entry=><option key={entry.id} value={entry.id}>{entry.id}</option>)}</select></label></div>
    <NativeModelPicker key={`${profile}:${repository}`} profileId={profile} repositoryId={repository} {...(query.data?{configRevision:query.data.revision}:{})} value={choice} onChange={next=>{setChoice(next);setPlan(undefined);}}/>
    {account&&<section className="detail-section"><h3>账号默认配置</h3><p>已保存模型：{typeof account.settings?.model==="string"?account.settings.model:"沿用原生配置"}</p><p className="muted">默认模型通过配置计划保存；这里只保存模型 ID。思考强度等参数在发布任务时单次选择。</p><div className="secure-actions"><button disabled={busy||!choice.modelId} onClick={()=>void planDefault()}>将所选模型设为账号默认…</button><button disabled={busy||!account.settings?.model} onClick={()=>void planDefault(true)}>移除默认模型覆盖…</button><Link className="button-link" to={`/publish?profile=${encodeURIComponent(profile)}${repository?`&repository=${encodeURIComponent(repository)}`:""}`}>前往发布任务</Link></div></section>}
    </fieldset>{message&&<p role="status">{message}</p>}
    {plan&&<Drawer title="审阅账号默认模型" onClose={()=>{if(!busy)setPlan(undefined);}}><p>{reviewTarget}</p><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change,index)=><li key={index}>{change.path}</li>)}</ul><Notice>此配置影响后续运行。当前和历史 Run 的冻结选择保持不变。</Notice><button className="primary" disabled={busy||!plan.changes.length} onClick={()=>void apply()}>确认并应用默认模型</button>{message&&<p role="alert">{message}</p>}</Drawer>}
    </article>}</section>;
}
