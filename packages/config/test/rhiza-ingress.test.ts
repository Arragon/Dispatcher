import { afterEach, describe, expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { ConfigurationEngine, defaultDispatcherConfig, requiredSecretReferences, validateConfig, type RhizaClientGrant } from "../src/index.js";

const grant: RhizaClientGrant = { id: "client-a", authorityId: "rhiza-a", enabled: true, credentialRef: "secret://rhiza/client-a",
  scopes: ["targets:read", "jobs:submit", "jobs:read"], repositoryIds: ["repo-a"], profileIds: ["profile-a"], expiresAt: "2026-12-01T00:00:00.000Z" };
function config() {
  return { ...structuredClone(defaultDispatcherConfig),
    repositories: [{ id: "repo-a", root: "/registered/repo-a", defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [] }],
    agentProfiles: [{ id: "profile-a", provider: "codex", alias: "A", runnerId: "local", settings: { codexHome: "/registered/native" } }],
    rhizaIngress: { enabled: true, clients: [structuredClone(grant)] } };
}
const databases: DispatcherDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("restricted RHIZA ingress configuration", () => {
  it("preserves legacy configurations as disabled and validates explicit restricted grants", () => {
    expect(validateConfig(defaultDispatcherConfig).rhizaIngress?.enabled ?? false).toBe(false);
    const legacy = structuredClone(defaultDispatcherConfig); delete legacy.rhizaIngress;
    expect(validateConfig(legacy).rhizaIngress).toEqual({ enabled: false, clients: [] });
    expect(validateConfig(config()).rhizaIngress).toEqual({ enabled: true, clients: [grant] });
  });
  it.each([
    { scopes: ["*"] }, { repositoryIds: ["*"] }, { profileIds: [] }, { repositoryIds: ["unknown"] },
    { profileIds: ["unknown"] }, { credentialRef: "secret://controller/owner-token" }, { expiresAt: "not-a-date" },
    { expiresAt: "2026-02-31T00:00:00.000Z" }, { token: "raw-secret-is-not-config" }, { scopes: ["jobs:read", "jobs:read"] },
  ])("rejects an invalid or privilege-broadening grant %j", patch => {
    const input = config(); Object.assign(input.rhizaIngress.clients[0]!, patch);
    expect(() => validateConfig(input)).toThrow();
  });
  it("rejects duplicate service identities or shared credential references", () => {
    const input = config(); input.rhizaIngress.clients.push({ ...grant });
    expect(() => validateConfig(input)).toThrow();
    input.rhizaIngress.clients[1]!.id = "client-b";
    expect(() => validateConfig(input)).toThrow();
  });
  it("requires only active grant secrets and preserves revoked identity metadata", () => {
    expect(requiredSecretReferences(validateConfig(config()))).toContain("secret://rhiza/client-a");
    const input = config(); input.rhizaIngress.clients[0]!.enabled = false;
    expect(requiredSecretReferences(validateConfig(input))).not.toContain("secret://rhiza/client-a");
    expect(validateConfig(input).rhizaIngress?.clients[0]?.id).toBe("client-a");
    input.rhizaIngress.enabled = false; input.rhizaIngress.clients[0]!.enabled = true;
    expect(requiredSecretReferences(validateConfig(input))).not.toContain("secret://rhiza/client-a");
  });
  it("routes grant changes through privileged ConfigPlan confirmation", () => {
    const db = new DispatcherDatabase(":memory:"); databases.push(db);
    const engine = new ConfigurationEngine(db);
    const plan = engine.buildPlan(config(), "owner", "web");
    expect(plan.risk).toBe("privileged"); expect(plan.requiresConfirmation).toBe(true);
    expect(() => engine.applyPlan(plan.id, { confirmed: false })).toThrow();
    expect(engine.current().config.rhizaIngress?.enabled ?? false).toBe(false);
  });
});
