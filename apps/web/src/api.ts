import type { QueryClient } from "@tanstack/react-query";

/** All projections affected by an applied configuration share this refresh boundary. */
export async function refreshConfiguration(client: QueryClient): Promise<void> {
  const keys = new Set(["config", "setup", "llm", "fleet", "runners", "agent-profiles", "fleet-connectors", "resources", "native-models"]);
  await client.invalidateQueries({ predicate: query => keys.has(String(query.queryKey[0])) });
}

export interface Health {
  status: "ok" | "degraded" | "starting";
  lifecycle: string;
  version: string;
  mode: string;
  uptimeMs: number;
}

export interface RunnerSummary {
  id: string;
  displayName: string;
  platform: string;
  architecture: string;
  state: string;
  capabilities: string[];
  capacity: number;
  lastSeenAt: string;
}

export interface ConfigResponse<T = Record<string, unknown>> {
  revision: number;
  config: T;
  updatedAt: string;
}

export const AUTH_REQUIRED_EVENT = "dispatcher:auth-required";

export class ApiError extends Error {
  override name = "ApiError";
  readonly code: string;
  readonly fieldErrors: unknown;
  readonly recovery: unknown;
  readonly taskId: string | undefined;
  readonly runId: string | undefined;
  constructor(readonly status: number, body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : typeof body.code === "string" ? body.code : `请求失败（${status}）`);
    this.code = typeof body.code === "string" ? body.code : "REQUEST_FAILED";
    this.fieldErrors = body.fieldErrors;
    this.recovery = body.recovery;
    this.taskId = typeof body.taskId === "string" ? body.taskId : undefined;
    this.runId = typeof body.runId === "string" ? body.runId : undefined;
  }
}

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = method === "GET" || method === "HEAD" ? undefined : cookie("dispatcher_csrf");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }), ...(csrf ? { "x-dispatcher-csrf": csrf } : {}), ...init?.headers },
  });
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface SessionState {
  authenticated: boolean;
  principal: { id: string; roles: string[] };
}

export async function currentSession(): Promise<SessionState | undefined> {
  const response = await fetch("/auth/session", { credentials: "same-origin" });
  return response.ok ? (await response.json()) as SessionState : undefined;
}

export async function signIn(credential: { token: string } | { code: string } | { username: string; password: string }): Promise<void> {
  await api("/auth/session", { method: "POST", body: JSON.stringify(credential) });
}

export function subscribeToEvents(onEvent: () => void): () => void {
  const source = new EventSource("/api/events");
  for (const event of ["runner.changed", "run.changed", "task.changed", "connector.changed", "resource.changed", "fleet.reset"]) source.addEventListener(event, onEvent);
  return () => source.close();
}
