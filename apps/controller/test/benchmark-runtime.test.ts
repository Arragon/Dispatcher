import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createControllerReleaseManifest } from "../src/release-manifest.js";
import { captureBenchmarkRuntime } from "../../../benchmarks/runtime.mjs";

const roots: string[] = []; const root = () => { const value = realpathSync(mkdtempSync(join(tmpdir(), "benchmark-runtime-"))); roots.push(value); return value; };
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
function release() {
  const directory = root(), runtime = join(directory, "runtime"), cli = join(runtime, "dist", "cli.js");
  mkdirSync(join(runtime, "dist"), { recursive: true }); writeFileSync(join(runtime, "package.json"), '{"name":"@dispatcher/controller"}'); writeFileSync(cli, "export {};\n");
  writeFileSync(join(directory, "release.json"), JSON.stringify(createControllerReleaseManifest(runtime, { sourceSha: "a".repeat(40), nodePath: realpathSync(process.execPath), nodeVersion: process.versions.node, pnpmVersion: "11.19.0", lockSha256: "b".repeat(64), deployedLockSha256: "c".repeat(64), platform: process.platform, architecture: process.arch, schemaVersion: 8, writerProtocol: 4, releaseAdmissionVersion: 1 })));
  return { directory, cli };
}
it("captures immutable runtime source before execution independently of later harness Git changes", () => {
  const f = release(), harness = { sourceSha: "d".repeat(40), sourceDirty: false }, captured = captureBenchmarkRuntime({ releaseDirectory: f.directory, harness });
  harness.sourceSha = "e".repeat(40);
  expect(captured.environment).toMatchObject({ sourceSha: "a".repeat(40), harnessSourceSha: "d".repeat(40), runtimeKind: "qualified-release", sourceDirty: false });
  expect(captured.childEnvironment).toMatchObject({ DISPATCHER_RELEASE_DIRECTORY: f.directory, DISPATCHER_RELEASE_SHA: "a".repeat(40) });
  expect(captured.recheck()).toEqual({ qualified: true, state: "verified" });
  writeFileSync(f.cli, "export const changed=true;\n"); expect(captured.recheck()).toMatchObject({ qualified: false, state: "changed", reasonCode: "RELEASE_CONTENT_CHANGED" });
});
it("never qualifies an unpackaged development entrypoint even if its bytes stay unchanged", () => {
  const cli = join(root(), "cli.js"); writeFileSync(cli, "export {};\n");
  const captured = captureBenchmarkRuntime({ controllerPath: cli, harness: { sourceSha: "a".repeat(40), sourceDirty: false } });
  expect(captured.environment.runtimeKind).toBe("development"); expect(captured.childEnvironment).toEqual({}); expect(captured.recheck()).toMatchObject({ qualified: false, state: "unqualified" });
});
