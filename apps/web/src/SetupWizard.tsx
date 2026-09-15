import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ConfigResponse } from "./api.js";

interface SetupResponse {
  state: { step: number; configRevision: number; completed: boolean };
  config: ConfigResponse<DispatcherConfig>;
}

interface DispatcherConfig {
  controller: { id: string; adminStrategy: string; [key: string]: unknown };
  runners: Array<{ displayName: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

const steps = ["Controller identity", "Local administration", "Runner", "Integrations", "Internal LLM"];

export default function SetupWizard(): React.JSX.Element {
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api<SetupResponse>("/api/setup"), retry: false });
  const [step, setStep] = useState(0);
  const [controllerId, setControllerId] = useState("");
  const [runnerName, setRunnerName] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!setup.data) return;
    setStep(setup.data.state.step);
    setControllerId(setup.data.config.config.controller.id);
    setRunnerName(setup.data.config.config.runners[0]?.displayName ?? "Local Runner");
  }, [setup.data]);

  async function continueSetup(): Promise<void> {
    if (!setup.data) return;
    setMessage("Saving this step…");
    try {
      let revision = setup.data.config.revision;
      if (step === 0 || step === 2) {
        const next = structuredClone(setup.data.config.config);
        next.controller.id = controllerId;
        if (next.runners[0]) next.runners[0].displayName = runnerName;
        const built = await api<{ plan: { id: string; requiresConfirmation: boolean } }>("/api/config/plans", {
          method: "POST",
          body: JSON.stringify({ config: next, actor: "setup-wizard" }),
        });
        const applied = await api<{ revision: number }>(`/api/config/plans/${built.plan.id}/apply`, {
          method: "POST",
          body: JSON.stringify({ confirmed: built.plan.requiresConfirmation }),
        });
        revision = applied.revision;
      }
      const nextStep = Math.min(4, step + 1);
      const completed = step === 4;
      await api("/api/setup", { method: "POST", body: JSON.stringify({ step: completed ? 4 : nextStep, completed, configRevision: revision }) });
      setStep(completed ? 4 : nextStep);
      setMessage(completed ? "Setup complete. Settings uses the same canonical configuration." : "Step committed. You can safely resume later.");
      await setup.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Step failed; nothing was committed.");
    }
  }

  if (setup.isLoading) return <div className="page-state">Restoring setup progress…</div>;
  if (!setup.data || setup.error) return <div className="page-state error" role="alert">Setup state is unavailable.</div>;
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">First-run setup</p><h1>{setup.data.state.completed ? "Setup complete" : steps[step]}</h1><p>Each completed step is committed as a configuration revision.</p></div><span className="step-count">{step + 1} / {steps.length}</span></header>
      <ol className="stepper" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "current" : ""}>{label}</li>)}</ol>
      <div className="panel wizard-card">
        {step === 0 ? <label>Controller ID<input value={controllerId} pattern="[a-z0-9][a-z0-9._-]*" onChange={(event) => setControllerId(event.target.value)} /></label> : null}
        {step === 1 ? <div><h2>Local-only administration</h2><p>The M2 default binds administration to the local machine. Network authentication hardening is scheduled for M15.</p></div> : null}
        {step === 2 ? <label>Runner display name<input value={runnerName} onChange={(event) => setRunnerName(event.target.value)} /></label> : null}
        {step === 3 ? <div><h2>Integrations are optional now</h2><p>Status: Not configured. Linear, GitHub, and Slack stay disabled until you store credentials and explicitly enable them.</p></div> : null}
        {step === 4 ? <div><h2>Internal LLM is optional now</h2><p>Status: Not configured. M3 adds endpoints, profiles, health checks, safe switching, and fallback. Deterministic M0–M2 functions work without it.</p></div> : null}
        {setup.data.state.completed
          ? <div className="wizard-actions"><Link className="button-link primary" to="/settings">Open Settings</Link></div>
          : <div className="wizard-actions"><button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button><button className="primary" onClick={() => void continueSetup()}>{step === 4 ? "Finish setup" : "Save and continue"}</button></div>}
        <p aria-live="polite">{message}</p>
      </div>
    </section>
  );
}
