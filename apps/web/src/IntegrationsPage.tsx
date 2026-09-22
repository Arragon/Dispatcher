import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

interface Connector { id: string; displayName: string; kind: string; health: string; checkedAt: string; source?: string; reason?: string; pendingOutbox?: number; deadLetters?: number; capabilities?: string[] }
interface DeadLetter { id: string; connectorInstanceId: string; source: "inbox" | "outbox" | "reconcile"; sourceId: string; reason: string; createdAt: string }

export default function IntegrationsPage(): React.JSX.Element {
  const connectors = useQuery({ queryKey: ["fleet-connectors"], queryFn: () => api<{ connectors: Connector[] }>("/api/fleet/connectors"), retry: false });
  const deadLetters = useQuery({ queryKey: ["connector-dead-letters"], queryFn: () => api<{ deadLetters: DeadLetter[] }>("/api/connectors/dead-letters"), retry: false });
  const [message, setMessage] = useState("Recovery actions are explicit and auditable.");

  async function refresh(): Promise<void> { await Promise.all([connectors.refetch(), deadLetters.refetch()]); }
  async function test(id: string): Promise<void> { try { const result = await api<{ probe: { health: string; checkedAt: string } }>(`/api/connectors/${id}/test`, { method: "POST" }); setMessage(`${id}: ${result.probe.health} at ${new Date(result.probe.checkedAt).toLocaleTimeString()}`); await connectors.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Probe failed"); } }
  async function reconcile(id: string): Promise<void> { try { const result = await api<{ applied: number; conflicts: number }>(`/api/connectors/${id}/reconcile`, { method: "POST" }); setMessage(`${id}: reconciled ${result.applied}, conflicts ${result.conflicts}`); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Reconcile failed"); } }
  async function retry(id: string): Promise<void> { try { await api(`/api/connectors/dead-letters/${id}/retry`, { method: "POST" }); setMessage(`${id}: queued for retry`); await deadLetters.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Retry failed"); } }
  async function resolveDeadLetter(id: string): Promise<void> {
    if (!window.confirm(`Resolve dead letter ${id}? This removes it from the active recovery queue.`)) return;
    try { await api(`/api/connectors/dead-letters/${id}/resolve`, { method: "POST" }); setMessage(`${id}: marked resolved`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Resolve failed"); }
  }

  if (connectors.isLoading || deadLetters.isLoading) return <div className="page-state">Loading connector registry…</div>;
  if (connectors.error || deadLetters.error || !connectors.data || !deadLetters.data) return <div className="page-state error">Connector registry is unavailable.</div>;
  return <section>
    <header className="page-header"><div><p className="eyebrow">Capability registry</p><h1>Integrations</h1><p>Connector failures remain isolated from agent health and expose their source, backlog and recovery state.</p></div></header>
    <div className="panel"><div className="runner-list">{connectors.data.connectors.map((connector) => <article className="connector-card" key={connector.id}><div><strong>{connector.displayName}</strong><p>{connector.kind} · {connector.id}</p></div><span className={`status status-${connector.health.toLowerCase()}`}>{connector.health}</span><dl><div><dt>Health evidence</dt><dd>{connector.source ?? "configuration"} · {new Date(connector.checkedAt).toLocaleString()}</dd></div><div><dt>Pending</dt><dd>{connector.pendingOutbox ?? 0}</dd></div><div><dt>Dead letters</dt><dd>{connector.deadLetters ?? 0}</dd></div><div><dt>Capabilities</dt><dd>{connector.capabilities?.join(", ") || "none"}</dd></div></dl><div className="secure-actions"><button onClick={() => void test(connector.id)}>Test connection</button>{connector.kind === "task" && <button onClick={() => void reconcile(connector.id)}>Reconcile</button>}</div></article>)}</div>{connectors.data.connectors.length === 0 && <div className="empty-inline">No connectors configured.</div>}</div>
    <div className="panel table-wrap"><div className="panel-heading"><div><p className="eyebrow">Sync recovery</p><h2>Dead letters</h2></div><span>{deadLetters.data.deadLetters.length}</span></div>{deadLetters.data.deadLetters.length ? <table><thead><tr><th>Connector / source</th><th>Reason</th><th>Created</th><th>Recovery</th></tr></thead><tbody>{deadLetters.data.deadLetters.map((entry) => <tr key={entry.id}><td><strong>{entry.connectorInstanceId}</strong><small>{entry.source} · {entry.sourceId}</small></td><td>{entry.reason}</td><td>{new Date(entry.createdAt).toLocaleString()}</td><td><div className="secure-actions"><button disabled={entry.source !== "outbox"} title={entry.source === "outbox" ? "Return the failed outbox event to the delivery queue" : "Only outbox delivery failures can be retried automatically"} onClick={() => void retry(entry.id)}>Retry</button><button onClick={() => void resolveDeadLetter(entry.id)}>Resolve…</button></div></td></tr>)}</tbody></table> : <div className="empty-inline">No sync recovery is required.</div>}</div>
    <div className="panel notice" aria-live="polite">{message}</div>
  </section>;
}
