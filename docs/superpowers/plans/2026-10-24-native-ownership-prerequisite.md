# Native Ownership Prerequisite Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` for this single implementation/review unit after the OpenCode prerequisites are reviewed. Preparation itself ran no implementation/tests/native operations. Execute under the active parent goal only after recorded prerequisites and a fresh clean dispatch BASE. Steps use checkbox syntax for tracking.

**Goal:** Preserve the six source cancellation safety assertions on actual production owners, restore Codex's cooperative interruption, and provide explicit root-only cleanup for pending ACP/Copilot/Cursor integrations.

**Architecture:** Harden the existing group owner and retain its current consumers and stronger drain confirmation. Add a separate root-only owner with no group/cooperative branches, consumed through a narrow stop capability by the current version probe. Exactly one owner belongs to each freshly spawned process.

**Tech Stack:** Existing TypeScript, Node ChildProcess, Vitest, pnpm; no new dependency.

**Spec:** The binding interfaces, global constraints and six-source assertion map in this document, checked against frozen `a499d84e88c9f4ff1d01c89cc20304f236fe2bbd`. Prior expert audit: `/tmp/dispatcher-native-ownership-prerequisite-ruling-20261023.md`; package/provider context: `/tmp/dispatcher-native-protocol-prerequisites-20261023.md`. Their earlier full-helper restoration recommendation is superseded by the concrete two-owner decision recorded here; no package incorporation belongs to this task.

## Execution ruling — 2026-10-24

The original combined Task1 remains **incomplete**. Candidate `56db4b5` is
recoverable non-green WIP: the default gate passed build/typecheck/lint/boundaries
but failed19 of2999 cases. Three actual group-drain paths preserve post-exit
`kill(-pid,0)` EPERM, conflicting with the required sticky identity uncertainty;
16 other failures exposed two Controller fixtures' independent native-quota reader
boundary. Their underlying causes remain unproven and R020 remains separate.
The independent review and dated partition assessment are retained at
`/tmp/dispatcher-native-ownership-task1-review-20261024.md`.

Proceed with the separately specified
`2026-10-24-root-owned-probe-delivery.md` unit. Restore group/Codex candidate
portions to the exact pre-WIP `84cde57` behavior while delivering and verifying
only the independent root owner/probe capability. Preserve the WIP, failed logs,
all five group source scenarios1/2/3/5/6 and actual-drain acceptance as outstanding
work; source case4 belongs to the independent root unit. This split does not
approve Task1, waive its original full gate, diagnose EPERM or satisfy the full
six-case map. No runtime toggle, duplicate owner or relaxed unknown policy is
authorized. Shared group safety remains open for **every** group consumer,
including Generic, Runner, catalogs/default probes and Codex. Root-only provider
delivery does not depend on the proposed group hardening, and must prove that
independence at each actual spawn/probe/cleanup path.

Separately, fix round1 allows only the two named Controller fixtures to use the
existing `codexNativeReader` seam with valid bounded deterministic quota data,
abort checks and unexpected-method rejection. Preserve all body/shutdown tests
and dedicated real-reader/cleanup-unknown acceptance. Passing fixtures do not
retroactively establish the original16 failure causes.

Ruling: the user's explicit instruction to keep making progress through viable
alternatives authorizes independent root delivery while the combined unit stays
open. This corrects a plan dependency, not an early acceptance or parking of a
review finding. Cost if wrong: dependent root-only integration must be revised;
all original group requirements and the parent final review remain enforceable.

## Global constraints

