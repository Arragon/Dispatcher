import { expect, it, vi } from "vitest";
import { defaultDispatcherConfig } from "@dispatcher/config";
import type { AccountModelCatalog, TaskModelRoutingConfig } from "@dispatcher/domain";
import { qualifyRoutingPolicy } from "../src/policy-config.js";
it("qualifies global rules only against repositories on the selected account's Runner", async () => {
  const current = structuredClone(defaultDispatcherConfig);
  current.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" });
  current.agentProfiles = [{ id: "p", alias: "P", provider: "cursor", runnerId: "local" }];
  current.repositories = [{ id: "local", root: "/local", defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [] }, { id: "remote", runnerId: "remote", root: "C:\\repo", defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [] }];
  const policy: TaskModelRoutingConfig = { enabled: true, requireConfirmation: true, classificationMode: "keyword", semanticFailureMode: "stop", taskTypes: [{ id: "docs", name: "Docs", definition: "Docs", enabled: true, keywordGroups: [] }], rules: [{ id: "rule", name: "Rule", enabled: true, profileId: "p", taskTypeId: "docs", priority: 1, target: { modelSelectionId: "model", reasoning: { mode: "native-default" } } }] };
  const next = structuredClone(current); next.policies.modelRouting = policy;
  const catalog: AccountModelCatalog = { profileId: "p", runnerId: "local", providerId: "cursor", backendId: "cursor-headless", contextFingerprint: "context", revision: "catalog", fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model", displayName: "Model", kind: "model", selectable: true, access: "account-listed", parameterOptions: {} }] };
  const read = vi.fn(async () => catalog);
  expect(await qualifyRoutingPolicy(current, next, read)).toMatchObject({ catalogs: [{ repositoryId: "local" }] }); expect(read).toHaveBeenCalledExactlyOnceWith("p", "local");
  policy.rules[0]!.repositoryId = "remote";
  await expect(qualifyRoutingPolicy(current, next, read)).rejects.toMatchObject({ code: "ROUTING_CONTEXT_MISMATCH" }); expect(read).toHaveBeenCalledOnce();
});
