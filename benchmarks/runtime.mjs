import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bindControllerRelease, verifyControllerRelease } from "../apps/controller/dist/release-manifest.js";

const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
export function captureHarnessIdentity() {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }), status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
  return { sourceSha: revision.status === 0 ? revision.stdout.trim() : null, sourceDirty: status.status === 0 ? status.stdout.length > 0 : null,
    scriptSha256: hash(new URL("./run.mjs", import.meta.url)), measurementSha256: hash(new URL("./measurement.mjs", import.meta.url)), runtimeSelectorSha256: hash(new URL("./runtime.mjs", import.meta.url)),historyWorkloadSha256:hash(new URL("./history.mjs",import.meta.url)) };
}

/** Capture before spawn; the harness checkout never stands in for a loaded release. */
export function captureBenchmarkRuntime({ releaseDirectory, controllerPath, harness }) {
  let binding, verified;
  if (releaseDirectory) {
    verified = verifyControllerRelease(releaseDirectory);
    binding = bindControllerRelease(verified.cliPath, realpathSync(process.execPath));
  }
  const cliPath = verified?.cliPath ?? controllerPath, entryHash = hash(cliPath), manifestHash = binding ? hash(join(binding.directory, "release.json")) : undefined;
  const environment = {
    runtimeKind: binding ? "qualified-release" : "development", sourceSha: verified?.manifest.sourceSha ?? harness.sourceSha, sourceDirty: binding ? false : harness.sourceDirty,
    harnessSourceSha: harness.sourceSha, harnessSourceDirty: harness.sourceDirty, harnessScriptSha256: harness.scriptSha256, measurementScriptSha256: harness.measurementSha256, runtimeSelectorSha256: harness.runtimeSelectorSha256,
    historyWorkloadSha256:harness.historyWorkloadSha256,
    controllerEntrypointSha256: entryHash, ...(binding ? { releaseDirectory: binding.directory, releaseManifestSha256: manifestHash, smokeScope: verified.manifest.smokeScope } : {}),
  };
  return { cliPath, environment, childEnvironment: binding ? { DISPATCHER_RELEASE_DIRECTORY: binding.directory, DISPATCHER_RELEASE_SHA: binding.sourceSha } : {},
    recheck() {
      try {
        if (binding) {
          const current = verifyControllerRelease(binding.directory);
          if (current.manifest.sourceSha !== binding.sourceSha || current.cliPath !== cliPath || hash(join(binding.directory, "release.json")) !== manifestHash) throw Error("RELEASE_BINDING_CHANGED");
        }
        if (hash(cliPath) !== entryHash) throw Error("BENCHMARK_ENTRYPOINT_CHANGED");
        return { qualified: Boolean(binding), state: binding ? "verified" : "unqualified" };
      } catch (error) { return { qualified: false, state: "changed", reasonCode: /^(?:RELEASE|BENCHMARK)_[A-Z_]+$/.test(error.message) ? error.message : "BENCHMARK_RUNTIME_CHANGED" }; }
    },
  };
}
