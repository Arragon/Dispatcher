import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { arch as hostArch, freemem, homedir, loadavg, platform as hostPlatform, totalmem, uptime } from "node:os";
import { delimiter, join, posix, win32 } from "node:path";
import type { Runner } from "@dispatcher/domain";

export type RunnerPlatform = Runner["platform"];
export type ServiceAction = "install" | "upgrade" | "start" | "stop" | "restart" | "status" | "logs" | "uninstall";

export interface CommandPlan {
  file: string;
  args: string[];
}

export interface ServiceFile {
  path: string;
  content: string;
  mode: number;
}

export interface ServicePlan {
  files: ServiceFile[];
  removeFiles?: string[];
  commands: CommandPlan[];
}

export interface RunnerServiceOptions {
  runnerId: string;
  nodePath: string;
  cliPath: string;
  dataDirectory: string;
  controllerUrl: string;
  credentialRef: string;
}

export interface ResourceStats {
  capturedAt: string;
  processRssBytes: number;
  systemTotalBytes: number;
  systemFreeBytes: number;
  loadAverage: number[];
  uptimeSeconds: number;
}

export interface PlatformAdapter {
  readonly platform: RunnerPlatform;
  readonly architecture: string;
  readonly serviceManager: "launchd" | "windows-service" | "systemd";
  readonly credentialStore: "keychain" | "credential-manager" | "secret-service";
  readonly ptyBackend: "unix-pty" | "conpty";
  capabilities(): string[];
  service(action: ServiceAction, options: RunnerServiceOptions): ServicePlan;
  resourceStats(): ResourceStats;
  sleepInhibitor(pid: number): CommandPlan;
}

export function canonicalizeRunnerPath(input: string, platform: RunnerPlatform, cwd: string): string {
  if (!input || input.includes("\0")) throw new Error("Runner path is empty or contains a null byte");
  const implementation = platform === "win32" ? win32 : posix;
  return implementation.normalize(implementation.isAbsolute(input) ? input : implementation.resolve(cwd, input));
}

export interface CredentialCommandExecutor {
  (file: string, args: string[], stdin?: string): Promise<{ stdout: string }>;
}

const executeCredentialCommand: CredentialCommandExecutor = async (file, args, stdin) => await new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve({ stdout }) : reject(new Error(`Native credential command failed (${String(code)}): ${stderr.trim()}`)));
  child.stdin.end(stdin);
});

function assertRunnerCredentialReference(reference: string): { service: string; account: string } {
  if (!reference.startsWith("secret://runner/")) throw new Error("Runner credential must use secret://runner/<service>/<account>");
  const parts = reference.slice("secret://runner/".length).split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Runner credential reference must contain service and account");
  return { service: parts[0]!, account: parts[1]! };
}

export class NativeCredentialStoreAdapter {
  constructor(
    readonly platform: RunnerPlatform,
    private readonly execute: CredentialCommandExecutor = executeCredentialCommand,
  ) {}

  async resolve(reference: string): Promise<string> {
    const { service, account } = assertRunnerCredentialReference(reference);
    const command = this.resolveCommand(service, account);
    const result = await this.execute(command.file, command.args);
    const secret = result.stdout.trim();
    if (!secret) throw new Error(`Native credential ${reference} returned no value`);
    return secret;
  }

  async put(reference: string, value: string): Promise<void> {
    if (!value) throw new Error("Native credential value must not be empty");
    const { service, account } = assertRunnerCredentialReference(reference);
    const command = this.putCommand(service, account);
    await this.execute(command.file, command.args, value);
  }

  resolveCommand(service: string, account: string): CommandPlan {
    if (this.platform === "darwin") return { file: "/usr/bin/security", args: ["find-generic-password", "-s", service, "-a", account, "-w"] };
    if (this.platform === "linux") return { file: "secret-tool", args: ["lookup", "service", service, "account", account] };
    const script = "$v=(New-Object Windows.Security.Credentials.PasswordVault).Retrieve($args[0],$args[1]);$v.RetrievePassword();[Console]::Out.Write($v.Password)";
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script, service, account] };
  }

  putCommand(service: string, account: string): CommandPlan {
    if (this.platform === "darwin") return { file: "/usr/bin/security", args: ["add-generic-password", "-U", "-s", service, "-a", account, "-w"] };
    if (this.platform === "linux") return { file: "secret-tool", args: ["store", `--label=Agent Dispatcher Runner ${account}`, "service", service, "account", account] };
    const script = "$s=[Console]::In.ReadToEnd();$v=New-Object Windows.Security.Credentials.PasswordVault;$v.Add((New-Object Windows.Security.Credentials.PasswordCredential($args[0],$args[1],$s)))";
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script, service, account] };
  }
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function systemdEscape(value: string): string {
  return value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll("\n", "");
}

