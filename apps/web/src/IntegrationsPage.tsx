import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Drawer } from "./Drawer.js";
import { Icon, Notice, Tabs } from "./ui.js";
const SettingsPage=lazy(()=>import("./SettingsPage.js"));
import { api } from "./api.js";

interface Connector { id: string; displayName: string; kind: string; health: string; checkedAt: string; source?: string; reason?: string; pendingOutbox?: number; deadLetters?: number; capabilities?: string[] }
interface DeadLetter { id: string; connectorInstanceId: string; source: "inbox" | "outbox" | "reconcile"; sourceId: string; reason: string; createdAt: string }

export default function IntegrationsPage(): React.JSX.Element {
  const connectors = useQuery({ queryKey: ["fleet-connectors"], queryFn: () => api<{ connectors: Connector[] }>("/api/fleet/connectors"), retry: false });
  const deadLetters = useQuery({ queryKey: ["connector-dead-letters"], queryFn: () => api<{ deadLetters: DeadLetter[] }>("/api/connectors/dead-letters"), retry: false });
  const [view,setView]=useState("connections");
  const [editor,setEditor]=useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("同步失败会独立记录，可在这里检查并恢复。");

  async function refresh(): Promise<void> { await Promise.all([connectors.refetch(), deadLetters.refetch()]); }
  async function test(id: string): Promise<void> { if (busy) return; setBusy(true); try { const result = await api<{ probe: { health: string; checkedAt: string } }>(`/api/connectors/${id}/test`, { method: "POST" }); setMessage(`${id}: ${result.probe.health} at ${new Date(result.probe.checkedAt).toLocaleTimeString()}`); await connectors.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "连接测试失败"); } finally { setBusy(false); } }
  async function reconcile(id: string): Promise<void> { if (busy) return; setBusy(true); try { const result = await api<{ applied: number; conflicts: number }>(`/api/connectors/${id}/reconcile`, { method: "POST" }); setMessage(`${id}: reconciled ${result.applied}, conflicts ${result.conflicts}`); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); } finally { setBusy(false); } }
  async function retry(id: string): Promise<void> { if (busy) return; setBusy(true); try { await api(`/api/connectors/dead-letters/${id}/retry`, { method: "POST" }); setMessage(`${id}: queued for retry`); await deadLetters.refetch(); } catch (error) { setMessage(error instanceof Error ? error.message : "重试失败"); } finally { setBusy(false); } }
  async function resolveDeadLetter(id: string): Promise<void> {
    if (busy) return;
    if (!window.confirm(`将 ${id} 标记为已处理？它将移出活动恢复队列，此操作不代表同步成功。`)) return;
    setBusy(true);
    try { await api(`/api/connectors/dead-letters/${id}/resolve`, { method: "POST" }); setMessage(`${id}: marked resolved`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "处理失败"); } finally { setBusy(false); }
  }

  if (connectors.isLoading) return <div className="page-state">正在读取集成…</div>;
  if (connectors.error || !connectors.data) return <div className="page-state error" role="alert">集成读取失败。<button disabled={busy} onClick={() => void refresh()}>重试</button></div>;
  return <section>
    <header className="page-header"><div><p className="eyebrow">连接与同步</p><h1>平台集成</h1><p>管理任务、消息与代码平台连接，检查同步与恢复事项。</p></div><button className="primary" onClick={()=>setEditor(true)}><Icon name="plus"/>管理连接</button></header>
    <Tabs label="平台集成视图" items={[["connections",`平台连接 ${connectors.data.connectors.length}`],["recovery",`同步恢复 ${deadLetters.data?.deadLetters.length ?? "未知"}`]]} value={view} onChange={setView}/>
    <Notice>平台同步与执行状态分别记录。重试只会返回投递队列，不代表上游已收到。</Notice>
    {view === "connections" && <div className="panel"><div className="runner-list">{connectors.data.connectors.map((connector) => <article className="connector-card" key={connector.id}><div><strong>{connector.displayName}</strong><p>{connector.kind} · {connector.id}</p></div><span className={`status status-${connector.health.toLowerCase()}`}>{connector.health}</span><dl><div><dt>最近检查</dt><dd>{connector.source ?? "configuration"} · {new Date(connector.checkedAt).toLocaleString()}</dd></div><div><dt>待同步</dt><dd>{connector.pendingOutbox ?? "未提供"}</dd></div><div><dt>失败记录</dt><dd>{connector.deadLetters ?? "未提供"}</dd></div><div><dt>能力</dt><dd>{connector.capabilities?.join(", ") || "未提供"}</dd></div></dl><div className="secure-actions"><button disabled={busy} onClick={() => void test(connector.id)}>测试连接</button>{connector.kind === "task" && <button disabled={busy} onClick={() => void reconcile(connector.id)}>同步任务</button>}</div></article>)}</div>{connectors.data.connectors.length === 0 && <div className="empty-inline">尚未配置集成。<Link className="button-link" to="/settings">打开集成设置</Link></div>}</div>}
    {view === "recovery" && <div className="panel table-wrap"><div className="panel-heading"><div><p className="eyebrow">同步恢复</p><h2>失败记录</h2></div><span>{deadLetters.data?.deadLetters.length}</span></div>{deadLetters.error ? <div className="page-state error" role="alert">同步恢复记录读取失败。<button onClick={()=>void deadLetters.refetch()}>重试</button></div> : deadLetters.isLoading ? <p className="panel-content" role="status">正在读取恢复记录…</p> : deadLetters.data?.deadLetters.length ? <table><thead><tr><th>集成 / 来源</th><th>原因</th><th>时间</th><th>操作</th></tr></thead><tbody>{deadLetters.data?.deadLetters.map((entry) => <tr key={entry.id}><td><strong>{entry.connectorInstanceId}</strong><small>{entry.source} · {entry.sourceId}</small></td><td>{entry.reason}</td><td>{new Date(entry.createdAt).toLocaleString()}</td><td><div className="secure-actions"><button disabled={busy || entry.source !== "outbox"} title={entry.source === "outbox" ? "Return the failed outbox event to the delivery queue" : "Only outbox delivery failures can be retried automatically"} onClick={() => void retry(entry.id)}>重试</button><button disabled={busy} onClick={() => void resolveDeadLetter(entry.id)}>标记已处理…</button></div></td></tr>)}</tbody></table> : <div className="empty-inline">暂无同步失败记录。</div>}</div>}
    <p className="action-message" aria-live="polite">{message}</p>
    {editor && <Drawer title="平台连接配置" onClose={()=>setEditor(false)}><Suspense fallback={<p>正在读取配置…</p>}><SettingsPage sectionId="connectors" embedded/></Suspense></Drawer>}
  </section>;
}
