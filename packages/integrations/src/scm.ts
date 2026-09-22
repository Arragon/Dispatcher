import type { ConnectorDefinition, ConnectorInstance, DeliveryEvidence, Run, VerificationEvidence } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorAdapter, type ConnectorProbeResult } from "./contracts.js";

export interface RepositoryRef {
  owner: string;
  name: string;
  cloneUrl?: string;
  localPath?: string;
}

export interface DeliveryRequest {
  idempotencyKey: string;
  taskId: string;
  run: Run;
  currentGeneration: number;
  currentLeaseId: string;
  repository: RepositoryRef;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  verification: VerificationEvidence;
  assertAuthority?: (operation: "branch" | "push" | "pull-request" | "complete") => void;
}

export interface ScmAdapter extends ConnectorAdapter {
  ensureBranch(repository: RepositoryRef, branch: string, baseBranch: string, idempotencyKey: string): Promise<void>;
  push(repository: RepositoryRef, branch: string, idempotencyKey: string): Promise<{ commit: string }>;
  createOrGetPullRequest(request: DeliveryRequest): Promise<{ id: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" }>;
  getCiStatus(repository: RepositoryRef, ref: string): Promise<{ state: "PENDING" | "PASSED" | "FAILED"; url?: string }>;
}

export const fakeScmDefinition = createConnectorDefinition({
  id: "scm.fake",
  kind: "scm",
  displayName: "Deterministic Fake SCM",
  capabilities: [
    { namespace: "scm.branch", version: 1, support: "supported" },
    { namespace: "scm.push", version: 1, support: "supported" },
    { namespace: "scm.pull-request", version: 1, support: "supported" },
    { namespace: "scm.ci", version: 1, support: "supported" },
  ],
});

export function assertDeliveryGate(request: DeliveryRequest): void {
  if (request.verification.state !== "PASSED") {
    throw new ConnectorError("PERMANENT", "Required verification has not passed", { retryable: false, operation: "delivery" });
  }
  if (request.run.generation !== request.currentGeneration || request.run.leaseId !== request.currentLeaseId) {
    throw new ConnectorError("CONFLICT", "Stale run generation or lease cannot deliver", { retryable: false, operation: "delivery" });
  }
  if (request.run.state !== "DELIVERING" && request.run.state !== "VERIFYING") {
    throw new ConnectorError("CONFLICT", `Run state ${request.run.state} is not deliverable`, { retryable: false, operation: "delivery" });
  }
}

export class FakeScmConnector implements ScmAdapter {
  readonly definition: ConnectorDefinition = fakeScmDefinition;
  readonly branches = new Set<string>();
  readonly pullRequests = new Map<string, { id: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" }>();
  failure?: ConnectorError;

  constructor(readonly instance: ConnectorInstance = {
    id: "fake-scm-main",
    definitionId: "scm.fake",
    kind: "scm",
    displayName: "Fake SCM",
    enabled: true,
    health: "HEALTHY",
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }) {}

  async probe(): Promise<ConnectorProbeResult> {
    if (this.failure) throw this.failure;
    return { health: "HEALTHY", checkedAt: new Date().toISOString() };
  }
  async ensureBranch(repository: RepositoryRef, branch: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.branches.add(`${repository.owner}/${repository.name}:${branch}`);
  }
  async push(repository: RepositoryRef, branch: string): Promise<{ commit: string }> {
    if (this.failure) throw this.failure;
    return { commit: `fake-${repository.owner}-${repository.name}-${branch}` };
  }
  async createOrGetPullRequest(request: DeliveryRequest): Promise<{ id: string; url: string; state: "OPEN" | "MERGED" | "CLOSED" }> {
    if (this.failure) throw this.failure;
    assertDeliveryGate(request);
    const existing = this.pullRequests.get(request.idempotencyKey);
    if (existing) return structuredClone(existing);
    const created = { id: `pr-${this.pullRequests.size + 1}`, url: `https://fake.invalid/${request.repository.owner}/${request.repository.name}/pull/${this.pullRequests.size + 1}`, state: "OPEN" as const };
    this.pullRequests.set(request.idempotencyKey, created);
    return structuredClone(created);
  }
  async getCiStatus(): Promise<{ state: "PASSED" }> { return { state: "PASSED" }; }
}

export function deliveryEvidence(input: {
  id: string;
  taskId: string;
  runId: string;
  connectorInstanceId: string;
  kind: DeliveryEvidence["kind"];
  externalId: string;
  url?: string;
  state: DeliveryEvidence["state"];
  metadata?: Record<string, unknown>;
  now?: string;
}): DeliveryEvidence {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    taskId: input.taskId,
    runId: input.runId,
    connectorInstanceId: input.connectorInstanceId,
    kind: input.kind,
    externalId: input.externalId,
    ...(input.url ? { url: input.url } : {}),
    state: input.state,
    revision: 1,
    metadata: structuredClone(input.metadata ?? {}),
    createdAt: now,
    updatedAt: now,
  };
}

export async function runScmContract(adapter: ScmAdapter, request: DeliveryRequest): Promise<string[]> {
  const failures: string[] = [];
  try {
    const probe = await adapter.probe();
    if (probe.health !== "HEALTHY") failures.push("probe must be healthy");
    await adapter.ensureBranch(request.repository, request.headBranch, request.baseBranch, request.idempotencyKey);
    await adapter.push(request.repository, request.headBranch, request.idempotencyKey);
    const first = await adapter.createOrGetPullRequest(request);
    const duplicate = await adapter.createOrGetPullRequest(request);
    if (first.id !== duplicate.id) failures.push("idempotent retry created a duplicate delivery");
    await adapter.getCiStatus(request.repository, request.headBranch);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "SCM contract failed");
  }
  return failures;
}
