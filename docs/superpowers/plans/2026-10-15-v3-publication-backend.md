# V3 publication and native model catalog implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement the sequential tasks below in this chat.

**Goal:** A durable local task publication preview/commit/read flow through the existing Canonical Task, scheduler, managed worktree, native adapter, verification and local REVIEW path, followed by account/project-scoped native models.

**Architecture:** Add one Controller-owned publication service over the existing SQLite entity store, with shared pure DTO/schema definitions. Keep all execution in the existing dispatch service. Freeze the task contract, verification configuration and per-session selection before native startup; retain explicit uncertainty across crashes. Reuse existing adapters and the repository's Codex catalog implementation where compatible, with installed-version evidence.

**Tech stack:** Existing TypeScript, Fastify, SQLite, Ajv, React Query, Vitest and native Git/CLI; no new external dependency.

**Spec:** `/Users/wangdongxin/Downloads/Dispatcher-v3-Backend-Implementation-2026-10-15.md`, sections 6–8, 19 and 23; repository `docs/architecture.md` and `docs/know-how.md`.

## Global constraints

- Preserve the previously completed console (`d718ead`) and all legacy routes/data; no production DB or credential migration.
- Domain/protocol remain free from I/O, Web, provider SDKs and persistence.
- Config changes use ConfigPlan; credentials remain opaque `secret://` references.
- Preview may read Git/native catalogs but may not infer, create worktrees, fetch, dispatch or write a remote.
- Preserve complete description bytes in the compiled prompt; use a separate short title.
- `create-only` may create NEEDS_SPEC without a live account; dispatch must pass all checks.
- Initially support local `delivery=none` and an explicitly labelled native-configuration selection; fail closed for unsupported remote execution, policy and delivery types.
- Native explicit models require catalog context/revision, native parameter validation and per-session frozen selection; never change profile defaults to implement an override.
- Each stage: targeted tests, required regression, checkpoint commit, official quota read. Stop at remaining <=15% in any readable window.

## Review focus

1. Same publication/key across tabs, timeouts and restarts must retain one task and startup identity.
2. Config/base commit/model/parameter changes between review and startup require rejection or new review.
3. A recorded STARTING boundary is not proof of external startup; no blind retry after uncertainty.
4. Verification/contract changes during execution must not change the approved Run.
5. Missing model prices, stale catalogs, late account responses and unknown resource facts must remain explicit.

## Stage 1 — durable preview and create-only commit

**Files:** domain publication types/schema; persistence conditional entity operations; semantic compiler and scheduler prompt; Controller publication service/routes; publication tests.

**Interfaces:** `PublicationService.preview(principalId, unknown)`, `commit(principalId,id,key,unknown)`, `get(principalId,id)`; POST `/api/task-publications/preview`, POST `/:id/commit`, GET `/:id`, GET `/capabilities`.

- [x] Add failing HTTP tests for non-effectful preview, full-text preservation, NEEDS_SPEC/READY, invalid fields/links/scope, role isolation, missing confirmation, idempotency conflict, parallel commits and reopen/replay.
- [x] Add pure draft/preview/receipt schemas and versioned contract text/workspace extension. Render original instructions and references into the actual scheduler prompt.
- [x] Implement registered-repository Git read/preflight and stable input/review hashes; bind configuration and base commit. Create task/contract/receipt/publication atomically using existing CanonicalTaskService.
- [x] Verify rollback under injected persistence failure and changed config/base ref; run targeted package/Controller tests, commit and check quota.

## Stage 2 — local execution and Web integration

**Files:** workspace manager; shared scheduler/dispatch/advance path; publication dispatch hook; PublishPage/API helper; local-delivery/recovery/browser tests.

**Interfaces:** publication dispatch uses `dispatchTask` with a server-owned frozen context, not a second spawn path. Read results at GET `/api/runs/:id/result`.

- [x] Write failing tests asserting the backend receives the complete prompt, only one startup occurs, remote profiles do not run on Controller, failures preserve taskId, and verification/config snapshots remain frozen.
- [x] Persist workspace intent/handle, use the reviewed commit, reject invalid/existing branches and scope escapes. Restore verified handles conservatively without cleanup or relaunch.
- [x] Reserve Run, task currentRunId, frozen contract/verification and publication STARTING in the existing startup transaction. Reconcile interrupted receipts to a known result or OUTCOME_UNKNOWN without spawning.
- [x] Complete local `none` delivery after passed verification, retaining worktree/file manifest and moving Task to REVIEW; never require GitHub, commit, push or PR. Add explicit unsupported errors for unimplemented delivery types.
- [x] Connect Web preview/commit/persistent receipt recovery; preserve draft through errors/401, reuse the same commit key, query after uncertain outcomes, and expose existing task/run/result.
- [x] Verify Controller and frontend regression, then perform a minimal authorized native run in an isolated repository/data directory. Record actual provider/version evidence separately from fakes; commit and check quota.

## Stage 3 — native account/project model catalogs

**Files:** adapter catalog contract/Codex implementation; catalog service/routes; Run/AdapterSession selection; publication revalidation; PublishPage selector; catalog/selection tests.

**Interfaces:** optional `AgentAdapter.modelCatalog(context)`; normalized GET `/api/agents/profiles/:id/models?repositoryId=...`; explicit start selection passed through scheduler into the owning adapter/session.

- [ ] Read the installed Codex protocol/version before implementation; inspect the same-repository catalog reader for reuse and harden its process cleanup, bounds and malformed-data handling.
- [ ] Test native pagination, account/project isolation, stable content revisions, missing prices, unsupported providers, denied/unknown access and stale responses.
- [ ] Implement normalized safe catalogs and explicit model/native parameter validation. Requery at review/commit/actual-worktree startup; changed conditions require review, never fallback.
- [ ] Persist selection per Run/session, use it on resume, and verify concurrent per-account models cannot cross-contaminate or alter applied profile defaults.
- [ ] Wire UI catalog refresh/model/effort and acknowledgement of unconfirmed access. Run full gate, real read-only native catalog probe and one explicit-selection execution in isolation; commit and check quota.

## Final verification

- [ ] `pnpm check`, `git diff --check`, browser publish/reload/replay/result verification.
- [ ] Update architecture/know-how and a scoped evidence report with exact tests and native limitations; preserve any incomplete stage if quota stops work.

Ruling: local publication projects use `local:<repositoryId>` and `local:inbox` until independent project registration exists; external project bindings are not inferred from user input.

Ruling: Codex is the first supported native selection backend; unsupported providers, remote execution, policy routing and publication delivery types other than none fail closed.
