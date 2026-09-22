#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Runner } from "@dispatcher/domain";
import { RemoteRunnerClient } from "./remote.js";
import { NativeCredentialStoreAdapter, commandAvailable, createPlatformAdapter, type ServiceAction } from "./platform.js";

const execFile = promisify(execFileCallback);

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function requiredFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function serviceOptions(args: string[]) {
  const cliPath = fileURLToPath(import.meta.url);
  const dataDirectory = resolve(flag(args, "--data-dir", ".dispatcher-runner")!);
  let identity: { runnerId?: string; controllerUrl?: string; credentialRef?: string } = {};
  try { identity = JSON.parse(readFileSync(join(dataDirectory, "identity.json"), "utf8")) as typeof identity; }
  catch { /* first enrollment */ }
  return {
    runnerId: flag(args, "--runner-id", identity.runnerId ?? `${platform()}-${arch()}`)!,
    nodePath: process.execPath,
    cliPath,
    dataDirectory,
    controllerUrl: flag(args, "--controller", identity.controllerUrl) ?? requiredFlag(args, "--controller"),
    credentialRef: flag(args, "--credential-ref", identity.credentialRef) ?? requiredFlag(args, "--credential-ref"),
  };
}

async function enroll(args: string[]): Promise<void> {
  const controllerUrl = requiredFlag(args, "--controller").replace(/^ws/, "http").replace(/\/runner$/, "");
  const runnerId = requiredFlag(args, "--runner-id");
  const tokenFile = resolve(requiredFlag(args, "--enrollment-file"));
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) throw new Error("Enrollment token file is empty");
  const response = await fetch(`${controllerUrl}/api/runners/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId, token }) });
  const result = await response.json() as { runnerId?: string; credentialRef?: string; bearerToken?: string; protocolVersion?: string; message?: string };
  if (!response.ok || !result.runnerId || !result.credentialRef || !result.bearerToken) throw new Error(result.message ?? `Enrollment failed with HTTP ${response.status}`);
  const adapter = createPlatformAdapter();
  await new NativeCredentialStoreAdapter(adapter.platform).put(result.credentialRef, result.bearerToken);
  const dataDirectory = resolve(flag(args, "--data-dir", ".dispatcher-runner")!);
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDirectory, "identity.json"), JSON.stringify({ runnerId: result.runnerId, controllerUrl: requiredFlag(args, "--controller"), credentialRef: result.credentialRef }, null, 2), { mode: 0o600 });
  rmSync(tokenFile, { force: true });
  console.log(JSON.stringify({ runnerId: result.runnerId, credentialRef: result.credentialRef, protocolVersion: result.protocolVersion, enrolled: true }, null, 2));
}

async function runServiceAction(action: ServiceAction, args: string[]): Promise<void> {
  const adapter = createPlatformAdapter();
  const plan = adapter.service(action, serviceOptions(args));
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ platform: adapter.platform, serviceManager: adapter.serviceManager, plan }, null, 2));
    return;
  }
  for (const file of plan.files) {
    mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, file.content, { mode: file.mode });
  }
  for (const command of plan.commands) {
    const result = await execFile(command.file, command.args);
    if (result.stdout.trim()) console.log(result.stdout.trim());
  }
  if (action === "uninstall") for (const path of plan.removeFiles ?? []) rmSync(path, { force: true });
}

async function doctor(args: string[]): Promise<void> {
  const adapter = createPlatformAdapter();
  const serviceCommand = adapter.platform === "darwin" ? "launchctl" : adapter.platform === "win32" ? "sc" : "systemctl";
  const result = {
    platform: adapter.platform,
    architecture: adapter.architecture,
    serviceManager: adapter.serviceManager,
    serviceManagerAvailable: commandAvailable(serviceCommand),
    credentialStore: adapter.credentialStore,
    ptyBackend: adapter.ptyBackend,
    capabilities: adapter.capabilities(),
    resourceStats: adapter.resourceStats(),
    configuration: serviceOptions(args),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.serviceManagerAvailable) process.exitCode = 1;
}

async function serve(args: string[]): Promise<void> {
  const adapter = createPlatformAdapter();
  const options = serviceOptions(args);
  const credentialStore = new NativeCredentialStoreAdapter(adapter.platform);
  const token = await credentialStore.resolve(options.credentialRef);
  const runner: Runner = {
    id: options.runnerId,
    displayName: flag(args, "--display-name", options.runnerId)!,
    platform: adapter.platform,
    architecture: adapter.architecture,
    state: "ONLINE",
    capabilities: adapter.capabilities(),
    capacity: Number(flag(args, "--capacity", "1")),
    lastSeenAt: new Date().toISOString(),
  };
  const client = new RemoteRunnerClient({ url: options.controllerUrl, bearerToken: token, runner, profileInventory: [] });
  client.register("runner.health", () => ({ runner, resources: adapter.resourceStats() }));
  client.register("runner.reconcile", () => ({ runnerId: runner.id, runs: [] }));
  client.register("run.start", () => { throw new Error("Run execution descriptor is unavailable; reconcile with Controller before retrying"); });
  const shutdown = async () => { await client.stop(); process.exitCode = 0; };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await client.start();
}

export async function runRunnerCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? "doctor";
  if (command === "serve") await serve(args);
  else if (command === "enroll") await enroll(args);
  else if (command === "doctor") await doctor(args);
  else if (["install", "upgrade", "start", "stop", "restart", "status", "logs", "uninstall"].includes(command)) await runServiceAction(command as ServiceAction, args);
  else throw new Error("Usage: agent-runner enroll|serve|install|upgrade|start|stop|restart|status|doctor|logs|uninstall --controller <wss-url> --credential-ref <secret://runner/service/account>");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runRunnerCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Agent Runner command failed");
    process.exitCode = 1;
  });
}
