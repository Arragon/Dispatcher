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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ code: "REQUEST_FAILED" }))) as { code?: string; message?: string };
    throw new Error(body.message ?? body.code ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function subscribeToEvents(onEvent: () => void): () => void {
  const source = new EventSource("/api/events");
  source.addEventListener("runner.changed", onEvent);
  return () => source.close();
}
