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
    expect(db.schemaVersion()).toBe(2);
    db.migrate();
    expect(db.schemaVersion()).toBe(2);
    expect(db.integrityCheck()).toBe(true);
    db.close();
  });

  it("upgrades an old fixture", () => {
    const path = databasePath();
    const old = new DispatcherDatabase(path, [migrations[0]!]);
    expect(old.schemaVersion()).toBe(1);
    old.close();
    const upgraded = new DispatcherDatabase(path);
    expect(upgraded.schemaVersion()).toBe(2);
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
});
