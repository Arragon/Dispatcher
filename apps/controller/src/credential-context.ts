import { randomUUID } from "node:crypto";
import { ConfigPlanError } from "@dispatcher/config";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { contentHash } from "./task-publications.js";

/** Opaque epochs for changes observed through this Controller, never secret values. */
export class CredentialContext {
  private readonly pending = new Set<string>();
  private readonly epochs = new Map<string, string>();
  constructor(private readonly database: DispatcherDatabase) {}

  references(value: unknown): string[] {
    const found = new Set<string>();
    const visit = (entry: unknown): void => {
      if (typeof entry === "string" && entry.startsWith("secret://")) found.add(entry);
      else if (Array.isArray(entry)) entry.forEach(visit);
      else if (entry && typeof entry === "object") Object.values(entry).forEach(visit);
    };
    visit(value); return [...found].sort();
  }
  fingerprint(value: unknown): string {
    return contentHash(this.references(value).map(reference => {
      const key = contentHash(reference), stored = this.database.getEntity<JsonValue>("credential-context", key) as { epoch?: string } | undefined;
      return { key, epoch: this.epochs.get(reference) ?? stored?.epoch ?? "unobserved", pending: this.pending.has(reference) };
    }));
  }
  assertAvailable(value: unknown): void {
    if (this.references(value).some(reference => this.pending.has(reference))) throw new ConfigPlanError("CREDENTIAL_CHANGE_PENDING", "Wait for the credential change to finish before using this context");
  }
  async change<T>(reference: string, write: () => Promise<T>): Promise<T> {
    this.assertAvailable(reference);
    this.pending.add(reference);
    try {
      // Fence before touching the store, including a write whose outcome is uncertain.
      const epoch = randomUUID(); this.epochs.set(reference, epoch);
      this.database.saveEntity("credential-context", contentHash(reference), { epoch });
      return await write();
    } finally { this.pending.delete(reference); }
  }
}
