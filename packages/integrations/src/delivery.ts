import { randomUUID } from "node:crypto";
import type { DeliveryEvidence } from "@dispatcher/domain";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { assertDeliveryGate, deliveryEvidence, type DeliveryRequest, type ScmAdapter } from "./scm.js";

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class DeliveryService {
  constructor(private readonly database: DispatcherDatabase) {}

  async deliver(adapter: ScmAdapter, request: DeliveryRequest): Promise<{ evidence: DeliveryEvidence[]; duplicate: boolean }> {
    assertDeliveryGate(request);
    const existing = this.database.listDeliveryEvidence<JsonValue>(request.taskId) as unknown as DeliveryEvidence[];
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
    const ci = await adapter.getCiStatus(request.repository, pushed.commit);
    const now = new Date().toISOString();
    const values = [
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "commit", externalId: pushed.commit, state: "READY", metadata: { idempotencyKey: request.idempotencyKey }, now }),
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "pull-request", externalId: pullRequest.id, url: pullRequest.url, state: pullRequest.state === "MERGED" ? "MERGED" : "READY", metadata: { idempotencyKey: request.idempotencyKey }, now }),
      deliveryEvidence({ id: randomUUID(), taskId: request.taskId, runId: request.run.id, connectorInstanceId: adapter.instance.id, kind: "ci", externalId: pushed.commit, ...(ci.url ? { url: ci.url } : {}), state: ci.state === "FAILED" ? "FAILED" : ci.state === "PASSED" ? "READY" : "PENDING", metadata: { idempotencyKey: request.idempotencyKey }, now }),
    ];
    for (const evidence of values) {
      this.database.saveDeliveryEvidence({
        id: evidence.id,
        taskId: evidence.taskId,
        runId: evidence.runId,
        connectorInstanceId: evidence.connectorInstanceId,
        kind: evidence.kind,
        externalId: evidence.externalId,
        document: json(evidence),
        updatedAt: evidence.updatedAt,
      });
    }
    request.assertAuthority?.("complete");
    return { evidence: values, duplicate: false };
  }
}
