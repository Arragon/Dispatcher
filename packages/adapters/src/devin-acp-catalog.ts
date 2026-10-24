import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AccountModelCatalog, ModelCatalogContext } from "@dispatcher/domain";
import { childExecutionEnvironment } from "@dispatcher/shared";
import { AdapterContractError } from "./contracts.js";
import { devinLocalAcpCliVersion, identity, type DevinLocalAcpScope, type Identity } from "./devin-acp.js";
import { readOwnedNativeVersion } from "./native-version-probe.js";
import { drainCatalogProcess } from "./catalog-process.js";
import { OwnedProcessRoot } from "./owned-root-process.js";

const fail = (code: string) => new AdapterContractError(code, code);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const safeId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 240 && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
function catalogContext(context: ModelCatalogContext): void {
  if (!context || ![context.profileId, context.runnerId, context.repositoryId, context.executionContextRef].every(safeId) || !["open", "selection-change", "preflight", "before-start", "manual-refresh"].includes(context.reason)) throw fail("MODEL_CONTEXT_MISMATCH");
}
/** Native candidates do not establish access, billing, defaults or parameter support. */
export function normalizeDevinLocalCatalog(value: unknown, options: { context: ModelCatalogContext; contextFingerprint: string; fetchedAt: string }): AccountModelCatalog {
  catalogContext(options.context);
  if (!safeId(options.contextFingerprint) || !Number.isFinite(Date.parse(options.fetchedAt))) throw fail("INVALID_MODEL_CATALOG");
  if (!record(value) || !Array.isArray(value.families) || !value.families.length || value.families.length > 200) throw fail("INVALID_MODEL_CATALOG");
  const families = new Set<string>(), ids = new Set<string>(), entries: AccountModelCatalog["entries"] = [];
  for (const family of value.families) {
    if (!record(family) || !safeId(family.family_uid) || families.has(family.family_uid) || !Array.isArray(family.variants) || !family.variants.length || family.variants.length > 4000) throw fail("INVALID_MODEL_CATALOG");
    families.add(family.family_uid);
    for (const variant of family.variants) {
      if (!record(variant) || !safeId(variant.model_uid) || ids.has(variant.model_uid) || typeof variant.label !== "string" || !variant.label.trim() || variant.label.length > 240 || variant.label.includes("\0") || entries.length >= 4000) throw fail("INVALID_MODEL_CATALOG");
      ids.add(variant.model_uid);
      entries.push({ id: variant.model_uid, displayName: variant.label, kind: variant.model_uid === "adaptive" ? "native-auto" : "model", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } });
    }
  }
  // Exact native IDs can collate equally without being the same selector.
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const result: AccountModelCatalog = { profileId: options.context.profileId, runnerId: options.context.runnerId, providerId: "devin-local", backendId: "devin-local-acp", contextFingerprint: options.contextFingerprint, revision: digest({ contextFingerprint: options.contextFingerprint, entries }), fetchedAt: options.fetchedAt, source: "cli-query", freshness: "native-fresh", selectionSupport: "explicit", entries };
  if (Buffer.byteLength(JSON.stringify(result)) > 1_048_576) throw fail("INVALID_MODEL_CATALOG");
  return result;
}
/** Read-only inventory command; it cannot create/load/prompt an ACP Session. */
export async function readDevinLocalCatalog(original: { profileId: string; scope: DevinLocalAcpScope; context: ModelCatalogContext; signal?: AbortSignal; timeoutMs?: number }, expectedRoots?: Identity[]): Promise<AccountModelCatalog> {
  const enteredAt = performance.now();
  const { profileId, signal } = original, scope = structuredClone(original.scope), context = structuredClone(original.context), timeoutMs = original.timeoutMs ?? 30_000;
  const deadline = enteredAt + timeoutMs;
  catalogContext(context);
  if (!safeId(profileId) || context.profileId !== profileId) throw fail("MODEL_CONTEXT_MISMATCH");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw fail("INVALID_MODEL_CATALOG");
  const identities = () => [identity(scope.executable, false), identity(scope.workspacePath, true), identity(scope.dataHome, true), identity(scope.configHome, true)];
  let paths: Identity[];
  try { paths = identities(); } catch { throw fail("MODEL_CONTEXT_MISMATCH"); }
  const roots = structuredClone(expectedRoots ?? [paths[0]!, paths[2]!, paths[3]!]);
  const guard = () => {
    if (signal?.aborted) throw fail("MODEL_CATALOG_CANCELLED");
    if (performance.now() >= deadline) throw fail("MODEL_CATALOG_TIMEOUT");
    try { const current = identities(); if (!isDeepStrictEqual(current, paths) || !isDeepStrictEqual([current[0], current[2], current[3]], roots)) throw Error(); }
    catch { throw fail("MODEL_CONTEXT_MISMATCH"); }
  };
  guard();
  const env = childExecutionEnvironment(process.env, { PWD: paths[1]!.path, XDG_DATA_HOME: paths[2]!.path, XDG_CONFIG_HOME: paths[3]!.path });
  let version: string;
  try { version = await readOwnedNativeVersion({ executable: paths[0]!.path, workspacePath: paths[1]!.path, environment: env, ownsGroup: false, ...(signal ? { signal } : {}), timeoutMs: Math.max(1, Math.min(3000, deadline - performance.now())), failure: code => fail(code === "exit-unconfirmed" ? "MODEL_CATALOG_CLEANUP_UNKNOWN" : "MODEL_CATALOG_UNAVAILABLE") }); }
  catch (error) { if (error instanceof AdapterContractError && error.code === "MODEL_CATALOG_CLEANUP_UNKNOWN") throw error; guard(); throw error; }
  guard();
  if (version !== devinLocalAcpCliVersion) throw fail("MODEL_CATALOG_VERSION_UNSUPPORTED");
  const child = spawn(paths[0]!.path, ["models", "list", "--format", "json"], { cwd: paths[1]!.path, env, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] }), owner = new OwnedProcessRoot(child);
  let failed: AdapterContractError | undefined, bytes = 0, diagnostics = 0, exitCode: number | null = null, stop!: () => void;
  const chunks: Buffer[] = [], diagnosticChunks: Buffer[] = [], stopped = new Promise<void>(resolve => { stop = resolve; }), closed = new Promise<void>(resolve => { child.once("close", code => { exitCode = code; resolve(); }); });
  const abort = (code: string) => { if (!failed || code === "MODEL_CATALOG_CLEANUP_UNKNOWN") failed = fail(code); stop(); };
  child.once("error", () => abort("MODEL_CATALOG_UNAVAILABLE"));
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > 1_048_576) abort("INVALID_MODEL_CATALOG"); else if (!failed) chunks.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { diagnostics += chunk.byteLength; if (diagnostics > 1_048_576) abort("INVALID_MODEL_CATALOG"); else if (!failed) diagnosticChunks.push(chunk); });
  child.stdout.once("error", () => abort("MODEL_CATALOG_CLEANUP_UNKNOWN")); child.stderr.once("error", () => abort("MODEL_CATALOG_CLEANUP_UNKNOWN"));
  const rootExited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const onAbort = () => abort("MODEL_CATALOG_CANCELLED"), timer = setTimeout(() => abort("MODEL_CATALOG_TIMEOUT"), Math.max(1, deadline - performance.now()));
  signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort();
  try {
    await Promise.race([rootExited, closed, stopped]);
    // Root exit does not prove inherited pipes closed; cleanup uncertainty wins.
    await drainCatalogProcess(owner, closed, 500);
    if (failed) throw failed;
    if (exitCode !== 0) throw fail("MODEL_CATALOG_UNAVAILABLE");
    guard(); let value: unknown;
    try { new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(diagnosticChunks)); value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw fail("INVALID_MODEL_CATALOG"); }
    const contextFingerprint = digest({ profileId, runnerId: context.runnerId, repositoryId: context.repositoryId, executionContextRef: context.executionContextRef, reason: context.reason, roots: paths.map(p => ({ path: p.path, dev: String(p.dev), ino: String(p.ino) })) });
    const catalog = normalizeDevinLocalCatalog(value, { context, contextFingerprint, fetchedAt: new Date().toISOString() }); guard(); return catalog;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}
