# Codex configuration and runtime composition implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the preserved canonical Codex host through explicit applied configuration, exact catalog identity and the owning Controller lifecycle.

**Architecture:** Extend the existing Pi-compatible embedded registration to the actual codex-app-server backend. Keep default exec profiles unchanged, reject a missing/mismatched configured native host and use the existing NativeBindingEvents/NativeInteractions authority. Reuse a499d84 service composition and current Pi lifecycle handling; do not add a parallel configuration, selection, sink or host manager.

**Tech Stack:** Existing TypeScript, ConfigPlan/Ajv, CodexAdapter/CodexExecutionRuntime, Controller/Runner and Vitest; no dependency added.

**Spec:** `dispatcher-candidate-convergence-architecture-plan.md` CV-02/CV-05/CV-08/CV-09; `docs/evidence/convergence/contract-decisions.md`; `docs/architecture.md`; root AGENTS.md.

## Global constraints

- Configuration activation uses reviewed ConfigPlan; default codex-exec-json remains the default without nativeInteraction.
- Native config allows only compatible codex-app-server on an embedded managed-worktree Runner, explicit absolute executable/codexHome and native login; no GUI/control/remote qualification is inferred.
- One immutable execution selection/reference and the original synchronous guard; secrets remain opaque references and provider JSON stays in adapters.
- A configured native backend may not silently fall back to exec. Catalog profile/backend/context/revision remain exact and captured before async reads.
- Preserve all relevant a499d84 assertions or document canonical fixture prerequisites; retain actual installed-protocol/account/GUI/service/release Gates separately.
- R-020 native startup intermittency remains unresolved. Current base bd9f6af source check passes176 files/1956 tests; no timeout, assertion, worker or retry-to-green changes.

## Review focus

- Missing, foreign or implicitly injected native factories must not execute a different backend.
- Catalog reads must not change account/backend identity while account or model pages are pending.
- ConfigPlan rejects mismatched providers/locations and cannot replace a pending or undrained runtime.
- Native spawn validates exact current Run/session/generation/attempt/lease/repository/worktree and observer before/after callbacks.
- Shutdown drains every runtime and closes HTTP even if another runtime's disconnect or receipt write fails; late sources/events remain fenced.

### Task 1: Explicit backend registration and exact catalog identity

**Files:** Modify `packages/config/src/schema.ts`, `packages/adapters/src/native-profile.ts`, `packages/adapters/src/codex.ts`, `packages/adapters/src/codex-catalog.ts`; add `packages/config/test/codex-native-interaction.test.ts`; update existing native-profile/catalog tests and relevant docs/ledger.

**Interfaces:** AgentProfileConfig.nativeInteraction.backendId permits the actual pair pi-rpc or codex-app-server; validation binds each to its provider and embedded Runner. Codex requires executable/codexHome absolute paths, leaves model optional for native-default, and keeps ConfigPlan confirmation. Structural NativeProfileRegistration carries that same optional interaction. createNativeProfileAdapter requires the configured native backend id from the supplied factory, rejects a native injection without opt-in and never creates an exec fallback for native configuration. normalizeCodexCatalog/readCodexCatalog accept an internal optional backendId defaulting to codex-exec-json; CodexAdapter supplies its actual backend id. Reader captures profile/context/backend before awaiting and rejects foreign profile/unsupported backend before native I/O; fingerprint/revision include backend identity.

- [x] Add RED cases for valid native config/confirmed plan and invalid provider, Runner, path, GUI, credential and mode/backend combinations; preserve default exec and existing Pi assertions.
- [x] Add RED factory cases for missing/wrong/implicit native backend, exact opt-in and no native startup during construction.
- [x] Add RED catalog cases for app-server/exec identity separation, account/backend mutation during read and rejection of foreign/unsupported identity without queries.
- [x] Implement the minimal existing-schema/factory/reader adaptations; no service registration or actual provider read is implied by Task1.
- [x] Run derived targeted config/native-profile/catalog/selection/price tests, default `mise exec -- pnpm check`, independent read-only review and proven RED/GREEN fixes. Record exact current source/results and Linear readback; failed checks retain the unit unqualified.

### Task 2: Owning Controller startup/source/shutdown composition

**Files:** Modify `apps/controller/src/service.ts` and directly affected native context/source helpers; migrate `apps/controller/test/codex-runtime-service.test.ts` source assertions with canonical fixtures; extend owning shutdown and config replacement regressions.

**Interfaces:** Controller owns a CodexExecutionRuntime map alongside Pi, an optional scoped codexAppServerFactory test/integration hook and exact persisted binding lookup. Applied native profiles construct that runtime and pass it through the native profile factory. assertManagedCodexInput derives the original Run/session from the managed workspace/reference plus captured invocation, validates canonical selection and generation/attempt/lease/workspace and calls existing native spawn fencing. Selected source resolution reuses NativeInteractions and exact runtime.source(binding); capability evidence remains unknown unless separately qualified. All-runtime lifecycle iteration records each backend's actual id and retains unknown receipts; it never implies native writer release.

- [x] Inspect and port the existing a499d84 service source assertions, including source/ingress/history/cancellation cases, with one canonical selection/observer and named unavailable prerequisites rather than skipped tests.
- [x] Observe RED for configured registration, binding-before-prompt, persistence rejection, unchanged adapter retention and local-only shutdown; implement exact current authority and lifecycle composition.
- [x] Add RED for cross-runtime receipt/disconnect failure isolation, post-lookup shutdown, physical/profile drift and no replacement session on UNKNOWN; preserve generic native mutation denial.
- [x] Run migrated service, Pi service/reroute, config/catalog/price and default full checks; complete independent read-only review and fixes with exact evidence/Linear readback before checkpointing.

## Completion boundary

Both tasks are necessary for this composition increment. They do not complete the parent CV-09/OpenCode work or original actual-provider/GUI/writer/service/release Gates. Real installed Codex protocol remains pinned and must be qualified independently; configuration does not manufacture capabilities or bypass native quiescence.

Task1 final local evidence: initial12 RED failures; final5 files/82 targeted cases
and default177 files/1982 tests pass86.66s after factory-order correction and
clean independent review. Task2 and the parent goal remain incomplete.


Task2 final local evidence: all59 source service cases migrated with canonical
fixtures plus15 regressions (74 total). Scoped metadata/recovery/history suites
pass5 files/96 cases. Independent review's2 P2 findings have proven RED/GREEN
fixes and no residual findings. Final defaultfull4 exits0 with178 files/2056 tests
(87.11s) plus build/typecheck/lint/boundaries. Prior full3 failures are retained;
no skip/deadline/worker/retry weakening. The complete composition increment is
locally verified; native-history API/service, OpenCode and actual-provider Gates
remain in the parent plan and are not marked complete by these two tasks.
