import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { FleetSnapshot } from "@dispatcher/fleet";
import { api, subscribeToEvents } from "./api.js";
import { stateLabel } from "./task-view.js";

export default function FleetPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["fleet"], queryFn: () => api<{ snapshot: FleetSnapshot }>("/api/fleet") });
  useEffect(() => subscribeToEvents(() => void query.refetch()), [query.refetch]);
  if (query.isLoading) return <div className="page-state" role="status">正在读取工作空间…</div>;
  if (query.error || !query.data) return <div className="page-state error" role="alert"><strong>工作空间读取失败</strong><button onClick={() => void query.refetch()}>重试</button></div>;
  const fleet = query.data.snapshot;
  const enabled = fleet.profiles.filter((profile) => profile.state === "CONFIGURED").length;
  return <section>
    <header className="page-header"><div><h1>总览</h1><p>查看当前任务、可用账号与需要处理的事项。</p></div><Link className="button-link" to="/tasks">查看任务与运行</Link></header>
    <div className="metric-grid"><article className="metric"><p>当前任务</p><strong>{fleet.tasks.filter((task) => !task.archivedAt).length}</strong><small>{fleet.counts.activeRuns} 个未结束运行</small></article><article className="metric"><p>需要关注</p><strong>{fleet.attention.length}</strong><small>{fleet.counts.waiting} 等待 · {fleet.counts.stalled} 停止响应</small></article><article className="metric"><p>Agent 账号</p><strong>{enabled} <small>/ {fleet.profiles.length}</small></strong><small>已启用 · 登录需单独验证</small></article><article className="metric"><p>集成</p><strong>{fleet.connectors.length === 0 ? "未配置" : fleet.counts.unhealthyConnectors ? "需处理" : "正常"}</strong><small>{fleet.connectors.length} 个连接 · {fleet.counts.unhealthyConnectors} 个需处理</small></article></div>
    <div className="two-column"><div><article className="panel"><header className="panel-heading"><h2>需要处理</h2><span>{fleet.attention.length}</span></header>{fleet.attention.length ? fleet.attention.slice(0,8).map((item) => <article className="runner-row" key={item.id}><div><strong>{item.title}</strong><p>{stateLabel(item.kind)} · {item.detail}</p></div><Link className="button-link" to={item.connectorId ? "/integrations" : "/tasks"}>查看</Link></article>) : <div className="empty-inline"><strong>暂无待处理事项</strong><p>{fleet.tasks.length ? "当前没有需要你介入的运行。" : "任务同步后，决策、错误和资源等待会集中显示。"}</p><Link className="button-link" to="/integrations">查看集成</Link></div>}</article><article className="panel"><header className="panel-heading"><h2>最近运行</h2><Link to="/tasks">全部</Link></header>{fleet.runs.length ? fleet.runs.slice(0,5).map((run) => <article className="runner-row" key={run.id}><div><strong>{fleet.tasks.find((task) => task.id === run.taskId)?.title ?? run.taskId}</strong><p>{fleet.profiles.find((profile) => profile.id === run.profileId)?.alias ?? run.profileId} · {run.model?.id ?? "模型未提供"}</p></div><span className={`status status-${run.state.toLowerCase()}`}>{stateLabel(run.state)}</span></article>) : <div className="empty-inline"><strong>还没有运行记录</strong><p>连接任务平台后，在任务与运行中跟踪执行。</p><Link className="button-link" to="/tasks">查看任务与运行</Link></div>}</article></div><article className="panel"><header className="panel-heading"><h2>Agent 账号</h2><Link to="/agents">管理</Link></header>{fleet.profiles.slice(0,6).map((profile) => <article className="runner-row" key={profile.id}><span className="runner-avatar">{profile.alias.slice(0,2).toUpperCase()}</span><div><strong>{profile.alias}</strong><p>{profile.provider} · {profile.resourceState ?? "资源未验证"}</p></div><span className={`status status-${profile.state.toLowerCase()}`}>{stateLabel(profile.state)}</span></article>)}{fleet.profiles.length > 6 && <Link to="/agents">查看全部 {fleet.profiles.length} 个账号</Link>}{!fleet.profiles.length && <div className="empty-inline"><strong>暂无账号</strong><Link className="button-link" to="/agents">添加 Agent 账号</Link></div>}</article></div>
    <p className="snapshot-time">更新于 {new Date(fleet.generatedAt).toLocaleString()}</p>
  </section>;
}
