import type {EvidenceState,ProfileConsoleView,NativeSessionConsoleView} from "@dispatcher/domain";
import { lazy, Suspense, useEffect, useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SecureInput } from "./App.js";
import { Drawer } from "./Drawer.js";
import {UsagePanel} from "./UsagePanel.js";
import { stateLabel } from "./task-view.js";
import { EmptyState, Icon, Notice, Tabs, ProviderMark } from "./ui.js";
import { api, createConfigurationPlan,rememberConfigurationPlan,refreshConfiguration, subscribeToEvents,type ConfigResponse } from "./api.js";
import { Link,useSearchParams } from "react-router-dom";
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

type SessionView=NativeSessionConsoleView;

function evidenceText(evidence:EvidenceState|undefined,kind:"installation"|"compatibility"|"authentication"="authentication"):string{
  if(!evidence?.observedAt)return "未检查";
  const ready=kind==="authentication"?"登录已验证":kind==="installation"?"已发现安装":"兼容性已验证";
  const labels={ready,missing:kind==="installation"?"未发现安装":"需要原生登录",failed:"检查未通过",unknown:"尚未验证",stale:"已过期，请重新检查",unsupported:"尚未支持"};
  return `${labels[evidence.status]} · ${new Date(evidence.observedAt).toLocaleTimeString()}`;
}

const accountFieldLabels:Record<string,string>={id:"账号 ID",alias:"别名",codexHome:"独立 CODEX_HOME",configDir:"原生账号配置目录",executable:"CLI 可执行文件",enabled:"允许新任务派发",model:"账号默认模型",backend:"执行后端",mode:"执行模式",endpoint:"服务地址",baseUrl:"服务地址",provider:"服务提供方",args:"启动参数模板",argumentTemplate:"启动参数模板"};
const validator = customizeValidator({ AjvClass: Ajv2020 });

