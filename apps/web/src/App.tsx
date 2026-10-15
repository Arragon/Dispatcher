import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, AUTH_REQUIRED_EVENT, currentSession, signIn, type ConfigResponse } from "./api.js";
import "./styles.css";

const SettingsPage = lazy(() => import("./SettingsPage.js"));
const SetupWizard = lazy(() => import("./SetupWizard.js"));
const LlmPage = lazy(() => import("./LlmPage.js"));
const AgentsPage = lazy(() => import("./AgentsPage.js"));
const FleetPage = lazy(() => import("./FleetPage.js"));
const TasksPage = lazy(() => import("./TasksPage.js"));
const IntegrationsPage = lazy(() => import("./IntegrationsPage.js"));
const AssistantDrawer = lazy(() => import("./AssistantDrawer.js"));

const navigation = [
  ["/overview", "总览", "工作区"], ["/tasks", "任务与运行", ""], ["/agents", "Agent 账号", ""],
  ["/llm", "内部模型", "配置"], ["/integrations", "集成", ""], ["/settings", "设置", ""],
  ["/runners", "运行设备", "管理"], ["/policies", "策略", ""], ["/diagnostics", "诊断", ""],
] as const;

function initialTheme(): "light" | "dark" {
  try { return localStorage.getItem("dispatcher.theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function Navigation(): React.JSX.Element {
  const [theme, setTheme] = useState(initialTheme);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  function toggleTheme(): void {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem("dispatcher.theme", next); } catch { /* Preference remains usable when storage is disabled. */ }
  }
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark">AD</span><span>Dispatcher</span></div>
    <button className="mobile-menu" type="button" aria-expanded={menu} aria-controls="main-navigation" onClick={() => setMenu(!menu)}>菜单</button>
    <nav id="main-navigation" className={menu ? "menu-open" : ""} aria-label="Main navigation">
      {navigation.map(([path, label, group]) => <div key={path}>{group && <p className="nav-group">{group}</p>}<NavLink to={path} onClick={() => setMenu(false)} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>{label}</NavLink></div>)}
    </nav>
    <div className="sidebar-footer"><Suspense fallback={null}><AssistantDrawer /></Suspense><NavLink to="/setup" className="setup-link">初始设置向导</NavLink><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`切换为${theme === "light" ? "黑" : "白"}色主题`}>{theme === "light" ? "☾ 黑色主题" : "☀ 白色主题"}</button><small>个人工作空间 · 本机</small></div>
  </aside>;
}

function PageState({ title, detail, tone = "neutral" }: { title: string; detail: string; tone?: "neutral" | "error" }): React.JSX.Element {
  return <div className={`page-state ${tone}`} role={tone === "error" ? "alert" : "status"}><strong>{title}</strong><p>{detail}</p></div>;
}

export class ConsoleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override render(): ReactNode {
    if (this.state.failed) return <main className="login"><div className="page-state error" role="alert"><h1>页面加载失败</h1><p>服务更新或页面异常可能导致加载中断。刷新后重新打开。</p><button onClick={() => window.location.reload()}>刷新页面</button></div></main>;
    return this.props.children;
  }
}

