import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, refreshConfiguration } from "./api.js";
import { Drawer } from "./Drawer.js";
import { SecureInput } from "./App.js";
import { Icon, Notice, Tabs } from "./ui.js";
const SettingsPage = lazy(() => import("./SettingsPage.js"));

type Protocol = "openai-responses" | "openai-chat" | "anthropic-messages" | "azure-openai-v1";
type Role = "command_parser" | "config_assistant" | "runtime_summarizer" | "error_classifier" | "task_classifier";
interface LlmConfig {
  configured: boolean;
  endpoints: Array<{ id: string; protocol: Protocol; baseUrl: string; credentialRef: string }>;
  profiles: Array<{ id: string; endpointId: string; alias: string; model: string; enabled: boolean }>;
  pools: Array<{ id: string; profileIds: string[] }>;
  roleBindings: Array<{ role: Role; poolId: string }>;
  defaultPoolId?: string;
}
interface LlmView {
  revision: number;
  config: LlmConfig;
  state: { mode: "ACTIVE" | "DEGRADED_NO_LLM"; activeProfileByRole: Partial<Record<Role, string>>; healthByProfile: Record<string, { status: string; reason?: string }> };
}
const roleNames: Record<Role, string> = { command_parser: "命令理解", config_assistant: "配置助手", runtime_summarizer: "运行摘要", error_classifier: "错误分类",task_classifier:"任务分类（可选）" };
const roles: Role[] = ["command_parser", "config_assistant", "runtime_summarizer", "error_classifier", "task_classifier"];

