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
    const body = (await response.json().catch(() => ({ code: "REQUEST_FAILED" }))) as { code?: string; message?: string };
    throw new Error(body.message ?? body.code ?? `Request failed (${response.status})`);
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

export async function signIn(credential: { token: string } | { code: string }): Promise<void> {
  await api("/auth/session", { method: "POST", body: JSON.stringify(credential) });
}

export function subscribeToEvents(onEvent: () => void): () => void {
  const source = new EventSource("/api/events");
  for (const event of ["runner.changed", "run.changed", "task.changed", "connector.changed", "resource.changed", "fleet.reset"]) source.addEventListener(event, onEvent);
  return () => source.close();
}
