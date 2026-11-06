import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DispatcherDatabase, inspectDispatcherDatabase } from "@dispatcher/persistence";
import { launchdPlist } from "../src/launchd.js";
import { prepareServiceUpgrade } from "../src/service-upgrade.js";
import {upgradeFixture} from "./fixtures/service-upgrade.js";

const roots: string[] = []; const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
const fixture=()=>upgradeFixture(roots);

it("prepares a recoverable compatible DB backup and candidate definition without switching or starting", async () => {
  const f = fixture(), before = hash(f.path), definitionBefore = hash(f.input.plistPath);
  const preview = await prepareServiceUpgrade(f.input); expect(preview.phase).toBe("preview"); expect(existsSync(f.input.backupDirectory)).toBe(false);
  const result = await prepareServiceUpgrade({ ...f.input, execute: true, confirmed: true, expectedPlanId: preview.plan.id }); expect(result.phase).toBe("prepared");
  expect(hash(f.path)).toBe(before); expect(hash(f.input.plistPath)).toBe(definitionBefore); expect(f.calls.every(args => args[0] === "print")).toBe(true);
  expect(JSON.parse(readFileSync(join(f.input.backupDirectory, "service-upgrade.json"), "utf8"))).toMatchObject({ state: "PREPARED", installedDefinitionChanged: false, nativeStorageIncluded: false, secretStoreIncluded: false, restoreValidated: true });
  expect(readFileSync(join(f.input.backupDirectory, "candidate.plist"), "utf8")).toContain(f.input.targetReleaseDirectory);
  expect(inspectDispatcherDatabase(join(f.input.backupDirectory, "dispatcher.sqlite"))).toMatchObject({ schemaVersion: 19, integrity: true });
});
it("requires the exact reviewed plan and refuses a changed database, active Run or restore barrier", async () => {
  const f = fixture(), preview = await prepareServiceUpgrade(f.input);
  await expect(prepareServiceUpgrade({ ...f.input, execute: true, expectedPlanId: preview.plan.id })).rejects.toThrow("SERVICE_UPGRADE_CONFIRMATION_REQUIRED");
  const db = new DispatcherDatabase(f.path); db.saveEntity("fixture", "new", { changed: true }); db.checkpoint(); db.close();
  await expect(prepareServiceUpgrade({ ...f.input, execute: true, confirmed: true, expectedPlanId: preview.plan.id })).rejects.toThrow("SERVICE_UPGRADE_PLAN_CHANGED"); expect(existsSync(f.input.backupDirectory)).toBe(false);
  const active = new DispatcherDatabase(f.path); active.saveEntity("run", "r", { id: "r", state: "ACTIVE" }); active.checkpoint(); active.close();
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_UPGRADE_NOT_QUIESCENT");
  writeFileSync(`${f.path}.restore-pending`, "{}"); await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("RESTORE_RECONCILIATION_REQUIRED");
});
it("rejects loaded supervision, schema mismatch and unknown/custom definitions before creating a backup", async () => {
  const f = fixture();
  await expect(prepareServiceUpgrade({ ...f.input, executor: async () => ({ stdout: `path = ${f.input.plistPath}\nstate = running\npid = 12345\n`, stderr: "" }) })).rejects.toThrow("SERVICE_STOP_REQUIRED");
  const path = join(f.input.targetReleaseDirectory, "release.json"), metadata = JSON.parse(readFileSync(path, "utf8")); metadata.schemaVersion = 7; writeFileSync(path, JSON.stringify(metadata));
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_UPGRADE_MIGRATION_NOT_QUALIFIED"); metadata.schemaVersion = 19; writeFileSync(path, JSON.stringify(metadata));
  writeFileSync(f.input.plistPath, launchdPlist(f.input.current).replace("<dict>", "<dict><!-- custom -->"));
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_DEFINITION_CHANGED"); expect(existsSync(f.input.backupDirectory)).toBe(false);
});
it.each([
  ["run-input",{state:"RESERVED"}],
  ["run-input",{state:"OUTCOME_UNKNOWN"}],
  ["task-publication",{receipt:{state:"OUTCOME_UNKNOWN"}}],
  ["native-cancel",{resolution:{nativeMayBeRunning:true}}],
  ["adapter-session",{state:"COMPLETED",nativeBinding:{identityState:"legacy"}}],
  ["run-verification-command",{state:"SENDING"}],
  ["run-verification-command",{state:"UNKNOWN"}],
] as const)("rejects unresolved %s execution evidence even without an active Run",async(kind,value)=>{
  const f=fixture(),db=new DispatcherDatabase(f.path);db.saveEntity(kind,"pending",value);db.checkpoint();db.close();
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_UPGRADE_NOT_QUIESCENT");expect(existsSync(f.input.backupDirectory)).toBe(false);
});
it("keeps failed or unknown telemetry separate from execution quiescence",async()=>{
  const f=fixture(),db=new DispatcherDatabase(f.path);db.saveEntity("usage-read-state","run",{state:"unknown"});db.saveEntity("usage-error","run",{status:"unknown"});db.saveEntity("run-input","known",{state:"REJECTED"});db.saveEntity("native-cancel","known",{resolution:{nativeMayBeRunning:false}});db.checkpoint();db.close();
  expect(await prepareServiceUpgrade(f.input)).toMatchObject({phase:"preview"});
});
