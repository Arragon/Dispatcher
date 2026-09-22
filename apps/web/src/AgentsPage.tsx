import { useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

interface Manifest {
  id: string;
  displayName: string;
  platforms: string[];
  configSchema: RJSFSchema;
  uiSchema: UiSchema;
  secretFields: string[];
  backends: Array<{ id: string; kind: string; capabilities: string[] }>;
  capabilities: Record<string, boolean>;
}

interface ProfileView {
  id: string;
  provider: string;
  alias: string;
  runnerId: string;
  state: string;
}

interface SessionView {
  id: string;
  runId: string;
  profileId?: string;
  state: string;
  updatedAt: string;
}

const validator = customizeValidator({ AjvClass: Ajv2020 });

export default function AgentsPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["adapter-manifests"], queryFn: () => api<{ manifests: Manifest[] }>("/api/adapters/manifests"), retry: false });
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: () => api<{ profiles: ProfileView[]; sessions: SessionView[] }>("/api/agents/profiles"), retry: false });
  const [selectedId, setSelectedId] = useState("generic-cli");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [runProfileId, setRunProfileId] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [message, setMessage] = useState("Manifest fields are local drafts until a provider profile is explicitly saved.");
  if (query.isLoading) return <div className="page-state">Loading adapter manifests…</div>;
  if (query.error || !query.data) return <div className="page-state error">Adapter manifests are unavailable.</div>;
  const selected = query.data.manifests.find((manifest) => manifest.id === selectedId) ?? query.data.manifests[0];
  if (!selected) return <div className="page-state">No adapter manifests registered.</div>;
  async function discover(): Promise<void> {
    setMessage("Scanning the selected Codex profile…");
    try {
      const result = await api<{ authenticated: boolean; version?: string; profile: { alias: string }; diagnostic?: string }>("/api/agents/codex/discover", { method: "POST", body: JSON.stringify({ ...draft, id: String(draft.id ?? "codex-profile") }) });
      setMessage(result.authenticated ? `${result.profile.alias} is authenticated (${result.version ?? "version unknown"}).` : result.diagnostic ?? "Authentication is required.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Codex scan failed."); }
  }
  async function saveProfile(): Promise<void> {
    setMessage("Saving the profile through ConfigPlan…");
    try {
      const result = await api<{ profile: ProfileView }>("/api/agents/codex/profiles", { method: "POST", body: JSON.stringify({ ...draft, runnerId: String(draft.runnerId ?? "local") }) });
      setRunProfileId(result.profile.id);
      await profiles.refetch();
      setMessage(`${result.profile.alias} is configured. Private profile paths remain server-side.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Profile could not be saved."); }
  }
  async function testProfile(id: string): Promise<void> {
    setMessage("Testing the isolated Codex login…");
    try {
      const result = await api<{ authenticated: boolean; profile: { alias: string }; version?: string }>(`/api/agents/profiles/${id}/test`, { method: "POST" });
      setMessage(result.authenticated ? `${result.profile.alias} login passed (${result.version ?? "version unknown"}).` : `${result.profile.alias} requires authentication.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login test failed."); }
  }
  async function startRun(): Promise<void> {
    if (!runProfileId || !workspacePath || !prompt) return;
    setMessage("Starting an isolated Codex run…");
    try {
      const result = await api<{ session: SessionView }>(`/api/agents/profiles/${runProfileId}/runs`, { method: "POST", body: JSON.stringify({ workspacePath, prompt }) });
      await profiles.refetch();
      setMessage(`Run started with session ${result.session.id}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run could not start."); }
  }
  const codexProfiles = profiles.data?.profiles.filter((profile) => profile.provider === "codex") ?? [];
  return <section><header className="page-header"><div><p className="eyebrow">Manifest registry</p><h1>Agents & Profiles</h1><p>Adapter-owned schemas generate configuration; saved views expose aliases rather than account identities or profile paths.</p></div></header><div className="settings-layout"><div className="panel config-form"><label className="field-stack">Adapter<select value={selected.id} onChange={(event) => { setSelectedId(event.target.value); setDraft({}); }}>{query.data.manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.displayName}</option>)}</select></label><Form schema={selected.configSchema} uiSchema={selected.uiSchema} formData={draft} validator={validator} onChange={(event) => setDraft((event.formData ?? {}) as Record<string, unknown>)} onSubmit={() => setMessage("Draft validated against the adapter manifest.")}><button className="primary" type="submit">Validate adapter draft</button></Form>{selected.id === "codex" && <div className="secure-actions"><button type="button" onClick={() => void discover()}>Scan & test login</button><button type="button" className="primary" onClick={() => void saveProfile()}>Save Codex profile</button></div>}</div><aside className="settings-aside"><div className="panel"><p className="eyebrow">Contract</p><h2>{selected.displayName}</h2><p>{selected.platforms.join(" · ")}</p><p>Backends: {selected.backends.map((backend) => `${backend.kind} (${backend.capabilities.join(", ")})`).join("; ")}</p><p>Optional capabilities: {Object.entries(selected.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}</p></div><div className="panel" aria-live="polite">{message}</div></aside></div>{codexProfiles.length > 0 && <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Configured aliases</p><h2>Codex profiles</h2></div></div><div className="runner-list">{codexProfiles.map((profile) => <article className="runner-row" key={profile.id}><div className="runner-avatar">{profile.alias.slice(0, 2).toUpperCase()}</div><div><strong>{profile.alias}</strong><p>{profile.runnerId} · {profile.state}</p></div><button type="button" onClick={() => void testProfile(profile.id)}>Test login</button></article>)}</div><div className="config-form"><label className="field-stack">Profile<select value={runProfileId} onChange={(event) => setRunProfileId(event.target.value)}><option value="">Select profile</option>{codexProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.alias}</option>)}</select></label><label className="field-stack">Worktree path<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} /></label><label className="field-stack">Run instruction<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><button type="button" className="primary" onClick={() => void startRun()}>Start isolated run</button></div>{profiles.data?.sessions.length ? <div className="runner-list">{profiles.data.sessions.map((session) => <article className="runner-row" key={session.id}><div><strong>{session.id}</strong><p>{session.profileId} · {session.state}</p></div></article>)}</div> : null}</div>}</section>;
}
