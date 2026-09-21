import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConnectorDefinition, ConnectorInstance } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorProbeResult } from "./contracts.js";
import type { DeliveryRequest, RepositoryRef, ScmAdapter } from "./scm.js";
import { assertDeliveryGate } from "./scm.js";
import type { IntegrationFetch, SecretResolver } from "./linear.js";

export interface GitTransport {
  ensureBranch(repository: RepositoryRef, branch: string, baseBranch: string): Promise<void>;
  push(repository: RepositoryRef, branch: string): Promise<{ commit: string }>;
}

const execFileAsync = promisify(execFile);

export class LocalGitTransport implements GitTransport {
  async ensureBranch(repository: RepositoryRef, branch: string, baseBranch: string): Promise<void> {
    const cwd = this.cwd(repository);
    this.ref(branch);
    this.ref(baseBranch);
    const current = (await execFileAsync("git", ["branch", "--show-current"], { cwd, timeout: 10_000 })).stdout.trim();
    if (current === branch) return;
    let exists = true;
    try { await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd, timeout: 10_000 }); }
    catch { exists = false; }
    await execFileAsync("git", exists ? ["switch", branch] : ["switch", "-c", branch, baseBranch], { cwd, timeout: 30_000 });
  }

  async push(repository: RepositoryRef, branch: string): Promise<{ commit: string }> {
    const cwd = this.cwd(repository);
    this.ref(branch);
    const status = (await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000 })).stdout.trim();
    if (status) {
      await execFileAsync("git", ["add", "--all"], { cwd, timeout: 30_000 });
      await execFileAsync("git", ["commit", "-m", "Dispatcher task delivery"], { cwd, timeout: 30_000 });
    }
    const commit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 10_000 })).stdout.trim();
    await execFileAsync("git", ["push", "origin", `HEAD:refs/heads/${branch}`], { cwd, timeout: 120_000 });
    return { commit };
  }

  private cwd(repository: RepositoryRef): string {
    if (!repository.localPath) throw new ConnectorError("PERMANENT", "A worktree path is required for Git delivery", { retryable: false, operation: "delivery" });
    return repository.localPath;
  }

  private ref(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes("..") || value.endsWith("/") || value.includes("//")) {
      throw new ConnectorError("PERMANENT", "Unsafe Git ref", { retryable: false, operation: "delivery" });
    }
  }
}

export const githubScmDefinition = createConnectorDefinition({
  id: "scm.github",
  kind: "scm",
  displayName: "GitHub",
  capabilities: [
    { namespace: "scm.branch", version: 1, support: "supported" },
    { namespace: "scm.push", version: 1, support: "supported" },
    { namespace: "scm.pull-request", version: 1, support: "supported" },
    { namespace: "scm.ci", version: 1, support: "supported" },
    { namespace: "scm.review", version: 1, support: "supported" },
  ],
});

export class GitHubScmConnector implements ScmAdapter {
  readonly definition: ConnectorDefinition = githubScmDefinition;
  readonly instance: ConnectorInstance;
  private readonly fetch: IntegrationFetch;
  private readonly apiBase: string;

  constructor(private readonly options: {
    instance: ConnectorInstance;
    credentialRef: string;
    resolveSecret: SecretResolver;
    transport: GitTransport;
    fetch?: IntegrationFetch;
    apiBase?: string;
  }) {
    if (!options.credentialRef.startsWith("secret://github/")) throw new ConnectorError("AUTH", "GitHub credential must use the github secret namespace");
    this.instance = structuredClone(options.instance);
    this.fetch = options.fetch ?? fetch;
    this.apiBase = options.apiBase ?? "https://api.github.com";
  }

  async probe(): Promise<ConnectorProbeResult> {
    await this.request("/user");
    return { health: "HEALTHY", checkedAt: new Date().toISOString() };
  }
  async ensureBranch(repository: RepositoryRef, branch: string, baseBranch: string): Promise<void> {
    await this.options.transport.ensureBranch(repository, branch, baseBranch);
  }
  async push(repository: RepositoryRef, branch: string): Promise<{ commit: string }> {
    return this.options.transport.push(repository, branch);
  }
  async createOrGetPullRequest(request: DeliveryRequest): Promise<{ id: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" }> {
    assertDeliveryGate(request);
    const repositoryPath = `/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.name)}`;
    const existing = await this.request(`${repositoryPath}/pulls?state=all&head=${encodeURIComponent(`${request.repository.owner}:${request.headBranch}`)}`);
    if (Array.isArray(existing) && existing.length) return githubPullRequest(existing[0]);
    const created = await this.request(`${repositoryPath}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: request.title, body: `${request.body}\n\n<!-- dispatcher:${request.idempotencyKey} -->`, head: request.headBranch, base: request.baseBranch }),
    });
    return githubPullRequest(created);
  }
  async getCiStatus(repository: RepositoryRef, ref: string): Promise<{ state: "PENDING" | "PASSED" | "FAILED"; url?: string }> {
    const data = await this.request(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(ref)}/status`);
    const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const state = value.state === "success" ? "PASSED" : value.state === "failure" || value.state === "error" ? "FAILED" : "PENDING";
    return { state, ...(typeof value.url === "string" ? { url: value.url } : {}) };
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.options.resolveSecret(this.options.credentialRef);
    let response: Response;
    try {
      response = await this.fetch(`${this.apiBase}${path}`, {
        ...init,
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
    } catch (error) {
      throw new ConnectorError("TEMPORARY", error instanceof Error ? error.message : "GitHub request failed", { retryable: true, operation: "delivery" });
    }
    if (response.status === 429 || response.status === 403 && response.headers.has("x-ratelimit-reset")) {
      throw new ConnectorError("RATE_LIMITED", "GitHub rate limit reached", { retryable: true, operation: "delivery" });
    }
    if (response.status === 401 || response.status === 403) throw new ConnectorError("AUTH", "GitHub authentication failed", { retryable: false, operation: "auth" });
    if (response.status >= 500) throw new ConnectorError("TEMPORARY", `GitHub returned ${response.status}`, { retryable: true, operation: "delivery" });
    if (!response.ok) throw new ConnectorError("PERMANENT", `GitHub returned ${response.status}`, { retryable: false, operation: "delivery" });
    return response.status === 204 ? {} : response.json();
  }
}

function githubPullRequest(value: unknown): { id: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" } {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if ((typeof item.id !== "number" && typeof item.id !== "string") || typeof item.html_url !== "string") {
    throw new ConnectorError("PERMANENT", "GitHub returned an invalid pull request", { retryable: false, operation: "delivery" });
  }
  const state = item.merged_at ? "MERGED" : item.state === "closed" ? "CLOSED" : "OPEN";
  return { id: String(item.id), url: item.html_url, state };
}