export default function LlmPage(): React.JSX.Element {
  const client = useQueryClient();
  const [view, setView] = useState("profiles");
  const [poolEditor, setPoolEditor] = useState(false);
  const query = useQuery({ queryKey: ["llm"], queryFn: () => api<LlmView>("/api/llm"), retry: false });
  const [draft, storeDraft] = useState<LlmConfig>();
  const dirty = useRef(false);
  const baseRevision=useRef<number | undefined>(undefined);
  const [conflict,setConflict]=useState(false);
  const [drawer, setDrawer] = useState<"endpoint" | "profile" | "review" | { endpointId: string }>();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ id: string; risk: string; requiresConfirmation: boolean; changes: Array<{path: string}> }>();
  function setDraft(next: LlmConfig): void { dirty.current = true; setPlan(undefined); storeDraft(next); }
  const [message, setMessage] = useState("");
  useEffect(() => { if (query.data && !dirty.current) {storeDraft(structuredClone(query.data.config));baseRevision.current=query.data.revision;} }, [query.data]);

  async function save(): Promise<void> {
    if (!draft || busy) return;
    setBusy(true); setMessage("正在校验模型配置…");
    try {
      const current = await api<{ revision: number; config: Record<string, unknown> }>("/api/config");
      if (current.revision !== baseRevision.current) throw new Error("配置版本已改变，请重新载入后再编辑。");
      const result = await api<{ plan: NonNullable<typeof plan> }>("/api/config/plans", { method: "POST", body: JSON.stringify({ config: { ...current.config, internalLlm: draft }, baseRevision:baseRevision.current, actor: "local-web" }) });
      setPlan(result.plan); setDrawer("review"); setMessage("请审阅变更后确认应用。");
    } catch (error) { setConflict(true);setMessage(error instanceof Error ? error.message : "配置校验失败"); }
    finally { setBusy(false); }
  }
  async function apply(): Promise<void> {
    if (!plan || busy) return;
    setBusy(true);
    try {
      await api(`/api/config/plans/${plan.id}/apply`, { method: "POST", body: JSON.stringify({ confirmed: plan.requiresConfirmation }) });
      dirty.current = false; setPlan(undefined); setDrawer(undefined); await query.refetch(); await refreshConfiguration(client); setMessage("模型配置已应用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "应用失败");if(error instanceof ApiError&&error.status===409){setConflict(true);setPlan(undefined);setDrawer(undefined);} }
    finally { setBusy(false); }
  }

  function addEndpoint(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft || busy) return;
    const values = new FormData(event.currentTarget);
    const id = String(values.get("id") ?? "").trim();
    const baseUrl = String(values.get("baseUrl") ?? "").trim();
    const protocol = String(values.get("protocol") ?? "openai-responses") as Protocol;
    if (!id || !baseUrl) return;
    if (draft.endpoints.some((entry) => entry.id === id)) { setMessage("连接 ID 已存在，请使用新 ID。"); return; }
    setDraft({ ...draft, endpoints: [...draft.endpoints.filter((entry) => entry.id !== id), { id, baseUrl, protocol, credentialRef: `secret://llm/${id}` }] });
    event.currentTarget.reset(); setDrawer(undefined);
  }

  function addProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft || busy) return;
    const values = new FormData(event.currentTarget);
    const id = String(values.get("id") ?? "").trim();
    const endpointId = String(values.get("endpointId") ?? "");
    const model = String(values.get("model") ?? "").trim();
    if (!id || !endpointId || !model) return;
    if (draft.profiles.some((entry) => entry.id === id)) { setMessage("模型别名已存在，请使用新别名。"); return; }
    const profiles = [...draft.profiles.filter((entry) => entry.id !== id), { id, endpointId, model, alias: id, enabled: true }];
    const poolId = draft.defaultPoolId ?? "default";
    const pool = draft.pools.find((entry) => entry.id === poolId) ?? { id: poolId, profileIds: [] };
    const nextPool = { ...pool, profileIds: [...pool.profileIds.filter((entry) => entry !== id), id] };
    setDraft({ ...draft, configured: true, profiles, pools: [...draft.pools.filter((entry) => entry.id !== poolId), nextPool], defaultPoolId: poolId });
    event.currentTarget.reset(); setDrawer(undefined);
  }

  function moveProfile(profileId: string, offset: -1 | 1): void {
    if (!draft || busy) return;
    const pool = draft.pools.find((entry) => entry.id === (draft.defaultPoolId ?? "default"));
    if (!pool) return;
    const index = pool.profileIds.indexOf(profileId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= pool.profileIds.length) return;
    const profileIds = [...pool.profileIds];
    [profileIds[index], profileIds[target]] = [profileIds[target]!, profileIds[index]!];
    setDraft({ ...draft, pools: draft.pools.map((entry) => entry.id === pool.id ? { ...entry, profileIds } : entry) });
  }

  async function probe(profileId: string): Promise<void> {
    if (busy) return; setBusy(true);
    setMessage(`正在测试 ${profileId}…`);
    try {
      const result = await api<{ health: { status: string; reason?: string } }>(`/api/llm/profiles/${profileId}/test`, { method: "POST" });
      setMessage(`${profileId}: ${result.health.status}${result.health.reason ? ` (${result.health.reason})` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Probe failed."); }
    await query.refetch(); setBusy(false);
  }

  async function switchProfile(role: Role, profileId: string): Promise<void> {
    if (!profileId || busy) return;
    setBusy(true);
    setMessage(`正在切换${roleNames[role]}…`);
    try {
      await api(`/api/llm/roles/${role}/switch`, { method: "POST", body: JSON.stringify({ profileId }) });
      setMessage(`${roleNames[role]}已选择 ${profileId}。`);
    } catch (error) { setMessage(error instanceof Error ? `${error.message}；请重新读取当前选择。` : "Switch failed; previous profile remains active."); }
    await query.refetch(); setBusy(false);
  }

  async function reloadCurrent():Promise<void>{
    if(busy||!window.confirm("重新载入会放弃模型草稿，继续吗？"))return;
    setBusy(true);
    try{const current=await query.refetch();if(current.error||!current.data)throw current.error??new Error("模型配置读取失败");storeDraft(structuredClone(current.data.config));baseRevision.current=current.data.revision;dirty.current=false;setConflict(false);setPlan(undefined);setMessage("已载入当前模型配置。");}
    catch(error){setMessage(error instanceof Error?error.message:"读取失败，模型草稿保留");}finally{setBusy(false);}
  }

  async function resetRole(role:Role):Promise<void>{
    if(busy)return;setBusy(true);
    try{await api(`/api/llm/roles/${role}/reset`,{method:"POST"});await query.refetch();setMessage(`${roleNames[role]}已恢复池顺序，下一次请求按配置选择模型。`);}
    catch(error){setMessage(error instanceof Error?error.message:"恢复自动选择失败");}finally{setBusy(false);}
  }

  if (query.isLoading) return <div className="page-state">正在读取内部模型…</div>;
  if (query.error || !draft || !query.data) return <div className="page-state error" role="alert">内部模型读取失败。<button onClick={() => void query.refetch()}>重试</button></div>;
  const defaultPool = draft.pools.find((entry) => entry.id === (draft.defaultPoolId ?? "default"));
  return <section>
    <header className="page-header"><div><h1>模型管理</h1><p>为命令理解、配置助手和运行摘要配置内部模型。</p></div><div className="page-actions"><button disabled={busy} onClick={()=>setDrawer("endpoint")}><Icon name="link"/>添加连接</button><button disabled={busy || !draft.endpoints.length} onClick={()=>setDrawer("profile")}><Icon name="plus"/>添加模型</button><button className="primary" disabled={busy} onClick={()=>void save()}>{busy ? "处理中…" : "审阅并保存"}</button></div></header>
    <Notice>这里的内部模型服务 Dispatcher 自身，与 Harness 执行任务使用的原生模型独立。测试和切换会调用已保存的模型，可能产生费用。</Notice>
    <Tabs label="Model" items={[["profiles",`内部模型 ${draft.profiles.length}`],["endpoints",`服务连接 ${draft.endpoints.length}`],["pools",`模型池 ${draft.pools.length}`],["roles","用途与路由"]]} value={view} onChange={setView}/>
    <div className="model-status"><span className={`status status-${query.data.state.mode === "ACTIVE" ? "healthy" : "degraded"}`}>{query.data.state.mode === "ACTIVE" ? "内部模型已启用" : "确定性命令模式"}</span><span className="muted">配置版本 {query.data.revision}{dirty.current ? " · 有未应用草稿" : " · 已应用"}</span></div>
    {message && <p className="action-message" role="status">{message}</p>}{conflict&&<button disabled={busy} onClick={()=>void reloadCurrent()}>重新载入当前模型配置</button>}
    {view === "profiles" && <div className="panel table-wrap"><header className="panel-heading"><h2>内部模型</h2><span>配置、健康与实际选择分别记录</span></header>{draft.profiles.length ? <table><thead><tr><th>模型</th><th>服务连接</th><th>派发状态</th><th>健康状态</th><th>操作</th></tr></thead><tbody>{draft.profiles.map((profile)=>{const health=query.data.state.healthByProfile[profile.id];return <tr key={profile.id}><td><div className="account-name"><span className="device-symbol"><Icon name="model"/></span><div><strong>{profile.alias}</strong><small>{profile.model}</small></div></div></td><td>{profile.endpointId}</td><td><span className={`status status-${profile.enabled ? "configured" : "disabled"}`}>{profile.enabled ? "已启用" : "已停用"}</span></td><td><span className={`status status-${health?.status.toLowerCase() ?? "unknown"}`}>{health?.status ?? "未测试"}</span><small>{health?.reason}</small></td><td><button disabled={busy || dirty.current || !query.data.config.profiles.some((entry)=>entry.id===profile.id)} onClick={()=>void probe(profile.id)}>测试连接</button></td></tr>;})}</tbody></table> : <div className="empty-inline"><span className="empty-icon"><Icon name="model" size={24}/></span><strong>为控制台添加一个内部模型</strong><p>先添加服务连接，再选择模型。确定性操作始终可用。</p><button disabled={busy || !draft.endpoints.length} onClick={()=>setDrawer("profile")}>添加内部模型</button></div>}</div>}
    {view === "endpoints" && <div className="panel table-wrap"><header className="panel-heading"><h2>服务连接</h2><span>凭据独立存储</span></header>{draft.endpoints.length ? <table><thead><tr><th>连接名称</th><th>协议</th><th>服务地址</th><th>操作</th></tr></thead><tbody>{draft.endpoints.map((endpoint)=><tr key={endpoint.id}><td><strong>{endpoint.id}</strong></td><td><span className="pill">{endpoint.protocol}</span></td><td className="endpoint-url">{endpoint.baseUrl}</td><td><div className="secure-actions"><button disabled={busy} onClick={()=>setDrawer({endpointId:endpoint.id})}>安全凭据</button><button disabled={busy} onClick={()=>{if(draft.profiles.some((profile)=>profile.endpointId===endpoint.id)){setMessage("请先调整引用此连接的模型。");return;}setDraft({...draft,endpoints:draft.endpoints.filter((entry)=>entry.id!==endpoint.id)});}}>移除</button></div></td></tr>)}</tbody></table> : <div className="empty-inline"><span className="empty-icon"><Icon name="link" size={24}/></span><strong>暂无模型连接</strong><p>连接兼容的模型服务，凭据通过安全输入独立保存。</p><button onClick={()=>setDrawer("endpoint")}>添加连接</button></div>}</div>}
    {view === "pools" && <><div className="section-intro"><div><h2>模型池与回退顺序</h2><p className="muted">从上到下尝试可用模型；顺序调整在审阅后生效。</p></div><button disabled={dirty.current} title={dirty.current ? "请先保存当前草稿" : "编辑已应用配置"} onClick={()=>setPoolEditor(true)}>编辑模型池</button></div>{draft.pools.map((pool)=><article className="panel" key={pool.id}><header className="panel-heading"><h2>{pool.id}</h2>{pool.id === draft.defaultPoolId && <span className="pill">默认模型池</span>}</header>{pool.profileIds.map((id,index)=>{const profile=draft.profiles.find((entry)=>entry.id===id);return <div className="pool-row" key={id}><span className="step-number">{index+1}</span><div><strong>{profile?.alias ?? id}</strong><small>{profile?.model ?? "模型引用未找到"}</small></div>{pool.id === defaultPool?.id && <div className="secure-actions"><button aria-label={`${profile?.alias ?? id} 提前回退顺序`} disabled={busy || index===0} onClick={()=>moveProfile(id,-1)}>↑</button><button aria-label={`${profile?.alias ?? id} 延后回退顺序`} disabled={busy || index===pool.profileIds.length-1} onClick={()=>moveProfile(id,1)}>↓</button></div>}</div>;})}{!pool.profileIds.length && <p>池中尚无模型。</p>}</article>)}{!draft.pools.length && <div className="page-state"><strong>暂无模型池</strong><p>添加首个模型时建立默认池，也可编辑完整配置。</p></div>}</>}
    {view === "roles" && <><div className="role-grid">{roles.map((role)=><article className="panel role-card" key={role}><Icon name={role === "config_assistant" ? "spark" : role === "error_classifier" ? "pulse" : "model"} size={24}/><h2>{roleNames[role]}</h2><p>{role === "command_parser" ? "把自然语言转换成结构化命令。" : role === "config_assistant" ? "理解配置需求并生成可审阅计划。" : role === "runtime_summarizer" ? "汇总执行进展与需要介入的事项。" : role==="task_classifier"?"可选用途：仅将任务文字分类为已定义类型，不授予执行权限。":"分类错误并提供恢复线索。"}</p><label>当前生效模型<select disabled={busy || dirty.current || (role==="task_classifier"&&!query.data.config.roleBindings.some(binding=>binding.role===role))} value={query.data.state.activeProfileByRole[role] ?? ""} onChange={(event)=>void switchProfile(role,event.target.value)}><option value="" disabled>按池顺序自动选择</option>{query.data.config.profiles.filter((profile)=>profile.enabled).map((profile)=><option key={profile.id} value={profile.id}>{profile.alias}</option>)}</select></label><button disabled={busy||!query.data.state.activeProfileByRole[role]} onClick={()=>void resetRole(role)}>恢复池顺序</button><small>模型池：{query.data.config.roleBindings.find((binding)=>binding.role===role)?.poolId ?? (role==="task_classifier"?"未绑定（可选）":query.data.config.defaultPoolId??"未配置")}</small></article>)}</div><Notice>切换失败保留原有效选择。恢复池顺序不会发起推理；下次请求按绑定池和健康状态选择。修改默认池与用途绑定请通过配置计划。</Notice></>}
    {drawer === "endpoint" && <Drawer title="添加模型连接" onClose={() => setDrawer(undefined)}><form onSubmit={addEndpoint}><label>连接 ID<input name="id" required /></label><label>协议<select name="protocol"><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat / Compatible</option><option value="anthropic-messages">Anthropic Messages</option><option value="azure-openai-v1">Azure OpenAI v1</option></select></label><label>服务地址<input name="baseUrl" type="url" placeholder="https://…/v1" required /></label><button className="primary" type="submit">加入草稿</button></form></Drawer>}
    {drawer === "profile" && <Drawer title="添加内部模型" onClose={() => setDrawer(undefined)}><form onSubmit={addProfile}><label>模型别名<input name="id" required /></label><label>连接<select name="endpointId" required><option value="">选择连接</option>{draft.endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.id}</option>)}</select></label><label>模型 ID<input name="model" required /></label><button className="primary" type="submit">加入草稿</button></form></Drawer>}
    {drawer && typeof drawer === "object" && <Drawer title={`${drawer.endpointId} · 安全凭据`} onClose={() => setDrawer(undefined)}><p className="notice">凭据直接存入安全存储，不进入配置草稿。</p><SecureInput namespace="llm" name={drawer.endpointId} label={`${drawer.endpointId} credential`} /></Drawer>}
    {drawer === "review" && plan && <Drawer title="审阅模型配置" onClose={() => setDrawer(undefined)}><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change,index) => <li key={index}>{change.path}</li>)}</ul><p role="status">{message}</p><button className="primary" disabled={busy || !plan.changes.length} onClick={() => void apply()}>确认并应用</button></Drawer>}
    {poolEditor && <Drawer title="模型池与用途配置" onClose={()=>setPoolEditor(false)}><Suspense fallback={<p>正在准备编辑器…</p>}><SettingsPage sectionId="internalLlm" embedded/></Suspense></Drawer>}
  </section>;
}
