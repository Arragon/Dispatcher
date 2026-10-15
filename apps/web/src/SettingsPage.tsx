import { useEffect, useRef, useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery } from "@tanstack/react-query";
import { api, AUTH_REQUIRED_EVENT, type ConfigResponse } from "./api.js";
import { SecureInput } from "./App.js";
interface SchemaResponse { schema: RJSFSchema; uiSchema: UiSchema }
interface Plan { id: string; risk: string; requiresConfirmation: boolean; changes: Array<{ path: string }> }
interface ConfigDocument extends Record<string, unknown> { integrations?: { linear?: { enabled: boolean; credentialRef?: string } } }
const validator = customizeValidator({ AjvClass: Ajv2020 });
const sectionNames: Record<string, string> = { controller: "控制台", runners: "运行设备", integrations: "兼容集成", connectors: "集成连接", repositories: "项目仓库", agentProfiles: "Agent 账号", internalLlm: "内部模型", policies: "策略" };
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
export default function SettingsPage(): React.JSX.Element {
  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api<ConfigResponse<ConfigDocument>>("/api/config") });
  const schemaQuery = useQuery({ queryKey: ["config-schema"], queryFn: () => api<SchemaResponse>("/api/config/schema") });
  const dirty = useRef(false);
  const [section, setSection] = useState("");
  const [draft, setDraft] = useState<ConfigDocument>();
  const [plan, setPlan] = useState<Plan>();
  const [appliedPlanId, setAppliedPlanId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (configQuery.data && !dirty.current) setDraft(structuredClone(configQuery.data.config)); }, [configQuery.data]);
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
      const response = await api<{ plan: Plan }>("/api/config/plans", { method: "POST", body: JSON.stringify({ config: draft ?? configQuery.data?.config, actor: "local-web" }) });
      setPlan(response.plan); setAppliedPlanId(undefined);
      setMessage(response.plan.changes.length === 0 ? "Configuration is already current." : "计划已生成，请审阅变更和风险。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "配置校验失败"); }
    finally { setBusy(false); }
  }
  async function applyPlan(): Promise<void> {
    if (!plan || busy) return;
    setBusy(true); setMessage("正在应用并验证…");
    try {
      await api(`/api/config/plans/${plan.id}/apply`, { method: "POST", body: JSON.stringify({ confirmed: plan.requiresConfirmation }) });
      setAppliedPlanId(plan.id); setPlan(undefined); dirty.current = false;
      await configQuery.refetch(); setMessage("配置已应用并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "应用失败，请检查当前配置版本。"); }
    finally { setBusy(false); }
  }
  async function rollbackPlan(): Promise<void> {
    if (!appliedPlanId || busy) return;
    setBusy(true); setMessage("正在回滚并验证…");
    try {
      await api(`/api/config/plans/${appliedPlanId}/rollback`, { method: "POST" });
      setAppliedPlanId(undefined); setPlan(undefined); dirty.current = false;
      await configQuery.refetch(); setMessage("配置已回滚并记录审计。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "回滚失败，当前版本保留。"); }
    finally { setBusy(false); }
  }
  if (configQuery.isLoading || schemaQuery.isLoading) return <div className="page-state" role="status">正在读取配置…</div>;
  if (configQuery.error || schemaQuery.error || !configQuery.data || !schemaQuery.data) return <div className="page-state error" role="alert"><strong>配置读取失败</strong><button onClick={() => { void configQuery.refetch(); void schemaQuery.refetch(); }}>重试</button></div>;
  const properties = schemaQuery.data.schema.properties ?? {};
  const sections = Object.keys(properties).filter((key) => key !== "schemaVersion");
  const currentSection = sections.includes(section) ? section : sections[0];
  const sectionSchema: RJSFSchema = currentSection ? { ...schemaQuery.data.schema, properties: { [currentSection]: properties[currentSection]! }, required: (schemaQuery.data.schema.required ?? []).filter((key) => key === currentSection) } : schemaQuery.data.schema;
  const currentDraft = draft ?? configQuery.data.config;
  return <section><header className="page-header"><div><h1>设置</h1><p>按分区编辑草稿，审阅变更后再应用。配置版本 {configQuery.data.revision}</p></div></header>
    <nav className="settings-sections" aria-label="设置分区">{sections.map((key) => <button key={key} disabled={busy} aria-pressed={currentSection === key} onClick={() => setSection(key)}>{sectionNames[key] ?? key}</button>)}</nav>
    <div className="settings-layout"><div className="panel config-form"><Form key={currentSection ?? "all"} schema={sectionSchema} uiSchema={schemaQuery.data.uiSchema} validator={validator} formData={currentSection ? { [currentSection]: currentDraft[currentSection] } : currentDraft} disabled={busy} noHtml5Validate experimental_defaultFormStateBehavior={{ emptyObjectFields: "skipDefaults", arrayMinItems: { populate: "never" }, allOf: "skipDefaults" }} onChange={({ formData }) => edit(formData as Record<string, unknown>)} onSubmit={() => void buildPlan()}><button type="submit" className="primary" disabled={busy}>预览配置变更</button></Form><p className="notice">其他分区的草稿保留；计划校验的是完整配置。</p></div>
    <aside className="settings-aside"><div className="panel plan-card" aria-live="polite"><h2>{plan ? "审阅配置计划" : appliedPlanId ? "已应用的计划" : "尚无待应用计划"}</h2><p>{message || "编辑字段后生成计划，草稿不会自动生效。"}</p>{plan && <><p>风险：{plan.risk} · {plan.changes.length} 项变更</p><ul className="plan-changes">{plan.changes.map((change, index) => <li key={index}>{change.path}</li>)}</ul></>}{plan && plan.changes.length > 0 && <button disabled={busy} className="primary" onClick={() => void applyPlan()}>{plan.requiresConfirmation ? "确认并应用" : "应用计划"}</button>}{appliedPlanId && <button disabled={busy} onClick={() => void rollbackPlan()}>回滚上次计划</button>}</div>
    <OwnerPasswordSettings />
    {currentDraft.integrations?.linear && <fieldset disabled={busy} className="panel"><h2>安全凭据</h2><p>凭据直接存入安全存储，不进入普通配置草稿。</p><SecureInput namespace="linear" name="main" label="Linear credential" onStored={(reference) => updateLinearCredential(reference)} onDeleted={() => updateLinearCredential()} /></fieldset>}</aside></div>
  </section>;
}
