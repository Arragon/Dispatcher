import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DarwinPlatformAdapter,
  LinuxPlatformAdapter,
  NativeCredentialStoreAdapter,
  ProcessManager,
  processTreeKillCommand,
  WindowsPlatformAdapter,
  canonicalizeRunnerPath,
  createPlatformAdapter,
} from "../src/index.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const serviceOptions = {
  runnerId: "build-01",
  nodePath: "/runtime/node",
  cliPath: "/app/runner.js",
  dataDirectory: "/var/lib/dispatcher",
  controllerUrl: "wss://controller.example/runner",
  credentialRef: "secret://runner/dispatcher/build-01",
};

describe("PlatformAdapter contract", () => {
  it("generates native install/start/status/doctor prerequisites without embedding secret values", () => {
    const adapters = [new DarwinPlatformAdapter("arm64"), new WindowsPlatformAdapter("x64"), new LinuxPlatformAdapter("x64")];
    for (const adapter of adapters) {
      const install = adapter.service("install", serviceOptions);
      const status = adapter.service("status", serviceOptions);
      const serialized = JSON.stringify({ install, status });
      expect(install.commands.length).toBeGreaterThan(0);
      expect(status.commands).toHaveLength(1);
      expect(adapter.capabilities()).toEqual(expect.arrayContaining([`os:${adapter.platform}`, `arch:${adapter.architecture}`, `pty:${adapter.ptyBackend}`, "resource-stats"]));
      expect(serialized).toContain("secret://runner/dispatcher/build-01");
      expect(serialized).not.toContain("Bearer ");
    }
  });

  it("keeps platform-native service definitions within the runner boundary", () => {
    expect(new DarwinPlatformAdapter("arm64").service("install", serviceOptions).files[0]?.content).toContain("dev.dispatcher.runner.build-01");
    expect(new LinuxPlatformAdapter("x64").service("install", serviceOptions).files[0]?.content).toContain("WantedBy=default.target");
    expect(new WindowsPlatformAdapter("x64").service("install", serviceOptions).commands[0]).toMatchObject({ file: "sc.exe", args: expect.arrayContaining(["create"]) });
  });

  it("upgrades service definitions without changing runner identity", () => {
    for (const adapter of [new DarwinPlatformAdapter("arm64"), new WindowsPlatformAdapter("x64"), new LinuxPlatformAdapter("x64")]) {
      const upgrade = JSON.stringify(adapter.service("upgrade", serviceOptions));
      expect(upgrade).toContain("build-01");
      expect(upgrade).toContain("/app/runner.js");
    }
  });

  it("canonicalizes Windows and Unix paths without host-platform branches", () => {
    expect(canonicalizeRunnerPath("..\\repo\\src", "win32", "C:\\work\\task")).toBe("C:\\work\\repo\\src");
    expect(canonicalizeRunnerPath("../repo/src", "linux", "/work/task")).toBe("/work/repo/src");
    expect(() => canonicalizeRunnerPath("bad\0path", "darwin", "/work")).toThrow("null byte");
  });

  it("maps native credential stores without putting a resolved credential in arguments", async () => {
    const execute = vi.fn(async () => ({ stdout: "runtime-secret\n" }));
    const store = new NativeCredentialStoreAdapter("darwin", execute);
    await expect(store.resolve("secret://runner/dispatcher/build-01")).resolves.toBe("runtime-secret");
    expect(execute).toHaveBeenCalledWith("/usr/bin/security", ["find-generic-password", "-s", "dispatcher", "-a", "build-01", "-w"]);
  });

  it("writes enrollment credentials through stdin rather than argv", async () => {
    const execute = vi.fn(async () => ({ stdout: "" }));
    const store = new NativeCredentialStoreAdapter("darwin", execute);
    await store.put("secret://runner/dispatcher/build-01", "one-time-runtime-secret");
    expect(execute).toHaveBeenCalledWith("/usr/bin/security", ["add-generic-password", "-U", "-s", "dispatcher", "-a", "build-01", "-w"], "one-time-runtime-secret");
    expect(JSON.stringify(execute.mock.calls[0]?.[1])).not.toContain("one-time-runtime-secret");
  });

  it("captures bounded host resource stats", () => {
    const stats = createPlatformAdapter().resourceStats();
    expect(stats.processRssBytes).toBeGreaterThan(0);
    expect(stats.systemTotalBytes).toBeGreaterThanOrEqual(stats.systemFreeBytes);
    expect(stats.loadAverage).toHaveLength(3);
  });

  it("uses Windows taskkill tree fencing without shell command strings", () => {
    expect(processTreeKillCommand(42, "win32", true)).toEqual({ file: "taskkill.exe", args: ["/PID", "42", "/T", "/F"] });
    expect(processTreeKillCommand(42, "linux")).toBeUndefined();
  });
});

describe("native PTY smoke", () => {
  it("runs a command through Unix PTY on the current macOS host", async () => {
    if (process.platform !== "darwin") return;
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-pty-smoke-"));
    directories.push(directory);
    const manager = new ProcessManager(directory);
    const handle = await manager.start({ runId: "pty-smoke", file: "/bin/sh", args: ["-lc", "printf pty-ok"], cwd: directory, mode: "pty", timeoutMs: 5_000 });
    const result = await handle.result();
    expect(result).toMatchObject({ classification: "success", exitCode: 0 });
    expect(result.stdoutTail).toContain("pty-ok");
  });
});
