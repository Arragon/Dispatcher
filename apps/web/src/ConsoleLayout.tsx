import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FleetSnapshot } from "@dispatcher/fleet";
import { api, AUTH_REQUIRED_EVENT } from "./api.js";
import { Drawer } from "./Drawer.js";
import { Icon, type IconName } from "./ui.js";
const AssistantDrawer = lazy(() => import("./AssistantDrawer.js"));

export const navigation: Array<{ path: string; label: string; icon: IconName; group?: string }> = [
  { path: "/overview", label: "总览", icon: "overview", group: "工作区" },
  { path: "/tasks", label: "任务与运行", icon: "task" },
  { path: "/publish", label: "发布任务", icon: "plus" },
  { path: "/harnesses", label: "Harness", icon: "plug", group: "资源与连接" },
  { path: "/models", label: "模型管理", icon: "model" },
  { path: "/devices", label: "设备管理", icon: "device" },
  { path: "/repositories", label: "项目仓库", icon: "branch" },
  { path: "/integrations", label: "平台集成", icon: "link" },
  { path: "/policies", label: "执行策略", icon: "shield", group: "管理" },
  { path: "/diagnostics", label: "诊断", icon: "pulse" },
  { path: "/settings", label: "设置", icon: "settings" },
];
function preference(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function ThemeButton(): React.JSX.Element {
  const [theme, setTheme] = useState(() => preference("dispatcher.theme", "light") === "dark" ? "dark" : "light");
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const update = () => setTheme(preference("dispatcher.theme", "light") === "dark" ? "dark" : "light");
    window.addEventListener("dispatcher:theme", update);
    return () => window.removeEventListener("dispatcher:theme", update);
  }, []);
  return <button className="icon-button theme-toggle" title="切换深浅主题" aria-label={`切换为${theme === "light" ? "黑" : "白"}色主题`} onClick={() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem("dispatcher.theme", next); window.dispatchEvent(new Event("dispatcher:theme")); } catch { /* Session preference still works. */ }
  }}><Icon name={theme === "light" ? "moon" : "sun"}/></button>;
}
export function Navigation({ menu = false, closeMenu = () => undefined }: { menu?: boolean; closeMenu?: () => void }): React.JSX.Element {
  const [workspace, setWorkspace] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  return <aside className={`sidebar ${menu ? "menu-open" : ""}`}>
    <button className="icon-button sidebar-close" aria-label="关闭导航" onClick={closeMenu}><Icon name="close"/></button>
    <Link to="/overview" className="brand"><span className="brand-mark"><Icon name="branch" size={23}/></span>Dispatcher</Link>
    <button className="workspace-switch" onClick={() => setWorkspace(true)}><span className="workspace-avatar">D</span><span>个人工作区<small>本地控制台</small></span><Icon name="chevron" size={12}/></button>
    <nav id="main-navigation" aria-label="Main navigation">{navigation.map(({path, label, icon, group}) => <div key={path}>{group && <p className="nav-group">{group}</p>}<NavLink to={path} onClick={closeMenu} className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}><Icon name={icon}/><span>{label}</span></NavLink></div>)}</nav>
    <div className="sidebar-footer"><Suspense fallback={null}><AssistantDrawer/></Suspense><NavLink to="/setup" className="setup-link" onClick={closeMenu}><Icon name="book"/>初始设置向导</NavLink><div className="profile-footer"><span className="avatar">AD</span><span>本地管理员<small>个人工作空间</small></span><ThemeButton/><button className="icon-button" disabled={signingOut} aria-label="退出登录" onClick={() => { setSigningOut(true); void api("/auth/session", {method:"DELETE"}).then(() => window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))).catch(() => setLogoutError("退出失败，请重试")).finally(() => setSigningOut(false)); }}><Icon name="logout"/></button></div>{logoutError && <small role="alert">{logoutError}</small>}</div>
    {workspace && <Drawer title="个人工作区" onClose={() => setWorkspace(false)}><p>配置、任务和运行由当前 Dispatcher Controller 管理。</p><p className="muted">Harness 账号保留各自的原生登录和独立配置。</p><Link className="button-link" to="/settings" onClick={() => setWorkspace(false)}>管理工作区</Link></Drawer>}
  </aside>;
}
function GlobalSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const fleet = useQuery({queryKey:["fleet"], queryFn:() => api<{snapshot:FleetSnapshot}>("/api/fleet")});
  const term = search.trim().toLocaleLowerCase();
  const pages = navigation.filter((entry) => entry.label.toLocaleLowerCase().includes(term));
  const tasks = term ? (fleet.data?.snapshot.tasks ?? []).filter((task) => `${task.id} ${task.title}`.toLocaleLowerCase().includes(term)).slice(0, 8) : [];
  return <Drawer title="搜索工作区" variant="modal" onClose={onClose}><label className="search-dialog-input"><Icon name="search"/><input autoFocus aria-label="搜索页面、任务或 ID" placeholder="搜索页面、任务或 ID…" value={search} onChange={(event) => setSearch(event.target.value)}/></label><p className="muted">页面</p><div className="search-results">{pages.map((entry) => <button key={entry.path} onClick={() => { navigate(entry.path); onClose(); }}><Icon name={entry.icon}/><span>{entry.label}</span><Icon name="arrow" size={14}/></button>)}</div>{term && <><p className="muted">任务</p>{fleet.error ? <p role="alert">任务搜索暂不可用。仍可搜索页面。</p> : tasks.length ? <div className="search-results">{tasks.map((task) => <button key={task.id} onClick={() => { navigate(`/tasks?task=${encodeURIComponent(task.id)}`); onClose(); }}><Icon name="task"/><span>{task.title}<small>{task.id}</small></span><Icon name="arrow" size={14}/></button>)}</div> : <p className="muted">{fleet.isLoading ? "正在读取任务…" : "没有匹配的任务"}</p>}</>}</Drawer>;
}
export function ConsoleLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [compact, setCompact] = useState(() => preference("dispatcher.density", "comfortable") === "compact");
  const current = navigation.find((entry) => location.pathname.startsWith(entry.path));
  useLayoutEffect(() => { document.documentElement.dataset.density = compact ? "compact" : "comfortable"; }, [compact]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearch((value) => !value); }
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setMenu(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (!menu) { if (wasOpen.current) menuTrigger.current?.focus(); wasOpen.current = false; return; }
    wasOpen.current = true;
    document.querySelector<HTMLAnchorElement>("#main-navigation a")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
      const controls = Array.from(document.querySelectorAll<HTMLElement>(".sidebar a, .sidebar button")).filter((element) => element.getClientRects().length && !element.hasAttribute("disabled"));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown",trap);
    return () => window.removeEventListener("keydown",trap);
  }, [menu]);
  useEffect(() => { document.title = `${current?.label ?? "初始设置"} · Dispatcher`; }, [current?.label]);
  return <div className={`shell ${menu ? "mobile-open" : ""}`}><a className="skip-link" href="#main">跳到内容</a><Navigation menu={menu} closeMenu={() => setMenu(false)}/>{menu && <button className="mobile-shade" aria-label="收起侧栏" tabIndex={-1} onClick={() => setMenu(false)}/>}
    <div className="console-body" inert={menu}><header className="topbar"><button ref={menuTrigger} className="icon-button mobile-menu" aria-label="打开导航" aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(!menu)}><Icon name="menu"/></button><div className="breadcrumb"><span>工作空间</span><Icon name="chevron" size={12}/><span>{current?.label ?? "初始设置向导"}</span></div><div className="topbar-tools"><button className="global-search" aria-label="搜索工作区" onClick={() => setSearch(true)}><Icon name="search"/><kbd>⌘ K</kbd></button><span className="topbar-divider"/><button className="density-toggle" aria-label="紧凑显示" aria-pressed={compact} onClick={() => { setCompact(!compact); try {localStorage.setItem("dispatcher.density", compact ? "comfortable" : "compact");} catch { /* Session only. */ } }}>{compact ? "紧凑" : "舒适"}</button><Link className="icon-button" aria-label="查看待处理事项" to="/overview#attention"><Icon name="bell"/></Link><ThemeButton/></div></header><main id="main" tabIndex={-1}>{children}</main></div>{search && <GlobalSearch onClose={() => setSearch(false)}/>}</div>;
}