- Worktree: `/Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher`; ownership source re-read at `aba80e7abd84d06f2701dccc2e89c16d513287b2` while Controller C1 alone implements in other paths; source assertions: `a499d84e88c9f4ff1d01c89cc20304f236fe2bbd`.
- Follow the parent queue after reviewed OpenCode Controller delivery and direct Pi assertion gaps; re-read actual owner/consumer files and final HEAD/status before editing. No current Controller WIP is a completed prerequisite. Preserve unrelated dirty work and exact current public/persisted/native boundaries.
- No full `ProcessCancellation` restoration, forwarding facade, duplicate group owner, base-class framework, provider restoration, package/lockfile changes, root index export or Controller wiring.
- Preserve every original six-case error/signal assertion; adapt only the actual owner class/method and necessary realistic fake ChildProcess shape. Existing tests must not be disabled, weakened or loosened.
- Root signals use the captured original child's bound kill only; no negative PID, process enumeration, `taskkill /T`, inferred or recovered PID authority.
- Root exit, group absence, natural stream closure, callback drainage, background tools and writer release remain distinct facts. Cleanup uncertainty wins over usable data.
- Version timeout default/cap `3_000`; stdout limit `16_384`; root natural-close confirmation `500`; existing group natural-close confirmation `2000`; no worker or timeout widening, probe caching or unchanged retries.
- Preserve `childExecutionEnvironment`, cwd/PWD, group default, unconditional version drainage, no secret/API expansion, Domain/Protocol import boundaries.
- R020 `_dyld_start` evidence remains an independent unresolved platform gate, not a causal target or a claimed fix of this increment.
- New command evidence includes live source/test/consumed-generated byte copies and exact argv/cwd/HEAD/status/UTC/output/exit/wall/post hashes, outside the checkout. ESLint scans ignored TypeScript under `.superpowers`; preserve failures and never weaken rules or reconstruct historical evidence. Root coordinates docs after review.

## Review focus

- Exit emitted synchronously inside a kill mock/handler can start duplicate cleanup before promise publication: Phase 1 tests the shared promise and signal order.
- PID or kill-method replacement during awaited grace can signal an unintended identity: Phases 1–2 test captured identity/method and fail-closed behavior.
- EPERM before root exit has existing polling semantics, while EPERM at/after exit must remain sticky: Phase 1 keeps existing tests and adds exit-boundary cases.
- A valid version followed by inherited pipes, a pipe error or denied cleanup can incorrectly become success: Phase 2 tests cleanup-error precedence and natural close at 500 ms.
- Windows/PTY consumers cannot establish POSIX containment: Phase 1 checks mock platform paths, Phase 3 includes Runner regression without increasing capabilities.

## File map

- Modify `packages/adapters/src/owned-process.ts`: captured identity, sticky post-exit uncertainty, cooperative stop in the existing group owner.
- Modify `packages/adapters/src/codex.ts`: use the cooperative option only for explicit POSIX Codex exec cancellation; keep close-result drainage and terminal-state gates.
- Create `packages/adapters/src/owned-root-process.ts`: concrete root-only owner; no exported compatibility facade.
- Modify `packages/adapters/src/catalog-process.ts`: structural stop capability and concrete 500/2000 ms close budget.
- Modify `packages/adapters/src/native-version-probe.ts`: explicit root opt-in and pipe-failure preservation in the current implementation.
- Create `packages/adapters/test/owned-process.test.ts`: all six mapped source assertions plus owner races/identity tests.
- Create `packages/adapters/test/native-version-probe.test.ts`: default and root-mode contracts, mocked streams/timers where exact boundaries matter.
- Modify `packages/adapters/test/owned-native-process.test.ts`: add a real local Codex cooperative-interrupt fixture and preserve existing 3 s assertion; no provider executable.
- Root updates `docs/architecture.md` and `docs/know-how.md` after independent review; implementer reports exact new ownership/close-budget constraints without editing coordinated docs.
- Other consumer implementations beyond the explicitly listed Codex call site, test deadlines, other provider files, manifest, lockfile and index stay outside edits. If current tests' fake ChildProcess objects lack the real `kill` method required for capture, add only the faithful fake method without changing their expectations.

## Task 1: Preserve native group/root ownership and Codex cooperative cancellation

This one scoped SDD task contains the three dependent implementation/acceptance phases below; do not dispatch overlapping implementation agents. Root owns independent combined spec/quality review after your final tested commit, evidence/disposition/Linear, and parent CV14 broad review/integration. Follow focused TDD, self-review before one final default gate and exact source/result SHA256 manifests; never dispatch any agents/reviewers.

### Phase 1: Harden the actual group owner and restore the Codex caller

**Interfaces**
- Preserve constructor `new OwnedProcessGroup(child:ChildProcess|OwnedTerminalProcess)` and `treeStatus():OwnedProcessTreeStatus`.
- Extend existing method to `stop(interruptRoot=false):Promise<void>`; omission retains ordinary drainage. First request wins; all calls share the same promise, including automatic exit cleanup.
- `stop(true)` is valid only for a POSIX ChildProcess and has one supported caller: explicit Codex exec cancellation. It is not used for PTY, Windows, catalogs, close handlers, OpenCode or generic CLI.

