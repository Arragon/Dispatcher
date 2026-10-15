import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api,type ConfigResponse } from "./api.js";
import { NativeModelPicker,nativeDefaultChoice } from "./NativeModelPicker.js";
import { Notice,Tabs } from "./ui.js";
const LlmPage=lazy(()=>import("./LlmPage.js"));
export default function ModelsPage():React.JSX.Element {
  const [view,setView]=useState("native"),[profile,setProfile]=useState(""),[repository,setRepository]=useState("");
  const [choice,setChoice]=useState({...nativeDefaultChoice});
  const query=useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<{agentProfiles:Array<{id:string;alias:string;enabled?:boolean}>;repositories:Array<{id:string}>}>>("/api/config")});
  return <section><header className="page-header"><div><h1>模型管理</h1><p>按账号与项目读取原生模型，或配置 Dispatcher 自身的内部模型。</p></div></header><Tabs label="模型类型" value={view} onChange={setView} items={[["native","原生模型目录"],["internal","内部模型与路由"]]}/>{view==="internal"?<Suspense fallback={<p>正在读取内部模型…</p>}><LlmPage/></Suspense>:<article className="panel"><Notice>目录读取不启动推理。权限未确认、价格缺失与不支持的账号会按实际情况显示。</Notice>{query.error&&<Notice tone="error">账号与仓库读取失败。</Notice>}<div className="details-grid"><label>Harness 账号<select value={profile} onChange={e=>{setProfile(e.target.value);setChoice({...nativeDefaultChoice});}}><option value="">选择账号</option>{query.data?.config.agentProfiles.map(p=><option key={p.id} value={p.id} disabled={p.enabled===false}>{p.alias}</option>)}</select></label><label>项目仓库<select value={repository} onChange={e=>{setRepository(e.target.value);setChoice({...nativeDefaultChoice});}}><option value="">选择仓库</option>{query.data?.config.repositories.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</select></label></div><NativeModelPicker key={`${profile}:${repository}`} profileId={profile} repositoryId={repository} {...(query.data?{configRevision:query.data.revision}:{})} value={choice} onChange={setChoice}/></article>}</section>;
}
