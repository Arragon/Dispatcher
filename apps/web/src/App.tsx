import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, subscribeToEvents, type ConfigResponse, type Health, type RunnerSummary } from "./api.js";
import "./styles.css";

const SettingsPage = lazy(() => import("./SettingsPage.js"));
const SetupWizard = lazy(() => import("./SetupWizard.js"));

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

function StatusPill({ state }: { state: string }): React.JSX.Element {
  return <span className={`status status-${state.toLowerCase()}`}>{state}</span>;
}

function Overview(): React.JSX.Element {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<Health>("/health"), retry: false });
  const runners = useQuery({ queryKey: ["runners"], queryFn: () => api<{ runners: RunnerSummary[] }>("/api/runners"), retry: false });
  const impact = useQuery({
    queryKey: ["impact"],
    queryFn: () => api<{ rssBytes: number; databaseBytes: number; dashboardClients: number }>("/api/system-impact"),
    retry: false,
  });
  useEffect(() => subscribeToEvents(() => void runners.refetch()), [runners.refetch]);

  if (health.isLoading || runners.isLoading) return <PageState title="Connecting to Controller" detail="Loading live state…" />;
  if (health.error || runners.error) return <PageState title="Controller unavailable" detail="Check that dispatcher serve --with-runner is running." tone="error" />;
  const active = runners.data?.runners.filter((runner) => runner.state === "ONLINE") ?? [];
  return (
    <section>
      <header className="page-header">
        <div><p className="eyebrow">Control plane</p><h1>Overview / Fleet</h1><p>Live system state without background polling.</p></div>
        <StatusPill state={health.data?.status === "ok" ? "ONLINE" : "DEGRADED"} />
      </header>
      <div className="metric-grid">
        <Metric label="Controller" value={health.data?.mode ?? "—"} detail={`v${health.data?.version ?? "—"}`} />
        <Metric label="Runners online" value={`${active.length}`} detail={`${runners.data?.runners.length ?? 0} registered`} />
        <Metric label="Controller RSS" value={formatBytes(impact.data?.rssBytes)} detail="current process" />
        <Metric label="State database" value={formatBytes(impact.data?.databaseBytes)} detail={`${impact.data?.dashboardClients ?? 0} dashboard client`} />
      </div>
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Execution plane</p><h2>Runners</h2></div><span>{active.length} available</span></div>
        {runners.data?.runners.length ? (
          <div className="runner-list">
            {runners.data.runners.map((runner) => (
              <article className="runner-row" key={runner.id}>
                <div className="runner-avatar">{runner.displayName.slice(0, 2).toUpperCase()}</div>
                <div><strong>{runner.displayName}</strong><p>{runner.platform} · {runner.architecture} · {runner.capabilities.join(", ")}</p></div>
                <div className="runner-meta"><StatusPill state={runner.state} /><small>{new Date(runner.lastSeenAt).toLocaleTimeString()}</small></div>
              </article>
            ))}
          </div>
        ) : <PageState title="No runners registered" detail="Start the Controller with --with-runner." />}
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }): React.JSX.Element {
  return <article className="metric"><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function formatBytes(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function PageState({ title, detail, tone = "neutral" }: { title: string; detail: string; tone?: "neutral" | "error" }): React.JSX.Element {
  return <div className={`page-state ${tone}`} role={tone === "error" ? "alert" : "status"}><strong>{title}</strong><p>{detail}</p></div>;
}

function Placeholder({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <section><header className="page-header"><div><p className="eyebrow">Foundation ready</p><h1>{title}</h1><p>{description}</p></div></header><PageState title="No records yet" detail="This surface is ready for its roadmap milestone." /></section>;
}

export function SecureInput({ namespace, name, label }: { namespace: string; name: string; label: string }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("Not configured");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = input.current?.value;
    if (!value) return;
    setStatus("Saving securely…");
    try {
      await api(`/api/secrets/${namespace}/${name}`, { method: "PUT", body: JSON.stringify({ value }) });
      if (input.current) input.current.value = "";
      setStatus("Stored in SecretStore");
    } catch {
      if (input.current) input.current.value = "";
      setStatus("Secret could not be stored");
    }
  }
  return (
    <form className="secure-input" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`secret-${namespace}-${name}`}>{label}</label>
      <div><input ref={input} id={`secret-${namespace}-${name}`} type="password" autoComplete="off" required /><button type="submit">Store</button></div>
      <small aria-live="polite">{status}</small>
    </form>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="shell">
          <Navigation />
          <main>
            <Suspense fallback={<PageState title="Loading" detail="Preparing this control surface…" />}>
              <Routes>
                <Route path="/overview" element={<Overview />} />
                <Route path="/tasks" element={<Placeholder title="Tasks & Runs" description="Task truth and execution attempts remain separate." />} />
                <Route path="/runners" element={<Placeholder title="Runners" description="Registered execution devices and capabilities." />} />
                <Route path="/agents" element={<Placeholder title="Agents & Profiles" description="Provider accounts use safe display aliases." />} />
                <Route path="/llm" element={<Placeholder title="Internal LLM" description="Semantic runtime configuration arrives in M3." />} />
                <Route path="/integrations" element={<Placeholder title="Integrations" description="Linear, GitHub and Slack connection state." />} />
                <Route path="/policies" element={<Placeholder title="Policies" description="Deterministic execution and approval boundaries." />} />
                <Route path="/diagnostics" element={<Placeholder title="Logs & Diagnostics" description="Structured system evidence without raw-log flooding." />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/setup" element={<SetupWizard />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export type { ConfigResponse };
