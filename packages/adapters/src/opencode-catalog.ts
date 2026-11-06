import { childExecutionEnvironment } from "@dispatcher/shared";
import { OwnedProcessGroup } from "./owned-process.js";
import { drainCatalogProcess } from "./catalog-process.js";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountModelCatalog, ModelCatalogContext } from "@dispatcher/domain";
import { AdapterContractError } from "./contracts.js";
import type { CliAgentProfile } from "./ecosystem-cli.js";

export type OpenCodeCatalogBackend = "opencode-cli-json" | "opencode-server-v2";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const messages = {
  OPENCODE_CATALOG_UNAVAILABLE: "OpenCode native model/account context could not be verified",
  NATIVE_VERSION_UNSUPPORTED: "This OpenCode version has not qualified the native catalog schema",
  NATIVE_CONTEXT_CHANGED: "Native OpenCode context changed during the query",
  MODEL_CATALOG_CANCELLED: "Native catalog read was cancelled",
  MODEL_CATALOG_CLEANUP_UNKNOWN: "Native catalog process cleanup could not be confirmed",
} as const;
const invalid = () => new AdapterContractError("OPENCODE_CATALOG_UNAVAILABLE", messages.OPENCODE_CATALOG_UNAVAILABLE);
const changed = () => new AdapterContractError("NATIVE_CONTEXT_CHANGED", messages.NATIVE_CONTEXT_CHANGED);
function safeError(error: unknown): AdapterContractError {
  if (error instanceof AdapterContractError && Object.hasOwn(messages, error.code)) {
    const code = error.code as keyof typeof messages;
    return new AdapterContractError(code, messages[code]);
  }
  return invalid();
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function safeText(value: unknown, limit = 240): value is string { return typeof value === "string" && value.length > 0 && value.length <= limit && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127); }
function text(value: unknown, limit = 240): string { if (!safeText(value, limit)) throw invalid(); return value; }
function backend(value: string): asserts value is OpenCodeCatalogBackend { if (value !== "opencode-cli-json" && value !== "opencode-server-v2") throw changed(); }
function scope(context: ModelCatalogContext, backendId: string, profileId = context.profileId): void {
  backend(backendId);
  if (profileId !== context.profileId || ![context.profileId, context.runnerId, context.repositoryId, context.executionContextRef].every(value => safeText(value, 512)) || !["open", "selection-change", "preflight", "before-start", "manual-refresh"].includes(context.reason)) throw changed();
}
function selector(value: unknown): string {
  const m = object(value), provider = text(m.providerID), model = text(m.id), id = `${provider}/${model}`;
  if (provider.includes("/") || provider.includes("#") || model.includes("#") || id.length > 240) throw invalid();
  return id;
}
export function normalizeOpenCodeCatalog(models: unknown, context: ModelCatalogContext, contextFingerprint: string, backendId: OpenCodeCatalogBackend = "opencode-cli-json"): AccountModelCatalog {
  scope(context, backendId);
  if (!Array.isArray(models) || !models.length || models.length > 4000) throw invalid();
  const seen = new Set<string>(), entries: AccountModelCatalog["entries"] = [];
  for (const value of models) {
    const m = object(value); if (typeof m.enabled !== "boolean") throw invalid(); if (!m.enabled) continue;
    const id = selector(m), name = text(m.name), capabilities = object(m.capabilities);
    if (seen.has(id)) throw invalid(); seen.add(id);
    if (!Array.isArray(capabilities.input) || !Array.isArray(capabilities.output) || !capabilities.input.every(value => safeText(value)) || !capabilities.output.every(value => safeText(value))) throw invalid();
    if (!capabilities.input.includes("text") || !capabilities.output.includes("text")) continue;
    // Native variant overlays and inventory costs do not establish supported effort or account prices.
    entries.push({ id, displayName: name, kind: "model", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } });
  }
  if (!entries.length) throw invalid(); entries.sort((a, b) => a.id.localeCompare(b.id));
  return { profileId: context.profileId, runnerId: context.runnerId, providerId: "opencode", backendId, contextFingerprint, revision: digest({ backendId, contextFingerprint, entries }), fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries };
}
function directory(workspacePath: string): string {
  const path = realpathSync(workspacePath), s = statSync(path);
  if (!s.isDirectory()) throw invalid();
  return digest({ path, dev: s.dev, ino: s.ino });
}
/** OpenCode 2.0.26 stores account bindings in SQLite. Read metadata only, never token/value columns. */
function accountBinding(database: string): string {
  const path = realpathSync(database), s = statSync(path), db = new DatabaseSync(path, { readOnly: true });
  try {
    return digest({ path, dev: s.dev, ino: s.ino, state: db.prepare("SELECT id, active_account_id, active_org_id FROM account_state ORDER BY id").all(), accounts: db.prepare("SELECT id, url FROM account ORDER BY id").all(), credentials: db.prepare("SELECT id, integration_id, connector_id, method_id, active, time_updated FROM credential ORDER BY id").all(), control: db.prepare("SELECT email, url, active, time_updated FROM control_account ORDER BY email, url").all() });
  } catch {
    throw new AdapterContractError("NATIVE_VERSION_UNSUPPORTED", messages.NATIVE_VERSION_UNSUPPORTED);
  } finally { db.close(); }
}

