# Scoped OpenCode Execution Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this single task, with scoped specification and code-quality reviews. Retain its ledgers/reports for parent CV-14. This planning subtask authorizes no implementation or agent dispatch itself.

**Goal:** Restore the internal Controller-owned OpenCode runtime port with all 12 original runtime assertions and current canonical admission, persistence and lifecycle guarantees.

**Architecture:** `OpenCodeExecutionRuntime` composes one `OpenCodeV2ExecutionBackend` per captured managed execution using `NativeRuntimeHosts`; the Adapter remains responsible for native protocol, allocation, durable fact ordering and raw provider work. Runtime authority is the original Controller assertion plus the exact captured selection/reference/invocation and persisted binding. The runtime owns physical executable/workspace admission; local cleanup remains distinct from native tool/writer release.

**Tech Stack:** Existing TypeScript, Node filesystem/crypto/util, Vitest, `@dispatcher/adapters`, `@dispatcher/domain`, `@dispatcher/runner`; no new package.

**Spec:** `/tmp/dispatcher-opencode-config-catalog-composition-20261023.md`, section 3, reconciled below against `a0096262f12e7c0bbe4c12083dae0bd9623fc550` and inspected HEAD `46a8960b87fcff98150e1a421a07447f4a3fea33`. Original assertions: `a499d84:apps/controller/test/opencode-runtime.test.ts` lines 20–29. This draft is not a catalog or registration plan.

## Global Constraints

- Exact backend `opencode-server-v2`, product `opencode`, region `global`, owning Runner, managed-worktree execution only; no continuation/replacement session, aggregate interaction port, external endpoint or recovered PID ownership.
- Preserve the entire canonical `nativeInput.executionSelection`, entire managed reference, original typed native input including `runId/sessionId/commandId`, and original callbacks. `commandId` is the Adapter invocation ID, not a Run lookup key or native-start journal ID.
- Producer input requires original `beforePrompt`, `onBinding`, `onNativeEvent`, explicit model, `approveTools:false`, no legacy fields and no custom execution environment. Do not widen these contracts.
- Secrets, account directories, native account metadata and installed binaries are not read or modified by this task. Executable filesystem metadata/access checks are admission checks, with no native/version/auth probe.
- Synthetic `nativeStoreRef` preserves the source formula `native-store:${sha256(JSON.stringify(["opencode","global","default-native-environment-unqualified"]))}`; the marker remains unqualified, not a physical store identity; no `opencodeHome`, qualified store/account isolation or catalog-derived ownership.
- No Controller service/config/schema/native-profile/catalog wiring, public capability activation, restart qualification, native/account/provider run, install, Linear operation or branch integration in this task.
- Preserve existing Codex/Pi behavior and every existing host/producer assertion. Do not copy their provider-specific continuation or home semantics into OpenCode.

## Review Focus

1. Synchronous owner assertion or binding lookup closes/reenters the runtime: no factory, prompt, callback or source may borrow the earlier check.
2. Caller mutates full reference/selection, callback properties, profile/options or argument containers during admission: original values and callback receivers remain authoritative.
3. Same execution has two admissions and the losing invocation fails/cancels: it cannot close the winning backend or clear its barrier.
4. Shutdown releases public readiness/result while acquisition or persistence is pending: active raw work and uncertain receipts remain retained until actual settlement, without receipt promotion.
5. Executable alias/target or workspace is replaced inside a callback or across executable access: fail before allocation/input and withdraw any exposed source.

Each item is exercised by the R/N tests below; it is not an additional task or an invitation to broaden scope.

## Verified interface corrections to prior section 3

- `CliStartInput.nativeInput` now carries `executionSelection?:ExecutionSelection`; obsolete `legacyModel/modelSelection` are rejected by the producer. Current required observer callback is `onNativeEvent`, not an optional omission in the historical fixture.
- Current producer constructor is `new OpenCodeV2ExecutionBackend({scope,executionRef,hostFactory?})`; `hostFactory(scope)` may return `Host|Promise<Host>`. Exported backend has `start`, `source(binding)`, `interaction` getter, `hasActiveOperations`, `beginShutdown`, `disconnectLocal`; raw operations/callback sets remain private and already owned there.
- `OpenCodeV2OwnedScope = Omit<OpenCodeV2Scope,"server"> & {executable:string}` and requires `backendId`; it has no `executionRefId` property. Supply the full reference to the backend constructor/factory, and `executionRefId` separately to `NativeRuntimeHosts` endpoint/registration.
- Historical `resolveOpenCodeExecutable` no longer exists/exported. `native-cli.ts` has private generic discovery `executable(provider,profile)`. Do not restore discovery to satisfy old test timing: require an absolute explicit executable, capture metadata synchronously, then await real `access(executable, X_OK)` and recheck. This useful admission await preserves both source lines 23 and 29's zero-factory assertion.
- `freezeExecutionSelection` is the existing authoritative structural/provenance/native-parameter validator but is private to the Adapter package entrypoint. The minimal proposed seam is one named re-export from `packages/adapters/src/index.ts`; do not change the helper's implementation or export generic discovery. This actual Controller consumer needs its existing contract before factory allocation; domain `validateExecutionBinding` alone checks owner/reference coherence, not the full canonical snapshot. Deep package imports and a duplicate Controller validator would bypass the package boundary or fork authority.
- Current Codex lifecycle is reference material, not a safe file copy: its `AcquiringTurn.result` converts admission failure to a failed result, whereas original/current OpenCode producer rejects sanitized admission errors. Preserve OpenCode `ready()` and `result()` rejection assertions.
- Current producer only exposes its source after successful durable-binding callback completion and its own binding adoption. Runtime callback validation must check captured/persisted identity without requiring a public producer source prematurely during that callback.

