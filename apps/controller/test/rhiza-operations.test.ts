import { afterEach, describe, expect, it } from "vitest";
import Ajv from "ajv";
import { RhizaAdmissionStore } from "@dispatcher/persistence";
import { rhizaV1Schema, type RhizaReceiptV1, type RhizaSubmitRequestV1 } from "@dispatcher/protocol";
import { RhizaOperations, rhizaSubmissionHash } from "../src/rhiza-operations.js";
import { RhizaServiceAuth } from "../src/rhiza-auth.js";
import { CredentialContext } from "../src/credential-context.js";
import type { ControlPrincipal } from "../src/control-auth.js";
import { rhizaDigest } from "../src/rhiza-semantics.js";
import { clientHeaders, clientToken, rhizaServiceFixture } from "./fixtures/rhiza-service.js";
import { workOrder } from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
const prefix = "/api/integrations/rhiza/v1";
const ajv = new Ajv({ strict: true }); ajv.addSchema(rhizaV1Schema);
const validError = ajv.getSchema(`${rhizaV1Schema.$id}#/$defs/error`)!;
const fixtures: Awaited<ReturnType<typeof rhizaServiceFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function setup() {
  const f = await rhizaServiceFixture(); fixtures.push(f);
  const auth = new RhizaServiceAuth({ config: () => f.service.configuration.current().config, secrets: f.secrets, credentials: new CredentialContext(f.service.database), now: () => f.clock.now, authorizationRevision: () => f.service.configuration.current().revision, capabilities: () => [] });
  const decision = await auth.authenticate(clientToken, { method: "GET", url: `${prefix}/operations/by-key/request-a`, routePath: `${prefix}/operations/by-key/:requestId`, protocol: "http", ip: "127.0.0.1", headers: { host: "localhost" } });
  const principal = (decision as { principal: ControlPrincipal }).principal;
  const request: RhizaSubmitRequestV1 = { requestId: "request-a", preflightId: "preflight-a", targetHash: rhizaDigest(workOrder.target), workOrder: structuredClone(workOrder) };
  request.workOrder.origin.authorityId = "rhiza-a"; request.workOrder.repositoryId = "repo-a"; request.workOrder.target.profileId = "profile-a"; request.targetHash = rhizaDigest(request.workOrder.target);
  const receipt: RhizaReceiptV1 = { schemaVersion: 1, receiptId: "receipt-a", requestId: request.requestId, clientId: "client-a", requestHash: rhizaSubmissionHash(request), jobId: "job-a", taskId: "task-a", state: "accepted", acceptedAt: f.clock.now.toISOString(), origin: request.workOrder.origin, targetHash: request.targetHash, inputHash: request.workOrder.context.inputHash };
  new RhizaAdmissionStore(f.service.database).accept({ clientId: "client-a", commandScope: "jobs.submit", requestId: request.requestId }, receipt.requestHash, () => ({ repositoryId: "repo-a", profileId: "profile-a", authorityId: "rhiza-a", jobId: receipt.jobId, taskId: receipt.taskId, receipt: JSON.parse(JSON.stringify(receipt)) }));
  return { ...f, principal, request, receipt, operations: new RhizaOperations(f.service.database, auth) };
}
describe("original RHIZA operation lookup", () => {
  it("binds all semantic work-order fields but not replaceable preflight or transport metadata", async () => {
    const f = await setup(), hash = rhizaSubmissionHash(f.request);
    expect(rhizaSubmissionHash({ ...f.request, preflightId: "new-preflight" })).toBe(hash);
    expect(rhizaSubmissionHash({ ...f.request, requestId: "new-key", traceId: "transport-only", sentAt: "later" } as RhizaSubmitRequestV1)).toBe(hash);
    for (const mutate of [
      (r: RhizaSubmitRequestV1) => { r.workOrder.target.modelId = "different"; },
      (r: RhizaSubmitRequestV1) => { r.workOrder.context.content += "\n"; },
      (r: RhizaSubmitRequestV1) => { r.workOrder.approval.reference += "-new"; },
      (r: RhizaSubmitRequestV1) => { r.workOrder.origin.generation++; },
      (r: RhizaSubmitRequestV1) => { r.workOrder.constraints.push("extra"); },
    ]) { const changed = structuredClone(f.request); mutate(changed); expect(rhizaSubmissionHash(changed)).not.toBe(hash); }
  });
  it("returns the exact immutable receipt and rejects semantic key conflicts", async () => {
    const f = await setup(); expect(f.operations.replay(f.principal, f.request)).toEqual(f.receipt);
    const changed = structuredClone(f.request); changed.workOrder.approval.reference += "-new";
    expect(() => f.operations.replay(f.principal, changed)).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
    expect(f.operations.replay(f.principal, { ...f.request, requestId: "missing" })).toBeUndefined();
  });
  it("queries without launching and preserves authorized cleanup while globally disabled", async () => {
    const f = await setup(); await f.configure(config => { config.rhizaIngress!.enabled = false; });
    const response = await f.service.app.inject({ url: `${prefix}/operations/by-key/request-a`, headers: clientHeaders });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(f.receipt);
    expect((await f.service.app.inject({ url: `${prefix}/targets?repositoryId=repo-a`, headers: clientHeaders })).statusCode).toBe(503);
    const missing = await f.service.app.inject({ url: `${prefix}/operations/by-key/missing`, headers: clientHeaders });
    expect(missing.statusCode).toBe(404); expect(validError(missing.json())).toBe(true);
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.service.database.listEntities("run")).toEqual([]);
    await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; });
    expect((await f.service.app.inject({ url: `${prefix}/operations/by-key/request-a`, headers: clientHeaders })).statusCode).toBe(401);
  });
  it("authorizes stored resources and does not leak another client or a removed repository", async () => {
    const f = await setup();
    const otherToken = `rhiza.${Buffer.from("client-b").toString("base64url")}.${"b".repeat(43)}`;
    await f.secrets.put("secret://rhiza/client-b", otherToken);
    await f.configure(config => { config.rhizaIngress!.clients.push({ ...config.rhizaIngress!.clients[0]!, id: "client-b", credentialRef: "secret://rhiza/client-b" }); });
    expect((await f.service.app.inject({ url: `${prefix}/operations/by-key/request-a`, headers: { authorization: `Bearer ${otherToken}` } })).statusCode).toBe(404);
    await f.configure(config => { config.repositories.push({ ...config.repositories[0]!, id: "repo-b" }); config.rhizaIngress!.clients[0]!.repositoryIds = ["repo-b"]; });
    expect((await f.service.app.inject({ url: `${prefix}/operations/by-key/request-a`, headers: clientHeaders })).statusCode).toBe(403);
    expect((await f.service.app.inject({ url: `${prefix}/operations/by-key/request-a?clientId=client-b`, headers: clientHeaders })).statusCode).toBe(400);
  });
});
