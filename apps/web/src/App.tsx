import { Component, lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, AUTH_REQUIRED_EVENT, currentSession, signIn, type ConfigResponse } from "./api.js";
import { ConsoleLayout } from "./ConsoleLayout.js";
export { Navigation } from "./ConsoleLayout.js";
import { Icon } from "./ui.js";
import "./styles.css";

const SettingsPage = lazy(() => import("./SettingsPage.js"));
const SetupWizard = lazy(() => import("./SetupWizard.js"));
const LlmPage = lazy(() => import("./ModelsPage.js"));
const AgentsPage = lazy(() => import("./AgentsPage.js"));
const FleetPage = lazy(() => import("./FleetPage.js"));
const PublishPage = lazy(() => import("./PublishPage.js"));
const TasksPage = lazy(() => import("./TasksPage.js"));
const DevicesPage = lazy(() => import("./DevicesPage.js"));
const RepositoriesPage = lazy(() => import("./RepositoriesPage.js"));
const PoliciesPage = lazy(() => import("./PoliciesPage.js"));
const DiagnosticsPage = lazy(() => import("./DiagnosticsPage.js"));
const IntegrationsPage = lazy(() => import("./IntegrationsPage.js"));
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
  const [status, setStatus] = useState("尚未配置");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = input.current?.value;
    if (!value) return;
    setBusy(true);
    setStatus("正在安全保存…");
    try {
      const result = await api<{ secret: { backend: string; reference: string } }>(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ value }) });
      if (input.current) input.current.value = "";
      onStored?.(result.secret.reference);
      setStatus(`已保存到 ${result.secret.backend}`);
    } catch {
      if (input.current) input.current.value = "";
      setStatus("凭据保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    setBusy(true);
    setStatus("正在检查已存储凭据…");
    try {
      const result = await api<{ ok: boolean; secret: { lastTestedAt: string | null } }>(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/test`, { method: "POST" });
      setStatus(result.ok ? `凭据检查通过 · ${result.secret.lastTestedAt ?? "刚刚"}` : "凭据检查未通过或尚未配置");
    } catch {
      setStatus("凭据检查暂不可用");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSecret(): Promise<void> {
    setBusy(true);
    setStatus("正在删除已存储凭据…");
    try {
      await api(`/api/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (input.current) input.current.value = "";
      onDeleted?.();
      setStatus("尚未配置");
    } catch {
      setStatus("凭据删除失败，已应用引用可能仍在使用");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="secure-input" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`secret-${namespace}-${name}`}>{label}</label>
      <div><input ref={input} id={`secret-${namespace}-${name}`} type="password" autoComplete="off" required /><button type="submit" disabled={busy}>安全保存</button></div>
      <div className="secure-actions"><button type="button" disabled={busy} onClick={() => void testConnection()}>检查凭据</button><button type="button" disabled={busy} onClick={() => void deleteSecret()}>删除凭据</button></div>
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
      <div className="login-brand"><span className="brand-mark"><Icon name="branch" size={25}/></span><strong>Dispatcher</strong></div><p className="login-intro">连接你的开发工具，
让任务有序运行。</p>
      <form className="secure-input" onSubmit={(event) => void submitPassword(event)}>
        <h1>登录 Agent Dispatcher</h1><p className="muted">使用本地管理员账号进入工作区。</p>
        <label htmlFor="login-username">用户名</label>
        <input ref={username} id="login-username" autoComplete="username" defaultValue="admin" required />
        <label htmlFor="login-password">密码</label>
        <div><input ref={password} id="login-password" type="password" autoComplete="current-password" required /><button type="submit" className="primary">登录</button></div>
        {error ? <small role="alert">{error}</small> : null}
      </form>
      <details className="secure-input"><summary>使用一次性链接或 Owner token</summary>
        <p>也可以打开服务启动时生成的一次性链接。</p>
        <form onSubmit={(event) => void submitToken(event)}><label htmlFor="owner-token">Owner token</label>
          <div><input ref={token} id="owner-token" type="password" autoComplete="off" required /><button type="submit" className="primary">登录</button></div>
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
        <ConsoleLayout>
            <Suspense fallback={<PageState title="正在加载" detail="正在准备控制页面…" />}>
              <Routes>
                <Route path="/overview" element={<FleetPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/publish" element={<PublishPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/repositories" element={<RepositoriesPage />} />
                <Route path="/runners" element={<Navigate to="/devices" replace />} />
                <Route path="/harnesses" element={<AgentsPage />} />
                <Route path="/agents" element={<Navigate to="/harnesses" replace />} />
                <Route path="/models" element={<LlmPage />} />
                <Route path="/llm" element={<Navigate to="/models" replace />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/policies" element={<PoliciesPage />} />
                <Route path="/diagnostics" element={<DiagnosticsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/setup" element={<SetupWizard />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
        </ConsoleLayout>
      </BrowserRouter></ConsoleBoundary>
      </AuthGate>
    </QueryClientProvider>
  );
}

export type { ConfigResponse };
