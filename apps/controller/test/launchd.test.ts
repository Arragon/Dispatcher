import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installLaunchAgent, launchdPlist } from "../src/launchd.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("launchd prototype", () => {
  it("generates a throttled Embedded Runner service without a crash loop", () => {
    const plist = launchdPlist({ nodePath: "/usr/local/bin/node", cliPath: "/opt/dispatcher/cli.js", dataDirectory: "/tmp/data", logDirectory: "/tmp/logs" });
    expect(plist).toContain("--with-runner");
    expect(plist).toContain("ThrottleInterval");
    expect(plist).toContain("<key>KeepAlive</key><false/>");
  });

  it("writes the fixture and bootstraps the exact plist", async () => {
    const root = mkdtempSync(join(tmpdir(), "dispatcher-launchd-"));
    directories.push(root);
    const plistPath = join(root, "LaunchAgents", "dispatcher.plist");
    const executor = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await installLaunchAgent({
      plistPath,
      nodePath: "/usr/local/bin/node",
      cliPath: "/opt/dispatcher/cli.js",
      dataDirectory: join(root, "data"),
      logDirectory: join(root, "logs"),
      executor,
    });
    expect(readFileSync(plistPath, "utf8")).toContain("dev.dispatcher.controller");
    expect(executor).toHaveBeenCalledOnce();
  });
});
