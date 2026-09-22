import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface RunnerEnrollmentRecord {
  id: string;
  runnerId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class RunnerEnrollmentAuthority {
  private readonly records = new Map<string, RunnerEnrollmentRecord>();

  constructor(
    records: readonly RunnerEnrollmentRecord[] = [],
    private readonly onChange: (record: RunnerEnrollmentRecord) => void = () => undefined,
  ) {
    for (const record of records) this.records.set(record.id, structuredClone(record));
  }

  issue(runnerId: string, ttlMs = 10 * 60_000, now = new Date()): { token: string; record: RunnerEnrollmentRecord } {
    if (ttlMs < 1_000 || ttlMs > 60 * 60_000) throw new Error("Enrollment TTL must be between one second and one hour");
    const token = randomBytes(32).toString("base64url");
    const record: RunnerEnrollmentRecord = {
      id: randomUUID(),
      runnerId,
      tokenHash: digest(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.records.set(record.id, record);
    this.onChange(structuredClone(record));
    return { token, record: structuredClone(record) };
  }

  consume(runnerId: string, token: string, now = new Date()): RunnerEnrollmentRecord {
    const supplied = Buffer.from(digest(token));
    const record = [...this.records.values()].find((candidate) => {
      const expected = Buffer.from(candidate.tokenHash);
      return candidate.runnerId === runnerId && !candidate.consumedAt && supplied.length === expected.length && timingSafeEqual(supplied, expected);
    });
    if (!record) throw new Error("Enrollment token is invalid or already consumed");
    if (Date.parse(record.expiresAt) <= now.getTime()) throw new Error("Enrollment token has expired");
    const consumed = { ...record, consumedAt: now.toISOString() };
    this.records.set(record.id, consumed);
    this.onChange(structuredClone(consumed));
    return structuredClone(consumed);
  }
}

export function isRunnerVersionCompatible(controllerVersion: string, runnerVersion: string): boolean {
  const controller = /^(\d+)\.(\d+)\.(\d+)$/.exec(controllerVersion);
  const runner = /^(\d+)\.(\d+)\.(\d+)$/.exec(runnerVersion);
  return Boolean(controller && runner && controller[1] === runner[1] && controller[2] === runner[2]);
}
