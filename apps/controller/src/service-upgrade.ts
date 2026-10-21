import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, openSync, readSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { acquireInstanceLock, assertDatabaseLocationOperational, assertDatabaseOperational, assertDatabaseSchema, createDispatcherBackup, databaseWriterProtocol, inspectDispatcherDatabase, migrations, restoreDispatcherBackup } from "@dispatcher/persistence";
import { copyStableDatabaseSnapshot } from "./database-snapshot.js";
import { assertLaunchAgentDefinition, launchdPlist, statusLaunchAgent, type LaunchAgentDefinition, type LaunchctlExecutor } from "./launchd.js";
import { assertControllerReleaseBinding, bindControllerRelease, verifyControllerRelease } from "./release-manifest.js";

interface Input { current: LaunchAgentDefinition; plistPath: string; targetReleaseDirectory: string; backupDirectory: string; executor?: LaunchctlExecutor; execute?: boolean; confirmed?: boolean; expectedPlanId?: string }
export interface DatabaseFacts { schemaVersion: number; writerProtocol: number; mainSha256: string; walSha256: string | null; tasks: number; runs: number; sessions: number }
export interface ServiceUpgradePlan { version: 1; id: string; scope: "offline-service-upgrade-preparation"; plistPath: string; previous: LaunchAgentDefinition; candidate: LaunchAgentDefinition; backupDirectory: string; database: DatabaseFacts; installedDefinitionChanged: false; activationRequired: true; restoreReconciliationRequired: true }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fileHash(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK), digest = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
  try { if (!fstatSync(fd).isFile()) throw Error("SERVICE_UPGRADE_DATA_UNVERIFIED"); for (;;) { const bytes = readSync(fd, chunk, 0, chunk.length, null); if (!bytes) break; digest.update(chunk.subarray(0, bytes)); } return digest.digest("hex"); } finally { closeSync(fd); }
}
function inside(root: string, path: string): boolean { const part = relative(root, path); return part === "" || part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part); }
function durableFile(path: string, content: string): void { const fd = openSync(path, "wx", 0o600); try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } }
export function inspectUpgradeSnapshot(path: string): DatabaseFacts {
  const mainSha256 = fileHash(path), walSha256 = existsSync(`${path}-wal`) ? fileHash(`${path}-wal`) : null, db = new DatabaseSync(path, { readOnly: true });
  try {
    assertDatabaseSchema(db, migrations); assertDatabaseOperational(db);
    const state = inspectDispatcherDatabase(path);
    if (!state.integrity || state.reconciliationRequired) throw Error("SERVICE_UPGRADE_DATA_UNVERIFIED");
    if (state.schemaVersion !== migrations.at(-1)!.version) throw Error("SERVICE_UPGRADE_MIGRATION_NOT_QUALIFIED");
    const count = (sql: string) => Number(db.prepare(sql).get()?.n);
    const unsafe = [
      count("SELECT COUNT(*) AS n FROM entities WHERE kind='run' AND COALESCE(json_extract(document_json,'$.state'),'UNKNOWN') NOT IN ('COMPLETE','FAILED','CANCELLED','SUPERSEDED')"),
      count("SELECT COUNT(*) AS n FROM canonical_tasks WHERE COALESCE(json_extract(document_json,'$.state'),'UNKNOWN') NOT IN ('BACKLOG','NEEDS_SPEC','REVIEW','DONE','FAILED','CANCELLED')"),
      count("SELECT COUNT(*) AS n FROM entities WHERE kind='adapter-session' AND COALESCE(json_extract(document_json,'$.state'),'UNKNOWN') NOT IN ('COMPLETED','FAILED','CANCELLED')"),
      count("SELECT COUNT(*) AS n FROM session_controls WHERE state!='AUTOMATED'"),
      count("SELECT COUNT(*) AS n FROM native_bindings"),
      count("SELECT COUNT(*) AS n FROM entities WHERE kind IN ('native-runtime','runner-process') OR kind='local-review-verification' AND COALESCE(json_extract(document_json,'$.state'),'UNKNOWN') IN ('SENDING','UNKNOWN')"),
      state.inventory.unresolvedCommands, state.inventory.pendingOutbox,
    ];
    if (unsafe.some(value => !Number.isSafeInteger(value) || value !== 0)) throw Error("SERVICE_UPGRADE_NOT_QUIESCENT");
    return { schemaVersion: state.schemaVersion, writerProtocol: databaseWriterProtocol(db), mainSha256, walSha256, tasks: state.inventory.tasks, runs: state.inventory.runs, sessions: state.inventory.sessions };
  } finally { db.close(); }
}

