import type {EvidenceState,ProfileConsoleView} from "@dispatcher/domain";
import { lazy, Suspense, useEffect, useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SecureInput } from "./App.js";
import { Drawer } from "./Drawer.js";
import { stateLabel } from "./task-view.js";
import { EmptyState, Icon, Notice, Tabs, ProviderMark } from "./ui.js";
import { api, refreshConfiguration, subscribeToEvents } from "./api.js";
import { Link } from "react-router-dom";
const SettingsPage=lazy(()=>import("./SettingsPage.js"));
interface ProfilePlan {id:string;risk:string;requiresConfirmation:boolean;changes:Array<{path:string}>}

interface Manifest {
  id: string;
  displayName: string;
  platforms: string[];
  configSchema: RJSFSchema;
  uiSchema: UiSchema;
  secretFields: string[];
  backends: Array<{ id: string; kind: string; capabilities: string[] }>;
  capabilities: Record<string, boolean>;
}

interface ProfileView extends Partial<ProfileConsoleView> {
  id: string;
  provider: string;
  alias: string;
  runnerId: string;
  state: string;
  capabilities?: string[];
}

interface CompatibilityRow {
  adapterId: string;
  displayName: string;
  backendId: string;
  backendKind: string;
  capabilities: string[];
  unsupportedReasons: Record<string, string>;
}

interface SessionView {
  id: string;
  runId: string;
  profileId?: string;
  state: string;
  updatedAt: string;
}

function evidenceText(evidence:EvidenceState|undefined,kind:"installation"|"compatibility"|"authentication"="authentication"):string{
  if(!evidence?.observedAt)return "未检查";
  const ready=kind==="authentication"?"登录已验证":kind==="installation"?"已发现安装":"兼容性已验证";
  const labels={ready,missing:kind==="installation"?"未发现安装":"需要原生登录",failed:"检查未通过",unknown:"尚未验证",stale:"已过期，请重新检查",unsupported:"尚未支持"};
  return `${labels[evidence.status]} · ${new Date(evidence.observedAt).toLocaleTimeString()}`;
}

const validator = customizeValidator({ AjvClass: Ajv2020 });

