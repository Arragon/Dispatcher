#!/usr/bin/env node
import { accessSync, constants,existsSync, readFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRequiredSecretsAvailable,
  ConfigurationEngine,
  createDefaultSecretStore,
  requiredSecretReferences,
  validateConfig,
} from "@dispatcher/config";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { installLaunchAgent, LAUNCHD_LABEL,readLaunchAgent,startLaunchAgent,stopLaunchAgent,restartLaunchAgent,statusLaunchAgent,uninstallLaunchAgent, tailLog } from "./launchd.js";
import { normalizeCliArguments } from "./cli-args.js";
import { OWNER_TOKEN_REFERENCE } from "./control-auth.js";
import { ControllerService } from "./service.js";
import {acquireInstanceLock} from "@dispatcher/persistence";
import {inspectLocalController} from "./doctor.js";
import {createControllerLogDestination,readControllerLogTail} from "./controller-logs.js";
import {createLocalDatabaseBackup,restoreLocalDatabase} from "./local-backups.js";
let controllerLog:{write(message:string):void}|undefined;
function serviceFailure(code:string):void {
  if(controllerLog)controllerLog.write(JSON.stringify({level:50,time:Date.now(),msg:code})+"\n");else console.error(code);
}

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
  const ownership=acquireInstanceLock(dataDirectory(args));
  let service:ControllerService;
  try{
    const logDirectory=flag(args,"--log-dir");if(logDirectory)controllerLog=createControllerLogDestination(logDirectory);
    service = new ControllerService({
    ...(controllerLog?{logDestination:controllerLog}:{}),
    dataDirectory: ownership.dataDirectory,
    withRunner: args.includes("--with-runner"),
    host: flag(args, "--host") ?? "127.0.0.1",
    port: Number(flag(args, "--port", "8347")),
    allowedHosts: (flag(args, "--allowed-hosts") ?? process.env.DISPATCHER_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
    ...(process.env.DISPATCHER_OWNER_TOKEN ? { ownerToken: process.env.DISPATCHER_OWNER_TOKEN } : {}),
    backgroundWorker: { enabled: !args.includes("--no-background-worker") },
  });}catch(error){ownership.release();throw error;}
  let stopping:Promise<void>|undefined;
  const shutdown = async () => {
    stopping??=service.stop().then(()=>{ownership.release();process.exitCode=0;});
    await stopping;
  };
  const onSignal=()=>void shutdown().catch(()=>{serviceFailure("CONTROLLER_SHUTDOWN_UNCONFIRMED");process.exitCode=1;});
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try{await service.start();}catch(error){
    process.removeListener("SIGINT",onSignal);process.removeListener("SIGTERM",onSignal);
    try{await service.stop();ownership.release();}catch{serviceFailure("CONTROLLER_SHUTDOWN_UNCONFIRMED");}
    throw error;
  }
  if (process.stdout.isTTY) {
    const login = service.issueDashboardLogin();
    console.log(`Dashboard login link (single use, expires ${login.expiresAt}): ${login.url}`);
  }
}

async function authCommand(args: string[]): Promise<void> {
  if (args[1] !== "token") throw new Error("Use auth token");
  if (process.env.DISPATCHER_OWNER_TOKEN) {
    console.log(process.env.DISPATCHER_OWNER_TOKEN);
    return;
  }
  const secrets = createDefaultSecretStore({ dataDirectory: dataDirectory(args) });
  if (!(await secrets.metadata(OWNER_TOKEN_REFERENCE)).exists) await secrets.put(OWNER_TOKEN_REFERENCE, randomBytes(32).toString("base64url"));
  console.log(await secrets.resolve(OWNER_TOKEN_REFERENCE, { principal: "controller", purpose: "provider" }));
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
        const proposed = engine.proposedConfig(plan.id);
        if (requiredSecretReferences(proposed).length > 0) {
          await assertRequiredSecretsAvailable(proposed, createDefaultSecretStore({ dataDirectory: dataDirectory(args) }));
        }
        const applied = engine.applyPlan(plan.id, { confirmed: args.includes("--confirm") });
        console.log(JSON.stringify({ planId: plan.id, revision: applied.revision }, null, 2));
      } else console.log(JSON.stringify({ plan }, null, 2));
    } else throw new Error("Use config export, config validate <file>, or config import <file> [--apply --confirm]");
  } finally {
    database.close();
  }
}