- [ ] Add source cases 1, 2, 3, 5 and 6 to `owned-process.test.ts`, preserving original scenario names and assertions per the ruling's six-case table. Use production `OwnedProcessGroup`, `stop()`, and `stop(true)`.
- [ ] Add deterministic tests: capture PID; mutation before stop and during cooperative grace rejects `LOCAL_PROCESS_IDENTITY_UNKNOWN` without signaling either identity; replacing `child.kill` cannot replace captured SIGINT recipient; observed absence is final; EPERM at exit or during post-exit drain permanently rejects and `treeStatus()` stays unknown without further OS calls.
- [ ] Add deterministic cooperative tests: root gets exactly one SIGINT; no group TERM before root exit or 1,000 ms grace; root exit synchronously during SIGINT joins the original promise; root still running at 1,000 ms proceeds to ordinary group drainage; repeated/default stop calls share success or rejection; thrown/false-returned SIGINT never escalates to TERM/KILL even if close/stop follows. Use fake timers for grace boundaries; do not widen tests.
- [ ] Run `mise exec -- pnpm vitest run packages/adapters/test/owned-process.test.ts packages/adapters/test/owned-process-status.test.ts` and record the specific missing behavior; do not infer correctness from an import error alone.
- [ ] Implement identity capture at construction, guarded OS probes/signals, and synchronous exit/close observation. Latch uncertainty on/after root exit; do not latch a recoverable pre-exit EPERM observation. Keep `treeStatus()` nonthrowing and PTY/Windows `unknown/unverified`.
- [ ] Publish the shared stop promise before calling any signal-producing routine (for example, defer the body to a promise microtask). The exit hook observes ownership synchronously, then joins `stop()`; it must not await its own operation. Keep current automatic cleanup on ordinary exit.
- [ ] Implement cooperative grace in that same operation: verify captured identity and root-not-exited, call bound root SIGINT, reject denial/false return, poll at 25 ms until root exit or 1,000 ms, then drain the same group. Never send root SIGINT after captured exit. Preserve current TERM wait 2,000 ms, KILL and final confirmation up to 2,000 ms, existing Windows taskkill path, and cached failures.
- [ ] In `SpawnedCodexTurn.cancel()` use `ownership.stop(process.platform!=="win32")`; keep close handler `ownership.stop()`, result handling and nonterminal state on failed drain. Add a local fixture in `owned-native-process.test.ts` whose SIGINT handler records interruption/cleans its own detached tool before root exit; assert cancellation sees that evidence and existing owned descendants are gone. The fixture cleans its own leftovers in `finally`.
- [ ] Run `mise exec -- pnpm vitest run packages/adapters/test/owned-process.test.ts packages/adapters/test/owned-process-status.test.ts packages/adapters/test/owned-native-process.test.ts packages/adapters/test/codex.test.ts packages/runner/test/process.test.ts`. Preserve existing live-root EPERM three-probe and permanent-uncertainty assertions exactly. Record local-only evidence; retain a platform startup failure and its open gate, return the concrete blocker to root without unchanged retries or weakening.
- [ ] Self-review the phase diff after focused checks. Final commit follows Phase3 default gate; do not stage unrelated worker or root-owned files.

### Phase 2: Add concrete root ownership and current-probe integration

Depends on Phase 1 so the combined owner test can preserve all six assertions.

**Interfaces**
- New `OwnedProcessRoot` in `owned-root-process.ts`: `constructor(child:ChildProcess)`, `stop():Promise<void>`. No group option, cooperative option, native receipt, tree status or public index export.
- Root stop is a cached bounded cancellation sequence, not an exit receipt: TERM, poll original root at 25 ms up to 2,000 ms, then KILL if still live; after KILL the caller separately confirms actual exit/close. Root end is latched from original exit/close; capture PID and bound kill before awaits. A missing PID without observed not-created evidence is unknown and must never authorize signaling.
- `drainCatalogProcess(owner:{stop():Promise<void>},closed:Promise<void>,closeTimeoutMs:500|2000=2000):Promise<void>`; stop rejection or missing natural close maps to existing `MODEL_CATALOG_CLEANUP_UNKNOWN`.
- `readOwnedNativeVersion` adds `ownsGroup?:false` to its existing input, preserving all other names/types. `false` means `detached:false`, `OwnedProcessRoot`, and close budget 500; omission uses existing group/platform behavior and budget 2000.

