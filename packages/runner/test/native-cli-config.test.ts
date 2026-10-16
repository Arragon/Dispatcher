import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultDispatcherConfig } from "@dispatcher/config";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { runRunnerCli } from "../src/cli.js";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
it("plans and applies owning Runner registrations through ConfigPlan with explicit confirmation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "runner-cli-config-")); directories.push(directory);
  const config = structuredClone(defaultDispatcherConfig);
  config.runners = [{ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" }];
  config.agentProfiles = [{ id: "cursor", alias: "Cursor", provider: "cursor", runnerId: "remote", settings: { executable: "/own/agent" } }];
  const file = join(directory, "registration.json"); writeFileSync(file, JSON.stringify(config));
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const args = ["--data-dir", directory, "--runner-id", "remote"];
  await runRunnerCli(["config", "plan", ...args, "--file", file]);
  const plan = JSON.parse(String(output.mock.calls.at(-1)?.[0])) as { id: string; state: string };
  expect(plan.state).toBe("PLANNED"); expect(JSON.stringify(output.mock.calls)).not.toContain("/own/agent");
  await expect(runRunnerCli(["config", "apply", ...args, "--plan-id", plan.id])).rejects.toMatchObject({ code: "CONFIG_CONFIRMATION_REQUIRED" });
  await runRunnerCli(["config", "apply", ...args, "--plan-id", plan.id, "--confirm"]);
  const database = new DispatcherDatabase(join(directory, "native-execution.sqlite"));
  try { expect(database.getConfigPlan(plan.id)?.state).toBe("APPLIED"); expect(database.getConfigState()?.document).toMatchObject({ agentProfiles: config.agentProfiles }); }
  finally { database.close(); }
});

it("rejects a registration file containing another Runner's profile", async () => {
  const directory = mkdtempSync(join(tmpdir(), "runner-cli-foreign-")); directories.push(directory);
  const config = structuredClone(defaultDispatcherConfig); config.agentProfiles = [{ id: "foreign", alias: "Foreign", provider: "cursor", runnerId: "local" }];
  const file = join(directory, "registration.json"); writeFileSync(file, JSON.stringify(config));
  await expect(runRunnerCli(["config", "plan", "--data-dir", directory, "--runner-id", "remote", "--file", file])).rejects.toMatchObject({ code: "RUNNER_REGISTRATION_MISMATCH" });
});
