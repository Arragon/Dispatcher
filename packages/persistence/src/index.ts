import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "core_entities_and_events",
    sql: `
      CREATE TABLE entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      ) STRICT;
      CREATE INDEX entities_kind_updated_idx ON entities(kind, updated_at DESC);

      CREATE TABLE run_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        sequence INTEGER NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX run_events_run_sequence_idx ON run_events(run_id, sequence);
      CREATE INDEX run_events_time_idx ON run_events(occurred_at DESC);
    `,
  },
  {
    version: 2,
    name: "canonical_config",
    sql: `
      CREATE TABLE config_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE config_plans (
        id TEXT PRIMARY KEY,
        base_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        risk TEXT NOT NULL,
        confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
        plan_json TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX config_plans_state_updated_idx ON config_plans(state, updated_at DESC);

      CREATE TABLE config_audit (
        id TEXT PRIMARY KEY,
        plan_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        source TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX config_audit_created_idx ON config_audit(created_at DESC);

      CREATE TABLE wizard_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        step INTEGER NOT NULL,
        config_revision INTEGER NOT NULL,
        completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
] as const;

export class MigrationError extends Error {
  constructor(readonly migration: Migration, cause: unknown) {
    super(`Migration ${migration.version} (${migration.name}) failed`, { cause });
    this.name = "MigrationError";
  }
}

export class RevisionConflictError extends Error {
  readonly code = "CONFIG_REVISION_CONFLICT";

  constructor(readonly expected: number, readonly actual: number) {
    super(`Configuration revision conflict: expected ${expected}, found ${actual}`);
    this.name = "RevisionConflictError";
  }
}

export interface StoredConfigState {
  revision: number;
  schemaVersion: number;
  document: JsonValue;
  updatedAt: string;
}

export interface StoredConfigPlan {
  id: string;
  baseRevision: number;
  state: string;
  risk: string;
  confirmed: boolean;
  plan: JsonValue;
  before: JsonValue;
  after: JsonValue;
  result?: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigAuditRecord {
  id: string;
  planId?: string;
  action: string;
  actor: string;
  source: string;
  before: JsonValue;
  after: JsonValue;
  status: string;
  createdAt: string;
}

export interface WizardStateRecord {
  step: number;
  configRevision: number;
  completed: boolean;
  updatedAt: string;
}

function encode(value: JsonValue): string {
  return JSON.stringify(value);
}

function decode(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function rowObject(value: unknown): Record<string, unknown> | undefined {
  return value as Record<string, unknown> | undefined;
}

export class DispatcherDatabase {
  readonly handle: DatabaseSync;

  constructor(readonly path: string, appliedMigrations: readonly Migration[] = migrations) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.handle = new DatabaseSync(path, { timeout: 5_000, enableForeignKeyConstraints: true });
    this.handle.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate(appliedMigrations);
  }

  migrate(appliedMigrations: readonly Migration[] = migrations): void {
    this.handle.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const existing = new Set(
      (this.handle.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version),
    );
    for (const migration of [...appliedMigrations].sort((left, right) => left.version - right.version)) {
      if (existing.has(migration.version)) continue;
      try {
        this.transaction(() => {
          this.handle.exec(migration.sql);
          this.handle
            .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
            .run(migration.version, migration.name, new Date().toISOString());
        });
      } catch (error) {
        throw new MigrationError(migration, error);
      }
    }
  }

  transaction<T>(operation: () => T): T {
    if (this.handle.isTransaction) return operation();
    this.handle.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.handle.exec("COMMIT");
      return result;
    } catch (error) {
      this.handle.exec("ROLLBACK");
      throw error;
    }
  }

  schemaVersion(): number {
    const row = rowObject(this.handle.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get());
    return Number(row?.version ?? 0);
  }

  saveEntity(kind: string, id: string, document: JsonValue, updatedAt = new Date().toISOString()): void {
    this.handle
      .prepare(`
        INSERT INTO entities(kind, id, document_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at
      `)
      .run(kind, id, encode(document), updatedAt);
  }

  getEntity<T extends JsonValue>(kind: string, id: string): T | undefined {
    const row = rowObject(this.handle.prepare("SELECT document_json FROM entities WHERE kind = ? AND id = ?").get(kind, id));
    return row ? (decode(String(row.document_json)) as T) : undefined;
  }

  listEntities<T extends JsonValue>(kind: string): T[] {
    const rows = this.handle.prepare("SELECT document_json FROM entities WHERE kind = ? ORDER BY updated_at DESC").all(kind);
    return rows.map((value) => decode(String(rowObject(value)?.document_json)) as T);
  }

  appendRunEvent(event: {
    eventId: string;
    runId: string;
    type: string;
    payload: JsonValue;
    occurredAt: string;
    sequence: number;
  }): boolean {
    const result = this.handle
      .prepare(`
        INSERT OR IGNORE INTO run_events(event_id, run_id, event_type, payload_json, occurred_at, sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(event.eventId, event.runId, event.type, encode(event.payload), event.occurredAt, event.sequence);
    return result.changes === 1;
  }

  getConfigState(): StoredConfigState | undefined {
    const row = rowObject(this.handle.prepare("SELECT * FROM config_state WHERE singleton = 1").get());
    if (!row) return undefined;
    return {
      revision: Number(row.revision),
      schemaVersion: Number(row.schema_version),
      document: decode(String(row.document_json)),
      updatedAt: String(row.updated_at),
    };
  }

  writeConfigState(expectedRevision: number, next: Omit<StoredConfigState, "revision">): StoredConfigState {
    return this.transaction(() => {
      const current = this.getConfigState();
      const actual = current?.revision ?? 0;
      if (actual !== expectedRevision) throw new RevisionConflictError(expectedRevision, actual);
      const revision = actual + 1;
      this.handle
        .prepare(`
          INSERT INTO config_state(singleton, revision, schema_version, document_json, updated_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            revision = excluded.revision,
            schema_version = excluded.schema_version,
            document_json = excluded.document_json,
            updated_at = excluded.updated_at
        `)
        .run(revision, next.schemaVersion, encode(next.document), next.updatedAt);
      return { revision, ...next };
    });
  }

  restoreConfigState(state: StoredConfigState): void {
    this.handle
      .prepare(`
        INSERT INTO config_state(singleton, revision, schema_version, document_json, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          revision = excluded.revision,
          schema_version = excluded.schema_version,
          document_json = excluded.document_json,
          updated_at = excluded.updated_at
      `)
      .run(state.revision, state.schemaVersion, encode(state.document), state.updatedAt);
  }

  saveConfigPlan(plan: StoredConfigPlan): void {
    this.handle
      .prepare(`
        INSERT INTO config_plans(
          id, base_revision, state, risk, confirmed, plan_json, before_json, after_json, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state, confirmed = excluded.confirmed, result_json = excluded.result_json, updated_at = excluded.updated_at
      `)
      .run(
        plan.id,
        plan.baseRevision,
        plan.state,
        plan.risk,
        plan.confirmed ? 1 : 0,
        encode(plan.plan),
        encode(plan.before),
        encode(plan.after),
        plan.result ? encode(plan.result) : null,
        plan.createdAt,
        plan.updatedAt,
      );
  }

  getConfigPlan(id: string): StoredConfigPlan | undefined {
    const row = rowObject(this.handle.prepare("SELECT * FROM config_plans WHERE id = ?").get(id));
    if (!row) return undefined;
    const result = row.result_json ? { result: decode(String(row.result_json)) } : {};
    return {
      id: String(row.id),
      baseRevision: Number(row.base_revision),
      state: String(row.state),
      risk: String(row.risk),
      confirmed: Number(row.confirmed) === 1,
      plan: decode(String(row.plan_json)),
      before: decode(String(row.before_json)),
      after: decode(String(row.after_json)),
      ...result,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  appendAudit(record: ConfigAuditRecord): void {
    this.handle
      .prepare(`
        INSERT INTO config_audit(id, plan_id, action, actor, source, before_json, after_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.planId ?? null,
        record.action,
        record.actor,
        record.source,
        encode(record.before),
        encode(record.after),
        record.status,
        record.createdAt,
      );
  }

  listAudit(): ConfigAuditRecord[] {
    return this.handle.prepare("SELECT * FROM config_audit ORDER BY created_at DESC").all().map((value) => {
      const row = rowObject(value) ?? {};
      return {
        id: String(row.id),
        ...(row.plan_id ? { planId: String(row.plan_id) } : {}),
        action: String(row.action),
        actor: String(row.actor),
        source: String(row.source),
        before: decode(String(row.before_json)),
        after: decode(String(row.after_json)),
        status: String(row.status),
        createdAt: String(row.created_at),
      };
    });
  }

  getWizardState(): WizardStateRecord | undefined {
    const row = rowObject(this.handle.prepare("SELECT * FROM wizard_state WHERE singleton = 1").get());
    if (!row) return undefined;
    return {
      step: Number(row.step),
      configRevision: Number(row.config_revision),
      completed: Number(row.completed) === 1,
      updatedAt: String(row.updated_at),
    };
  }

  saveWizardState(state: WizardStateRecord): void {
    this.handle
      .prepare(`
        INSERT INTO wizard_state(singleton, step, config_revision, completed, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          step = excluded.step,
          config_revision = excluded.config_revision,
          completed = excluded.completed,
          updated_at = excluded.updated_at
      `)
      .run(state.step, state.configRevision, state.completed ? 1 : 0, state.updatedAt);
  }

  integrityCheck(): boolean {
    const row = rowObject(this.handle.prepare("PRAGMA integrity_check").get());
    return row?.integrity_check === "ok";
  }

  checkpoint(): void {
    this.handle.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.handle.close();
  }
}
