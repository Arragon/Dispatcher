import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDispatcherBackup, restoreDispatcherBackup, DispatcherDatabase, MigrationError, migrations } from "../src/index.js";
import { databaseWriterProtocol } from "../src/database-compatibility.js";
import { RhizaAdmissionStore } from "../src/rhiza-admissions.js";

const key = { clientId: "client-a", commandScope: "jobs.submit" as const, requestId: "request-a" };
const hash = "a".repeat(64);
const admission = { repositoryId: "repo-a", profileId: "profile-a", authorityId: "rhiza-a", jobId: "job-a", taskId: "task-a", receipt: { state: "accepted", receiptId: "receipt-a" } };
const previous = migrations.filter(m => m.version <= 11);
describe("durable immutable RHIZA admission", () => {
  it("serializes competing processes at the SQLite acceptance boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "rhiza-race-")), path = join(root, "db.sqlite"), gate = new SharedArrayBuffer(4);
    new DispatcherDatabase(path).close(); let ready = 0;
    const workers: Worker[] = [];
    const compete = () => new Promise<{ created: boolean; jobId: string }>((resolveResult, reject) => {
      const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
        (async()=>{const {DispatcherDatabase,RhizaAdmissionStore}=await import(workerData.module);
          const db=new DispatcherDatabase(workerData.path);try{parentPort.postMessage({ready:true});
            Atomics.wait(new Int32Array(workerData.gate),0,0);
            let created=false;const receipt=new RhizaAdmissionStore(db).accept(workerData.key,workerData.hash,()=>{created=true;return workerData.admission;});
            parentPort.postMessage({created,jobId:receipt.jobId});}finally{db.close();}})().catch(error=>{throw error;});`,
        { eval: true, workerData: { module: pathToFileURL(resolve("packages/persistence/dist/index.js")).href, path, gate, key, hash, admission } });
      workers.push(worker); worker.once("error", reject);
      worker.on("message", value => { if (value.ready) { if (++ready === 2) { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0); } } else resolveResult(value); });
    });
    try { const results = await Promise.all([compete(), compete()]); expect(results.filter(value => value.created)).toHaveLength(1); expect(results.map(value => value.jobId)).toEqual(["job-a", "job-a"]); }
    finally { await Promise.all(workers.map(worker => worker.terminate())); rmSync(root, { recursive: true, force: true }); }
  });
  it("replays once across connections/restarts and isolates the authenticated key domain", () => {
    const root = mkdtempSync(join(tmpdir(), "rhiza-admission-")), path = join(root, "db.sqlite"); let calls = 0;
    const first = new DispatcherDatabase(path), second = new DispatcherDatabase(path);
    try {
      const a = new RhizaAdmissionStore(first).accept(key, hash, () => { calls++; return admission; });
      const b = new RhizaAdmissionStore(second).accept(key, hash, () => { calls++; throw Error("must not create again"); });
      expect(b).toEqual(a); expect(calls).toBe(1);
      expect(new RhizaAdmissionStore(second).get({ ...key, clientId: "client-b" })).toBeUndefined();
      expect(() => new RhizaAdmissionStore(second).accept(key, "b".repeat(64), () => admission)).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));
      (a.receipt as { state: string }).state = "changed";
      expect(new RhizaAdmissionStore(first).get(key)?.receipt).toEqual(admission.receipt);
    } finally { first.close(); second.close(); }
    const reopened = new DispatcherDatabase(path);
    try { expect(new RhizaAdmissionStore(reopened).get(key)?.jobId).toBe("job-a"); }
    finally { reopened.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("rolls back canonical callback writes and the receipt together on failure", () => {
    const db = new DispatcherDatabase(":memory:"), store = new RhizaAdmissionStore(db);
    try {
      expect(() => store.accept(key, hash, () => { db.saveEntity("fixture", "task", { id: "task" }); throw Error("before receipt"); })).toThrow("before receipt");
      expect(db.getEntity("fixture", "task")).toBeUndefined(); expect(store.get(key)).toBeUndefined();
      expect(() => db.transaction(() => { store.accept(key, hash, () => admission); throw Error("after receipt"); })).toThrow("after receipt");
      expect(store.get(key)).toBeUndefined();
      expect(store.accept(key, hash, () => admission).jobId).toBe("job-a");
    } finally { db.close(); }
  });
  it("blocks receipt mutation/deletion even by current writers", () => {
    const db = new DispatcherDatabase(":memory:");
    try {
      new RhizaAdmissionStore(db).accept(key, hash, () => admission);
      expect(() => db.handle.exec("UPDATE rhiza_admissions SET receipt_json='{}'")).toThrow("RHIZA_RECEIPT_IMMUTABLE");
      expect(() => db.handle.exec("DELETE FROM rhiza_admissions")).toThrow("RHIZA_RECEIPT_IMMUTABLE");
      const replace = db.handle.prepare("INSERT OR REPLACE INTO rhiza_admissions SELECT ?,command_scope,?,request_hash,repository_id,profile_id,authority_id,job_id,task_id,'{}' FROM rhiza_admissions");
      expect(() => replace.run(key.clientId, key.requestId)).toThrow("RHIZA_RECEIPT_IMMUTABLE");
      expect(() => replace.run("client-b", "new-key")).toThrow("RHIZA_RECEIPT_IMMUTABLE");
      expect(new RhizaAdmissionStore(db).get(key)?.receipt).toEqual(admission.receipt);
    } finally { db.close(); }
  });
  it("fences already-open protocol-seven writers and rejects older readers after upgrade", () => {
    const root = mkdtempSync(join(tmpdir(), "rhiza-writer-")), path = join(root, "db.sqlite"), old = new DispatcherDatabase(path, previous), raw = new DatabaseSync(path);
    raw.function("dispatcher_writer_protocol", () => 7);
    old.saveEntity("fixture", "kept", { id: "kept" });
    try {
      const current = new DispatcherDatabase(path);
      try {
        expect(current.schemaVersion()).toBe(19); expect(databaseWriterProtocol(current.handle)).toBe(15);
        expect(() => old.saveEntity("fixture", "old", {})).toThrow("DATABASE_WRITER_UNSUPPORTED");
        expect(() => raw.exec("DELETE FROM entities")).toThrow("DATABASE_WRITER_UNSUPPORTED");
        expect(() => new DispatcherDatabase(path, previous)).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_UNSUPPORTED" }));
        expect(() => current.saveEntity("fixture", "new", {})).not.toThrow();
      } finally { current.close(); }
    } finally { old.close(); raw.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("restores schema-eleven writer guards after an interrupted or outer-rolled-back migration", () => {
    const db = new DispatcherDatabase(":memory:", previous), migration = () => migrations.find(m => m.version === 12)!;
    const gates = () => db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
    try {
      const before = gates(); expect(migration()).toBeDefined();
      expect(() => db.migrate([...previous, { ...migration(), afterApply: database => { migration().afterApply?.(database); throw Error("injected"); } }])).toThrow(MigrationError);
      expect(db.schemaVersion()).toBe(11); expect(databaseWriterProtocol(db.handle)).toBe(7); expect(gates()).toEqual(before);
      expect(() => db.transaction(() => { db.migrate(); throw Error("outer rollback"); })).toThrow("outer rollback");
      expect(db.schemaVersion()).toBe(11); expect(gates()).toEqual(before);
      expect(() => db.saveEntity("fixture", "still-seven", {})).not.toThrow(); db.migrate(); expect(db.schemaVersion()).toBe(19);
    } finally { db.close(); }
  });
  it("retains the original receipt through backup and restore behind reconciliation barriers", async () => {
    const root = mkdtempSync(join(tmpdir(), "rhiza-receipt-backup-")), path = join(root, "source.sqlite"), db = new DispatcherDatabase(path);
    try {
      const accepted = new RhizaAdmissionStore(db).accept(key, hash, () => admission);
      await createDispatcherBackup(path, join(root, "backup"));
      restoreDispatcherBackup(join(root, "backup"), join(root, "restored"), { execute: true, confirmed: true });
      const restored = new DatabaseSync(join(root, "restored", "dispatcher.sqlite"), { readOnly: true });
      try { expect(databaseWriterProtocol(restored)).toBe(15); expect(JSON.parse(String(restored.prepare("SELECT receipt_json FROM rhiza_admissions").get()?.receipt_json))).toEqual(accepted.receipt); }
      finally { restored.close(); }
      expect(() => new DispatcherDatabase(join(root, "restored", "dispatcher.sqlite"))).toThrowError(expect.objectContaining({ code: "RESTORE_RECONCILIATION_REQUIRED" }));
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
