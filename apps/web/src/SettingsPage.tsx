import { useState } from "react";
import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useQuery } from "@tanstack/react-query";
import { api, type ConfigResponse } from "./api.js";
import { SecureInput } from "./App.js";

interface SchemaResponse {
  schema: RJSFSchema;
  uiSchema: UiSchema;
}

interface PlanResponse {
  plan: { id: string; risk: string; requiresConfirmation: boolean; changes: Array<{ path: string }> };
}

export default function SettingsPage(): React.JSX.Element {
  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api<ConfigResponse>("/api/config"), retry: false });
  const schemaQuery = useQuery({ queryKey: ["config-schema"], queryFn: () => api<SchemaResponse>("/api/config/schema"), retry: false });
  const [plan, setPlan] = useState<PlanResponse["plan"]>();
  const [message, setMessage] = useState("");

  async function buildPlan(formData: unknown): Promise<void> {
    setMessage("Validating plan…");
    try {
      const response = await api<PlanResponse>("/api/config/plans", {
        method: "POST",
        body: JSON.stringify({ config: formData, actor: "local-web" }),
      });
      setPlan(response.plan);
      setMessage(response.plan.changes.length === 0 ? "Configuration is already current." : "Plan ready for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Configuration is invalid");
    }
  }

  async function applyPlan(): Promise<void> {
    if (!plan) return;
    setMessage("Applying and verifying…");
    try {
      await api(`/api/config/plans/${plan.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirmed: plan.requiresConfirmation }),
      });
      setMessage("Configuration committed and audited.");
      setPlan(undefined);
      await configQuery.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Apply failed; previous revision was restored.");
    }
  }

  if (configQuery.isLoading || schemaQuery.isLoading) return <div className="page-state">Loading configuration…</div>;
  if (configQuery.error || schemaQuery.error || !configQuery.data || !schemaQuery.data) {
    return <div className="page-state error" role="alert">Configuration service is unavailable.</div>;
  }
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">Canonical store · revision {configQuery.data.revision}</p><h1>Settings</h1><p>All changes become validated, previewable ConfigPlans.</p></div></header>
      <div className="settings-layout">
        <div className="panel config-form">
          <Form
            schema={schemaQuery.data.schema}
            uiSchema={schemaQuery.data.uiSchema}
            validator={validator}
            formData={configQuery.data.config}
            noHtml5Validate
            onSubmit={({ formData }) => void buildPlan(formData)}
          >
            <button type="submit" className="primary">Build configuration plan</button>
          </Form>
        </div>
        <aside className="settings-aside">
          <div className="panel"><p className="eyebrow">Secure input</p><h2>Credentials</h2><p>Values go directly to SecretStore and never join ordinary form data.</p><SecureInput namespace="linear" name="main" label="Linear credential" /></div>
          <div className="panel plan-card" aria-live="polite"><p className="eyebrow">Transaction</p><h2>{plan ? `${plan.risk} plan` : "No pending plan"}</h2><p>{message || "Edit a field to prepare a plan."}</p>{plan && plan.changes.length > 0 ? <button className="primary" onClick={() => void applyPlan()}>{plan.requiresConfirmation ? "Confirm and apply" : "Apply plan"}</button> : null}</div>
        </aside>
      </div>
    </section>
  );
}
