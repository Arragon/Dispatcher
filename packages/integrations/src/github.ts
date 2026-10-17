import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConnectorDefinition, ConnectorInstance } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorProbeResult } from "./contracts.js";
import type { DeliveryRequest, PullRequestStatus, RepositoryRef, ScmAdapter, ScmRepositoryInspection } from "./scm.js";
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
  async inspectDeliveryRepository(repository:RepositoryRef,baseBranch:string):Promise<ScmRepositoryInspection>{
    const invalid=():never=>{throw new ConnectorError("PERMANENT","SCM repository, write access or base branch is unavailable or unconfirmed",{retryable:false,operation:"read"});};
    let base:URL;try{base=new URL(this.apiBase);}catch{return invalid();}
    if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||![repository.owner,repository.name].every(part=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(part))||!baseBranch||baseBranch.length>200||baseBranch.startsWith("-")||/[\s~^:?*[\\]/.test(baseBranch)||["..","//","@{"].some(part=>baseBranch.includes(part))||baseBranch.split("/").some(part=>!part||part.startsWith(".")||part.endsWith(".lock"))||baseBranch.endsWith("."))return invalid();
    const path=`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,fullName=`${repository.owner}/${repository.name}`.toLowerCase(),raw=await this.request(path),metadata=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
    const permissions=metadata.permissions&&typeof metadata.permissions==="object"?metadata.permissions as Record<string,unknown>:{};
    if(typeof metadata.full_name!=="string"||metadata.full_name.toLowerCase()!==fullName||metadata.archived!==false||metadata.disabled!==false||permissions.push!==true)return invalid();
    const rawBranch=await this.request(`${path}/branches/${encodeURIComponent(baseBranch)}`),branch=rawBranch&&typeof rawBranch==="object"?rawBranch as Record<string,unknown>:{},commit=branch.commit&&typeof branch.commit==="object"?branch.commit as Record<string,unknown>:{};
    if(branch.name!==baseBranch||typeof commit.sha!=="string"||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit.sha))return invalid();
    return {host:base.hostname==="api.github.com"?"github.com":base.hostname.toLowerCase(),repository:fullName,baseBranch};
  }
  async ensureBranch(repository: RepositoryRef, branch: string, baseBranch: string): Promise<void> {
    await this.options.transport.ensureBranch(repository, branch, baseBranch);
  }
  async push(repository: RepositoryRef, branch: string): Promise<{ commit: string }> {
    return this.options.transport.push(repository, branch);
  }
  async createOrGetPullRequest(request: DeliveryRequest): Promise<PullRequestStatus> {
    assertDeliveryGate(request);
    const authority=()=>{if(request.signal?.aborted)throw new ConnectorError("CONFLICT","PR operation was cancelled",{retryable:false,operation:"delivery"});request.assertAuthority?.("pull-request");},repositoryPath=`/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.name)}`;
    const existing=await this.request(`${repositoryPath}/pulls?state=all&head=${encodeURIComponent(`${request.repository.owner}:${request.headBranch}`)}&base=${encodeURIComponent(request.baseBranch)}&per_page=100`,{...(request.signal?{signal:request.signal}:{})},authority);
    if(!Array.isArray(existing)||existing.length>100)throw new ConnectorError("PERMANENT","GitHub returned invalid PR lookup metadata",{retryable:false,operation:"read"});
    for(const candidate of existing){if(!request.expectedHeadCommit)return githubPullRequest(candidate);try{return this.qualifiedPullRequest(candidate,request);}catch{/* A different or changed PR is not this creation receipt. */}}
    if(existing.length||request.creationAllowed===false)throw new ConnectorError("CONFLICT","PR creation outcome is unconfirmed; reconcile the existing request before creating another",{retryable:false,operation:"delivery"});
    const created=await this.request(`${repositoryPath}/pulls`,{
      method:"POST",...(request.signal?{signal:request.signal}:{}),
      body:JSON.stringify({title:request.title,body:`${request.body}\n\n<!-- dispatcher:${request.idempotencyKey} -->`,head:request.headBranch,base:request.baseBranch}),
    },authority,request.beforeCreate);
    return request.expectedHeadCommit?this.qualifiedPullRequest(created,request):githubPullRequest(created);
  }
  private qualifiedPullRequest(value:unknown,request:DeliveryRequest):PullRequestStatus{
    const invalid=():never=>{throw new ConnectorError("CONFLICT","PR receipt does not match its frozen repository, branches, commit or marker",{retryable:false,operation:"delivery"});};
    const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
    const row=object(value),head=object(row.head),base=object(row.base),repository=`${request.repository.owner}/${request.repository.name}`.toLowerCase();let url:URL,api:URL;
    try{url=new URL(String(row.html_url));api=new URL(this.apiBase);}catch{return invalid();}
    const path=url.pathname.split("/"),number=Number(path[4]),host=api.hostname==="api.github.com"?"github.com":api.hostname;
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.hostname!==host||path.length!==5||`${path[1]}/${path[2]}`.toLowerCase()!==repository||path[3]!=="pull"||!Number.isSafeInteger(number)||number<1||row.number!==number||!["open","closed"].includes(String(row.state))||typeof row.body!=="string"||!row.body.includes(`<!-- dispatcher:${request.idempotencyKey} -->`)||typeof request.expectedHeadCommit!=="string"||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(request.expectedHeadCommit)||head.sha!==request.expectedHeadCommit||head.ref!==request.headBranch||base.ref!==request.baseBranch||String(object(head.repo).full_name).toLowerCase()!==repository||String(object(base.repo).full_name).toLowerCase()!==repository)return invalid();
    return githubPullRequest(value);
  }
  async getPullRequest(repository: RepositoryRef, number: number): Promise<PullRequestStatus> {
    if (!Number.isInteger(number) || number < 1) throw new ConnectorError("PERMANENT", "Invalid pull request number", { retryable: false, operation: "read" });
    return githubPullRequest(await this.request(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${number}`));
  }
  async getCiStatus(repository: RepositoryRef, ref: string): Promise<{ state: "PENDING" | "PASSED" | "FAILED"; url?: string }> {
    const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(ref)}`;
    const data = await this.request(`${path}/status`);
    const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
    // Combined status covers every context even when its statuses array is paginated.
    const statusCount = typeof value.total_count === "number" ? value.total_count : Array.isArray(value.statuses) ? value.statuses.length : value.state === "success" || value.state === "failure" || value.state === "error" ? 1 : 0;
    const states: Array<"PENDING" | "PASSED" | "FAILED"> = statusCount ? [value.state === "success" ? "PASSED" : value.state === "failure" || value.state === "error" ? "FAILED" : "PENDING"] : [];
    let checked = 0;
    let checkUrl: string | undefined;
    for (let page = 1; ; page += 1) {
      const response = await this.request(`${path}/check-runs?filter=latest&per_page=100&page=${page}`);
      const checks = response && typeof response === "object" ? response as Record<string, unknown> : {};
      if (!Array.isArray(checks.check_runs) || typeof checks.total_count !== "number") throw new ConnectorError("TEMPORARY", "GitHub returned invalid check runs", { retryable: true, operation: "read" });
      for (const entry of checks.check_runs) {
        const check = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
        states.push(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(String(check.conclusion)) ? "FAILED" : check.status === "completed" && ["success", "neutral", "skipped"].includes(String(check.conclusion)) ? "PASSED" : "PENDING");
        if (!checkUrl && typeof check.html_url === "string") checkUrl = check.html_url;
      }
      checked += checks.check_runs.length;
      if (checked >= checks.total_count) break;
      if (!checks.check_runs.length || page >= 100) throw new ConnectorError("TEMPORARY", "GitHub check runs are incomplete", { retryable: true, operation: "read" });
    }
    const state = states.includes("FAILED") ? "FAILED" : !states.length || states.includes("PENDING") ? "PENDING" : "PASSED";
    const url = checkUrl ?? (typeof value.url === "string" ? value.url : undefined);
    return { state, ...(url ? { url } : {}) };
  }

  private async request(path: string, init: RequestInit = {},authorize?:()=>void,beforeWrite?:()=>void): Promise<unknown> {
    const token = await this.options.resolveSecret(this.options.credentialRef);authorize?.();beforeWrite?.();
    let response: Response;
    try {
      response = await this.fetch(`${this.apiBase}${path}`, {
        ...init,
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
    } catch {
      throw new ConnectorError("TEMPORARY", "GitHub request failed", { retryable: true, operation: "delivery" });
    }
    authorize?.();
    if (response.status === 429 || response.status === 403 && response.headers.has("x-ratelimit-reset")) {
      throw new ConnectorError("RATE_LIMITED", "GitHub rate limit reached", { retryable: true, operation: "delivery" });
    }
    if (response.status === 401 || response.status === 403) throw new ConnectorError("AUTH", "GitHub authentication failed", { retryable: false, operation: "auth" });
    if (response.status >= 500) throw new ConnectorError("TEMPORARY", `GitHub returned ${response.status}`, { retryable: true, operation: "delivery" });
    if (!response.ok) throw new ConnectorError("PERMANENT", `GitHub returned ${response.status}`, { retryable: false, operation: "delivery" });
    const result=response.status===204?{}:await response.json();authorize?.();return result;
  }
}

function githubPullRequest(value: unknown): PullRequestStatus {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if ((typeof item.id !== "number" && typeof item.id !== "string") || typeof item.html_url !== "string") {
    throw new ConnectorError("PERMANENT", "GitHub returned an invalid pull request", { retryable: false, operation: "delivery" });
  }
  const state = item.merged_at ? "MERGED" : item.state === "closed" ? "CLOSED" : "OPEN";
  const head = item.head && typeof item.head === "object" ? item.head as Record<string, unknown> : {};
  return { id: String(item.id), url: item.html_url, state, ...(typeof item.number === "number" ? { number: item.number } : {}), ...(typeof head.sha === "string" ? { headCommit: head.sha } : {}) };
}
