import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DispatcherDatabase, inspectDispatcherDatabase } from "@dispatcher/persistence";
import { createControllerReleaseManifest } from "../src/release-manifest.js";
import { launchdPlist, LaunchctlError } from "../src/launchd.js";
import { prepareServiceUpgrade } from "../src/service-upgrade.js";

const roots: string[] = []; const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
function fixture() {
  // Runtime admission rejects OS temporary paths; own a private persistent test tree.
  const parent = join(homedir(), ".local", "share", "dispatcher", "test-fixtures"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = realpathSync(mkdtempSync(join(parent, "upgrade-"))); roots.push(root);
  const release = (name: string, sha: string) => { const directory = join(root, name), runtime = join(directory, "runtime"); mkdirSync(join(runtime, "dist"), { recursive: true }); writeFileSync(join(runtime, "package.json"), '{"name":"@dispatcher/controller"}'); writeFileSync(join(runtime, "dist", "cli.js"), "export {};\n"); writeFileSync(join(directory, "release.json"), JSON.stringify(createControllerReleaseManifest(runtime, { sourceSha: sha.repeat(40), nodePath: realpathSync(process.execPath), nodeVersion: process.versions.node, pnpmVersion: "11.19.0", lockSha256: "c".repeat(64), deployedLockSha256: "d".repeat(64), platform: process.platform, architecture: process.arch, schemaVersion: 8, writerProtocol: 4, releaseAdmissionVersion: 1 }))); return directory; };
  const previous = release("previous", "a"), targetReleaseDirectory = release("next", "b"), dataDirectory = join(root, "data"); mkdirSync(dataDirectory);
  const path = join(dataDirectory, "dispatcher.sqlite"), db = new DispatcherDatabase(path); db.checkpoint(); db.close();
  const current = { nodePath: realpathSync(process.execPath), cliPath: join(previous, "runtime", "dist", "cli.js"), dataDirectory, logDirectory: join(root, "logs"), release: { directory: previous, sourceSha: "a".repeat(40) } }, plistPath = join(root, "controller.plist"); writeFileSync(plistPath, launchdPlist(current), { mode: 0o600 });
  const calls: string[][] = [], executor = async (args: string[]) => { calls.push(args); if (args[0] === "print") throw new LaunchctlError("print", 113); throw Error("UNEXPECTED_SUPERVISOR_MUTATION"); };
  return { input: { current, plistPath, targetReleaseDirectory, backupDirectory: join(root, "backup"), executor }, path, calls };
}
it("prepares a recoverable compatible DB backup and candidate definition without switching or starting", async () => {
  const f = fixture(), before = hash(f.path), definitionBefore = hash(f.input.plistPath);
  const preview = await prepareServiceUpgrade(f.input); expect(preview.phase).toBe("preview"); expect(existsSync(f.input.backupDirectory)).toBe(false);
  const result = await prepareServiceUpgrade({ ...f.input, execute: true, confirmed: true, expectedPlanId: preview.plan.id }); expect(result.phase).toBe("prepared");
  expect(hash(f.path)).toBe(before); expect(hash(f.input.plistPath)).toBe(definitionBefore); expect(f.calls.every(args => args[0] === "print")).toBe(true);
  expect(JSON.parse(readFileSync(join(f.input.backupDirectory, "service-upgrade.json"), "utf8"))).toMatchObject({ state: "PREPARED", installedDefinitionChanged: false, nativeStorageIncluded: false, secretStoreIncluded: false, restoreValidated: true });
  expect(readFileSync(join(f.input.backupDirectory, "candidate.plist"), "utf8")).toContain(f.input.targetReleaseDirectory);
  expect(inspectDispatcherDatabase(join(f.input.backupDirectory, "dispatcher.sqlite"))).toMatchObject({ schemaVersion: 8, integrity: true });
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
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_UPGRADE_MIGRATION_NOT_QUALIFIED"); metadata.schemaVersion = 8; writeFileSync(path, JSON.stringify(metadata));
  writeFileSync(f.input.plistPath, launchdPlist(f.input.current).replace("<dict>", "<dict><!-- custom -->"));
  await expect(prepareServiceUpgrade(f.input)).rejects.toThrow("SERVICE_DEFINITION_CHANGED"); expect(existsSync(f.input.backupDirectory)).toBe(false);
});
