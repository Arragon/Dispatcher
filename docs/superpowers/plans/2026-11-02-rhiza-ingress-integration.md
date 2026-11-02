# Current-candidate RHIZA ingress integration

> Execute inline with executing-plans under the user-approved lean delivery goal. Reuse the existing isolated worktree; one final milestone review and final changed-code full gate.

**Goal:** Connect the already implemented Dispatcher-owned RHIZA v1 ingress to the current candidate, preserving exact execution, authorization, immutable receipts and native lifecycle boundaries.

**Architecture:** Reuse committed compatibility source `8d24717710079dc831fabfab8a57edb4296a67be` against its common base `3c1a565522e5f99595b57618c7c8fa70c40e4c75`, adapting overlaps onto current D `3cdb5f7`. Keep canonical publication/Task/Run, ConfigPlan, SecretStore and owning Runtime as the existing authorities. RHIZA remains a wire consumer with independent source/data, not a second native executor.

**Tech Stack:** Existing TypeScript, Node24.22.1+, pnpm11.19.0, SQLite, Vitest and existing dependencies. New config-to-protocol workspace reference only; retain current resolved third-party versions.

**Spec:** Adopted scheme B in dispatcher-candidate-convergence-architecture-plan.md and docs/evidence/convergence/contract-decisions.md. Authoritative source documents are `git show 8d247177:docs/rhiza-ingress-v1.md` and the adopted rulings in `docs/plans/2026-10-24-rhiza-convergence-alignment.md` at that source. INH-1981–1985 supply committed implementations and tests; original real Gates remain separate.

## Constraints and scope

- Work only in the current owned codex/dispatcher-plan-completion worktree. Preserve primary19db456/three dirty files, other branches/worktrees, existing staged runtime and all user data. No provider calls, live migration, activation, push, PR or merge for this integration unit.
- Preserve all current D changes after the common base, including strict snapshot commit, final pure authority/lease checks, canonical snapshot verification/preparation, Slack workflows, current backends and UI. Merge committed source deltas; do not replace newer files with old full copies.
- Preserve upstream migration1–11 and writer1–7. Adopt the existing RHIZA migrations12–18/writer8–14 and old-private16 rejection. Use owned fixture databases only. Restore barriers/unknown effects remain closed; no catalog relabeling, conversion or downgrade.
- Keep protocol1.1/artifact1.1.0/schemaEnvelope1/event1 bytes and release digests unchanged. Controller–Runner protocol1.2 stays independent. Capabilities expose implemented and qualified paths only; model/native-writer/client qualification is not inferred from a listing or fixture.
- Import the source's RHIZA Controller modules/tests/fixtures, persistence owners/tests/old-private16 synthetic fixtures, protocol schema/exporter/artifact/tests, config tests, model-invocation types/producer/storage and fake consumer. Adapt the shared ConfigPlan/secret/auth/publication/Runtime/Adapter/persistence exports and callbacks required by those existing consumers. The exact source-derived path set is frozen in this plan's ignored workspace; scope additions are recorded before edits.
- Update existing current-version assertions where the current schema/writer intentionally changes; retain literal historical cases and all unrelated assertions/deadlines. Keep source RHIZA assertion bodies, adapting only actual current fixture/API interfaces with a recorded reason. No new speculative fault matrix.
- Historical source evidence remains historical. Preserve source Git objects and old failed observations; do not reconstruct missing raw directories. CSV503/seven immutable columns/owners remain unchanged until eligible verification-cell bookkeeping.

## Review focus

Owner tokens/browser sessions never become external service identity; disabled/revoked/expired grants are rechecked across awaits. Exact model/pricing/target/approval and source hashes remain frozen through admission, continuation and reassignment. Unknown/native receipts cannot replay physical effects. Read admission stays distinct from one-shot write admission and retains callback receiver/raw lifetime. Shutdown initiates native drains before dependent ingress waits and keeps SQLite open on uncertain work.

## Task 1: Integrate the complete committed ingress vertical slice

**Files:** Source-derived RHIZA paths and directly required shared owners described above; current-version persistence/service fixture assertions as actual failures require; docs/architecture.md, docs/know-how.md, docs/rhiza-ingress-v1.md, contract decisions and existing progress ledger at acceptance. The exact whitelist is in `.superpowers/sdd/2026-11-02-rhiza-ingress-integration/scope.json`.

**Interfaces:** Reuse source RhizaServiceIdentity/Targets/Jobs/Views/Cancellations/Inputs/Reassignments/Operations and persisted owners; register `/api/integrations/rhiza/v1` behind service credentials. Use existing canonical publications and guarded native execution, with original idempotency/cursor/lineage/model-evidence contracts. No parallel Task store, scheduler or native execution path.

- [ ] **Step 1: Freeze source/current overlap and demonstrate the missing entrypoint.** Add two narrow current-Controller HTTP regressions for owner/session rejection at the external prefix. Run only that file; current owner-authenticated requests should reach404 rather than the required external401. Reuse the accepted unchanged D224/5366 baseline; no baseline full rerun.
- [ ] **Step 2: Reuse the committed implementation.** Import new source files exactly and merge shared deltas against the common base, inspecting overlaps. Combine newer callback/snapshot/lifecycle logic rather than replacing it. Preserve protocol artifact hashes and upstream migrations. Install the unchanged dependency resolution with the new workspace edge only if needed.
- [ ] **Step 3: Connect the existing service lifecycle and current authorities.** Wire auth, targets/preflight, durable submission/query/event/artifacts and cancellation/input/reassignment through source owners and current canonical consumers. Preserve disabled-by-default and all qualification barriers. Resolve actual interface/compile gaps; reassess ordinary problems after two rounds.
- [ ] **Step 4: Verify relevant behavior.** Build changed production before GREEN, run source protocol/config/persistence RHIZA tests and Controller ingress/identity/jobs/control/conformance tests. Reuse existing regression bodies, with necessary current native/pricing/strict-delivery coverage. Do not duplicate that broad slice after the same tuple passes.
- [ ] **Step 5: Milestone review and final gate.** Review the complete integration once; fixes get scoped verification. Run one final `mise exec -- pnpm check` on the final code, plus the existing protocol exporter check and isolated fake consumer where applicable. Preserve failures; never promote fixture results to real RHIZA/provider/PR Gates.
- [ ] **Step 6: Commit, track and continue.** Update necessary architecture/operations and existing disposition metadata, commit exact reviewed files, read official quota and stop safely if any remaining window is≤7%. Sync the milestone/blockers to Linear and read back. Continue actual missing delivery work; do not mark all CV/roadmap Gates complete.