/** Own a fresh private read-only host and retain no usable result until owned cleanup and context revalidation. */
export async function readOpenCodeCatalog(original: { profile: CliAgentProfile; executable: string | (() => Promise<string>); backendId?: string; context: ModelCatalogContext; workspacePath: string; signal?: AbortSignal }): Promise<AccountModelCatalog> {
  try {
    const { signal, workspacePath } = original, profile = structuredClone(original.profile), context = { ...original.context }, backendId = original.backendId ?? "opencode-cli-json";
    const executableSource = original.executable, resolveExecutable = typeof executableSource === "function" ? executableSource.bind(original) : undefined;
    scope(context, backendId, profile.id); backend(backendId);
    if (!safeText(workspacePath, 4096) || !isAbsolute(workspacePath)) throw changed();
    const cancelled = () => { if (signal?.aborted) throw new AdapterContractError("MODEL_CATALOG_CANCELLED", messages.MODEL_CATALOG_CANCELLED); };
    cancelled();
    // Capture ambient account/environment and physical scope before invoking caller code or suspending.
    const env = childExecutionEnvironment(process.env), database = join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "opencode.db");
    if (!isAbsolute(database)) throw invalid();
    const originalDirectory = directory(workspacePath), auth = accountBinding(database);
    const assertContext = () => {
      cancelled();
      try {
        if (directory(workspacePath) !== originalDirectory || accountBinding(database) !== auth) throw changed();
      } catch { throw changed(); }
    };
    const resolved = resolveExecutable ? await resolveExecutable() : executableSource;
    assertContext();
    if (!safeText(resolved, 4096)) throw invalid();
    const executableAlias = resolved, executable = realpathSync(resolved);
    const executableStamp = () => {
      const s = statSync(executable); if (!s.isFile()) throw invalid();
      return digest({ path: executable, dev: s.dev, size: s.size, mtime: s.mtimeMs, ino: s.ino });
    };
    const originalExecutable = executableStamp();
    const assertCapturedContext = () => {
      assertContext();
      try { if (realpathSync(executableAlias) !== executable || executableStamp() !== originalExecutable) throw changed(); }
      catch { throw changed(); }
    };
    assertCapturedContext();
    const password = randomBytes(32).toString("base64url"); env.PWD = workspacePath; env.OPENCODE_PASSWORD = password;
    delete env.OPENCODE_SERVER_PASSWORD; delete env.OPENCODE_PTY_HANDOFF;
    // Never ask a mutable caller alias to choose a different binary after fingerprinting.
    const child = spawn(executable, ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], { cwd: workspacePath, shell: false, detached: process.platform !== "win32", env, stdio: ["pipe", "pipe", "pipe"] });
    const group = new OwnedProcessGroup(child), closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000), cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    child.stderr.on("data", () => undefined); child.stdin.on("error", cancel); child.on("error", cancel); child.once("exit", cancel);
    const assertLive = () => { assertCapturedContext(); if (abort.signal.aborted || child.exitCode !== null || child.signalCode !== null) throw invalid(); };
    let candidate: AccountModelCatalog;
    try {
      assertLive();
      const origin = await new Promise<string>((resolve, reject) => {
        let buffer = "", bytes = 0, settled = false;
        const fail = () => { if (!settled) { settled = true; reject(invalid()); } };
        child.once("exit", fail); abort.signal.addEventListener("abort", fail, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { abort.abort(); return; }
          if (settled) return; buffer += chunk.toString(); const newline = buffer.indexOf("\n"); if (newline < 0) return;
          try { const value = object(JSON.parse(buffer.slice(0, newline))), url = new URL(text(value.url)); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid(); settled = true; resolve(url.origin); } catch { fail(); }
        });
      });
      assertLive();
      const get = async (path: string, located = true) => {
        assertLive();
        const url = new URL(path, origin); if (located) url.searchParams.set("location[directory]", workspacePath);
        const response = await fetch(url, { signal: abort.signal, redirect: "error", headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } });
        assertLive(); if (!response.ok) throw invalid();
        const reader = response.body?.getReader(); if (!reader) throw invalid(); let size = 0, body = ""; const decoder = new TextDecoder();
        for (;;) {
          assertLive(); const part = await reader.read(); assertLive(); if (part.done) break;
          size += part.value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw invalid(); } body += decoder.decode(part.value, { stream: true });
        }
        return object(JSON.parse(body + decoder.decode()));
      };
      const verifyInfo = (info: Record<string, unknown>) => {
        if (info.version !== "2.0.26") throw new AdapterContractError("NATIVE_VERSION_UNSUPPORTED", messages.NATIVE_VERSION_UNSUPPORTED);
        if (info.pid !== child.pid) throw invalid();
      };
      const locationIdentity = (value: unknown) => {
        const location = object(value);
        if (directory(text(location.directory)) !== originalDirectory) throw invalid();
        const project = object(location.project), id = text(project.id, 512);
        const supplied: Record<string, string> = { id };
        // Native canonical/directory fields may identify a repository root rather than this worktree.
        for (const key of ["directory", "canonical"] as const) if (project[key] !== undefined) supplied[key] = text(project[key], 512);
        return digest(supplied);
      };
      verifyInfo(await get("/api/info", false));
      const location = await get("/api/location"), projectIdentity = locationIdentity(location), projectId = text(object(location.project).id, 512);
      const locatedData = (result: Record<string, unknown>) => {
        const where = object(result.location); if (directory(text(where.directory)) !== originalDirectory) throw invalid();
        if (where.project !== undefined) {
          const project = object(where.project); if (text(project.id, 512) !== projectId) throw invalid();
          for (const key of ["directory", "canonical"] as const) if (project[key] !== undefined && project[key] !== object(location.project)[key]) throw invalid();
        }
        return result.data;
      };
      const readModels = async () => locatedData(await get("/api/model"));
      let models: unknown;
      for (let attempt = 0; attempt < 30; attempt++) {
        models = await readModels(); if (!Array.isArray(models) || models.length > 4000) throw invalid(); if (models.length) break;
        assertLive(); await new Promise(resolve => setTimeout(resolve, 100)); assertLive();
      }
      if (!Array.isArray(models) || !models.length) throw invalid();
      const nativeDefault = locatedData(await get("/api/model/default")), again = await readModels();
      if (digest(models) !== digest(again)) throw changed();
      verifyInfo(await get("/api/info", false));
      if (locationIdentity(await get("/api/location")) !== projectIdentity) throw changed();
      assertLive();
      const contextFingerprint = digest({ profileId: profile.id, backendId, executable: originalExecutable, runnerId: context.runnerId, repositoryId: context.repositoryId, executionContextRef: context.executionContextRef, physicalProject: originalDirectory, nativeProject: projectIdentity, auth, defaultModel: nativeDefault, modelConfiguration: models });
      candidate = normalizeOpenCodeCatalog(models, context, contextFingerprint, backendId);
      if (nativeDefault !== undefined && nativeDefault !== null && !candidate.entries.some(entry => entry.id === selector(nativeDefault))) throw invalid();
      assertLive();
    } finally {
      signal?.removeEventListener("abort", cancel); clearTimeout(timer); abort.abort(); child.stdin.end();
      // Cleanup uncertainty overrides read failure. Physical/account/executable drift also invalidates a late success.
      await drainCatalogProcess(group, closed);
      assertCapturedContext();
    }
    return candidate;
  } catch (error) { throw safeError(error); }
}
