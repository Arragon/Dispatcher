import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "./ui.js";
import { Link, useSearchParams } from "react-router-dom";
import type { FleetSnapshot, FleetTaskInput, FleetProjectInput } from "@dispatcher/fleet";
import { api, subscribeToEvents } from "./api.js";
import { TaskDetail } from "./TaskDetail.js";
import { currentRun, safeLink, stateLabel, terminalStates, tokensLabel } from "./task-view.js";

export default function TasksPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["fleet"], queryFn: () => api<{ snapshot: FleetSnapshot }>("/api/fleet") });
  const [view, setView] = useState<"project" | "agent">("project");
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("task") ?? undefined;
  function setSelectedId(id?: string): void { setParams((previous) => { const next = new URLSearchParams(previous); if (id) next.set("task",id); else next.delete("task"); return next; }); }
  useEffect(() => subscribeToEvents(() => void query.refetch()), [query.refetch]);
  const fallback=query.data?.snapshot.tasks.find(task=>task.id===selectedId);
  const independentDetail=selectedId?<TaskDetail key={selectedId} id={selectedId} {...(fallback?{fallback}:{})} profiles={query.data?.snapshot.profiles??[]} onClose={()=>setSelectedId(undefined)} refresh={query.refetch}/>:null;
  function renderContent():React.JSX.Element {
    if (query.isLoading) return <div className="page-state" role="status">正在读取任务与运行…</div>;
    if (query.error || !query.data) return <div className="page-state error" role="alert"><strong>任务读取失败</strong><p>{query.error?.message}</p><button onClick={() => void query.refetch()}>重试</button></div>;
    const fleet = query.data.snapshot;
    const project = (id: string): FleetProjectInput => fleet.projects?.find((item) => item.id === id) ?? { id, name: id, repositories: [], externalRefs: [] };
    const profileName = (id?: string): string => fleet.profiles.find((item) => item.id === id)?.alias ?? id ?? "未分配";
    const scopeTasks = fleet.tasks.filter((task) => Boolean(task.archivedAt) === history);
    const tasks = scopeTasks.filter((task) => {
      const run = currentRun(task, fleet.runs);
      const profile = fleet.profiles.find((entry) => entry.id === (run?.profileId ?? task.profileId));
      const text = [task.title, task.id, project(task.projectId).name, profile?.alias ?? "未分配", profile?.provider, run?.model?.id, ...task.externalRefs?.map((ref) => ref.externalId) ?? []].join(" ").toLowerCase();
      return (!search || text.includes(search.toLowerCase())) && (!status || task.state === status || run?.state === status) && (view !== "agent" || !activeOnly || (run && !terminalStates.has(run.state)));
    });
    const keys = [...new Set(tasks.map((task) => view === "project" ? task.projectId : currentRun(task, fleet.runs)?.profileId ?? task.profileId ?? "unassigned"))];
    function fold(key: string): void { setCollapsed((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
    function crossView(next: "project" | "agent", value: string): void { setView(next); setSearch(value); setActiveOnly(false); }
    function taskRow(task: FleetTaskInput): React.JSX.Element {
      const run = currentRun(task, fleet.runs);
      const state = task.state;
      return <article className="task-row" key={task.id}>
        <div><strong>{task.title}</strong><small>{task.externalRefs?.map((ref) => ref.externalId).join(" · ") || task.id}</small></div>
        <div><button className="text-button" onClick={() => crossView(view === "project" ? "agent" : "project", view === "project" ? profileName(run?.profileId ?? task.profileId) : project(task.projectId).name)}>{view === "project" ? profileName(run?.profileId ?? task.profileId) : project(task.projectId).name}</button><small>{view === "project" ? fleet.profiles.find((item) => item.id === (run?.profileId ?? task.profileId))?.provider ?? "" : "项目"}</small></div>
        <div>{run?.model?.id ?? "模型未提供"}<small>{run?.model?.source === "selection" ? "本次选择 · 运行未确认" : run?.model?.source === "configuration" ? "配置选择 · 运行未确认" : run?.model ? "运行上报" : "未上报"}</small></div>
        <div><span className={`status status-${state.toLowerCase()}`}>{stateLabel(state)}</span><small>{run ? `Run：${stateLabel(run.state)}` : "尚无运行"}</small></div>
        <div>{tokensLabel(run)}<small>{run?.tokenScope === "latest-turn" ? "最新回合 · 非累计" : ""}</small></div>
        <button onClick={() => setSelectedId(task.id)} aria-label={`查看 ${task.title}`}>详情</button>
      </article>;
    }
    const activeProfiles = new Set(scopeTasks.flatMap((task) => { const run = currentRun(task, fleet.runs); return run && !terminalStates.has(run.state) ? [run.profileId] : []; })).size;
    return <section aria-label="任务与运行">
      <header className="page-header"><div><h1>任务与运行</h1><p>把每个项目的任务、执行状态与用量放在一起。</p></div><div className="page-actions"><button disabled={query.isFetching} onClick={() => void query.refetch()}><Icon name="refresh"/>{query.isFetching ? "刷新中…" : "刷新"}</button><Link className="button-link primary" to="/publish"><Icon name="plus"/>发布任务</Link></div></header>
      <div className="view-tabs" role="tablist" aria-label="任务分组方式">{(["project", "agent"] as const).map((value) => <button id={`tab-${value}`} key={value} role="tab" aria-controls="task-groups" aria-selected={view === value} tabIndex={view === value ? 0 : -1} onClick={() => { setView(value); setSearch(""); }} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "project" : event.key === "End" ? "agent" : view === "project" ? "agent" : "project"; setView(next); setSearch(""); document.getElementById(`tab-${next}`)?.focus(); } }}>{value === "project" ? "项目视图" : "Agent 视图"}</button>)}</div>
      <div className="toolbar"><input aria-label="搜索项目、账号、任务或模型" placeholder="搜索项目、账号、任务或模型…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="运行状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{[...new Set(scopeTasks.flatMap((task) => [task.state,...(currentRun(task,fleet.runs)?[currentRun(task,fleet.runs)!.state]:[])]))].sort().map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}</select><div className="segments"><button aria-pressed={!history} onClick={() => setHistory(false)}>当前项目</button><button aria-pressed={history} onClick={() => setHistory(true)}>历史任务</button></div>{view === "agent" && <button aria-pressed={activeOnly} onClick={() => setActiveOnly(!activeOnly)}>{activeOnly ? "仅活跃 Agent" : "全部有任务的 Agent"}</button>}</div>
      <p className="task-count muted">{tasks.length} / {scopeTasks.length} 个任务 · {keys.length} 个{view === "project" ? "项目" : "账号分组"} · {activeProfiles} 个活跃 Agent</p>

      <div id="task-groups" role="tabpanel" aria-labelledby={`tab-${view}`}>
      {keys.map((key) => {
        const members = tasks.filter((task) => (view === "project" ? task.projectId : currentRun(task, fleet.runs)?.profileId ?? task.profileId ?? "unassigned") === key);
        const entry = project(key);
        const profile = fleet.profiles.find((item) => item.id === key);
        return <article className="panel group-card" key={`${view}:${key}`}><header className="group-header"><button aria-label={`${collapsed.has(key) ? "展开" : "收起"} ${view === "project" ? entry.name : profileName(key)}`} aria-expanded={!collapsed.has(key)} onClick={() => fold(key)}>{collapsed.has(key) ? "+" : "−"}</button><h2>{view === "project" ? entry.name : profile?.alias ?? "未分配 Agent"}</h2><small>{view === "project" ? `${members.length} 个任务` : `${profile?.provider ?? "未知"} · ${profile?.runnerId ?? "未登记设备"} · ${members.length} 个任务`}</small></header>
          {view === "project" ? <div className="project-links"><div><small>Git 仓库</small>{entry.repositories?.length ? entry.repositories.map((repo) => safeLink(repo.remote) ? <a key={repo.id} href={safeLink(repo.remote)} target="_blank" rel="noreferrer">{repo.remote}</a> : <span key={repo.id}>{repo.remote ?? `${repo.id} · 地址未关联`}</span>) : <span>未关联</span>}</div><div><small>任务平台</small>{entry.externalRefs?.some((ref) => safeLink(ref.externalUrl)) ? entry.externalRefs.map((ref, index) => safeLink(ref.externalUrl) && <a key={index} href={safeLink(ref.externalUrl)} target="_blank" rel="noreferrer">{ref.externalUrl}</a>) : <span>未关联</span>}</div><div><small>本地目录</small>{entry.repositories?.length ? entry.repositories.map((repo) => <span key={repo.id}>{repo.root}</span>) : <span>未登记</span>}</div></div> : <div className="project-links"><div><small>派发状态</small><span>{stateLabel(profile?.state ?? "UNAVAILABLE")}</span></div><div><small>资源证据</small><span>{profile?.resourceState ?? "未提供"}</span><small>{profile?.resourceReason}</small></div><div><small>账户额度</small><span>数值未提供</span><small>{profile?.resetsAt ? `重置时间 ${new Date(profile.resetsAt).toLocaleString()}` : "尚无账户周期计量"}</small></div></div>}
          {!collapsed.has(key) && <><div className="task-row task-row-heading" aria-hidden="true"><span>任务</span><span>{view === "project" ? "Agent" : "项目"}</span><span>模型</span><span>状态</span><span>Token</span><span>操作</span></div>{members.map(taskRow)}</>}
        </article>;
      })}
      {!keys.length && <div className="page-state"><strong>{search || status || activeOnly ? "没有匹配的任务" : history ? "暂无归档任务" : "暂无当前任务"}</strong><p>{search || status || activeOnly ? "调整搜索或筛选条件后重试。" : history ? "任务明确归档后会显示在这里；完成状态不会自动归档。" : "发布任务或连接任务平台后，项目和 Harness 会显示在这里。"}</p>{search || status || activeOnly ? <button onClick={() => { setSearch(""); setStatus(""); setActiveOnly(false); }}>清除筛选</button> : <Link className="button-link" to="/integrations">查看集成</Link>}</div>}
      </div>
      <p className="snapshot-time">更新于 {new Date(fleet.generatedAt).toLocaleString()} · 用量依赖 Agent 实际上报</p>
    </section>;
  }
  return <>{renderContent()}{independentDetail}</>;
}