- [ ] Add source case 4 to `owned-process.test.ts` using `OwnedProcessRoot.stop()` and retaining `expect(owned.kill).not.toHaveBeenCalled()`. Add all-platform assertions that root mode never invokes `process.kill`, tree taskkill or enumeration, including after natural exit, mutated PID, TERM refusal, SIGKILL escalation and inherited descendant survival.
- [ ] Add root tests for bound method capture, single shared promise, identity change after await, sticky signal failure, observed spawn failure without PID, and no exit after a successful SIGKILL delivery. For the last case stop resolution alone must not satisfy the caller's close-confirmation gate.
- [ ] Add probe tests with exact spawn options: omitted mode selects group; explicit false selects root and detached false; environment retains `childExecutionEnvironment` sanitization and exact cwd/PWD; pre-aborted/invalid timeout never spawn; timeout is capped at 3,000; stdout 16,384 is accepted and 16,385 rejected; nonzero exit, spawn error and abort remain unavailable only when cleanup is proven.
- [ ] Add success/error cleanup tests: group success always drains; root exit with inherited pipes does not return version; natural close absent at 500 ms rejects even if it arrives at 600 ms; group default still permits its existing 2,000 ms close budget; denied stop, stdout/stderr error or missing exit yields exit-unconfirmed; valid output cannot override cleanup failure; `destroy()` occurs only after the qualifying decision and cannot manufacture success.
- [ ] Run `mise exec -- pnpm vitest run packages/adapters/test/owned-process.test.ts packages/adapters/test/native-version-probe.test.ts` and record expected missing root-mode behavior.
- [ ] Implement only the root authority and the stated structural drain interface. Preserve source root cancellation timing while latching original exit directly; no group membership claims or descendant cleanup. Reject identity/kill uncertainty; do not turn `child.killed` or kill return success into exit evidence.
- [ ] Extend current `native-version-probe.ts` in place. Construct the correct single owner immediately after spawn, preserve exact current bounds/environment/abort/finally flow, call shared drain on every path, pass 500 only for explicit root mode, and retain pipe errors as exit-unconfirmed. Do not copy the old source probe's success fast path or swallowed cleanup failure.
- [ ] Run `mise exec -- pnpm vitest run packages/adapters/test/owned-process.test.ts packages/adapters/test/native-version-probe.test.ts packages/adapters/test/owned-process-status.test.ts packages/adapters/test/owned-native-process.test.ts packages/adapters/test/pi-rpc-client.test.ts packages/adapters/test/codex-app-server.test.ts packages/adapters/test/opencode-owned-server.test.ts` after the OpenCode worker has landed. No live CLI/account qualification is part of this command.
- [ ] Report the precise explicit root authority, natural-close, post-exit uncertainty and cooperative operation-sharing documentation changes for root to apply after review; add no task diary or unrelated knowledge file.
- [ ] Self-review this phase after focused checks; final commit follows Phase3 default gate.

### Phase 3: Complete shared-path acceptance and freeze the later integration boundary

Depends on Phases 1–2. This is a verification/documentation checkpoint, not a provider implementation task.

