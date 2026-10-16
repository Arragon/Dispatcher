import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountModelCatalog, ModelCatalogContext } from "@dispatcher/domain";
import { AdapterContractError } from "./contracts.js";
import type { CliAgentProfile } from "./ecosystem-cli.js";

export type CatalogCliProvider = "cursor" | "qoder-cn" | "grok" | "antigravity";
export interface NativeCliReadRequest { executable: string; args: string[]; workspacePath: string; environment?: Record<string, string> }
export interface NativeCliReadResult { stdout: string; stderr: string; exitCode: number }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
const clean = (value: string) => value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
const invalid = () => new AdapterContractError("INVALID_MODEL_CATALOG", "Native model catalog format is unsupported");
const nativeAuthFailure=/not authenticated|not logged in|authentication failed|invalid.grant|expired credentials|session has expired|login required|please.*log.?in|unauthorized|forbidden|no auth credentials/i;

/** Only the adapter's fixed read-only commands reach this private subprocess boundary. */
export function readNativeCli(input: NativeCliReadRequest): Promise<NativeCliReadResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, { cwd: input.workspacePath, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...input.environment, PWD: input.workspacePath, NO_COLOR: "1" } });
    let stdout = "", stderr = "", bytes = 0, failed = false;
    const stop = () => { failed = true; signal("SIGTERM"); };
    const signal = (value: NodeJS.Signals) => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, value); else child.kill(value); } catch { /* The owned process may already have exited. */ } };
    const timer = setTimeout(stop, 25000);
    const hardStop = setTimeout(() => { failed = true; signal("SIGKILL"); }, 27000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const collect = (chunk: string, stream: "stdout" | "stderr") => { bytes += Buffer.byteLength(chunk); if (bytes > 4 * 1024 * 1024) { stop(); return; } if (stream === "stdout") stdout += chunk; else stderr += chunk; };
    child.stdout.on("data", chunk => collect(chunk, "stdout")); child.stderr.on("data", chunk => collect(chunk, "stderr"));
    child.on("error", () => { failed = true; });
    child.on("close", code => {
      clearTimeout(timer); clearTimeout(hardStop);
      // Model queries never leave an owned daemon behind, even after exit zero.
      signal("SIGKILL");
      if (failed) reject(new AdapterContractError("NATIVE_CATALOG_UNAVAILABLE", "Native read-only query failed or timed out"));
      else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export function normalizeNativeCliCatalog(provider: CatalogCliProvider, stdout: string, stderr: string, context: ModelCatalogContext, contextFingerprint: string, fetchedAt: string): AccountModelCatalog {
  const output = clean(stdout), diagnostics = clean(stderr), combined = `${output}\n${diagnostics}`;
  const base = { profileId: context.profileId, runnerId: context.runnerId, providerId: provider, backendId: provider === "cursor" ? "cursor-local-cli" : `${provider}-cli-json`, contextFingerprint, fetchedAt, source: "cli-query" as const };
  const failed = (code: string, message: string): AccountModelCatalog => ({ ...base, revision: digest({ contextFingerprint, code }), freshness: "unverified", selectionSupport: "native-default-only", entries: [], failure: { code, message } });
  if (nativeAuthFailure.test(combined)) return failed("NATIVE_AUTH_REQUIRED", "Native authentication is missing or expired; sign in through the native application");
  if (/failed to (?:fetch|load)|fetch.*failed|refresh.*failed|using cach|cached models|existing models unchanged/i.test(combined)) {
    const cached = failed("NATIVE_CATALOG_STALE", "Native query returned a cached or failed model refresh");
    cached.freshness = "native-cache"; return cached;
  }
  if ((provider === "qoder-cn" && output.trim().split(/\r?\n/)[0] !== "MODEL") || (provider === "cursor" && !output.includes("Available models")) || (provider === "grok" && !output.includes("Available models:"))) throw invalid();
  const entries: AccountModelCatalog["entries"] = [], seen = new Set<string>();
  for (const line of output.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    let id: string | undefined, displayName: string | undefined;
    if (provider === "cursor") { const m = /^([\w][\w./:+-]*) - (.+)$/.exec(line); if (m) { id = m[1]; displayName = m[2]!.replace(/ \((?:current|default|current, default)\)$/, ""); } }
    else if (provider === "qoder-cn") { if (line !== "MODEL" && /^[\w][\w./:+-]*$/.test(line)) id = displayName = line; }
    else if (provider === "antigravity") { const m = /^([\w][\w./:+-]*)\t(.+)$/.exec(line); if (m) { id = m[1]; displayName = m[2]; } }
    else { const m = /^[*-]\s+([\w][\w./:+-]*)(?: \(default\))?$/.exec(line); if (m) id = displayName = m[1]; }
    if (!id) continue;
    if (id.length > 240 || !displayName || displayName.length > 240 || seen.has(id) || entries.length >= 1000) throw invalid();
    seen.add(id);
    entries.push({ id, displayName, kind: id.toLowerCase() === "auto" ? "native-auto" : "model", selectable: true, access: "unconfirmed", parameterOptions: {}, billing: { mode: "unknown" } });
  }
  if (!entries.length) throw invalid();
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { ...base, revision: digest({ contextFingerprint, entries }), freshness: "native-fresh", selectionSupport: "explicit", entries };
}

/** Hash sensitive native state locally; neither its contents nor native diagnostics leave the adapter. */
export async function readNativeCliCatalog(input: { provider: CatalogCliProvider; profile: CliAgentProfile; executable: string; context: ModelCatalogContext; workspacePath: string; environment?: Record<string, string>; read?: (input: NativeCliReadRequest) => Promise<NativeCliReadResult> }): Promise<AccountModelCatalog> {
  const read = input.read ?? readNativeCli;
  const query = (args: string[]) => read({ executable: input.executable, args, workspacePath: input.workspacePath, ...(input.environment ? { environment: input.environment } : {}) });
  const qoder = input.provider === "qoder-cn";
  const configDir = input.profile.configDir ?? join(homedir(), ".qoder-cn");
  const accountArgs = input.provider === "cursor" ? ["status"] : qoder ? ["--config-dir", configDir, "status", "--output", "json"] : undefined;
  const identity = (account: NativeCliReadResult | undefined): unknown => {
    if (!account) return undefined;
    if (input.provider==="cursor") {
      const output=clean(account.stdout);
      if(nativeAuthFailure.test(output+clean(account.stderr)))return {authenticated:false};
      // Status progress/spinner lines vary with network timing. Only the qualified
      // login marker identifies the account; unknown/contradictory formats fail closed.
      const accounts=[...new Set([...output.matchAll(/^[^\p{L}\p{N}\r\n]*Logged in as[ \t]+(\S+)[ \t]*$/gimu)].map(match=>match[1]!))];
      if(accounts.length!==1)throw invalid();
      return {authenticated:true,accountId:accounts[0]};
    }
    if (!qoder) return clean(account.stdout).trim();
    const value = JSON.parse(account.stdout) as Record<string, unknown>;
    if (typeof value.logged_in !== "boolean" || value.logged_in && (typeof value.username !== "string" || !value.username)) throw invalid();
    return { loggedIn: value.logged_in, username: value.username, accountType: value.account_type, authSource: value.auth_source };
  };
  const files = input.provider === "cursor" ? [join(homedir(), ".cursor", "cli-config.json"), join(input.workspacePath, ".cursor", "cli.json")]
    : qoder ? [join(configDir, "settings.json"), join(input.workspacePath, ".qoder", "settings.json")]
    : input.provider === "grok" ? [join(homedir(), ".grok", "config.toml"), join(homedir(), ".grok", "auth.json"), join(input.workspacePath, ".grok", "config.toml")]
    : [join(homedir(), ".gemini", "config", "config.json"), join(input.workspacePath, ".gemini", "settings.json"), ...(process.env.AGY_ADC_AUTH === "true" ? [process.env.GOOGLE_APPLICATION_CREDENTIALS ?? join(homedir(), ".config", "gcloud", "application_default_credentials.json")] : [])];
  const binding = async () => {
    const hashes = await Promise.all(files.map(async path => {
      try {
        const value = await readFile(path);
        if (input.provider === "cursor" && path.endsWith("cli-config.json")) { const config = JSON.parse(value.toString()); return digest({ authInfo: config.authInfo, model: config.model, selectedModel: config.selectedModel, network: config.network }); }
        return digest(value.toString());
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw invalid(); }
    }));
    const executable = await realpath(input.executable).catch(() => input.executable);
    const executableStamp = await stat(executable).then(s => ({ size: s.size, mtime: s.mtimeMs })).catch(() => null);
    // Antigravity has no non-interactive account identity command. A conservative OS
    // keyring epoch fences silent account replacement without reading credentials.
    const keyringEpoch = ["antigravity", "grok"].includes(input.provider) && process.platform === "darwin" ? await stat(join(homedir(), "Library", "Keychains", "login.keychain-db")).then(s => ({ size: s.size, mtime: s.mtimeMs, ino: s.ino })).catch(() => null) : undefined;
    return { hashes, executable, executableStamp, keyringEpoch };
  };
  const before = await binding();
  const account = accountArgs ? await query(accountArgs) : undefined;
  const accountIdentity = identity(account);
  const result = await query(qoder ? ["--config-dir", configDir, "--list-models"] : ["models"]);
  if (/unknown (?:command|option|flag)|unrecognized (?:command|option|flag)|unexpected argument/i.test(result.stderr + result.stdout)) throw new AdapterContractError("NATIVE_VERSION_UNSUPPORTED", "Installed CLI does not support the qualified native model query");
  const accountAfter = accountArgs ? await query(accountArgs) : undefined;
  const after = await binding();
  const accountDiagnostic = qoder ? objectAccountMissing(accountAfter) ? "not authenticated" : "" : accountAfter?.stdout ?? "";
  const fingerprint = digest({ provider: input.provider, profileId: input.profile.id, runnerId: input.context.runnerId, repositoryId: input.context.repositoryId, executionContextRef: input.context.executionContextRef, configDir: input.profile.configDir, ...after, account: identity(accountAfter), nativeEnvironment: { AGY_ADC_AUTH: process.env.AGY_ADC_AUTH, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_QUOTA_PROJECT: process.env.GOOGLE_CLOUD_QUOTA_PROJECT, GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION }, environment: input.environment });
  const catalog = normalizeNativeCliCatalog(input.provider, result.stdout, result.stderr + (accountAfter?.stderr ?? "") + accountDiagnostic, input.context, fingerprint, new Date().toISOString());
  if (catalog.failure?.code === "NATIVE_AUTH_REQUIRED") return catalog;
  if (digest(before) !== digest(after) || digest(accountIdentity) !== digest(identity(accountAfter))) throw new AdapterContractError("NATIVE_CONTEXT_CHANGED", "Native account or configuration changed during the query; refresh before reviewing");
  if (result.exitCode !== 0 || account && account.exitCode !== 0 || accountAfter && accountAfter.exitCode !== 0) throw new AdapterContractError("NATIVE_CATALOG_UNAVAILABLE", "Native model query did not succeed");
  if (input.provider === "antigravity" && !after.keyringEpoch || input.provider === "grok" && !after.keyringEpoch && !after.hashes[1]) { catalog.freshness = "unverified"; catalog.selectionSupport = "native-default-only"; catalog.failure = { code: "NATIVE_ACCOUNT_CONTEXT_UNVERIFIABLE", message: "Native account identity cannot be fenced on this host; explicit selection is unavailable" }; }
  return catalog;
}

function objectAccountMissing(account: NativeCliReadResult | undefined): boolean {
  if (!account) return true;
  return (JSON.parse(account.stdout) as { logged_in?: boolean }).logged_in !== true;
}
