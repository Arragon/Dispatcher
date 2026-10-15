import { useEffect, useState, type FormEvent } from "react";
import { Drawer } from "./Drawer.js";
import { Icon } from "./ui.js";
import { api } from "./api.js";

interface Workflow { id: string; revision: number; state: string; toolName: string; questions: string[]; result?: unknown }

export default function AssistantDrawer(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); setOpen((value) => !value); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [message, setMessage] = useState("描述要检查或修改的内容，也可输入 /fleet list 等确定性命令。");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setWorkflow(undefined);
    setMessage("正在生成计划…");
    try { const result = await api<{ workflow: Workflow; mode: string }>("/api/assistant/workflows", { method: "POST", body: JSON.stringify({ text }) }); setWorkflow(result.workflow); setMessage(result.mode === "DEGRADED_NO_LLM" ? "确定性命令模式" : "计划已生成"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "请求失败"); } finally { setBusy(false); }
  }
  async function act(action: "approve" | "execute"): Promise<void> {
    if (busy || !workflow) return;
    setBusy(true);
    try { const result = await api<{ workflow: Workflow }>(`/api/assistant/workflows/${workflow.id}/${action}`, { method: "POST", body: JSON.stringify({ revision: workflow.revision }) }); setWorkflow(result.workflow); setMessage(action === "approve" ? "计划已批准，审阅后点击执行。" : "操作已执行。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  }
  return <><button className="assistant-launcher" type="button" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="spark"/>配置助手<kbd>⌘ J</kbd></button>{open && <Drawer title="配置助手" onClose={() => setOpen(false)}><form onSubmit={(event) => void submit(event)}><label>要检查或修改什么？<textarea value={text} disabled={busy} onChange={(event) => { setText(event.target.value); setWorkflow(undefined); }} placeholder="/task status INH-42" /></label><button className="primary" type="submit" disabled={busy || !text.trim()}>{busy ? "处理中…" : "生成计划"}</button></form><p className="assistant-message" aria-live="polite">{message}</p>{workflow && <article className="workflow-card"><strong>{workflow.toolName}</strong><span className={`status status-${workflow.state.toLowerCase()}`}>{workflow.state}</span>{workflow.questions.map((question) => <p key={question}>{question}</p>)}{workflow.result !== undefined && <pre>{JSON.stringify(workflow.result, null, 2)}</pre>}<div className="secure-actions">{workflow.state === "NEEDS_APPROVAL" && <button disabled={busy} onClick={() => void act("approve")}>批准计划</button>}{workflow.state === "READY" && <button className="primary" disabled={busy} onClick={() => void act("execute")}>执行</button>}</div></article>}</Drawer>}</>;
}
