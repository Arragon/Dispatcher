import { RoutingDecision } from "./RoutingDecision.js";
import { NativeModelPicker,type NativeModelChoice } from "./NativeModelPicker.js";
import type { PublishDraftV1, PublicationPreview, PublicationReceipt, TaskModelRoutingConfig } from "@dispatcher/domain";
import { PublicationOutcome } from "./PublicationOutcome.js";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, type ConfigResponse } from "./api.js";
import { Drawer } from "./Drawer.js";
import { Icon, Notice, ProviderMark } from "./ui.js";
import { safeLink } from "./task-view.js";

interface Repository { id: string; root: string; defaultBaseRef: string; scopePaths: string[]; verificationCommands: Array<{id:string;required:boolean}> }
interface Profile { id: string; alias: string; provider: string; runnerId: string; enabled?: boolean; settings?: Record<string, unknown> }
interface Config { repositories: Repository[]; agentProfiles: Profile[]; policies?:{modelRouting?:TaskModelRoutingConfig} }
interface Draft { selectionMode:"manual"|"policy-auto";taskTypeId:string; clientDraftId:string; title: string; description: string; repositoryId: string; profileId: string; startMode: "create-only" | "dispatch"; acceptance: string; references: string; targetBranch: string; nativeModelId:string; reasoningEffort:string; catalogRevision:string; contextFingerprint:string; modelAccessAcknowledged:string }
const emptyDraft: Draft = {selectionMode:"manual",taskTypeId:"",clientDraftId:"",title:"",description:"",repositoryId:"",profileId:"",startMode:"create-only",acceptance:"",references:"",targetBranch:"",nativeModelId:"",reasoningEffort:"",catalogRevision:"",contextFingerprint:"",modelAccessAcknowledged:""};
const receiptKey = "dispatcher.publication-receipt.v1";
interface CommitReview { routingAccepted?:boolean; draft?:Draft; attempted?:boolean; publicationId:string;revision:number;reviewHash:string;key:string }
function restoreReview():CommitReview|undefined {
  try {
    const saved=JSON.parse(localStorage.getItem(receiptKey)??"null") as CommitReview|null;
    if(!saved||typeof saved.publicationId!=="string"||typeof saved.reviewHash!=="string"||typeof saved.key!=="string"||!Number.isInteger(saved.revision))return undefined;
    const {draft:storedDraft,...identity}=saved;
    return {...identity,...(storedDraft&&typeof storedDraft==="object"?{draft:readDraft(storedDraft as unknown as Record<string,unknown>)}:{})};
  }catch{return undefined;}
}
const draftKey = "dispatcher.publication-draft.v1";
function readDraft(source: Record<string,unknown>): Draft {
  return Object.fromEntries(Object.entries(emptyDraft).map(([key,value]) => [key, key === "selectionMode" ? source[key] === "policy-auto" ? "policy-auto" : "manual" : key === "startMode" ? source[key] === "dispatch" ? "dispatch" : "create-only" : typeof source[key] === "string" ? source[key] : value])) as unknown as Draft;
}
function restoreDraft(): Draft {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    if (!data || typeof data !== "object") return {...emptyDraft};
    const source = data as Record<string,unknown>;
    return readDraft(source);
  } catch { return {...emptyDraft}; }
}
function lines(value: string): string[] { return value.split("\n").map((line) => line.trim()).filter(Boolean); }
export default function PublishPage(): React.JSX.Element {
  const query = useQuery({queryKey:["config"],queryFn:()=>api<ConfigResponse<Config>>("/api/config")});
  const [params] = useSearchParams();
  const [draft, setDraft] = useState(() => {const restored=restoreDraft();return {...restored,clientDraftId:restored.clientDraftId||crypto.randomUUID(),...(params.get("profile")?{profileId:params.get("profile")!,nativeModelId:"",reasoningEffort:"",catalogRevision:"",contextFingerprint:"",modelAccessAcknowledged:""}:{}),...(params.get("repository")?{repositoryId:params.get("repository")!}:{})};});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [review, setReview] = useState(false);
  const [routingAccepted,setRoutingAccepted]=useState(false);
  const [preview,setPreview]=useState<PublicationPreview>();
  const [receipt,setReceipt]=useState<PublicationReceipt>();
  const [busy,setBusy]=useState(false);
  const pendingReview=useRef<CommitReview|undefined>(restoreReview());
  const draftGeneration=useRef(0);
  const operation=useRef(false);
  useEffect(()=>{let active=true;const stored=pendingReview.current;const generation=draftGeneration.current;if(stored)void api<PublicationPreview|PublicationReceipt>(`/api/task-publications/${stored.publicationId}`).then(value=>{if(!active)return;if("taskId" in value||generation===draftGeneration.current)acceptRead(value);else setSaved("当前草稿已修改；上次预检保留，可主动读取原回执。");}).catch(()=>{if(active)setError("上次发布回执读取失败；草稿已保留，请重新读取回执后继续。");});return()=>{active=false;};},[]);
  const saving = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [importing,setImporting] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(draftKey,JSON.stringify(draft)); }
    catch { setSaved("浏览器无法保存草稿，请使用备份下载。"); }
  },[draft]);
  const repositories = query.data?.config.repositories ?? [];
  const profiles = query.data?.config.agentProfiles ?? [];
  const repository = repositories.find((entry) => entry.id === draft.repositoryId);
  const profile = profiles.find((entry) => entry.id === draft.profileId);
  const generatedTitle = draft.description.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "未命名任务";
  const title = draft.title.trim() || (Array.from(generatedTitle).length > 80 ? `${Array.from(generatedTitle).slice(0,80).join("")}…` : generatedTitle);
  function edit(changes: Partial<Draft>): void { draftGeneration.current++; setDraft((current) => ({...current,...changes})); setError(""); setSaved(""); setReview(false); setPreview(undefined); }
  async function importDraft(file?:File):Promise<void> {
    if (!file || importing) return;
    setImporting(true); setError("");
    try {
      if(file.size > 256_000) throw new Error("草稿文件过大，请选择小于 256 KB 的备份。");
      const text = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("草稿读取失败"));reader.readAsText(file);});
      const data:unknown=JSON.parse(text);
      if(!data || typeof data !== "object" || !("schemaVersion" in data) || data.schemaVersion !== 1) throw new Error("不支持的草稿格式，请选择版本 1 的 JSON 备份。");
      const source=data as Record<string,unknown>;
      if(typeof source.description !== "string" || Object.keys(emptyDraft).some((key)=>source[key] !== undefined && typeof source[key] !== "string") || (source.startMode !== undefined && !["dispatch","create-only"].includes(String(source.startMode)))) throw new Error("草稿字段格式无效。");
      if ((draft.title || draft.description) && !window.confirm("导入会替换当前浏览器草稿，继续吗？建议先下载备份。")) return;
      edit({...readDraft(source),clientDraftId:typeof source.clientDraftId==="string"&&source.clientDraftId?source.clientDraftId:crypto.randomUUID()});setReview(false);setSaved("草稿已导入并保存在当前浏览器，尚未创建任务。");
    } catch(error) {setError(error instanceof SyntaxError ? "草稿不是有效的 JSON 文件。" : error instanceof Error ? error.message : "导入失败，当前草稿保留。");}
    finally {setImporting(false);if(importInput.current)importInput.current.value="";}
  }
  function backup(): void {
    if (saving.current) return;
    saving.current = true;
    const url = URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,...draft},null,2)],{type:"application/json"}));
    const link = document.createElement("a"); link.href=url; link.download="dispatcher-task-draft.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000); saving.current=false; setSaved("任务草稿已导出，未创建任务。");
  }
  async function check(reanalyze=false): Promise<void> {
    if(operation.current)return;
    if(pendingReview.current?.attempted&&!receipt){setError("上次提交尚未确认，请读取原回执或沿用原提交重试。");try{await recover();}catch{ /* Keep the original pending commit identity. */ }return;}
    if (!draft.description.trim()) { setError("请填写任务说明。"); return; }
    if (Array.from(draft.title).length > 160 || Array.from(draft.description).length > 20_000) { setError("标题最多 160 字，任务说明最多 20,000 字；请调整后重试。"); return; }
    if (lines(draft.references).some((value) => !safeLink(value))) { setError("参考链接只支持不含账号密码的 http / https 地址。"); return; }
    if (Array.from(draft.acceptance).length > 8_000 || Array.from(draft.references).length > 2_000 || Array.from(draft.targetBranch).length > 200) { setError("验收条件、参考链接或分支名称超出长度限制。"); return; }
    if (draft.startMode === "dispatch" && (!repository || !profile || profile.enabled === false || !draft.acceptance.trim())) { setError("立即派发需要已登记仓库、已启用账号和明确的验收条件。"); return; }
    setError("");operation.current=true;setBusy(true);const generation=draftGeneration.current;
    const payload:PublishDraftV1={schemaVersion:1,clientDraftId:draft.clientDraftId,title:draft.title,description:draft.description,projectId:repository?`local:${repository.id}`:"local:inbox",repositoryId:repository?.id??"",acceptanceCriteria:lines(draft.acceptance),referenceLinks:lines(draft.references),scopePaths:repository?(repository.scopePaths.length?repository.scopePaths:["."]):[],verificationCommandIds:repository?.verificationCommands.map(c=>c.id)??[],...(draft.targetBranch?{targetBranch:draft.targetBranch}:{}),startMode:draft.startMode,execution:draft.selectionMode==="policy-auto"?{selectionMode:"policy-auto",...(profile?{profileId:profile.id}:{}),...(draft.taskTypeId?{taskTypeId:draft.taskTypeId}:{}),allowUnconfirmedModelAccess:draft.modelAccessAcknowledged==="yes"}:{selectionMode:"manual",selectionType:draft.nativeModelId?"explicit-model":"native-default",...(profile?{profileId:profile.id}:{}),...(draft.nativeModelId?{nativeModelId:draft.nativeModelId,nativeParameters:draft.reasoningEffort?{reasoningEffort:draft.reasoningEffort}:{},catalogRevision:draft.catalogRevision,contextFingerprint:draft.contextFingerprint,allowUnconfirmedModelAccess:draft.modelAccessAcknowledged==="yes"}:{})},delivery:{type:"none"}};
    try {if(reanalyze)await api("/api/model-routing/preview?reanalyze=true",{method:"POST",body:JSON.stringify(payload)});const value=await api<PublicationPreview>("/api/task-publications/preview",{method:"POST",body:JSON.stringify(payload)});if(generation!==draftGeneration.current)return;if(!value.publicationId)throw new Error("服务端没有返回有效预检，请检查后重试。");const pending={draft:structuredClone(draft),publicationId:value.publicationId,revision:value.revision,reviewHash:value.confirmation.reviewHash,key:crypto.randomUUID()};localStorage.setItem(receiptKey,JSON.stringify(pending));pendingReview.current=pending;setPreview(value);setRoutingAccepted(false);setReceipt(undefined);setReview(true);}catch(error){setError(error instanceof Error?error.message:"预检失败，草稿保留。");}finally{operation.current=false;setBusy(false);}
  }
  function acceptRead(value:PublicationPreview|PublicationReceipt):void {
    const pending=pendingReview.current;
    if(pending&&("taskId" in value||value.state==="NEEDS_REVIEW")){
      pending.attempted=false;try{localStorage.setItem(receiptKey,JSON.stringify(pending));}catch{setSaved("回执已读取，浏览器存储不可用，请保留任务 ID。");}
    }
    if("taskId" in value){setReceipt(value);setReview(false);}else{setPreview(value);setRoutingAccepted(pending?.routingAccepted===true);setReview(true);}
  }
  async function recover():Promise<void> {
    const pending=pendingReview.current;if(!pending)return;
    const value=await api<PublicationPreview|PublicationReceipt>(`/api/task-publications/${pending.publicationId}`);
    acceptRead(value);
  }
  async function commit():Promise<void> {
    const pending=pendingReview.current;if(operation.current||!preview?.canCommit||!pending||pending.draft?.description!==preview.effectiveTask.description)return;
    operation.current=true;setBusy(true);setError("");
    try {pending.routingAccepted=pending.attempted?pending.routingAccepted===true:routingAccepted;localStorage.setItem(receiptKey,JSON.stringify({...pending,attempted:true}));pending.attempted=true;const value=await api<PublicationReceipt>(`/api/task-publications/${pending.publicationId}/commit`,{method:"POST",headers:{"Idempotency-Key":pending.key},body:JSON.stringify({revision:pending.revision,reviewHash:pending.reviewHash,confirmation:{accepted:true,...(preview.routingDecision?{routingAccepted:pending.routingAccepted===true}:{})}})});acceptRead(value);}
    catch(error){setError(error instanceof Error?error.message:"提交结果未知，请读取回执。");try{await recover();}catch{setError("提交结果未知。请保留当前草稿与回执，重新登录后读取回执，避免重复创建。");}}
    finally{operation.current=false;setBusy(false);}
  }
  const semanticAnalysis=draft.selectionMode==="policy-auto"&&!draft.taskTypeId&&query.data?.config.policies?.modelRouting?.classificationMode==="hybrid";
  const reviewedDraft=pendingReview.current?.draft;
  const reviewBound=Boolean(reviewedDraft&&reviewedDraft.description===preview?.effectiveTask.description);
  return <section className="publish-page">
    <header className="page-header"><div><h1>发布任务</h1><p>描述你想完成的工作，选择项目与执行方式。</p></div><div className="page-actions"><input ref={importInput} aria-label="导入任务草稿" type="file" hidden accept="application/json,.json" onChange={(event)=>void importDraft(event.target.files?.[0])}/><button disabled={importing} onClick={()=>importInput.current?.click()}><Icon name="folder"/>{importing ? "导入中…" : "导入草稿"}</button><button onClick={backup}><Icon name="download"/>备份草稿</button><Link className="button-link" to="/tasks">查看任务</Link></div></header>
    <Notice tone="neutral">提交前先完成服务端预检。仅创建会保留待完善任务；立即派发会在确认后启动原生 Agent。</Notice>
    {receipt && <><PublicationOutcome receipt={receipt}/><button disabled={busy} onClick={()=>{setDraft({...emptyDraft,clientDraftId:crypto.randomUUID()});setReceipt(undefined);setPreview(undefined);setReview(false);pendingReview.current=undefined;localStorage.removeItem(receiptKey);setError("");setSaved("已开始新草稿，原任务保留在任务页。");}}>开始新任务草稿</button></>}
    {pendingReview.current && <button disabled={busy} onClick={()=>void recover().catch(e=>setError(e instanceof Error?e.message:"回执读取失败"))}>重新读取发布回执</button>}
    {query.error && <Notice tone="error">项目与账号读取失败。<button onClick={() => void query.refetch()}>重新读取</button>草稿可继续编辑。</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="publish-layout"><div className="publish-left">
      <article className="panel publish-project"><header className="composer-heading"><span className="step-number">1</span><h2>选择项目</h2><Link to="/repositories">管理仓库</Link></header><label>项目仓库<select value={draft.repositoryId} onChange={(event) => edit({repositoryId:event.target.value,nativeModelId:"",reasoningEffort:"",catalogRevision:"",contextFingerprint:"",modelAccessAcknowledged:""})} disabled={query.isLoading}><option value="">{query.isLoading ? "正在读取仓库…" : "选择已登记的项目仓库"}</option>{repositories.map((entry) => <option value={entry.id} key={entry.id}>{entry.id}</option>)}</select></label><div className="project-context"><span><Icon name="folder" size={14}/>{repository?.root ?? "尚未选择项目"}</span><span><Icon name="branch" size={14}/>{repository?.defaultBaseRef ?? "基准分支未确定"}</span></div><p className="composer-hint"><Icon name="shield" size={14}/>实际执行将使用受管工作目录，项目路径不会作为账号配置目录。</p></article>
      <article className="panel flush-panel"><header className="composer-editor-heading"><span className="step-number">2</span><h2>描述任务</h2><span className="pill">Markdown</span></header><div className="composer-editor"><input className="composer-title" aria-label="任务标题" placeholder="任务标题（可选，可从正文生成）" value={draft.title} onChange={(event) => edit({title:event.target.value})}/><textarea className="composer-description" aria-label="任务说明" placeholder={'你想完成什么？\n\n补充背景、目标、需要注意的约束，以及你期望的结果。'} value={draft.description} onChange={(event) => edit({description:event.target.value})}/><div className="composer-templates"><span>从模板开始</span>{[["修复问题","## 问题现象\n\n## 复现步骤\n\n## 预期行为\n"],["开发功能","## 功能目标\n\n## 使用场景\n\n## 约束与边界\n"],["代码审查","## 审查范围\n\n## 重点关注\n\n## 输出要求\n"]].map(([name,text]) => <button key={name} onClick={() => edit({description:`${draft.description}${draft.description ? "\n\n" : ""}${text}`})}>{name}</button>)}</div></div><footer className="composer-footer"><span><Icon name="shield" size={12}/>草稿仅保存在当前浏览器</span><span>{Array.from(draft.description).length.toLocaleString()} / 20,000 字</span></footer></article>
      <details className="composer-details"><summary><Icon name="check"/><strong>验收与参考</strong><small>明确完成条件</small><Icon name="chevron" size={14}/></summary><div><label>验收条件（每行一条）<textarea value={draft.acceptance} onChange={(event) => edit({acceptance:event.target.value})} placeholder="例如：保留现有接口行为，相关回归测试通过"/></label><label>参考链接（每行一条）<textarea value={draft.references} onChange={(event) => edit({references:event.target.value})} placeholder="https://…"/></label><p className="muted">链接作为引用保存，不会自动访问或下载。</p></div></details>
      <details className="composer-details"><summary><Icon name="branch"/><strong>执行范围与交付</strong><small>继承项目设置</small><Icon name="chevron" size={14}/></summary><div><label>目标分支（可选）<input value={draft.targetBranch} onChange={(event) => edit({targetBranch:event.target.value})} placeholder="由服务端创建受管分支"/></label><dl className="details-grid"><div><dt>允许修改的范围</dt><dd>{repository ? repository.scopePaths.join("、") || "整个仓库（.）" : "项目尚未登记执行范围"}</dd></div><div><dt>已登记验证命令</dt><dd>{repository?.verificationCommands.map((entry) => `${entry.id}${entry.required ? "（必需）" : ""}`).join("、") || "未登记"}</dd></div><div><dt>交付方式</dt><dd>本地结果 · 保留工作区，验证后人工验收</dd></div><div><dt>模型选择方式</dt><dd>{draft.selectionMode==="policy-auto"?"Policy 自动路由 · 仅限已选账号":"手动选择"}</dd></div></dl></div></details>
    </div><aside className="publish-side"><article className="panel flush-panel"><header className="panel-heading"><h2>执行设置</h2><Icon name="settings" size={16}/></header><div className="publish-setting"><label>执行方式<select value={draft.startMode} onChange={(event) => edit({startMode:event.target.value as Draft["startMode"]})}><option value="create-only">仅创建，稍后派发</option><option value="dispatch">立即派发</option></select></label><p>{draft.startMode === "create-only" ? "保存为待派发或待完善任务，不启动 Agent。" : "通过预检并确认后，才会开始执行。"}</p></div><div className="publish-setting"><label>Harness 账号<select value={draft.profileId} onChange={(event) => edit({profileId:event.target.value,nativeModelId:"",reasoningEffort:"",catalogRevision:"",contextFingerprint:"",modelAccessAcknowledged:""})}><option value="">选择执行账号</option>{profiles.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.enabled === false}>{entry.alias}{entry.enabled === false ? "（已停用）" : ""}</option>)}</select></label>{profile && <div className="selected-profile"><ProviderMark provider={profile.provider}/><div><strong>{profile.alias}</strong><small>{profile.provider} · {profile.runnerId === "local" ? "本机" : profile.runnerId}</small></div></div>}<p>账号启用、登录验证和设备在线分别检查。</p></div><div className="publish-setting"><label>模型选择方式<select value={draft.selectionMode} onChange={event=>edit({selectionMode:event.target.value as Draft["selectionMode"],taskTypeId:"",nativeModelId:"",reasoningEffort:"",catalogRevision:"",contextFingerprint:"",modelAccessAcknowledged:""})}><option value="manual">本次手动指定</option><option value="policy-auto" disabled={!query.data?.config.policies?.modelRouting?.enabled}>Policy 自动匹配{!query.data?.config.policies?.modelRouting?.enabled?"（策略未启用）":""}</option></select></label></div>{draft.selectionMode==="policy-auto"?<div className="publish-setting"><p>仅在已选账号内匹配。未命中、冲突或目录失效会阻止执行。点击检查时才分类。</p>{semanticAnalysis&&<Notice>混合模式将标题和任务说明发送到已配置的内部分类模型。分析有独立用量记录；重复读取目录不会再次推理。</Notice>}<label>任务类型<select value={draft.taskTypeId} onChange={event=>edit({taskTypeId:event.target.value})}><option value="">由策略识别</option>{query.data?.config.policies?.modelRouting?.taskTypes.filter(type=>type.enabled).map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label><input type="checkbox" checked={draft.modelAccessAcknowledged==="yes"} onChange={event=>edit({modelAccessAcknowledged:event.target.checked?"yes":""})}/>知悉目录不代表模型访问权限</label>{draft.startMode==="create-only"&&<p>仅创建不分类，派发前需要重新审阅模型选择。</p>}</div>:<div className="publish-setting"><NativeModelPicker key={`${draft.profileId}:${draft.repositoryId}`} profileId={draft.profileId} repositoryId={draft.repositoryId} {...(query.data?{configRevision:query.data.revision}:{})} value={{modelId:draft.nativeModelId,effort:draft.reasoningEffort,catalogRevision:draft.catalogRevision,contextFingerprint:draft.contextFingerprint,allowUnconfirmed:draft.modelAccessAcknowledged==="yes"}} onChange={(choice:NativeModelChoice)=>edit({nativeModelId:choice.modelId,reasoningEffort:choice.effort,catalogRevision:choice.catalogRevision,contextFingerprint:choice.contextFingerprint,modelAccessAcknowledged:choice.allowUnconfirmed?"yes":""})}/></div>}<footer className="table-footer">选择与参数将随 Run 冻结，启动前重新核验。</footer></article><div className="publish-checks"><h3>正式发布所需条件</h3><p><Icon name="check" size={14}/>项目与执行范围</p><p><Icon name="check" size={14}/>账号、设备与模型证据</p><p><Icon name="check" size={14}/>验收条件与验证命令</p><p><Icon name="check" size={14}/>完整任务正文与交付方式</p></div></aside></div>
    <footer className="publish-bar"><div><Icon name="shield"/><span>{draft.startMode === "create-only" ? "仅创建，稍后派发" : "立即派发前需要确认"}<small>{saved || (receipt?"已创建任务；再次发布前请编辑草稿并重新审阅。":"草稿自动保存在当前浏览器，尚未提交到服务端。")}</small></span></div><div className="page-actions"><button onClick={backup}>备份草稿</button>{semanticAnalysis&&<button disabled={busy} onClick={()=>void check(true)}>重新分析并审阅</button>}<button className="primary" disabled={busy} onClick={()=>void check()}><Icon name="check"/>{busy?"处理中…":semanticAnalysis?"分析并审阅（调用内部模型）":"检查并审阅"}</button></div></footer>
    {review && <Drawer variant="modal" title="审阅任务草稿" onClose={() => {if(!busy)setReview(false);}}><Notice tone="neutral">服务端预检回执：{preview?.publicationId} · {preview?.effectiveTask.contractState} · {preview?.expiresAt}</Notice>{preview?.checks.map(check=><p key={check.id}>{check.status} · {check.message}</p>)}<dl className="details-grid"><div><dt>任务标题</dt><dd>{preview?.effectiveTask.title??title}</dd></div><div><dt>执行方式</dt><dd>{reviewedDraft?.startMode === "create-only" ? "仅创建" : "立即派发"}</dd></div><div><dt>项目仓库</dt><dd>{reviewedDraft?.repositoryId || "未选择 · 待完善"}</dd></div><div><dt>执行账号</dt><dd>{preview?.effectiveExecution?.profileId || reviewedDraft?.profileId || "未选择"}</dd></div></dl>{!reviewBound&&<Notice tone="warning">旧回执缺少对应草稿快照，请关闭此窗口并重新检查。已尝试提交的发布须先读取原回执。</Notice>}<h3>服务端执行选择</h3><p>{preview?.effectiveExecution?`${preview.effectiveExecution.profileId} · ${preview.effectiveExecution.selectionType} · ${preview.effectiveExecution.nativeModelId??"沿用原生配置"} · ${JSON.stringify(preview.effectiveExecution.nativeParameters)}`:"仅创建任务，不启动执行"}</p>{preview?.routingDecision&&<><RoutingDecision decision={preview.routingDecision}/>{preview.routingDecision.confirmation.required&&<label><input type="checkbox" checked={routingAccepted} onChange={event=>setRoutingAccepted(event.target.checked)}/>确认本次自动路由选择</label>}</>}<h3>完整任务说明</h3><pre>{preview?.effectiveTask.description}</pre><h3>验收条件</h3><p>{reviewedDraft?.acceptance || "未填写 · 待完善"}</p><button disabled={busy || !preview?.canCommit || !reviewBound || Boolean(preview?.routingDecision?.confirmation.required&&!routingAccepted)} className="primary" onClick={()=>void commit()}>{busy?"正在提交…":reviewedDraft?.startMode==="dispatch"?"确认并启动执行":"确认并创建任务"}</button><button onClick={backup}>下载草稿备份</button></Drawer>}
  </section>;
}