function Placeholder({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <section><header className="page-header"><div><p className="eyebrow">独立管理页面尚未开放</p><h1>{title}</h1><p>{description}</p></div></header><PageState title="使用设置管理" detail="当前可在设置中管理相应配置。" /><NavLink className="button-link" to="/settings">打开设置</NavLink></section>;
}

export function SecureInput({
  namespace,
  name,
  label,
  onStored,
  onDeleted,
}: {
  namespace: string;
  name: string;
  label: string;
  onStored?: (reference: string) => void;
  onDeleted?: () => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("Not configured");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = input.current?.value;
    if (!value) return;
    setBusy(true);
    setStatus("Saving securely…");
    try {
      const result = await api<{ secret: { backend: string; reference: string } }>(`/api/secrets/${namespace}/${name}`, { method: "PUT", body: JSON.stringify({ value }) });
      if (input.current) input.current.value = "";
      onStored?.(result.secret.reference);
      setStatus(`Stored in ${result.secret.backend}`);
    } catch {
      if (input.current) input.current.value = "";
      setStatus("Secret could not be stored");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    setBusy(true);
    setStatus("Testing stored credential…");
    try {
      const result = await api<{ ok: boolean; secret: { lastTestedAt: string | null } }>(`/api/secrets/${namespace}/${name}/test`, { method: "POST" });
      setStatus(result.ok ? `Connection test passed at ${result.secret.lastTestedAt ?? "now"}` : "Connection test failed or credential is missing");
    } catch {
      setStatus("Connection test could not run");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSecret(): Promise<void> {
    setBusy(true);
    setStatus("Deleting stored credential…");
    try {
      await api(`/api/secrets/${namespace}/${name}`, { method: "DELETE" });
      if (input.current) input.current.value = "";
      onDeleted?.();
      setStatus("Not configured");
    } catch {
      setStatus("Stored credential could not be deleted");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="secure-input" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`secret-${namespace}-${name}`}>{label}</label>
      <div><input ref={input} id={`secret-${namespace}-${name}`} type="password" autoComplete="off" required /><button type="submit" disabled={busy}>Store</button></div>
      <div className="secure-actions"><button type="button" disabled={busy} onClick={() => void testConnection()}>Test connection</button><button type="button" disabled={busy} onClick={() => void deleteSecret()}>Delete</button></div>
      <small aria-live="polite">{status}</small>
    </form>
  );
}

export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<"checking" | "signed-in" | "signed-out">("checking");
  const [error, setError] = useState<string>();
  const token = useRef<HTMLInputElement>(null);
  const username = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const code = new URLSearchParams(window.location.hash.slice(1)).get("login");
      if (code) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        await signIn({ code }).catch(() => setError("The login link is invalid or expired."));
      }
      const session = await currentSession().catch(() => undefined);
      if (!cancelled) setState(session ? "signed-in" : "signed-out");
    })();
    const onAuthRequired = () => setState("signed-out");
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, []);
  async function submitPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = username.current?.value ?? "";
    const value = password.current?.value ?? "";
    if (password.current) password.current.value = "";
    try {
      await signIn({ username: name, password: value });
      setError(undefined);
      setState("signed-in");
    } catch {
      setError("用户名或密码错误。");
    }
  }
  async function submitToken(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = token.current?.value ?? "";
    if (token.current) token.current.value = "";
    try {
      await signIn({ token: value });
      setError(undefined);
      setState("signed-in");
    } catch {
      setError("Owner token 无效。");
    }
  }
  if (state === "checking") return <PageState title="Loading" detail="Checking your Dispatcher session…" />;
  if (state === "signed-in") return <>{children}</>;
  return (
    <main className="login">
      <form className="secure-input" onSubmit={(event) => void submitPassword(event)}>
        <h1>登录 Agent Dispatcher</h1>
        <label htmlFor="login-username">用户名</label>
        <input ref={username} id="login-username" autoComplete="username" defaultValue="admin" required />
        <label htmlFor="login-password">密码</label>
        <div><input ref={password} id="login-password" type="password" autoComplete="current-password" required /><button type="submit">登录</button></div>
        {error ? <small role="alert">{error}</small> : null}
      </form>
      <details className="secure-input"><summary>使用一次性链接或 Owner token</summary>
        <p>也可以打开服务启动时生成的一次性链接。</p>
        <form onSubmit={(event) => void submitToken(event)}><label htmlFor="owner-token">Owner token</label>
          <div><input ref={token} id="owner-token" type="password" autoComplete="off" required /><button type="submit">登录</button></div>
        </form>
      </details>
    </main>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
      <ConsoleBoundary><BrowserRouter>
        <div className="shell">
          <a className="skip-link" href="#main">跳到内容</a><Navigation />
          <main id="main" tabIndex={-1}>
            <Suspense fallback={<PageState title="正在加载" detail="正在准备控制页面…" />}>
              <Routes>
                <Route path="/overview" element={<FleetPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/runners" element={<Placeholder title="运行设备" description="Registered execution devices and capabilities." />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/llm" element={<LlmPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/policies" element={<Placeholder title="策略" description="Deterministic execution and approval boundaries." />} />
                <Route path="/diagnostics" element={<Placeholder title="诊断" description="Structured system evidence without raw-log flooding." />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/setup" element={<SetupWizard />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter></ConsoleBoundary>
      </AuthGate>
    </QueryClientProvider>
  );
}

export type { ConfigResponse };
