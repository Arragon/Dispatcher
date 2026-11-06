import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedLocalSecretStore, type DispatcherConfig, type RhizaClientGrant } from "@dispatcher/config";
import { ControllerService } from "../../src/service.js";

export const owner = { authorization: "Bearer synthetic-owner-rhiza-test" };
export const clientToken = `rhiza.${Buffer.from("client-a").toString("base64url")}.${"a".repeat(43)}`;
export const clientHeaders = { authorization: `Bearer ${clientToken}` };
export const grant: RhizaClientGrant = { id: "client-a", authorityId: "rhiza-a", enabled: true, credentialRef: "secret://rhiza/client-a",
  scopes: ["targets:read", "jobs:submit", "jobs:read", "jobs:cancel", "jobs:input", "events:read", "artifacts:read"],
  repositoryIds: ["repo-a"], profileIds: ["profile-a"], expiresAt: "2026-12-01T00:00:00.000Z" };

/** Real HTTP/config/database/secret boundaries; no Harness is executed. */
export async function rhizaServiceFixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), "dispatcher-rhiza-"));
  const repository = join(root, "repository"), native = join(root, "native"); mkdirSync(repository); mkdirSync(native);
  const secrets = new EncryptedLocalSecretStore(join(root, "vault"), "isolated-rhiza-fixture-master");
  await secrets.put(grant.credentialRef, clientToken);
  const clock = { now: new Date("2026-10-22T20:00:00.000Z") };
  const service = new ControllerService({ ownerToken: "synthetic-owner-rhiza-test", dataDirectory: join(root, "controller"), secretStore: secrets,
    clock: () => clock.now, allowedHosts: ["dispatcher.example"] });
  await service.start({ listen: false });
  const configure = async (change: (config: DispatcherConfig) => void) => {
    const config = service.configuration.current().config; change(config);
    const plan = service.configuration.buildPlan(config, "owner", "web"); await service.configuration.applyPlan(plan.id, { confirmed: true });
  };
  try {
    await configure(config => {
      config.repositories = [{ id: "repo-a", root: repository, defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [] }];
      config.agentProfiles = [{ id: "profile-a", provider: "codex", alias: "A", runnerId: "local", settings: { codexHome: native } }];
      config.rhizaIngress = { enabled, clients: [structuredClone(grant)] };
    });
  } catch (error) { await service.stop(); rmSync(root, { recursive: true, force: true }); throw error; }
  return { root, repository, native, service, secrets, clock, configure,
    close: async () => { await service.stop(); rmSync(root, { recursive: true, force: true }); } };
}
