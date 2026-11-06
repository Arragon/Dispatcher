# OpenCode bounded server contract port

> Required workflow: superpowers:subagent-driven-development. One scoped implementer, then independent task review. This is the backend slice of CV-09; owned host, execution observer, configuration/catalog and Controller composition follow separately.

**Spec:** `dispatcher-candidate-convergence-architecture-plan.md` CV-09; `docs/evidence/convergence/contract-decisions.md`; root AGENTS.md; current canonical execution and durable observer contracts in `docs/architecture.md`.

**Base:** cde9407, clean isolated `codex/dispatcher-plan-completion`; last default full gate179 files/2103 tests passed. Preserve the dirty primary checkout.

**Reuse:** Port the same repository's committed a499d84 server and all four direct suites; no external code/dependency/license change. Do not replace current account catalogs, process ownership helpers, canonical DTOs or Controller services with old versions.

## Global Constraints

- Keep domain/protocol free from Web, persistence, transport and provider SDK imports. No domain/protocol schema or persisted format change in this task.
- Configuration changes go through ConfigPlan; secrets remain opaque secret references. This task does not activate a profile, access a real account, launch an installed provider or alter user configuration.
- Preserve every original assertion group, command deduplication and unknown outcome. Adapt obsolete DTO fixtures to current canonical execution selection; never restore modelSelection/legacyModel as a new input contract or derive repository/base authority from the incoming attach request itself.
- Capture caller inputs, bindings, methods and authoritative execution context before asynchronous preparation, and recheck scope/admission after waits and immediately before input. Admission callbacks are synchronous.
- Fixture/local-test success is separate from installed-protocol/account, GUI, native writer release, service/release and parent-plan acceptance. Unknown capabilities remain unknown; no replacement session, replay or writer release inference.
- Preserve all failed verification logs, including R-020. Do not weaken deadlines, assertions, worker settings, skip tests, cache probes or retry unchanged code to obtain a green gate.

## Task 1: Preserve the OpenCode server behind current canonical contracts

**Scope/files:** Add `packages/adapters/src/opencode-server.ts` from a499d84 and its original `opencode-server.test.ts`, `opencode-server-lifecycle.test.ts`, `opencode-interrupt-admission.test.ts`, `opencode-turn-result.test.ts` (145 expanded original cases). Modify adapters index exports and only the narrow optional read-only interaction injection seam in `OpenCodeAdapter` in native-cli.ts. Add focused regressions in those suites or one focused server-contract suite. Update this plan and relevant architecture/know-how notes after verification. Do not modify shared observer/execution/backend registration, config, catalogs, Controller, Runner implementation or owned-host process code in this task. Lifecycle tests may update their obsolete Runner import from native-runtime.js to native-observation.ts.

**Requirements and decisions:**

