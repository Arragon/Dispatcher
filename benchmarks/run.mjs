import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { get } from "node:http";
import { performance } from "node:perf_hooks";
import { assessBenchmark, measureStorage, sampleProcess, summarizeSamples, trackOwnedProcess } from "./measurement.mjs";
import { captureBenchmarkRuntime, captureHarnessIdentity } from "./runtime.mjs";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module.Ajv2020 ?? Ajv2020Module;
const reportSchema = JSON.parse(readFileSync(new URL("./report.schema.json", import.meta.url), "utf8"));
const validateReport = new Ajv2020({ strict: false, validateFormats: false }).compile(reportSchema);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const scenario = option("--scenario", "idle");
const durationSeconds = Number(option("--duration", scenario === "idle" ? "600" : "5"));
const supported = new Set(["smoke", "idle", "dashboard-open", "one-run", "three-runs", "log-growth", "db-growth"]);
if (!supported.has(scenario)) throw new Error(`Unknown benchmark scenario: ${scenario}`);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Duration must be a positive number");
const runtime = captureBenchmarkRuntime({ releaseDirectory: option("--release-dir"), controllerPath: resolve("apps/controller/dist/cli.js"), harness: captureHarnessIdentity() });

const port = 18_000 + Math.floor(Math.random() * 1_000);
const temporary = mkdtempSync(join(tmpdir(), "dispatcher-benchmark-"));
const dataDirectory = join(temporary, "data");
const logDirectory = join(dataDirectory, "logs");
const controller = runtime.cliPath;
const ownerToken = randomBytes(32).toString("base64url");
const authorization = { authorization: `Bearer ${ownerToken}` };
const startedAt = new Date().toISOString();
const limitations = [];
let child;
let owned;
let eventRequest;
let eventResponse;
let startupFailed = false;
let report;
let failure;
let cleanup;

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
async function waitForHealth() {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (startupFailed || child.exitCode !== null || child.signalCode !== null) throw new Error("CONTROLLER_START_FAILED");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, Math.ceil(deadline - performance.now())))) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // The Controller may still be starting; retry until the bounded deadline.
    }
    await delay(50);
  }
  throw new Error("Controller did not become healthy");
}

async function openDashboardEventStream() {
  await new Promise((resolveOpen, rejectOpen) => {
    eventRequest = get(`http://127.0.0.1:${port}/api/events`, { headers: authorization }, (response) => {
      eventResponse = response;
      if (response.statusCode !== 200) {
        response.resume();
        rejectOpen(new Error(`Dashboard event stream returned ${response.statusCode ?? "unknown"}`));
        return;
      }
      response.once("data", () => { eventRequest.setTimeout(0); resolveOpen(); });
      response.on("data", () => undefined);
    });
    eventRequest.once("error", rejectOpen);
    eventRequest.setTimeout(2000, () => eventRequest.destroy(new Error("DASHBOARD_STREAM_TIMEOUT")));
  });
}

