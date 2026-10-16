# v3 Backend Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete all frontend/backend adaptation in the supplied implementation document; Policy routing first, real Remote Runner execution second, then close the remaining requirement gaps.

**Architecture:** Reuse canonical publication receipts and frozen ExecutionSelection. Pure keyword/rule evaluation belongs in scheduler with pure types in domain; Controller owns classification I/O, persisted decisions and authenticated approval. Remote execution must use the existing authenticated protocol and owning Runner workspace/adapter, never Controller impersonation.

**Tech Stack:** Existing TypeScript, AJV, SQLite entity store, ConfigPlan, Vitest, React Query, native adapters; no new package. The approved routing design explicitly chooses bounded pure rules rather than a third-party engine, so no third-party rule code or license dependency is introduced.

**Spec:** /Users/wangdongxin/Downloads/Dispatcher-v3-Backend-Implementation-2026-10-15.md; docs/superpowers/specs/2026-10-06-task-routing-policy-design.md; frozen architecture roadmap.

## Global Constraints

- Latest user goal controls quota: read official limits after every completed unit; stop when any readable window has remaining <=10%.
- Keep complete goal active until requirement-by-requirement evidence proves it. Passing local fixtures does not prove native/remote/provider/account Gates.
- Config writes use ConfigPlan; domain/protocol remain I/O-free; secrets remain opaque references.
- Policy is opt-in, selected account/project only; no model/effort/account/Runner fallback on no match, conflict, stale catalog, invalid effort, denial or semantic failure unless the configured unique-keyword classification downgrade applies.
- Preserve legacy HTTP/Slack and explicit selections. Freeze original raw-input hash, applied config/rule/type versions, classification, native catalog, selected parameters and confirmation facts per Run.
- Remote catalog/probe/start/verification/result execute on the owning Runner and registered workspace; revocation, generations, leases and currentRunId fence all writes.
- No native login/network/global configuration mutation. Actual external-provider execution is separate evidence and may require a configured available Runner/account.

## Review Focus

1. Text normalization versus original instruction identity: NFKC/word boundaries must not normalize approval hashes.
2. Repeated preview/commit or dropped responses must not classify twice, change choice or start duplicate Runs.
3. Invalid winning project rule must not fall through to a global/default target.
4. Config/account/native-directory changes during async classification or startup must invalidate old authorization.
5. Remote transport reconnect/replay/revocation must never execute stale or Controller-local work.

## Units

### 1. Policy data and deterministic evaluation

Files: packages/domain/src/model-routing.ts, packages/config/src/schema.ts, packages/scheduler/src/model-routing.ts and their tests.
Interfaces: TaskModelRoutingConfig, TaskClassification, ModelRoutingDecision; classifyKeywords(input, types), selectModelRoutingRule(config, context, classification).
- [x] Add failing tests for backward-compatible config, limits/references, Unicode/word boundaries, any/all/exclude, original evidence spans, no-match/ambiguity, project/account isolation, priority, same-target merge/conflict.
- [x] Implement pure types/schema/functions, retaining existing scheduler eligibility.
- [x] Run targeted checks, commit, check quota.

### 2. Policy publication and keyword UI loop

Files: apps/controller/src/model-routing.ts, service.ts, task-publications.ts; domain publication; PoliciesPage, PublishPage, TaskDetail and regressions.
- [x] Persist deterministic decision snapshots, applied/draft test distinction and explicit preview/read APIs; all previews remain zero-worktree/zero-agent-start.
- [x] Bind decision/confirmation to actor, raw input, config and final selection; revalidate native catalog and winning target at commit/start without reclassification; preserve immutable history and idempotency.
- [x] Add ConfigPlan-backed policy editor/test and manual/auto publication flow with no implicit override.
- [x] Test frozen actual adapter parameters, failure cases, dropped-response replay and old entry behavior; full gate, native read/controlled execution evidence where available, commit/check quota.

### 3. Optional semantic classification

Files: llm-runtime contracts/runtime, config roles, Controller model-routing, web internal roles and tests.
- [x] Add task_classifier only when requested, strict type/evidence schema, tool-free bounded input, 20s total cancellation, <=700 output tokens, 16000 Unicode input characters.
- [x] Per-call provenance/usage/fallback trace, keyed deduplication and stored classification; native refresh never re-bills classifier. Test complete hybrid arbitration matrix and configured unique-keyword downgrade.
- [x] Full gate and controlled endpoint evidence; commit/check quota.

### 4. Remote native execution

