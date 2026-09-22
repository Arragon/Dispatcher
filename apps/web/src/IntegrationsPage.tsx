import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

interface Connector { id: string; displayName: string; kind: string; health: string; checkedAt: string; reason?: string; pendingOutbox?: number; deadLetters?: number; capabilities?: string[] }

export default function IntegrationsPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["fleet-connectors"], queryFn: () => api<{ connectors: Connector[] }>("/api/fleet/connectors"), retry: false });
  const [message, setMessage] = useState("Recovery actions are explicit and auditable.");
  async function test(id: string): Promise<void> { try { const result = await api<{ probe: { health: string; checkedAt: string } }>(`/api/connectors/${id}/test`, { method: "POST" }); setMessage(`${id}: ${result.probe.health} at ${new Date(result.probe.checkedAt).toLocaleTimeString()}`); await query.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "Probe failed"); } }
  if (query.isLoading) return <div className="page-state">Loading connector registry…</div>;
  if (query.error || !query.data) return <div className="page-state error">Connector registry is unavailable.</div>;
  return <section><header className="page-header"><div><p className="eyebrow">Capability registry</p><h1>Integrations</h1><p>Connector failures remain isolated from agent health and expose their source, backlog and recovery state.</p></div></header><div className="panel"><div className="runner-list">{query.data.connectors.map((connector) => <article className="connector-card" key={connector.id}><div><strong>{connector.displayName}</strong><p>{connector.kind} · {connector.id}</p></div><span className={`status status-${connector.health.toLowerCase()}`}>{connector.health}</span><dl><div><dt>Pending</dt><dd>{connector.pendingOutbox ?? 0}</dd></div><div><dt>Dead letters</dt><dd>{connector.deadLetters ?? 0}</dd></div><div><dt>Capabilities</dt><dd>{connector.capabilities?.join(", ") || "none"}</dd></div></dl><button onClick={() => void test(connector.id)}>Test connection</button></article>)}</div>{query.data.connectors.length === 0 && <div className="empty-inline">No connectors configured.</div>}</div><div className="panel notice" aria-live="polite">{message}</div></section>;
}
