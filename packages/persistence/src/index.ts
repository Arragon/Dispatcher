import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { InteractionStoreError, migrateNativeInteractions } from "./interaction-store.js";
import { assertDatabaseLocationOperational, assertDatabaseOperational, assertDatabaseSchema, CONVERGENCE_SCHEMA_NAME, CONTROL_RUNTIME_SCHEMA_NAME, databaseWriterProtocol, installWriterGate, upgradeConvergenceWriterGate, upgradeControlRuntimeWriterGate } from "./database-compatibility.js";

export * from "./interaction-store.js";
export * from "./database-compatibility.js";
export * from "./backup.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Migration {
  version: number;
  name: string;
  sql: string;
  afterApply?: (database: DispatcherDatabase) => void;
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
  {
    version: 3,
    name: "connector_canonical_store",
    sql: `
      CREATE TABLE connector_instances (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        document_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE external_bindings (
        id TEXT PRIMARY KEY,
        canonical_entity_id TEXT NOT NULL,
        connector_instance_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_revision TEXT,
        projection_state TEXT NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connector_instance_id, entity_type, external_id)
      ) STRICT;
      CREATE INDEX external_bindings_canonical_idx ON external_bindings(canonical_entity_id, entity_type);

      CREATE TABLE inbox_events (
        id TEXT PRIMARY KEY,
        connector_instance_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        normalized_json TEXT NOT NULL,
        status TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        error TEXT,
        UNIQUE(connector_instance_id, external_event_id)
      ) STRICT;

      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        connector_instance_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        error TEXT
      ) STRICT;
      CREATE INDEX outbox_ready_idx ON outbox_events(status, available_at);

      CREATE TABLE sync_cursors (
        connector_instance_id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE dead_letters (
        id TEXT PRIMARY KEY,
        connector_instance_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE canonical_tasks (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE task_contracts (
        task_id TEXT PRIMARY KEY,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES canonical_tasks(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE delivery_evidence (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        connector_instance_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connector_instance_id, kind, external_id)
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "native_session_interaction",
    sql: `
      CREATE TABLE native_bindings (
        session_kind TEXT NOT NULL DEFAULT 'session' CHECK (session_kind = 'session'),
        session_id TEXT PRIMARY KEY,
        binding_key TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        execution_ref_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        FOREIGN KEY(session_kind, session_id) REFERENCES entities(kind, id)
      ) STRICT;
      CREATE TABLE session_controls (
        session_kind TEXT NOT NULL DEFAULT 'session' CHECK (session_kind = 'session'),
        session_id TEXT PRIMARY KEY,
        active_run_id TEXT NOT NULL,
        epoch INTEGER NOT NULL CHECK (epoch >= 1),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        state TEXT NOT NULL CHECK (state IN ('AUTOMATED','HANDOFF_REQUESTED','HUMAN','RECONCILING','CONFLICT')),
        document_json TEXT NOT NULL,
        FOREIGN KEY(session_kind, session_id) REFERENCES entities(kind, id)
      ) STRICT;
      CREATE TABLE interaction_commands (
        session_kind TEXT NOT NULL DEFAULT 'session' CHECK (session_kind = 'session'),
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        semantic_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('RESERVED','SENDING','ACKNOWLEDGED','UNKNOWN','FAILED','CANCELLED')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        document_json TEXT NOT NULL,
        FOREIGN KEY(session_kind, session_id) REFERENCES entities(kind, id)
      ) STRICT;
      CREATE INDEX interaction_commands_pending_idx ON interaction_commands(session_id, state);
      CREATE TABLE native_observations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES native_bindings(session_id),
        observer_generation INTEGER NOT NULL CHECK (observer_generation >= 1),
        observer_sequence INTEGER NOT NULL CHECK (observer_sequence >= 1),
        control_epoch INTEGER NOT NULL CHECK (control_epoch >= 1),
        document_json TEXT NOT NULL,
        UNIQUE(id, session_id)
      ) STRICT;
      CREATE TABLE native_observation_checkpoints (
        session_id TEXT PRIMARY KEY REFERENCES native_bindings(session_id),
        observation_id TEXT NOT NULL REFERENCES native_observations(id),
        observer_generation INTEGER NOT NULL CHECK (observer_generation >= 1),
        observer_sequence INTEGER NOT NULL CHECK (observer_sequence >= 1),
        control_epoch INTEGER NOT NULL CHECK (control_epoch >= 1),
        FOREIGN KEY(observation_id, session_id) REFERENCES native_observations(id, session_id)
      ) STRICT;
      CREATE TABLE control_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL REFERENCES session_controls(session_id),
        document_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE native_identity_diagnostics (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        code TEXT NOT NULL,
        binding_key TEXT
      ) STRICT;
      CREATE INDEX native_identity_diagnostics_key_idx ON native_identity_diagnostics(binding_key);
    `,
    afterApply: migrateNativeInteractions,
  },
  {
    version: 5,
    name: "minimum_writer_protocol",
    sql: "",
    afterApply: database => installWriterGate(database.handle),
  },
  {
    version: 6,
    name: CONVERGENCE_SCHEMA_NAME,
    sql: "",
    afterApply: database => upgradeConvergenceWriterGate(database.handle),
  },
  {
    version: 7,
    name: CONTROL_RUNTIME_SCHEMA_NAME,
    sql: "",
    afterApply: database => upgradeControlRuntimeWriterGate(database.handle),
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

export class CanonicalRevisionConflictError extends Error {
  readonly code = "CANONICAL_REVISION_CONFLICT";

  constructor(readonly entityId: string, readonly expected: number, readonly actual: number) {
    super(`Canonical revision conflict for ${entityId}: expected ${expected}, found ${actual}`);
    this.name = "CanonicalRevisionConflictError";
  }
}

export interface InboxEventRecord {
  id: string;
  connectorInstanceId: string;
  externalEventId: string;
  idempotencyKey: string;
  eventType: string;
  normalized: JsonValue;
  status: "PENDING" | "PROCESSED" | "FAILED";
  receivedAt: string;
  processedAt?: string;
  error?: string;
}

export interface OutboxEventRecord {
  id: string;
  connectorInstanceId: string;
  idempotencyKey: string;
  eventType: string;
  payload: JsonValue;
  status: "PENDING" | "DELIVERED" | "DEAD";
  attempt: number;
  availableAt: string;
  createdAt: string;
  deliveredAt?: string;
  error?: string;
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
  private savepointSequence = 0;
  private writerProtocol = 0;

  constructor(readonly path: string, appliedMigrations: readonly Migration[] = migrations) {
    assertDatabaseLocationOperational(path);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.handle = new DatabaseSync(path, { timeout: 5_000, enableForeignKeyConstraints: true });
    try {
      assertDatabaseSchema(this.handle,appliedMigrations);
      assertDatabaseOperational(this.handle);
      this.handle.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.migrate(appliedMigrations);
    } catch (error) {
      this.handle.close();
      throw error;
    }
  }

  migrate(appliedMigrations: readonly Migration[] = migrations): void {
    assertDatabaseSchema(this.handle,appliedMigrations);
    assertDatabaseOperational(this.handle);
    this.writerProtocol=appliedMigrations.some(m=>m.version===5&&m.name==="minimum_writer_protocol")?databaseWriterProtocol(this.handle):0;
    this.handle.function("dispatcher_writer_protocol",{deterministic:true},()=>this.writerProtocol);
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
      const previousWriterProtocol=this.writerProtocol;
      try {
        this.transaction(() => {
          if(migration.version===6&&migration.name===CONVERGENCE_SCHEMA_NAME)this.writerProtocol=2;
          if(migration.version===7&&migration.name===CONTROL_RUNTIME_SCHEMA_NAME)this.writerProtocol=3;
          this.handle.exec(migration.sql);
          migration.afterApply?.(this);
          this.handle
            .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
            .run(migration.version, migration.name, new Date().toISOString());
        });
      } catch (error) {
        this.writerProtocol=previousWriterProtocol;
        throw new MigrationError(migration, error);
      }
    }
  }

  transaction<T>(operation: () => T): T {
    // A caller may catch an inner operation's error and still commit its work.
    // Savepoints keep that failed operation atomic without aborting the caller.
    const savepoint = this.handle.isTransaction ? `dispatcher_${++this.savepointSequence}` : undefined;
    const previousWriterProtocol=this.writerProtocol;
    this.handle.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.handle.exec(savepoint ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.handle.exec(savepoint ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : "ROLLBACK");
      this.writerProtocol=previousWriterProtocol;
      throw error;
    }
  }

  schemaVersion(): number {
    const row = rowObject(this.handle.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get());
    return Number(row?.version ?? 0);
  }

  createEntityIfAbsent(kind: string, id: string, document: JsonValue, updatedAt = new Date().toISOString()): boolean {
    return this.handle.prepare("INSERT INTO entities(kind, id, document_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO NOTHING").run(kind, id, encode(document), updatedAt).changes === 1;
  }

  saveEntity(kind: string, id: string, document: JsonValue, updatedAt = new Date().toISOString()): void {
    const previous=["run","session","adapter-session","model-routing-decision"].includes(kind)?this.getEntity<JsonValue>(kind,id):undefined;
    const before=previous&&typeof previous==="object"&&!Array.isArray(previous)?previous:undefined;
    const after=document&&typeof document==="object"&&!Array.isArray(document)?document:undefined;
    if((kind==="session"||kind==="adapter-session")&&before?.nativeBinding){
      const binding=before.nativeBinding as Record<string,JsonValue>;
      const projection=kind==="session"?"nativeSessionId":"providerSessionId";
      if(!after||!isDeepStrictEqual(before.nativeBinding,after.nativeBinding)||after[projection]!==binding.nativeSessionId||before.profileId!==after.profileId||before.id!==after.id)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      const frozenFields=kind==="session"?["providerId",...(before.executionRef!==undefined?["executionRef"]:[])]:["runId","backendId"];
      if(frozenFields.some(field=>!isDeepStrictEqual(before[field],after[field])))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      if(kind==="session"&&after.executionRef&&typeof after.executionRef==="object"&&!Array.isArray(after.executionRef)&&after.executionRef.id!==binding.executionRefId)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
    }
    if(kind==="adapter-session"){
      if(["execution","executionRef"].some(field=>before?.[field]!==undefined&&!isDeepStrictEqual(before[field],after?.[field])))throw new ImmutableExecutionContextError();
      const fields=["executionSelection","modelSelection","legacyModel"];
      const bound=fields.some(field=>before?.[field]!==undefined);
      if(fields.filter(field=>after?.[field]!==undefined).length>1||fields.some(field=>before?.[field]!==undefined&&!isDeepStrictEqual(before[field],after?.[field]))||bound&&["id","profileId","backendId","runId","workspacePath"].some(field=>!isDeepStrictEqual(before?.[field],after?.[field])))throw new ImmutableSessionSelectionError();
    }
    if(kind==="model-routing-decision"&&before){
      const frozen=(value:Record<string,JsonValue>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!["status","confirmation","runId","consumedAt"].includes(key)));
      const same=isDeepStrictEqual(before,after);
      if(!same&&(!after||before.status!=="ready"||after.status!=="consumed"||typeof after.runId!=="string"||typeof after.consumedAt!=="string"||!after.confirmation||!isDeepStrictEqual(frozen(before),frozen(after))))throw new ImmutableRoutingDecisionError();
    }
    if(kind === "run") {
      if(after?.executionSelection!==undefined&&after.modelSelection!==undefined)throw new ImmutableRunSelectionError();
      const sessionId=before?.sessionId??after?.sessionId;
      const session=typeof sessionId==="string"?this.getEntity<JsonValue>("session",sessionId):undefined;
      const binding=session&&typeof session==="object"&&!Array.isArray(session)?session.nativeBinding:undefined;
      if(binding&&typeof binding==="object"&&!Array.isArray(binding)&&(!after||after.providerSessionId!==binding.nativeSessionId||after.profileId!==binding.profileId||after.runnerId!==binding.runnerId||after.sessionId!==sessionId||before?.providerId!==undefined&&before.providerId!==after.providerId))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      const selection=previous && typeof previous === "object" && !Array.isArray(previous) ? previous.modelSelection : undefined;
      const next=document && typeof document === "object" && !Array.isArray(document) ? document.modelSelection : undefined;
      if(selection!==undefined && JSON.stringify(selection)!==JSON.stringify(next)) {
        throw new ImmutableRunSelectionError();
      }
      if(before?.executionSelection!==undefined&&!isDeepStrictEqual(before.executionSelection,after?.executionSelection))throw new ImmutableRunSelectionError();
      if(before?.modelRoutingDecision!==undefined&&!isDeepStrictEqual(before.modelRoutingDecision,after?.modelRoutingDecision))throw new ImmutableRoutingDecisionError();
      if(before?.executionRef!==undefined&&!isDeepStrictEqual(before.executionRef,after?.executionRef))throw new ImmutableExecutionContextError();
    }
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

  saveConnectorInstance(input: {
    id: string;
    definitionId: string;
    kind: string;
    revision: number;
    document: JsonValue;
    updatedAt: string;
  }): void {
    this.handle.prepare(`
      INSERT INTO connector_instances(id, definition_id, kind, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        definition_id = excluded.definition_id,
        kind = excluded.kind,
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(input.id, input.definitionId, input.kind, encode(input.document), input.revision, input.updatedAt);
  }

  saveExternalBinding(input: {
    id: string;
    canonicalEntityId: string;
    connectorInstanceId: string;
    entityType: string;
    externalId: string;
    externalRevision?: string;
    projectionState: string;
    document: JsonValue;
    updatedAt: string;
  }): void {
    this.handle.prepare(`
      INSERT INTO external_bindings(
        id, canonical_entity_id, connector_instance_id, entity_type, external_id,
        external_revision, projection_state, document_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_entity_id = excluded.canonical_entity_id,
        external_revision = excluded.external_revision,
        projection_state = excluded.projection_state,
        document_json = excluded.document_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.canonicalEntityId,
      input.connectorInstanceId,
      input.entityType,
      input.externalId,
      input.externalRevision ?? null,
      input.projectionState,
      encode(input.document),
      input.updatedAt,
    );
  }

  listExternalBindings<T extends JsonValue>(canonicalEntityId: string, entityType?: string): T[] {
    const rows = entityType
      ? this.handle.prepare("SELECT document_json FROM external_bindings WHERE canonical_entity_id = ? AND entity_type = ? ORDER BY id").all(canonicalEntityId, entityType)
      : this.handle.prepare("SELECT document_json FROM external_bindings WHERE canonical_entity_id = ? ORDER BY id").all(canonicalEntityId);
    return rows.map((value) => decode(String(rowObject(value)?.document_json)) as T);
  }

  findExternalBinding<T extends JsonValue>(connectorInstanceId: string, entityType: string, externalId: string): T | undefined {
    const row = rowObject(this.handle.prepare(`
      SELECT document_json FROM external_bindings
      WHERE connector_instance_id = ? AND entity_type = ? AND external_id = ?
    `).get(connectorInstanceId, entityType, externalId));
    return row ? decode(String(row.document_json)) as T : undefined;
  }

  appendInboxEvent(event: InboxEventRecord): boolean {
    const result = this.handle.prepare(`
      INSERT OR IGNORE INTO inbox_events(
        id, connector_instance_id, external_event_id, idempotency_key, event_type,
        normalized_json, status, received_at, processed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.connectorInstanceId,
      event.externalEventId,
      event.idempotencyKey,
      event.eventType,
      encode(event.normalized),
      event.status,
      event.receivedAt,
      event.processedAt ?? null,
      event.error ?? null,
    );
    return result.changes === 1;
  }

  markInboxEvent(id: string, status: InboxEventRecord["status"], error?: string, processedAt = new Date().toISOString()): void {
    this.handle.prepare("UPDATE inbox_events SET status = ?, processed_at = ?, error = ? WHERE id = ?")
      .run(status, processedAt, error ?? null, id);
  }

  getInboxEvent(id: string): InboxEventRecord | undefined {
    const row = rowObject(this.handle.prepare("SELECT * FROM inbox_events WHERE id = ?").get(id));
    if (!row) return undefined;
    return {
      id: String(row.id),
      connectorInstanceId: String(row.connector_instance_id),
      externalEventId: String(row.external_event_id),
      idempotencyKey: String(row.idempotency_key),
      eventType: String(row.event_type),
      normalized: decode(String(row.normalized_json)),
      status: String(row.status) as InboxEventRecord["status"],
      receivedAt: String(row.received_at),
      ...(row.processed_at ? { processedAt: String(row.processed_at) } : {}),
      ...(row.error ? { error: String(row.error) } : {}),
    };
  }

  enqueueOutboxEvent(event: OutboxEventRecord): boolean {
    const result = this.handle.prepare(`
      INSERT OR IGNORE INTO outbox_events(
        id, connector_instance_id, idempotency_key, event_type, payload_json,
        status, attempt, available_at, created_at, delivered_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.connectorInstanceId,
      event.idempotencyKey,
      event.eventType,
      encode(event.payload),
      event.status,
      event.attempt,
      event.availableAt,
      event.createdAt,
      event.deliveredAt ?? null,
      event.error ?? null,
    );
    return result.changes === 1;
  }

  listReadyOutbox(now = new Date().toISOString(), limit = 100): OutboxEventRecord[] {
    const rows = this.handle.prepare(`
      SELECT * FROM outbox_events
      WHERE status = 'PENDING' AND available_at <= ?
      ORDER BY created_at, id LIMIT ?
    `).all(now, limit);
    return rows.map((value) => {
      const row = rowObject(value) ?? {};
      return {
        id: String(row.id),
        connectorInstanceId: String(row.connector_instance_id),
        idempotencyKey: String(row.idempotency_key),
        eventType: String(row.event_type),
        payload: decode(String(row.payload_json)),
        status: String(row.status) as OutboxEventRecord["status"],
        attempt: Number(row.attempt),
        availableAt: String(row.available_at),
        createdAt: String(row.created_at),
        ...(row.delivered_at ? { deliveredAt: String(row.delivered_at) } : {}),
        ...(row.error ? { error: String(row.error) } : {}),
      };
    });
  }

  markOutboxDelivered(id: string, deliveredAt = new Date().toISOString()): void {
    this.handle.prepare("UPDATE outbox_events SET status = 'DELIVERED', delivered_at = ?, error = NULL WHERE id = ?")
      .run(deliveredAt, id);
  }

  rescheduleOutbox(id: string, availableAt: string, error: string, dead = false): void {
    this.handle.prepare("UPDATE outbox_events SET status = ?, attempt = attempt + 1, available_at = ?, error = ? WHERE id = ?")
      .run(dead ? "DEAD" : "PENDING", availableAt, error, id);
  }

  saveSyncCursor(connectorInstanceId: string, cursor: string, updatedAt = new Date().toISOString()): void {
    this.handle.prepare(`
      INSERT INTO sync_cursors(connector_instance_id, cursor, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(connector_instance_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
    `).run(connectorInstanceId, cursor, updatedAt);
  }

  getSyncCursor(connectorInstanceId: string): string | undefined {
    const row = rowObject(this.handle.prepare("SELECT cursor FROM sync_cursors WHERE connector_instance_id = ?").get(connectorInstanceId));
    return row ? String(row.cursor) : undefined;
  }

  appendDeadLetter(input: {
    id: string;
    connectorInstanceId: string;
    source: "inbox" | "outbox" | "reconcile";
    sourceId: string;
    reason: string;
    payload: JsonValue;
    createdAt?: string;
  }): void {
    this.handle.prepare(`
      INSERT INTO dead_letters(id, connector_instance_id, source, source_id, reason, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.connectorInstanceId, input.source, input.sourceId, input.reason, encode(input.payload), input.createdAt ?? new Date().toISOString());
  }

  listDeadLetters<T extends JsonValue>(connectorInstanceId?: string): Array<{ id: string; connectorInstanceId: string; source: "inbox" | "outbox" | "reconcile"; sourceId: string; reason: string; payload: T; createdAt: string }> {
    const rows = connectorInstanceId
      ? this.handle.prepare("SELECT id, connector_instance_id, source, source_id, reason, payload_json, created_at FROM dead_letters WHERE connector_instance_id = ? AND resolved_at IS NULL ORDER BY created_at").all(connectorInstanceId)
      : this.handle.prepare("SELECT id, connector_instance_id, source, source_id, reason, payload_json, created_at FROM dead_letters WHERE resolved_at IS NULL ORDER BY created_at").all();
    return rows.map((value) => {
      const row = rowObject(value) ?? {};
      return {
        id: String(row.id),
        connectorInstanceId: String(row.connector_instance_id),
        source: String(row.source) as "inbox" | "outbox" | "reconcile",
        sourceId: String(row.source_id),
        reason: String(row.reason),
        payload: decode(String(row.payload_json)) as T,
        createdAt: String(row.created_at),
      };
    });
  }

  writeCanonicalTask(id: string, expectedRevision: number, document: JsonValue, updatedAt = new Date().toISOString()): number {
    return this.transaction(() => {
      const row = rowObject(this.handle.prepare("SELECT revision FROM canonical_tasks WHERE id = ?").get(id));
      const actual = Number(row?.revision ?? 0);
      if (actual !== expectedRevision) throw new CanonicalRevisionConflictError(id, expectedRevision, actual);
      const revision = actual + 1;
      this.handle.prepare(`
        INSERT INTO canonical_tasks(id, revision, document_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json, updated_at = excluded.updated_at
      `).run(id, revision, encode(document), updatedAt, updatedAt);
      return revision;
    });
  }

  getCanonicalTask<T extends JsonValue>(id: string): { revision: number; document: T } | undefined {
    const row = rowObject(this.handle.prepare("SELECT revision, document_json FROM canonical_tasks WHERE id = ?").get(id));
    return row ? { revision: Number(row.revision), document: decode(String(row.document_json)) as T } : undefined;
  }

  listCanonicalTasks<T extends JsonValue>(): Array<{ revision: number; document: T }> {
    const rows = this.handle.prepare("SELECT revision, document_json FROM canonical_tasks ORDER BY updated_at DESC").all();
    return rows.map((value) => {
      const row = rowObject(value) ?? {};
      return { revision: Number(row.revision), document: decode(String(row.document_json)) as T };
    });
  }

  saveTaskContract(taskId: string, document: JsonValue, updatedAt = new Date().toISOString()): void {
    this.handle.prepare(`
      INSERT INTO task_contracts(task_id, document_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at
    `).run(taskId, encode(document), updatedAt);
  }

  getTaskContract<T extends JsonValue>(taskId: string): T | undefined {
    const row = rowObject(this.handle.prepare("SELECT document_json FROM task_contracts WHERE task_id = ?").get(taskId));
    return row ? decode(String(row.document_json)) as T : undefined;
  }

  saveDeliveryEvidence(input: { id: string; taskId: string; runId: string; connectorInstanceId: string; kind: string; externalId: string; document: JsonValue; updatedAt: string }): boolean {
    const result = this.handle.prepare(`
      INSERT OR IGNORE INTO delivery_evidence(id, task_id, run_id, connector_instance_id, kind, external_id, document_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.taskId, input.runId, input.connectorInstanceId, input.kind, input.externalId, encode(input.document), input.updatedAt);
    return result.changes === 1;
  }

  updateDeliveryEvidence(input: { id: string; externalId: string; document: JsonValue; updatedAt: string }, baseRevision: number): boolean {
    if (!input.document || typeof input.document !== "object" || Array.isArray(input.document) || input.document.revision !== baseRevision + 1) throw new Error("Delivery evidence update must increment its revision");
    const result = this.handle.prepare(`
      UPDATE delivery_evidence SET external_id = ?, document_json = ?, updated_at = ?
      WHERE id = ? AND json_extract(document_json, '$.revision') = ?
    `).run(input.externalId, encode(input.document), input.updatedAt, input.id, baseRevision);
    return result.changes === 1;
  }

  listDeliveryEvidence<T extends JsonValue>(taskId: string): T[] {
    const rows = this.handle.prepare("SELECT document_json FROM delivery_evidence WHERE task_id = ? ORDER BY updated_at").all(taskId);
    return rows.map((value) => decode(String(rowObject(value)?.document_json)) as T);
  }

  connectorDeletionBlockers(connectorInstanceId: string): { activeBindings: number; pendingOutbox: number } {
    const bindings = rowObject(this.handle.prepare("SELECT COUNT(*) AS count FROM external_bindings WHERE connector_instance_id = ? AND projection_state != 'DISABLED'").get(connectorInstanceId));
    const outbox = rowObject(this.handle.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE connector_instance_id = ? AND status = 'PENDING'").get(connectorInstanceId));
    return { activeBindings: Number(bindings?.count ?? 0), pendingOutbox: Number(outbox?.count ?? 0) };
  }

  deleteConnectorInstance(connectorInstanceId: string): void {
    const blockers = this.connectorDeletionBlockers(connectorInstanceId);
    if (blockers.activeBindings > 0 || blockers.pendingOutbox > 0) {
      throw new Error(`Connector ${connectorInstanceId} has ${blockers.activeBindings} active bindings and ${blockers.pendingOutbox} pending outbox events`);
    }
    this.handle.prepare("DELETE FROM connector_instances WHERE id = ?").run(connectorInstanceId);
  }

  resolveDeadLetter(id: string, resolvedAt = new Date().toISOString()): void {
    this.handle.prepare("UPDATE dead_letters SET resolved_at = ? WHERE id = ?").run(resolvedAt, id);
  }

  retryDeadLetter(id: string, availableAt = new Date().toISOString()): boolean {
    return this.transaction(() => {
      const row = rowObject(this.handle.prepare("SELECT source, source_id FROM dead_letters WHERE id = ? AND resolved_at IS NULL").get(id));
      if (!row || row.source !== "outbox") return false;
      const retried = this.handle.prepare("UPDATE outbox_events SET status = 'PENDING', attempt = 0, available_at = ?, error = NULL WHERE id = ? AND status = 'DEAD'")
        .run(availableAt, String(row.source_id));
      if (retried.changes !== 1) return false;
      this.handle.prepare("UPDATE dead_letters SET resolved_at = ? WHERE id = ?").run(availableAt, id);
      return true;
    });
  }

  pruneConnectorHistory(before: string, limit = 1_000): { inbox: number; outbox: number } {
    return this.transaction(() => {
      const inbox = this.handle.prepare(`
        DELETE FROM inbox_events WHERE id IN (
          SELECT id FROM inbox_events WHERE status = 'PROCESSED' AND processed_at < ? ORDER BY processed_at LIMIT ?
        )
      `).run(before, limit);
      const outbox = this.handle.prepare(`
        DELETE FROM outbox_events WHERE id IN (
          SELECT id FROM outbox_events WHERE status = 'DELIVERED' AND delivered_at < ? ORDER BY delivered_at LIMIT ?
        )
      `).run(before, limit);
      return { inbox: Number(inbox.changes), outbox: Number(outbox.changes) };
    });
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
export class ImmutableSessionSelectionError extends Error {
  readonly code="IMMUTABLE_SESSION_SELECTION";
  constructor(){super("A bound session model selection and execution owner cannot change");this.name="ImmutableSessionSelectionError";}
}
export class ImmutableRunSelectionError extends Error {
  readonly code="IMMUTABLE_RUN_SELECTION";
  constructor(){super("A bound Run model/effort/pricing selection cannot change or be removed");this.name="ImmutableRunSelectionError";}
}
export class ImmutableRoutingDecisionError extends Error {
  readonly code="IMMUTABLE_ROUTING_DECISION";
  constructor(){super("A frozen routing decision and its consumed Run reference cannot change");this.name="ImmutableRoutingDecisionError";}
}
export class ImmutableExecutionContextError extends Error {
  readonly code="IMMUTABLE_EXECUTION_CONTEXT";
  constructor(){super("Run execution context is immutable");this.name="ImmutableExecutionContextError";}
}