## Exact original assertion map (12 expanded cases)

`R01`–`R12` must appear in the implementation evidence ledger with current test name and disposition. Each row preserves every assertion in the named source case; changed fixture/API shape is not a deleted invariant.

| ID / source | Required current test and assertions | Intentional current adaptation |
| --- | --- | --- |
| R01 / line 20 | `lazily admits distinct execution hosts and selects only exact persisted binding`: no factory before start; two canonical workspaces produce two backends; no aggregate interaction; exact persisted binding returns exactly that backend's source; sibling executionRef does not; removing the durable record withdraws source; unclosed barrier true before disconnect; all returned callbacks drained and barrier false after fully proven local cleanup. | Use fresh absolute regular executable fixture, full canonical selection and onNativeEvent; source equality is `backend.source(binding)`/exact interaction getter. Root exited/drained proves only local host closure. |
| R02 / line 21 missing | `refuses missing execution before host allocation`: synchronous not-created rejection, zero backend factory. | Existing canonical managed reference required. |
| R03 / line 21 remote | `refuses foreign Runner before host allocation`: synchronous not-created rejection, zero factory. | Reject mismatched `ref.runnerId` and canonical selection Runner, not just one string. |
| R04 / line 21 continuation | `refuses continuation before host allocation`: `newSession:false` plus providerSessionId fails; zero factory. | Producer also refuses any present providerSessionId, even empty/undefined own-property. Do not restore resume. |
| R05 / line 21 backend | `refuses wrong backend before host allocation`: typed input backend `opencode-cli-json` fails; zero factory. | Canonical selection/backend must both match server backend. |
| R06 / line 22 | `refuses stale canonical authority at entry without acquiring a runtime`: original owner throws; synchronous failure; zero factory. | `assertAdapterWriteAdmission` also rejects Promise/non-undefined returns; do not swallow them in a wrapper. |
| R07 / line 23 | `captures input before waiting for runtime acquisition and refuses later authority drift`: start, mutate caller prompt/ref, revoke owner synchronously; ready rejects `{creationOutcome:'not-created'}`; result rejects; factory remains zero; cleanup available. | The real executable-access await replaces the removed resolver await. Add the separate successful-capture N01 so authority failure cannot mask a broken capture. |
| R08 / line 24 | `does not create a second native session for a repeated execution`: race two starts; first ready/result succeeds; second ready rejects not-created and result rejects; factory once; exactly one POST `/api/session`; explicit cleanup. | Losing invocation owns neither backend shutdown nor winning creation. Do not close winner in its failure/cancel path. |
| R09 / line 25 | `retains unknown native policy and refuses cold reattachment without creating a host`: completed turn then disconnect withdraws source; closed runtime refuses new execution; new runtime with persisted binding refuses cold continuation; total factory count remains one; clean unused recovered runtime. | New runtime must have a current absolute executable fixture. Stored binding/local cleanup is no continuation authority. |
| R10 / line 26 | `never-started cleanup opens no process and has no unclosed resources`: receipts `[]`, zero factory, no unclosed host. | Constructor may inspect file metadata and execute permission only. No probe/service process or account read. |
| R11 / line 27 | `does not hide an async original input guard behind its runtime wrapper`: original beforePrompt returns Promise; ready/result reject; no native POSTs (zero native host factory if producer preflight rejects first); cleanup. | Preserve original return through synchronous admission helper; runtime backend object construction is not native host creation. |
| R12 / line 29 | `pins physical workspace before executable access await`: start, rename workspace then create replacement at old alias; ready rejects not-created, result rejects, backend factory zero; cleanup. | Fresh absolute owned executable file with executable bit; capture workspace path/dev/ino synchronously before `access`, then recheck. Original relative `fixture` and missing observer/legacy model shape are deliberately replaced, not relaxed. |

## Task 1: Exact scoped Controller OpenCode runtime