/** Preparation never edits the installed plist, activates restored data or starts a provider. */
export async function prepareServiceUpgrade(input: Input): Promise<{ phase: "preview" | "prepared"; plan: ServiceUpgradePlan }> {
  const current = structuredClone(input.current), plistPath = resolve(input.plistPath), target = resolve(input.targetReleaseDirectory), executor = input.executor;
  const { execute, confirmed, expectedPlanId } = input;
  if (execute && (!confirmed || !expectedPlanId)) throw Error("SERVICE_UPGRADE_CONFIRMATION_REQUIRED");
  if (![input.plistPath, input.targetReleaseDirectory, input.backupDirectory].every(isAbsolute)) throw Error("SERVICE_UPGRADE_PATH_INVALID");
  const dataDirectory = realpathSync(current.dataDirectory), backupDirectory = join(realpathSync(dirname(input.backupDirectory)), basename(input.backupDirectory));
  if (!current.release) throw Error("SERVICE_UPGRADE_LEGACY_DEFINITION_REQUIRES_REVIEW");
  assertControllerReleaseBinding(current.release, current.cliPath, current.nodePath);
  const next = verifyControllerRelease(target), release = bindControllerRelease(next.cliPath, next.nodePath);
  for (const root of [dataDirectory, current.release.directory, release.directory]) if (inside(realpathSync(root), backupDirectory) || inside(backupDirectory, realpathSync(root))) throw Error("SERVICE_UPGRADE_PATH_OVERLAP");
  const previousText = launchdPlist(current), previousHash = assertLaunchAgentDefinition({ ...current, plistPath });
  if (previousHash !== hash(previousText)) throw Error("SERVICE_UPGRADE_LEGACY_DEFINITION_REQUIRES_REVIEW");
  const candidate: LaunchAgentDefinition = { nodePath: next.nodePath, cliPath: next.cliPath, dataDirectory, logDirectory: current.logDirectory, rawStdio: "discard", release };
  const candidateText = launchdPlist(candidate); candidate.definitionSha256 = hash(candidateText); current.definitionSha256 = previousHash;
  const ownership = acquireInstanceLock(dataDirectory);
  try {
    if ((await statusLaunchAgent({ ...current, plistPath, ...(executor?{executor}:{}) })).loaded) throw Error("SERVICE_STOP_REQUIRED");
    assertLaunchAgentDefinition({ ...current, plistPath });
    const source = join(dataDirectory, "dispatcher.sqlite"); assertDatabaseLocationOperational(source);
    const snapshot = copyStableDatabaseSnapshot(source, 2 * 1024 * 1024 * 1024);
    try {
      const database = inspectUpgradeSnapshot(snapshot.path);
      const previous = verifyControllerRelease(current.release.directory);
      if ([previous.manifest.schemaVersion, next.manifest.schemaVersion].some(value => value !== database.schemaVersion) || [previous.manifest.writerProtocol, next.manifest.writerProtocol].some(value => value !== database.writerProtocol)) throw Error("SERVICE_UPGRADE_MIGRATION_NOT_QUALIFIED");
      const fields = { version: 1 as const, scope: "offline-service-upgrade-preparation" as const, plistPath, previous: current, candidate, backupDirectory, database, installedDefinitionChanged: false as const, activationRequired: true as const, restoreReconciliationRequired: true as const };
      const plan: ServiceUpgradePlan = { ...fields, id: hash(JSON.stringify(fields)) };
      if (!execute) return { phase: "preview", plan };
      if (expectedPlanId !== plan.id) throw Error("SERVICE_UPGRADE_PLAN_CHANGED");
      const manifest = await createDispatcherBackup(snapshot.path, backupDirectory);
      durableFile(join(backupDirectory, "service-upgrade-preparing.json"), JSON.stringify({ version: 1, planId: plan.id }));
      // Exercise restore into only a newly created private target. Both barriers remain.
      const validation = join(backupDirectory, ".restore-validation");
      const restored = restoreDispatcherBackup(backupDirectory, validation, { execute: true, confirmed: true });
      if (!restored.applied || !restored.reconciliationRequired || !existsSync(join(validation, "dispatcher.sqlite.restore-pending")) || !inspectDispatcherDatabase(join(validation, "dispatcher.sqlite")).reconciliationRequired) throw Error("SERVICE_UPGRADE_RESTORE_UNVERIFIED");
      rmSync(validation, { recursive: true });
      assertControllerReleaseBinding(current.release, current.cliPath, current.nodePath); assertControllerReleaseBinding(release, candidate.cliPath, candidate.nodePath); assertLaunchAgentDefinition({ ...current, plistPath });
      // A non-cooperating old writer may ignore the directory lock; detect its changes.
      const recheck = copyStableDatabaseSnapshot(source, 2 * 1024 * 1024 * 1024);
      try { if (JSON.stringify(inspectUpgradeSnapshot(recheck.path)) !== JSON.stringify(database)) throw Error("SERVICE_UPGRADE_DATA_CHANGED"); } finally { recheck.close(); }
      durableFile(join(backupDirectory, "previous.plist"), previousText); durableFile(join(backupDirectory, "candidate.plist"), candidateText);
      durableFile(join(backupDirectory, "service-upgrade.json"), JSON.stringify({ version: 1, state: "PREPARED", plan, manifest, capturedAt: new Date().toISOString(), installedDefinitionChanged: false, activationRequired: true, restoreValidated: true, restoreReconciliationRequired: true, secretStoreIncluded: false, nativeStorageIncluded: false }, null, 2));
      unlinkSync(join(backupDirectory, "service-upgrade-preparing.json"));
      return { phase: "prepared", plan };
    } finally { snapshot.close(); }
  } finally { ownership.release(); }
}