export default function AgentsPage(): React.JSX.Element {
  const client=useQueryClient();
  const [plan,setPlan]=useState<ProfilePlan>();
  const [editor,setEditor]=useState(false);
  const query = useQuery({ queryKey: ["adapter-manifests"], queryFn: () => api<{ manifests: Manifest[] }>("/api/adapters/manifests"), retry: false });
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: () => api<{ revision?:number; profiles: ProfileView[]; sessions: SessionView[] }>("/api/agents/profiles"), retry: false });
  useEffect(()=>subscribeToEvents(()=>void profiles.refetch()),[profiles.refetch]);
  const compatibility = useQuery({ queryKey: ["adapter-compatibility"], queryFn: () => api<{ matrix: CompatibilityRow[] }>("/api/adapters/compatibility"), retry: false });
  const [drawer, setDrawer] = useState<"add" | "trial" | ProfileView>();
  const [view, setView] = useState("accounts");
  const [confirmSave, setConfirmSave] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [pendingProfiles, setPendingProfiles] = useState<Set<string>>(new Set());
  const [loginResults, setLoginResults] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState("generic-cli");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [runProfileId, setRunProfileId] = useState("");
  const [message, setMessage] = useState("账号配置为本地草稿，保存后才会生效。");
  if (query.isLoading || profiles.isLoading) return <div className="page-state">正在读取 Agent 账号…</div>;
  if (query.error || profiles.error || !query.data || !profiles.data) return <div className="page-state error" role="alert"><strong>Agent 账号读取失败</strong><button onClick={() => { void query.refetch(); void profiles.refetch(); }}>重试</button></div>;
  const selected = query.data.manifests.find((manifest) => manifest.id === selectedId) ?? query.data.manifests[0];
  if (!selected) return <div className="page-state">No adapter manifests registered.</div>;
  const activeManifest = selected;
  async function discover(): Promise<void> {
    if (busy) return; setBusy(true);
    setMessage(`正在检查 ${activeManifest.displayName} profile…`);
    try {
      const result = await api<{ authenticated?: boolean; healthy?: boolean; installed?: boolean; version?: string; profile?: { alias: string }; diagnostic?: string; selected?: { authenticated: boolean; version?: string; executable: string }; candidates?: unknown[] }>(`/api/agents/${activeManifest.id}/discover`, { method: "POST", body: JSON.stringify({ ...draft, id: String(draft.id ?? `${activeManifest.id}-profile`) }) });
      const candidate = result.selected ?? result;
      const ready = candidate.authenticated || result.healthy;
      setMessage(ready ? `${String(draft.alias ?? result.profile?.alias ?? activeManifest.displayName)} health check passed (${candidate.version ?? "version unknown"}).` : result.diagnostic ?? (result.installed ? `CLI installed (${candidate.version ?? "version unknown"}); authentication remains unverified.` : `${result.candidates?.length ?? 0} installation candidates found; authentication or an explicit selection is required.`));
    } catch (error) { setMessage(error instanceof Error ? error.message : `${activeManifest.displayName} scan failed.`); } finally { setBusy(false); }
  }
  async function saveProfile(): Promise<void> {
    if (busy) return; setBusy(true); setPlan(undefined);
    try {
      const result=await api<{plan:ProfilePlan}>(`/api/agents/${activeManifest.id}/profiles`,{method:"POST",body:JSON.stringify({...draft,runnerId:String(draft.runnerId??"local"),previewOnly:true,baseRevision:profiles.data?.revision})});
      setPlan(result.plan);setConfirmSave(true);setMessage("计划已生成，确认后才会保存账号。");
    } catch(error){setMessage(error instanceof Error?error.message:"账号计划生成失败");} finally{setBusy(false);}
  }
  async function applyProfile():Promise<void>{
    if(!plan||busy)return;setBusy(true);
    try{await api(`/api/config/plans/${encodeURIComponent(plan.id)}/apply?view=console`,{method:"POST",body:JSON.stringify({confirmed:plan.requiresConfirmation})});setRunProfileId(String(draft.id??""));await refreshConfiguration(client);setPlan(undefined);setConfirmSave(false);setDrawer(undefined);setMessage("账号配置已应用，请单独测试原生登录。");}
    catch(error){setMessage(error instanceof Error?error.message:"应用失败，草稿保留");}finally{setBusy(false);}
  }
  async function setProfileEnabled(profile: ProfileView): Promise<void> {
    if (pendingProfiles.has(profile.id)) return;
    setPendingProfiles((current) => new Set(current).add(profile.id));
    const enabled = profile.state === "DISABLED";
    try {
      await api(`/api/agents/profiles/${profile.id}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) });
      if (!enabled && runProfileId === profile.id) setRunProfileId("");
      await refreshConfiguration(client);
      setMessage(`${profile.alias} dispatch ${enabled ? "enabled. Test login before running a task." : "disabled."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Profile could not be updated."); } finally { setPendingProfiles((current) => { const next = new Set(current); next.delete(profile.id); return next; }); }
  }
  async function testProfile(id: string): Promise<void> {
    if (pendingProfiles.has(id)) return;
    setPendingProfiles((current) => new Set(current).add(id));
    setLoginResults((current) => ({ ...current, [id]: "正在检查登录…" }));
    try {
      const result=await api<{profile?:ProfileView}>(`/api/agents/profiles/${encodeURIComponent(id)}/test`,{method:"POST"});
      if(!result.profile?.authentication?.observedAt)throw new Error("服务端尚未返回可核验的原生登录证据");
      client.setQueryData<{revision?:number;profiles:ProfileView[];sessions:SessionView[]}>(["agent-profiles"],current=>current?{...current,profiles:current.profiles.map(profile=>profile.id===id?result.profile!:profile)}:current);
      setLoginResults(current=>{const next={...current};delete next[id];return next;});

    } catch (error) { setLoginResults((current) => ({ ...current, [id]: error instanceof Error ? error.message : "登录检查失败" })); }
    finally { setPendingProfiles((current) => { const next = new Set(current); next.delete(id); return next; }); }
  }
  const configuredProfiles = profiles.data?.profiles ?? [];
  const selectedCompatibility = compatibility.data?.matrix.filter((row) => row.adapterId === selected.id) ?? [];
  const profileId = typeof draft.id === "string" && draft.id ? draft.id : undefined;
  const secretNamespace = selected.id === "workbuddy-codebuddy"
    ? draft.provider === "workbuddy" || draft.provider === "codebuddy" ? draft.provider : undefined
    : selected.secretFields.includes("credentialRef") ? selected.id : undefined;
  const filtered = configuredProfiles.filter((profile) => (!search || `${profile.alias} ${profile.provider}`.toLowerCase().includes(search.toLowerCase())) && (filter === "all" || (filter === "enabled" ? profile.state !== "DISABLED" : profile.state === "DISABLED")));
  const enabledCount = configuredProfiles.filter((profile) => profile.state !== "DISABLED").length;
  const detailProfile=drawer&&typeof drawer==="object"?(configuredProfiles.find(profile=>profile.id===drawer.id)??drawer):undefined;
  return <section>
    <header className="page-header"><div><h1>Harness</h1><p>接入你的开发工具，让每个账号独立、安全地执行任务。</p></div><div className="page-actions"><button onClick={() => { setMessage(""); setDrawer("trial"); }}><Icon name="pulse"/>试运行</button><button className="primary" onClick={() => { setMessage(""); setDrawer("add"); }}><Icon name="plus"/>添加账号</button></div></header>
    <Tabs label="Harness" items={[["accounts",`已接入账号 ${configuredProfiles.length}`],["catalog",`工具目录 ${query.data.manifests.length}`],["capabilities","能力与兼容性"]]} value={view} onChange={setView}/>
    {view === "accounts" && <>
    <Notice>账号启用、原生登录与资源可用性分别记录。测试登录仅检查所选账号，不会启动开发任务。</Notice>
    <div className="panel table-wrap"><div className="toolbar account-toolbar" style={{padding: "0 16px"}}><input aria-label="搜索账号或 Agent" placeholder="搜索账号或 Agent…" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="segments">{[["all", `全部 ${configuredProfiles.length}`], ["enabled", `已启用 ${enabledCount}`], ["disabled", `已停用 ${configuredProfiles.length - enabledCount}`]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value!)}>{label}</button>)}</div></div>
      <table className="account-table" aria-label="Agent 账号"><thead><tr><th>账号</th><th>Agent</th><th>设备</th><th>派发状态</th><th>最近登录检查</th><th>操作</th></tr></thead><tbody>{filtered.map((profile) => <tr key={profile.id}><td><div className="account-name"><ProviderMark provider={profile.provider}/><strong>{profile.alias}</strong></div></td><td data-label="Agent">{profile.provider}</td><td data-label="设备">{profile.runnerId === "local" ? "本机" : profile.runnerId}</td><td data-label="派发状态"><span className={`status status-${profile.state.toLowerCase()}`}>{stateLabel(profile.state)}</span></td><td data-label="最近登录检查" aria-live="polite">{loginResults[profile.id] ?? evidenceText(profile.authentication)}</td><td><div className="secure-actions"><button disabled={pendingProfiles.has(profile.id)||profile.actions?.test?.allowed===false} title={profile.actions?.test?.message} onClick={() => void testProfile(profile.id)} aria-label={`测试 ${profile.alias} 登录`}>测试登录</button><button onClick={() => {setMessage(""); setDrawer(profile);}} aria-label={`${profile.alias} 详情`}>详情</button></div></td></tr>)}</tbody></table>
      {!filtered.length && <div className="page-state"><strong>{configuredProfiles.length ? "没有匹配的账号" : "暂无 Agent 账号"}</strong><p>{configuredProfiles.length ? "调整搜索或筛选条件。" : "添加当前机器上的 Agent，保留独立账号和原生登录信息。"}</p><button onClick={() => configuredProfiles.length ? (setFilter("all"), setSearch("")) : setDrawer("add")}>{configuredProfiles.length ? "清除筛选" : "添加账号"}</button></div>}
      <footer className="table-footer">显示 {filtered.length} 个账号 · 启用与登录验证分别记录，测试不会改变派发状态</footer>
    </div>
    <div className="panel"><header className="panel-heading"><h2>最近 Agent 会话</h2><span>{profiles.data.sessions.length} 个会话</span></header>{profiles.data.sessions.length ? profiles.data.sessions.map((session) => <article key={session.id} className="runner-row"><div><strong>{configuredProfiles.find((profile) => profile.id === session.profileId)?.alias ?? session.profileId}</strong><p>{session.id} · {session.state}</p></div><small>{new Date(session.updatedAt).toLocaleString()}</small></article>) : <div className="empty-inline"><strong>暂无会话</strong><p>选择已启用的账号进行试运行，运行仍使用受管工作目录。</p><button onClick={() => { setMessage(""); setDrawer("trial"); }}>开始试运行</button></div>}</div>
    </>}
    {view === "catalog" && <><div className="section-intro"><div><h2>选择要接入的工具</h2><p className="muted">来自当前 Controller 的适配器声明，安装与认证需在目标设备单独检查。</p></div></div><div className="catalog-grid">{query.data.manifests.map((manifest) => <article className="catalog-card" key={manifest.id}><div className="catalog-title"><ProviderMark provider={manifest.id}/><div><h3>{manifest.displayName}</h3><small>{manifest.id}</small></div></div><p>{manifest.backends.map((backend) => backend.kind).join(" / ") || "尚无执行后端"}</p><div className="tag-list">{manifest.platforms.map((platform) => <span className="pill" key={platform}>{platform}</span>)}</div><div className="catalog-footer"><span className="muted">{configuredProfiles.filter((profile) => profile.provider === manifest.id).length} 个同名提供方账号</span><button onClick={() => {setSelectedId(manifest.id);setDraft({});setConfirmSave(false);setMessage("");setDrawer("add");}}>接入工具</button></div></article>)}</div></>}
    {view === "capabilities" && <><Notice>能力表来自适配器声明，不代表当前安装版本、账号或设备已经实测通过。</Notice>{compatibility.isLoading ? <div className="page-state" role="status">正在读取能力表…</div> : compatibility.error ? <div className="page-state error" role="alert">能力表读取失败。<button onClick={() => void compatibility.refetch()}>重试</button></div> : <div className="panel table-wrap"><table><thead><tr><th>工具</th><th>执行后端</th><th>声明支持</th><th>限制与未支持原因</th></tr></thead><tbody>{compatibility.data?.matrix.map((row) => <tr key={`${row.adapterId}:${row.backendId}`}><td><strong>{row.displayName}</strong></td><td>{row.backendKind}<small>{row.backendId}</small></td><td><div className="tag-list">{row.capabilities.map((capability) => <span className="pill" key={capability}>{capability}</span>)}</div></td><td>{Object.entries(row.unsupportedReasons).map(([name,reason]) => <p key={name}>{name}：{reason}</p>)}</td></tr>)}</tbody></table>{!compatibility.data?.matrix.length && <EmptyState title="暂无能力声明" icon="plug"/>}</div>}</>}
    {message && !drawer && <p role="status">{message}</p>}
    {drawer === "add" && <Drawer title="添加 Agent 账号" onClose={() => setDrawer(undefined)}><div className="config-form"><label className="field-stack">Agent<select value={selected.id} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setDraft({}); setConfirmSave(false); setMessage(""); }}>{query.data.manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.displayName}</option>)}</select></label><Form schema={selected.configSchema} uiSchema={selected.uiSchema} formData={draft} validator={validator} disabled={busy} onChange={(event) => {setDraft((event.formData ?? {}) as Record<string, unknown>);setConfirmSave(false);setPlan(undefined);}} onSubmit={() => setMessage("草稿已通过校验，尚未保存账号。") }><button type="submit" disabled={busy}>校验草稿</button></Form>
      {secretNamespace && profileId ? <SecureInput namespace={secretNamespace} name={profileId} label={`${selected.displayName} credential`} onStored={(credentialRef) => setDraft((current) => ({ ...current, credentialRef }))} onDeleted={() => setDraft((current) => { const next = { ...current }; delete next.credentialRef; return next; })} /> : selected.secretFields.includes("credentialRef") ? <p className="notice">先填写账号 ID，再安全存储凭据。</p> : null}
      {selected.id !== "generic-mock" && <div className="secure-actions"><button disabled={busy} type="button" onClick={() => void discover()}>扫描并检查</button><button disabled={busy} type="button" className="primary" onClick={() => void saveProfile()}>生成账号配置计划</button></div>}</div>{confirmSave && plan && <div className="workflow-card"><h3>确认账号配置</h3><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change,index)=><li key={index}>{change.path}</li>)}</ul><p>工具：{selected.displayName} · 账号：{String(draft.alias ?? draft.id ?? "未命名")} · 设备：{String(draft.runnerId ?? "local")}</p><p>保存后通过 ConfigPlan 生效；原生登录状态仍需单独测试。</p><button disabled={busy} className="primary" onClick={() => void applyProfile()}>确认保存账号</button><button disabled={busy} onClick={() => setConfirmSave(false)}>返回编辑</button></div>}<details><summary>能力与兼容性</summary><p>{selected.platforms.join(" · ")}</p><p>{selected.backends.map((backend) => `${backend.kind}: ${backend.capabilities.join(", ")}`).join("; ")}</p>{selectedCompatibility.map((row) => <p key={row.backendId}>{row.backendId}: {Object.values(row.unsupportedReasons).join(" · ") || "已声明能力均支持"}</p>)}</details><p role="status">{message}</p></Drawer>}
    {drawer === "trial" && <Drawer title="发布试运行任务" onClose={()=>setDrawer(undefined)}><Notice>试运行使用统一任务发布：选择已登记仓库、填写验收条件，通过预检并确认后才会启动。执行记录、模型选择和验证结果保存在任务页。</Notice><label>Harness 账号<select value={runProfileId} onChange={event=>setRunProfileId(event.target.value)}><option value="">在发布页选择</option>{configuredProfiles.filter(profile=>profile.state==="CONFIGURED").map(profile=><option key={profile.id} value={profile.id}>{profile.alias} · {profile.provider}</option>)}</select></label><Link className="button-link primary" to={`/publish${runProfileId?`?profile=${encodeURIComponent(runProfileId)}`:""}`}>前往发布并预检</Link></Drawer>}
    {detailProfile && <Drawer title={`${detailProfile.alias} · 账号详情`} onClose={() => setDrawer(undefined)}><dl className="details-grid"><div><dt>Agent</dt><dd>{detailProfile.provider}</dd></div><div><dt>设备</dt><dd>{detailProfile.runnerId}</dd></div><div><dt>派发状态</dt><dd>{stateLabel(configuredProfiles.find((profile) => profile.id === detailProfile.id)?.state ?? detailProfile.state)}</dd></div><div><dt>安装检查</dt><dd>{evidenceText(detailProfile.installation,"installation")}</dd></div><div><dt>兼容性检查</dt><dd>{evidenceText(detailProfile.compatibility,"compatibility")}</dd></div><div><dt>最近登录检查</dt><dd>{loginResults[detailProfile.id] ?? evidenceText(detailProfile.authentication)}</dd></div></dl><div className="secure-actions"><Link className="button-link" to={`/models?profile=${encodeURIComponent(detailProfile.id)}`}>原生模型与默认配置</Link><button onClick={()=>setEditor(true)}>编辑账号配置</button></div><details><summary>能力</summary><p>{detailProfile.capabilities?.join(" · ") || "未提供"}</p></details><div className="secure-actions"><button disabled={pendingProfiles.has(detailProfile.id)||detailProfile.actions?.test?.allowed===false} onClick={() => void testProfile(detailProfile.id)}>测试登录</button><button disabled={pendingProfiles.has(detailProfile.id)} aria-label={`${(configuredProfiles.find((profile) => profile.id === detailProfile.id) ?? detailProfile).state === "DISABLED" ? "Enable" : "Disable"} dispatch for ${detailProfile.alias}`} onClick={() => void setProfileEnabled(configuredProfiles.find((profile) => profile.id === detailProfile.id) ?? detailProfile)}>{(configuredProfiles.find((profile) => profile.id === detailProfile.id) ?? detailProfile).state === "DISABLED" ? "启用派发" : "停用派发"}</button></div>{detailProfile.actions?.test?.message&&<p>{detailProfile.actions.test.message}</p>}<Notice>检查结果仅代表所示时间的原生状态。外部切换账号或升级工具后，请重新检查。账号私有配置目录与原生凭据保留在服务端。原生目录按账号和项目读取；目录不证明模型访问权限或费用。</Notice><p role="status">{message}</p></Drawer>}
    {editor&&<Drawer title="Agent 账号配置" onClose={()=>setEditor(false)}><Suspense fallback={<p>正在读取配置…</p>}><SettingsPage sectionId="agentProfiles" embedded/></Suspense></Drawer>}
  </section>;
}