**Files:**
- Create `apps/controller/src/opencode-runtime.ts`.
- Create `apps/controller/test/opencode-runtime.test.ts`.
- Modify `packages/adapters/src/index.ts`: only `export {freezeExecutionSelection} from "./execution-selection.js";` after parent confirms final catalog/index ownership.
- Modify only the directly affected owned-host spawn boundary in `packages/adapters/src/opencode-owned-server.ts` and add the two focused regressions in `packages/adapters/test/opencode-owned-server.test.ts`, as specified in the amendment below. No producer contract/behavior change.
- No other production changes. Root later records the reviewed runtime architectural/knowledge boundary alongside coordinated documentation; do not collide with catalog-owned docs. If implementation reveals another necessary interface/behavior change, report it before expanding scope.

**Consumes (existing):**
- `CliAgentProfile`, `CliStartInput`, `CliTurn`, `CliTurnResult`, `OpenCodeV2ExecutionBackend`, `OpenCodeV2OwnedScope`, `NativeInteractionPort`, `AdapterStartError`, `AdapterContractError`, `assertAdapterWriteAdmission` from `@dispatcher/adapters`.
- Proposed named export `freezeExecutionSelection(value:ExecutionSelection|undefined, owner:{profileId:string;providerId:string;backendId:string;selection:boolean;reasoning:boolean;legacyModel?:boolean}):ExecutionSelection|undefined`, unchanged existing implementation.
- `isExecutionContextRef`, `validateExecutionBinding`, `ExecutionContextRef`, `ExecutionSelection`, `NativeBinding`, `NativeTurnFact` from `@dispatcher/domain`.
- `NativeRuntimeHosts.acquireRuntime(profile:{id:string}, backend:NativeRuntimeBackend):Promise<RuntimeHandle>` and `shutdownLocal():Promise<RuntimeLocalDisconnectResult[]>`. Supply exact product/region/Runner/store/backend/ref/owned identities to both backend descriptor and endpoint.

**Produces:**
```ts
interface RuntimeOptions {
  profile: CliAgentProfile;
  runnerId: string;
  assertInput: (input: CliStartInput) => void;
  bindingFor: (nativeSessionId: string) => NativeBinding | undefined;
  factory?: (scope: OpenCodeV2OwnedScope, reference: ExecutionContextRef) => OpenCodeV2ExecutionBackend;
}
export class OpenCodeExecutionRuntime implements CliAgentBackend {
  readonly backendId = "opencode-server-v2";
  readonly interaction?: NativeInteractionPort; // stays absent
  constructor(options: RuntimeOptions);
  start(input: CliStartInput): CliTurn;
  source(binding: NativeBinding): NativeInteractionPort | undefined;
  diagnostics(nativeSessionId: string): Record<string, unknown>;
  hasActiveOperations(): boolean;
  hasUnclosedHosts(): boolean;
  isClosed(): boolean;
  beginShutdown(): void;
  disconnectLocal(): Promise<RuntimeLocalDisconnectResult[]>;
}
```
No new service/factory registration consumes this class in this task. Later enabled profile registration constructs the runtime and relies on its executable validator; it must not duplicate that validator. Disabled profiles never construct it and only receive structural schema checks in that later task.

- [x] **Step 1 — freeze reviewed prerequisites and write failing runtime assertions.** Parent first inspects final catalog commit and confirms no overlapping active writer; reread current producer, owned host, index, CLI types, Codex runtime, NativeRuntimeHosts and relevant architecture/know-how. Save exact baseline HEAD/status and hashes, including source `a499d84` runtime/test Git blobs; do not treat catalog WIP as authority. Construct one fixture using a fresh temp workspace pair, a fresh absolute executable stub file (`process.execPath` shebang if executable content is needed, chmod executable), canonical selection, exact managed refs, real `OpenCodeV2ExecutionBackend` + `OpenCodeV2InteractionPort` with injected fake transport/host and deferred callbacks; no installed OpenCode. Preserve R01–R12 and add N01–N09 below.

