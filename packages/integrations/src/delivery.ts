import { randomUUID } from "node:crypto";
import type { DeliveryEvidence } from "@dispatcher/domain";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { ConnectorError } from "./contracts.js";
import { assertDeliveryGate, deliveryEvidence, type DeliveryRequest, type RepositoryRef, type ScmAdapter } from "./scm.js";

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class DeliveryService {
  constructor(private readonly database: DispatcherDatabase) {}

  async deliver(adapter: ScmAdapter, request: DeliveryRequest): Promise<{ evidence: DeliveryEvidence[]; duplicate: boolean }> {
    assertDeliveryGate(request);
    const existing = (this.database.listDeliveryEvidence<JsonValue>(request.taskId) as unknown as DeliveryEvidence[])
      .filter((item) => item.runId === request.run.id && item.connectorInstanceId === adapter.instance.id && item.metadata.idempotencyKey === request.idempotencyKey);
    const existingPullRequest = existing.find((item) => item.connectorInstanceId === adapter.instance.id && item.metadata.idempotencyKey === request.idempotencyKey && item.kind === "pull-request");
    if (existingPullRequest) {
      request.assertAuthority?.("complete");
      return { evidence: existing, duplicate: true };
    }
    request.assertAuthority?.("branch");
    await adapter.ensureBranch(request.repository, request.headBranch, request.baseBranch, request.idempotencyKey);
    request.assertAuthority?.("push");
    const pushed = await adapter.push(request.repository, request.headBranch, `${request.idempotencyKey}:push`);
    request.assertAuthority?.("pull-request");
    const pullRequest = await adapter.createOrGetPullRequest(request);
    const now = new Date().toISOString();
    const metadata = { idempotencyKey: request.idempotencyKey, generation: request.run.generation };
    const values = [
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "commit", externalId: pushed.commit, state: "READY", metadata, now }),
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "pull-request", externalId: pullRequest.id, url: pullRequest.url, state: pullRequest.state === "MERGED" ? "MERGED" : pullRequest.state === "CLOSED" ? "FAILED" : "READY", metadata: { ...metadata, pullRequestNumber: pullRequest.number, headCommit: pullRequest.headCommit ?? pushed.commit, pullRequestState: pullRequest.state }, now }),
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "ci", externalId: pushed.commit, state: "PENDING", metadata, now }),
    ];
    // Persist delivery before reading CI: an unavailable read must not repeat push/PR.
    this.database.transaction(() => { for (const evidence of values) this.save(evidence); });
    let ci: Awaited<ReturnType<ScmAdapter["getCiStatus"]>> | undefined;
    try { ci = await adapter.getCiStatus(request.repository, pushed.commit); }
    catch { /* Read failures remain pending; durable reconcile retries separately. */ }
    if (ci) {
      const evidence = values[2]!;
      const state = ci.state === "FAILED" ? "FAILED" : ci.state === "PASSED" ? "READY" : "PENDING";
      if (evidence.state !== state || evidence.url !== ci.url) {
        const baseRevision = evidence.revision;
        evidence.state = state;
        if (ci.url) evidence.url = ci.url;
        evidence.revision += 1;
        this.update(evidence, baseRevision);
      }
    }
    request.assertAuthority?.("complete");
    return { evidence: values, duplicate: false };
  }

  async reconcile(adapter: ScmAdapter, input: { taskId: string; runId: string; generation: number; repository: RepositoryRef; assertCurrent: () => void }): Promise<{ pullRequest: DeliveryEvidence; ci: DeliveryEvidence } | undefined> {
    const evidence = (this.database.listDeliveryEvidence<JsonValue>(input.taskId) as unknown as DeliveryEvidence[])
      .filter((item) => item.runId === input.runId && item.connectorInstanceId === adapter.instance.id && item.metadata.idempotencyKey === `delivery:${input.runId}:${input.generation}`);
    const pullRequest = evidence.find((item) => item.kind === "pull-request");
    const ci = evidence.find((item) => item.kind === "ci");
    if (!pullRequest || !ci) return undefined;
    const number = typeof pullRequest.metadata.pullRequestNumber === "number" ? pullRequest.metadata.pullRequestNumber : Number(/\/pull\/(\d+)(?:$|[/?#])/.exec(pullRequest.url ?? "")?.[1]);
    const status = adapter.getPullRequest && number > 0 ? await adapter.getPullRequest(input.repository, number) : undefined;
    const ref = status?.headCommit ?? ci.externalId;
    const checked = await adapter.getCiStatus(input.repository, ref);
    input.assertCurrent();
    const now = new Date().toISOString();
    const prRevision = pullRequest.revision;
    const ciRevision = ci.revision;
    if (status) {
      const state = status.state === "MERGED" ? "MERGED" : status.state === "CLOSED" ? "FAILED" : "READY";
      if (pullRequest.state !== state || pullRequest.metadata.headCommit !== ref) {
        pullRequest.state = state;
        pullRequest.metadata = { ...pullRequest.metadata, headCommit: ref, pullRequestState: status.state, pullRequestNumber: number };
        pullRequest.revision += 1;
        pullRequest.updatedAt = now;
      }
    }
    const state = checked.state === "FAILED" ? "FAILED" : checked.state === "PASSED" ? "READY" : "PENDING";
    if (ci.state !== state || ci.externalId !== ref || checked.url && ci.url !== checked.url) {
      ci.state = state;
      ci.externalId = ref;
      ci.revision += 1;
      ci.updatedAt = now;
    }
    if (checked.url) ci.url = checked.url;
    this.database.transaction(() => {
      if (pullRequest.revision !== prRevision) this.update(pullRequest, prRevision);
      if (ci.revision !== ciRevision) this.update(ci, ciRevision);
    });
    return { pullRequest, ci };
  }

  private save(evidence: DeliveryEvidence): void {
    this.database.saveDeliveryEvidence({ id: evidence.id, taskId: evidence.taskId, runId: evidence.runId, connectorInstanceId: evidence.connectorInstanceId, kind: evidence.kind, externalId: evidence.externalId, document: json(evidence), updatedAt: evidence.updatedAt });
  }

  private update(evidence: DeliveryEvidence, baseRevision: number): void {
    if (!this.database.updateDeliveryEvidence({ id: evidence.id, externalId: evidence.externalId, document: json(evidence), updatedAt: evidence.updatedAt }, baseRevision)) throw new ConnectorError("CONFLICT", "Delivery evidence revision changed during reconciliation", { retryable: true, operation: "read" });
  }
}