Files: protocol commands, runner command handlers/runtime, Controller remote adapter/context/workspace/verification orchestration and tests.
- [ ] Audit existing remote envelope/journal/lease boundaries; extend typed commands for owning Runner inspect/catalog/session/workspace/verification/result.
- [ ] Preserve repository IDs and Runner paths, remote PID/native identity, frozen selection, trusted result/usage events, disconnect/manual recovery and revocation fences.
- [ ] Controller-zero-local-run negative tests and process-separated Runner end-to-end evidence, then real distinct-device evidence if available. Full gate, commit/check quota.

### 5. Remaining document gaps and final audit

- [ ] Audit BE-01..BE-35 and every section/button against current source and authoritative evidence; retain delivered work, identify partial/unverified requirements explicitly.
- [ ] Complete safe console config leaf patches/protected fields, durable account/context probes, local picker/context/refs, durable input receipts, usage dedup/ranges, diagnostic process/window measurements, explicit commit/PR delivery and event coverage as the audit requires.
- [ ] Full gate plus desktop/mobile end-to-end, independent fresh-context final review (executing-plans skill), repair with regressions and final acceptance map. Close goal only when all required scope is proven.

## Execution ledger

- Initial state: clean codex/dispatcher-v3-console at 8bd5892; official remaining75%. Previous interrupted turn completed read-only preflight; no product mutation or live job was left running by it.
- Existing v3 and 2026-10-06 routing documents are the user-selected implementation inputs; no new approval round is needed to execute that authorized scope. New boundary conflicts will be reported before widening scope.
- Remaining scope is not reduced to Policy/remote: unit5 retains all document requirements and external Gates for the final audit.

- Unit 1: opt-in schema, bounded references/keywords and deterministic keyword/rule evaluation implemented. Domain/config/scheduler builds, 40 config+scheduler regression tests, lint and diff check passed. Official remaining74%; no external inference used.

- Unit 2 implementation checkpoint: publication decision/approval/catalog fences and ConfigPlan-backed policy UI/trials are implemented; full gate passed50 files/388 tests. Official remaining73%. Real Cursor policy execution is running in a disposable repository; native completion/browser evidence and deferred-task fresh review remain tracked, not claimed complete.

- Unit 2 native/browser evidence: Cursor gpt-5.4-nano-low, Run c7273401-e24d-41ef-bfb0-a8116ac3cc71, native session 2b2d3d4c-b9ee-409f-8f5b-139baaf2ef71 reached COMPLETE/PASSED and Task REVIEW in disposable repository. result.txt exact bytes dispatcher-publication-ok plus newline; native reasoning parameter omitted. Browser4178 displayed the real catalog-backed keyword trial, selected rule and native-default omission. Deferred-task fresh routing review remains the next Policy follow-up.
- Unit 3: optional task_classifier, strict type/evidence validation, complete hybrid arbitration, per-call fallback provenance/observed usage, shared deadline/cancellation, analysis deduplication and explicit reanalysis implemented. Full gate passed52 files/403 tests; official remaining72%. Controlled injected endpoint only for classifier tests; real paid semantic-provider acceptance is not claimed.

- Policy follow-up unit 2b: create-only tasks reuse the same publication composer, task-bound preview and receipt. Canonical revision/contract/hash/frozen commit fences prevent duplicate Task creation and stale starts; empty manual overrides cannot bypass auto intent. Full gate52 files/406 tests passed. Real deferred Cursor execution is in progress; result not yet claimed.

- Unit 2b native completion: deferred Cursor Run25e75cfb-5949-479c-bedb-baa5a107e691 and native session6e70769f-39dd-48b6-8220-221ceef1b9b6 reached COMPLETE/PASSED and Task REVIEW, with exactly one canonical Task064c1aba-75d6-4409-b037-144c600b897f. Cursor installed version2026.10.01-e373342. Agent-side shell refusal was separate from the passing Controller verification command.
- Unit 2c: schema-backed routing editor uses real concrete native catalog choices, parameter omission and ConfigPlan; enabled routing changes qualify native targets at plan and apply with revision/evidence fences. Account/project contexts must be applied first. Fixed getPlan lifecycle projection from the persisted row so successful apply replay stays idempotent. Full gate52 files/412 tests; official remaining70%. Browser editor acceptance is being checked before the remote unit.

### Remote unit execution detail