| New coverage | Test name and decisive assertions (matrix expansions remain one owned test family) |
| --- | --- |
| N01 capture + receivers | `captures full admission values and method receivers before awaits`: mutate nested ref fields, every selection nested object, prompt, profile executable, args/environment and callbacks/options methods after start; original factory/owner/binding lookup retain options receiver and original callbacks retain original input receiver. Persisted input is the original selection/ref/prompt; original observer called, replacement never called. Owner receives a fresh clone each call so mutating its argument cannot change runtime capture. Mutated environment cannot slip into producer. |
| N02 full preflight | `rejects malformed or foreign canonical admission before factory`: selection absent, owner profile/provider/backend/Runner drift; malformed configRevision/provenance/parameters; native-default; missing callbacks; async owner; invalid kind/ref; executable alias mismatch. Each fails before backend factory/native work, with safe not-created errors. Explicit model and no native parameters are mandatory using existing validator + binding check. Do not duplicate producer's full native response/schema matrices. |
| N03 physical executable/workspace | `rejects physical drift before allocation and withdraws an existing source`: executable alias retarget, replacement/in-place size or mtime change, nonregular/missing/nonabsolute file; workspace replacement across `access` and inside owner/beforePrompt/onBinding/onNativeEvent. Entry identity guards run before and after callbacks. Native POST count stays zero when unsent; otherwise preserve unknown and prohibit subsequent prompt. |
| N04 exact binding/source reentrancy | `rejects foreign binding before durable projection` (product/region/profile/backend/Runner/store/ref/nativeSessionId/state/thread/parent) and `withdraws source when lookup changes ownership`: zero durable callback for foreign binding; no prompt. Source requires exact captured and persisted binding, live backend source, unchanged physical identities. During bindingFor, close runtime, remove/alter durable record, mutate passed caller binding or replace workspace/executable; source returns undefined. No exposed source while onBinding persistence remains pending; no manufactured replacement. |
| N05 callback authority/drain | `rechecks persisted binding after each admitted callback`: onBinding writes foreign/removes binding; waiting callback revokes authority; received/terminal callback rejects or begins shutdown. Await callback completion; no post-callback input/readiness/success on loss. Both asynchronous binding and event callbacks remain active while blocked, even after public ready/result rejects. A forbidden Promise returned by owner/beforePrompt rejects admission immediately but its actual settlement remains tracked as entered callback work. Use real producer tracking, not a copy of provider algorithms. |
| N06 invocation ownership | `a losing second admission cannot close the winning invocation`: after first reserves creation, second rejects/cancels with different commandId; no winner disconnect, no second POST, first can finish. Owner drift before reservation can close only this known-unsent entry; a repeated loser cannot call known-not-created cleanup on another admission. Test same ref with changed full selection/reference/workspace rejected rather than host replacement. |
| N07 known-not-created | `clears a failed unsent host only with an explicit not-created receipt` plus unknown variant: after runtime backend registration but before producer native factory, revoke owner; closed/not-created/drained/unknown-background/deleted-false receipt permits local barrier cleanup, no host start; unknown root/callback/throw/malformed receipt keeps barrier. Other active entry stays intact. No deletion of manager records to manufacture success. |
| N08 cached unknown/raw work | `retains raw late work through cached unknown cleanup`: deferred host acquisition and separately blocked binding/event persistence; beginShutdown releases public waiter, active raw work stays true; first unknown receipt is cached/cloned; resolve late acquisition, host cleaned exactly once, no new callback/prompt/source. Resolve entered callback, raw active count eventually false; repeated cleanup equals first unknown. Mutating a returned receipt cannot change cached evidence. |
| N09 shutdown/source | `revokes every exact source and blocks admission on beginShutdown`: both entries close admission immediately, interruption remains exact backend-qualified only; quiescent false, stop/detach unqualified, nativeSessionDeleted false/backgroundTools unknown. Never-started disconnect coalesces to []; shutdown during executable access never allocates a backend and raw admission counter persists until actual settlement. |

- [x] **Step 2 — obtain a meaningful RED result.** Run `mise exec -- pnpm vitest run apps/controller/test/opencode-runtime.test.ts packages/adapters/test/opencode-owned-server.test.ts` with source/result manifests. Initial missing module/export is an expected wiring RED; after stubbing the exported class/seam, capture behavior RED for the specific assertions being implemented. Do not count a compile/import failure as proof of a race regression. Preserve exact failure output and relevant hashes; no native/probe/account/install commands.

- [x] **Step 3 — implement capture, physical admission and exact ownership.** In the new file use private `DirectoryIdentity {path:string;dev:bigint;ino:bigint}` and `ExecutableIdentity {alias:string;path:string;dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint}`. Constructor clones the profile, captures explicit absolute safe executable alias (existing 4096-character/control-character bound), resolves/stats a regular file, checks current execute permission synchronously with accessSync(X_OK) so enabled construction cannot admit a non-executable file, and binds original options callbacks to original options. Capture each original data/callback property only once (including getter-backed fields) before asynchronous work. Capture original callback functions bound to original input, clone data fields including args/environment/nativeInput/selection/ref before the first await, and capture physical workspace synchronously. Do not structuredClone functions or retain the mutable caller object as guard input.

  Private `validate(input:CliStartInput, workspace:DirectoryIdentity):void` rejects closed admission, missing/wrong canonical managed context, typed owner, continuation/providerSessionId, absent required callbacks, wrong executable alias; reuse unchanged `freezeExecutionSelection` with `{profileId,providerId:'opencode',backendId:'opencode-server-v2',selection:true,reasoning:false}`, require explicit requested model/no parameters, and call `validateExecutionBinding` with captured repository/base. Convert invalid input/helper/fs/owner exceptions to safe `AdapterStartError('not-created', safeCode, fixedMessage)`; never expose raw path/errors. Check immutable executable alias + identity/workspace before and after `assertAdapterWriteAdmission(()=>boundAssert(freshCapturedInput()))` and check closure/registered identity after reentrant callbacks. Do not execute beforePrompt as an extra constructor/preflight side effect.

  Admission awaits `access(capturedExecutable.alias, constants.X_OK)`, then runs the same physical/owner guards before factory; preserve the captured alias for `input.executable` and scope, and use physical identity for fencing/fingerprint. No executable discovery, hashing binary contents, version/auth invocation, real provider or catalog read. Failure before this guard passes creates no backend. Future registration does not need another executable validator.

