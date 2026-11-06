import { RhizaAdmissionStore, type DispatcherDatabase } from "@dispatcher/persistence";
import type { RhizaReceiptV1, RhizaSubmitRequestV1 } from "@dispatcher/protocol";
import type { ControlPrincipal } from "./control-auth.js";
import { RhizaIngressError, type RhizaServiceAuth } from "./rhiza-auth.js";
import { rhizaDigest } from "./rhiza-semantics.js";

// Preflight identity may change on an identical retry. The accepted semantic
// work order remains bound; requestId is part of the authenticated key domain.
export const rhizaSubmissionHash = (input: RhizaSubmitRequestV1): string => rhizaDigest({ schemaVersion: 1, targetHash: input.targetHash, workOrder: input.workOrder });

export class RhizaOperations {
  private readonly store: RhizaAdmissionStore;
  constructor(db: DispatcherDatabase, private readonly auth: RhizaServiceAuth) { this.store = new RhizaAdmissionStore(db); }

  lookup(principal: ControlPrincipal | undefined, requestId: string): RhizaReceiptV1 {
    const grant = this.auth.current(principal, ["jobs:read"], undefined, { allowDisabled: true });
    const record = this.store.get({ clientId: grant.id, commandScope: "jobs.submit", requestId });
    if (!record) throw new RhizaIngressError("NOT_FOUND", 404, "No acceptance receipt is available; this does not prove native work never started");
    this.auth.current(principal, ["jobs:read"], record, { allowDisabled: true });
    return record.receipt as unknown as RhizaReceiptV1;
  }

  /** An accepted retry is checked before refreshing an expired preflight. */
  replay(principal: ControlPrincipal | undefined, input: RhizaSubmitRequestV1): RhizaReceiptV1 | undefined {
    const order = input.workOrder, grant = this.auth.current(principal, ["jobs:submit"], { repositoryId: order.repositoryId, profileId: order.target.profileId, authorityId: order.origin.authorityId });
    const record = this.store.get({ clientId: grant.id, commandScope: "jobs.submit", requestId: input.requestId });
    if (!record) return undefined;
    this.auth.current(principal, ["jobs:submit"], record);
    if (record.requestHash !== rhizaSubmissionHash(input)) throw new RhizaIngressError("IDEMPOTENCY_CONFLICT", 409, "The request key binds a different semantic work order");
    return record.receipt as unknown as RhizaReceiptV1;
  }
}
