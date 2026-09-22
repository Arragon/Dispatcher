import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DispatcherDatabase, MigrationError, migrations } from "../src/index.js";

const temporaryDirectories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-db-"));
  temporaryDirectories.push(directory);
  return join(directory, "dispatcher.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("DispatcherDatabase", () => {
  it("migrates an empty database idempotently", () => {
    const db = new DispatcherDatabase(":memory:");
    expect(db.schemaVersion()).toBe(3);
    db.migrate();
    expect(db.schemaVersion()).toBe(3);
    expect(db.integrityCheck()).toBe(true);
    db.close();
  });

  it("upgrades the pre-connector schema without losing persisted state", () => {
    const path = databasePath();
    const old = new DispatcherDatabase(path, [migrations[0]!, migrations[1]!]);
    expect(old.schemaVersion()).toBe(2);
    old.saveEntity("runner", "legacy-runner", { state: "OFFLINE" });
    old.handle.prepare("INSERT INTO config_state (singleton, revision, schema_version, document_json, updated_at) VALUES (1, 7, 1, ?, ?)")
      .run(JSON.stringify({ controller: { id: "legacy" } }), "2026-09-21T00:00:00.000Z");
    old.close();
    const upgraded = new DispatcherDatabase(path);
    expect(upgraded.schemaVersion()).toBe(3);
    expect(upgraded.getEntity("runner", "legacy-runner")).toEqual({ state: "OFFLINE" });
    expect(upgraded.handle.prepare("SELECT revision FROM config_state WHERE singleton = 1").get()).toEqual({ revision: 7 });
    expect(upgraded.integrityCheck()).toBe(true);
    upgraded.close();
  });

  it("restores representative entities after restart", () => {
    const path = databasePath();
    const first = new DispatcherDatabase(path);
    first.saveEntity("runner", "mac-neo", { id: "mac-neo", state: "ONLINE" });
    first.close();
    const restarted = new DispatcherDatabase(path);
    expect(restarted.getEntity("runner", "mac-neo")).toEqual({ id: "mac-neo", state: "ONLINE" });
    restarted.close();
  });

  it("rolls back a failed migration", () => {
    const path = databasePath();
    expect(
      () =>
        new DispatcherDatabase(path, [
          migrations[0]!,
          { version: 2, name: "broken", sql: "CREATE TABLE should_rollback (id TEXT); INVALID SQL;" },
        ]),
    ).toThrow(MigrationError);
    const recovered = new DispatcherDatabase(path, [migrations[0]!]);
    expect(recovered.schemaVersion()).toBe(1);
    const tables = recovered.handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
      .all();
    expect(tables).toHaveLength(0);
    recovered.close();
  });

  it("deduplicates normalized run events", () => {
    const db = new DispatcherDatabase(":memory:");
    const event = {
      eventId: "event-1",
      runId: "run-1",
      type: "run.state",
      payload: { state: "ACTIVE" },
      occurredAt: new Date().toISOString(),
      sequence: 1,
    } as const;
    expect(db.appendRunEvent(event)).toBe(true);
    expect(db.appendRunEvent(event)).toBe(false);
    db.close();
  });

  it("atomically persists canonical task, binding, inbox and outbox state", () => {
    const db = new DispatcherDatabase(":memory:");
    const now = "2026-09-22T00:00:00.000Z";
    expect(db.appendInboxEvent({
      id: "in-1", connectorInstanceId: "linear", externalEventId: "event-1", idempotencyKey: "linear:event-1",
      eventType: "task.updated", normalized: { id: "event-1" }, status: "PENDING", receivedAt: now,
    })).toBe(true);
    expect(db.appendInboxEvent({
      id: "in-2", connectorInstanceId: "linear", externalEventId: "event-1", idempotencyKey: "linear:event-1",
      eventType: "task.updated", normalized: { id: "event-1" }, status: "PENDING", receivedAt: now,
    })).toBe(false);
    expect(db.writeCanonicalTask("task-1", 0, { id: "task-1", title: "Canonical" }, now)).toBe(1);
    db.saveExternalBinding({ id: "binding-1", canonicalEntityId: "task-1", connectorInstanceId: "linear", entityType: "task", externalId: "INH-1", projectionState: "PENDING", document: { id: "binding-1" }, updatedAt: now });
    expect(db.enqueueOutboxEvent({ id: "out-1", connectorInstanceId: "linear", idempotencyKey: "project-1", eventType: "task.update", payload: { taskId: "task-1" }, status: "PENDING", attempt: 0, availableAt: now, createdAt: now })).toBe(true);
    expect(db.listReadyOutbox(now)).toHaveLength(1);
    expect(db.connectorDeletionBlockers("linear")).toEqual({ activeBindings: 1, pendingOutbox: 1 });
    db.close();
  });
});
