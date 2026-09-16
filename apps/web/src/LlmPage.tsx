import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";
import { SecureInput } from "./App.js";

type Protocol = "openai-responses" | "openai-chat" | "anthropic-messages" | "azure-openai-v1";
type Role = "command_parser" | "config_assistant" | "runtime_summarizer" | "error_classifier";
interface LlmConfig {
  configured: boolean;
  endpoints: Array<{ id: string; protocol: Protocol; baseUrl: string; credentialRef: string }>;
  profiles: Array<{ id: string; endpointId: string; alias: string; model: string; enabled: boolean }>;
  pools: Array<{ id: string; profileIds: string[] }>;
  roleBindings: Array<{ role: Role; poolId: string }>;
  defaultPoolId?: string;
}
interface LlmView {
  revision: number;
  config: LlmConfig;
  state: { mode: "ACTIVE" | "DEGRADED_NO_LLM"; activeProfileByRole: Partial<Record<Role, string>>; healthByProfile: Record<string, { status: string; reason?: string }> };
}
const roles: Role[] = ["command_parser", "config_assistant", "runtime_summarizer", "error_classifier"];

export default function LlmPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["llm"], queryFn: () => api<LlmView>("/api/llm"), retry: false });
  const [draft, setDraft] = useState<LlmConfig>();
  const [message, setMessage] = useState("");
  useEffect(() => { if (query.data) setDraft(structuredClone(query.data.config)); }, [query.data]);

  async function save(): Promise<void> {
    if (!draft) return;
    setMessage("Applying validated ConfigPlan…");
    try {
      await api("/api/llm/config", { method: "PUT", body: JSON.stringify({ config: draft, actor: "local-web", confirmed: true }) });
      setMessage("Internal LLM configuration committed and audited.");
      await query.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Configuration was not applied."); }
  }

  function addEndpoint(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft) return;
    const values = new FormData(event.currentTarget);
    const id = String(values.get("id") ?? "").trim();
    const baseUrl = String(values.get("baseUrl") ?? "").trim();
    const protocol = String(values.get("protocol") ?? "openai-responses") as Protocol;
    if (!id || !baseUrl) return;
    setDraft({ ...draft, endpoints: [...draft.endpoints.filter((entry) => entry.id !== id), { id, baseUrl, protocol, credentialRef: `secret://llm/${id}` }] });
    event.currentTarget.reset();
  }

  function addProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft) return;
    const values = new FormData(event.currentTarget);
    const id = String(values.get("id") ?? "").trim();
    const endpointId = String(values.get("endpointId") ?? "");
    const model = String(values.get("model") ?? "").trim();
    if (!id || !endpointId || !model) return;
    const profiles = [...draft.profiles.filter((entry) => entry.id !== id), { id, endpointId, model, alias: id, enabled: true }];
    const pool = draft.pools.find((entry) => entry.id === "default") ?? { id: "default", profileIds: [] };
    const nextPool = { ...pool, profileIds: [...pool.profileIds.filter((entry) => entry !== id), id] };
    setDraft({ ...draft, configured: true, profiles, pools: [...draft.pools.filter((entry) => entry.id !== "default"), nextPool], defaultPoolId: "default" });
    event.currentTarget.reset();
  }

  function moveProfile(profileId: string, offset: -1 | 1): void {
    if (!draft) return;
    const pool = draft.pools.find((entry) => entry.id === (draft.defaultPoolId ?? "default"));
    if (!pool) return;
    const index = pool.profileIds.indexOf(profileId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= pool.profileIds.length) return;
    const profileIds = [...pool.profileIds];
    [profileIds[index], profileIds[target]] = [profileIds[target]!, profileIds[index]!];
    setDraft({ ...draft, pools: draft.pools.map((entry) => entry.id === pool.id ? { ...entry, profileIds } : entry) });
  }

  async function probe(profileId: string): Promise<void> {
    setMessage(`Testing ${profileId}…`);
    try {
      const result = await api<{ health: { status: string; reason?: string } }>(`/api/llm/profiles/${profileId}/test`, { method: "POST" });
      setMessage(`${profileId}: ${result.health.status}${result.health.reason ? ` (${result.health.reason})` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Probe failed."); }
    await query.refetch();
  }

  async function switchProfile(role: Role, profileId: string): Promise<void> {
    if (!profileId) return;
    setMessage(`Switching ${role}…`);
    try {
      await api(`/api/llm/roles/${role}/switch`, { method: "POST", body: JSON.stringify({ profileId }) });
      setMessage(`${role} now uses ${profileId}.`);
    } catch (error) { setMessage(error instanceof Error ? `${error.message}; previous profile remains active.` : "Switch failed; previous profile remains active."); }
    await query.refetch();
  }

  if (query.isLoading) return <div className="page-state">Loading Internal LLM runtime…</div>;
  if (query.error || !draft || !query.data) return <div className="page-state error" role="alert">Internal LLM service is unavailable.</div>;
  const defaultPool = draft.pools.find((entry) => entry.id === (draft.defaultPoolId ?? "default"));
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">Config revision {query.data.revision}</p><h1>Internal LLM</h1><p>Manage endpoints, fallback order, safe switching, and manual recovery.</p></div><span className={`status status-${query.data.state.mode === "ACTIVE" ? "online" : "degraded"}`}>{query.data.state.mode}</span></header>
      <p className="panel" aria-live="polite">{message || "No background polling. Run an explicit probe when fresh evidence is needed."}</p>
      <div className="settings-layout"><div>
        <div className="panel"><p className="eyebrow">Endpoints</p><h2>Add endpoint</h2><form className="compact-form" onSubmit={addEndpoint}><input name="id" aria-label="Endpoint ID" placeholder="endpoint ID" required /><select name="protocol" aria-label="Protocol"><option value="openai-responses">OpenAI Responses</option><option value="openai-chat">OpenAI Chat / Compatible</option><option value="anthropic-messages">Anthropic Messages</option><option value="azure-openai-v1">Azure OpenAI v1</option></select><input name="baseUrl" aria-label="Base URL" placeholder="https://…/v1" required /><button type="submit">Add endpoint</button></form></div>
        {draft.endpoints.map((endpoint) => <div className="panel" key={endpoint.id}><div className="panel-heading"><div><h2>{endpoint.id}</h2><p>{endpoint.protocol} · {endpoint.baseUrl}</p></div><button onClick={() => setDraft({ ...draft, endpoints: draft.endpoints.filter((entry) => entry.id !== endpoint.id) })}>Remove</button></div><SecureInput namespace="llm" name={endpoint.id} label={`${endpoint.id} credential`} /></div>)}
        <div className="panel"><p className="eyebrow">Profiles & fallback</p><h2>Add profile</h2><form className="compact-form" onSubmit={addProfile}><input name="id" aria-label="Profile ID" placeholder="profile ID / alias" required /><select name="endpointId" aria-label="Endpoint" required><option value="">Choose endpoint</option>{draft.endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.id}</option>)}</select><input name="model" aria-label="Model" placeholder="model" required /><button type="submit">Add profile</button></form></div>
        {defaultPool?.profileIds.map((profileId, index) => { const profile = draft.profiles.find((entry) => entry.id === profileId); if (!profile) return null; const health = query.data.state.healthByProfile[profile.id]; return <article className="panel runner-row" key={profile.id}><div className="runner-avatar">{index + 1}</div><div><strong>{profile.alias}</strong><p>{profile.model} · {profile.endpointId} · {health?.status ?? "UNKNOWN"}</p></div><div className="secure-actions"><button onClick={() => moveProfile(profile.id, -1)} disabled={index === 0}>↑</button><button onClick={() => moveProfile(profile.id, 1)} disabled={index === defaultPool.profileIds.length - 1}>↓</button><button onClick={() => void probe(profile.id)}>Test connection</button></div></article>; })}
      </div><aside className="settings-aside"><div className="panel"><p className="eyebrow">Role routing</p><h2>Manual switch</h2>{roles.map((role) => <label className="field-stack" key={role}>{role}<select value={query.data.state.activeProfileByRole[role] ?? ""} onChange={(event) => void switchProfile(role, event.target.value)}><option value="">Automatic fallback order</option>{defaultPool?.profileIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>)}</div><div className="panel"><button className="primary" onClick={() => void save()}>Save via ConfigPlan</button></div></aside></div>
    </section>
  );
}
