import { lazy, Suspense, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, subscribeToEvents, type ConfigResponse, type RunnerSummary } from "./api.js";
import { Drawer } from "./Drawer.js";
import { EmptyState, Icon, Notice } from "./ui.js";
import { stateLabel } from "./task-view.js";
const SettingsPage = lazy(() => import("./SettingsPage.js"));
interface RunnerConfig { id:string; displayName:string; mode:string; capacity:number; tags:string[] }
interface Config {runners:RunnerConfig[];agentProfiles:Array<{id:string;runnerId:string}>}
export default function DevicesPage(): React.JSX.Element {
  const config = useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<Config>>("/api/config")});
  const registry = useQuery({queryKey:["runners"],queryFn:()=>api<{runners:RunnerSummary[]}>("/api/runners")});
  useEffect(()=>subscribeToEvents(()=>void registry.refetch()),[registry.refetch]);
  const [editor, setEditor] = useState(false);
  const [selected, setSelected] = useState<RunnerConfig>();
  const [action, setAction] = useState<"enrollment"|"rotate"|"revoke">("enrollment");
  const [receipt, setReceipt] = useState<{token?:string;expiresAt?:string;revoked?:boolean}>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (config.isLoading) return <div className="page-state" role="status">正在读取设备配置…</div>;
  if (config.error || !config.data) return <div className="page-state error" role="alert">设备配置读取失败。<button onClick={() => void config.refetch()}>重试</button></div>;
  const configured = config.data.config.runners ?? [];
  const live = registry.data?.runners ?? [];
  const ids = [...new Set([...configured.map((entry)=>entry.id),...live.map((entry)=>entry.id)])];
  async function manage(): Promise<void> {
    if (!selected || busy) return; setBusy(true);setMessage("");
    try {
      const suffix=action === "enrollment" ? "enrollment" : `credential/${action}`;
      setReceipt(await api(`/api/runners/${encodeURIComponent(selected.id)}/${suffix}`,{method:"POST"}));
      await registry.refetch();
    } catch(error) {setMessage(error instanceof Error ? error.message : "设备操作失败");} finally {setBusy(false);}
  }
  function open(entry:RunnerConfig,next:typeof action):void {setSelected(entry);setAction(next);setReceipt(undefined);setMessage("");}
  return <section><header className="page-header"><div><h1>设备管理</h1><p>管理执行节点，查看连接状态与并发容量。</p></div><div className="page-actions"><button disabled={registry.isFetching} onClick={()=>void registry.refetch()}><Icon name="refresh"/>刷新状态</button><button className="primary" onClick={()=>setEditor(true)}><Icon name="plus"/>登记与编辑设备</button></div></header>
    <Notice>设备在线仅代表心跳可达。Harness 安装、认证、模型与项目上下文仍需分别验证。</Notice>
    {registry.error && <Notice tone="error">实时连接状态读取失败。已登记配置仍可查看，当前状态未知。</Notice>}
    <div className="device-grid">{ids.map((id)=>{const entry=configured.find((runner)=>runner.id===id);const runtime=live.find((runner)=>runner.id===id);return <article className="panel device-card" key={id}><header><span className="device-symbol"><Icon name="device" size={25}/></span><div><h2>{entry?.displayName ?? runtime?.displayName ?? id}</h2><small>{entry?.mode === "embedded" ? "本机内嵌" : entry?.mode === "remote" ? "远程节点" : "未登记"}</small></div><span className={`status status-${runtime?.state.toLowerCase() ?? "unknown"}`}>{registry.error || registry.isLoading ? "状态未知" : runtime ? stateLabel(runtime.state) : "尚未连接"}</span></header><dl className="details-grid"><div><dt>并发槽位</dt><dd>{entry?.capacity ?? runtime?.capacity ?? "未提供"}</dd></div><div><dt>绑定账号</dt><dd>{(config.data.config.agentProfiles ?? []).filter((profile)=>profile.runnerId===id).length} 个</dd></div><div><dt>平台</dt><dd>{runtime ? `${runtime.platform} / ${runtime.architecture}` : "未上报"}</dd></div><div><dt>最近心跳</dt><dd>{runtime?.lastSeenAt ? new Date(runtime.lastSeenAt).toLocaleString() : "未收到"}</dd></div></dl><div className="tag-list">{entry?.tags.map((tag)=><span className="pill" key={tag}>{tag}</span>)}</div><details><summary>设备能力</summary><p>{runtime?.capabilities.join("、") || "尚无运行时能力证据"}</p></details><footer className="page-actions"><button onClick={()=>setEditor(true)}>编辑配置</button>{entry?.mode === "remote" && <><button onClick={()=>open(entry,"enrollment")}>登记令牌</button><button onClick={()=>open(entry,"rotate")}>轮换</button><button onClick={()=>open(entry,"revoke")}>撤销访问</button></>}</footer></article>;})}</div>
    {!ids.length && <EmptyState title="尚未登记执行设备" icon="device"><p>先登记设备配置，再连接对应的 Runner。</p><button onClick={()=>setEditor(true)}>登记设备</button></EmptyState>}
    {editor && <Drawer title="设备配置" onClose={()=>setEditor(false)}><Suspense fallback={<p>正在读取配置编辑器…</p>}><SettingsPage sectionId="runners" embedded/></Suspense></Drawer>}
    {selected && <Drawer title={`${selected.displayName} · ${action === "enrollment" ? "远程登记" : action === "rotate" ? "轮换凭据" : "撤销访问"}`} onClose={()=>{setSelected(undefined);setReceipt(undefined);}}><Notice tone="warning">{action === "enrollment" ? "令牌仅用于指定设备登记，签发不代表安装或连接完成。关闭后不会保留令牌。" : "此操作会撤销当前设备凭据并使现有连接失效，可能影响正在运行的任务。"}</Notice>{!receipt ? <button disabled={busy} className="primary" onClick={()=>void manage()}>{busy ? "处理中…" : action === "enrollment" ? "签发一次性登记令牌" : action === "rotate" ? "确认撤销并签发新令牌" : "确认撤销设备访问"}</button> : receipt.token ? <><label>一次性登记令牌<input value={receipt.token} readOnly autoComplete="off"/></label><p className="muted">有效期至 {receipt.expiresAt ? new Date(receipt.expiresAt).toLocaleString() : "服务端未提供"}。请只交给指定设备。</p></> : <p role="status">{receipt.revoked ? "设备访问已撤销。" : "操作已返回，请刷新状态核对。"}</p>}{message && <p role="alert">{message}</p>}</Drawer>}
  </section>;
}
