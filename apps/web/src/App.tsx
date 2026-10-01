import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  ["/overview", "Overview / Fleet", "⌁"],
  ["/tasks", "Tasks & Runs", "▤"],
  ["/runners", "Runners", "⌘"],
  ["/agents", "Agents & Profiles", "◇"],
  ["/llm", "Internal LLM", "✦"],
  ["/integrations", "Integrations", "⇄"],
  ["/policies", "Policies", "◈"],
  ["/diagnostics", "Logs & Diagnostics", "⌁"],
  ["/settings", "Settings", "⚙"],
] as const;

export function Navigation(): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">AD</span><span>Agent<br />Dispatcher</span></div>
      <nav aria-label="Main navigation">
        {navigation.map(([path, label, icon]) => (
          <NavLink key={path} to={path} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            <span aria-hidden="true">{icon}</span>{label}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/setup" className="setup-link">Setup wizard</NavLink>
    </aside>
  );
}

function PageState({ title, detail, tone = "neutral" }: { title: string; detail: string; tone?: "neutral" | "error" }): React.JSX.Element {
  return <div className={`page-state ${tone}`} role={tone === "error" ? "alert" : "status"}><strong>{title}</strong><p>{detail}</p></div>;
}

function Placeholder({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <section><header className="page-header"><div><p className="eyebrow">Foundation ready</p><h1>{title}</h1><p>{description}</p></div></header><PageState title="No records yet" detail="This surface is ready for its roadmap milestone." /></section>;
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
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = token.current?.value ?? "";
    if (token.current) token.current.value = "";
    try {
      await signIn({ token: value });
      setError(undefined);
      setState("signed-in");
    } catch {
      setError("The owner token was rejected.");
    }
  }
  if (state === "checking") return <PageState title="Loading" detail="Checking your Dispatcher session…" />;
  if (state === "signed-in") return <>{children}</>;
  return (
    <main className="login">
      <form className="secure-input" onSubmit={(event) => void submit(event)}>
        <h1>Sign in to Agent Dispatcher</h1>
        <p>Open the single-use login link printed by <code>dispatcher serve</code>, or paste the owner token from <code>dispatcher auth token</code>.</p>
        <label htmlFor="owner-token">Owner token</label>
        <div><input ref={token} id="owner-token" type="password" autoComplete="off" required /><button type="submit">Sign in</button></div>
        {error ? <small role="alert">{error}</small> : null}
      </form>
    </main>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
      <BrowserRouter>
        <div className="shell">
          <Navigation />
          <main>
            <Suspense fallback={<PageState title="Loading" detail="Preparing this control surface…" />}>
              <Routes>
                <Route path="/overview" element={<FleetPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/runners" element={<Placeholder title="Runners" description="Registered execution devices and capabilities." />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/llm" element={<LlmPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/policies" element={<Placeholder title="Policies" description="Deterministic execution and approval boundaries." />} />
                <Route path="/diagnostics" element={<Placeholder title="Logs & Diagnostics" description="Structured system evidence without raw-log flooding." />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/setup" element={<SetupWizard />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
            <Suspense fallback={null}><AssistantDrawer /></Suspense>
          </main>
        </div>
      </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  );
}

export type { ConfigResponse };