- Preserve Controller/Runner authentication and journal transport. Negotiate native-execution capability; older health-only connections cannot start native work.
- Add a versioned normalized command contract for owning-Runner repository inspection/planning, catalog/probe, lease-bound workspace preparation, native start/status/input/cancel/result, verification and changed-file evidence. No executable strings, native tokens or Controller filesystem paths authorize a remote native start.
- Runner owns its registered profile/repository configuration, native adapters, managed workspaces, command registry, durable execution reservations and current lease/generation fences. Duplicate or uncertain starts never respawn after restart/replay.
- Controller uses a remote AgentAdapter facade and workspace inspection port. Reserve canonical Run/task/lease before remote filesystem mutation; prepare the worktree and re-query the actual native context before start. Remote results and verification return through the same authority and receipt path.
- Add optional repository runnerId, defaulting old registrations to local. Never register remote paths in Controller's local RepositoryRegistry or construct local native adapters for remote profiles.
- Extend Runner CLI serve to load its local registrations and expose only qualified inventory/capabilities. Probe/catalog/verification execute on that Runner. Persist process/native-session/workspace evidence and keep disconnect/revocation/recovery explicit.
- Validate with transport/unit negatives (stale payload, generation, lease, unsupported capability, Controller-zero-local-run), process-separated integration and a real native CLI on the owning Runner. Distinct-device acceptance remains pending a target: current primary config has only local Runner; an async clarification was sent while implementation continues.

- Unit 2c final acceptance: full gate52 files/413 tests passed after a live Cursor status-progress false-conflict fix. Real native refresh returned native-fresh/explicit with265 candidates. Browser4178 selected the actual gpt-5.4-nano-low target and generated a privileged /policies ConfigPlan from a priority edit; no apply or execution occurred in this UI check. Account switches, unknown/contradictory markers, auth expiry and native configuration fences remain covered. Official remaining69%. Policy local implementation units complete; paid semantic-provider and distinct-device formal Gates remain explicit final-audit items.

- Unit 4a completed: transport1.2 plus additive native-execution-v1 capability/strict descriptors; lease-bound native commands; no executable/root override; zero-worktree WorkspaceManager.plan; in-flight retry coalescing; durable command hashes; conflict-safe response replay; fully-compacted sequence continuity. Full gate passed52 files/420 tests with pnpm check --maxWorkers=2. A preceding workers4 run hit two existing3s temporary Node CLI probe timeouts; the unchanged two files passed24 tests independently, then the complete lower-concurrency gate passed. Native execution orchestration is still pending. Official remaining67% before the next unit.
- Unit 4b completed: owning NativeRunnerRuntime with separate ConfigPlan/database registrations, read-only planning, durable workspace/start reservations, command bindings and input/verification receipts, concrete native selection validation, managed result files and verification. STARTING is saved immediately before native spawn; real backend PID is optional evidence. Lost handles after restart remain unknown, while unstarted prepared workspaces restore safely. Expiry/revocation cancels owned native turns and aborts verification children. Full gate passed53 files/433 tests with pnpm check --maxWorkers=2. Official remaining66%. Tests use controlled native backend fixtures; production CLI wiring, Controller remote facade and process-separated/real-device acceptance remain pending.
- Unit 4c completed: shared native profile factory used by Controller and Runner; Runner CLI ConfigPlan plan/apply registration, durable transport journal and native handlers; authorization revocation stops reconnecting and shuts down owned execution. Atomic SQLite single-writer ownership prevents configuration CLI from rewriting a live Runner's sessions as recovery records. Native spawn rechecks expiry after durable storage, and workspace creation fences after read-only planning. Full gate passed55 files/440 tests; official remaining65%. Existing provider capability limits remain explicit (Kiro/pi/zcode/workbuddy-cli have no qualified explicit native catalog). Controller remote orchestration and process-separated/native acceptance remain pending.
- Unit 4d completed: optional repository Runner binding with legacy local omission, foreign OS path validation without Controller interpretation, zero Controller-local remote adapter construction/registration, owning Runner catalog/profile tests/publication repository inspection, normalized bounded catalog response validation, and same-Runner Policy qualification. Runner rejects foreign repository use, scope widening and omission of required registered verification commands. Full gate passed58 files/446 tests; official remaining64%. Remote dispatch remains explicitly unavailable until the next start/result/verification orchestration unit; controlled WebSocket fixtures are read-path evidence only.
- Unit 4e completed: RemoteNativeAdapter and canonical remote dispatch reserve Run/task/lease before owning-Runner workspace creation, revalidate the actual worktree catalog, start with frozen parameters, and return native status/result/usage, frozen verification and scoped files through RPC. Native completion retains capacity until fenced Controller finalization. Unknown startup stays RUNNER_UNAVAILABLE/OUTCOME_UNKNOWN with stable command/publication identity; dropped-response replay performs no second start. Configured capacity caps the reported runtime capacity. Controlled WebSocket+real Git/Node verification tests cover completion, startup catalog invalidation, unknown response and failed verification settlement. Full gate passed60 files/455 tests with pnpm check --maxWorkers=1; official remaining63%. The first workers2 gate found a reused-draft fixture and an old capacity-only runtime fixture, both corrected to their intended preconditions without loosening assertions, plus one existing3s temporary Node probe timeout; that unchanged file independently passed23 tests before the entire lower-concurrency gate passed. Reconnect/lease renewal/revocation lifecycle, process-separated native execution and real-device acceptance remain next; remote commit/PR delivery remains in the remaining-gap audit.
- Unit 4f foundation completed: registration readiness ordering, synchronous outgoing replay before immediate reconnect RPCs, late old-socket response flushing and bounded process-local replay without a disk journal; strict native start/session/handle reconciliation fences; durable terminal native result/usage evidence survives Runner restart without fabricating attachment. Full gate passed60 files/460 tests with pnpm check --maxWorkers=1. A preceding full run and one isolated run reproduced the existing version-probe failure; safe stage/failure classifications and explicit missing/timeout/output-limit/failure regressions were added with original 3s/5s bounds unchanged. The transient readiness failure's cause is not proven; passing current full gate does not claim it fixed. Controller reconciliation and remote lease lifecycle integration remain pending.