- [x] **Step 4 — implement the per-execution port and callback bridge.** Store full immutable managed reference/selection/workspace/executable identity, scope, one backend, handle, creation admission owner token, optional exact binding and explicit known-not-created flag in each entry. Verify all captured fields on reuse. Preserve the source unqualified nativeStoreRef formula above and derive scopeFingerprint from actual profile/backend/Runner/unqualified-store/full managed ref and physical identities (stringify bigint fields explicitly); same unqualified store marker may span executions but execution ref keys keep host ownership distinct. Pass cloned full ref into factory/default backend. Factory returning wrong backend fails before `start`; a reentrant guard/factory cannot install a replacement host or bypass shutdown.

  Register exact `executionRefId`/owned endpoint in `NativeRuntimeHosts`. Interruption delegates only through `this.source(binding)` for this backend; no hardcoded capability promotion. quiescent returns false, stop/detach reject `NATIVE_CAPABILITY_UNVERIFIED`, local disconnect delegates to owning backend. Reserve one creation on the entry and one private token on its invocation before calling backend.start; rejection/cancel from another invocation does not gain that token. Preserve producer errors' `creationOutcome` (especially unknown after possible create), no creation retry.

  Runtime beforePrompt executes guard → `assertAdapterWriteAdmission(originalBoundBeforePrompt)` → guard, preserving non-undefined rejection. onBinding/onNativeEvent capture their argument, validate exact scope/owner/physical identity before entering the original bound callback, await its real Promise, then revalidate ownership/physical state and exact persisted binding. Foreign binding never reaches durable projection. Only adopt the entry binding after successful original persistence + exact lookup; producer remains responsible for adopting its own binding afterward. During this bridge do not require producer.source before producer adoption. Once available, public source requires exact cloned binding, entry binding, all OpenCode shape fields (no thread/parent, current `ses[A-Za-z0-9_-]+` grammar), persisted binding and backend.source; rerun closure/entry/physical checks after bindingFor and after backend.source so synchronous reentrancy cannot return stale authority. Diagnostics expose only scoped ref/admission status; never label admission closure as confirmed physical connection closure or disclose paths/secrets.

- [x] **Step 5 — implement raw lifetime and conservative cleanup.** Track runtime admission promises independently of public lifetime races and combine them with each backend.hasActiveOperations(); producer already retains raw host acquisition/poll/callback work. When a supposedly synchronous owner/beforePrompt callback returns a Promise or thenable, preserve its rejection observation and actual raw settlement in the callback/operation set while failing admission immediately; do not treat invalid callback return as permission to forget already-entered work. Reuse assertAdapterWriteAdmission for synchronous semantics and capture the returned outcome in its narrow wrapper rather than altering the shared helper. Include a deferred forbidden-guard case asserting zero factory and active raw work until settlement. Use a runtime-owned shutdown AbortController and an invocation-owned cancellation signal for public admission waiters, while retaining the original raw admission Promise in a Set until its own finally settles. AcquiringTurn.cancel closes only its invocation signal and any creation owned by its token; it must not await public readiness before it can cancel a pending admission. `beginShutdown` synchronously closes runtime admission, aborts runtime public waiters and calls every registered backend.beginShutdown. Public cancel can release that invocation's waiters; it may locally close only an invocation-owned creation, never a repeated losing start's winning backend. Any already entered persistence must settle and must not be forgotten by decrementing counters on public abort. Preserve ready/result rejection behavior on admission failure; expose producer result/events after successful admission. Drive new races with deferred fake host/transport/callback seams and existing deadlines under fake timers where necessary; add no delay merely to schedule a test and change no production timeout.

  A not-created failure may call private `closeNotCreated(entry)` only for its own reserved creation or an entry without another admitted creator, no binding, and no concurrent active owner. Recognize only the normalized `{version:1,connection:'closed',ownedRoot:'not-created',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false}` proof, not a failed public Promise or root-only event. Keep manager entries until manager cleanup confirms them; do not clear a different live execution. `disconnectLocal` closes admission, coalesces `hosts.shutdownLocal`, retains cloned normalized receipts and preserves unknown forever for that cleanup attempt. `hasUnclosedHosts` remains true for unknown connection/root/callbacks; `hasActiveOperations` separately remains true for actual raw work, including admission before host registration. No later settlement or second call upgrades cached unknown to success. A zero-host receipt [] does not assert that an outstanding local filesystem admission has settled.

