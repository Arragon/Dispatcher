# Show current native capability scope before publication

Continue inline from4ea70466 and its accepted270/5937 baseline. CV-11 explicitly
requires read-only allowed capability views while server admission/contracts are
missing. Current configuration supports compatible mode only; strict per-task
native-session/GUI requirements lack current publication/frozen-reader semantics.
They remain an explicit INH-1527/CV-09 dependency, not a selectable promise.

Outcome: the existing publish page shows compatible-mode limits and lets the user
read the selected account's backend/region/native capability evidence and unknown
reasons before publishing. Reuse ProfileInteractionPanel and existing safe profile
GET; do not copy the old App, capability renderer, model editor or selection owner.

Scope: new apps/web/src/PublicationNativeScope.tsx, PublishPage.tsx integration and
apps/web/test/publication-native-scope.test.tsx; necessary existing convergence/
operations documentation only. Existing renderer/API/cache invalidation/publication
payload, draft, idempotency, routing and confirmation owners stay intact. No backend,
domain, protocol, persistence, schema/writer, dependency or qualification changes.

- [x] Two direct behavior REDs: page has no publication capability view; stale/late
  account responses and failed reads cannot show current verified capability.
- [x] Reuse the existing agent-profile query/cache refresh boundary. Read details
  only on demand; carry cancellation and exact account/config identity. Filter by
  reviewed backend when available. Invalid, failed or pending headers stay unknown.
  Reuse the existing renderer; do not derive permission from provider labels.
- [x] Verify focused component and existing publication/capability regressions.
  Review TSX using React Best Practices without unrelated redesign or dependencies.
- [x] Inspect desktop/390px using an owned fresh Controller with synthetic generic
  profiles. No Task publication/provider/native-model/credential requests. Then one
  milestone review and one final changed-code gate, preserving original assertions.
- [x] Scoped commit, official quota check, Linear progress/blocker/readback and
  agent-gc dry run. Do not close full strict-native requirement or real client Gates.

P01 scope70f352c4 and CV11 dependencyb90ac46e recorded. Latest official remaining66%,
no reset; stop safely after unit at<=7%. Primary19db456/three dirty files, other
trees, immutable releases/data and503 source owners stay protected. Ordinary issues
are reassessed after two rounds; missing native authority cannot be bypassed.
