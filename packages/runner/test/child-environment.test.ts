import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager, VerificationRegistry } from "../src/index.js";

afterEach(() => vi.unstubAllEnvs());
it("keeps Controller credentials out of real process, PTY and registered verification children", async () => {
  vi.stubEnv("DISPATCHER_OWNER_TOKEN", "fixture-owner-canary"); vi.stubEnv("DISPATCHER_SECRET_STORE_KEY", "fixture-key-canary"); vi.stubEnv("PROVIDER_FIXTURE_CONTEXT", "preserved");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "child-environment-"))), manager = new ProcessManager(join(root, "logs"));
  const code = "if(Object.keys(process.env).some(k=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(k.toUpperCase())))process.exit(71);if(process.env.PROVIDER_FIXTURE_CONTEXT!=='preserved'||process.env.PWD!==process.cwd())process.exit(72);console.log('safe-child-context')";
  try {
    for (const mode of ["process", "pty"] as const) {
      const handle = await manager.start({ runId: mode, file: process.execPath, args: ["-e", code], cwd: root, mode });
      expect(await handle.result()).toMatchObject({ classification: "success", exitCode: 0 });
    }
    const registry = new VerificationRegistry(); registry.register({ id: "environment", file: process.execPath, args: ["-e", code], required: true, timeoutMs: 3000, outputLimitBytes: 256 });
    expect(await registry.run("environment", root)).toMatchObject({ status: "passed", output: expect.stringContaining("safe-child-context") });
  } finally { await manager.shutdown(); rmSync(root, { recursive: true, force: true }); }
});
