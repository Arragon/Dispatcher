import { describe, expect, it, vi } from "vitest";
import { CursorAdapter, QoderCnAdapter, GrokAdapter, AntigravityAdapter, OpenCodeAdapter, type CliAgentBackend } from "../src/index.js";
import { normalizeOpenCodeCatalog } from "../src/opencode-catalog.js";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readOpenCodeCatalog } from "../src/opencode-catalog.js";
import { normalizeNativeCliCatalog, readNativeCliCatalog } from "../src/cli-catalog.js";
const context = { profileId: "account", runnerId: "local", repositoryId: "repo", executionContextRef: "root", reason: "open" as const };
const selection = { version: 1 as const, mode: "manual" as const, source: "explicit" as const, selectionType: "explicit-model" as const, profileId: "account", runnerId: "local", providerId: "cursor", backendId: "cursor-local-cli", requestedModel: "native-choice", nativeParameters: {}, contextFingerprint: "context", configRevision: 1, selectedAt: "now" };
describe("native CLI catalogs", () => {
  it("keeps only native enabled OpenCode text candidates and does not mistake variants/cost for account options", () => {
    const m = { id: "native/model", providerID: "native-provider", name: "Native", enabled: true, capabilities: { input: ["text"], output: ["text"] }, variants: [{ id: "high" }], cost: [{ input: 1 }] };
    const catalog = normalizeOpenCodeCatalog([m, { ...m, id: "disabled", enabled: false }, { ...m, id: "image", capabilities: { input: ["text"], output: ["image"] } }], context, "context");
    expect(catalog.entries).toEqual([expect.objectContaining({ id: "native-provider/native/model", access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } })]);
    expect(() => normalizeOpenCodeCatalog([m, m], context, "context")).toThrow();
  });
  it("preserves native IDs and labels without inferring effort, access or price", () => {
    for (const [provider, output, id] of [
      ["cursor", "Available models\n\nauto - Auto (current, default)\nmodel-low-fast - Native Low Fast\n\nTip: use --model <id>", "model-low-fast"],
      ["qoder-cn", "MODEL\nAuto\nQwen-Native\n", "Qwen-Native"],
      ["antigravity", "native-high\tNative (High)\n", "native-high"],
      ["grok", "Available models:\n * grok-native (default)\n - other-native\n", "grok-native"],
    ] as const) {
      const catalog = normalizeNativeCliCatalog(provider, output, "", context, "context", "now");
      expect(catalog).toMatchObject({ freshness: "native-fresh", selectionSupport: "explicit" });
      expect(catalog.entries.find(e => e.id === id)).toMatchObject({ access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } });
      expect(catalog.revision).toBe(normalizeNativeCliCatalog(provider, output, "", context, "context", "later").revision);
    }
  });
  it("fails closed on successful-exit auth failures and stale fallback lists", () => {
    const auth = normalizeNativeCliCatalog("grok", "You are not authenticated.\nAvailable models:\n - grok-old\n", "model refresh failed, leaving existing models unchanged", context, "context", "now");
    expect(auth).toMatchObject({ freshness: "unverified", selectionSupport: "native-default-only", entries: [], failure: { code: "NATIVE_AUTH_REQUIRED" } });
    const cached = normalizeNativeCliCatalog("cursor", "Available models\nmodel - Native\n", "Failed to fetch models; using cached models", context, "context", "now");
    expect(cached.freshness).toBe("native-cache");
    expect(() => normalizeNativeCliCatalog("cursor", "Available models\na - A\na - Duplicate", "", context, "context", "now")).toThrow();
  });
  it("queries the selected account and project without exposing authentication output", async () => {
    const read = vi.fn(async (input: { args: string[] }) => ({ stdout: input.args[0] === "status" ? "Logged in as private@example.invalid" : "Available models\nmodel - Native\n", stderr: "", exitCode: 0 }));
    const catalog = await readNativeCliCatalog({ provider: "cursor", profile: { id: "account", alias: "A" }, executable: "native", context, workspacePath: "/tmp", environment: { CURSOR_API_KEY: "private-secret" }, read });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/tmp", environment: { CURSOR_API_KEY: "private-secret" }, args: ["models"] }));
    expect(JSON.stringify(catalog)).not.toMatch(/private@example|private-secret/);
  });
  it("rejects an account switch while a native catalog is being queried", async () => {
    let accounts = 0;
    await expect(readNativeCliCatalog({ provider: "cursor", profile: { id: "account", alias: "A" }, executable: "native", context, workspacePath: "/tmp", read: async input => ({ stdout: input.args[0] === "status" ? `Logged in as account-${accounts++}` : "Available models\nmodel - Native\n", stderr: "", exitCode: 0 }) })).rejects.toMatchObject({ code: "NATIVE_CONTEXT_CHANGED" });
  });
  it("fences Cursor's parsed login identity rather than volatile progress rendering",async()=>{
    let reads=0;
    const catalog=await readNativeCliCatalog({provider:"cursor",profile:{id:"account",alias:"A"},executable:"native",context,workspacePath:"/tmp",read:async input=>({stdout:input.args[0]==="status"?reads++===0?"Checking status…\r\n✓ Logged in as stable@example.invalid\n":"⠸ \r✓ Logged in as stable@example.invalid\n":"Available models\nmodel - Native\n",stderr:"",exitCode:0})});
    expect(catalog.freshness).toBe("native-fresh");expect(JSON.stringify(catalog)).not.toContain("stable@example.invalid");
    for(const status of ["Status format changed", "Logged in as first\nLogged in as second","Logged in as first second"]){await expect(readNativeCliCatalog({provider:"cursor",profile:{id:"account",alias:"A"},executable:"native",context,workspacePath:"/tmp",read:async input=>({stdout:input.args[0]==="status"?status:"Available models\nmodel - Native\n",stderr:"",exitCode:0})})).rejects.toMatchObject({code:"INVALID_MODEL_CATALOG"});}
    expect(await readNativeCliCatalog({provider:"cursor",profile:{id:"account",alias:"A"},executable:"native",context,workspacePath:"/tmp",read:async input=>({stdout:input.args[0]==="status"?"Session has expired":"Available models\nmodel - Native\n",stderr:"",exitCode:0})})).toMatchObject({failure:{code:"NATIVE_AUTH_REQUIRED"},entries:[]});
  });
  it("reaps an owned OpenCode host after read-only model queries and unsupported versions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-catalog-")), data = join(directory, "opencode"), executable = join(directory, "native"), marker = join(directory, "closed"); mkdirSync(data);
    const db = new DatabaseSync(join(data, "opencode.db")); db.exec("CREATE TABLE account_state(id TEXT,active_account_id TEXT,active_org_id TEXT);CREATE TABLE account(id TEXT,url TEXT);CREATE TABLE credential(id TEXT,integration_id TEXT,connector_id TEXT,method_id TEXT,active INTEGER,time_updated INTEGER);CREATE TABLE control_account(email TEXT,url TEXT,active INTEGER,time_updated INTEGER)"); db.close();
    vi.stubEnv("XDG_DATA_HOME", directory);
    try {
      const native = (version: string) => `#!${process.execPath}\nconst http=require('node:http'),fs=require('node:fs');const model={id:'native',providerID:'provider',name:'Native',enabled:true,capabilities:{input:['text'],output:['text']}};const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type','application/json');res.end(JSON.stringify(p==='/api/info'?{version:${JSON.stringify(version)},pid:process.pid}:p==='/api/location'?{directory:process.cwd(),project:{id:'project'}}:{location:{directory:process.cwd()},data:p==='/api/model'?[model]:model}));});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})));process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'closed');server.close(()=>process.exit(0));});`;
      writeFileSync(executable, native("2.0.26")); chmodSync(executable, 0o755);
      const input = { profile: { id: "account", alias: "A" }, executable, context, workspacePath: directory };
      expect(await readOpenCodeCatalog(input)).toMatchObject({ freshness: "native-fresh", entries: [{ id: "provider/native" }] });
      expect(readFileSync(marker, "utf8")).toBe("closed");
      writeFileSync(executable, native("future-version"));
      await expect(readOpenCodeCatalog(input)).rejects.toMatchObject({ code: "NATIVE_VERSION_UNSUPPORTED" });
      expect(readFileSync(marker, "utf8")).toBe("closed");
    } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
  });
});
describe("frozen CLI selection", () => {
  it.each([CursorAdapter, QoderCnAdapter, GrokAdapter, AntigravityAdapter, OpenCodeAdapter])("isolates concurrent models on the same account (%s)", async Adapter => {
    const calls: string[][] = [];
    const backend: CliAgentBackend = { start: input => { calls.push(input.args); const id = `native-${calls.length}`; return { status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", providerSessionId: id, events: [] }) }; } };
    const adapter = new Adapter({id:"account",alias:"A",model:"default"}, backend);
    const [a,b] = await Promise.all(["model-a","model-b"].map(requestedModel => adapter.start({runId:requestedModel,prompt:`prompt-${requestedModel}`,workspacePath:"/tmp",executionSelection:{...selection,requestedModel}})));
    await Promise.all([adapter.send(a!.id,"continue-a"),adapter.send(b!.id,"continue-b")]);
    expect(calls).toHaveLength(4);
    for (const [prompt, model] of [["prompt-model-a","model-a"],["prompt-model-b","model-b"],["continue-a","model-a"],["continue-b","model-b"]]) {
      const args = calls.find(values => values.includes(prompt!) || values.includes(`--single=${prompt}`));
      expect(args?.[args.indexOf("--model")+1]).toBe(model);
    }
  });
  it.each([CursorAdapter, QoderCnAdapter, GrokAdapter, AntigravityAdapter, OpenCodeAdapter])("binds explicit and native-default choices on start and continuation (%s)", async (Adapter) => {
    const calls: string[][] = [];
    const backend: CliAgentBackend = { start: input => { calls.push(input.args); return { status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", providerSessionId: "native-thread", events: [] }) }; } };
    const profile = { id: "account", alias: "A", model: "profile-default" };
    const adapter = new Adapter(profile, backend);
    const session = await adapter.start({ runId: "run", workspacePath: "/tmp", executionSelection: selection });
    profile.model = "changed-default"; selection.requestedModel = "mutated-after-start";
    await adapter.send(session.id, "continue");
    expect(calls).toHaveLength(2);
    for (const args of calls) { expect(args).toContain("native-choice"); expect(args).not.toContain("profile-default"); expect(args).not.toContain("changed-default"); }
    expect(session.executionSelection?.requestedModel).toBe("native-choice");
    selection.requestedModel = "native-choice";
    const native = await adapter.start({ runId: "native", workspacePath: "/tmp", executionSelection: { ...selection, source: "native-default", selectionType: "native-default", requestedModel: undefined } });
    await adapter.send(native.id, "continue");
    expect(calls.slice(2).every(args => !args.includes("--model"))).toBe(true);
    expect(await adapter.usage(session.id)).toMatchObject({ state: "AVAILABLE" });
    await expect(adapter.start({ runId: "bad", workspacePath: "/tmp", executionSelection: { ...selection, nativeParameters: { invented: "high" } } })).rejects.toMatchObject({ code: "UNSUPPORTED_NATIVE_PARAMETERS" });
  });
});
