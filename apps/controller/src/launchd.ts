import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

export const LAUNCHD_LABEL = "dev.dispatcher.controller";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function launchdPlist(input: { nodePath: string; cliPath: string; dataDirectory: string; logDirectory: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.nodePath)}</string>
    <string>${xml(input.cliPath)}</string>
    <string>serve</string>
    <string>--with-runner</string>
    <string>--data-dir</string><string>${xml(input.dataDirectory)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(join(input.logDirectory, "controller.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(input.logDirectory, "controller.error.log"))}</string>
</dict>
</plist>
`;
}

export type LaunchctlExecutor = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const launchctl: LaunchctlExecutor = async (args) =>
  await new Promise((resolve, reject) => {
    const child = spawn("/bin/launchctl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(stderr.trim() || `launchctl ${args[0] ?? "command"} failed with exit code ${code ?? "unknown"}`)),
    );
  });

export async function installLaunchAgent(input: {
  plistPath: string;
  nodePath: string;
  cliPath: string;
  dataDirectory: string;
  logDirectory: string;
  executor?: LaunchctlExecutor;
}): Promise<void> {
  mkdirSync(dirname(input.plistPath), { recursive: true });
  mkdirSync(input.dataDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(input.logDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(input.plistPath, launchdPlist(input), { mode: 0o644 });
  chmodSync(input.plistPath, 0o644);
  const executor = input.executor ?? launchctl;
  const domain = `gui/${process.getuid?.() ?? 0}`;
  try {
    await executor(["bootstrap", domain, input.plistPath]);
  } catch {
    await executor(["bootout", domain, input.plistPath]).catch(() => undefined);
    await executor(["bootstrap", domain, input.plistPath]);
  }
}

export function tailLog(path: string, lines = 100): string {
  return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
}
