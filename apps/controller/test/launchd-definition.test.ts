import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchdPlist, LaunchctlError, readLaunchAgent, startLaunchAgent } from "../src/launchd.js";

const roots: string[] = []; afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "launchd-definition-")); roots.push(root); return { plistPath: join(root, "controller.plist"), nodePath: "/usr/local/bin/node", cliPath: "/opt/dispatcher/cli.js", dataDirectory: join(root, "data"), logDirectory: join(root, "logs") }; }
it("rejects observed definition drift after enable before launchctl can bootstrap it", async () => {
  const input = fixture(), original = launchdPlist(input); writeFileSync(input.plistPath, original, { mode: 0o600 });
  const executor = vi.fn(async (args: string[]) => { if (args[0] === "print") throw new LaunchctlError("print", 113); if (args[0] === "enable") writeFileSync(input.plistPath, original.replace(input.cliPath, "/opt/other/cli.js")); return { stdout: "", stderr: "" }; });
  await expect(startLaunchAgent({ ...input, executor })).rejects.toThrow("SERVICE_DEFINITION_CHANGED");
  expect(executor.mock.calls.map(([args]) => args[0])).toEqual(["print", "enable"]);
  expect(readFileSync(input.plistPath, "utf8")).toContain("/opt/other/cli.js");
});
it("captures a real definition hash and rejects changes after parsing", async () => {
  const input = fixture(), value = { Label: "dev.dispatcher.controller", ProgramArguments: [input.nodePath, input.cliPath, "serve", "--with-runner", "--data-dir", input.dataDirectory], StandardOutPath: join(input.logDirectory, "controller.log"), StandardErrorPath: join(input.logDirectory, "controller.error.log") };
  writeFileSync(input.plistPath, "owned plist bytes", { mode: 0o600 });
  const parsed = await readLaunchAgent(input.plistPath, async () => JSON.stringify(value));
  expect(parsed).toHaveProperty("definitionSha256", expect.stringMatching(/^[a-f0-9]{64}$/));
  writeFileSync(input.plistPath, "changed plist bytes"); const executor = vi.fn();
  await expect(startLaunchAgent({ ...parsed, plistPath: input.plistPath, executor })).rejects.toThrow("SERVICE_DEFINITION_CHANGED"); expect(executor).not.toHaveBeenCalled();
});
it("rejects a linked definition before invoking its decoder", async () => {
  const input = fixture(), target = join(roots.at(-1)!, "preserved"); writeFileSync(target, "private fixture", { mode: 0o600 }); symlinkSync(target, input.plistPath);
  const read = vi.fn(async () => "{}"); await expect(readLaunchAgent(input.plistPath, read)).rejects.toThrow("SERVICE_DEFINITION_INVALID"); expect(read).not.toHaveBeenCalled(); expect(readFileSync(target, "utf8")).toBe("private fixture");
});