- [x] **Step 6 — focused GREEN and implementer self-review.** Run the same focused command after meaningful fixes (not unchanged-code retries), retain manifests and precise expanded counts. Confirm R01–R12 map and N01–N09 decisive assertions. Self-review source preservation/current adaptations, lifecycle fences, minimal named export, safe errors and scope before the final full gate. Correct findings and rerun only justified affected checks. Root dispatches the independent combined specification/quality reviewer after your tested commit/report; do not dispatch any agents or reviewers. These unit reviews do not discharge parent CV-14 whole-branch review/integration.

- [x] **Step 7 — one default full gate on the final self-reviewed payload.** Run `mise exec -- pnpm check` once with no maxWorkers, timeout, retry, assertion, skip, cache or test-selection changes. package.json expands this to build/typecheck, lint, boundaries and all Vitest tests. Failure stays evidence; diagnose and change source before a justified new gate, retain each separate failed attempt. The historical R-020 probe issue is not closed by a green current gate. The runtime has no deployment/native qualification acceptance step.

- [x] **Step 8 — seal evidence and hand back one scoped commit for root review.** Save exact final diff, R/N source ledger, review reports and gate source/result manifests. Root compares resulting committed source/test/export blobs to final gate SHA256 payload and checks no catalog/service/schema/WIP incorporation. Stage/commit only the five amended runtime/test/export/host paths after required checks/self-review; use one scoped commit such as `feat(controller): preserve scoped OpenCode execution runtime`. Parent retains final docs/evidence/accounting ownership; no branch merge or finishing workflow.

## Evidence format and acceptance boundary

Suggested artifact prefix `/tmp/dispatcher-opencode-runtime-logs/` with `targeted-red`, `targeted-green`, `full-check` log/source/result triplets. Source JSON contains exact argv, reason, cwd, HEAD, porcelain status, start timestamp, log path, and SHA256 for runtime/test/index, unchanged producer/owned/server/selection helper/CLI contract, NativeRuntimeHosts/domain selection/ref contract and any other runtime source input actually needed. Preserve original `a499d84` runtime/test Git object IDs + SHA256 and the accepted catalog commit/hash prerequisite separately. Result JSON retains that source record, exit code, finish timestamp, wall duration and observed file/test counts; hash again afterward and report any mutation. A later docs-only amendment must be explicitly distinguished from gate-tested runtime payload.

Acceptance is all 12 original expanded assertions accounted for, current snapshot/callback/physical/invocation races proven, no native host allocation on failed preflight, one exact execution host and one native create, no aggregate source, no success/local host barrier removal on uncertain cleanup, and final default check passing against the recorded payload. No assertion is weakened/skipped and no timeout/concurrency/probe cache is changed to obtain green. Local synthetic success does not qualify installed native account isolation, continuation, UI/GUI takeover, external background-tool completion, native writer release, restart admission, formal Gates or CV-09 completion. Broad review/integration stays parent CV-14 after the remaining development units.

## Draft self-review

All 12 original expansions are mapped once, with legacy fixture/API changes explicit. New tests target runtime-owned seams; existing producer response parsing, prompt bounds, native ID grammar, version/probe/process cleanup, terminal persistence and 82-case producer coverage remain authoritative and are not recopied wholesale. The only proposed adjacent production edit is the unchanged validator's named export for a concrete consumer. No implementation or verification command was run while preparing this draft; only read-only inspection and /tmp artifacts were performed.


### Binding preflight amendment: actual executable spawn boundary


The runtime draft has a real gap. `opencode-owned-server.ts:53-63` probes `scope.executable`, awaits completion, checks only workspace/tmp through assertScope, then spawns the service using that same path. Runtime checks before its factory and after ready do not fence that internal awaited boundary. Alias retargeting during the probe can execute a different service before runtime gets control again. Merely passing a canonical path narrows the alias case but does not check replacement/modification at the canonical file path during the probe.

Adopt physical-path handoff plus one optional synchronous beforeSpawn guard at the actual two native-spawn boundaries. Keep the single executable validator in the runtime. Do not add another executable-identity validator to OwnedServer or export/restore generic discovery.

Current caller check: production `OpenCodeV2OwnedServer` construction occurs in `opencode-execution.ts:48` through its existing optional hostFactory/default host; direct one-argument constructions are in `opencode-owned-server.test.ts`. The host supports both `opencode-server-v2` and `opencode-cli-json`, and its current executable contract is safe nonempty text up to4096 characters, not mandatory absolute filesystem metadata. Tightening that constructor globally would change a real supported direct boundary. Existing producer tests inject relative fake executable scopes/hosts and long safe scope values. They must remain valid and unchanged.

