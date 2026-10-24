# Exact OpenCode Controller Composition Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, or the already authorized superpowers:subagent-driven-development workflow, task by task after dependency review. This preparation launches no implementation or child agents.

**Goal:** Compose explicitly registered OpenCode server runtimes into canonical start/source/retention/shutdown and narrowly read-only restart reconciliation.

**Architecture:** Extend current Codex/Pi runtime registry composition with OpenCode. A small shared Codex/OpenCode exact-start validator derives authority from a registered managed workspace; Pi keeps its existing path. Existing durable disconnect and shutdown pipelines remain the owners of receipts/barriers/database lifetime. Provider-specific restart qualifiers use frozen persisted canonical data and grant no native source.

**Tech Stack:** Existing TypeScript ControllerService, OpenCode producer/port, NativeRuntimeHosts, InteractionStore/SQLite and Vitest. No schema migration, provider dependency, new credential or generic native framework.

**Spec:** `/tmp/dispatcher-opencode-config-catalog-composition-20261023.md`, section 4; `docs/superpowers/plans/2026-10-23-opencode-registration-port.md`.

## Prerequisites and global constraints

- Consume reviewed catalog `0208bff`, runtime `761dddd` and atomic registration `394a33d`. Re-read each changed file after its commit and record the actual clean dispatch BASE after root metadata. None of these dependencies is active WIP; no real profile has been activated.
- Runtime dependency must implement `CliAgentBackend` with literal `backendId="opencode-server-v2"`, `start(CliStartInput):CliTurn`, `source(NativeBinding):NativeInteractionPort|undefined`, `beginShutdown():void`, `isClosed():boolean`, `hasUnclosedHosts():boolean`, `hasActiveOperations():boolean`, `disconnectLocal():Promise<RuntimeLocalDisconnectResult[]>`. Constructor consumes `{profile,runnerId,assertInput,bindingFor,factory?}`. Existing producer factory is `(scope:OpenCodeV2OwnedScope, executionRef:ExecutionContextRef)=>OpenCodeV2ExecutionBackend`; confirm its final exported alias rather than invent one.
- Runtime profile is current CliAgentProfile narrowed by registration to executable/model/approveTools:false. Runtime constructor/admission alone captures an existing physical regular executable, checks `access(X_OK)` without a native probe, and rejects replacement with fences after async waits; no home/account directory is invented. Registration/service must not duplicate executable filesystem validation.
- Preserve immutable ExecutionSelection, exact managed reference, Adapter invocation, observer durability and `beforePrompt` synchronous authority; exact requested model comes from the frozen selection, not mutable profile defaults.
- Synthetic nativeStoreRef remains unqualified. Preserve existing capability declarations: no inferred stop/detach/release, continuation/resume, native-default execution, GUI access, native writer release or account isolation.
- No weakening of `profileHasActiveOperations`: nonterminal canonical Runs remain active even after native turn completion or local disconnect.

## Execution and evidence contract

Each numbered task is one sequential SDD implementation/review unit. One implementation agent at a time. Implementer writes focused RED/GREEN, self-reviews, runs one final default `mise exec -- pnpm check` on that task payload with exact command/exit/duration/log/source SHA256/result manifests, commits only owned paths and writes assigned report; root then dispatches combined independent specification/quality review. No worker-created reviewer/subagents. Earlier failed evidence remains separate; no unchanged-code retries, timeout/worker/assertion weakening or probe caches. Root compares committed payload to final manifest. Root owns convergence evidence/disposition/Linear and parent CV14 broad branch review/integration; local task reviews never complete CV09 or actual native Gates. If later steps mention parent combined gate, this contract still requires the current shared-contract/service task's own final default gate.

## Review focus

1. An extra copied exact-start validator would drift; the shared helper must preserve every existing Codex invariant without making identity fields optional or deriving a Run from commandId.
2. A completed Adapter turn can leave the canonical Run ACTIVE; profile-change fixtures must explicitly terminalize it instead of expecting cleanup to bypass the active Run gate.
3. Receipt/read-barrier failure must retain the exact closed runtime and cached cleanup; retries cannot repeat provider disconnect or admit its old source.
4. Shutdown must attempt all three provider registries, HTTP and event closure even if a provider drain or receipt write fails; uncertain callbacks preserve SQLite.
5. OpenCode restart must reject Codex-shaped thread identity, partial/corrupt binding and mixed providers, and create no host or write authority even for consistent records.

