# Codex canonical native contract port implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the committed Codex App Server backend and its source assertions behind current canonical selection, observer and execution authority.

**Architecture:** Reuse a499d84's protocol/backend implementation with the owned transport saved at9c85185. Keep one ExecutionSelection and one NativeBindingEvents durable sink. Codex allocates its exact thread identity after native creation; Pi keeps its preallocated identity contract. Internal backend preservation precedes Controller/Runner activation.

**Tech Stack:** Existing TypeScript, Node child-process transport, domain DTOs, MemorySessionStore and Vitest. No added SDK or dependency.

**Spec:** `dispatcher-candidate-convergence-architecture-plan.md` CV-02/CV-08/CV-09; `docs/evidence/convergence/contract-decisions.md` canonical authority and selection; root AGENTS.md.

## Global constraints

- Keep domain/protocol free from Web, persistence, transport and provider SDK imports.
- Configuration changes go through ConfigPlan; secrets remain opaque secret references.
- Preserve original source assertions and immutable historical facts; no alternative session or native writer release may be inferred.
- Real account, installed protocol, native GUI and release Gates remain separate from fixtures.
- R-020 retains intermittent native probe failures. Task1 final174-file/1825-test check passed; Task2 combined target has one Codex version-probe failure. Preserve every log and do not weaken3s deadlines, assertions or worker defaults.
- User authorized uninterrupted full-plan execution; continue native inline implementation without a new approval round. Required review remains read-only and scoped.

## Review focus

- A newly allocated native thread must not replace a pre-existing or changed Adapter identity.
- Failed/late durable binding or event sinks must keep the invocation blocked before prompting.
- A Promise-returning final admission guard must never be treated as permission.
- A cancelled or replaced source must not publish a successful late observation/history page.
- Local disconnect must keep undrained callbacks and background/native writer state unknown.

### Task 1: Allocate Codex thread identity at the shared durable observer boundary

**Files:** Modify `packages/adapters/src/native-binding-events.ts`; create `packages/adapters/test/native-binding-events.test.ts`; update directly related architecture/know-how and convergence ledger.

**Interfaces:** `NativeBindingEvents.startOptions(session, emit, product, admit, identity?: "reserved" | "codex-thread")` keeps `reserved` as the existing default. `codex-thread` is valid only for product codex/backend codex-app-server. It accepts nativeThreadId equal to nativeSessionId, adopts a new identity only from an initially unbound session, saves providerSessionId and binding together before the waiting event, then runs the original synchronous admission again. Existing bindings must match exactly. Return shape stays beforePrompt/onBinding.

- [x] Write tests for valid allocation and persisted-before-sink order, changed existing provider identity, foreign binding fields/thread mismatch, failed sink latch and unchanged reserved-Pi rejection. Use real MemorySessionStore and actual sink events.
- [x] Run `mise exec -- pnpm vitest run packages/adapters/test/native-binding-events.test.ts`; observe missing allocation behavior RED without weakening the tests.
- [x] Implement the explicit identity branch within the current helper; preserve model/execution/observer authority and failure latching. No alternate sink or persistence path.
- [x] Run new helper and existing PiAdapter/selection tests; then `mise exec -- pnpm check`. Report R-020 failures by case if they recur.
- [x] Complete scoped independent review and record exact evidence before a development checkpoint; a red full gate withholds merge readiness.

### Task 2: Preserve native backend, read/history and guarded producer semantics

**Files:** Extend `packages/adapters/src/codex-app-server.ts`; adapt `packages/adapters/src/codex.ts`; migrate remaining source cases into `packages/adapters/test/codex-app-server.test.ts`; retain transport cases in their existing file; update source-disposition.csv.

**Interfaces:** Export existing Codex turn/result/start types with ready/events/native observer fields required by the actual backend. App Server start consumes captured canonical execution selection/reference and the original synchronous final guard. Adapter dynamic backend identity and durable callbacks use Task1; exec defaults remain codex-exec-json. AttachRequest consumes executionSelection and current validateExecutionBinding context, never legacy modelSelection.

- [x] Port source read/cancellation/directory/producer/disconnect cases with explicit canonical fixture adaptation. Document the already migrated7 transport cases and retain every remaining source assertion or named prerequisite; do not skip failures.
- [x] Observe RED for missing backend/Adapter behavior; add wrong or absent selection/reference and asynchronous-guard cases.
- [x] Reuse source backend behavior, adapting only current DTOs and actual lifecycle boundaries. Keep unsupported native token events, release/reclaim and UI surfaces unknown.
- [ ] Run migrated Codex/backend/observer targets and existing exec/catalog/quota/selection tests, then full `mise exec -- pnpm check`; preserve all failures and source mappings.
- [ ] Independent scoped review, fix proven findings with RED/GREEN, update evidence and Linear with readback, checkpoint. No activation is implied.

## Parent-plan follow-up outside this increment

ConfigPlan/native-profile and Controller/Runner runtime activation remain in the
frozen parent plan, outside this subplan. Specify their concrete native
scope/version/authority and physical shutdown interfaces after Task2 establishes
the backend contract; never infer a production Guard from passing protocol
fixtures. OpenCode is a separate following backend unit.

## Self-review

Tasks1/2 cover only the next canonical Codex contract increment, preserving the source transport checkpoint. Parent-plan activation is explicitly outside this increment. No source behavior is silently removed, no public/persisted format change is assumed, and all uncertain actual-provider facts stay unqualified.
