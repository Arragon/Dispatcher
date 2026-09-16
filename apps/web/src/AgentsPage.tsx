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

const validator = customizeValidator({ AjvClass: Ajv2020 });

export default function AgentsPage(): React.JSX.Element {
  const query = useQuery({ queryKey: ["adapter-manifests"], queryFn: () => api<{ manifests: Manifest[] }>("/api/adapters/manifests"), retry: false });
  const [selectedId, setSelectedId] = useState("generic-cli");
  const [message, setMessage] = useState("Manifest fields are local drafts until a provider profile is explicitly saved.");
  if (query.isLoading) return <div className="page-state">Loading adapter manifests…</div>;
  if (query.error || !query.data) return <div className="page-state error">Adapter manifests are unavailable.</div>;
  const selected = query.data.manifests.find((manifest) => manifest.id === selectedId) ?? query.data.manifests[0];
  if (!selected) return <div className="page-state">No adapter manifests registered.</div>;
  return <section><header className="page-header"><div><p className="eyebrow">Manifest registry</p><h1>Agents & Profiles</h1><p>Adapter-owned schemas generate the base form; secret fields stay outside ordinary form data.</p></div></header><div className="settings-layout"><div className="panel config-form"><label className="field-stack">Adapter<select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{query.data.manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.displayName}</option>)}</select></label><Form schema={selected.configSchema} uiSchema={selected.uiSchema} validator={validator} onSubmit={() => setMessage("Draft validated against the adapter manifest.")}><button className="primary" type="submit">Validate adapter draft</button></Form></div><aside className="settings-aside"><div className="panel"><p className="eyebrow">Contract</p><h2>{selected.displayName}</h2><p>{selected.platforms.join(" · ")}</p><p>Backends: {selected.backends.map((backend) => `${backend.kind} (${backend.capabilities.join(", ")})`).join("; ")}</p><p>Optional capabilities: {Object.entries(selected.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}</p></div><div className="panel" aria-live="polite">{message}</div></aside></div></section>;
}