## Files and verified direct patterns

| File | Responsibility / reference |
| --- | --- |
| `apps/controller/src/service.ts:196-222,493-496` | Runtime factory option/type/maps. |
| `service.ts:569-576,736-745` | Preflight admission and read-only restart reconciliation. |
| `service.ts:812-853,859-885,938-957` | All-runtime drain, exact source owner routing, atomic receipt/read-barrier persistence. |
| `service.ts:1259-1296,1382-1438` | Active operation guard, retained adapters and runtime construction/event sink. |
| `service.ts:2079-2096` | Existing exact Codex and separate Pi input checks. |
| `apps/controller/src/start-recovery.ts:34-49` | Current consistent Codex metadata qualifier. |
| `apps/controller/test/opencode-runtime-service.test.ts` (new) | Current canonical OpenCode integration/retention/shutdown/restart fixtures. |
| `apps/controller/test/codex-runtime-service.test.ts` | Preserve exact source/start/retention/restart tests; extend cross-provider shutdown matrix here or focused new file. |
| `apps/controller/test/native-recovery-preflight.test.ts` | Preserve generic guarded-start and corrupt certificate refusal. |
| `docs/architecture.md`, `docs/know-how.md` | Record actual registered/read-only boundary and any new durable constraint only. |

## Task 1: (C1) Share exact Codex/OpenCode start authority and compose the runtime

**Interfaces**

- Add optional `ControllerOptions.opencodeExecutionFactory?: (scope:OpenCodeV2OwnedScope, executionRef:ExecutionContextRef)=>OpenCodeV2ExecutionBackend`, using reviewed exported types if available. It constructs one scoped producer; it is not a native session lookup/fallback API.
- Extend OwnedNativeRuntime, add `opencodeRuntimes:Map<string,OpenCodeExecutionRuntime>`, extend nativeRuntime/allNativeRuntimes and pruning with literal server backend. Retain nativeRuntimeAdapters WeakMap instance ownership.
- Introduce private exact helper in service.ts:

  `assertManagedNativeInput(profileId:string, owner:{providerId:"codex";backendId:"codex-app-server"}|{providerId:"opencode";backendId:"opencode-server-v2"}, input:{executionRef:ExecutionContextRef;workspacePath:string;executionSelection:ExecutionSelection;commandId:string}):Run`

  Wrappers validate required optional external fields before calling it; keep helper fields required. Return the validated Run for OpenCode's additional nativeInput Run/session checks. All rejection paths use current `InteractionGuardError("EXECUTION_CONTEXT_DRIFT")`; wrapper/runtime converts them to current not-created admission outcome.

