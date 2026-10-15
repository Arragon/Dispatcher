import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ResourceAssessment } from "@dispatcher/fleet";
import { api, type Health } from "./api.js";
import { EmptyState, Icon, Notice } from "./ui.js";
import { stateLabel } from "./task-view.js";
interface Impact {rssBytes:number;heapUsedBytes:number;databaseBytes:number;dashboardClients:number;runnerCount:number}
function bytes(value?:number):string {return value === undefined || !Number.isFinite(value) ? "未提供" : `${(value/1024/1024).toFixed(1)} MB`;}
export default function DiagnosticsPage():React.JSX.Element {
  const health=useQuery({queryKey:["health"],queryFn:()=>api<Health>("/health")});
  const impact=useQuery({queryKey:["system-impact"],queryFn:()=>api<Impact>("/api/system-impact")});
  const resources=useQuery({queryKey:["resources"],queryFn:()=>api<{resources:ResourceAssessment[]}>("/api/resources")});
  const loading=health.isFetching || impact.isFetching || resources.isFetching;
  function refresh():void {void Promise.all([health.refetch(),impact.refetch(),resources.refetch()]);}
  function exportReport():void {
    // Export only measured, allowlisted scalar fields. No config, paths, IDs, free text or credentials.
    const report={schemaVersion:1,exportedAt:new Date().toISOString(),controller:health.data && !health.error ? {status:health.data.status,version:health.data.version,mode:health.data.mode,uptimeMs:health.data.uptimeMs} : {status:"unknown"},measurements:impact.data && !impact.error ? {rssBytes:impact.data.rssBytes,heapUsedBytes:impact.data.heapUsedBytes,databaseBytes:impact.data.databaseBytes,dashboardClients:impact.data.dashboardClients} : null,resourceAccounts:resources.data?.resources.length ?? null,resourceRead:resources.error ? "failed" : resources.data ? "available" : "unknown",activeLocalProcesses:null,llmCallsLastHour:null};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="dispatcher-diagnostics.json";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section><header className="page-header"><div><h1>诊断</h1><p>从系统与资源证据出发，定位需要处理的问题。</p></div><div className="page-actions"><button onClick={exportReport}><Icon name="download"/>导出诊断摘要</button><button className="primary" disabled={loading} onClick={refresh}><Icon name="refresh"/>{loading ? "读取中…" : "刷新诊断"}</button></div></header>
    <div className={`diagnostic-summary ${health.data?.status === "ok" ? "healthy" : ""}`}><span className="diagnostic-symbol"><Icon name={health.data?.status === "ok" ? "check" : "pulse"} size={27}/></span><div><h2>{health.isLoading ? "正在检查 Controller…" : health.error ? "Controller 状态读取失败" : health.data?.status === "ok" ? "Controller 正常响应" : "Controller 需要关注"}</h2><p>{health.data ? `版本 ${health.data.version} · ${health.data.mode} · 运行 ${Math.floor(health.data.uptimeMs/60_000)} 分钟` : "读取失败不等于服务已停止，请重试核对。"}</p></div><Link className="button-link" to="/settings">查看设置</Link></div>
    <div className="metric-strip"><article className="metric-cell"><p className="metric-top">进程内存</p><strong className="metric-value metric-text">{bytes(impact.data?.rssBytes)}</strong><small>Controller RSS 实测值</small></article><article className="metric-cell"><p className="metric-top">数据库</p><strong className="metric-value metric-text">{bytes(impact.data?.databaseBytes)}</strong><small>当前 SQLite 文件</small></article><article className="metric-cell"><p className="metric-top">控制台连接</p><strong className="metric-value">{impact.data?.dashboardClients ?? "未知"}</strong><small>SSE 连接数</small></article><article className="metric-cell"><p className="metric-top">本地 Agent 进程</p><strong className="metric-value metric-text">未采集</strong><small>等待真实进程计量</small></article></div>
    {impact.error && <Notice tone="error">系统占用读取失败。其他诊断仍可查看。<button onClick={()=>void impact.refetch()}>重试</button></Notice>}
    <article className="panel flush-panel"><header className="panel-heading"><div><h2>账号资源与恢复线索</h2><p>只展示已有证据，不发起模型调用。</p></div><Link to="/harnesses">管理账号</Link></header>{resources.isLoading ? <p className="panel-content" role="status">正在读取资源证据…</p> : resources.error ? <div className="panel-content"><p role="alert">资源状态读取失败</p><button onClick={()=>void resources.refetch()}>重新读取资源</button></div> : resources.data?.resources.length ? resources.data.resources.map((entry)=><article className="diagnostic-row" key={entry.profileId}><Icon name={entry.state === "AVAILABLE" ? "check" : "warning"}/><div><strong>{entry.profileId}</strong><p>{entry.reason ?? "资源说明未提供"}</p><small>来源 {entry.source} · 可信度 {entry.confidence} · {entry.checkedAt ? new Date(entry.checkedAt).toLocaleString() : "时间未提供"}{new Date(entry.freshUntil).getTime() < Date.now() ? " · 证据已过期" : ""}</small></div><span className={`status status-${entry.state.toLowerCase()}`}>{stateLabel(entry.state)}</span></article>) : <EmptyState title="暂无账号资源证据" icon="pulse"><p>接入账号并执行检查后，这里会展示真实资源状态。</p></EmptyState>}</article>
    <Notice>账户额度数值、每小时模型调用和实际费用尚无可靠计量。诊断导出只包含测量字段和汇总数量，不包含配置、路径、凭据或原始日志。</Notice>
  </section>;
}