try {
  const environment = { ...process.env, DISPATCHER_OWNER_TOKEN: ownerToken };
  delete environment.DISPATCHER_RELEASE_DIRECTORY; delete environment.DISPATCHER_RELEASE_SHA;
  Object.assign(environment, runtime.childEnvironment);
  child = spawn(process.execPath, [controller, "serve", "--with-runner", "--port", String(port), "--data-dir", dataDirectory, "--log-dir", logDirectory], {
    env: environment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  owned = trackOwnedProcess(child);
  child.once("error", () => { startupFailed = true; });
  child.stderr.on("data", () => undefined);
  await waitForHealth();
  const storageBefore = measureStorage(dataDirectory, logDirectory);

  if (scenario === "dashboard-open") {
    await openDashboardEventStream();
  }
  if (scenario === "one-run" || scenario === "three-runs") {
    limitations.push("No real Agent workload is configured by this harness; idle measurements do not qualify one-run or three-runs.");
  }
  if (scenario === "log-growth") {
    for (let index = 0; index < 100; index += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer(); if (!response.ok) throw new Error("LOG_WORKLOAD_FAILED");
    }
  }
  if (scenario === "db-growth") {
    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/runners`, { headers: authorization, signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer(); if (!response.ok) throw new Error("METADATA_WORKLOAD_FAILED");
    }
    limitations.push("Database-growth currently issues metadata reads only; no representative historical Run fixture or write workload is generated.");
  }

  const samples = [sampleProcess(child.pid)];
  const deadline = samples[0].observedAtMs + durationSeconds * 1_000;
  while (samples.length < 2 || performance.now() < deadline) {
    await delay(Math.min(1_000, Math.max(1, deadline - performance.now())));
    samples.push(sampleProcess(child.pid));
  }
  const measured = summarizeSamples(samples);
  const impactResponse = await fetch(`http://127.0.0.1:${port}/api/system-impact`, { headers: authorization, signal: AbortSignal.timeout(2000) });
  if (!impactResponse.ok) throw new Error(`System impact endpoint returned ${impactResponse.status}`);
  const impact = await impactResponse.json();
  const runtimeIntegrity = runtime.recheck();
  const assessment = runtimeIntegrity.state === "changed" ? "fail" : assessBenchmark(scenario, { ...measured, dashboardClients: impact.dashboardClients, runtimeQualified: runtimeIntegrity.qualified });
  if (scenario === "dashboard-open" && impact.dashboardClients !== 1) {
    limitations.push(`Dashboard event stream was not held open: expected 1 client, measured ${impact.dashboardClients}.`);
  }
  if (["idle", "dashboard-open"].includes(scenario) && measured.measuredSeconds < 600) limitations.push("Less than the frozen 10-minute baseline; CPU/RSS remain informational.");
  if (!runtimeIntegrity.qualified) limitations.push("Unpackaged or changed runtime: measurements do not qualify a fixed release candidate. Use --release-dir with a qualified staged artifact.");
  limitations.push("Controller process CPU/RSS only; native descendants, event-loop lag, open handles, network, history, synthetic SSE burst and 8-hour soak Gates are not measured here.");
  const storageAfter = measureStorage(dataDirectory, logDirectory);
  report = {
    schemaVersion: 1,
    scenario,
    startedAt,
    durationSeconds,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      kernel: release(),
      cpuModel: cpus()[0]?.model ?? null,
      availableCpus: availableParallelism(),
      node: process.version,
      pid: child.pid,
      ...runtime.environment,
      runtimeIntegrity,
    },
    measurements: {
      ...measured,
      cpuBasis: "process-cumulative-time-delta-over-monotonic-window",
      samples,
      controllerReportedRssBytes: impact.rssBytes,
      ...storageAfter,
      storageBasis: "sqlite-main-wal-shm-and-structured-log-files",
      databaseGrowthBytes: storageAfter.databaseBytes - storageBefore.databaseBytes,
      logGrowthBytes: storageAfter.logBytes - storageBefore.logBytes,
      dashboardClients: impact.dashboardClients,
    },
    targets: { idleCpuPercentBelow: 1, rssBytesBelow: 250 * 1024 * 1024 },
    assessment,
    limitations,
  };
} catch (error) {
  failure = error;
} finally {
  cleanup = owned ? await owned.stop() : { confirmed: !child, exitCode: null };
  eventResponse?.destroy();
  eventRequest?.destroy();
  if (cleanup.confirmed && cleanup.exitCode === 0) rmSync(temporary, { recursive: true, force: true });
  else {
    cleanup.retainedDirectory = temporary;
    child?.unref(); child?.stderr?.destroy();
    console.error(JSON.stringify({ code: "BENCHMARK_PROCESS_OR_GRACEFUL_EXIT_UNCONFIRMED", pid: child?.pid, ...cleanup }));
    process.exitCode = 1;
  }
}
if (failure) throw failure;
report.cleanup = cleanup;
if (!cleanup.confirmed || cleanup.exitCode !== 0) report.assessment = "fail";
const outputDirectory = resolve(".dispatcher", "benchmarks");
if (!validateReport(report)) throw new Error(`Invalid benchmark report: ${JSON.stringify(validateReport.errors)}`);
mkdirSync(outputDirectory, { recursive: true });
const output = join(outputDirectory, `${startedAt.replaceAll(":", "-")}-${scenario}.json`);
writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
const summaryMeasurements = { ...report.measurements };
delete summaryMeasurements.samples;
console.log(JSON.stringify({ report: output, assessment: report.assessment, measurements: summaryMeasurements, cleanup }, null, 2));
if (report.assessment === "fail") process.exitCode = 1;