- [ ] Re-read current service, Codex runtime/tests and reviewed OpenCode runtime. Require final runtime lifecycle/source semantics and executable-file qualification before composing; return a dependency gap to parent if absent, do not fill it with an inline fallback.
- [ ] Write a current fixture modeled on codex-runtime-service.test.ts: temporary Git repository/worktrees, absolute existing executable stub never executed, explicit server ConfigPlan, exact current context selection, frozen contract repository/base, canonical Task/Run/Session/control, reserved Adapter session/invocation and required observer callbacks. Use fake owned host/port responses only. Preserve the independently reviewed producer's protocol version and response schema; do not reuse the old 2.0.22 fixture indiscriminately.
- [ ] Add tests for zero factories at profile application, two distinct exact managed executions/native bindings, selection.actual backend identity, and no standalone argv/native default fallback. Inject canonical catalog data through the reviewed actual-backend normalizer in publication tests; no native account SQLite reads.
- [ ] Exercise enabled missing/directory/non-executable physical executable and later replacement indirectly through the real runtime construction/admission seam: reject before native factory work, preserve current configuration on failed apply/rollback. A valid disabled structural registration performs no runtime/factory/file work. Reuse the runtime's validator rather than adding service checks.
- [ ] Add table-driven pre-create rejection: missing workspace, replaced physical workspace, task.currentRun drift, canonical/provider/Runner mismatch, nativeInput runId/sessionId mismatch, Adapter session/invocation mismatch, generation/attempt/lease drift, full selection/ref change, repository/branch/base drift, terminal Run and Controller shutdown. Assert no producer factory/create/prompt. Stage additional drift after an awaited binding/observer callback and assert no prompt.
- [ ] Add paired Codex regressions for the helper extraction: stale invocation, reserved Adapter session, immutable selection/reference and generation/attempt/lease remain refused. Include a valid invocation ID unequal to Run/native-start journal ID so commandId is never interpreted as Run identity.
- [ ] Run new tests to obtain expected missing registration/runtime composition failures.
- [ ] Extract the exact existing Codex predicate to the narrow shared helper, preserving stopping/ref/embeddedRunner/workspace, workspace-derived Run, canonical currentRun, nonterminal state, full run/session selection/ref, reserved session IDs, profile/provider/backend/Runner, nativeInvocationId, execution tuple, worktree/workspaceId/repository/branch/base and `fenceNativeSpawn`. Codex wrapper supplies constants; OpenCode wrapper requires nativeInput version/profile/backend and compares its runId/sessionId to returned Run/session. Preserve Pi's method unchanged.
- [ ] Add OpenCode runtime registry/factory construction only for applied explicit local embedded managed configuration. Connect through existing createNativeProfileAdapter cliBackendFactory and existing observer sink/currentness callback. Retain exact runtime-to-Adapter owner association. The captured OpenCode runtime's assertInput callback must first require that this exact runtime is still the registered profile runtime and its saved owning Adapter is still the current Adapter, then call the shared exact helper; check that old handles fail after runtime/Adapter replacement. This requires no third copied canonical predicate. Do not add Codex native request authority/sink capabilities to OpenCode without an already qualified actual interface.
- [ ] Extend source routing/pruning through the common registry; exact runtime.source plus persisted binding and current Adapter instance remain required. Add tests: no aggregate port; swapped Adapter/runtime/binding, closed runtime, source loss and foreign execution never reuse another session or create a host. Same unchanged profile/Runner identity preserves Adapter/runtime across unrelated config apply; capacity/labels do not rebuild it.
- [ ] Run `mise exec -- pnpm vitest run apps/controller/test/opencode-runtime-service.test.ts apps/controller/test/opencode-runtime.test.ts apps/controller/test/codex-runtime-service.test.ts apps/controller/test/codex-runtime.test.ts apps/controller/test/native-start-intent.test.ts apps/controller/test/interaction-guard.test.ts`.
- [ ] Review/commit the scoped exact composition. Registration/factory privacy and strict model admission must remain intact; no changes to Pi authority semantics.

## Task 2: (C2) Exact retention, durable drain and three-registry shutdown

**Depends on:** C1 and reviewed runtime coalesced/cached normalized disconnect semantics.

**Interfaces:** Preserve `disconnectNativeRuntime(profileId, expectedRuntime?)` and current receipt kinds `native-runtime-local-disconnect` and `native-runtime-disconnect`. Use existing atomic transaction storing local receipt and invalidating observation/read barrier. Preserve public API authentication/explicit confirmation rather than adding a new OpenCode route.

