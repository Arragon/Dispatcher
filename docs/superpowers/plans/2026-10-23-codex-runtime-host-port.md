# Codex execution host port implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the committed Codex per-execution host and exact-source lifecycle behind the current canonical backend contract.

**Architecture:** Reuse a499d84's CodexExecutionRuntime and NativeRuntimeHosts, adapting canonical selection and physical directory identity using the existing Pi runtime conventions. Each managed execution owns one captured backend; no aggregate interaction port qualifies every workspace. This unit has no Controller registration or configuration activation.

**Tech Stack:** Existing TypeScript, Node filesystem identity, NativeRuntimeHosts, CodexAppServerBackend and Vitest; no dependency added.

**Spec:** `dispatcher-candidate-convergence-architecture-plan.md` CV-02/CV-08/CV-09; `docs/evidence/convergence/contract-decisions.md`; `docs/architecture.md` Internal Codex App Server contracts; root AGENTS.md.

## Global constraints

- One captured ExecutionSelection and managed ExecutionContextRef; one existing durable sink.
- Configuration changes go through ConfigPlan; no profile/service/data activation in this unit.
- Domain/protocol remain free of transport/provider imports; provider JSON stays in adapters.
- Preserve all original runtime assertions or explicitly document current-contract fixture adaptation.
- Local root/callback cleanup never proves background tools or native writer release; unknown stays unknown.
- Current7c6e4bd final whole-branch gate is RED at172/175 files,1914/1917 tests from3 unchanged Pi version probes. Preserve all logs/deadlines/assertions and continue independent work without claiming completion.

## Review focus

- Profile/reference/selection mutation while acquisition is pending must not retarget a host.
- Replacing a physical home/workspace at the same path must invalidate cached sources and writes.
- Async or self-mutating authority callbacks cannot authorize an RPC write.
- Shutdown during acquisition/binding must prevent late prompts and retain undrained work.
- Failed known-unsent startup must not silently free an uncertain created root or native writer.

### Task 1: Preserve the per-execution host contract

**Files:** Create `apps/controller/src/codex-runtime.ts` and `apps/controller/test/codex-runtime.test.ts`; modify `packages/adapters/src/index.ts` only for types/backend consumed by this actual host; update architecture/know-how/source-disposition and convergence ledger.

**Interfaces:** `CodexExecutionRuntime implements CodexBackend` consumes the current CodexStartInput and explicit RuntimeOptions `{profile,runnerId,assertInput,bindingFor,authorityFor?,factory?}`. It exposes `backendId="codex-app-server"`, `start`, exact `source(binding)`, scoped `diagnostics`, native request metadata sink, `beginShutdown`, `isClosed`, `hasUnclosedHosts`, `hasActiveOperations` and coalesced `disconnectLocal`. It retains source continuation only on a previously registered exact persisted binding, with cold continuation rejected. Start captures selection/reference before awaiting; physical home/workspace identity includes path/dev/ino; assertInput and beforePrompt must return void and are rechecked before/after. The source's observed model/policy state remains owned by the same backend. No unscoped interaction port or release capability is added.

- [x] Copy all original a499d84 runtime cases; supply explicit absolute fixture executable, canonical selection/reference, synchronous beforePrompt and event sink required by7c6e4bd. Keep original scope, continuation, source, callbacks, ingress and shutdown assertions.
- [x] Run `mise exec -- pnpm vitest run apps/controller/test/codex-runtime.test.ts` and observe missing module/backend exports RED.
- [x] Port the existing host with exact source registration and captured selection; export only the actual adapter backend/type contracts consumed here. Reuse NativeRuntimeHosts rather than invent a host manager.
- [x] Add/observe RED for home/workspace replacement, selection mutation, Promise-returning assertInput/beforePrompt, source invalidation during callback and known-unsent cleanup; implement only those current lifecycle boundaries.
- [x] Run `mise exec -- pnpm vitest run apps/controller/test/codex-runtime.test.ts apps/controller/test/pi-runtime.test.ts packages/adapters/test/codex-app-server.test.ts packages/runner/test/native-observation.test.ts`; derive any corrected test path from files, then run default `mise exec -- pnpm check`. Record every failure by exact case; no retry-to-green.
- [x] Complete one independent read-only review of this increment, fix proven findings with RED/GREEN, record source/verification/Linear readback and save a development checkpoint. Required failed full verification keeps the unit unqualified.

## Follow-up boundary

The next unit composes ConfigPlan schema, native-profile factory, catalog backend context and Controller/Runner startup/source/shutdown. It must validate exact Run/session/attempt/lease/workspace and the current observer, preserve generic native mutation denial and qualify the installed protocol independently. This plan does not silently implement that activation or promote fixture observations to native/GUI/service/release evidence.

Final local verification: source24 plus15 regressions pass39 cases; reviewed
post-lookup shutdown correction passes4 files/174 cases and default176 files/1956
tests82.21s with all non-test gates. No real native or configuration activation.
