export interface RunnerLease {
  runId: string;
  runnerId: string;
  leaseId: string;
  generation: number;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface LeaseAuditRecord {
  runId: string;
  leaseId: string;
  generation: number;
  action: "ISSUE" | "RENEW" | "REVOKE" | "FENCE_ALLOW" | "FENCE_DENY";
  reason: string;
  occurredAt: string;
}

export class LeaseFenceError extends Error {
  constructor(readonly code: "LEASE_MISSING" | "LEASE_REVOKED" | "LEASE_EXPIRED" | "STALE_GENERATION" | "LEASE_MISMATCH", message: string) {
    super(message);
    this.name = "LeaseFenceError";
  }
}

export class RunnerLeaseAuthority {
  private readonly leases = new Map<string, RunnerLease>();
  private readonly auditRecords: LeaseAuditRecord[] = [];

  issue(lease: RunnerLease, now = new Date().toISOString()): RunnerLease {
    const current = this.leases.get(lease.runId);
    if (current && lease.generation <= current.generation) {
      throw new LeaseFenceError("STALE_GENERATION", `Generation ${lease.generation} does not supersede ${current.generation}`);
    }
    const stored = structuredClone(lease);
    this.leases.set(lease.runId, stored);
    this.record(stored, "ISSUE", "authority granted", now);
    return structuredClone(stored);
  }

  renew(runId: string, leaseId: string, generation: number, expiresAt: string, now = new Date().toISOString()): RunnerLease {
    const lease = this.assertIdentity(runId, leaseId, generation, now);
    if (lease.revokedAt) throw this.denied(lease, "LEASE_REVOKED", "lease is revoked", now);
    const renewed = { ...lease, expiresAt };
    this.leases.set(runId, renewed);
    this.record(renewed, "RENEW", "lease renewed", now);
    return structuredClone(renewed);
  }

  revoke(runId: string, leaseId: string, generation: number, reason: string, now = new Date().toISOString()): RunnerLease {
    const lease = this.assertIdentity(runId, leaseId, generation, now);
    const revoked = { ...lease, revokedAt: now, revokeReason: reason };
    this.leases.set(runId, revoked);
    this.record(revoked, "REVOKE", reason, now);
    return structuredClone(revoked);
  }

  fence(runId: string, leaseId: string, generation: number, operation: string, now = new Date().toISOString()): RunnerLease {
    const lease = this.assertIdentity(runId, leaseId, generation, now);
    if (lease.revokedAt) throw this.denied(lease, "LEASE_REVOKED", `${operation}: lease is revoked`, now);
    if (Date.parse(lease.expiresAt) <= Date.parse(now)) throw this.denied(lease, "LEASE_EXPIRED", `${operation}: lease expired`, now);
    this.record(lease, "FENCE_ALLOW", operation, now);
    return structuredClone(lease);
  }

  current(runId: string): RunnerLease | undefined {
    const lease = this.leases.get(runId);
    return lease ? structuredClone(lease) : undefined;
  }

  audit(runId?: string): LeaseAuditRecord[] {
    return this.auditRecords.filter((record) => !runId || record.runId === runId).map((record) => ({ ...record }));
  }

  private assertIdentity(runId: string, leaseId: string, generation: number, now: string): RunnerLease {
    const lease = this.leases.get(runId);
    if (!lease) throw new LeaseFenceError("LEASE_MISSING", `No lease authority for run ${runId}`);
    if (generation !== lease.generation) throw this.denied(lease, "STALE_GENERATION", `Generation ${generation} is not current`, now);
    if (leaseId !== lease.leaseId) throw this.denied(lease, "LEASE_MISMATCH", `Lease ${leaseId} is not current`, now);
    return lease;
  }

  private denied(lease: RunnerLease, code: LeaseFenceError["code"], reason: string, now: string): LeaseFenceError {
    this.record(lease, "FENCE_DENY", reason, now);
    return new LeaseFenceError(code, reason);
  }

  private record(lease: RunnerLease, action: LeaseAuditRecord["action"], reason: string, occurredAt: string): void {
    this.auditRecords.push({ runId: lease.runId, leaseId: lease.leaseId, generation: lease.generation, action, reason, occurredAt });
  }
}
