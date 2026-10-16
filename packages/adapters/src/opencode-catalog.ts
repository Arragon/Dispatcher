import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountModelCatalog, ModelCatalogContext } from "@dispatcher/domain";
import { AdapterContractError } from "./contracts.js";
import type { CliAgentProfile } from "./ecosystem-cli.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = () => new AdapterContractError("OPENCODE_CATALOG_UNAVAILABLE", "OpenCode native model/account context could not be verified");
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== "string" || !value || value.length > 240 || Array.from(value).some(c => c.charCodeAt(0) < 32)) throw invalid(); return value; }

export function normalizeOpenCodeCatalog(models: unknown, context: ModelCatalogContext, contextFingerprint: string): AccountModelCatalog {
  if (!Array.isArray(models) || !models.length || models.length > 4000) throw invalid();
  const seen = new Set<string>(), entries: AccountModelCatalog["entries"] = [];
  for (const value of models) {
    const m = object(value); if (typeof m.enabled !== "boolean") throw invalid(); if (!m.enabled) continue;
    const id = `${text(m.providerID)}/${text(m.id)}`, name = text(m.name), capabilities = object(m.capabilities);
    if (seen.has(id) || id.length > 240) throw invalid(); seen.add(id);
    if (!Array.isArray(capabilities.input) || !Array.isArray(capabilities.output)) throw invalid();
    if (!capabilities.input.includes("text") || !capabilities.output.includes("text")) continue;
    // Native variant overlays and inventory costs do not establish supported effort or account prices.
    entries.push({ id, displayName: name, kind: "model", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } });
  }
  if (!entries.length) throw invalid(); entries.sort((a, b) => a.id.localeCompare(b.id));
  return { profileId: context.profileId, runnerId: context.runnerId, providerId: "opencode", backendId: "opencode-cli-json", contextFingerprint, revision: digest({ contextFingerprint, entries }), fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries };
}

/** OpenCode 2.0.26 stores account bindings in SQLite. Read metadata only, never token/value columns. */
function accountBinding(): string {
  const db = new DatabaseSync(join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "opencode.db"), { readOnly: true });
  try {
    return digest({ state: db.prepare("SELECT id, active_account_id, active_org_id FROM account_state ORDER BY id").all(), accounts: db.prepare("SELECT id, url FROM account ORDER BY id").all(), credentials: db.prepare("SELECT id, integration_id, connector_id, method_id, active, time_updated FROM credential ORDER BY id").all(), control: db.prepare("SELECT email, url, active, time_updated FROM control_account ORDER BY email, url").all() });
  } catch {
    throw new AdapterContractError("NATIVE_VERSION_UNSUPPORTED", "The native OpenCode account schema is not qualified for model selection");
  } finally { db.close(); }
}

/** Own a fresh authenticated stdio host, query only read-only routes, and reap it before returning. */
export async function readOpenCodeCatalog(input: { profile: CliAgentProfile; executable: string; context: ModelCatalogContext; workspacePath: string }): Promise<AccountModelCatalog> {
  const directory = async () => { const path = await realpath(input.workspacePath), s = await stat(path); if (!s.isDirectory()) throw invalid(); return digest({ path, dev: s.dev, ino: s.ino }); };
  const original = await directory(), auth = accountBinding();
  const executable = await realpath(input.executable);
  const executableStamp = async () => { const s = await stat(executable); return digest({ path: executable, size: s.size, mtime: s.mtimeMs, ino: s.ino }); };
  const originalExecutable = await executableStamp();
  const password = randomBytes(32).toString("base64url"), env: NodeJS.ProcessEnv = { ...process.env, PWD: input.workspacePath, OPENCODE_PASSWORD: password };
  delete env.OPENCODE_SERVER_PASSWORD; delete env.OPENCODE_PTY_HANDOFF;
  const child = spawn(input.executable, ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], { cwd: input.workspacePath, shell: false, detached: process.platform !== "win32", env, stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000);
  const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ } };
  child.stderr.on("data", () => undefined); child.stdin.on("error", () => abort.abort()); child.on("error", () => abort.abort());
  let bytes = 0;
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const fail = () => reject(invalid()); child.once("exit", fail); abort.signal.addEventListener("abort", fail, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { abort.abort(); return; }
        if (buffer.includes("\n")) return; buffer += chunk.toString(); const newline = buffer.indexOf("\n"); if (newline < 0) return;
        try { const value = object(JSON.parse(buffer.slice(0, newline))), url = new URL(text(value.url)); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid(); resolve(url.origin); } catch { fail(); }
      });
    });
    const get = async (path: string, located = true) => {
      if (await directory() !== original || abort.signal.aborted || child.exitCode !== null) throw invalid();
      const url = new URL(path, origin); if (located) url.searchParams.set("location[directory]", input.workspacePath);
      const response = await fetch(url, { signal: abort.signal, redirect: "error", headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } });
      if (!response.ok) throw invalid();
      const reader = response.body?.getReader(); if (!reader) throw invalid(); let size = 0, body = ""; const decoder = new TextDecoder();
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw invalid(); } body += decoder.decode(part.value, { stream: true }); }
      return object(JSON.parse(body + decoder.decode()));
    };
    const info = await get("/api/info", false);
    // Pin the native response and account metadata schema rather than assuming future compatibility.
    if (info.version !== "2.0.26" || info.pid !== child.pid) throw new AdapterContractError("NATIVE_VERSION_UNSUPPORTED", "This OpenCode version has not qualified the native catalog schema");
    const location = await get("/api/location");
    if (await realpath(text(location.directory)) !== await realpath(input.workspacePath)) throw invalid();
    const readModels = async () => { const result = await get("/api/model"), where = object(result.location); if (await realpath(text(where.directory)) !== await realpath(input.workspacePath)) throw invalid(); return result.data; };
    let models: unknown;
    for (let attempt = 0; attempt < 30; attempt++) { models = await readModels(); if (Array.isArray(models) && models.length) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    const again = await readModels();
    for (const [changed, component] of [[digest(models) !== digest(again), "model snapshot"], [accountBinding() !== auth, "account binding"], [await directory() !== original, "physical project"], [await executableStamp() !== originalExecutable, "executable"]] as const) if (changed) throw new AdapterContractError("NATIVE_CONTEXT_CHANGED", `Native ${component} changed during the query`);
    const nativeDefault = await get("/api/model/default");
    const contextFingerprint = digest({ profileId: input.profile.id, executable: originalExecutable, runnerId: input.context.runnerId, repositoryId: input.context.repositoryId, executionContextRef: input.context.executionContextRef, auth, defaultModel: nativeDefault.data, modelConfiguration: models });
    return normalizeOpenCodeCatalog(models, input.context, contextFingerprint);
  } finally {
    clearTimeout(timer); abort.abort(); child.stdin.end(); kill("SIGTERM");
    const escalation = setTimeout(() => kill("SIGKILL"), 1000);
    await closed; clearTimeout(escalation); kill("SIGKILL");
  }
}
