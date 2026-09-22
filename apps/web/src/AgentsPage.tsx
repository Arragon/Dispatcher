import { useState } from "react";
import Ajv2020 from "ajv/dist/2020.js";
import Form from "@rjsf/core";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery } from "@tanstack/react-query";
import { SecureInput } from "./App.js";
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
  capabilities?: string[];
}

interface CompatibilityRow {
  adapterId: string;
  displayName: string;
  backendId: string;
  backendKind: string;
  capabilities: string[];
  unsupportedReasons: Record<string, string>;
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
  const compatibility = useQuery({ queryKey: ["adapter-compatibility"], queryFn: () => api<{ matrix: CompatibilityRow[] }>("/api/adapters/compatibility"), retry: false });
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
  const activeManifest = selected;
  async function discover(): Promise<void> {
    setMessage(`Scanning the selected ${activeManifest.displayName} profile…`);
    try {
      const result = await api<{ authenticated?: boolean; healthy?: boolean; installed?: boolean; version?: string; profile?: { alias: string }; diagnostic?: string; selected?: { authenticated: boolean; version?: string; executable: string }; candidates?: unknown[] }>(`/api/agents/${activeManifest.id}/discover`, { method: "POST", body: JSON.stringify({ ...draft, id: String(draft.id ?? `${activeManifest.id}-profile`) }) });
      const candidate = result.selected ?? result;
      const ready = candidate.authenticated || result.healthy || result.installed;
      setMessage(ready ? `${String(draft.alias ?? result.profile?.alias ?? activeManifest.displayName)} health check passed (${candidate.version ?? "version unknown"}).` : result.diagnostic ?? `${result.candidates?.length ?? 0} installation candidates found; authentication or an explicit selection is required.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : `${activeManifest.displayName} scan failed.`); }
  }
  async function saveProfile(): Promise<void> {
    setMessage("Saving the profile through ConfigPlan…");
    try {
      const result = await api<{ profile: ProfileView }>(`/api/agents/${activeManifest.id}/profiles`, { method: "POST", body: JSON.stringify({ ...draft, runnerId: String(draft.runnerId ?? "local") }) });
      setRunProfileId(result.profile.id);
      await profiles.refetch();
      setMessage(`${result.profile.alias} is configured for ${result.profile.provider}. Private paths remain server-side.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Profile could not be saved."); }
  }
  async function testProfile(id: string): Promise<void> {
    setMessage("Testing the isolated provider login…");
    try {
      const result = await api<{ authenticated?: boolean; profile?: { alias: string }; version?: string; selected?: { authenticated: boolean; version?: string } }>(`/api/agents/profiles/${id}/test`, { method: "POST" });
      const profile = profiles.data?.profiles.find((entry) => entry.id === id);
      const tested = result.selected ?? result;
      setMessage(tested.authenticated ? `${profile?.alias ?? result.profile?.alias ?? id} login passed (${tested.version ?? "version unknown"}).` : `${profile?.alias ?? id} requires authentication.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login test failed."); }
  }
  async function startRun(): Promise<void> {
    if (!runProfileId || !workspacePath || !prompt) return;
    setMessage("Starting an isolated agent run…");
    try {
      const result = await api<{ session: SessionView }>(`/api/agents/profiles/${runProfileId}/runs`, { method: "POST", body: JSON.stringify({ workspacePath, prompt }) });
      await profiles.refetch();
      setMessage(`Run started with session ${result.session.id}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run could not start."); }
  }
  const configuredProfiles = profiles.data?.profiles ?? [];
  const selectedCompatibility = compatibility.data?.matrix.filter((row) => row.adapterId === selected.id) ?? [];
  const profileId = typeof draft.id === "string" && draft.id ? draft.id : undefined;
  const secretNamespace = selected.id === "workbuddy-codebuddy"
    ? draft.provider === "workbuddy" || draft.provider === "codebuddy" ? draft.provider : undefined
    : selected.secretFields.includes("credentialRef") ? selected.id : undefined;
  return <section><header className="page-header"><div><p className="eyebrow">Manifest registry</p><h1>Agents & Profiles</h1><p>Every provider enters the same TaskContract, session, resource and delivery model.</p></div></header><div className="settings-layout"><div className="panel config-form"><label className="field-stack">Adapter<select value={selected.id} onChange={(event) => { setSelectedId(event.target.value); setDraft({}); }}>{query.data.manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.displayName}</option>)}</select></label><Form schema={selected.configSchema} uiSchema={selected.uiSchema} formData={draft} validator={validator} onChange={(event) => setDraft((event.formData ?? {}) as Record<string, unknown>)} onSubmit={() => setMessage("Draft validated against the adapter manifest.")}><button className="primary" type="submit">Validate adapter draft</button></Form>{secretNamespace && profileId ? <SecureInput namespace={secretNamespace} name={profileId} label={`${selected.displayName} credential`} onStored={(credentialRef) => setDraft((current) => ({ ...current, credentialRef }))} onDeleted={() => setDraft((current) => { const next = { ...current }; delete next.credentialRef; return next; })} /> : selected.secretFields.includes("credentialRef") ? <p>Set a profile ID{selected.id === "workbuddy-codebuddy" ? " and provider" : ""} before storing its credential.</p> : null}{selected.id !== "generic-mock" && <div className="secure-actions"><button type="button" onClick={() => void discover()}>Scan & test health</button><button type="button" className="primary" onClick={() => void saveProfile()}>Save {selected.displayName} profile</button></div>}</div><aside className="settings-aside"><div className="panel"><p className="eyebrow">Contract</p><h2>{selected.displayName}</h2><p>{selected.platforms.join(" · ")}</p><p>Backends: {selected.backends.map((backend) => `${backend.kind} (${backend.capabilities.join(", ")})`).join("; ")}</p><p>Optional capabilities: {Object.entries(selected.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}</p>{selectedCompatibility.map((row) => <div key={row.backendId}><strong>{row.backendId}</strong><p>{Object.values(row.unsupportedReasons).join(" · ") || "All declared capabilities are supported."}</p></div>)}</div><div className="panel" aria-live="polite">{message}</div></aside></div>{configuredProfiles.length > 0 && <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Configured aliases</p><h2>Provider profiles</h2></div></div><div className="runner-list">{configuredProfiles.map((profile) => <article className="runner-row" key={profile.id}><div className="runner-avatar">{profile.alias.slice(0, 2).toUpperCase()}</div><div><strong>{profile.alias}</strong><p>{profile.provider} · {profile.runnerId} · {profile.state}</p><p>{profile.capabilities?.join(" · ")}</p></div><button type="button" onClick={() => void testProfile(profile.id)}>Test health</button></article>)}</div><div className="config-form"><label className="field-stack">Profile<select value={runProfileId} onChange={(event) => setRunProfileId(event.target.value)}><option value="">Select profile</option>{configuredProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.alias} ({profile.provider})</option>)}</select></label><label className="field-stack">Worktree path<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} /></label><label className="field-stack">Run instruction<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><button type="button" className="primary" onClick={() => void startRun()}>Start isolated run</button></div>{profiles.data?.sessions.length ? <div className="runner-list">{profiles.data.sessions.map((session) => <article className="runner-row" key={session.id}><div><strong>{session.id}</strong><p>{session.profileId} · {session.state}</p></div></article>)}</div> : null}</div>}</section>;
}