### Next remote lifecycle and acceptance detail

- Reconcile an already owned native process using the immutable native-start command hash, session/workspace identity and current lease/generation. Controller restart alone must not infer that a still-running separate Runner lost its handle; Runner restart with lost handles remains unknown and never respawns.
- Renew remote leases through authenticated RPC before persisting a matching Controller renewal; no renewal revives expired/revoked authority. Revoke/stop stale ownership after failed canonical renewal and expose uncertain cleanup. Credential loss must stop native writes.
- Reject cross-Runner reroute of an existing worktree; remote recovery must not fall through to Controller-local native start or verification.
- Prove process ownership/PID and cancellation with a separate native CLI child process, then execute a real qualified native provider on the owning Runner in an isolated repository. Cross-device target remains pending the user response.
- Audit Codex process-group cancellation alongside the existing StructuredCli owned group termination before claiming native revocation acceptance.
- Unit 4b implementation detail: reuse ConfigurationEngine/ConfigPlan and DispatcherDatabase in a separate Runner data directory for applied local account/repository registrations, session store, durable execution/operation receipts and lease authority. RunnerJournal remains transport replay, not physical execution authority. Serve without applied registrations stays health-only. Configuration/credentials are never copied from Controller into a Runner command.
- Remote workspace sequence: read-only inspect/plan, reserve canonical Run/task/lease, native.workspace_prepare with that authority, fresh catalog in the prepared actual worktree, then normalized run.start. Runner freezes its own registered verification commands; Controller metadata must match the owning registry. Preserve native PID/session/worktree evidence. Interrupted native starts and compacted/missing receipts require reconciliation, never a fresh blind start.

- Unit 4f Controller lifecycle completed: immutable ownership reconciliation, phase-preserving reconnect/restart, snapshot-before-query fencing/coalescing, acknowledged lease renewal with post-await canonical fence, durable revocation and lease-based unknown-start cancellation. Credential removal rejects old-token registration; handshake close/malformed response no longer hangs or leaks provider errors. Runner shutdown revokes all admitted leases before any cancellation await. Full gate passed60 files/478 tests with pnpm check --maxWorkers=1; official remaining59%. The first gate failed the unchanged3s temporary Node version probe (TIMEOUT); that file passed24 tests independently and the full gate then passed, with no timeout/assertion relaxation. Kernel process/group termination and separate-process native acceptance remain next; controlled fixtures alone do not prove them. Foundation7969822's quota was successfully re-read at61% before this unit.

- Unit 4g owned-process cleanup completed: shared owned group drain for Codex/structured native turns and verification, actual descendant absence after escalation, normal-exit cleanup before terminal evidence, cancellation despite failed persistence, and verification stop-ACK waits. Real Node child/grandchild regressions observed old background-write ownership bugs, then passed. Full gate passed61 files/485 tests with pnpm check --maxWorkers=1; official remaining58%. A first full gate loaded the new cancellation-failure test before its guard-order fix and failed SESSION_BUSY versus SESSION_CANCELLED; targeted11 tests and the subsequent complete gate passed without weakening assertions. Unix kernel behavior is proven locally; Windows tree semantics remain a distinct real-platform Gate.
- Separate-process native acceptance attempt: Controller PID31732 and an isolated Runtime+native-factory/transport Runner connected. Cursor's status returned login-success but unable to fetch user details, while models exited1; strict account identity prevented execution. Evidence is /var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-remote-cursor-l6E8xr/evidence.json. This is a blocked real catalog attempt, not native execution success. Codex0.162.0-alpha.17.2 local login probe passed, but its account/model read RPC failed; no fallback/native-default execution was used. Continue independent adaptation and retain separate-process/provider/device acceptance open.
