import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexCliBackend, SpawnCliAgentBackend, probeCodexProfile, probeGenericCli } from "../src/index.js";
import { readNativeCli } from "../src/cli-catalog.js";

afterEach(() => vi.unstubAllEnvs());
it("sanitizes real Codex/CLI/catalog/probe launches while preserving their account context", async () => {
  vi.stubEnv("DISPATCHER_OWNER_TOKEN", "fixture-owner-canary"); vi.stubEnv("DISPATCHER_SECRET_STORE_KEY", "fixture-key-canary"); vi.stubEnv("PROVIDER_FIXTURE_CONTEXT", "preserved");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adapter-child-environment-")));
  const check = "if(Object.keys(process.env).some(k=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(k.toUpperCase())))process.exit(71);if(process.env.PROVIDER_FIXTURE_CONTEXT!=='preserved')process.exit(72);";
  try {
    writeFileSync(join(root, "exec"), `${check}if(process.env.CODEX_HOME!==process.cwd()||process.env.PWD!==process.cwd())process.exit(73);console.log(JSON.stringify({type:'thread.started',thread_id:'native-fixture'}));console.log(JSON.stringify({type:'turn.completed'}));`);
    expect(await new CodexCliBackend().start({ executable: process.execPath, codexHome: root, workspacePath: root, prompt: "fixture" }).result()).toMatchObject({ state: "completed", providerSessionId: "native-fixture" });
    expect(await new SpawnCliAgentBackend().start({ executable: process.execPath, workspacePath: root, args: ["-e", `${check}if(process.env.PWD!==process.cwd())process.exit(73);console.log('safe-cli')`], environment: { DISPATCHER_OWNER_TOKEN: "fixture-overlay" } }).result()).toMatchObject({ state: "completed" });
    expect(await readNativeCli({ executable: process.execPath, workspacePath: root, args: ["-e", `${check}console.log('safe-catalog')`], environment: { DISPATCHER_SECRET_STORE_KEY: "fixture-overlay" } })).toMatchObject({ stdout: expect.stringContaining("safe-catalog") });
    const executable = join(root, "probe"); writeFileSync(executable, `#!${process.execPath}\n${check}console.log('fixture-agent 1');`, { mode: 0o700 });
    expect(await probeCodexProfile({ id: "p", alias: "P", executable, codexHome: root })).toMatchObject({ authenticated: true, version: "fixture-agent 1" });
    expect(await probeGenericCli({ file: executable, args: [] })).toMatchObject({ installed: true, version: "fixture-agent 1" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
