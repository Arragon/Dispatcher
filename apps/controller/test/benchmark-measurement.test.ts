import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessBenchmark, parseProcessSample, sampleProcess, summarizeSamples, trackOwnedProcess, measureStorage } from "../../../benchmarks/measurement.mjs";

it("parses macOS and Linux cumulative CPU clocks without substituting missing samples", () => {
  expect(parseProcessSample("12345  1:02.34\n", 100)).toEqual({ rssBytes: 12345 * 1024, cpuSeconds: 62.34, observedAtMs: 100 });
  expect(parseProcessSample("20 1-02:03:04.50", 200).cpuSeconds).toBe(93784.5);
  for (const output of ["", "0 00:00.00", "abc 00:00.00", "20 00:60.00", "20 00:00.00 extra", "20 NaN", "-20 00:00.00"]) expect(() => parseProcessSample(output, 0)).toThrow("PROCESS_SAMPLE_INVALID");
  expect(() => sampleProcess(123, { run: () => ({ status: 1, stdout: "20 00:00.00" }) })).toThrow("PROCESS_SAMPLE_UNAVAILABLE");
});

it("uses CPU counter deltas over the measured monotonic window and rejects incomplete clocks", () => {
  const samples = [{ rssBytes: 100, cpuSeconds: 100, observedAtMs: 1000 }, { rssBytes: 150, cpuSeconds: 100.01, observedAtMs: 2000 }, { rssBytes: 120, cpuSeconds: 100.03, observedAtMs: 11000 }];
  expect(summarizeSamples(samples)).toMatchObject({ sampleCount: 3, measuredSeconds: 10, cpuAveragePercent: expect.closeTo(0.3), rssMaximumBytes: 150 });
  expect(() => summarizeSamples(samples.slice(0, 1))).toThrow("PROCESS_SAMPLES_INSUFFICIENT");
  expect(() => summarizeSamples([samples[1], samples[0]])).toThrow("PROCESS_CLOCK_INVALID");
  expect(() => summarizeSamples([samples[0], { ...samples[1], cpuSeconds: 99 }])).toThrow("PROCESS_CLOCK_INVALID");
});

it("keeps short idle and metadata-only workloads informational and real Run load unqualified", () => {
  const healthy = { measuredSeconds: 600, cpuAveragePercent: 0.1, rssMaximumBytes: 100_000_000, dashboardClients: 1, runtimeQualified: true };
  expect(assessBenchmark("idle", healthy)).toBe("pass");
  expect(assessBenchmark("idle", { ...healthy, measuredSeconds: 5 })).toBe("informational");
  expect(assessBenchmark("idle", { ...healthy, runtimeQualified: false })).toBe("informational");
  expect(assessBenchmark("idle", { ...healthy, cpuAveragePercent: 1 })).toBe("fail");
  expect(assessBenchmark("dashboard-open", { ...healthy, dashboardClients: 0 })).toBe("fail");
  expect(assessBenchmark("smoke", healthy)).toBe("informational");
  expect(assessBenchmark("db-growth", healthy)).toBe("informational");
  expect(assessBenchmark("one-run", healthy)).toBe("not-runnable");
});

it("includes WAL/SHM in database storage and keeps log bytes separate", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-storage-"));
  try {
    expect(() => measureStorage(root, join(root, "logs"))).toThrow();
    writeFileSync(join(root, "dispatcher.sqlite"), "1234"); writeFileSync(join(root, "dispatcher.sqlite-wal"), "123456"); writeFileSync(join(root, "dispatcher.sqlite-shm"), "12");
    expect(measureStorage(root, join(root, "logs"))).toMatchObject({ databaseMainBytes: 4, databaseWalBytes: 6, databaseShmBytes: 2, databaseBytes: 12, logBytes: 0 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("waits for physical child close after TERM and keeps an unresponsive child unconfirmed", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150)); console.log('ready'); setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "ignore"] });
  const owned = trackOwnedProcess(child); await once(child.stdout!, "data");
  const before = Date.now(); expect(await owned.stop({ timeoutMs: 2000 })).toMatchObject({ confirmed: true, exitCode: 0 }); expect(Date.now() - before).toBeGreaterThanOrEqual(100);
  const blocked = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "ignore"] });
  const ownedBlocked = trackOwnedProcess(blocked); await once(blocked.stdout!, "data");
  try { expect(await ownedBlocked.stop({ timeoutMs: 30 })).toEqual({ confirmed: false, reason: "PROCESS_CLOSE_UNCONFIRMED" }); expect(blocked.exitCode).toBe(null); }
  finally { blocked.kill("SIGKILL"); await once(blocked, "close"); }
});