function serviceArguments(options: RunnerServiceOptions): string[] {
  return [options.cliPath, "serve", "--runner-id", options.runnerId, "--data-dir", options.dataDirectory, "--controller", options.controllerUrl, "--credential-ref", options.credentialRef];
}

abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly platform: RunnerPlatform;
  abstract readonly serviceManager: PlatformAdapter["serviceManager"];
  abstract readonly credentialStore: PlatformAdapter["credentialStore"];
  abstract readonly ptyBackend: PlatformAdapter["ptyBackend"];

  constructor(readonly architecture: string) {}
  abstract service(action: ServiceAction, options: RunnerServiceOptions): ServicePlan;
  abstract sleepInhibitor(pid: number): CommandPlan;

  capabilities(): string[] {
    return [`os:${this.platform}`, `arch:${this.architecture}`, `service:${this.serviceManager}`, `credential:${this.credentialStore}`, `pty:${this.ptyBackend}`, "process-tree", "resource-stats", "remote"];
  }

  resourceStats(): ResourceStats {
    return {
      capturedAt: new Date().toISOString(),
      processRssBytes: process.memoryUsage().rss,
      systemTotalBytes: totalmem(),
      systemFreeBytes: freemem(),
      loadAverage: loadavg(),
      uptimeSeconds: uptime(),
    };
  }
}

export class DarwinPlatformAdapter extends BasePlatformAdapter {
  readonly platform = "darwin" as const;
  readonly serviceManager = "launchd" as const;
  readonly credentialStore = "keychain" as const;
  readonly ptyBackend = "unix-pty" as const;

  service(action: ServiceAction, options: RunnerServiceOptions): ServicePlan {
    const label = `dev.dispatcher.runner.${options.runnerId.replaceAll(/[^a-zA-Z0-9.-]/g, "-")}`;
    const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
    const domain = `gui/${process.getuid?.() ?? 0}`;
    const args = serviceArguments(options);
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xmlEscape(label)}</string><key>ProgramArguments</key><array>${[options.nodePath, ...args].map((value) => `<string>${xmlEscape(value)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xmlEscape(join(options.dataDirectory, "logs", "runner.log"))}</string><key>StandardErrorPath</key><string>${xmlEscape(join(options.dataDirectory, "logs", "runner.error.log"))}</string></dict></plist>\n`;
    if (action === "install" || action === "upgrade") return {
      files: [{ path: plist, content, mode: 0o600 }],
      commands: action === "upgrade"
        ? [{ file: "launchctl", args: ["bootout", domain, plist] }, { file: "launchctl", args: ["bootstrap", domain, plist] }]
        : [{ file: "launchctl", args: ["bootstrap", domain, plist] }],
    };
    if (action === "uninstall") return { files: [], removeFiles: [plist], commands: [{ file: "launchctl", args: ["bootout", domain, plist] }] };
    if (action === "start" || action === "restart") return { files: [], commands: [{ file: "launchctl", args: ["kickstart", ...(action === "restart" ? ["-k"] : []), `${domain}/${label}`] }] };
    if (action === "stop") return { files: [], commands: [{ file: "launchctl", args: ["kill", "SIGTERM", `${domain}/${label}`] }] };
    if (action === "logs") return { files: [], commands: [{ file: "tail", args: ["-n", "200", join(options.dataDirectory, "logs", "runner.log")] }] };
    return { files: [], commands: [{ file: "launchctl", args: ["print", `${domain}/${label}`] }] };
  }

  sleepInhibitor(pid: number): CommandPlan { return { file: "/usr/bin/caffeinate", args: ["-dimsu", "-w", String(pid)] }; }
}

export class LinuxPlatformAdapter extends BasePlatformAdapter {
  readonly platform = "linux" as const;
  readonly serviceManager = "systemd" as const;
  readonly credentialStore = "secret-service" as const;
  readonly ptyBackend = "unix-pty" as const;