## Exact amended runtime handoff

1. Preserve constructor's immutable original alias and physical regular-file snapshot `{alias,path,dev,ino,size,mtimeNs}`. Runtime preflight `validate` and every original Controller assertion continue to see a fresh defensive copy of the originally captured input, including `executable:alias`, profile configuration, selection/reference, Run/session/invocation tuple and bound original callbacks. Perform existing async executable access on alias with before/after identity checks.
2. In the runtime's privately created `OpenCodeV2OwnedScope`, use `executable:capturedExecutable.path`, not alias. Pass that same physical path in the `CliStartInput` handed to backend.start. Both must change together: `opencode-execution.ts:62` requires `input.executable===scope.executable`. All other typed payload/selection/ref fields remain captured copies.
3. Backend beforePrompt/onBinding/onNativeEvent wrappers invoke runtime guard against the original captured input, not the internal physical-path handoff. The owner assertion's configured alias equality therefore remains intact. Source lookup still revalidates original alias AND physical identity; alias retargeting withdraws source even though native argv used the old physical path. Scope fingerprints retain both immutable alias and physical file identity.
4. Compose only the runtime's default backend with the existing hostFactory seam:

   ```ts
   new OpenCodeV2ExecutionBackend({
     scope: physicalScope,
     executionRef: capturedReference,
     hostFactory: ownedScope => new OpenCodeV2OwnedServer(
       ownedScope,
       () => guardOriginalAdmission(),
     ),
   });
   ```

   `guardOriginalAdmission():void` is the same runtime-owned synchronous guard already checking original physical executable/workspace, current canonical owner, shutdown, exact registered entry and invocation ownership. Capture its closure/entry/token before backend.start can construct the host. It does not add an extra call to the original beforePrompt callback; producer's established beforePrompt ordering stays unchanged. The runtime continues binding original options/input callbacks to their original receivers.

5. RuntimeOptions.factory remains the explicitly trusted injected-backend seam with its existing `(scope,reference)` signature; its scope now intentionally carries physical executable path. It may supply a synthetic host for tests, as today. Default runtime safety must not be falsely asserted for arbitrary custom code that substitutes its own host/spawn path. There is no current configuration/native-profile path granting such custom factories independent runtime authority; later service composition must use the reviewed default or an injected backend that enforces this same actual-spawn guard. Do not widen the producer interface or introduce a third factory callback solely for hypothetical custom implementations.

This supersedes the earlier plan's instruction to preserve alias in both scope and producer input. Alias remains the Controller/config authority representation; physical path is the private owned-process execution representation. No persisted schema, reference, model selection, binding or catalog identity changes.

## Minimal directly affected host change

Change only the existing constructor signature to:

```ts
constructor(scope: OpenCodeV2OwnedScope, beforeSpawn?: () => void)
```

Capture the optional function in a readonly field before calling open. Existing one-argument callers retain their current behavior and scope/executable validation; this optionality preserves actual supported callers rather than creating an invented fallback. The function is an admission closure, not a provider API, process handle, async initialization hook or new executable validator.

Add one private synchronous boundary helper (for example `assertSpawnAdmission():void`) with exact behavior:

- `assertOpen('not-created')` before caller code.
- Enforce the original captured guard using existing `assertAdapterWriteAdmission(beforeSpawn)`; reject any Promise/non-undefined return and consume rejected Promise diagnostics as that existing helper does. Sanitize thrown/rejected admission to `new OpenCodeV2Error('OPENCODE_SPAWN_ADMISSION_REJECTED','not-created')`, with no arbitrary callback error/path leakage.
- `assertOpen('not-created')` again after caller code, so synchronous shutdown/workspace changes cannot borrow the earlier check. Runtime guard itself performs its existing post-owner executable/workspace recheck.

Invoke it once immediately before version-probe acquisition, with no intervening await before `readOwnedNativeVersion` can spawn; putting it at the beginning of readVersion before `probeState='pending'` is explicit. Invoke it again after accepted version parsing and private environment preparation, immediately before service `spawn(...)`, with no await in between. Retain existing version checks, child environment sanitization, owned-group cancellation, probeState, readiness, callbacks and cleanup normalization. Do not put it only after service readiness or into an unrelated request guard.

The existing open catch already closes admission, awaits owned cleanup and normalizes no-service failure to not-created. A successfully closed probe plus rejected second guard creates no service and can retain confirmed closed/not-created/drained local receipt. Exit-unconfirmed probe remains unknown; a guard cannot overwrite it. Existing password storage and backgroundTools unknown/nativeSessionDeleted false semantics stay unchanged. No release, stop or account capability is added.

## Focused new assertions

