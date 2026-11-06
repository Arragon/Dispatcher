import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DispatcherDatabase, MigrationError, migrations } from "../src/index.js";
import { databaseWriterProtocol } from "../src/database-compatibility.js";
const previous = migrations.filter(m => m.version <= 12);
it("rejects protocol-eight execution writers that do not preserve RHIZA Context/job authority", () => {
  const root = mkdtempSync(join(tmpdir(), "rhiza-job-writer-")), path = join(root, "db.sqlite"), old = new DispatcherDatabase(path, previous);
  try {
    old.saveEntity("fixture", "retained", { id: "retained" }); const current = new DispatcherDatabase(path);
    try {
      expect(current.schemaVersion()).toBe(19); expect(databaseWriterProtocol(current.handle)).toBe(15);
      expect(() => old.saveEntity("fixture", "old", {})).toThrow("DATABASE_WRITER_UNSUPPORTED");
      expect(() => new DispatcherDatabase(path, previous)).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_UNSUPPORTED" }));
      expect(current.getEntity("fixture", "retained")).toEqual({ id: "retained" });
    } finally { current.close(); }
  } finally { old.close(); rmSync(root, { recursive: true, force: true }); }
});
it("rolls back an interrupted job-authority writer upgrade to protocol eight", () => {
  const db = new DispatcherDatabase(":memory:", previous), upgrade = migrations.find(m => m.version === 13);
  try {
    expect(upgrade).toBeDefined();
    const before = db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
    expect(() => db.migrate([...previous, { ...upgrade!, afterApply: database => { upgrade!.afterApply?.(database); throw Error("injected writer upgrade"); } }])).toThrow(MigrationError);
    expect(db.schemaVersion()).toBe(12); expect(databaseWriterProtocol(db.handle)).toBe(8);
    expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(before);
    expect(() => db.saveEntity("fixture", "still-eight", {})).not.toThrow();
  } finally { db.close(); }
});
it("allows only the external-effect journal to change within a frozen RHIZA job", () => {
  const db = new DispatcherDatabase(":memory:"), job = { version: 1, jobId: "job-a", taskId: "task-a", principal: { id: "rhiza:client-a" }, request: { targetHash: "a".repeat(64), workOrder: { context: { content: "exact" } } }, dispatch: { state: "pending" } };
  try {
    db.saveEntity("rhiza-job", "job-a", job);
    expect(() => db.saveEntity("rhiza-job", "job-a", { ...job, dispatch: { state: "claimed" } })).not.toThrow();
    expect(() => db.saveEntity("rhiza-job", "job-a", { ...job, taskId: "other" })).toThrowError(expect.objectContaining({ code: "IMMUTABLE_RHIZA_JOB" }));
    expect(() => db.saveEntity("rhiza-job", "job-a", { ...job, request: { ...job.request, workOrder: { context: { content: "changed" } } } })).toThrowError(expect.objectContaining({ code: "IMMUTABLE_RHIZA_JOB" }));
    db.saveEntity("task-rhiza-binding", "task-a", { jobId: "job-a" });
    expect(() => db.saveEntity("task-rhiza-binding", "task-a", { jobId: "other" })).toThrowError(expect.objectContaining({ code: "IMMUTABLE_RHIZA_JOB" }));
  } finally { db.close(); }
});
