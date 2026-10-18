import {PolicyRoutingField} from "./PolicyRoutingField.js";
import LocalDirectoryPicker from "./LocalDirectoryPicker.js";
import { useEffect, useRef, useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema, WidgetProps } from "@rjsf/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, createConfigurationPlan, ApiError, refreshConfiguration, AUTH_REQUIRED_EVENT, type ConfigResponse } from "./api.js";
import { Icon, Notice } from "./ui.js";
import { SecureInput } from "./App.js";
interface SchemaResponse { schema: RJSFSchema; uiSchema: UiSchema }
interface Plan { id: string; risk: string; requiresConfirmation: boolean; state?:string;baseRevision?:number;changes: Array<{ path: string;before?:unknown;after?:unknown }> }
interface ConfigDocument extends Record<string, unknown> { integrations?: { linear?: { enabled: boolean; credentialRef?: string } } }
const validator = customizeValidator({ AjvClass: Ajv2020 });
const sectionNames: Record<string, string> = { controller: "控制台", runners: "运行设备", integrations: "兼容集成", connectors: "集成连接", repositories: "项目仓库", agentProfiles: "Agent 账号", internalLlm: "内部模型", policies: "策略" };
const schemaTitles:Record<string,string>={"Controller": "控制台", "Runners": "运行设备", "Integrations": "兼容集成", "Connectors": "集成连接", "Repositories": "项目仓库", "Internal LLM": "内部模型", "Agent profiles": "Agent 账号", "Policies": "策略"};
const fieldLabels: Record<string,string> = { modelRouting:"模型自动路由", requireConfirmation:"自动路由需要独立确认",classificationMode:"分类方式",semanticFailureMode:"语义分类失败策略",taskTypes:"任务类型",definition:"分类定义",keywordGroups:"关键词组",any:"任一命中",all:"全部命中",exclude:"排除关键词",rules:"路由规则",taskTypeId:"任务类型标识",profileId:"账号标识",repositoryId:"项目标识（留空为全局）",priority:"优先级",target:"执行目标",modelSelectionId:"原生具体模型 ID",reasoning:"原生思考强度",value:"原生参数值",name:"名称", ...sectionNames, id:"标识", displayName:"显示名称", mode:"运行模式", capacity:"并发槽位", tags:"标签", root:"仓库目录", remote:"Git 远端", defaultBaseRef:"基准分支", scopePaths:"允许修改的目录", verificationCommands:"验证命令", file:"可执行文件", args:"参数", required:"必须通过", timeoutMs:"超时（毫秒）", outputLimitBytes:"输出上限（字节）", enabled:"启用", provider:"提供方", alias:"别名", runnerId:"执行设备", settings:"工具设置", credentialRef:"凭据引用", endpoints:"服务连接", profiles:"模型配置", pools:"模型池", roleBindings:"用途绑定", defaultPoolId:"默认模型池", profileIds:"模型顺序", endpointId:"服务连接", model:"模型 ID", protocol:"协议", baseUrl:"服务地址", poolId:"模型池", role:"用途", configured:"启用内部模型", definitionId:"连接器类型", kind:"类型", highRiskRequiresConfirmation:"高风险操作需要确认", rawShellDefault:"原始 Shell 默认策略", listen:"监听地址", port:"端口", deploymentMode:"部署模式", adminStrategy:"管理策略" };
function displaySchema(schema:RJSFSchema):RJSFSchema {
  const result={...schema};
  if(schema.properties) result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,typeof value === "object" ? {...displaySchema(value),title:(value.title?schemaTitles[value.title]??value.title:fieldLabels[key]??key)} : value]));
  if(schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) result.items=displaySchema(schema.items);
  return result;
}
function NativeEnabledWidget(props:WidgetProps):React.JSX.Element {
  const Checkbox=props.registry.widgets.CheckboxWidget!;
  return <Checkbox {...props} value={props.value??true} hideLabel/>;
}
function OwnerPasswordSettings(): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = input.current?.value ?? "";
    if (input.current) input.current.value = "";
    setBusy(true);
    try {
      await api("/auth/owner-password", { method: "POST", body: JSON.stringify({ password }) });
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    } catch (error) { setMessage(error instanceof Error ? error.message : "密码保存失败"); }
    finally { setBusy(false); }
  }
  return <form className="panel secure-input" onSubmit={(event) => void save(event)}><h2>控制台登录密码</h2>
    <p>用户名固定为 admin。修改密码后需要重新登录。</p>
    <label htmlFor="owner-password-new">新密码</label>
    <div><input ref={input} id="owner-password-new" type="password" autoComplete="new-password" required maxLength={1024} /><button type="submit" disabled={busy}>保存密码</button></div>
    <small role="status">{message}</small>
  </form>;
}
export default function SettingsPage({sectionId,entityId, embedded = false,onDraftChange}: {sectionId?: string;entityId?:string; embedded?: boolean;onDraftChange?:(draft:Record<string,unknown>)=>void} = {}): React.JSX.Element {
  const client = useQueryClient();
  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api<ConfigResponse<ConfigDocument>>("/api/config?view=console") });
  const schemaQuery = useQuery({ queryKey: ["config-schema"], queryFn: () => api<SchemaResponse>("/api/config/schema") });
  const dirty = useRef(false);
  const [section, setSection] = useState(sectionId ?? "");
  const baseRevision = useRef<number | undefined>(undefined);
  const [conflict, setConflict] = useState(false);
  const [draft, setDraft] = useState<ConfigDocument>();
  const [plan, setPlan] = useState<Plan>();
  const planKey=`dispatcher-config-plan:${sectionId??"all"}${entityId!==undefined?`:${entityId}`:""}`;
  const [trackedPlanId,setTrackedPlanId]=useState<string|undefined>(()=>{try{return sessionStorage.getItem(planKey)??undefined;}catch{return;}});
  const [appliedPlanId, setAppliedPlanId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function trackPlan(id:string|undefined):void{setTrackedPlanId(id);try{if(id)sessionStorage.setItem(planKey,id);else sessionStorage.removeItem(planKey);}catch{/* Reviewed IDs remain usable in this page when browser storage is unavailable. */}}
  async function checkStoredPlan():Promise<void>{
    if(!trackedPlanId||busy)return;setBusy(true);
    try{const result=await api<{plan:Plan;currentRevision:number;appliedRevision?:number}>(`/api/config/plans/${encodeURIComponent(trackedPlanId)}`),current=await configQuery.refetch();
      if(current.error||!current.data)throw current.error??new Error("当前配置读取失败，原计划编号保留。");
      if(!dirty.current){setDraft(structuredClone(current.data.config));baseRevision.current=current.data.revision;}
      if(result.plan.state==="APPLIED"){setPlan(undefined);setAppliedPlanId(current.data.revision===result.appliedRevision?result.plan.id:undefined);setMessage(current.data.revision===result.appliedRevision?"服务端确认此计划已应用，无需再次提交。":"计划已应用，当前配置另有后续变更。");}
      else if(result.plan.state==="PLANNED"&&!dirty.current&&result.plan.baseRevision===current.data.revision){setPlan(result.plan);setMessage("已找回原计划，请按下方变更审阅；表单显示当前已应用配置。");}
      else{setPlan(undefined);setMessage(result.plan.state==="ROLLED_BACK"?"服务端确认此计划已回滚。":dirty.current?"草稿已修改，原计划仅供状态核对。请重新生成计划。":"计划当前无法应用，请重新载入当前配置后编辑。");if(result.plan.state==="ROLLED_BACK")trackPlan(undefined);}
    }catch(error){setMessage(error instanceof Error?error.message:"计划状态查询失败，编号仍保留。");}finally{setBusy(false);}
  }
  useEffect(() => { if (configQuery.data && !dirty.current) { setDraft(structuredClone(configQuery.data.config)); baseRevision.current = configQuery.data.revision; } }, [configQuery.data]);
  useEffect(()=>{if(draft)onDraftChange?.(draft);},[draft,onDraftChange]);
  function edit(changes: Record<string, unknown>): void {
    dirty.current = true; setPlan(undefined); setMessage("草稿已修改，需要重新生成计划。");
    setDraft((previous) => ({ ...(previous ?? configQuery.data?.config), ...changes }));
  }
  function updateLinearCredential(reference?: string): void {
    const next = structuredClone(draft ?? configQuery.data?.config);
    if (!next?.integrations?.linear) return;
    if (reference) next.integrations.linear.credentialRef = reference;
    else { delete next.integrations.linear.credentialRef; next.integrations.linear.enabled = false; }
    edit(next);
  }
  async function buildPlan(): Promise<void> {
    if (busy) return;
    setBusy(true); setPlan(undefined); setMessage("正在校验完整配置…");
    try {
      const latest = await api<ConfigResponse<ConfigDocument>>("/api/config?view=console");
      if (latest.revision !== baseRevision.current) { setConflict(true); throw new Error("配置版本已改变。请重新载入当前配置后再编辑，现有草稿尚未提交。"); }
      const response = await createConfigurationPlan(latest,draft??latest.config);
      setPlan(response.plan);trackPlan(response.plan.id);setAppliedPlanId(undefined);
      setMessage(response.plan.changes.length === 0 ? "配置与当前版本一致。" : "计划已生成，请审阅变更和风险。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "配置校验失败"); }
    finally { setBusy(false); }
  }
  async function applyPlan(): Promise<void> {
    if (!plan || busy) return;
    setBusy(true); setMessage("正在应用并验证…");
    try {
      await api(`/api/config/plans/${plan.id}/apply?view=console`, { method: "POST", body: JSON.stringify({ confirmed: plan.requiresConfirmation }) });
      setAppliedPlanId(plan.id); setPlan(undefined); dirty.current = false;
      await configQuery.refetch(); await refreshConfiguration(client); setMessage("配置已应用并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "应用失败，请检查当前配置版本。"); if(error instanceof ApiError && error.status===409) {setConflict(true);setPlan(undefined);} }
    finally { setBusy(false); }
  }
  async function rollbackPlan(): Promise<void> {
    if (!appliedPlanId || busy) return;
    setBusy(true); setMessage("正在回滚并验证…");
    try {
      await api(`/api/config/plans/${appliedPlanId}/rollback?view=console`, { method: "POST" });
      setAppliedPlanId(undefined); setPlan(undefined);trackPlan(undefined);setConflict(dirty.current);
      await configQuery.refetch(); await refreshConfiguration(client); setMessage(dirty.current ? "配置已回滚并记录审计，未提交草稿已保留；配置基线已改变，请核对后重新载入。" : "配置已回滚并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "回滚失败，当前版本保留。"); }
    finally { setBusy(false); }
  }
  async function reloadCurrent():Promise<void>{
    if(busy||!window.confirm("重新载入会放弃当前未提交的配置草稿，继续吗？"))return;
    setBusy(true);
    try{const current=await configQuery.refetch();if(current.error||!current.data)throw current.error??new Error("配置读取失败");setDraft(structuredClone(current.data.config));baseRevision.current=current.data.revision;dirty.current=false;setConflict(false);setPlan(undefined);setMessage("已载入当前配置，可重新编辑。");}
    catch(error){setMessage(error instanceof Error?error.message:"配置读取失败，草稿保留");}finally{setBusy(false);}
  }
  if (configQuery.isLoading || schemaQuery.isLoading) return <div className="page-state" role="status">正在读取配置…</div>;
  if (configQuery.error || schemaQuery.error || !configQuery.data || !schemaQuery.data) return <div className="page-state error" role="alert"><strong>配置读取失败</strong><button onClick={() => { void configQuery.refetch(); void schemaQuery.refetch(); }}>重试</button></div>;
  const properties = schemaQuery.data.schema.properties ?? {};
  const sections = Object.keys(properties).filter((key) => key !== "schemaVersion");
  const currentSection = sections.includes(section) ? section : sections[0];
  const sectionSchema = displaySchema(currentSection ? { ...schemaQuery.data.schema, properties: { [currentSection]: properties[currentSection]! }, required: (schemaQuery.data.schema.required ?? []).filter((key) => key === currentSection) } : schemaQuery.data.schema);
  const currentDraft = draft ?? configQuery.data.config;
  const profileItems=schemaQuery.data.uiSchema.agentProfiles?.items as UiSchema|undefined;
  const appliedProfiles=Array.isArray(configQuery.data.config.agentProfiles)?configQuery.data.config.agentProfiles as Array<{id?:string}>:[];
  const accountItems=(item:{id?:string}|undefined):UiSchema=>({...profileItems,id:{...(profileItems?.id as UiSchema),"ui:readonly":Boolean(item?.id&&appliedProfiles.some(profile=>profile.id===item.id))},enabled:{"ui:widget":"NativeEnabled"}});
  const entries=Array.isArray(currentDraft[currentSection??""])?currentDraft[currentSection??""] as Array<Record<string,unknown>>:[];
  const entityIndex=entityId===undefined?-1:entries.findIndex(entry=>entry.id===entityId);
  if(entityId!==undefined&&entityIndex<0)return <Notice tone="error">当前配置中没有此条目，请关闭编辑器并刷新列表。</Notice>;
  const rawSection=currentSection?properties[currentSection]:undefined;
  const itemSchema=rawSection&&typeof rawSection==="object"&&!Array.isArray(rawSection.items)&&typeof rawSection.items==="object"?rawSection.items:undefined;
  const entitySchema=itemSchema?displaySchema({...schemaQuery.data.schema,...itemSchema,title:sectionNames[currentSection??""]}):undefined;
  const entityUi=currentSection==="agentProfiles"?accountItems(entries[entityIndex]):{...(schemaQuery.data.uiSchema[currentSection??""]?.items as UiSchema|undefined),id:{"ui:readonly":true}};
  function editEntity(value:Record<string,unknown>):void{edit({[currentSection!]:entries.map((entry,index)=>index===entityIndex?{...value,id:entityId}:entry)});}
  return <section aria-label={embedded ? `${sectionNames[sectionId ?? ""] ?? "配置"}编辑` : "设置"}>{!embedded && <header className="page-header"><div><h1>设置</h1><p>按分区编辑草稿，审阅变更后再应用。配置版本 {configQuery.data.revision}</p></div><span className="pill"><Icon name="shield" size={12}/>ConfigPlan</span></header>}
    <div className={embedded ? "" : "settings-workspace"}>
    {!sectionId && <nav className="settings-sections" aria-label="设置分区">{sections.map((key) => <button key={key} disabled={busy} aria-pressed={currentSection === key} onClick={() => setSection(key)}>{sectionNames[key] ?? key}</button>)}</nav>}
    <div className={embedded ? "settings-layout embedded-settings" : "settings-layout"}><div className="panel config-form">{currentSection==="repositories"&&<LocalDirectoryPicker runners={Array.isArray(currentDraft.runners)?currentDraft.runners as Array<{id:string;mode:string}>:[]} onSelect={candidate=>entityId!==undefined?editEntity({...entries[entityIndex],root:candidate.root,runnerId:candidate.runnerId}):edit({repositories:[...(Array.isArray(currentDraft.repositories)?currentDraft.repositories:[]),{id:"",root:candidate.root,runnerId:candidate.runnerId,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}]})}/>}<Form key={currentSection ?? "all"} schema={entityId!==undefined&&entitySchema?entitySchema:sectionSchema} uiSchema={entityId!==undefined?entityUi:{...schemaQuery.data.uiSchema,agentProfiles:{...schemaQuery.data.uiSchema.agentProfiles,items:accountItems},policies:{...schemaQuery.data.uiSchema.policies,modelRouting:{"ui:field":"PolicyRoutingField"}}}} fields={{PolicyRoutingField}} widgets={{NativeEnabled:NativeEnabledWidget}} validator={validator} formData={entityId!==undefined?entries[entityIndex]:currentSection ? { [currentSection]: currentDraft[currentSection] } : currentDraft} disabled={busy} noHtml5Validate experimental_defaultFormStateBehavior={{ emptyObjectFields: "skipDefaults", arrayMinItems: { populate: "never" }, allOf: "skipDefaults" }} onChange={({ formData }) => entityId!==undefined?editEntity(formData as Record<string,unknown>):edit(formData as Record<string, unknown>)} onSubmit={() => void buildPlan()}><button type="submit" className="primary" disabled={busy}>预览配置变更</button></Form><Notice>其他分区的草稿保留；私有账号目录已隐藏并保留，修改时需明确重新填写。已有账号 ID 保持固定，审阅后才会生效。</Notice></div>
    <aside className="settings-aside"><div className="panel plan-card" aria-live="polite">{trackedPlanId&&<button disabled={busy} onClick={()=>void checkStoredPlan()}>核对上次配置计划</button>}<h2>{plan ? "审阅配置计划" : appliedPlanId ? "已应用的计划" : "尚无待应用计划"}</h2><p>{message || "编辑字段后生成计划，草稿不会自动生效。"}</p>{conflict && <button disabled={busy} onClick={()=>void reloadCurrent()}>重新载入当前配置</button>}{plan && <><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change, index) => <li key={index}>{change.path}{change.after!==undefined?` → ${JSON.stringify(change.after)}`:""}</li>)}</ul></>}{plan && plan.changes.length > 0 && <button disabled={busy} className="primary" onClick={() => void applyPlan()}>{plan.requiresConfirmation ? "确认并应用" : "应用计划"}</button>}{appliedPlanId && <button disabled={busy} onClick={() => void rollbackPlan()}>回滚上次计划</button>}</div>
    {!embedded && <OwnerPasswordSettings />}
    {!embedded && currentDraft.integrations?.linear && <fieldset disabled={busy} className="panel"><h2>安全凭据</h2><p>凭据直接存入安全存储，不进入普通配置草稿。</p><SecureInput namespace="linear" name="main" label="Linear credential" onStored={(reference) => updateLinearCredential(reference)} onDeleted={() => updateLinearCredential()} /></fieldset>}</aside></div></div>
  </section>;
}
