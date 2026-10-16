import { expect, it } from "vitest";
import { remoteCatalog } from "../src/remote-results.js";
const identity = { profileId: "p", runnerId: "remote", providerId: "codex" };
function catalog() { return { ...identity, backendId: "codex-exec-json", contextFingerprint: "context", revision: "catalog", fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model", displayName: "Model", kind: "model", selectable: true, access: "unconfirmed", parameterOptions: { reasoningEffort: ["low"] }, parameterDefaults: { reasoningEffort: "low" } }] }; }
it("rejects a foreign catalog identity, duplicate model identities and unknown provider payload fields", () => {
  const good = catalog();
  for (const invalid of [{ ...good, runnerId: "other" }, { ...good, profileId: "other" }, { ...good, entries: [...good.entries, ...good.entries] }, { ...good, nativePayload: { arbitrary: true } }, { ...good, entries: [{ ...good.entries[0], parameterDefaults: { reasoningEffort: "unsupported" } }] }]) expect(() => remoteCatalog(invalid, identity)).toThrow(expect.objectContaining({ code: "REMOTE_RESULT_INVALID" }));
});
it("preserves unconfirmed access and unsupported native evidence without manufacturing explicit availability", () => {
  const good = catalog(); expect(remoteCatalog(good, identity)).toEqual(good);
  const unavailable = { ...good, entries: [], freshness: "unverified", selectionSupport: "unsupported", failure: { code: "NATIVE_AUTH_REQUIRED", message: "Native login required" } };
  expect(remoteCatalog(unavailable, identity)).toEqual(unavailable);
});
