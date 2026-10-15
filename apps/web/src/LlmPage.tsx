import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { Drawer } from "./Drawer.js";
import { SecureInput } from "./App.js";

type Protocol = "openai-responses" | "openai-chat" | "anthropic-messages" | "azure-openai-v1";
type Role = "command_parser" | "config_assistant" | "runtime_summarizer" | "error_classifier";
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
const roleNames: Record<Role, string> = { command_parser: "命令理解", config_assistant: "配置助手", runtime_summarizer: "运行摘要", error_classifier: "错误分类" };
const roles: Role[] = ["command_parser", "config_assistant", "runtime_summarizer", "error_classifier"];

export default function LlmPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["llm"], queryFn: () => api<LlmView>("/api/llm"), retry: false });
  const [draft, storeDraft] = useState<LlmConfig>();
  const dirty = useRef(false);
  const [drawer, setDrawer] = useState<"endpoint" | "profile" | "review" | { endpointId: string }>();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ id: string; risk: string; requiresConfirmation: boolean; changes: Array<{path: string}> }>();
  function setDraft(next: LlmConfig): void { dirty.current = true; setPlan(undefined); storeDraft(next); }
  const [message, setMessage] = useState("");
  useEffect(() => { if (query.data && !dirty.current) storeDraft(structuredClone(query.data.config)); }, [query.data]);

  async function save(): Promise<void> {
    if (!draft || busy) return;
    setBusy(true); setMessage("正在校验模型配置…");
    try {
      const current = await api<{ config: Record<string, unknown> }>("/api/config");
      const result = await api<{ plan: NonNullable<typeof plan> }>("/api/config/plans", { method: "POST", body: JSON.stringify({ config: { ...current.config, internalLlm: draft }, actor: "local-web" }) });
      setPlan(result.plan); setDrawer("review"); setMessage("请审阅变更后确认应用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "配置校验失败"); }
    finally { setBusy(false); }
  }
  async function apply(): Promise<void> {
    if (!plan || busy) return;
    setBusy(true);
    try {
      await api(`/api/config/plans/${plan.id}/apply`, { method: "POST", body: JSON.stringify({ confirmed: plan.requiresConfirmation }) });
      dirty.current = false; setPlan(undefined); setDrawer(undefined); await query.refetch(); setMessage("模型配置已应用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "应用失败"); }
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
    const profiles = [...draft.profiles.filter((entry) => entry.id !== id), { id, endpointId, model, alias: id, enabled: true }];
    const pool = draft.pools.find((entry) => entry.id === "default") ?? { id: "default", profileIds: [] };
    const nextPool = { ...pool, profileIds: [...pool.profileIds.filter((entry) => entry !== id), id] };
    setDraft({ ...draft, configured: true, profiles, pools: [...draft.pools.filter((entry) => entry.id !== "default"), nextPool], defaultPoolId: "default" });
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
    } catch (error) { setMessage(error instanceof Error ? `${error.message}; previous profile remains active.` : "Switch failed; previous profile remains active."); }
    await query.refetch(); setBusy(false);
  }

  if (query.isLoading) return <div className="page-state">正在读取内部模型…</div>;
  if (query.error || !draft || !query.data) return <div className="page-state error" role="alert">内部模型读取失败。<button onClick={() => void query.refetch()}>重试</button></div>;
  const defaultPool = draft.pools.find((entry) => entry.id === (draft.defaultPoolId ?? "default"));
  return <section>
    <header className="page-header"><div><h1>内部模型</h1><p>为配置助手、命令理解和运行摘要管理模型与连接。</p></div><div className="page-actions"><button disabled={busy} onClick={() => setDrawer("endpoint")}>添加连接</button><button disabled={busy || !draft.endpoints.length} onClick={() => setDrawer("profile")}>添加模型</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : "审阅并保存"}</button></div></header>
    <div className="panel notice" role="status">{message || (query.data.state.mode === "ACTIVE" ? "内部模型已启用，可手动测试连接。" : "尚未启用内部模型，确定性命令仍可使用。")}</div>
    <div className="settings-layout"><div><div className="panel table-wrap"><header className="panel-heading"><h2>连接</h2><span>{draft.endpoints.length}</span></header>{draft.endpoints.length ? <table><thead><tr><th>名称</th><th>协议与地址</th><th>操作</th></tr></thead><tbody>{draft.endpoints.map((endpoint) => <tr key={endpoint.id}><td><strong>{endpoint.id}</strong></td><td>{endpoint.protocol}<small>{endpoint.baseUrl}</small></td><td><div className="secure-actions"><button disabled={busy} onClick={() => setDrawer({endpointId: endpoint.id})}>凭据</button><button disabled={busy} onClick={() => { if (draft.profiles.some((profile) => profile.endpointId === endpoint.id)) {setMessage("请先在设置中调整引用此连接的模型。"); return;} setDraft({...draft, endpoints: draft.endpoints.filter((entry) => entry.id !== endpoint.id)}); }}>移除</button></div></td></tr>)}</tbody></table> : <div className="page-state"><strong>暂无模型连接</strong><p>添加兼容的模型服务地址，凭据通过安全输入单独保存。</p><button disabled={busy} onClick={() => setDrawer("endpoint")}>添加连接</button></div>}</div>
    <div className="panel table-wrap"><header className="panel-heading"><h2>模型与回退顺序</h2><span>{draft.profiles.length}</span></header>{draft.profiles.length ? <table><thead><tr><th>模型</th><th>连接</th><th>健康状态</th><th>操作</th></tr></thead><tbody>{draft.profiles.map((profile) => {const health = query.data.state.healthByProfile[profile.id]; const index = defaultPool?.profileIds.indexOf(profile.id) ?? -1; return <tr key={profile.id}><td><strong>{profile.alias}</strong><small>{profile.model}</small></td><td>{profile.endpointId}</td><td><span className={`status status-${health?.status.toLowerCase() ?? "unknown"}`}>{health?.status ?? "未测试"}</span></td><td><div className="secure-actions"><button aria-label={`${profile.alias} 提前回退顺序`} disabled={busy || index <= 0} onClick={() => moveProfile(profile.id,-1)}>↑</button><button aria-label={`${profile.alias} 延后回退顺序`} disabled={busy || index < 0 || index === (defaultPool?.profileIds.length ?? 0)-1} onClick={() => moveProfile(profile.id,1)}>↓</button><button disabled={busy || !query.data.config.profiles.some((entry) => entry.id === profile.id)} onClick={() => void probe(profile.id)}>测试连接</button></div></td></tr>;})}</tbody></table> : <div className="empty-inline"><strong>暂无模型</strong><p>添加连接后，再选择模型。</p><button disabled={busy || !draft.endpoints.length} onClick={() => setDrawer("profile")}>添加模型</button></div>}</div></div>
    <aside className="panel"><header className="panel-heading"><h2>用途与当前模型</h2></header>{roles.map((role) => <label key={role} className="field-stack">{roleNames[role]}<select disabled={busy} value={query.data.state.activeProfileByRole[role] ?? ""} onChange={(event) => void switchProfile(role,event.target.value)}><option value="">按回退顺序自动选择</option>{query.data.config.profiles.filter((profile) => profile.enabled).map((profile) => <option key={profile.id} value={profile.id}>{profile.alias}</option>)}</select></label>)}<p className="notice">测试和切换使用已保存的配置；草稿需审阅后应用。</p></aside></div>
    {drawer === "endpoint" && <Drawer title="添加模型连接" onClose={() => setDrawer(undefined)}><form onSubmit={addEndpoint}><label>连接 ID<input name="id" required /></label><label>协议<select name="protocol"><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat / Compatible</option><option value="anthropic-messages">Anthropic Messages</option><option value="azure-openai-v1">Azure OpenAI v1</option></select></label><label>服务地址<input name="baseUrl" type="url" placeholder="https://…/v1" required /></label><button className="primary" type="submit">加入草稿</button></form></Drawer>}
    {drawer === "profile" && <Drawer title="添加内部模型" onClose={() => setDrawer(undefined)}><form onSubmit={addProfile}><label>模型别名<input name="id" required /></label><label>连接<select name="endpointId" required><option value="">选择连接</option>{draft.endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.id}</option>)}</select></label><label>模型 ID<input name="model" required /></label><button className="primary" type="submit">加入草稿</button></form></Drawer>}
    {drawer && typeof drawer === "object" && <Drawer title={`${drawer.endpointId} · 安全凭据`} onClose={() => setDrawer(undefined)}><p className="notice">凭据直接存入安全存储，不进入配置草稿。</p><SecureInput namespace="llm" name={drawer.endpointId} label={`${drawer.endpointId} credential`} /></Drawer>}
    {drawer === "review" && plan && <Drawer title="审阅模型配置" onClose={() => setDrawer(undefined)}><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change,index) => <li key={index}>{change.path}</li>)}</ul><p role="status">{message}</p><button className="primary" disabled={busy || !plan.changes.length} onClick={() => void apply()}>确认并应用</button></Drawer>}
  </section>;
}
