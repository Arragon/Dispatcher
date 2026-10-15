import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ConfigResponse } from "./api.js";
import { Drawer } from "./Drawer.js";
import { Icon, Notice } from "./ui.js";
const SettingsPage=lazy(()=>import("./SettingsPage.js"));
export default function PoliciesPage():React.JSX.Element {
  const query=useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<{policies:{highRiskRequiresConfirmation:boolean;rawShellDefault:string}}>>("/api/config")});
  const [editor,setEditor]=useState(false);
  if(query.isLoading)return <div className="page-state" role="status">正在读取执行策略…</div>;
  if(query.error || !query.data)return <div className="page-state error" role="alert">执行策略读取失败。<button onClick={()=>void query.refetch()}>重试</button></div>;
  const policies=query.data.config.policies;
  return <section><header className="page-header"><div><h1>执行策略</h1><p>把审批要求与安全边界放在执行之前。</p></div><button onClick={()=>setEditor(true)}><Icon name="settings"/>编辑策略</button></header><Notice>策略使用已应用配置。任务、账号、设备与模型选择仍须通过各自的执行校验。</Notice><article className="panel"><header className="panel-heading"><h2>执行与确认</h2><span className="pill">版本 {query.data.revision}</span></header><div className="setting-row"><span className="device-symbol"><Icon name="shield" size={22}/></span><div><h3>高风险操作需要确认</h3><p>涉及配置、外部系统或执行权限的操作，按服务端策略审阅。</p></div><span className={`pill ${policies?.highRiskRequiresConfirmation ? "good" : "warning"}`}>{policies?.highRiskRequiresConfirmation ? "已开启" : "未开启"}</span></div><div className="setting-row"><span className="device-symbol"><Icon name="task" size={22}/></span><div><h3>原始 Shell 执行</h3><p>仅使用已登记的验证命令和允许的结构化操作。</p></div><span className="pill">{policies?.rawShellDefault === "deny" ? "默认拒绝" : "未确认"}</span></div></article><article className="panel"><header className="panel-heading"><h2>模型自动路由</h2><span className="pill warning">尚未开放</span></header><p>当前发布草稿使用手动选择。Policy 未命中时不会自动回退到账号默认模型。</p></article>{editor && <Drawer title="执行策略配置" onClose={()=>setEditor(false)}><Suspense fallback={<p>正在准备编辑器…</p>}><SettingsPage sectionId="policies" embedded/></Suspense></Drawer>}</section>;
}
