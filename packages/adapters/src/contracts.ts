export type AdapterPlatform = "darwin" | "linux" | "win32";
export type BackendKind = "sdk" | "api" | "daemon" | "headless-cli" | "pty";

export interface AdapterBackendSpec {
  id: string;
  kind: BackendKind;
  priority: number;
  capabilities: string[];
}

export interface ProbeSpec {
  id: string;
  kind: "command" | "path" | "auth" | "capability";
  description: string;
  timeoutMs: number;
}

export interface AdapterManifest {
  apiVersion: 1;
  id: string;
  displayName: string;
  platforms: AdapterPlatform[];
  configSchema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  secretFields: string[];
  probes: ProbeSpec[];
  backends: AdapterBackendSpec[];
  capabilities: { pause: boolean; resume: boolean; usage: boolean; diagnostics: boolean };
}

export type AdapterSessionState = "STARTING" | "RUNNING" | "PAUSED" | "CANCELLED" | "COMPLETED" | "FAILED";

export interface AdapterSession {
  id: string;
  runId: string;
  backendId: string;
  workspacePath: string;
  state: AdapterSessionState;
  profileId?: string;
  providerSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterEvent {
  type: "session.started" | "session.message" | "session.paused" | "session.resumed" | "session.cancelled" | "session.completed" | "session.failed" | "activity";
  sessionId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface AdapterResult {
  sessionId: string;
  state: AdapterSessionState;
  summary: string;
  artifacts: Array<{ path: string; kind: string }>;
}

export interface AgentAdapter {
  readonly manifest: AdapterManifest;
  start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession>;
  send(sessionId: string, message: string): Promise<AdapterEvent>;
  pause(sessionId: string): Promise<AdapterSession>;
  resume(sessionId: string): Promise<AdapterSession>;
  cancel(sessionId: string): Promise<AdapterSession>;
  status(sessionId: string): Promise<AdapterSession>;
  result(sessionId: string): Promise<AdapterResult>;
  usage?(sessionId: string): Promise<Record<string, unknown>>;
  diagnostics?(sessionId: string): Promise<Record<string, unknown>>;
}

export class AdapterContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdapterContractError";
  }
}

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  return schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
}

export function validateManifest(manifest: AdapterManifest): AdapterManifest {
  if (manifest.apiVersion !== 1 || !manifest.id || !manifest.displayName) throw new AdapterContractError("INVALID_MANIFEST", "Manifest identity is incomplete");
  if (new Set(manifest.probes.map((probe) => probe.id)).size !== manifest.probes.length) throw new AdapterContractError("INVALID_MANIFEST", "Probe ids must be unique");
  if (new Set(manifest.backends.map((backend) => backend.id)).size !== manifest.backends.length) throw new AdapterContractError("INVALID_MANIFEST", "Backend ids must be unique");
  const properties = schemaProperties(manifest.configSchema);
  for (const field of manifest.secretFields) {
    if (!(field in properties)) throw new AdapterContractError("INVALID_MANIFEST", `Secret field ${field} is missing from config schema`);
    const ui = manifest.uiSchema[field];
    if (!ui || typeof ui !== "object" || (ui as Record<string, unknown>)["ui:widget"] !== "hidden") {
      throw new AdapterContractError("INVALID_MANIFEST", `Secret field ${field} must be hidden from ordinary forms`);
    }
  }
  return structuredClone(manifest);
}

export async function runAdapterContract(adapter: AgentAdapter): Promise<string[]> {
  const failures: string[] = [];
  try { validateManifest(adapter.manifest); } catch (error) { failures.push(error instanceof Error ? error.message : "invalid manifest"); }
  let session: AdapterSession | undefined;
  try {
    session = await adapter.start({ runId: "contract-run", workspacePath: "/contract/workspace", prompt: "hello" });
    if (session.state !== "RUNNING") failures.push("start must produce RUNNING session");
    const capabilities = new Set(adapter.manifest.backends.find((backend) => backend.id === session?.backendId)?.capabilities ?? []);
    if (capabilities.has("send") || capabilities.has("interactive-input")) {
      const event = await adapter.send(session.id, "continue");
      if (event.sessionId !== session.id) failures.push("send event must retain session identity");
    }
    const status = await adapter.status(session.id);
    if (status.id !== session.id) failures.push("status must retain session identity");
    if (capabilities.has("cancel")) {
      const cancelled = await adapter.cancel(session.id);
      if (cancelled.state !== "CANCELLED") failures.push("cancel must produce CANCELLED session");
    }
    const result = await adapter.result(session.id);
    if (result.sessionId !== session.id) failures.push("result must retain session identity");
    if (capabilities.has("cancel") && result.state !== "CANCELLED") failures.push("result must reflect terminal session");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "adapter contract failed");
  }
  return failures;
}
