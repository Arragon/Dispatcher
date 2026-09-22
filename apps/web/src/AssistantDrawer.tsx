import { useState, type FormEvent } from "react";
import { api } from "./api.js";

interface Workflow { id: string; revision: number; state: string; toolName: string; questions: string[]; result?: unknown }

export default function AssistantDrawer(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [workflow, setWorkflow] = useState<Workflow>();
  const [message, setMessage] = useState("Use natural language or a deterministic command such as /fleet list.");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!text.trim()) return;
    setMessage("Building a typed plan…");
    try { const result = await api<{ workflow: Workflow; mode: string }>("/api/assistant/workflows", { method: "POST", body: JSON.stringify({ text }) }); setWorkflow(result.workflow); setMessage(result.mode === "DEGRADED_NO_LLM" ? "Deterministic command mode" : "Plan ready"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Assistant request failed"); }
  }
  async function act(action: "approve" | "execute"): Promise<void> {
    if (!workflow) return;
    try { const result = await api<{ workflow: Workflow }>(`/api/assistant/workflows/${workflow.id}/${action}`, { method: "POST", body: JSON.stringify({ revision: workflow.revision }) }); setWorkflow(result.workflow); setMessage(action === "approve" ? "Plan approved; review before execution." : "Workflow executed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Workflow action failed"); }
  }
  return <><button className="assistant-launcher" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>✦ Assistant</button>{open && <aside className="assistant-drawer" aria-label="Configuration assistant"><div className="panel-heading"><div><p className="eyebrow">Typed Intent v2</p><h2>Dispatcher Assistant</h2></div><button aria-label="Close assistant" onClick={() => setOpen(false)}>×</button></div><form onSubmit={(event) => void submit(event)}><label>What would you like to inspect or change?<textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="/task status INH-42" /></label><button className="primary" type="submit">Build plan</button></form><p className="assistant-message" aria-live="polite">{message}</p>{workflow && <article className="workflow-card"><strong>{workflow.toolName}</strong><span className={`status status-${workflow.state.toLowerCase()}`}>{workflow.state}</span>{workflow.questions.map((question) => <p key={question}>{question}</p>)}{workflow.result !== undefined && <pre>{JSON.stringify(workflow.result, null, 2)}</pre>}<div className="secure-actions">{workflow.state === "NEEDS_APPROVAL" && <button onClick={() => void act("approve")}>Approve</button>}{workflow.state === "READY" && <button className="primary" onClick={() => void act("execute")}>Execute</button>}</div></article>}</aside>}</>;
}