- [ ] Add original idle-profile test with a helper matching current `endFixtureRun`: await Adapter result then persist genuinely terminal canonical Run/Task. Verify replacement fails `NATIVE_RUNTIME_DRAIN_REQUIRED` while host is undrained; explicit drain persists unknown observation and receipt, then replacement succeeds with old runtime removed. Add separate ACTIVE Run case: after physical drain/receipt, replacement still fails `ACTIVE_AGENT_PROFILE` and retains original canonical state.
- [ ] Parameterize local-disconnect persistence faults over `native-runtime-local-disconnect` and `native-read-barrier`. Assert transaction rollback leaves no receipt/invalidating partial state, source is withdrawn once closed, original runtime stays registered, replacement is blocked, then retry persists exactly one receipt/barrier and provider disconnect remains once.
- [ ] Add normalized cleanup unknown cases for connection/root/callbacks, acquisition rejected/late and observer callback stuck. Assert no native session deletion, backgroundTools unknown, cached unknown receipt retained, no replacement allowed, no native release claim.
- [ ] Preserve SQLite while any exact runtime still reports actual raw operations, even if its local manager receipt is an empty list or otherwise closed. Current stop checks only hasUnclosedHosts; extend that same final common barrier to hasActiveOperations as well, without adding another shutdown pipeline. Cover pending executable admission released publicly by shutdown and pending callback work separately, and retain all Codex/Pi shutdown regressions.
- [ ] Include the exact registered native runtime's hasActiveOperations in the existing Controller profileHasActiveOperations predicate. StructuredCliAdapter currently reports only its public starts/cancels/sends/turns, unlike CodexAdapter's backend delegation; do not assume public failure means raw work settled. With a terminal canonical Run and durably recorded local cleanup, pending raw runtime work must still block profile replacement as ACTIVE_AGENT_PROFILE. Add this focused regression without widening the generic Adapter contract.
- [ ] Add successful shutdown case reopening SQLite read-only through fixture verification after clean close: original binding/session retained, observation unknown, local receipt persisted before close. Assert no delete API and no new native session.
- [ ] Expand current two-provider failure test to three registries, parameterized by failing `pi`/`codex`/`opencode` disconnect and by each provider's receipt write. Always assert all beginShutdown calls and all disconnects attempted once, HTTP/events close once, successful other provider receipt persisted, thrown failure retained, and database stays available. For multiple faults assert AggregateError rather than dropping errors. Use normalized runtime doubles only for unrelated providers, and a real scoped OpenCode runtime fixture for its own path.
- [ ] Add startup observer persistence failure and shutdown during start/callback settlement: keep original start command/invocation unknown, no second create/prompt/replay, late callback cannot reacquire source, uncertain callback retains DB. Include known-unsent not-created cleanup so a never-opened runtime does not fabricate a process or leave an unjustified host barrier.
- [ ] Run focused failures, then preserve the existing common pipeline with only required registry extension. Do not implement new receipt retry maps; Controller retries its persistence transaction while runtime returns its cached cleanup.
- [ ] Run `mise exec -- pnpm vitest run apps/controller/test/opencode-runtime-service.test.ts apps/controller/test/codex-runtime-service.test.ts apps/controller/test/pi-runtime.test.ts apps/controller/test/native-command-receipt.test.ts`.
- [ ] Review/commit. All runtime unknown facts must retain SQLite and the exact closed handle until durable reconciliation; physical cleanup never terminalizes a canonical Run.

## Task 3: (C3) Provider-specific read-only OpenCode restart qualification

**Depends on:** C1/C2; reviewed normalized OpenCode binding shape and registration/canonical catalog.

**Interfaces**

- Add `isReadableManagedOpenCodeRun(database:DispatcherDatabase, run:Run):boolean` in start-recovery.ts. Keep isGuardedControllerStart and isReadableManagedCodexRun behavior intact.
- A small local storage-consistency helper may be extracted to avoid copying the current dense Codex qualifier, but provider wrappers must separately enforce exact provider/backend/product/region/thread/parent semantics. No arbitrary provider parameter or generic bound-native admission exported.
- OpenCode exact shape: provider/product opencode; backend opencode-server-v2; global region; bound nativeSessionId using the reviewed runtime's `^ses[A-Za-z0-9_-]+$` grammar and safe identifier bound; nativeThreadId and parentSessionId absent. Codex retains nativeThreadId===nativeSessionId and its own product/backend. Consistently replace all binding copies with a malformed session spelling in the corruption matrix, so this provider rule is actually tested.

