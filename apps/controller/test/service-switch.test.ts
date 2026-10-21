import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { DatabaseSync } from "node:sqlite";
import { upgradeFixture } from "./fixtures/service-upgrade.js";
import { prepareServiceUpgrade } from "../src/service-upgrade.js";
import { switchServiceUpgrade, reconcileServiceUpgrade } from "../src/service-switch.js";
import {startLaunchAgent} from "../src/launchd.js";

const roots: string[] = []; afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
async function fixture() { const f = upgradeFixture(roots), preview = await prepareServiceUpgrade(f.input); await prepareServiceUpgrade({ ...f.input, execute: true, confirmed: true, expectedPlanId: preview.plan.id }); const recordPath = join(f.input.backupDirectory, "service-upgrade.json"), executor = async (args: string[]) => { if (args[0] === "disable") { f.calls.push(args); return { stdout: "", stderr: "" }; } return f.input.executor(args); }; return { ...f, options: { recordPath, expectedPlanId: preview.plan.id, confirmed: true, executor }, candidateHash: preview.plan.candidate.definitionSha256!, previousHash: preview.plan.previous.definitionSha256!, barrier: `${f.path}.restore-pending` }; }
it("switches an offline definition with a writer barrier and returns the same receipt on replay", async () => {
  const f = await fixture(), before = hash(f.path);
  expect(await switchServiceUpgrade(f.options)).toMatchObject({ state: "SWITCHED", replayed: false, activationRequired: true });
  expect(hash(f.input.plistPath)).toBe(f.candidateHash); expect(hash(f.path)).toBe(before); expect(existsSync(f.barrier)).toBe(false);
  expect(await switchServiceUpgrade(f.options)).toMatchObject({ state: "SWITCHED", replayed: true });
  expect(f.calls.some(args => ["bootstrap", "kickstart", "enable"].includes(args[0]!))).toBe(false);
});
it("keeps a failed install and its data fenced, then reconciles the missing definition from captured bytes", async () => {
  const f = await fixture(), before = hash(f.path);
  await expect(switchServiceUpgrade(f.options, { rename: renameSync, link: () => { throw Error("fixture-link-failure"); } })).rejects.toThrow("SERVICE_UPGRADE_SWITCH_UNCONFIRMED");
  expect(existsSync(f.barrier)).toBe(true); expect(() => new DispatcherDatabase(f.path)).toThrowError(expect.objectContaining({ code: "RESTORE_RECONCILIATION_REQUIRED" }));
  expect(await reconcileServiceUpgrade(f.options)).toMatchObject({ state: "ROLLED_BACK", activationRequired: true });
  expect(hash(f.input.plistPath)).toBe(f.previousHash); expect(hash(f.path)).toBe(before); expect(existsSync(f.barrier)).toBe(false);
});
it("reconciles a lost response after the candidate file was installed without repeating the installation", async () => {
  const f = await fixture(); let installs = 0;
  await expect(switchServiceUpgrade(f.options, { rename: renameSync, link: (from: string, to: string) => { installs++; linkSync(from, to); throw Error("fixture-lost-write-response"); } })).rejects.toThrow("SERVICE_UPGRADE_SWITCH_UNCONFIRMED");
  expect(hash(f.input.plistPath)).toBe(f.candidateHash); expect(existsSync(f.barrier)).toBe(true);
  expect(await reconcileServiceUpgrade(f.options)).toMatchObject({ state: "SWITCHED" }); expect(installs).toBe(1); expect(existsSync(f.barrier)).toBe(false);
});
it("never clears a preexisting restore marker or overwrites a new foreign definition", async () => {
  const f = await fixture(); writeFileSync(f.barrier, '{"version":1,"kind":"actual-restore"}');
  await expect(switchServiceUpgrade(f.options)).rejects.toThrow("RESTORE_RECONCILIATION_REQUIRED"); expect(readFileSync(f.barrier, "utf8")).toContain("actual-restore"); rmSync(f.barrier);
  await expect(switchServiceUpgrade(f.options, { rename: renameSync, link: (_from: string, to: string) => { writeFileSync(to, "preserve user change", { flag: "wx", mode: 0o600 }); throw Error("fixture-concurrent-editor"); } })).rejects.toThrow("SERVICE_UPGRADE_SWITCH_UNCONFIRMED");
  await expect(reconcileServiceUpgrade(f.options)).rejects.toThrow("SERVICE_UPGRADE_DEFINITION_UNRESOLVED"); expect(readFileSync(f.input.plistPath, "utf8")).toBe("preserve user change"); expect(existsSync(f.barrier)).toBe(true);
});
it("rejects changed data, tampered artifacts and missing confirmation before any definition switch", async () => {
  const f = await fixture(); await expect(switchServiceUpgrade({ ...f.options, confirmed: false })).rejects.toThrow("SERVICE_UPGRADE_CONFIRMATION_REQUIRED");
  const db = new DispatcherDatabase(f.path); db.saveEntity("fixture", "changed", { changed: true }); db.checkpoint(); db.close();
  await expect(switchServiceUpgrade(f.options)).rejects.toThrow("SERVICE_UPGRADE_PLAN_CHANGED"); expect(hash(f.input.plistPath)).toBe(f.previousHash); expect(existsSync(f.barrier)).toBe(false);
  const other = await fixture(); writeFileSync(join(other.input.backupDirectory, "candidate.plist"), "tampered candidate"); await expect(switchServiceUpgrade(other.options)).rejects.toThrow("SERVICE_UPGRADE_RECORD_INVALID"); expect(existsSync(other.barrier)).toBe(false);
});
it("leaves the known deployment barrier intact if a non-cooperating writer changed the database",async()=>{
  const f=await fixture();await expect(switchServiceUpgrade(f.options,{rename:renameSync,link:()=>{throw Error("fixture-install-failure");}})).rejects.toThrow("SERVICE_UPGRADE_SWITCH_UNCONFIRMED");
  const db=new DatabaseSync(f.path);try{db.function("dispatcher_writer_protocol",()=>4);db.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES ('fixture','foreign-write','{}','2026-10-21T00:00:00Z')").run();db.exec("PRAGMA wal_checkpoint(TRUNCATE)");}finally{db.close();}
  await expect(reconcileServiceUpgrade(f.options)).rejects.toThrow("SERVICE_UPGRADE_PLAN_CHANGED");expect(existsSync(f.barrier)).toBe(true);expect(existsSync(f.input.plistPath)).toBe(false);
});
it("rejects service start at the existing database location barrier before supervisor mutation",async()=>{
  const f=await fixture();writeFileSync(f.barrier,'{"kind":"actual-restore"}');f.calls.length=0;
  await expect(startLaunchAgent({...f.input.current,plistPath:f.input.plistPath,executor:f.options.executor})).rejects.toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));expect(f.calls).toHaveLength(0);
});
