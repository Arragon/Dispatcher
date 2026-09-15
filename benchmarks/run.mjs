import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
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
if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new Error("Duration must be a non-negative number");

const port = 18_000 + Math.floor(Math.random() * 1_000);
const temporary = mkdtempSync(join(tmpdir(), "dispatcher-benchmark-"));
const dataDirectory = join(temporary, "data");
const controller = resolve("apps/controller/dist/cli.js");
const startedAt = new Date().toISOString();
const limitations = [];
let assessment = "informational";
let child;
let eventRequest;
let eventResponse;

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
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
    eventRequest = get(`http://127.0.0.1:${port}/api/events`, (response) => {
      eventResponse = response;
      if (response.statusCode !== 200) {
        response.resume();
        rejectOpen(new Error(`Dashboard event stream returned ${response.statusCode ?? "unknown"}`));
        return;
      }
      response.once("data", resolveOpen);
      response.on("data", () => undefined);
    });
    eventRequest.once("error", rejectOpen);
  });
}

function sampleProcess(pid) {
  const result = spawnSync("ps", ["-o", "rss=,%cpu=", "-p", String(pid)], { encoding: "utf8" });
  const [rss, cpu] = result.stdout.trim().split(/\s+/).map(Number);
  return { rssBytes: (rss || 0) * 1024, cpuPercent: cpu || 0 };
}

try {
  child = spawn(process.execPath, [controller, "serve", "--with-runner", "--port", String(port), "--data-dir", dataDirectory], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let startupError = "";
  child.stderr.on("data", (chunk) => (startupError += chunk.toString()));
  await waitForHealth();

  if (scenario === "dashboard-open") {
    await openDashboardEventStream();
  }
  if (scenario === "one-run" || scenario === "three-runs") {
    assessment = "not-runnable";
    limitations.push("Real Agent Run scenarios require the M4 Generic Execution Harness; M0 records this gate without fabricating run load.");
  }
  if (scenario === "log-growth") {
    for (let index = 0; index < 100; index += 1) await fetch(`http://127.0.0.1:${port}/health`);
  }
  if (scenario === "db-growth") {
    for (let index = 0; index < 20; index += 1) await fetch(`http://127.0.0.1:${port}/api/runners`);
    limitations.push("M0/M1 database-growth measures stable metadata reads; representative Run history begins with M4.");
  }

  const samples = [];
  const deadline = Date.now() + durationSeconds * 1_000;
  do {
    samples.push(sampleProcess(child.pid));
    await delay(Math.min(1_000, Math.max(10, deadline - Date.now())));
  } while (Date.now() < deadline);
  const impact = await (await fetch(`http://127.0.0.1:${port}/api/system-impact`)).json();
  const cpuAverage = samples.reduce((sum, value) => sum + value.cpuPercent, 0) / samples.length;
  const rssMaximum = Math.max(...samples.map((value) => value.rssBytes));
  if (assessment !== "not-runnable" && scenario !== "smoke") {
    assessment = cpuAverage < 1 && rssMaximum < 250 * 1024 * 1024 ? "pass" : "fail";
  }
  if (scenario === "dashboard-open" && impact.dashboardClients !== 1) {
    assessment = "fail";
    limitations.push(`Dashboard event stream was not held open: expected 1 client, measured ${impact.dashboardClients}.`);
  }
  const databasePath = join(dataDirectory, "dispatcher.sqlite");
  const report = {
    schemaVersion: 1,
    scenario,
    startedAt,
    durationSeconds,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      pid: child.pid,
    },
    measurements: {
      sampleCount: samples.length,
      cpuAveragePercent: Number(cpuAverage.toFixed(3)),
      rssMaximumBytes: rssMaximum,
      controllerReportedRssBytes: impact.rssBytes,
      databaseBytes: statSync(databasePath).size,
      dashboardClients: impact.dashboardClients,
    },
    targets: { idleCpuPercentBelow: 1, rssBytesBelow: 250 * 1024 * 1024 },
    assessment,
    limitations,
  };
  const outputDirectory = resolve(".dispatcher", "benchmarks");
  if (!validateReport(report)) throw new Error(`Invalid benchmark report: ${JSON.stringify(validateReport.errors)}`);
  mkdirSync(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `${startedAt.replaceAll(":", "-")}-${scenario}.json`);
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: output, assessment, measurements: report.measurements }, null, 2));
  if (assessment === "fail") process.exitCode = 1;
  if (startupError && child.exitCode !== null && child.exitCode !== 0) throw new Error("Controller benchmark process failed");
} finally {
  eventResponse?.destroy();
  eventRequest?.destroy();
  if (child && child.exitCode === null) child.kill("SIGTERM");
  await delay(100);
  rmSync(temporary, { recursive: true, force: true });
}
