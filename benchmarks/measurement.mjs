import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

export function parseProcessSample(output, observedAtMs) {
  const match = /^\s*([1-9]\d*)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2})(?:\.(\d{1,6}))?\s*$/.exec(output);
  if (!match || !Number.isFinite(observedAtMs)) throw new Error("PROCESS_SAMPLE_INVALID");
  const [, rss, days, hours, minutes, seconds, fraction] = match;
  if (Number(seconds) >= 60 || (hours !== undefined && Number(minutes) >= 60) || (days !== undefined && (hours === undefined || Number(hours) >= 24))) throw new Error("PROCESS_SAMPLE_INVALID");
  const rssBytes = Number(rss) * 1024;
  const cpuSeconds = Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction ?? "0"}`);
  if (!Number.isSafeInteger(rssBytes) || !Number.isFinite(cpuSeconds)) throw new Error("PROCESS_SAMPLE_INVALID");
  return { rssBytes, cpuSeconds, observedAtMs };
}

export function sampleProcess(pid, { run = spawnSync, now = () => performance.now() } = {}) {
  const result = run("ps", ["-o", "rss=,time=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") throw new Error("PROCESS_SAMPLE_UNAVAILABLE");
  return parseProcessSample(result.stdout, now());
}

export function summarizeSamples(samples) {
  if (samples.length < 2) throw new Error("PROCESS_SAMPLES_INSUFFICIENT");
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index], previous = samples[index - 1];
    if (!Number.isFinite(sample.observedAtMs) || !Number.isFinite(sample.cpuSeconds) || sample.cpuSeconds < 0 || !Number.isSafeInteger(sample.rssBytes) || sample.rssBytes <= 0 || (previous && (sample.observedAtMs <= previous.observedAtMs || sample.cpuSeconds < previous.cpuSeconds))) throw new Error("PROCESS_CLOCK_INVALID");
  }
  const first = samples[0], last = samples.at(-1), measuredSeconds = (last.observedAtMs - first.observedAtMs) / 1000;
  return { sampleCount: samples.length, measuredSeconds, cpuAveragePercent: (last.cpuSeconds - first.cpuSeconds) / measuredSeconds * 100, rssMaximumBytes: Math.max(...samples.map(sample => sample.rssBytes)) };
}

export function assessBenchmark(scenario, measurements) {
  if (["one-run", "three-runs"].includes(scenario)) return "not-runnable";
  if (scenario === "dashboard-open" && measurements.dashboardClients !== 1) return "fail";
  if (!["idle", "dashboard-open"].includes(scenario) || measurements.measuredSeconds < 600) return "informational";
  return measurements.cpuAveragePercent < 1 && measurements.rssMaximumBytes < 250 * 1024 * 1024 ? "pass" : "fail";
}

export function measureStorage(dataDirectory, logDirectory) {
  const bytes = (path, optional = true) => {
    try { const stat = lstatSync(path); if (!stat.isFile()) throw new Error("STORAGE_SAMPLE_INVALID"); return stat.size; }
    catch (error) { if (optional && error.code === "ENOENT") return 0; throw error; }
  };
  const databaseMainBytes = bytes(join(dataDirectory, "dispatcher.sqlite"), false), databaseWalBytes = bytes(join(dataDirectory, "dispatcher.sqlite-wal")), databaseShmBytes = bytes(join(dataDirectory, "dispatcher.sqlite-shm"));
  let logBytes = 0;
  try { for (const name of readdirSync(logDirectory)) logBytes += bytes(join(logDirectory, name)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return { databaseMainBytes, databaseWalBytes, databaseShmBytes, databaseBytes: databaseMainBytes + databaseWalBytes + databaseShmBytes, logBytes };
}

/** Register immediately after spawn. A sent signal alone never authorizes cleanup. */
export function trackOwnedProcess(child) {
  let outcome;
  const closed = new Promise(resolve => child.once("close", (exitCode, signal) => { outcome = { confirmed: true, exitCode, signal }; resolve(outcome); }));
  child.on("error", () => undefined); // Close remains the physical ownership boundary.
  return { async stop({ timeoutMs = 60000 } = {}) {
    if (outcome) return outcome;
    if (child.exitCode === null && child.signalCode === null) try { child.kill("SIGTERM"); } catch { /* Unconfirmed ownership remains retained below. */ }
    let timer;
    try { return await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => resolve({ confirmed: false, reason: "PROCESS_CLOSE_UNCONFIRMED" }), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  } };
}
