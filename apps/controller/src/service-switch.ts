import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { acquireInstanceLock, assertDatabaseLocationOperational, restoreDispatcherBackup } from "@dispatcher/persistence";
import { assertLaunchAgentDefinition, launchctl, launchdPlist, LAUNCHD_LABEL, statusLaunchAgent, type LaunchctlExecutor } from "./launchd.js";
import { assertControllerReleaseBinding } from "./release-manifest.js";
import { copyStableDatabaseSnapshot } from "./database-snapshot.js";
import { inspectUpgradeSnapshot, prepareServiceUpgrade, type ServiceUpgradePlan } from "./service-upgrade.js";

type State = "PREPARED" | "APPLYING" | "SWITCH_UNCONFIRMED" | "SWITCHED" | "ROLLED_BACK";
type Direction = "forward" | "rollback";
interface Transaction { nonce: string; directory: string; markerSha256: string; direction?: Direction }
interface RecordV1 { version: 1; state: State; plan: ServiceUpgradePlan; restoreValidated: true; secretStoreIncluded: false; nativeStorageIncluded: false; transaction?: Transaction; previousTransactions?: Transaction[]; [key: string]: unknown }
interface Options { recordPath: string; expectedPlanId: string; confirmed: boolean; executor?: LaunchctlExecutor; expectedDataDirectory?: string }
interface FileOperations { rename: (from: string, to: string) => void; link: (from: string, to: string) => void }
export interface ServiceSwitchResult { state: "SWITCHED" | "ROLLED_BACK"; planId: string; replayed: boolean; activationRequired: true }
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function sealed(path: string, limit = 512 * 1024, maximumLinks = 1): { text: string; sha256: string; stat: ReturnType<typeof fstatSync> } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd); if (!before.isFile() || before.nlink < 1 || before.nlink > maximumLinks || before.size > limit || before.mode & 0o022 || process.getuid && before.uid !== process.getuid()) throw Error("SERVICE_UPGRADE_RECORD_INVALID");
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(fd), current = lstatSync(path);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.isSymbolicLink() || current.dev !== after.dev || current.ino !== after.ino || current.size !== after.size || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs) throw Error("SERVICE_UPGRADE_RECORD_INVALID");
    const bytes = buffer.subarray(0, length); return { text: bytes.toString("utf8"), sha256: digest(bytes), stat: after };
  } finally { closeSync(fd); }
}
function syncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function durable(path: string, text: string): void { const fd = openSync(path, "wx", 0o600); try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path)); }
function saveRecord(path: string, value: RecordV1, expectedHash: string): string {
  const next = join(dirname(path), `.service-upgrade-${randomUUID()}.tmp`), text = JSON.stringify(value, null, 2);
  durable(next, text); if (sealed(path).sha256 !== expectedHash) throw Error("SERVICE_UPGRADE_RECORD_CHANGED");
  renameSync(next, path); syncDirectory(dirname(path)); return digest(text);
}
function readRecord(path: string, expectedId: string): { record: RecordV1; sha256: string } {
  try {
    const raw = sealed(path), record = JSON.parse(raw.text) as RecordV1, plan = record.plan;
    if (record.version !== 1 || !["PREPARED", "APPLYING", "SWITCH_UNCONFIRMED", "SWITCHED", "ROLLED_BACK"].includes(record.state) || record.restoreValidated !== true || record.secretStoreIncluded !== false || record.nativeStorageIncluded !== false || !plan || plan.version !== 1 || plan.scope !== "offline-service-upgrade-preparation" || !/^[a-f0-9]{64}$/.test(expectedId) || plan.id !== expectedId) throw Error();
    const { id, ...fields } = plan;
    if (digest(JSON.stringify(fields)) !== id || resolve(path) !== join(realpathSync(plan.backupDirectory), "service-upgrade.json") || !plan.previous.release || !plan.candidate.release) throw Error();
    for (const [name, definition] of [["previous", plan.previous], ["candidate", plan.candidate]] as const) {
      if (digest(launchdPlist(definition)) !== definition.definitionSha256 || sealed(join(plan.backupDirectory, `${name}.plist`), 64 * 1024).sha256 !== definition.definitionSha256) throw Error();
      assertControllerReleaseBinding(definition.release!, definition.cliPath, definition.nodePath);
    }
    restoreDispatcherBackup(plan.backupDirectory, join(plan.backupDirectory, ".switch-readonly-validation"));
    return { record, sha256: raw.sha256 };
  } catch { throw Error("SERVICE_UPGRADE_RECORD_INVALID"); }
}
function assertSource(plan: ServiceUpgradePlan, source: string): void {
  const snapshot = copyStableDatabaseSnapshot(source, 2 * 1024 * 1024 * 1024);
  try { if (JSON.stringify(inspectUpgradeSnapshot(snapshot.path)) !== JSON.stringify(plan.database)) throw Error("SERVICE_UPGRADE_PLAN_CHANGED"); } finally { snapshot.close(); }
}
async function unloaded(plan: ServiceUpgradePlan, execute: LaunchctlExecutor): Promise<void> { if ((await statusLaunchAgent({ ...plan.previous, plistPath: plan.plistPath, executor: execute })).loaded) throw Error("SERVICE_STOP_REQUIRED"); }
function markerText(record: RecordV1, recordPath: string): string { const transaction=record.transaction!;return JSON.stringify({ version: 1, kind: "service-definition-switch", planId: record.plan.id, recordPath, nonce: transaction.nonce,...(transaction.direction?{direction:transaction.direction}:{}) }); }
function definitions(record: RecordV1) { return record.transaction?.direction === "rollback" ? {from:record.plan.candidate,to:record.plan.previous}:{from:record.plan.previous,to:record.plan.candidate}; }
function assertTransaction(record: RecordV1, path: string): void {
  const transaction = record.transaction, parent = dirname(record.plan.plistPath);
  if (!transaction || transaction.direction!==undefined&&!['forward','rollback'].includes(transaction.direction) || !/^[a-f0-9-]{36}$/.test(transaction.nonce) || dirname(transaction.directory) !== parent || !/^\.dispatcher-upgrade-[A-Za-z0-9]+$/.test(basename(transaction.directory))) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
  const dir = lstatSync(transaction.directory); if (!dir.isDirectory() || dir.isSymbolicLink() || dir.mode & 0o077 || process.getuid && dir.uid !== process.getuid()) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
  if (digest(markerText(record, path)) !== transaction.markerSha256) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
}
function removeMarker(path: string, expected: string): void { if (sealed(path, 4096).sha256 !== expected) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED"); unlinkSync(path); syncDirectory(dirname(path)); }
function installedHash(record: RecordV1): string | undefined {
  const path = record.plan.plistPath;
  if (!existsSync(path)) return undefined;
  const current = sealed(path, 64 * 1024, 2);
  if (current.stat.nlink === 2) {
    const nextPath = join(record.transaction!.directory, "next.plist"), next = sealed(nextPath, 64 * 1024, 2);
    if (current.sha256 !== definitions(record).to.definitionSha256 || next.sha256 !== current.sha256 || next.stat.dev !== current.stat.dev || next.stat.ino !== current.stat.ino) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
    unlinkSync(nextPath); syncDirectory(dirname(nextPath)); syncDirectory(dirname(path));
  }
  return sealed(path, 64 * 1024).sha256;
}

/** Only local definition bytes change; database writes and service activation stay closed. */
export async function switchServiceUpgrade(input: Options, files: FileOperations = { rename: renameSync, link: linkSync }): Promise<ServiceSwitchResult> {
  return changeDefinition(input,"forward",files);
}
/** A definition-only rollback is qualified only while the prepared database bytes remain unchanged. */
export async function rollbackServiceUpgrade(input: Options, files: FileOperations = { rename: renameSync, link: linkSync }): Promise<ServiceSwitchResult> {
  return changeDefinition(input,"rollback",files);
}
async function changeDefinition(input: Options, direction: Direction, files: FileOperations): Promise<ServiceSwitchResult> {
  const displace = files.rename, install = files.link;
  const { recordPath: requested, expectedPlanId, confirmed, executor, expectedDataDirectory } = input;
  if (!confirmed) throw Error("SERVICE_UPGRADE_CONFIRMATION_REQUIRED");
  const recordPath = resolve(requested), initial = readRecord(recordPath, expectedPlanId), plan = initial.record.plan, execute = executor ?? launchctl;
  if (expectedDataDirectory && realpathSync(expectedDataDirectory) !== realpathSync(plan.previous.dataDirectory)) throw Error("SERVICE_DATA_DIRECTORY_MISMATCH");
  const rollback=direction==="rollback",from=rollback?plan.candidate:plan.previous,to=rollback?plan.previous:plan.candidate,completed=rollback?"ROLLED_BACK":"SWITCHED";
  if (initial.record.state === completed) {
    if (existsSync(`${join(realpathSync(plan.previous.dataDirectory), "dispatcher.sqlite")}.restore-pending`)) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
    if (sealed(plan.plistPath, 64 * 1024).sha256 !== to.definitionSha256) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
    return { state: completed, planId: plan.id, replayed: true, activationRequired: true };
  }
  if (initial.record.state !== (rollback?"SWITCHED":"PREPARED")) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
  if(!rollback){
    const fresh = await prepareServiceUpgrade({ current: plan.previous, plistPath: plan.plistPath, targetReleaseDirectory: plan.candidate.release!.directory, backupDirectory: plan.backupDirectory, executor: execute });
    if (fresh.plan.id !== plan.id) throw Error("SERVICE_UPGRADE_PLAN_CHANGED");
  }
  const ownership = acquireInstanceLock(plan.previous.dataDirectory), source = join(ownership.dataDirectory, "dispatcher.sqlite"), barrier = `${source}.restore-pending`;
  let record = initial.record, recordHash = initial.sha256, started = false;
  try {
    assertDatabaseLocationOperational(source); assertSource(plan, source); await unloaded(plan, execute); assertLaunchAgentDefinition({ ...from, plistPath: plan.plistPath });
    if (sealed(recordPath).sha256 !== recordHash) throw Error("SERVICE_UPGRADE_RECORD_CHANGED");
    await execute(["disable", `gui/${process.getuid?.() ?? 0}/${LAUNCHD_LABEL}`]);
    const directory = mkdtempSync(join(dirname(plan.plistPath), ".dispatcher-upgrade-")), nonce = randomUUID();
    record = { ...record, state: "APPLYING",...(record.transaction?{previousTransactions:[...(record.previousTransactions??[]),record.transaction]}:{}), transaction: { nonce, directory, markerSha256: "",direction } }; record.transaction!.markerSha256 = digest(markerText(record, recordPath));
    recordHash = saveRecord(recordPath, record, recordHash); started = true;
    durable(barrier, markerText(record, recordPath));
    const next = join(directory, "next.plist"), displaced = join(directory, "previous.plist"); durable(next, launchdPlist(to));
    assertLaunchAgentDefinition({ ...from, plistPath: plan.plistPath }); displace(plan.plistPath, displaced); syncDirectory(directory); syncDirectory(dirname(plan.plistPath));
    if (sealed(displaced, 64 * 1024).sha256 !== from.definitionSha256) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
    install(next, plan.plistPath); if (installedHash(record) !== to.definitionSha256) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
    assertSource(plan, source); await unloaded(plan, execute); assertControllerReleaseBinding(to.release!, to.cliPath, to.nodePath);
    record = { ...record, state: completed, installedDefinitionChanged: !rollback }; recordHash = saveRecord(recordPath, record, recordHash);
    removeMarker(barrier, record.transaction!.markerSha256);
    return { state: completed, planId: plan.id, replayed: false, activationRequired: true };
  } catch (error) {
    if (!started) throw error;
    try { saveRecord(recordPath, { ...record, state: "SWITCH_UNCONFIRMED" }, recordHash); } catch { /* Preserve the last durable journal and barrier. */ }
    throw Error("SERVICE_UPGRADE_SWITCH_UNCONFIRMED",{cause:error});
  } finally { ownership.release(); }
}

/** Explicitly reconcile only this transaction's exact local effects; never a native effect. */
export async function reconcileServiceUpgrade(input: Options): Promise<ServiceSwitchResult> {
  const { recordPath: requested, expectedPlanId, confirmed, executor, expectedDataDirectory } = input;
  if (!confirmed) throw Error("SERVICE_UPGRADE_CONFIRMATION_REQUIRED");
  const recordPath = resolve(requested), { record, sha256 } = readRecord(recordPath, expectedPlanId), plan = record.plan, execute = executor ?? launchctl;
  if (expectedDataDirectory && realpathSync(expectedDataDirectory) !== realpathSync(plan.previous.dataDirectory)) throw Error("SERVICE_DATA_DIRECTORY_MISMATCH");
  assertTransaction(record, recordPath);
  const ownership = acquireInstanceLock(plan.previous.dataDirectory), source = join(ownership.dataDirectory, "dispatcher.sqlite"), barrier = `${source}.restore-pending`;
  try {
    if (existsSync(barrier) && sealed(barrier, 4096).sha256 !== record.transaction!.markerSha256) throw Error("SERVICE_UPGRADE_RECONCILIATION_REQUIRED");
    assertSource(plan, source); await unloaded(plan, execute);
    let actual = installedHash(record);
    if (actual === undefined) {
      const displaced = join(record.transaction!.directory, "previous.plist");
      if (sealed(displaced, 64 * 1024).sha256 !== definitions(record).from.definitionSha256) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
      copyFileSync(displaced, plan.plistPath, constants.COPYFILE_EXCL);
      const fd = openSync(plan.plistPath, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(plan.plistPath)); actual = installedHash(record);
    }
    const state = actual === plan.candidate.definitionSha256 ? "SWITCHED" : actual === plan.previous.definitionSha256 ? "ROLLED_BACK" : undefined;
    if (!state) throw Error("SERVICE_UPGRADE_DEFINITION_UNRESOLVED");
    saveRecord(recordPath, { ...record, state, installedDefinitionChanged: state === "SWITCHED" }, sha256);
    if (existsSync(barrier)) removeMarker(barrier, record.transaction!.markerSha256);
    return { state, planId: plan.id, replayed: false, activationRequired: true };
  } finally { ownership.release(); }
}