  service(action: ServiceAction, options: RunnerServiceOptions): ServicePlan {
    const unit = `dispatcher-runner-${options.runnerId.replaceAll(/[^a-zA-Z0-9_.@-]/g, "-")}.service`;
    const path = join(homedir(), ".config", "systemd", "user", unit);
    const command = [options.nodePath, ...serviceArguments(options)].map(systemdEscape).join(" ");
    const content = `[Unit]\nDescription=Agent Dispatcher Runner ${systemdEscape(options.runnerId)}\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=${command}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
    if (action === "install" || action === "upgrade") return { files: [{ path, content, mode: 0o600 }], commands: [{ file: "systemctl", args: ["--user", "daemon-reload"] }, { file: "systemctl", args: ["--user", action === "upgrade" ? "restart" : "enable", ...(action === "upgrade" ? [] : ["--now"]), unit] }] };
    if (action === "uninstall") return { files: [], removeFiles: [path], commands: [{ file: "systemctl", args: ["--user", "disable", "--now", unit] }, { file: "systemctl", args: ["--user", "daemon-reload"] }] };
    if (action === "logs") return { files: [], commands: [{ file: "journalctl", args: ["--user", "-u", unit, "-n", "200"] }] };
    return { files: [], commands: [{ file: "systemctl", args: ["--user", action === "status" ? "status" : action, unit] }] };
  }

  sleepInhibitor(pid: number): CommandPlan { return { file: "systemd-inhibit", args: ["--what=sleep", "--who=agent-dispatcher", "--why=active runner", "--mode=block", "tail", "--pid", String(pid), "-f", "/dev/null"] }; }
}

export class WindowsPlatformAdapter extends BasePlatformAdapter {
  readonly platform = "win32" as const;
  readonly serviceManager = "windows-service" as const;
  readonly credentialStore = "credential-manager" as const;
  readonly ptyBackend = "conpty" as const;

  service(action: ServiceAction, options: RunnerServiceOptions): ServicePlan {
    const name = `DispatcherRunner-${options.runnerId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
    const binary = `"${options.nodePath}" ${serviceArguments(options).map((value) => `"${value.replaceAll('"', '""')}"`).join(" ")}`;
    if (action === "install") return { files: [], commands: [{ file: "sc.exe", args: ["create", name, "binPath=", binary, "start=", "auto"] }, { file: "sc.exe", args: ["start", name] }] };
    if (action === "upgrade") return { files: [], commands: [{ file: "sc.exe", args: ["config", name, "binPath=", binary] }, { file: "sc.exe", args: ["stop", name] }, { file: "sc.exe", args: ["start", name] }] };
    if (action === "uninstall") return { files: [], commands: [{ file: "sc.exe", args: ["stop", name] }, { file: "sc.exe", args: ["delete", name] }] };
    if (action === "restart") return { files: [], commands: [{ file: "sc.exe", args: ["stop", name] }, { file: "sc.exe", args: ["start", name] }] };
    if (action === "logs") return { files: [], commands: [{ file: "powershell.exe", args: ["-NoProfile", "-Command", `Get-WinEvent -FilterHashtable @{ProviderName='${name}'} -MaxEvents 200`] }] };
    return { files: [], commands: [{ file: "sc.exe", args: [action === "status" ? "query" : action, name] }] };
  }

  sleepInhibitor(pid: number): CommandPlan {
    const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class Sleep { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e); }'; [void][Sleep]::SetThreadExecutionState(0x80000001); Wait-Process -Id ${pid}`;
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
}

export function createPlatformAdapter(platform: NodeJS.Platform = hostPlatform(), architecture = hostArch()): PlatformAdapter {
  if (platform === "darwin") return new DarwinPlatformAdapter(architecture);
  if (platform === "win32") return new WindowsPlatformAdapter(architecture);
  if (platform === "linux") return new LinuxPlatformAdapter(architecture);
  throw new Error(`Unsupported Runner platform: ${platform}`);
}

export function commandAvailable(command: string, pathValue = process.env.PATH ?? ""): boolean {
  const extensions = hostPlatform() === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      try { accessSync(join(directory, `${command}${extension}`), constants.X_OK); return true; }
      catch { /* continue */ }
    }
  }
  return false;
}
