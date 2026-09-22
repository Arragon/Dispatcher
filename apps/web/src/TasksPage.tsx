import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, subscribeToEvents } from "./api.js";

interface Page<T> { items: T[]; total: number; offset: number; limit: number; }
interface TaskRow { id: string; projectId: string; title: string; state: string; updatedAt: string; externalRefs?: Array<{ connectorInstanceId: string; externalId: string }> }
interface RunRow { id: string; taskId: string; profileId: string; state: string; updatedAt: string; summary?: string }

export default function TasksPage(): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState("");
  const tasks = useQuery({ queryKey: ["fleet-tasks", offset, state], queryFn: () => api<{ page: Page<TaskRow> }>(`/api/fleet/tasks?offset=${offset}&limit=50${state ? `&state=${encodeURIComponent(state)}` : ""}`), retry: false });
  const runs = useQuery({ queryKey: ["fleet-runs"], queryFn: () => api<{ page: Page<RunRow> }>("/api/fleet/runs?limit=100"), retry: false });
  useEffect(() => subscribeToEvents(() => { void tasks.refetch(); void runs.refetch(); }), [tasks.refetch, runs.refetch]);
  if (tasks.isLoading || runs.isLoading) return <div className="page-state">Loading tasks and runs…</div>;
  if (tasks.error || runs.error || !tasks.data || !runs.data) return <div className="page-state error">Task read model is unavailable.</div>;
  return <section><header className="page-header"><div><p className="eyebrow">Canonical truth</p><h1>Tasks & Runs</h1><p>Tasks describe desired state; every execution attempt remains independently traceable.</p></div></header>
    <div className="toolbar"><label>Task state<select value={state} onChange={(event) => { setState(event.target.value); setOffset(0); }}><option value="">All</option>{["READY", "RUNNING", "WAITING_USER", "WAITING_RESOURCE", "VERIFYING", "REVIEW", "DONE", "FAILED"].map((value) => <option key={value}>{value}</option>)}</select></label><span>{tasks.data.page.total.toLocaleString()} tasks · {runs.data.page.total.toLocaleString()} runs</span></div>
    <div className="panel table-wrap"><table><thead><tr><th>Task</th><th>Project / external</th><th>State</th><th>Updated</th></tr></thead><tbody>{tasks.data.page.items.map((task) => <tr key={task.id}><td><strong>{task.title}</strong><small>{task.id}</small></td><td>{task.projectId}<small>{task.externalRefs?.map((ref) => ref.externalId).join(", ")}</small></td><td><span className={`status status-${task.state.toLowerCase()}`}>{task.state}</span></td><td>{new Date(task.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>
    <div className="pager"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>{tasks.data.page.total ? offset + 1 : 0}–{Math.min(offset + 50, tasks.data.page.total)}</span><button disabled={offset + 50 >= tasks.data.page.total} onClick={() => setOffset(offset + 50)}>Next</button></div>
    <div className="panel table-wrap"><div className="panel-heading"><div><p className="eyebrow">Execution history</p><h2>Latest runs</h2></div></div><table><thead><tr><th>Run</th><th>Task</th><th>Profile</th><th>State</th><th>Activity</th></tr></thead><tbody>{runs.data.page.items.map((run) => <tr key={run.id}><td>{run.id}</td><td>{run.taskId}</td><td>{run.profileId}</td><td><span className={`status status-${run.state.toLowerCase()}`}>{run.state}</span></td><td>{run.summary ?? new Date(run.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>
  </section>;
}