export default function AgentsPage(): React.JSX.Element {
  const client=useQueryClient();
  const [params,setParams]=useSearchParams();
  const detailId=params.get("profile")??"";
  const runnerFilter=params.get("runner")??"";
  const [detailTab,setDetailTab]=useState("overview");
  const accountDetail=useQuery({queryKey:["agent-profile",detailId],queryFn:()=>api<{profile:ProfileView}>(`/api/agents/profiles/${encodeURIComponent(detailId)}`),enabled:Boolean(detailId),retry:false});
  const [plan,setPlan]=useState<ProfilePlan>();
  const [activation,setActivation]=useState<{plan:ProfilePlan;profileId:string;alias:string;enabled:boolean}>();
  const [editor,setEditor]=useState(false);
  const query = useQuery({ queryKey: ["adapter-manifests"], queryFn: () => api<{ manifests: Manifest[] }>("/api/adapters/manifests"), retry: false });
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: () => api<{ revision?:number; profiles: ProfileView[]; sessions: SessionView[] }>("/api/agents/profiles"), retry: false });
  useEffect(()=>subscribeToEvents(()=>void profiles.refetch()),[profiles.refetch]);
  const compatibility = useQuery({ queryKey: ["adapter-compatibility"], queryFn: () => api<{ matrix: CompatibilityRow[] }>("/api/adapters/compatibility"), retry: false });
  const [drawer, setDrawer] = useState<"add" | "trial" | ProfileView>();
  const [accountStep,setAccountStep]=useState(0);
  const deviceConfig=useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<{runners:Array<{id:string;displayName:string;mode:string}>}>>("/api/config?view=console"),enabled:drawer==="add",retry:false});
  const [sessionDetail,setSessionDetail]=useState<SessionView>();
  const [sessionBusy,setSessionBusy]=useState(false);
  const [sessionMessage,setSessionMessage]=useState("");
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
  const [message, setMessage] = useState("配置修改需审阅计划后应用，原生登录状态单独检查。");
  if (query.isLoading || profiles.isLoading) return <div className="page-state">正在读取 Agent 账号…</div>;
  if (query.error || profiles.error || !query.data || !profiles.data) return <div className="page-state error" role="alert"><strong>Agent 账号读取失败</strong><button onClick={() => { void query.refetch(); void profiles.refetch(); }}>重试</button></div>;
  const selected = query.data.manifests.find((manifest) => manifest.id === selectedId) ?? query.data.manifests[0];
  if (!selected) return <div className="page-state">尚未注册可用的工具适配器。</div>;
  const activeManifest = selected;
  async function discover(): Promise<void> {
    if (busy) return; setBusy(true);
    setMessage(`正在检查 ${activeManifest.displayName} 账号…`);
    try {
      const result = await api<{ authenticated?: boolean; healthy?: boolean; installed?: boolean; version?: string; profile?: { alias: string }; diagnostic?: string; selected?: { authenticated: boolean; version?: string; executable: string }; candidates?: unknown[] }>(`/api/agents/${activeManifest.id}/discover`, { method: "POST", body: JSON.stringify({ ...draft, id: String(draft.id ?? `${activeManifest.id}-profile`) }) });
      const candidate = result.selected ?? result;
      const ready = candidate.authenticated || result.healthy;
      setMessage(ready ? `${String(draft.alias ?? result.profile?.alias ?? activeManifest.displayName)} 健康检查通过（${candidate.version ?? "版本未提供"}）.` : result.diagnostic ?? (result.installed ? `已发现 CLI（${candidate.version ?? "版本未提供"}），原生登录仍未验证。` : `发现 ${result.candidates?.length ?? 0} 个安装候选，仍需选择并验证原生登录。`));
    } catch (error) { setMessage(error instanceof Error ? error.message : `${activeManifest.displayName} 扫描失败。`); } finally { setBusy(false); }
  }
  async function saveProfile(): Promise<void> {
    if (busy) return; setBusy(true); setPlan(undefined);
    try {
      const result=await api<{plan:ProfilePlan}>(`/api/agents/${activeManifest.id}/profiles`,{method:"POST",body:JSON.stringify({...draft,runnerId:String(draft.runnerId??"local"),previewOnly:true,baseRevision:profiles.data?.revision})});
      rememberConfigurationPlan(result.plan.id);setPlan(result.plan);setConfirmSave(true);setAccountStep(3);setMessage("计划已生成，确认后才会保存账号。");
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
      const current=await api<ConfigResponse<{agentProfiles:Array<{id:string;enabled?:boolean}>}>>("/api/config?view=console");
      if(profiles.data?.revision!==undefined&&current.revision!==profiles.data.revision)throw new Error("配置版本已改变，请刷新账号后重新审阅。");
      const proposed=structuredClone(current.config),account=proposed.agentProfiles.find(account=>account.id===profile.id);
      if(!account||(account.enabled!==false)===enabled)throw new Error("账号状态已改变，请刷新后重新审阅。");
      account.enabled=enabled;const result=await createConfigurationPlan(current,proposed);
      setActivation({plan:result.plan,profileId:profile.id,alias:profile.alias,enabled});setMessage("派发状态尚未改变，请审阅计划后确认应用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "账号更新失败，请刷新后重试。"); } finally { setPendingProfiles((current) => { const next = new Set(current); next.delete(profile.id); return next; }); }
  }
  async function applyActivation():Promise<void>{
    if(!activation||busy)return;setBusy(true);
    try{await api(`/api/config/plans/${encodeURIComponent(activation.plan.id)}/apply?view=console`,{method:"POST",body:JSON.stringify({confirmed:activation.plan.requiresConfirmation})});if(!activation.enabled&&runProfileId===activation.profileId)setRunProfileId("");await refreshConfiguration(client);setMessage(`${activation.alias} 已${activation.enabled?"启用":"停用"}派发。`);setActivation(undefined);}
    catch(error){setMessage(error instanceof Error?error.message:"应用失败，当前派发状态保留。");}finally{setBusy(false);}
  }
  async function testProfile(id: string): Promise<void> {
    if (pendingProfiles.has(id)) return;
    setPendingProfiles((current) => new Set(current).add(id));
    setLoginResults((current) => ({ ...current, [id]: "正在检查登录…" }));
    try {
      const result=await api<{profile?:ProfileView}>(`/api/agents/profiles/${encodeURIComponent(id)}/test`,{method:"POST"});
      if(!result.profile?.authentication?.observedAt)throw new Error("服务端尚未返回可核验的原生登录证据");
      client.setQueryData(["agent-profile",id],{profile:result.profile});
      client.setQueryData<{revision?:number;profiles:ProfileView[];sessions:SessionView[]}>(["agent-profiles"],current=>current?{...current,profiles:current.profiles.map(profile=>profile.id===id?result.profile!:profile)}:current);
      setLoginResults(current=>{const next={...current};delete next[id];return next;});

    } catch (error) { setLoginResults((current) => ({ ...current, [id]: error instanceof Error ? error.message : "登录检查失败" })); }
    finally { setPendingProfiles((current) => { const next = new Set(current); next.delete(id); return next; }); }
  }
  async function sessionAction(session:SessionView,action:"refresh"|"cancel"):Promise<void>{
    if(sessionBusy||!session.profileId)return;setSessionBusy(true);setSessionMessage("");
    const path=`/api/agents/profiles/${encodeURIComponent(session.profileId)}/sessions/${encodeURIComponent(session.id)}`;
    try{
      const result=await api<{session:SessionView}>(`${path}${action==="cancel"?"/cancel":""}`,action==="cancel"?{method:"POST"}:undefined);
      setSessionDetail(result.session);setSessionMessage(action==="cancel"?"已收到原生停止确认。":"已读取当前会话证据。");
    }catch(error){setSessionMessage(error instanceof Error?error.message:"会话操作失败；停止结果可能仍未确认。");}
    finally{await profiles.refetch();setSessionBusy(false);}
  }
  const configuredProfiles = profiles.data?.profiles ?? [];
  const selectedCompatibility = compatibility.data?.matrix.filter((row) => row.adapterId === selected.id) ?? [];
  const profileId = typeof draft.id === "string" && draft.id ? draft.id : undefined;
  const secretNamespace = selected.id === "workbuddy-codebuddy"
    ? draft.provider === "workbuddy" || draft.provider === "codebuddy" ? draft.provider : undefined
    : selected.secretFields.includes("credentialRef") ? selected.id : undefined;
  const filtered = configuredProfiles.filter((profile) => (!runnerFilter||profile.runnerId===runnerFilter)&&(!search || `${profile.alias} ${profile.provider}`.toLowerCase().includes(search.toLowerCase())) && (filter === "all" || (filter === "enabled" ? profile.state !== "DISABLED" : profile.state === "DISABLED")));
  const enabledCount = configuredProfiles.filter((profile) => profile.state !== "DISABLED").length;
  const detailProfile=detailId?(accountDetail.data?.profile??configuredProfiles.find(profile=>profile.id===detailId)):undefined;
  const currentSession=sessionDetail?(profiles.data.sessions.find(session=>session.id===sessionDetail.id)??sessionDetail):undefined;
  return <section>
    {!detailId&&<>
    <header className="page-header"><div><h1>Harness</h1><p>接入你的开发工具，让每个账号独立、安全地执行任务。</p></div><div className="page-actions"><button onClick={() => { setMessage(""); setDrawer("trial"); }}><Icon name="pulse"/>试运行</button><button className="primary" onClick={() => { setMessage("");setAccountStep(0);setPlan(undefined);setConfirmSave(false); setDrawer("add"); }}><Icon name="plus"/>添加账号</button></div></header>
    <Tabs label="Harness" items={[["accounts",`已接入账号 ${configuredProfiles.length}`],["catalog",`工具目录 ${query.data.manifests.length}`],["capabilities","能力与兼容性"]]} value={view} onChange={setView}/>
    {view === "accounts" && <>
    {runnerFilter&&<Notice>当前设备：{runnerFilter}<button onClick={()=>setParams({})}>显示全部设备账号</button></Notice>}
    <Notice>账号启用、原生登录与资源可用性分别记录。测试登录仅检查所选账号，不会启动开发任务。</Notice>
    <div className="panel table-wrap"><div className="toolbar account-toolbar" style={{padding: "0 16px"}}><input aria-label="搜索账号或 Agent" placeholder="搜索账号或 Agent…" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="segments">{[["all", `全部 ${configuredProfiles.length}`], ["enabled", `已启用 ${enabledCount}`], ["disabled", `已停用 ${configuredProfiles.length - enabledCount}`]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value!)}>{label}</button>)}</div></div>
      <table className="account-table" aria-label="Agent 账号"><thead><tr><th>账号</th><th>Agent</th><th>设备</th><th>派发状态</th><th>最近登录检查</th><th>操作</th></tr></thead><tbody>{filtered.map((profile) => <tr key={profile.id}><td><div className="account-name"><ProviderMark provider={profile.provider}/><strong>{profile.alias}</strong></div></td><td data-label="Agent">{profile.provider}</td><td data-label="设备">{profile.runnerId === "local" ? "本机" : profile.runnerId}</td><td data-label="派发状态"><span className={`status status-${profile.state.toLowerCase()}`}>{stateLabel(profile.state)}</span></td><td data-label="最近登录检查" aria-live="polite">{loginResults[profile.id] ?? evidenceText(profile.authentication)}</td><td><div className="secure-actions"><button disabled={pendingProfiles.has(profile.id)||profile.actions?.test?.allowed===false} title={profile.actions?.test?.message} onClick={() => void testProfile(profile.id)} aria-label={`测试 ${profile.alias} 登录`}>测试登录</button><button onClick={() => {setMessage("");setDetailTab("overview");setParams({profile:profile.id});}} aria-label={`${profile.alias} 详情`}>详情</button></div></td></tr>)}</tbody></table>
      {!filtered.length && <div className="page-state"><strong>{configuredProfiles.length ? "没有匹配的账号" : "暂无 Agent 账号"}</strong><p>{configuredProfiles.length ? "调整搜索或筛选条件。" : "添加当前机器上的 Agent，保留独立账号和原生登录信息。"}</p><button onClick={() => configuredProfiles.length ? (setFilter("all"), setSearch("")) : setDrawer("add")}>{configuredProfiles.length ? "清除筛选" : "添加账号"}</button></div>}
      <footer className="table-footer">显示 {filtered.length} 个账号 · 启用与登录验证分别记录，测试不会改变派发状态</footer>
    </div>
    <div className="panel"><header className="panel-heading"><h2>最近 Agent 会话</h2><span>{profiles.data.sessions.length} 个会话</span></header>{profiles.data.sessions.length ? profiles.data.sessions.map((session) => <article key={session.id} className="runner-row"><div><strong>{configuredProfiles.find((profile) => profile.id === session.profileId)?.alias ?? session.profileId}</strong><p>{session.id} · {session.state} · {session.canonical ? "任务会话" : "独立会话"}</p>{session.stopState === "unconfirmed" || session.stopState === "requested" ? <p role="status">停止尚未确认</p> : null}</div><small>{new Date(session.updatedAt).toLocaleString()}</small>{session.canonical && session.taskId ? <Link className="button-link" to={`/tasks?task=${encodeURIComponent(session.taskId)}`}>查看任务</Link> : <button onClick={()=>{setSessionDetail(session);setSessionMessage("");}}>查看会话</button>}</article>) : <div className="empty-inline"><strong>暂无会话</strong><p>选择已启用的账号进行试运行，运行仍使用受管工作目录。</p><button onClick={() => { setMessage(""); setDrawer("trial"); }}>开始试运行</button></div>}</div>
    </>}
    {view === "catalog" && <><div className="section-intro"><div><h2>选择要接入的工具</h2><p className="muted">来自当前 Controller 的适配器声明，安装与认证需在目标设备单独检查。</p></div></div><div className="catalog-grid">{query.data.manifests.map((manifest) => <article className="catalog-card" key={manifest.id}><div className="catalog-title"><ProviderMark provider={manifest.id}/><div><h3>{manifest.displayName}</h3><small>{manifest.id}</small></div></div><p>{manifest.backends.map((backend) => backend.kind).join(" / ") || "尚无执行后端"}</p><div className="tag-list">{manifest.platforms.map((platform) => <span className="pill" key={platform}>{platform}</span>)}</div><div className="catalog-footer"><span className="muted">{configuredProfiles.filter((profile) => profile.provider === manifest.id).length} 个同名提供方账号</span><button onClick={() => {setSelectedId(manifest.id);setDraft({});setConfirmSave(false);setMessage("");setDrawer("add");}}>接入工具</button></div></article>)}</div></>}
    {view === "capabilities" && <><Notice>能力表来自适配器声明，不代表当前安装版本、账号或设备已经实测通过。</Notice>{compatibility.isLoading ? <div className="page-state" role="status">正在读取能力表…</div> : compatibility.error ? <div className="page-state error" role="alert">能力表读取失败。<button onClick={() => void compatibility.refetch()}>重试</button></div> : <div className="panel table-wrap"><table><thead><tr><th>工具</th><th>执行后端</th><th>声明支持</th><th>限制与未支持原因</th></tr></thead><tbody>{compatibility.data?.matrix.map((row) => <tr key={`${row.adapterId}:${row.backendId}`}><td><strong>{row.displayName}</strong></td><td>{row.backendKind}<small>{row.backendId}</small></td><td><div className="tag-list">{row.capabilities.map((capability) => <span className="pill" key={capability}>{capability}</span>)}</div></td><td>{Object.entries(row.unsupportedReasons).map(([name,reason]) => <p key={name}>{name}：{reason}</p>)}</td></tr>)}</tbody></table>{!compatibility.data?.matrix.length && <EmptyState title="暂无能力声明" icon="plug"/>}</div>}</>}
    {message && !drawer && <p role="status">{message}</p>}
    </>}
    {currentSession && <Drawer title="独立 Agent 会话" onClose={()=>setSessionDetail(undefined)}><Notice>独立会话保留原始账号上下文。新任务请使用统一发布和预检。</Notice><dl><dt>会话</dt><dd>{currentSession.id}</dd><dt>原生状态</dt><dd>{currentSession.state}</dd><dt>账号上下文</dt><dd>{currentSession.contextState==="current"?"与启动时一致":currentSession.contextState==="changed"?"已变更，禁止继续操作":"历史上下文未知"}</dd><dt>停止确认</dt><dd>{currentSession.stopState==="confirmed"?"已确认":currentSession.stopState==="unconfirmed"||currentSession.stopState==="requested"?"尚未确认，继续输入与账号变更已阻止":"尚未请求"}</dd></dl><div className="secure-actions"><button disabled={sessionBusy||!currentSession.actions?.refresh?.allowed} onClick={()=>void sessionAction(currentSession,"refresh")}>查询原生状态</button><button disabled={sessionBusy||!currentSession.actions?.cancel?.allowed} onClick={()=>void sessionAction(currentSession,"cancel")}>停止会话</button></div><p>查询会读取所属工具的会话状态；停止需要原生终态证据。</p><p role="status">{sessionMessage}</p><UsagePanel key={currentSession.id} {...(currentSession.profileId?{profileId:currentSession.profileId}:{})} sessionId={currentSession.id}/></Drawer>}
    {drawer === "add" && <Drawer title="添加 Agent 账号" onClose={() => {if(!busy)setDrawer(undefined);}}>
      <ol className="stepper" aria-label="账号接入进度">{["选择工具与设备","配置独立账号","扫描与验证","审阅并应用"].map((name,index)=><li key={name} className={index<accountStep?"done":index===accountStep?"current":""} aria-current={index===accountStep?"step":undefined}>{name}</li>)}</ol>
      <p className="eyebrow">{accountStep+1} / 4</p>
      {accountStep===0&&<div className="config-form"><label className="field-stack">Agent<select value={selected.id} disabled={busy} onChange={(event) => {setSelectedId(event.target.value);setDraft({});setConfirmSave(false);setPlan(undefined);setMessage("");}}>{query.data.manifests.map((manifest)=><option key={manifest.id} value={manifest.id}>{manifest.displayName}</option>)}</select></label>
        <label>执行设备<select value={String(draft.runnerId??deviceConfig.data?.config?.runners?.[0]?.id??"")} onChange={event=>setDraft(current=>({...current,runnerId:event.target.value}))}><option value="">选择已登记设备</option>{deviceConfig.data?.config?.runners?.map(runner=><option key={runner.id} value={runner.id}>{runner.displayName} · {runner.mode==="remote"?"远程":"本机"}</option>)}</select></label>
        {deviceConfig.isLoading&&<p role="status">正在读取已登记设备…</p>}{deviceConfig.error&&<Notice tone="error">设备读取失败。<button onClick={()=>void deviceConfig.refetch()}>重试</button></Notice>}
        <Notice>选择设备不会安装工具或导入登录。原生账号目录与任务工作目录分别管理。</Notice>
        <button className="primary" disabled={busy||!deviceConfig.data?.config?.runners?.some(runner=>runner.id===String(draft.runnerId??deviceConfig.data?.config?.runners?.[0]?.id??""))} onClick={()=>{setDraft(current=>({...current,runnerId:String(current.runnerId??deviceConfig.data!.config.runners[0]!.id)}));setAccountStep(1);}}>下一步：配置账号</button>
      </div>}
      {accountStep===1&&<div className="config-form"><p>{selected.displayName} · 设备 {String(draft.runnerId)}</p><Form schema={selected.configSchema} uiSchema={{...selected.uiSchema,...Object.fromEntries(Object.entries(accountFieldLabels).map(([key,label])=>{const field=selected.configSchema.properties?.[key];const title=field&&typeof field==="object"?field.title:undefined;return [key,{...selected.uiSchema[key],"ui:title":title&&/[\u4e00-\u9fff]/u.test(title)?title:label}];})),runnerId:{"ui:widget":"hidden"},id:{...selected.uiSchema.id,"ui:title":"账号 ID"},alias:{...selected.uiSchema.alias,"ui:title":"别名"}}} formData={draft} validator={validator} disabled={busy} onChange={(event)=>{setDraft((event.formData??{}) as Record<string,unknown>);setConfirmSave(false);setPlan(undefined);}} onSubmit={()=>{setMessage("草稿已通过结构校验；扫描可选，尚未保存账号。");setAccountStep(2);}}><button type="submit" className="primary" disabled={busy}>下一步：扫描与验证</button></Form>
        {secretNamespace&&profileId?<SecureInput namespace={secretNamespace} name={profileId} label={`${selected.displayName} 凭据`} onStored={credentialRef=>{setDraft(current=>({...current,credentialRef}));setPlan(undefined);}} onDeleted={()=>{setDraft(current=>{const next={...current};delete next.credentialRef;return next;});setPlan(undefined);}}/>:selected.secretFields.includes("credentialRef")?<Notice>先填写账号 ID，再安全存储凭据。</Notice>:null}
        <button disabled={busy} onClick={()=>setAccountStep(0)}>上一步：工具与设备</button>
      </div>}
      {accountStep===2&&<div className="workflow-card"><h3>验证独立账号</h3><p>{selected.displayName} · {String(draft.alias??draft.id??"未命名")} · 设备 {String(draft.runnerId)}</p><Notice>扫描是可选的。检查失败仍可保存结构有效的未验证账号；执行时另行校验安装、登录与可用性。</Notice>{selected.id!=="generic-mock"?<div className="secure-actions"><button disabled={busy} onClick={()=>void discover()}>扫描并检查</button><button disabled={busy} className="primary" onClick={()=>void saveProfile()}>生成账号配置计划</button></div>:<Notice>模拟适配器不提供此接入流程，请返回选择实际工具。</Notice>}<button disabled={busy} onClick={()=>{setAccountStep(1);setPlan(undefined);setConfirmSave(false);}}>上一步：账号配置</button></div>}
      {accountStep===3&&confirmSave&&plan&&<div className="workflow-card"><h3>确认账号配置</h3><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change,index)=><li key={index}>{change.path}</li>)}</ul><p>工具：{selected.displayName} · 账号：{String(draft.alias??draft.id??"未命名")} · 设备：{String(draft.runnerId)}</p><p>确认后通过 ConfigPlan 生效；原生登录状态仍需单独测试。</p><button disabled={busy} className="primary" onClick={()=>void applyProfile()}>确认保存账号</button><button disabled={busy} onClick={()=>{setConfirmSave(false);setPlan(undefined);setAccountStep(1);}}>返回编辑</button></div>}
      <details><summary>能力与兼容性</summary><p>{selected.platforms.join(" · ")}</p><p>{selected.backends.map(backend=>`${backend.kind}: ${backend.capabilities.join(", ")}`).join("; ")}</p>{selectedCompatibility.map(row=><p key={row.backendId}>{row.backendId}: {Object.values(row.unsupportedReasons).join(" · ")||"已声明能力均支持"}</p>)}</details><p role="status">{message}</p>
    </Drawer>}
    {drawer === "trial" && <Drawer title="发布试运行任务" onClose={()=>setDrawer(undefined)}><Notice>试运行使用统一任务发布：选择已登记仓库、填写验收条件，通过预检并确认后才会启动。执行记录、模型选择和验证结果保存在任务页。</Notice><label>Harness 账号<select value={runProfileId} onChange={event=>setRunProfileId(event.target.value)}><option value="">在发布页选择</option>{configuredProfiles.filter(profile=>profile.state==="CONFIGURED").map(profile=><option key={profile.id} value={profile.id}>{profile.alias} · {profile.provider}</option>)}</select></label><Link className="button-link primary" to={`/publish${runProfileId?`?profile=${encodeURIComponent(runProfileId)}`:""}`}>前往发布并预检</Link></Drawer>}
    {detailId&&(accountDetail.isLoading&&!detailProfile?<p role="status">正在读取账号详情…</p>:!detailProfile?<Notice tone="error">账号详情读取失败或账号已移除。<Link to="/harnesses">返回 Harness</Link><button onClick={()=>void accountDetail.refetch()}>重试</button></Notice>:<>
      <header className="page-header"><div><Link to="/harnesses">返回 Harness</Link><h1>{detailProfile.alias}</h1><p>{detailProfile.id} · {detailProfile.provider} · {detailProfile.runnerId}</p></div><div className="page-actions"><button disabled={pendingProfiles.has(detailProfile.id)||detailProfile.actions?.test?.allowed===false} onClick={()=>void testProfile(detailProfile.id)}>测试登录</button><button onClick={()=>{setRunProfileId(detailProfile.id);setDrawer("trial");}}>打开试运行</button></div></header>
      {accountDetail.error&&<Notice tone="warning">详情刷新失败，正在显示列表中的最近快照。<button onClick={()=>void accountDetail.refetch()}>重新读取</button></Notice>}
      <Tabs label="账号详情" items={[["overview","概览"],["account","账号与登录"],["runtime","执行设置"],["models","原生模型"],["capabilities","能力与限制"]]} value={detailTab} onChange={setDetailTab}/>
      {detailTab==="overview"&&<><article className="panel"><h2>接入状态</h2><dl className="details-grid"><div><dt>执行设备</dt><dd>{detailProfile.runnerId} · <Link to="/devices">设备详情</Link></dd></div><div><dt>派发状态</dt><dd>{stateLabel(configuredProfiles.find(profile=>profile.id===detailProfile.id)?.state??detailProfile.state)}</dd></div><div><dt>安装检查</dt><dd>{evidenceText(detailProfile.installation,"installation")}</dd></div><div><dt>兼容性检查</dt><dd>{evidenceText(detailProfile.compatibility,"compatibility")}</dd></div><div><dt>最近登录检查</dt><dd>{loginResults[detailProfile.id]??evidenceText(detailProfile.authentication)}</dd></div><div><dt>资源证据</dt><dd>{detailProfile.resources?({ready:"已有资源证据",missing:"缺少证据",failed:"检查失败",unknown:"未知",stale:"已过期",unsupported:"尚未支持"}[detailProfile.resources.status]):"未知"}</dd></div></dl><div className="secure-actions"><button disabled={pendingProfiles.has(detailProfile.id)} aria-label={`${(configuredProfiles.find(profile=>profile.id===detailProfile.id)??detailProfile).state==="DISABLED"?"启用":"停用"} ${detailProfile.alias} 派发`} onClick={()=>void setProfileEnabled(configuredProfiles.find(profile=>profile.id===detailProfile.id)??detailProfile)}>{(configuredProfiles.find(profile=>profile.id===detailProfile.id)??detailProfile).state==="DISABLED"?"启用派发":"停用派发"}</button></div>{detailProfile.actions?.test?.message&&<p>{detailProfile.actions.test.message}</p>}</article>
        <article className="panel"><h2>此账号的最近会话</h2>{profiles.data.sessions.filter(session=>session.profileId===detailProfile.id).map(session=><div className="setting-row" key={session.id}><div>{session.id}<small>{stateLabel(session.state)} · {session.canonical?"任务运行":"独立会话"}</small></div>{session.canonical&&session.taskId?<Link to={`/tasks?task=${encodeURIComponent(session.taskId)}`}>查看任务</Link>:<button onClick={()=>{setSessionDetail(session);setSessionMessage("");}}>查看会话</button>}</div>)}{!profiles.data.sessions.some(session=>session.profileId===detailProfile.id)&&<p>此账号尚无会话记录。</p>}</article></>}
      {detailTab==="account"&&<article className="panel"><h2>账号与登录</h2><p>账号 ID：{detailProfile.id} · 配置版本：{detailProfile.configRevision??"未知"}</p><p>{loginResults[detailProfile.id]??evidenceText(detailProfile.authentication)}</p><Notice>原生账号目录与凭据保留在所属设备。编辑保留隐藏值，只有明确填写的新值才会替换。</Notice><button onClick={()=>setEditor(true)}>编辑此账号配置</button></article>}
      {detailTab==="runtime"&&<article className="panel"><h2>执行设置</h2><dl className="details-grid"><div><dt>执行设备</dt><dd>{detailProfile.runnerId}</dd></div><div><dt>账号默认模型</dt><dd>{detailProfile.defaultModel?.id??"沿用原生配置"}</dd></div><div><dt>执行支持</dt><dd>{detailProfile.executionSupport?({"local-ready":"本机就绪","remote-ready":"远程就绪",unverified:"尚未验证",unsupported:"当前不支持"}[detailProfile.executionSupport]):"尚未验证"}</dd></div></dl><p>模型与参数在运行时冻结。配置选择不等于运行已确认。</p><div className="secure-actions"><button onClick={()=>setEditor(true)}>编辑执行配置</button><Link className="button-link" to={`/publish?profile=${encodeURIComponent(detailProfile.id)}`}>发布并预检</Link></div></article>}
      {detailTab==="models"&&<article className="panel"><h2>账号原生模型</h2><p>目录需要账号与项目上下文。模型访问权限、价格与额度分别验证。</p><Link className="button-link primary" to={`/models?profile=${encodeURIComponent(detailProfile.id)}`}>打开此账号的原生模型目录</Link></article>}
      {detailTab==="capabilities"&&<article className="panel"><h2>能力与限制</h2><p>{detailProfile.capabilities?.join(" · ")||"尚未提供能力证据"}</p>{compatibility.data?.matrix.filter(row=>row.adapterId===(detailProfile.adapterId??detailProfile.provider)).map(row=><div key={row.backendId}><h3>{row.backendId}</h3><p>{row.capabilities.join(" · ")}</p>{Object.entries(row.unsupportedReasons).map(([capability,reason])=><p key={capability}>{capability}：{reason}</p>)}</div>)}<Notice>原生会话的回复、取消与续接按当前会话证据开放；工具能力声明不代表当前账号已经登录或可执行。</Notice></article>}
      <Notice>检查证据只代表所示时间的原生状态；外部切换账号或升级工具后需重新检查。</Notice><p role="status">{message}</p>
    </>)}
    {activation&&<Drawer title="审阅派发状态变更" onClose={()=>setActivation(undefined)}><p>{activation.alias} · {activation.enabled?"启用派发":"停用派发"}</p><p>风险：{activation.plan.risk} · {activation.plan.changes.length} 项变更</p><ul>{activation.plan.changes.map((change,index)=><li key={index}>{change.path}</li>)}</ul><Notice>确认后通过配置计划生效。活动账号若无法安全变更，服务端会拒绝本次应用。</Notice><button className="primary" disabled={busy} onClick={()=>void applyActivation()}>确认并应用派发变更</button><p role="status">{message}</p></Drawer>}
    {editor&&<Drawer title="Agent 账号配置" onClose={()=>setEditor(false)}><Suspense fallback={<p>正在读取配置…</p>}><SettingsPage key={detailId} sectionId="agentProfiles" entityId={detailId} embedded/></Suspense></Drawer>}
  </section>;
}