- [ ] Add consistent restart fixture produced by C1 start/binding, then stop. Construct/start a second Controller against the saved DB with the same factory spy. Assert no additional factory/native calls, Run/session/binding/invocation identity retained, Run becomes RUNNER_UNAVAILABLE with NATIVE_OUTCOME_UNKNOWN/manual resume, Task waits for resource, observation/read barrier invalidated to unknown, mutations/advance/continue unavailable.
- [ ] Add direct qualifier read-only assertion using SQLite `total_changes()` before/after; no physical executable/account/native read is required for stored qualification. Keep service construction's enabled runtime physical executable qualification separate from storage certificate checks.
- [ ] Add corruption matrix across: missing/mixed Run and Session provider; wrong selection backend/profile/Runner/context/requested model; legacy modelSelection; invalid/mismatched executionRef/workspaceId; missing contract or repository/base drift; missing Adapter session/nativeInvocationId; Adapter IDs/profile/backend/worktree/selection/ref/generation/attempt/lease mismatch; identity diagnostics; missing binding or disagreement between normalized/session/adapter/stored binding; wrong binding product/region/backend/Runner/executionRefId/store/session; forbidden nativeThreadId/parent; missing/malformed control version/epoch/revision/state/exclusion/owner; duplicate SQL control owners and row/document disagreement. Mutate isolated facts, reopen, assert NATIVE_CONTROL_RUNTIME_UNAVAILABLE, zero new host and unchanged original Run. For forbidden product/region/backend/thread/parent shapes, also consistently replace all binding copies so rejection depends on explicit provider rules rather than merely unequal copies. For opaque native session/store values, test actual persisted disagreements; do not invent external provenance that could distinguish a completely rewritten internally consistent database.
- [ ] Run red tests; implement the OpenCode qualifier with the same storage consistency protections as Codex and `validateExecutionBinding` against frozen contract repository/base. Optional shared internal consistency logic returns checked records only; provider-shape rules remain explicit. Do not broaden generic guarded-start, which intentionally rejects executionRef.
- [ ] Add qualifier to both constructor preflight exception and reconcileLocalStartJournals read-only branch. Preserve receipt projection updates; no source restoration, native connection, native replay, replacement session, continuation or active writer ownership is granted.
- [ ] Run `mise exec -- pnpm vitest run apps/controller/test/opencode-runtime-service.test.ts apps/controller/test/codex-runtime-service.test.ts apps/controller/test/native-recovery-preflight.test.ts apps/controller/test/native-start-intent.test.ts apps/controller/test/interaction-guard.test.ts`.
- [ ] Self-review the scoped restart payload, then run its one final default `mise exec -- pnpm check` with the execution-contract source/result manifests. It already includes build/typecheck, lint, boundaries and tests; do not duplicate broad checks without a concrete new need. Commit the tested payload and report for root independent spec/quality review. Root updates coordinated architecture/know-how afterward. Report local synthetic evidence only; parent CV14 still owns whole-branch review/integration.

## Original eight expanded service assertions: complete disposition

Historical source: `a499d84:apps/controller/test/opencode-runtime-service.test.ts:17-21`.

| ID | Original assertion | Current adaptation / task |
| --- | --- | --- |
| S1 | Two exact canonical worktrees, native binding persistence, distinct native sessions, no standalone argv | C1 current selection/contract/reserved invocation fixture and two-runtime test. |
| S2 | currentRun drift rejects before creation | C1 canonical Task currentRun corruption; zero factory/create. |
| S3 | session drift rejects before creation | C1 nativeInput/session/reserved Adapter agreement rather than relying only on caller's session string. |
| S4 | provider drift rejects before creation | C1 frozen selection + canonical provider + factory owner exact match. |
| S5 | lease drift rejects before creation | C1 full generation/attempt/lease tuple plus `fenceNativeSpawn`. |
| S6 | Idle profile explicitly drained and observation unknown before replacement | C2 uses terminal Run/Task fixture. Original ACTIVE Run + completed Adapter result is not current canonical idleness. |
| S7 | Cleanup/binding retained before SQLite close | C2 normalized cleanup + unknown observation + retained native binding/session; uncertain cleanup does not close DB. |
| S8 | Durable receipt retry does not repeat native close | C2 both local receipt and read-barrier failures; retain exact closed runtime and cached provider result. |

Current Codex direct pattern tests are at lines 151,190,216,244-313 of codex-runtime-service.test.ts; current corruption certificate tests are native-recovery-preflight.test.ts:12,41,49. These are source patterns and required regressions, not evidence that this new OpenCode composition already passes.

## Review notes / unresolved choices

- Recommended clean seam: registration R1/R2 is one reviewed delivery; C1/C2/C3 can be sequential review units within service/restart delivery. Do not allow simultaneous edits to service.ts or start-recovery.ts.
- Final runtime class/export alias and executable physical identity details must be checked against the reviewed runtime output. All other ownership/lifecycle semantics above are fixed requirements, not open design choices.
- Exact selector bound is240, established by current freezeExecutionSelection requestedModel validation and canonical catalog composite IDs. Producer's earlier512 identifier precheck is not its effective accepted bound because it subsequently invokes that same validator. Preserve existing standalone settings; this new explicit registration uses the canonical bound.
- Original four generic config groups are accounted for in registration plan; restoring the old global/GUI feature would conflict with the current narrow contract and is excluded.
- No tests/native probes/account reads/Linear/installation/repository mutations were run to prepare these drafts. Local fixture coverage cannot qualify actual provider/account/store isolation, writer release, GUI takeover or restart continuation.