1. Restore all bounded server behavior: allowlist2.0.22/2.0.26 with one exact pinned version per connection; loopback HTTP only; no redirects or URL credentials; constrained API paths;1MiB request/response; five-second cancellation over credentials plus HTTP; captured synchronous final HTTP admission; normalized safe errors. Preserve physical workspace/tmp identity and server PID/version epoch, exact binding scope, bounded history/cursor/gaps, exact receipt-based turn completion, policy stability, interrupt resume=false and all unknown release/reclaim/approval/UI facts.
2. Restore only an optional fourth `NativeInteractionPort` constructor parameter/readonly interaction field on the standalone `OpenCodeAdapter` for the original read-injection test. Its manifest stays opencode-cli-json, execution behavior stays standalone. Server execution registration is a later task.
3. Add optional authoritative managed execution context to `registerBinding(binding, executionRef?)` and `OpenCodeV2Start.executionRef?`. Clone and validate this context before awaits; its id/runner must match binding/scope and its schema must be the current exact managed-worktree shape. Retain context per binding for shared A/B scope. Context supplied at creation participates in command signature and binding registration. Re-registering the same binding cannot replace or mutate previously captured context. A context-free binding remains readable but cannot attach.
4. Replace obsolete attach modelSelection with captured `request.executionSelection`. Validate using current `freezeExecutionSelection`/`validateExecutionBinding`, the saved original repository/base context, and exact deep equality against the captured original managed ref. Reject absent authoritative context, extra fields, wrong version, path/workspace/repository/base/branch/id/runner or context drift. Native-default must not manufacture a concrete model. For explicit-model, compare requestedModel and supported reasoning parameter with observed facts; attached remains false/unqualified. Preserve the six original invalid attach cases with independently captured original context plus valid A/B fixtures.
5. Make `OpenCodeV2Start.onNativeEvent` async-capable. Await a waiting event after durable binding and before prompt. Await received only after accepted native prompt receipt; waiting is not a prompt ACK. A failed initial or received sink marks the port disconnected/fenced and returns typed persistence unknown, with no late prompt or duplicate resend. Retain already-admitted callback ownership through drainLocalCallbacks. Terminal-event durability is owned by the later execution wrapper and is not fabricated in this server-only task. Adapt the one original event test that assumed received before any prompt, preserving its no-input/binding/guard assertions.
6. Pin handshake project identity across operations, and reject a session whose stable projectID differs from the authorized location project. Cover create, observation/history and subsequent handshake drift; never silently adopt a new project. During prompt preparation query exact-session permissions as well as active/queue state, and reject newly pending approval before input. Keep existing model/permission/activity tests.
7. Add regression tests for context capture/caller mutation across waits, missing context attach, cross-binding context mismatch/re-registration drift, async waiting/received sink delay/rejection and callback drain, stable foreign project/session project drift, and approval introduced during prompt preparation. Do not add test-only production bypasses or synthetic capability promotion.

**Execution/validation:**

- [x] Read affected implementation, current selection/domain types and required architecture notes. Copy the four original suites first and run focused missing-module RED, retaining output outside the repository. Reuse committed source, then add new regression RED/GREEN for adaptation gaps.
- [x] Preserve145 original expanded cases, allowing only documented obsolete fixture/event ordering adaptations and the Runner import correction. Use `mise exec -- pnpm vitest run` with explicit files while iterating.
- [x] Run `mise exec -- pnpm check` once on final code before commit, plus `git diff --check`. If a real failure appears, diagnose and retain it; report exact incomplete verification rather than weakening or retrying unchanged code. Full gate evidence must include command, exit, counts, log path and source HEAD.
- [x] Self-review, commit the scoped implementation and write full report to the assigned SDD report path with original test inventory, every adaptation, RED/GREEN evidence, changed files and limitations. Return only status/commit/test line/concerns/report path. The controller dispatches the independent reviewer and owns Linear/evidence/source-disposition updates.

**Follow-up boundary:** owned private server/process cleanup, canonical allocated session observer, strict execution wrapper, actual manifest/profile factory, ConfigPlan/catalog identity, per-execution Controller runtime, read-only restart reconciliation and original host/service tests remain required CV-09 work after this reviewed slice. No parent checkbox is completed merely by this backend port.

**Task 1 implementation evidence (2026-10-23):** Restored all145 original expanded
cases (59 server,49 lifecycle,7 interrupt-admission,30 turn-result) and added32
contract regressions. Canonical attach fixtures independently register original
managed execution context for A/B; the obsolete Runner import and pre-prompt
received assertion were adapted to current observation/waiting contracts. The
explicit optional readonly CLI interaction field preserves exactOptionalPropertyTypes.
Final focused run:4 files/177 tests passed. Single final-code
`mise exec -- pnpm check`: exit0,183 files/2280 tests passed, including build,
typecheck, lint and architecture boundaries. `git diff --check` passed.
Verification source HEAD was `cde9407ecef0fe43f6918183cc66ce234de84fdc` plus this
scoped slice; full log `/tmp/dispatcher-opencode-full-check.log`. All RED/failure
logs remain under `/tmp/dispatcher-opencode-*`; no assertion/deadline/worker
weakening or unchanged full-gate retry. Detailed delivery report:
`.superpowers/sdd/2026-10-23-opencode-server-port/task-1-report.md`.
Independent review and parent CV-09 acceptance remain open; fixture success does
not establish installed-provider/account, GUI, writer-release or service Gates.
