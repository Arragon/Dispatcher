import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, subscribeToEvents } from "./api.js";

interface FleetSnapshot {
  generatedAt: string;
  counts: { tasks: number; activeRuns: number; waiting: number; stalled: number; failed: number; unhealthyConnectors: number };
  profiles: Array<{ id: string; alias: string; provider: string; state: string; resourceState?: string }>;
  attention: Array<{ id: string; kind: string; title: string; detail: string; since: string }>;
}

export default function FleetPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["fleet"], queryFn: () => api<{ snapshot: FleetSnapshot }>("/api/fleet"), retry: false });
  useEffect(() => subscribeToEvents(() => void query.refetch()), [query.refetch]);
  if (query.isLoading) return <div className="page-state">Building Fleet read model…</div>;
  if (query.error || !query.data) return <div className="page-state error">Fleet state is unavailable.</div>;
  const fleet = query.data.snapshot;
  return <section>
    <header className="page-header"><div><p className="eyebrow">Live read model v2</p><h1>Overview / Fleet</h1><p>Agent, profile, project and task views converge on one rebuildable snapshot.</p></div><span className="status">LIVE</span></header>
    <div className="metric-grid">
      <article className="metric"><p>Canonical tasks</p><strong>{fleet.counts.tasks}</strong><small>{fleet.counts.activeRuns} active runs</small></article>
      <article className="metric"><p>Needs attention</p><strong>{fleet.counts.waiting + fleet.counts.stalled + fleet.counts.failed}</strong><small>{fleet.counts.waiting} waiting · {fleet.counts.stalled} stalled</small></article>
      <article className="metric"><p>Agent profiles</p><strong>{fleet.profiles.length}</strong><small>{fleet.profiles.map((profile) => profile.provider).join(" · ") || "none"}</small></article>
      <article className="metric"><p>Connector health</p><strong>{fleet.counts.unhealthyConnectors ? "Degraded" : "Healthy"}</strong><small>{fleet.counts.unhealthyConnectors} need recovery</small></article>
    </div>
    <div className="two-column">
      <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Need attention</p><h2>Actionable blockers</h2></div><span>{fleet.attention.length}</span></div>{fleet.attention.length ? <div className="runner-list">{fleet.attention.map((item) => <article className="runner-row" key={item.id}><div className="runner-avatar">!</div><div><strong>{item.title}</strong><p>{item.kind} · {item.detail}</p></div><small>{new Date(item.since).toLocaleTimeString()}</small></article>)}</div> : <div className="empty-inline">No intervention is required.</div>}</div>
      <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Capacity</p><h2>Profiles</h2></div></div><div className="runner-list">{fleet.profiles.map((profile) => <article className="runner-row" key={profile.id}><div className="runner-avatar">{profile.alias.slice(0, 2).toUpperCase()}</div><div><strong>{profile.alias}</strong><p>{profile.provider} · {profile.resourceState ?? "UNKNOWN"}</p></div><span className={`status status-${profile.state.toLowerCase()}`}>{profile.state}</span></article>)}</div></div>
    </div>
    <p className="snapshot-time">Snapshot rebuilt {new Date(fleet.generatedAt).toLocaleString()} · updates arrive over bounded cursor SSE.</p>
  </section>;
}
