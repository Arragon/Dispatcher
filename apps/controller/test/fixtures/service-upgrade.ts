import {mkdirSync,mkdtempSync,realpathSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";import {join} from "node:path";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {createControllerReleaseManifest} from "../../src/release-manifest.js";
import {launchdPlist,LaunchctlError} from "../../src/launchd.js";
export function upgradeFixture(roots: string[]) {
  // Runtime admission rejects OS temporary paths; own a private persistent test tree.
  const parent = join(homedir(), ".local", "share", "dispatcher", "test-fixtures"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = realpathSync(mkdtempSync(join(parent, "upgrade-"))); roots.push(root);
  const release = (name: string, sha: string) => { const directory = join(root, name), runtime = join(directory, "runtime"); mkdirSync(join(runtime, "dist"), { recursive: true }); writeFileSync(join(runtime, "package.json"), '{"name":"@dispatcher/controller"}'); writeFileSync(join(runtime, "dist", "cli.js"), "export {};\n"); writeFileSync(join(directory, "release.json"), JSON.stringify(createControllerReleaseManifest(runtime, { sourceSha: sha.repeat(40), nodePath: realpathSync(process.execPath), nodeVersion: process.versions.node, pnpmVersion: "11.19.0", lockSha256: "c".repeat(64), deployedLockSha256: "d".repeat(64), platform: process.platform, architecture: process.arch, schemaVersion: 10, writerProtocol: 6, releaseAdmissionVersion: 1 }))); return directory; };
  const previous = release("previous", "a"), targetReleaseDirectory = release("next", "b"), dataDirectory = join(root, "data"); mkdirSync(dataDirectory);
  const path = join(dataDirectory, "dispatcher.sqlite"), db = new DispatcherDatabase(path); db.checkpoint(); db.close();
  const current = { nodePath: realpathSync(process.execPath), cliPath: join(previous, "runtime", "dist", "cli.js"), dataDirectory, logDirectory: join(root, "logs"), release: { directory: previous, sourceSha: "a".repeat(40) } }, plistPath = join(root, "controller.plist"); writeFileSync(plistPath, launchdPlist(current), { mode: 0o600 });
  const calls: string[][] = [], executor = async (args: string[]) => { calls.push(args); if (args[0] === "print") throw new LaunchctlError("print", 113); throw Error("UNEXPECTED_SUPERVISOR_MUTATION"); };
  return { input: { current, plistPath, targetReleaseDirectory, backupDirectory: join(root, "backup"), executor }, path, calls };
}
