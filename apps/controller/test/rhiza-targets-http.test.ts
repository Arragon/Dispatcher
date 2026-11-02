import { afterEach, describe, expect, it, vi } from "vitest";
import { clientHeaders, owner, rhizaServiceFixture } from "./fixtures/rhiza-service.js";
import { workOrder } from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
const prefix = "/api/integrations/rhiza/v1";
const fixtures: Awaited<ReturnType<typeof rhizaServiceFixture>>[] = [];
async function setup() { const f = await rhizaServiceFixture(); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });

describe("RHIZA target HTTP boundary", () => {
  it("reads pending metadata without invoking native queries or creating execution state", async () => {
    const f = await setup(), internal = f.service as unknown as { modelCatalog: (...args: unknown[]) => Promise<unknown>; executeProfileProbe: (...args: unknown[]) => Promise<unknown> };
    const catalog = vi.spyOn(internal, "modelCatalog"), probe = vi.spyOn(internal, "executeProfileProbe");
    const response = await f.service.app.inject({ url: `${prefix}/targets?repositoryId=repo-a`, headers: clientHeaders });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ schemaVersion: 1, repositoryId: "repo-a", targets: [{ profileId: "profile-a", status: "unverified", releaseQualified: false, evidenceCapabilities: [], models: [] }] });
    expect(response.body).not.toContain(f.root); expect(response.body).not.toContain("secret://");
    expect(catalog).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.service.database.listEntities("run")).toEqual([]);
  });
  it("rejects ungranted repositories/scopes and owner identity without leaking their existence", async () => {
    const f = await setup(), request = (query: string, headers = clientHeaders) => f.service.app.inject({ url: `${prefix}/targets${query}`, headers });
    expect((await request("?repositoryId=other")).statusCode).toBe(403);
    expect((await request("?repositoryId=repo-a&private=true")).statusCode).toBe(400);
    expect((await request("")).statusCode).toBe(400);
    expect((await request("?repositoryId=repo-a", owner)).statusCode).toBe(401);
    await f.configure(config => { config.rhizaIngress!.clients[0]!.scopes = ["jobs:read"]; });
    expect((await request("?repositoryId=repo-a")).statusCode).toBe(403);
  });
  it("keeps profile revision independent from unrelated global configuration", async () => {
    const f = await setup(), read = async () => (await f.service.app.inject({ url: `${prefix}/targets?repositoryId=repo-a`, headers: clientHeaders })).json().targets[0].profileRevision;
    const first = await read();
    await f.configure(config => { config.policies.highRiskRequiresConfirmation = !config.policies.highRiskRequiresConfirmation; });
    expect(await read()).toBe(first);
    await f.configure(config => { config.agentProfiles[0]!.alias = "Changed account label"; });
    expect(await read()).not.toBe(first);
  });
  it("validates bounded work orders and refuses missing proof without admitting any job", async () => {
    const f = await setup();
    const response = await f.service.app.inject({ method: "POST", url: `${prefix}/jobs/preflights`, headers: clientHeaders, payload: { workOrder } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400); expect(response.statusCode).toBeLessThan(500);
    expect(response.json().code).not.toBe("INTERNAL_ERROR");
    const extra = await f.service.app.inject({ method: "POST", url: `${prefix}/jobs/preflights`, headers: clientHeaders, payload: { workOrder, actor: "owner" } });
    expect(extra.statusCode).toBe(400); expect(extra.body).not.toContain("owner");
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.service.database.listEntities("run")).toEqual([]);
  });
});