async function serviceCommand(command: string, args: string[]): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Controller background service management supports macOS launchd");
  const paths = servicePaths(args);
  if (command === "install") {
    const cliPath = realpathSync(resolve(flag(args,"--cli-path",fileURLToPath(import.meta.url))!)),nodePath=realpathSync(process.execPath);
    accessSync(cliPath,constants.R_OK);accessSync(nodePath,constants.X_OK);
    await installLaunchAgent({ plistPath: paths.plist, nodePath, cliPath, dataDirectory: paths.root, logDirectory: paths.logs });
    console.log(`Installed ${LAUNCHD_LABEL}`);
    return;
  }
  const definition=await readLaunchAgent(paths.plist),input={...definition,plistPath:paths.plist};
  if((args.includes("--data-dir")||process.env.DISPATCHER_DATA_DIR)&&realpathSync(paths.root)!==realpathSync(definition.dataDirectory))throw Error("SERVICE_DATA_DIRECTORY_MISMATCH: use the installed service data directory");
  if(command==="start")await startLaunchAgent(input);
  else if(command==="stop")await stopLaunchAgent(input);
  else if(command==="restart")await restartLaunchAgent(input);
  else if(command==="status")console.log(JSON.stringify({label:LAUNCHD_LABEL,...definition,...await statusLaunchAgent(input)},null,2));
  else if(command==="uninstall")await uninstallLaunchAgent(input);
  else if(command==="logs"){
    const path=join(definition.logDirectory,"runtime","controller.log"),lines=Number(flag(args,"--lines","100"));
    console.log(args.includes("--stderr")?readControllerLogTail(join(definition.logDirectory,"controller.error.log"),lines):existsSync(path)?readControllerLogTail(path,lines):tailLog(join(definition.logDirectory,"controller.log"),lines));
  }
}

async function doctor(args: string[]): Promise<void> {
  const result=inspectLocalController(dataDirectory(args));
  console.log(JSON.stringify(result, null, 2));
  if(result.requiresAttention)process.exitCode=1;
}

async function main(): Promise<void> {
  const args = normalizeCliArguments(process.argv.slice(2));
  const command = args[0] ?? "serve";
  if (command === "serve") await serve(args);
  else if(command==="doctor")await doctor(args);
  else if(command==="backup"){
    const out=flag(args,"--out");if(!out)throw Error("Use backup --data-dir <directory> --out <new-bundle-directory>");
    console.log(JSON.stringify(await createLocalDatabaseBackup(dataDirectory(args),out),null,2));
  }
  else if(command==="restore"){
    const bundle=flag(args,"--bundle"),target=flag(args,"--target-data-dir");if(!bundle||!target)throw Error("Use restore --bundle <directory> --target-data-dir <new-directory> [--execute --confirm]");
    console.log(JSON.stringify(restoreLocalDatabase(bundle,target,{execute:args.includes("--execute"),confirmed:args.includes("--confirm")}),null,2));
  }
  else if (command==="config"){
    const ownership=acquireInstanceLock(dataDirectory(args));
    try{await configCommand(args);}finally{ownership.release();}
  }
  else if (command === "auth") await authCommand(args);
  else if (["install", "start", "stop", "restart", "status", "logs", "uninstall"].includes(command)) await serviceCommand(command, args);
  else throw new Error("Usage: dispatcher serve|config|auth|install|start|stop|restart|status|doctor|logs|backup|restore|uninstall");
}

main().catch((error: unknown) => {
  if(controllerLog)serviceFailure("CONTROLLER_COMMAND_FAILED");else console.error(error instanceof Error ? error.message : "Dispatcher command failed");
  process.exitCode = 1;
});