Add exactly two focused host test declarations in `packages/adapters/test/opencode-owned-server.test.ts`, adapting the existing fixture only to accept/pass an optional captured guard (default absent). Preserve all existing23 host expansions and every prior assertion.

1. `rejects an asynchronous spawn admission before acquiring the owned version probe`: supply a guard returning Promise.resolve(undefined), spy on `readOwnedNativeVersion` without replacing successful behavior, observe ready rejects `OPENCODE_SPAWN_ADMISSION_REJECTED` with outcome not-created; guard called once; version reader never called; neither existing `probe-environment.json` nor `started.json` exists; normalized cleanup is closed/not-created/drained, tools unknown/deleted false. Restore spy and own temporary fixture resources. This catches wrappers that discard a Promise result and covers the first actual spawn boundary.
2. `rechecks the original spawn admission after a gated owned version probe before service spawn`: use existing real owned `probe-gate` fixture and a closure initially allowed; wait for `probe-entered` using existing vi.waitFor, revoke closure authority, then write existing `probe-release`. Ready rejects sanitized spawn-admission/not-created; original guard called twice; probe marker confirms only the original owned probe ran; started.json absent; no service/port/session/prompt; cleanup confirms closed/not-created/drained and remains cached/cloned. This covers synchronous throw on the second actual boundary without test delays or timeout changes.

Amend existing runtime N01/N03 assertions rather than recopying the producer suite:

- A valid symlink alias pointing to a fresh executable stub passes admission; original assertInput receives the exact alias, factory scope/backend input receive the canonical target, immutable selection/ref and callback receivers remain original. Existing producer tests stay unchanged because its equality contract is unchanged.
- Gate the default owned-host version probe, retarget original alias to a second newly owned executable fixture (and separately replace/in-place modify the captured physical target). Release probe. Runtime guard rejects before service spawn; neither original nor replacement starts a service; no durable binding/event/prompt/native create appears. Use the real owned fixture path or a deferred version-reader seam around actual default composition; a custom factory that replaces the host without this guard cannot prove default composition. Test identity drift through runtime's one validator; the host test does not need a duplicate file-stat implementation.

The two host tests prove both enforcement sites and sync/async admission rejection; the runtime tests prove physical-path normalization and delivery of the actual runtime guard through the existing hostFactory. A spy-only assertion on RuntimeOptions.factory parameters is insufficient for the awaited-probe race.

## Scope, verification and evidence amendment

Add only `packages/adapters/src/opencode-owned-server.ts` and `packages/adapters/test/opencode-owned-server.test.ts` to the runtime task's directly affected allowed files, beside runtime/test and the one named freezeExecutionSelection export. No producer production/type/contract change, config/service/catalog/schema activation, dependency or global host executable validation is required. Root owns any coordinated docs/evidence update. The parent untracked plan is intentionally untouched by this recheck.

Focused RED/GREEN command becomes `mise exec -- pnpm vitest run apps/controller/test/opencode-runtime.test.ts packages/adapters/test/opencode-owned-server.test.ts`, with exact source/result manifests and separate assertion counts (expected original host23 plus2 focused tests, plus runtime ledger; count actual observed output). Retain the single final unmodified default `mise exec -- pnpm check`; include host source/test and existing producer/native-version-probe/validator inputs in its source hashes. No reviewer duplicate suite, unchanged-code retry, skips, timeout/concurrency/probe-cache change. Scoped SDD review must verify guard placement immediately before both spawns and original-alias/physical-input split. Parent CV-14 whole-branch review and all real Gates remain separate.

This closes the identified awaited-probe and synchronous callback drift windows using existing Node path-based spawn semantics. It does not claim atomic immutable-file execution against an unrelated external process replacing a pathname between the final synchronous check and OS spawn; no such stronger capability is represented or required by the existing runtime contract.

## Reviewed implementation receipt 2026-10-24

Source761dddd53c2d8aee4e4103d47ce0771661ce5849 implements the five amended paths. Focused136 (runtime111=source12+99; host25=existing23+2) and final default187files/2608tests pass, exit0, Vitest104.11s/wall118.173s. Original first2603 gate and every RED/fixture failure are retained separately. Root verified21 tracked Git blobs and16 generated inputs, plus808 saved payload hashes across25 runs; current recheck matches all37 inputs. Independent /tmp/dispatcher-opencode-runtime-review-20261024.md returns spec compliant and quality Approved, no Critical/Important. Nonblocking existing routine full-gate request-log noise is a separate optional fixture cleanup observation, not a runtime defect. Root resolves cannot-verify: reviewed catalog0208bff is the prerequisite; default broad tests preserve local Codex/Pi regression scope; coordinated docs are updated after this source gate; real native/account/GUI/writer/restart/formal Gates and parent CV14 remain open. Task1 local implementation complete; no registration/service activation or overall CV09 completion.
