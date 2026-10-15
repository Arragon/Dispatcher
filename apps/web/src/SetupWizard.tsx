import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ConfigResponse } from "./api.js";
import { Icon, Notice } from "./ui.js";

interface SetupResponse {
  state: { step: number; configRevision: number; completed: boolean };
  config: ConfigResponse<DispatcherConfig>;
}

interface DispatcherConfig {
  controller: { id: string; adminStrategy: string; [key: string]: unknown };
  runners: Array<{ displayName: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

const steps = ["控制台身份", "本地管理", "运行设备", "集成", "内部模型"];

export default function SetupWizard(): React.JSX.Element {
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api<SetupResponse>("/api/setup"), retry: false });
  const [busy, setBusy] = useState(false);
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
    if (!setup.data || busy) return;
    setBusy(true);
    setMessage("正在保存本步骤…");
    try {
      let revision = setup.data.config.revision;
      if (step === 0 || step === 2) {
        const latest = await api<ConfigResponse>("/api/config");
        if (latest.revision !== revision) throw new Error("配置版本已改变，请重新打开向导后继续。");
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
      setMessage(completed ? "设置已完成，可返回工作区。" : "本步骤已保存，可稍后继续。");
      await setup.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本步骤保存失败，请检查当前配置版本。");
    } finally { setBusy(false); }
  }

  if (setup.isLoading) return <div className="page-state" role="status">正在恢复设置进度…</div>;
  if (!setup.data || setup.error) return <div className="page-state error" role="alert">设置进度读取失败。<button onClick={()=>void setup.refetch()}>重试</button></div>;
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">初始设置向导</p><h1>{setup.data.state.completed ? "设置完成" : steps[step]}</h1><p>分步设置，可随时返回设置页继续管理。</p></div><span className="step-count">{step + 1} / {steps.length}</span></header>
      <ol className="stepper" aria-label="Setup progress">{steps.map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "current" : ""}>{label}</li>)}</ol>
      <div className="panel wizard-card">
        <div className="wizard-symbol"><Icon name={setup.data.state.completed ? "check" : step === 0 ? "branch" : step === 1 ? "shield" : step === 2 ? "device" : step === 3 ? "link" : "model"} size={29}/></div>
        {step === 0 ? <><h2>为你的工作区设置身份</h2><p>使用一个稳定的标识，连接本机 Controller 与执行设备。</p><label>Controller ID<input value={controllerId} pattern="[a-z0-9][a-z0-9._-]*" onChange={(event) => setControllerId(event.target.value)} /></label></> : null}
        {step === 1 ? <div><h2>本地管理与登录</h2><p>使用一次性登录链接或 owner token 进入控制台。保留现有鉴权和凭据保护。</p></div> : null}
        {step === 2 ? <><h2>识别本机执行设备</h2><label>设备显示名称<input value={runnerName} onChange={(event) => setRunnerName(event.target.value)} /></label><Notice>设备名称不会改变 Harness 账号或原生登录。</Notice></> : null}
        {step === 3 ? <div><h2>连接任务、代码和消息平台</h2><p>在设置中查看现有集成，安全保存凭据后再启用所需连接。</p><Link to="/settings">打开集成设置</Link></div> : null}
        {step === 4 ? <div><h2>内部模型可选</h2><p>配置模型可以增强命令理解和配置助手；确定性命令无需内部模型。</p><Link to="/models">管理内部模型</Link></div> : null}
        {setup.data.state.completed
          ? <div className="wizard-actions"><Link className="button-link primary" to="/settings">打开设置</Link></div>
          : <div className="wizard-actions"><button disabled={busy || step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>上一步</button><button disabled={busy} className="primary" onClick={() => void continueSetup()}>{step === 4 ? "完成设置" : "保存并继续"}</button></div>}
        <p aria-live="polite">{message}</p>
      </div>
    </section>
  );
}
