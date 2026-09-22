import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnvelope, type ProtocolEnvelope } from "@dispatcher/protocol";

export interface JournalEntry {
  sequence: number;
  messageId: string;
  envelope: ProtocolEnvelope;
  checksum: string;
  createdAt: string;
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class RunnerJournal {
  private readonly database: DatabaseSync;

  constructor(path: string, private readonly maxEntries = 10_000) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path, { timeout: 5_000 });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS journal_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version INTEGER NOT NULL,
        acknowledged_sequence INTEGER NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO journal_meta(singleton, schema_version, acknowledged_sequence) VALUES (1, 1, 0);
      CREATE TABLE IF NOT EXISTS runner_journal (
        sequence INTEGER PRIMARY KEY,
        message_id TEXT NOT NULL UNIQUE,
        envelope_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  append(envelope: ProtocolEnvelope): JournalEntry {
    const parsed = parseEnvelope(envelope);
    const envelopeJson = JSON.stringify(parsed);
    const digest = checksum(envelopeJson);
    const createdAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO runner_journal(sequence, message_id, envelope_json, checksum, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING
    `).run(parsed.sequence, parsed.messageId, envelopeJson, digest, createdAt);
    this.enforceCapacity();
    return { sequence: parsed.sequence, messageId: parsed.messageId, envelope: parsed, checksum: digest, createdAt };
  }

  replay(afterSequence = this.acknowledgedSequence()): JournalEntry[] {
    const rows = this.database.prepare(`
      SELECT sequence, message_id, envelope_json, checksum, created_at
      FROM runner_journal WHERE sequence > ? ORDER BY sequence ASC
    `).all(afterSequence) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const envelopeJson = String(row.envelope_json);
      if (checksum(envelopeJson) !== String(row.checksum)) throw new Error(`Runner journal checksum mismatch at sequence ${String(row.sequence)}`);
      return {
        sequence: Number(row.sequence),
        messageId: String(row.message_id),
        envelope: parseEnvelope(JSON.parse(envelopeJson)),
        checksum: String(row.checksum),
        createdAt: String(row.created_at),
      };
    });
  }

  acknowledge(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Acknowledged sequence must be a non-negative safe integer");
    this.database.prepare(`
      UPDATE journal_meta
      SET acknowledged_sequence = MAX(acknowledged_sequence, ?)
      WHERE singleton = 1
    `).run(sequence);
  }

  compact(retainAcknowledged = 32): number {
    const cutoff = Math.max(0, this.acknowledgedSequence() - retainAcknowledged);
    const result = this.database.prepare("DELETE FROM runner_journal WHERE sequence <= ?").run(cutoff);
    return Number(result.changes);
  }

  acknowledgedSequence(): number {
    const row = this.database.prepare("SELECT acknowledged_sequence FROM journal_meta WHERE singleton = 1").get() as Record<string, unknown>;
    return Number(row.acknowledged_sequence);
  }

  get schemaVersion(): number {
    const row = this.database.prepare("SELECT schema_version FROM journal_meta WHERE singleton = 1").get() as Record<string, unknown>;
    return Number(row.schema_version);
  }

  close(): void {
    this.database.close();
  }

  private enforceCapacity(): void {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM runner_journal").get() as Record<string, unknown>;
    const excess = Number(row.count) - this.maxEntries;
    if (excess <= 0) return;
    this.database.prepare(`
      DELETE FROM runner_journal WHERE sequence IN (
        SELECT sequence FROM runner_journal ORDER BY sequence ASC LIMIT ?
      )
    `).run(excess);
  }
}