- [ ] Re-read final diff and actual call sites: exactly one owner per child; group and root authorities match spawn behavior; only explicit Codex exec cancellation uses `stop(true)`; generic/Runner/PTY/OpenCode callers retain current behavior. Search dynamic/export references before removing or renaming anything.
- [ ] Confirm all six original assertions have a passing mapped production test, and that existing group drain/permission/status tests have not been weakened. Confirm no dependency, persisted format, unrelated worker, cache, timeout or worker-count change appears in the diff.
- [ ] Run `mise exec -- pnpm check` once for the final shared-owner state. The existing root script invokes typecheck/build, lint, boundaries and tests; derive exact expansion from package.json before recording it. Run no extra broad repetition after a clean pass without new changes or evidence. If blocked, retain exact failing command/test/error and leave gate open.
- [ ] Record R020 separately with existing `/tmp/dispatcher-owned-version-os-results-20261023.json` and sample path. A successful new owner test does not close it; a recurrence is not grounds to widen budgets or launch unchanged retries.
- [ ] Leave explicit later integration requirements in handoff: Devin/Copilot/Cursor replace source `ProcessCancellation(child,false)` with `OwnedProcessRoot(child)` and `cancel()` with `stop()` while preserving all source test expectations, detached false, exact 500 ms caller confirmation, protocol/version bounds and unknown background tools/session-deletion facts. Devin's swallowed cleanup uncertainty needs direct regression coverage when that file lands. Version/root helper availability alone does not qualify those backends.
- [ ] Save exact log/source/result manifests (real command, exit, start/end/wall, HEAD/status and source SHA256), commit only scoped payload and report exact verified local scope, open full/native/account/GUI/writer-release gates and commits at the assigned SDD report path. Root then reviews the exact BASE..HEAD package; no independent reviewer is dispatched by the implementer. No provider qualification, release acceptance, package install or Linear mutation is authorized by this draft.

## Draft self-review

All six assertions have an actual production owner/API mapping. Cooperative behavior has a real current Codex consumer; root mode has a concrete probe integration boundary and pending provider consumers. Existing group semantics and uncertainty tests remain required. Specs' 3 s/16 KiB/default-group/environment/unconditional-drain/500 ms requirements map to Phase 2. Shared consumers map to Phase 1 and full gate to Phase 3. No implementation or check was performed while producing this draft.

## Binding six-source assertion map


Create focused `packages/adapters/test/owned-process.test.ts`, importing production owners; retain the original six scenario titles and all signal/error assertions. Method/class substitutions are explicit below. Existing realistic fake objects may receive a `kill` method because production ChildProcess has one; no assertion may be removed.

| Source test in `a499d84:packages/adapters/test/process-cancellation.test.ts` | Production owner/API | Required assertions retained |
| --- | --- | --- |
| 1. Empty group at original root exit, later number reused | `OwnedProcessGroup.stop()` | After clearing exit-observation calls, neither `process.kill` nor child kill is called. |
| 2. EPERM at original root exit, later probe would succeed | `OwnedProcessGroup.stop()` | Reject `LOCAL_PROCESS_IDENTITY_UNKNOWN`; no later `process.kill` call. |
| 3. Child PID mutated | `OwnedProcessGroup.stop()` | Reject `LOCAL_PROCESS_IDENTITY_UNKNOWN`; neither old/replacement process nor root gets a signal. |
| 4. Non-group root captured exit | `OwnedProcessRoot.stop()` | Root kill is never called; extend to recycled/mutated fields after latched exit and forbid all group APIs. |
| 5. Identity changes before cooperative interruption | `OwnedProcessGroup.stop(true)` | Reject `LOCAL_PROCESS_IDENTITY_UNKNOWN`; neither group nor root receives any signal. |
| 6. Cooperative SIGINT throws EPERM | `OwnedProcessGroup.stop(true)` | Reject original denial; root called exactly once with SIGINT; all `process.kill` calls have signal 0 only. |

These six are the minimum, not the complete regression gate. Additional race tests must cover first-call-wins promise identity, SIGINT-triggered exit, failed interruption followed by ordinary close/stop, mutation during grace/polling, root method replacement, false-returned SIGINT, group status after sticky uncertainty, root no-exit after SIGKILL, and natural pipe/callback closure separately.


## Execution evidence contract

One fresh implementer and one scoped independent spec/quality reviewer, sequential; no worker subagents. Record actual clean BASE after prerequisites. Before every command save exact argv/cwd/HEAD/status/start and relevant source/test/runtime-consumed generated inputs; capture output, exit/end/wall/post hashes separately per attempt. No reconstruction after execution or unchanged retries. Focused RED/GREEN, self-review, then one final unmodified default mise exec -- pnpm check; root compares committed blobs with final manifest and generated post values separately. Root owns coordinated docs/evidence/disposition/Linear and parent CV14 broad branch review/integration. No push/merge/deploy/reset-credit use or native/account capability qualification follows from this task.
