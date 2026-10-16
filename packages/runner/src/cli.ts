#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Runner } from "@dispatcher/domain";
import { createNativeProfileAdapter, probeNativeProfile } from "@dispatcher/adapters";
import { validateConfig, type DispatcherConfig } from "@dispatcher/config";
import { NATIVE_EXECUTION_CAPABILITY } from "@dispatcher/protocol";
import { NativeRunnerRuntime, NativeRunnerError } from "./native-runtime.js";
import { RunnerJournal } from "./journal.js";
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
  const runtime = nativeRuntime(options.runnerId, options.dataDirectory, credentialStore);
  const journal = new RunnerJournal(join(options.dataDirectory, "transport-journal.sqlite"));
  const runner: Runner = {
    id: options.runnerId,
    displayName: flag(args, "--display-name", options.runnerId)!,
    platform: adapter.platform,
    architecture: adapter.architecture,
    state: "ONLINE",
    capabilities: [...adapter.capabilities(), ...(runtime.profileInventory().length ? [NATIVE_EXECUTION_CAPABILITY] : [])],
    capacity: Math.min(Number(flag(args, "--capacity", String(runtime.capacity() || 1))), runtime.capacity() || 1),
    lastSeenAt: new Date().toISOString(),
  };
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => shutdownPromise ??= (async () => { await runtime.shutdown(); await client.stop(); journal.close(); })();
  const client = new RemoteRunnerClient({ url: options.controllerUrl, bearerToken: token, runner, journal, profileInventory: runtime.profileInventory(), onAuthorizationLost: shutdown });
  runtime.registerHandlers(client);
  client.register("runner.health", () => ({ runner, resources: adapter.resourceStats() }));
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  try { await client.start(); } catch (error) { await shutdown(); throw error; }
}

function nativeRuntime(runnerId: string, dataDirectory: string, credentials: NativeCredentialStoreAdapter): NativeRunnerRuntime {
  const resolveCredential = (reference: string) => credentials.resolve(reference);
  return new NativeRunnerRuntime({ runnerId, dataDirectory,
    createAdapter: (profile, store) => createNativeProfileAdapter(profile, { store, resolveCredential }),
    probeProfile: profile => probeNativeProfile(profile, resolveCredential),
  });
}
function assertOwningRegistration(config: DispatcherConfig, runnerId: string): void {
  if (!config.runners.some(r => r.id === runnerId) || config.agentProfiles.some(p => p.runnerId !== runnerId)) throw new NativeRunnerError("RUNNER_REGISTRATION_MISMATCH", "Registration must name this Runner and contain only its own native profiles");
}
async function configure(args: string[]): Promise<void> {
  const dataDirectory = resolve(flag(args, "--data-dir", ".dispatcher-runner")!);
  let enrolledId: string | undefined;
  try { enrolledId = (JSON.parse(readFileSync(join(dataDirectory, "identity.json"), "utf8")) as { runnerId?: string }).runnerId; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const runnerId = flag(args, "--runner-id", enrolledId) ?? requiredFlag(args, "--runner-id");
  const runtime = nativeRuntime(runnerId, dataDirectory, new NativeCredentialStoreAdapter(createPlatformAdapter().platform));
  try {
    if (args[1] === "plan") {
      const config = validateConfig(JSON.parse(readFileSync(resolve(requiredFlag(args, "--file")), "utf8")));
      assertOwningRegistration(config, runnerId);
      const plan = runtime.configuration.buildPlan(config, "runner-operator", "cli");
      console.log(JSON.stringify({ ...plan, changes: plan.changes.map(change => ({ op: change.op, path: change.path })) }, null, 2));
    } else if (args[1] === "apply") {
      const id = requiredFlag(args, "--plan-id"); assertOwningRegistration(runtime.configuration.proposedConfig(id), runnerId);
      const applied = runtime.configuration.applyPlan(id, { confirmed: args.includes("--confirm") });
      console.log(JSON.stringify({ id, state: runtime.configuration.getPlan(id)?.state, revision: applied.revision, profiles: runtime.profileInventory(), repositories: applied.config.repositories.map(r => r.id) }, null, 2));
    } else throw new Error("Usage: agent-runner config plan --file <DispatcherConfig.json> | config apply --plan-id <id> --confirm");
  } finally { runtime.close(); }
}

export async function runRunnerCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? "doctor";
  if (command === "serve") await serve(args);
  else if (command === "config") await configure(args);
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
