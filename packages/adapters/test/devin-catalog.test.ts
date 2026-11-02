import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AdapterContractError } from "../src/contracts.js";
import { DevinLocalAcpAdapter } from "../src/devin-acp-execution.js";
import { normalizeDevinLocalCatalog, readDevinLocalCatalog } from "../src/devin-acp-catalog.js";
import { OwnedProcessRoot } from "../src/owned-root-process.js";
const adapters = { AdapterContractError, DevinLocalAcpAdapter, normalizeDevinLocalCatalog, readDevinLocalCatalog };
import type { ModelCatalogContext } from "@dispatcher/domain";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const context: ModelCatalogContext = { profileId: "p", runnerId: "local", repositoryId: "repo", executionContextRef: "workspace:repo", reason: "manual-refresh" };
const options = { context, contextFingerprint: "fixture", fetchedAt: "2026-10-13T00:00:00.000Z" };
function inventory() { return { families: [{ family_uid: "family", family_label: "Family", slug: "dynamic-alias", aliases: ["latest"], variants: [{ model_uid: "chosen", label: "Chosen", description: "cog-private", cost_summary: "cog-price", is_new: true, is_beta: false, _meta: { credential: "cog-secret" } }, { model_uid: "adaptive", label: "Adaptive" }] }] }; }
function fixture(mode = "normal") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-devin-catalog-"))); roots.push(root);
  const workspacePath = join(root, "workspace"), dataHome = join(root, "native-data"), configHome = join(root, "native-config"), executable = join(root, "devin"); for (const path of [workspacePath, dataHome, configHome]) mkdirSync(path);
  const script = [
    "#!" + process.execPath,
    "const fs=require('node:fs'),root=" + JSON.stringify(root) + ",mode=" + JSON.stringify(mode) + ";fs.appendFileSync(root+'/pids',process.pid+'\\n');",
    "if(process.argv.includes('--version')){if(mode.startsWith('probe-stderr-')){const payload=mode==='probe-stderr-huge'?Buffer.alloc(1048577,120):mode==='probe-stderr-invalid-utf8'?Buffer.from([255]):mode==='probe-stderr-boundary'?Buffer.alloc(1048576,120):Buffer.from('cog-private diagnostic €');process.stdout.write('devin 3000.11.3 (9c803229faa4)');process.stderr.write(payload,()=>process.exit(0));return;}if(mode==='probe-held-pipe'){const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:['ignore',process.stdout,process.stderr]});fs.writeFileSync(root+'/descendant',String(child.pid));setInterval(()=>{},1000);}else if(mode==='probe-hang')setInterval(()=>{},1000);else{if(mode==='probe-drift'){fs.renameSync(process.env.XDG_DATA_HOME,process.env.XDG_DATA_HOME+'-old');fs.mkdirSync(process.env.XDG_DATA_HOME);}process.stdout.write(mode==='wrong-version'?'devin 9.9.9':'devin 3000.11.3 (9c803229faa4)');process.exit(0);}return;}",
    "fs.writeFileSync(root+'/command',JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,data:process.env.XDG_DATA_HOME,config:process.env.XDG_CONFIG_HOME}));",
    `if(mode==='stderr-huge'){process.stderr.write('x'.repeat(1048577));setInterval(()=>{},1000);}else if(mode==='bad-utf8'){process.stdout.write(Buffer.from([255]));}else if(mode==='stderr-utf8'){process.stderr.write(Buffer.from([255]));process.stdout.write(JSON.stringify(${JSON.stringify(inventory())}));}else if(mode==='model-held-pipe'){const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:['ignore',process.stdout,process.stderr]});fs.writeFileSync(root+'/descendant',String(child.pid));process.stdout.write(JSON.stringify(${JSON.stringify(inventory())}));process.exit(0);}else if(mode==='hang')setInterval(()=>{},1000);else if(mode==='exit-error'){process.stderr.write('cog-private-diagnostic');process.exit(1);}else if(mode==='huge'){process.stdout.write('x'.repeat(1048577));setInterval(()=>{},1000);}else if(mode==='bad-json'){process.stdout.write('cog-secret-invalid');}else if(mode==='read-drift'){fs.renameSync(process.env.XDG_CONFIG_HOME,process.env.XDG_CONFIG_HOME+'-old');fs.mkdirSync(process.env.XDG_CONFIG_HOME);process.stdout.write(JSON.stringify(${JSON.stringify(inventory())}));}else process.stdout.write(JSON.stringify(${JSON.stringify(inventory())}));`,
  ].join("\n"); writeFileSync(executable, script, { mode: 0o700 });
  const scope = { executable, workspacePath, dataHome, configHome };
  return { root, scope, read: (extra: { signal?: AbortSignal; timeoutMs?: number } = {}) => adapters.readDevinLocalCatalog({ profileId: "p", scope, context, ...extra }), pids: () => existsSync(join(root, "pids")) ? readFileSync(join(root, "pids"), "utf8").trim().split("\n").map(Number) : [] };
}
it("projects exact variant IDs with unconfirmed access and no alias/default/price/effort inference", () => {
  const catalog = adapters.normalizeDevinLocalCatalog(inventory(), options);
  expect(catalog).toMatchObject({ profileId: "p", providerId: "devin-local", backendId: "devin-local-acp", runnerId: "local", contextFingerprint: "fixture" }); expect(catalog.entries.map(e => e.id)).toEqual(["adaptive", "chosen"]);
  expect(catalog.entries).toEqual([expect.objectContaining({ kind: "native-auto", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } }), expect.objectContaining({ kind: "model", displayName: "Chosen", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } })]);
  expect(JSON.stringify(catalog)).not.toMatch(/cog-|cost_summary|family_uid|dynamic-alias|latest/); expect(catalog.entries.every(e => e.billing?.mode === "unknown" && !e.billing.pricing)).toBe(true);
});
it("keeps catalog identity stable across query reasons while retaining scope and inventory drift", async () => {
  const f = fixture();
  const read = (supplied: ModelCatalogContext) => adapters.readDevinLocalCatalog({ profileId: "p", scope: f.scope, context: supplied });
  const opened = await read({ ...context, reason: "open" });
  for (const reason of ["preflight", "before-start", "selection-change", "manual-refresh"] as const) {
    const next = await read({ ...context, reason });
    expect(next.contextFingerprint).toBe(opened.contextFingerprint);
    expect(next.revision).toBe(opened.revision);
    expect(next.entries).toEqual(opened.entries);
  }
  const moved = await read({ ...context, repositoryId: "different-repository", reason: "preflight" });
  expect(moved.contextFingerprint).not.toBe(opened.contextFingerprint);
  expect(moved.revision).not.toBe(opened.revision);
  const changed = inventory(); changed.families[0]!.variants[0]!.model_uid = "different-model";
  expect(adapters.normalizeDevinLocalCatalog(changed, { ...options, contextFingerprint: opened.contextFingerprint }).revision).not.toBe(opened.revision);
});
it("keeps catalog identity stable across timestamp and native inventory order", () => {
  const a = inventory(), b = inventory(); b.families[0]!.variants.reverse();
  expect(adapters.normalizeDevinLocalCatalog(a, options).revision).toBe(adapters.normalizeDevinLocalCatalog(b, { ...options, fetchedAt: "2026-10-14T00:00:00.000Z" }).revision);
});
it("rejects control characters in native variant selectors", () => {
  const raw = inventory(); raw.families[0]!.variants[0]!.model_uid = "bad\tidentity";
  expect(() => adapters.normalizeDevinLocalCatalog(raw, options)).toThrow(adapters.AdapterContractError);
});
it("bounds the normalized catalog even when the raw inventory is compact", () => {
  const raw = inventory(); raw.families[0]!.variants = Array.from({ length: 4000 }, (_, i) => ({ model_uid: "id-" + i, label: "x".repeat(240) }));
  expect(() => adapters.normalizeDevinLocalCatalog(raw, options)).toThrow(adapters.AdapterContractError);
});
it.each(["empty", "duplicate", "bad-id", "bad-label", "bad-family", "many", "account", "bad-context"])("rejects %s native inventory/context", mode => {
  const raw = inventory(), supplied = structuredClone(options);
  if (mode === "empty") raw.families = []; if (mode === "duplicate") raw.families[0]!.variants.push(raw.families[0]!.variants[0]!); if (mode === "bad-id") raw.families[0]!.variants[0]!.model_uid = "bad\nidentity"; if (mode === "bad-label") raw.families[0]!.variants[0]!.label = "x".repeat(241); if (mode === "bad-family") raw.families[0]!.family_uid = ""; if (mode === "many") raw.families[0]!.variants = Array.from({ length: 4001 }, (_, i) => ({ model_uid: "id-" + i, label: "Model" })); if (mode === "account") supplied.context = { scope: "account" } as unknown as ModelCatalogContext; if (mode === "bad-context") supplied.context = { ...context, executionContextRef: "" };
  expect(() => adapters.normalizeDevinLocalCatalog(raw, supplied)).toThrow(adapters.AdapterContractError);
});
it("uses only owned literal models-list argv and captured physical homes", async () => {
  const f = fixture(), catalog = await f.read(); expect(catalog.entries).toHaveLength(2);
  expect(JSON.parse(readFileSync(join(f.root, "command"), "utf8"))).toEqual({ args: ["models", "list", "--format", "json"], cwd: f.scope.workspacePath, pwd: f.scope.workspacePath, data: f.scope.dataHome, config: f.scope.configHome });
  expect(f.pids()).toHaveLength(2); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it.each(["wrong-version", "probe-drift", "exit-error", "huge", "bad-json", "read-drift"])("rejects %s without exporting diagnostics or executing a Session", async mode => {
  const f = fixture(mode); let failure: unknown; try { await f.read(); } catch (error) { failure = error; } expect(failure).toBeInstanceOf(adapters.AdapterContractError); expect(String(failure)).not.toMatch(/cog-|native-data|native-config/);
  if (mode === "wrong-version" || mode === "probe-drift") expect(existsSync(join(f.root, "command"))).toBe(false); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it("captures scope/context/signal before version-probe awaits", async () => {
  const f = fixture(), scope = structuredClone(f.scope), supplied = { profileId: "p", scope, context: structuredClone(context) }, pending = adapters.readDevinLocalCatalog(supplied); scope.dataHome = "/foreign"; supplied.context = { ...context, repositoryId: "foreign" };
  const captured = await pending, control = await f.read(); expect(captured).toMatchObject({ profileId: "p", runnerId: "local", contextFingerprint: control.contextFingerprint, revision: control.revision }); const foreign = await adapters.readDevinLocalCatalog({ profileId: "p", scope: f.scope, context: { ...context, repositoryId: "foreign" } }); expect(foreign.contextFingerprint).not.toBe(captured.contextFingerprint); expect(JSON.parse(readFileSync(join(f.root, "command"), "utf8")).data).toBe(f.scope.dataHome);
});
it("cancels before any version/model process starts", async () => {
  const f = fixture(), signal = new AbortController(); signal.abort(); await expect(f.read({ signal: signal.signal })).rejects.toMatchObject({ code: "MODEL_CATALOG_CANCELLED" }); expect(f.pids()).toEqual([]);
});
it("bounds a hung version probe with the original whole query deadline", async () => {
  const f = fixture("probe-hang"), started = performance.now(); await expect(f.read({ timeoutMs: 120 })).rejects.toMatchObject({ code: "MODEL_CATALOG_TIMEOUT" }); expect(performance.now() - started).toBeLessThan(1500); expect(existsSync(join(f.root, "command"))).toBe(false); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it("cancels during the owned version probe without launching the model command", async () => {
  const f = fixture("probe-hang"), abort = new AbortController(), pending = f.read({ signal: abort.signal });
  try { await vi.waitFor(() => expect(f.pids()).toHaveLength(1), { timeout: 3500 }); abort.abort(); await expect(pending).rejects.toMatchObject({ code: "MODEL_CATALOG_CANCELLED" }); expect(existsSync(join(f.root, "command"))).toBe(false); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow(); }
  finally { abort.abort(); await pending.catch(() => {}); }
});
it.each(["cancel", "timeout"])("preserves unknown inherited-pipe cleanup over %s", async mode => {
  const f = fixture("probe-held-pipe"), abort = new AbortController(), pending = f.read({ signal: abort.signal, ...(mode === "timeout" ? { timeoutMs: 1000 } : {}) }); void pending.catch(() => {});
  let descendant: number | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(join(f.root, "descendant"))).toBe(true), { timeout: 3500 }); descendant = Number(readFileSync(join(f.root, "descendant"), "utf8")); if (mode === "cancel") abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "MODEL_CATALOG_CLEANUP_UNKNOWN" }); expect(() => process.kill(descendant!, 0)).not.toThrow(); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    abort.abort(); await pending.catch(() => {});
    if (descendant) await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), { timeout: 3500 });
  }
});
it("applies the original deadline to the model command after version admission", async () => {
  const f = fixture("hang"), started = performance.now(); await expect(f.read({ timeoutMs: 1200 })).rejects.toMatchObject({ code: "MODEL_CATALOG_TIMEOUT" }); expect(existsSync(join(f.root, "command"))).toBe(true); expect(performance.now() - started).toBeLessThan(4000); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it("cancels an owned hanging model query without leaving its root alive", async () => {
  const f = fixture("hang"), abort = new AbortController(), pending = f.read({ signal: abort.signal });
  try {
    // The owned version probe has its own three-second admission bound.
    await vi.waitFor(() => expect(existsSync(join(f.root, "command"))).toBe(true), { timeout: 3500 });
    const cancelledAt = performance.now(); abort.abort(); await expect(pending).rejects.toMatchObject({ code: "MODEL_CATALOG_CANCELLED" }); expect(performance.now() - cancelledAt).toBeLessThan(1500);
    for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
  } finally { abort.abort(); await pending.catch(() => {}); }
});
it("does not borrow an unscoped standalone Adapter's catalog qualification", async () => {
  const f = fixture(), backend = { backendId: "devin-local-acp", start: vi.fn() }, adapter = new adapters.DevinLocalAcpAdapter({ id: "p", alias: "Local", executable: f.scope.executable }, backend);
  expect(await adapter.modelCatalog({ ...context, workspacePath: f.scope.workspacePath })).toMatchObject({ freshness: "unverified", selectionSupport: "unsupported", entries: [], failure: { code: "MODEL_CATALOG_UNSUPPORTED" } }); expect(f.pids()).toEqual([]);
});
it("pins Adapter native-home identity across later catalog queries", async () => {
  const f = fixture(), adapter = new adapters.DevinLocalAcpAdapter({ id: "p", alias: "Local", executable: f.scope.executable }, { backendId: "devin-local-acp", start: vi.fn() }, undefined, { executable: f.scope.executable, dataHome: f.scope.dataHome, configHome: f.scope.configHome });
  renameSync(f.scope.dataHome, f.scope.dataHome + "-old"); mkdirSync(f.scope.dataHome); await expect(adapter.modelCatalog({ ...context, workspacePath: f.scope.workspacePath })).rejects.toMatchObject({ code: "MODEL_CONTEXT_MISMATCH" }); expect(f.pids()).toEqual([]);
});

// These regressions catch missing bounds/fences and false cleanup success on real local roots.
it("drains both original roots unconditionally on a successful query", async () => {
  const f = fixture(), stop = vi.spyOn(OwnedProcessRoot.prototype, "stop");
  expect((await f.read()).selectionSupport).toBe("explicit"); expect(stop).toHaveBeenCalledTimes(2);
  for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it.each(["normal", "hang"])("prioritizes denied original model stop over %s result", async mode => {
  const f = fixture(mode), original = OwnedProcessRoot.prototype.stop; let calls = 0;
  vi.spyOn(OwnedProcessRoot.prototype, "stop").mockImplementation(function (this: OwnedProcessRoot) { if (++calls === 2) return Promise.reject(Error("OS denied cog-secret")); return original.call(this); });
  try { await expect(f.read({ timeoutMs: 1200 })).rejects.toMatchObject({ code: "MODEL_CATALOG_CLEANUP_UNKNOWN" }); }
  finally { for (const pid of f.pids()) { try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } } }
});
it.each(["stderr-huge", "bad-utf8", "stderr-utf8"])("refuses bounded/fatal stream failure %s with sanitized error", async mode => {
  const f = fixture(mode); await expect(f.read()).rejects.toMatchObject({ code: "INVALID_MODEL_CATALOG" });
  for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it("preserves model inherited pipe unknown over otherwise valid data", async () => {
  const f = fixture("model-held-pipe"); let descendant: number | undefined;
  try { await expect(f.read()).rejects.toMatchObject({ code: "MODEL_CATALOG_CLEANUP_UNKNOWN" }); descendant = Number(readFileSync(join(f.root, "descendant"), "utf8")); expect(() => process.kill(descendant!, 0)).not.toThrow(); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow(); }
  finally { if (descendant) await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), { timeout: 3500 }); }
});
it("captures the original signal and deadline options before probe await", async () => {
  const f = fixture("hang"), original = new AbortController(), replacement = new AbortController(), supplied = { profileId: "p", scope: f.scope, context, signal: original.signal, timeoutMs: 1200 }, pending = adapters.readDevinLocalCatalog(supplied); void pending.catch(() => {});
  supplied.signal = replacement.signal; supplied.timeoutMs = 30000;
  try { await vi.waitFor(() => expect(existsSync(join(f.root, "command"))).toBe(true), { timeout: 3500 }); original.abort(); await expect(pending).rejects.toMatchObject({ code: "MODEL_CATALOG_CANCELLED" }); }
  finally { original.abort(); await pending.catch(() => {}); }
});
it.each(["profileId", "runnerId", "repositoryId", "executionContextRef", "reason"])("rejects invalid current context %s before spawn", async field => {
  const f = fixture(); await expect(adapters.readDevinLocalCatalog({ profileId: "p", scope: f.scope, context: { ...context, [field]: "" } })).rejects.toMatchObject({ code: "MODEL_CONTEXT_MISMATCH" }); expect(f.pids()).toEqual([]);
});
it("rejects profile owner disagreement before spawn", async () => {
  const f = fixture(); await expect(adapters.readDevinLocalCatalog({ profileId: "foreign", scope: f.scope, context })).rejects.toMatchObject({ code: "MODEL_CONTEXT_MISMATCH" }); expect(f.pids()).toEqual([]);
});
it.each([0, 30001, NaN, Infinity])("rejects invalid whole query deadline %s without spawn", async timeoutMs => {
  const f = fixture(); await expect(f.read({ timeoutMs })).rejects.toBeInstanceOf(adapters.AdapterContractError); expect(f.pids()).toEqual([]);
});
it.each(["families", "family-duplicate", "variant-cross-family", "id-long", "id-del", "label-blank", "label-nul"])("rejects malformed native bound %s", mode => {
  const raw = inventory();
  if (mode === "families") raw.families = Array.from({ length: 201 }, (_, i) => ({ ...raw.families[0]!, family_uid: "f" + i }));
  if (mode === "family-duplicate") raw.families.push({ ...raw.families[0]!, variants: [{ model_uid: "other", label: "Other" }] });
  if (mode === "variant-cross-family") raw.families.push({ ...raw.families[0]!, family_uid: "other" });
  if (mode === "id-long") raw.families[0]!.variants[0]!.model_uid = "x".repeat(241);
  if (mode === "id-del") raw.families[0]!.variants[0]!.model_uid = "bad\u007fidentity";
  if (mode === "label-blank") raw.families[0]!.variants[0]!.label = "   ";
  if (mode === "label-nul") raw.families[0]!.variants[0]!.label = "bad\0label";
  expect(() => adapters.normalizeDevinLocalCatalog(raw, options)).toThrow(adapters.AdapterContractError);
});
it("exposes a scoped canonical catalog without Session creation", async () => {
  const f = fixture(), backend = { backendId: "devin-local-acp", start: vi.fn() }, profile = { id: "p", alias: "Local", executable: f.scope.executable }, scope = { executable: f.scope.executable, dataHome: f.scope.dataHome, configHome: f.scope.configHome }, adapter = new adapters.DevinLocalAcpAdapter(profile, backend, undefined, scope);
  profile.executable = "/foreign"; scope.dataHome = "/foreign";
  expect(await adapter.modelCatalog({ ...context, workspacePath: f.scope.workspacePath })).toMatchObject({ profileId: "p", runnerId: "local", freshness: "native-fresh", selectionSupport: "explicit" }); expect(backend.start).not.toHaveBeenCalled();
});
it("refuses mismatched scoped executable instead of borrowing a fallback", () => {
  const f = fixture(); expect(() => new adapters.DevinLocalAcpAdapter({ id: "p", alias: "Local", executable: "/foreign" }, { backendId: "devin-local-acp", start: vi.fn() }, undefined, f.scope)).toThrow(adapters.AdapterContractError); expect(f.pids()).toEqual([]);
});
it("refuses an Adapter executable alias replaced after construction with zero spawn", async () => {
  const f = fixture(), alias = join(f.root, "alias"); symlinkSync(f.scope.executable, alias);
  const scope = { ...f.scope, executable: alias }, adapter = new adapters.DevinLocalAcpAdapter({ id: "p", alias: "Local", executable: alias }, { backendId: "devin-local-acp", start: vi.fn() }, undefined, scope);
  const other = join(f.root, "other"); writeFileSync(other, readFileSync(f.scope.executable), { mode: 0o700 }); unlinkSync(alias); symlinkSync(other, alias);
  await expect(adapter.modelCatalog({ ...context, workspacePath: f.scope.workspacePath })).rejects.toMatchObject({ code: "MODEL_CONTEXT_MISMATCH" }); expect(f.pids()).toEqual([]);
});
it("rechecks executable aliases after the awaited version probe", async () => {
  const f = fixture(), alias = join(f.root, "alias"), other = join(f.root, "other"); symlinkSync(f.scope.executable, alias); writeFileSync(other, readFileSync(f.scope.executable), { mode: 0o700 });
  const original = OwnedProcessRoot.prototype.stop; let calls = 0;
  vi.spyOn(OwnedProcessRoot.prototype, "stop").mockImplementation(async function (this: OwnedProcessRoot) { await original.call(this); if (++calls === 1) { unlinkSync(alias); symlinkSync(other, alias); } });
  await expect(adapters.readDevinLocalCatalog({ profileId: "p", scope: { ...f.scope, executable: alias }, context })).rejects.toMatchObject({ code: "MODEL_CONTEXT_MISMATCH" }); expect(f.pids()).toHaveLength(1); expect(existsSync(join(f.root, "command"))).toBe(false);
});

it.each(["stdout", "stderr"] as const)("preserves late %s pipe failure over earlier cancellation", async stream => {
  const f = fixture("hang"), abort = new AbortController(), original = OwnedProcessRoot.prototype.stop; let calls = 0;
  vi.spyOn(OwnedProcessRoot.prototype, "stop").mockImplementation(function (this: OwnedProcessRoot) {
    if (++calls === 2) { const child = (this as unknown as { child: ChildProcess }).child; child[stream]!.emit("error", Error("OS pipe fault cog-secret")); }
    return original.call(this);
  });
  const pending = f.read({ signal: abort.signal }); void pending.catch(() => {});
  try { await vi.waitFor(() => expect(existsSync(join(f.root, "command"))).toBe(true), { timeout: 3500 }); abort.abort(); await expect(pending).rejects.toMatchObject({ code: "MODEL_CATALOG_CLEANUP_UNKNOWN" }); }
  finally { abort.abort(); await pending.catch(() => {}); }
});

it("keeps distinct Unicode IDs exact and revision stable across collation ties", () => {
  const raw = inventory(); raw.families[0]!.variants = [{ model_uid: "\u00e9", label: "Composed" }, { model_uid: "e\u0301", label: "Decomposed" }];
  const reversed = structuredClone(raw); reversed.families[0]!.variants.reverse();
  const a = adapters.normalizeDevinLocalCatalog(raw, options), b = adapters.normalizeDevinLocalCatalog(reversed, { ...options, fetchedAt: "2026-10-14T00:00:00.000Z" });
  expect(a.revision).toBe(b.revision); expect(a.entries.map(entry => entry.id)).toEqual(["e\u0301", "\u00e9"]); expect(b.entries.map(entry => entry.id)).toEqual(["e\u0301", "\u00e9"]);
});


it.each(["probe-stderr-huge", "probe-stderr-invalid-utf8"])("rejects exact-version %s before model admission with sanitized errors and original-root cleanup", async mode => {
  const f = fixture(mode); let failure: unknown;
  try { await f.read(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "MODEL_CATALOG_UNAVAILABLE" }); expect(String(failure)).not.toMatch(/cog-|native-data|native-config|255/);
  expect(existsSync(join(f.root, "command"))).toBe(false); expect(f.pids()).toHaveLength(1); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
it.each(["probe-stderr-boundary", "probe-stderr-valid-utf8"])("admits exact-version %s only after bounded validated probe closure", async mode => {
  const f = fixture(mode); expect(await f.read()).toMatchObject({ freshness: "native-fresh", selectionSupport: "explicit" });
  expect(f.pids()).toHaveLength(2); for (const pid of f.pids()) expect(() => process.kill(pid, 0)).toThrow();
});
