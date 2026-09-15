#!/usr/bin/env node
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigurationEngine, validateConfig } from "@dispatcher/config";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { installLaunchAgent, LAUNCHD_LABEL, launchctl, tailLog } from "./launchd.js";
import { ControllerService } from "./service.js";

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function dataDirectory(args: string[]): string {
  return resolve(flag(args, "--data-dir", process.env.DISPATCHER_DATA_DIR ?? ".dispatcher")!);
}

function servicePaths(args: string[]) {
  const root = dataDirectory(args);
  return {
    root,
    logs: join(root, "logs"),
    plist: join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`),
  };
}

async function serve(args: string[]): Promise<void> {
  const service = new ControllerService({
    dataDirectory: dataDirectory(args),
    withRunner: args.includes("--with-runner"),
    host: flag(args, "--host") ?? "127.0.0.1",
    port: Number(flag(args, "--port", "8347")),
  });
  const shutdown = async () => {
    await service.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await service.start();
}

async function configCommand(args: string[]): Promise<void> {
  const action = args[1];
  const database = new DispatcherDatabase(join(dataDirectory(args), "dispatcher.sqlite"));
  const engine = new ConfigurationEngine(database);
  try {
    if (action === "export") console.log(JSON.stringify(engine.exportRedacted(), null, 2));
    else if (action === "validate") {
      const path = args[2];
      if (!path) throw new Error("config validate requires a JSON file");
      validateConfig(JSON.parse(readFileSync(resolve(path), "utf8")));
      console.log("Configuration is valid");
    } else if (action === "import") {
      const path = args[2];
      if (!path) throw new Error("config import requires a JSON file");
      const plan = engine.importConfig(JSON.parse(readFileSync(resolve(path), "utf8")), "local-cli");
      if (args.includes("--apply")) {
        const applied = engine.applyPlan(plan.id, { confirmed: args.includes("--confirm") });
        console.log(JSON.stringify({ planId: plan.id, revision: applied.revision }, null, 2));
      } else console.log(JSON.stringify({ plan }, null, 2));
    } else throw new Error("Use config export, config validate <file>, or config import <file> [--apply --confirm]");
  } finally {
    database.close();
  }
}

async function serviceCommand(command: string, args: string[]): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The M1 service prototype currently supports macOS launchd only");
  const paths = servicePaths(args);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  if (command === "install") {
    const cliPath = fileURLToPath(import.meta.url);
    await installLaunchAgent({ plistPath: paths.plist, nodePath: process.execPath, cliPath, dataDirectory: paths.root, logDirectory: paths.logs });
    console.log(`Installed ${LAUNCHD_LABEL}`);
  } else if (command === "start") await launchctl(["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`]);
  else if (command === "stop") await launchctl(["kill", "SIGTERM", `${domain}/${LAUNCHD_LABEL}`]);
  else if (command === "restart") await launchctl(["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`]);
  else if (command === "status") console.log((await launchctl(["print", `${domain}/${LAUNCHD_LABEL}`])).stdout);
  else if (command === "uninstall") await launchctl(["bootout", domain, paths.plist]);
  else if (command === "logs") console.log(tailLog(join(paths.logs, "controller.log")));
}

async function doctor(args: string[]): Promise<void> {
  const root = dataDirectory(args);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  accessSync(root, constants.R_OK | constants.W_OK);
  const database = new DispatcherDatabase(join(root, "dispatcher.sqlite"));
  const result = {
    node: process.versions.node,
    nodeSupported: Number(process.versions.node.split(".")[0]) >= 24,
    dataDirectory: root,
    databaseIntegrity: database.integrityCheck(),
    configurationRevision: new ConfigurationEngine(database).current().revision,
  };
  database.close();
  console.log(JSON.stringify(result, null, 2));
  if (!result.nodeSupported || !result.databaseIntegrity) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "serve";
  if (command === "serve") await serve(args);
  else if (command === "config") await configCommand(args);
  else if (command === "doctor") await doctor(args);
  else if (["install", "start", "stop", "restart", "status", "logs", "uninstall"].includes(command)) await serviceCommand(command, args);
  else throw new Error("Usage: dispatcher serve|config|install|start|stop|restart|status|doctor|logs|uninstall");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Dispatcher command failed");
  process.exitCode = 1;
});
