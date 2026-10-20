# macOS convergence execution ledger

Scope: `dispatcher-candidate-convergence-architecture-plan.md`, Linear document
09 / INH-1917 and the approved 2026-10-20 macOS A/B plan.
Worktree: `/Users/wangdongxin/.codex/worktrees/dispatcher-convergence/dispatcher`;
branch `codex/dispatcher-convergence`, based on v3 `19db456`.

## Delivery checkpoints

- [ ] A: per-user launchd + browser + one real Codex, local task, registered
  repository, required verification, REVIEW/acceptance, recovery and actual
  macOS directory-picker evidence.
- [ ] B: accurate cost evidence, Codex/OpenCode native roundtrips, original
  Slack/Linear/GitHub daily and performance/recovery Gates.

These checkpoints do not replace original acceptance or close milestones.
Unresolved work: `docs/convergence-remaining-issues.md`. Check official quota
after every unit; stop when any reported window has <=10% remaining.
Initial official quota: 99% remaining, ordinary usage allowed.

## Pre-flight interfaces and rulings

| Producer -> consumer | Finding / decision |
| --- | --- |
| CV-02 -> CV-04/05/06/08 | v3 selection/usage authority; legacy data needs explicit provenance and strict decoding, never inferred current-config authority. |
| CV-03 -> CV-04/13 | Reproduce/fix default full-check instability; serial green is diagnostic only. |
| CV-04/05 -> CV-08/09/10 | Preserve writer protocol and lease/currentRun guards, then add control epoch. UNKNOWN cannot create another session. |
| CV-07/09/10 -> CV-11 | A can consume accepted UI subitems; CV-11 stays open until complete original acceptance. |
| CV-12/13/14 -> A/B | Existing owning Runner/delivery regression and separate real native/external evidence remain required. |

Ruling: retain accepted CV identifiers and this ledger rather than renumbering
the plan for a Task-N helper. Cost: manual bookkeeping; preserves Linear IDs.
Ruling: the user's latest instruction permits deferring unresolved failures
and continuing independent units. Failed checks remain failed and unsafe
dependent operations stay closed; do not mark incomplete issues Done.

## CV-01 / INH-1918 — source preservation

Source restore verified on 2026-10-20. Full SHAs, hashes, statuses and refs are
in `source-manifest.json`.

- v3 `19db456149593c1feadd7ff0faef35f0dc1452dd`.
- personal-local `297c32cbda45e317b2f09eee55eb3dda8d5153f6`.
- continuation `a499d84e88c9f4ff1d01c89cc20304f236fe2bbd`.
- Private backup: `/Users/wangdongxin/.codex/backups/dispatcher-convergence/20261020T173535Z`.
- Three protected `refs/backup/dispatcher-convergence-20261020T173535Z/*`.
- `git bundle verify` passed; restored each exact tip in disposable repos,
  applied binary patches/untracked snapshots, compared all 11 WIP hashes.
- Original source statuses/hashes unchanged; no original database opened.
- Bundle and raw patches stay local/private; do not upload them to Linear.

Restore into an empty temporary repo: fetch the exact protected ref from
`sources.bundle`, checkout that SHA, apply `<source>/tracked.patch`, copy only
untracked files from `<source>/files/`, verify the manifest hashes. A plain
bundle clone does not fetch custom backup refs; the first restore exposed
this and was corrected to explicit fetch. Retain originals/refs/backup until
final convergence verification.

## Unit queue

| Unit | State |
| --- | --- |
| CV-01 | source restore verified |
| CV-02 | 503-path disposition and consumer/authority decisions frozen; domain/legacy binding contract fixtures pass |
| CV-03 | atomic reload + in-flight edits fixed; process-heavy test pool bounded at four parallel workers; two configured default checks passed 90/802; ready for whole-branch review |
| CV-04 | migration/control/backup modules ported with v3 adaptation and protocol 2; targeted 12/101 and two default 90/802 gates passed; ready for whole-branch review |
| CV-05 | in progress: catalog scope/lifecycle, default ConfigPlan, per-Run provenance and adapter selection fences pass 91/833 default gate; legacy HTTP/Slack/reroute choice now integrated at 109/1085; remaining catalog/control assertions tracked |
| CV-06 | Controller nonblocking scoped collection/terminal retry verified at 115/1169; origin/attempt/time and account-quota qualification/UI pending |
| CV-08 | continuation/worker/delivery/failure Guard increments verified at 115/1173; cancel/pause/reroute/start/recovery and native qualification remain pending |
| CV-12 | pending complete selection/control integration |
| macOS service / LP / backup | pending safe shared foundation |
| CV-07/09/10/11 | pending contracts/guards |
| CV-13/14 and original Gates | pending implementation and evidence |

## CV-02 / CV-04 implementation evidence

`contract-decisions.md` freezes consumer retirement/adaptation and the single
selection/ledger/control authority. The source disposition CSV assigns every
source path; its pending target states do not claim a completed port.
Ruling: proceed with isolated persistence implementation after two unchanged
default green baselines, keeping CV-03 open for intermittent failures. No live
database/service is upgraded; the user's instruction allows independent work
to continue. Cost: the integration cannot be called ready until the full gate
is stable and the original source assertions are preserved.

Ported pure Session/Binding/Control contracts and strict legacy read validation,
migrations 4/5, writer compatibility, savepoint-backed InteractionStore and
online backup/restore. New fixtures cover v3 immutable selection, no parallel
legacy/v3 selection, frozen Run-context mismatch, old writer denial and unbound
legacy control rejection. Controller recovery stays closed for live native
contexts/control until the shared runtime/Guard is composed.

- RED: original port fixtures: 41 failed/1 passed before missing behavior was
  migrated; new writer/legacy fixtures 3 failed; v3 safety tests separately red.
- GREEN: `pnpm vitest run packages/domain/test packages/persistence/test
  apps/controller/test/native-recovery-preflight.test.ts`: 12 files / 95 passed.
- Original v3 atomic `createEntityIfAbsent` was restored after full build caught
  its removal in the old-source diff; a direct regression now preserves it.
- Default full check after initial migration: 85 files passed / 3 failed,
  773 tests passed / 3 failed, exactly the historical native probe/reload cases.
- Official quota after contract/persistence units: 97% remaining. A transient
  quota/Linear read error was retried successfully; no reset credit consumed.

## CV-03 draft reload regression

The deterministic delayed-fetch test observed localStorage writes `['', 'New
body']`: resetting the draft and filling it in a later effect persisted an empty
intermediate state. Reload now atomically uses the fetched Task context and
checks draft generation. A second RED case demonstrated that edits made while
reload was pending were overwritten. Both new regressions and the original
reload expectation pass (16 UI cases). The original async expectation waits for
the same required body value; no timeout or success assertion was loosened.

## Writer protocol and bounded parallel verification

CV-04 follow-up RED proved that the original protocol-1 gate allowed an
already-open personal-local writer to modify the converged database. Source
catalogs stop at 3/5; schema 6 now atomically installs protocol-2 gates while
preserving 4/5 definitions. Backup writers select their snapshot's own protocol.
Migration failure and outer-transaction rollback restore SQL and connection
writer state. Legacy selections without an adapted runtime also fail Controller
recovery admission before lease restoration. Latest targeted gate: 12 files /
101 tests passed; no real database opened.

Default parallel tests reproduced native stub version-probe TIMEOUT at the
unchanged 3-second deadline on this 12-core host. Process-tree sampling of a
default run measured 28 processes, 2232 MiB RSS and load 11.91. A four-worker
diagnostic passed all 90 files / 802 tests in 34.52s. The root gate now caps
test workers at min(4, available CPUs), retaining parallel files and every
explicit race/timeout assertion, so spawned CLI/Git/verification processes get
CPU budget. [Vitest's worker setting](https://vitest.dev/config/maxworkers)
controls test workers, whose default uses all available parallelism.

Ruling: bound process-heavy test-file parallelism rather than change native
probe deadlines or fixture success requirements. Cost: this host's full test
phase increases from approximately 28s to 35s; product Runner capacity is
unchanged. This mitigates test-host contention, not a claim that a real CLI
will always answer within its deadline. First configured default `pnpm check`
passed 90 files / 802 tests; second independent default also passed 90 / 802
in 34.60s test time. Logs: `/tmp/dispatcher-convergence-default-four-check-1.log`
and `/tmp/dispatcher-convergence-default-four-check-2.log`. Typecheck/build,
lint and import boundaries passed in both complete checks. No serial switch,
deadline increase, skip or provider success fabrication was used.

Preservation check: migration-4 SQL hash matches `a499d84` exactly:
`02be24fce36638107a3e279ea2cb950cd21e1ee7944e443c0a9a44691b38f37e`;
migration 5 name/SQL/afterApply call are unchanged. New protocol-2 gates are
installed only by migration 6. Schema-3/5 backup sources remain unchanged while
their restored private copies upgrade and retain reconciliation barriers.

Official quota at the latest completed unit checkpoint: 96% remaining.

## CV-05a catalog scope integration

Reused the old ModelCatalogService pending-read and last-success behavior in
the v3 catalog path. Identical in-flight profile/repository/config/native-context
reads share one operation; independent worktree/reason reads do not supersede
each other. Successful UI inventory storage is bounded to one record per
profile/repository, explicitly tagged with its scope. Worktree preflight still
queries native state and never promotes cached entries to execution evidence.
Returned profile/Runner/provider/backend must match the owning adapter.

Three new RED cases demonstrated duplicate-reader supersession, discarded
last-success data and accepted foreign-account catalogs. The initial 49 publication
tests passed, followed by the complete default gate below. Cache failures retain sanitized reasons
and native-cache freshness, while explicit publication stays blocked. Shutdown
admission/post-await writes are closed, with complete abort/drain still R-008.
CV-05 remains In Progress for lifecycle and legacy capability/price evidence.


## CV-05b default review and immutable source

The existing `/api/config/plans` endpoint accepts an optional strict
`NativeModelDefaultReviewV1` context. Its versioned evidence commits atomically
with the plan, binds actor/revision/native scope, and is freshly requalified
at apply time. Credential scope is rechecked after asynchronous secret/trial
work. Legacy `model-default-plan` shapes remain intact but require fresh review;
legacy catalog hashes are not guessed as equivalent to v3 revisions. Ordinary
ConfigPlans remain supported and do not gain invented native qualification.

`ModelsPage` sends the reviewed context through the same edit-based ConfigPlan
helper. PublishPage offers an explicit account-default choice, freezes its
actual model/effort/source and restores it with the local draft. Service rejects
changed defaults and forged attribution; Codex receives the requested model and
effort. The empty/native-default choice still omits both parameters. Policy
routing keeps its v3 classifier/decision chain, including freshness and context
checks; no second router or legacy publication page was mounted.

Four new RED assertions covered missing default-plan context, lost source,
forged source and local draft restoration. Together with five default-plan
cases (native catalog/credential drift, legacy proof, atomic failure and valid
apply), the targeted suite passed 4 files / 87 tests. Full
`mise exec -- pnpm check` passed 90 files / 813 tests (36.37s test phase).
Intermediate type inference and no-control-regex errors were fixed with an
explicit Draft state type and character validation; no checks were weakened.
Logs: `/tmp/dispatcher-cv05-source-red.log`,
`/tmp/dispatcher-cv05-source-green.log`,
`/tmp/dispatcher-cv05-default-selection-check.log`.

Source behavior adapted from a499d84 `model-catalogs.ts` and default editor;
v3 19db456 publication/ConfigPlan/UI remains the target authority. The Grok
lifecycle fixture backend was corrected to the producer's existing
`grok-cli-json`; its credential-change assertions remain unchanged.
Rollback this unit through a compatible candidate checkout and backup; do not
open schema 6 with a v3-only or protocol-1 writer. Original source worktrees,
WIP, native stores and live Controller data were not changed.
Official quota after this unit: 93% remaining, ordinary usage allowed.


## CV-05c catalog shutdown and concurrent selection

Local Codex/CLI/OpenCode catalog readers now accept adapter-owned cancellation.
Codex and CLI terminate their owned process groups and confirm close before
returning; the private OpenCode host also cancels HTTP/startup and drains its
process. This optional signal stays in the adapter boundary, not the pure domain
or remote wire protocol. The Controller closes request admission immediately,
separately owns underlying native reads, waits up to 3s for cleanup and prevents
late results from writing to closed storage. An unresponsive reader leaves a
persisted `catalog-lifecycle/shutdown` UNKNOWN diagnostic. A later clean shutdown
does not erase prior unconfirmed cleanup. Remote cleanup remains owning-Runner
evidence and cannot be inferred from a closed Controller HTTP request.

New RED cases reproduced missing cancellation, a live RPC timeout and shutdown
hanging on an ignoring reader. Positive tests confirm RPC/CLI/OpenCode process
closure and Controller drain; the ignoring-reader test confirms a bounded stop
and retained UNKNOWN. A full HTTP two-model test freezes different efforts,
starts both on one capacity-2 account, restarts the service and verifies identical
selections with no new inference. Existing native-default/Policy and adapter
continuation assertions remain intact.

Targeted `mise exec -- pnpm vitest run` for task-publications, codex-catalog and
cli-catalog passed 3 files / 82 tests. Default `mise exec -- pnpm check` passed
90 files / 819 tests. Logs: `/tmp/dispatcher-cv05-lifecycle-red.log`,
`/tmp/dispatcher-cv05-unclosed-red.log`,
`/tmp/dispatcher-cv05-lifecycle-concurrency.log`,
`/tmp/dispatcher-cv05-lifecycle-check.log`. Official quota: 92% remaining.
R-008 is locally implemented; real macOS shutdown/restart and diagnosis remain
in MAC-01. CV-05 is still open for remaining legacy adapter/catalog assertions;
OpenCode server-backend/native runtime proof belongs with CV-09, and account
price qualification with CV-07. Inventory costs are never accepted as prices.


## CV-05d adapter selection fences and snapshot preservation

Adapted a499d84 structured-model-binding assertions to the v3
ExecutionSelection contract in the owning Codex/StructuredCli adapters. New
`execution-selection.ts` freezes inputs before native preparation, validates
account/provider/backend/provenance and rejects parameters the backend cannot
submit. Selection and execution-owner changes during awaited previous results
or preparation fail before a new native call. Requested model/effort remain
separate from provider-reported evidence.

Legacy entrypoints that do not supply ExecutionSelection capture one
`AdapterSession.legacyModel` snapshot, including a present empty object for
known omission. It cannot coexist with a current selection. Historical sessions
that lack either snapshot remain readable but cannot resume by guessing from
current defaults (`MODEL_SNAPSHOT_UNKNOWN`); legacy `modelSelection` shapes
require source-specific review (`MODEL_LEGACY_REVIEW_REQUIRED`). This intentionally
changes the old source's pre-snapshot fallback to honor the accepted unknown-fact
rule. No historical records are rewritten. The persistence store rejects changing
or removing a session selection/snapshot or its account/backend/workspace owner,
while lifecycle state remains mutable. This does not replace CV-08 control fences.

New adapter tests first reproduced 10 failures, then two missing-snapshot cases;
the new persistence case reproduced an accepted overwrite. Targeted adapter and
persistence suite passed 4 files/71 tests before the final historical cases.
`mise exec -- pnpm check` passes 91 files/833 tests (36.13s test phase).
Existing parameterized CLI fixtures now carry their actual provider/backend
identity; all previous model/default/parameter assertions remain. A concurrent
HTTP test originally assumed request-order startup and failed the full gate;
it now checks each receipt's Run/worktree against its native model and effort,
which verifies the actual association independent of scheduling order.
Logs: `/tmp/dispatcher-cv05-adapter-binding-red.log`,
`/tmp/dispatcher-cv05-session-immutability-red.log`,
`/tmp/dispatcher-cv05-missing-snapshot-red.log`,
`/tmp/dispatcher-cv05-binding-final-check.log`.

Rechecked all three original HEAD/status snapshots and 11 WIP file hashes:
unchanged. Official quota after this unit: 91% remaining, ordinary usage allowed.
Remaining source assertions involving executionRef, native prompt admission,
backend injection and native-store ownership still require CV-08/09/10. The
legacy canonical dispatch path's missing Run-level ExecutionSelection is R-009;
this adapter snapshot increment does not claim that path is fully converged.


## CV-05e physical catalog-process cleanup

Reused the existing OwnedProcessGroup boundary in all three local catalog readers
instead of maintaining parallel signal/kill logic. `catalog-process.ts` requires
its physical group stop and bounded callback close; any failure returns sanitized
`MODEL_CATALOG_CLEANUP_UNKNOWN`, overriding otherwise usable query evidence.
Codex no longer reports success based only on parent close or resends signals to
a previously absent numeric group. CLI and OpenCode share the same ownership rule.
Controller's shorter 3s shutdown drain can still retain UNKNOWN while producer
cleanup is outstanding; a closed request is never a cleanup receipt.

A new POSIX-only fault test makes owned-group signalling fail with EPERM. RED
reproduced a read that did not settle with a cleanup diagnostic; GREEN returns
the typed unknown error without private diagnostics. The fixture kills only its
own freshly created process in cleanup. This platform condition applies only
to the new POSIX assertion; no existing tests were skipped or loosened. Other
reader cancel/success/version assertions and the actual ignoring-reader shutdown
case remain intact. Targeted suite passes 3 files/83 tests. Default
`mise exec -- pnpm check` passes 91 files/834 tests (36.64s test phase).
Logs: `/tmp/dispatcher-cv05-group-cleanup-red.log`,
`/tmp/dispatcher-cv05-group-cleanup-green.log`,
`/tmp/dispatcher-cv05-owned-process-final-check.log`.
Official quota after the unit: 90% remaining, ordinary usage allowed.

CV-05 still retains its native/backend/Guard and legacy canonical-dispatch
conditions. Independent CV-06 work may adapt the pure legacy observation reader
against the frozen decimal contract, but collection/control-dependent writes
must not be enabled before their prerequisites are composed. This is a scoped
foundation unit, not permission to close CV-05 or its real Gates.


## CV-06a private legacy measurement reader

Added pure `readLegacyUsageMeasurement`, based on a499d84 domain/models and
metering validation. The caller must identify the legacy format and record.
The reader freezes private raw evidence, preserves source/turn/native-session/
generation/attempt and optional billing occurrence, converts only safe stored
numeric representations into decimal text and rejects unsupported precision,
non-finite/negative/unsafe values, fractional token counts and invalid cache
inclusion. Zero remains present; missing dimensions/inclusion/time stay missing.
Exponent expansion uses decimal text positions, not quantity arithmetic.

Its result is historical read-only evidence, not UsageObservationV1 or a second
ledger. It always retains an unproven-native-event-identity diagnostic: collector
UUIDs cannot establish cross-collector native event equivalence. It produces
neither totals nor imports, and its private raw object must never be returned
by an API projection. No provider query, native control or collection write was
added. Canonical origin reconciliation/attempt/time mapping is R-010, followed
by collector/quota integration after the required selection/control prerequisites.

All five decoder cases first failed without the implementation. A specifically
isolated fractional-token case also went RED before validation was added.
Targeted decoder/catalog suite passes 3 files/29 tests. Default
`mise exec -- pnpm check` passes 92 files/839 tests (36.02s test phase).
Logs: `/tmp/dispatcher-cv06-legacy-read-red.log`,
`/tmp/dispatcher-cv06-fractional-token-red.log`,
`/tmp/dispatcher-cv06-readiness-legacy-targeted.log`,
`/tmp/dispatcher-cv06-legacy-read-final-check.log`.

The first full check had 838 passes and one newly added catalog-cancel fixture
failure: Vitest's implicit 1s poll limit expired before its child wrote ready.
These three cancellation fixtures now observe a filesystem readiness event,
then trigger cancellation and await their real outcomes before cleanup. This
removes the accidental startup-latency assertion and dangling async expectation;
product query deadlines, process termination deadlines, test timeout and actual
cancellation/closure expectations remain unchanged. No existing provider probe
or product deadline was increased. Official quota after this unit: 90% remaining.


## CV-06b passive Codex/Qoder snapshots

Codex and Qoder usage reads no longer await a running or draining turn's result.
Actual CLI readers use current resource/event snapshots. Qoder exposes only its
latest bounded resource event with its observation timestamp. Business result
observation can populate a private per-turn weak cache; legacy injected backends
without stream snapshots may refresh an already completed result, coalescing a
pending read and yielding after one microtask instead of waiting for native work.
That compatibility preserves the existing explicit resource-probe/recovery flow.
It never starts a session or adds another canonical usage ledger.

Failed snapshot reads return sanitized telemetry-unknown metadata without an
execution resource state. Native observation times stay fixed and prior-turn data
is not transferred to a newly started turn. Missing account quota/tokens remain
unknown, and Qoder does not acquire synthetic token measurements. The existing
Controller resource pipeline is retained; complete background collection isolation,
quota TTL and canonical origin/attempt/time admission are still R-010.

Eight initial cases reproduced six failures; observation-time/next-turn coverage
added a Qoder timestamp failure before the fix. Targeted adapter/publication/MVP
suite passed 5 files/99 tests. Full check then caught one existing quota-recovery
regression caused by permanently caching the legacy probe result. The getter now
supports nonblocking completed-result refresh with its original source/timestamp
semantics. Targeted rebuilt Controller/adapter regression passed 2 files/27 tests;
final `mise exec -- pnpm check` passed 93 files/849 tests (37.32s test phase).
One direct targeted rerun exercised stale adapter dist; rebuilding the package
fixed that evidence mismatch. The existing know-how instruction at lines 281 and
517 documents this build prerequisite; it was not necessary to change test tools.
Logs: `/tmp/dispatcher-cv06-passive-usage-red.log`,
`/tmp/dispatcher-cv06-snapshot-time-red.log`,
`/tmp/dispatcher-cv06-passive-probe-rebuilt.log`,
`/tmp/dispatcher-cv06-passive-usage-final-check.log`.
Official quota after this unit: 88% remaining, ordinary usage allowed.


## CV-08a native interaction and read-only recovery foundations

Ported a499d84 optional adapter interaction contracts, native request handles,
Runner dispatch/quiescence/release/stop/reclaim helpers and bounded native event
recovery. Read observer lives in `native-observation.ts`: v3's existing remote
`NativeRunnerRuntime` remains intact. Observation generations, late reads and
request metadata are fenced; unqualified capabilities and unknown receipts stay
closed. Native event journal metadata uses checksum/CAS and remains separate
from v3 transport replay, command bindings and ACKs. A restart/compaction
coexistence regression preserves those original command identities.

Ruling: adapt native drift comparison to the one v3 ExecutionSelection, rather
than porting old ModelSelection as a second authority. Explicit model and effort
are compared independently without rewriting the bound choice. A native-default
omission has no concrete model baseline and stays unverified; native integration
will need a qualified original reported context, never a current default guess.
Cost: native-default reclaim stays closed until that context is available.
Account identity accepts only provider-confirmed opaque SHA-256 fingerprints.

The original five missing-module suites first went RED; drift's three new v3
cases also went RED before adaptation. Rebuilt domain/adapters/Runner targeted
suite passed six files/77 tests. Default gate initially found two unused imports
left after splitting the old runtime; corrected without suppression. Final
`mise exec -- pnpm check` passed 99 files/927 tests (46.72s test phase).
Logs: `/tmp/dispatcher-cv08-foundation-red.log`,
`/tmp/dispatcher-cv08-drift-red.log`,
`/tmp/dispatcher-cv08-foundation-green.log`,
`/tmp/dispatcher-cv08-foundation-final-check.log`,
`/tmp/dispatcher-cv08-foundation-final-check-2.log`.
Official quota after this unit: 86% remaining, ordinary usage allowed.

This is a foundation increment. CV-08 remains open: Controller command lanes,
all final write admissions, recovery, external change/candidate invalidation and
real native handoff are not yet composed. Controller's native startup barrier
remains in place. No live database or native account was used. The source host
manager and its process-tree proof need the following increment; no release UI
or parallel controller router is exposed.


## CV-08b native host lifetime and process-tree proof

Ported the a499d84 NativeRuntimeHosts manager alongside the read observer,
without replacing the v3 remote NativeRunnerRuntime. Explicit scope/profile and
execution claims are captured before awaits; host ownership conflicts and lost
interrupt receipts retain UNKNOWN. Owned root/local callback cleanup and native
writer/tool release remain independent. External hosts never receive stop.
Owned host stop needs quiescence, drained claims/commands, physical owned-group
absence and separately qualified backend containment. Late owned acquisitions
can be cleaned locally without changing the earlier unknown public receipt.

Existing ProcessManager and all of its original cleanup behavior remain in place.
It now exposes optional process-tree facts using the existing OwnedProcessGroup.
POSIX absence latches before PID reuse; EPERM is unknown. PTY/Windows and old
handles without tree facts cannot prove host cleanup. New native recovery
decisions preserve binding/deletion identity and never auto-start execution.

Ruling: three newly migrated source assertions assumed its old ProcessManager
left descendants alive after root exit. Target v3 already drains owned groups
before result. Preserve this stronger behavior: assert actual descendants are
absent, retain an explicit surviving-tree negative decision, and use real escaped
detached descendants for the unreadable/deleted-native-history chaos cases.
Such escaped children still live outside an empty group, which cannot establish
backend containment. No pre-existing target assertion was changed or skipped.
Cost: Linux/Windows behavior still needs original platform qualification; current
physical evidence is Apple Silicon macOS only. New POSIX-specific PID-reuse test
is platform-conditional, and the new PTY-uncertainty assertion runs everywhere.

RED: 49 source host cases failed before host manager/reconcile were available;
two new tree-status tests failed before producer support. After the first port,
three source assertions exposed the cleanup semantic difference above. Adapted
source cases plus original ProcessManager/distributed regressions passed 5 files/
85 tests. Final default `mise exec -- pnpm check` passed 102 files/980 tests
(46.91s test phase). Logs: `/tmp/dispatcher-cv08-hosts-red.log`,
`/tmp/dispatcher-cv08-tree-status-red.log`,
`/tmp/dispatcher-cv08-hosts-green.log`,
`/tmp/dispatcher-cv08-hosts-adapted-green.log`,
`/tmp/dispatcher-cv08-hosts-final-check.log`.

No real provider/backend containment qualification or Controller Guard admission
is claimed; R-005/R-008 and original native/GUI Gates stay open. Rollback remains
the original compatible binary/data or this isolated candidate's prior SHA; no
original DB/service was opened. Official quota checked after this unit; remaining
percentage is recorded in its Linear checkpoint.


## CV-08c Controller coordinator, receipts and v3 reclaim/start fences

Ported a499d84 `native-interactions.ts` and `native-external-changes.ts` as the
single Controller coordinator, with five source guard/receipt/external-change/
reclaim/start suites. Added only the AdapterSession native execution/observer and
start-outcome contracts this coordinator consumes. No provider SDK or transport
was imported into domain/protocol; the existing service routes are unchanged.

The coordinator captures control/Task/lease authority, serializes per-session
mutations, preserves durable UNKNOWN on uncertain sends, retains original native
request connection handles and separates session interruption from host lifetime.
Reclaim reads Git/native/history/resource facts and requires explicit confirmation
before atomically granting a new epoch and invalidating old verification. Scope
and metadata normalization retain no raw transcript/secret diagnostics.

Ruling: every old coordinator ModelSelection use was adapted to the v3 Run's
ExecutionSelection. Reclaim also reads only `run-contract`, checks its version/
revision against the Run and checks its frozen repository/base commit. A current
Task contract cannot repair absent Run context. Source reclaim fixtures now use
that v3 choice plus a real frozen contract; all original assertions remain.
Cost: legacy selections/native-default omissions without qualified baselines
stay closed until explicit source-specific reconciliation.

Additional RED cases proved that source start reservation did not compare the
full frozen v3 choice and settlement did not compare the returned adapter choice
and execution context. The coordinator now compares them without changing the
existing receipt authority. A separate RED case caught frozen contract revision
drift. Negative tests preserve the existing store's Task/control checks and its
proactive cancellation of RESERVED commands on epoch changes. The first new
assertion incorrectly expected RESERVED/stale-control after that cancellation;
the corrected assertion requires CANCELLED/START_ALREADY_SETTLED. No original
assertion was weakened.

A redundant new pre-reservation lock check was removed after a RED replay case
showed it blocked read-only ACK receipt replay after authority changed. Existing
InteractionStore already checks locks for new commands and rechecks authority
before SENDING. The original acknowledged receipt can be read, but begin still
rejects a second send. This preserves idempotent reads independently of writes.

Evidence: original three suites first failed on missing coordinator modules.
Unadapted legacy reclaim fixture had 14 failures/5 passes; after v3 fixture
adaptation the revision test went RED, then passed. Five final targeted files/
89 tests pass. First full gate had 1067 passes and exactly the new cancellation-
expectation failure; corrected full gate passed 107/1068. After the additional
replay RED/fix, final `mise exec -- pnpm check` passed 107 files/1069 tests
(41.34s test phase). Logs:
`/tmp/dispatcher-cv08-controller-guard-red.log`,
`/tmp/dispatcher-cv08-v3-reclaim-red.log`,
`/tmp/dispatcher-cv08-frozen-contract-red.log`,
`/tmp/dispatcher-cv08-v3-start-red.log`,
`/tmp/dispatcher-cv08-start-locked-red.log`,
`/tmp/dispatcher-cv08-start-replay-red.log`,
`/tmp/dispatcher-cv08-controller-guard-final-green.log`,
`/tmp/dispatcher-cv08-controller-guard-final-check-3.log`.

The coordinator is not yet connected to v3 service entry points. R-005 remains
open for SDK-final admission, Run/start identities, HTTP/Slack/semantic/worker/
verification/delivery/cancel composition and recovery. Keep v3 physical drain,
run-input receipts, native startup barrier and unavailable takeover UI intact.
No real account, primary worktree or live DB/service was used. Official quota
checked after the unit; percentage recorded in Linear.


## CV-08d Codex CLI final native write admission

Added optional synchronous beforeSend to the existing adapter start/send/resume
contract and implemented its final boundary in Codex CLI. Same-session writes
check again after the previous result await and directly before native start,
including after new-turn intent storage. Resume forwards the same captured guard.
Async/non-void guards are rejected immediately with a sanitized error; rejected
Promises are consumed without waiting. Only this pre-native boundary produces
a typed not-sent admission receipt. Initial creation rejection additionally
reports not-created and marks its adapter intent failed; backend failures do not
receive that proof. Cancellation and existing unguarded consumers are unchanged.

Creation snapshots the incoming request before intent persistence, preserving
its original callback, managed cwd and prompt. This complements the existing
immutable model/effort snapshot rather than rereading mutable caller input.
No alternate Controller router or runtime authority was introduced. The shared
signatures alone do not qualify other adapters; their actual final sites must
be adapted/verified before native control capabilities are enabled.

RED: all seven initial final-admission cases failed before implementation. Two
additional capture cases then failed when caller input changed during intent
storage. Final rebuilt targeted suite passes three files/36 tests, including
original Codex and execution-selection regressions. Default
`mise exec -- pnpm check` passes 108 files/1078 tests (41.64s test phase).
Logs: `/tmp/dispatcher-cv08-codex-admission-red.log`,
`/tmp/dispatcher-cv08-codex-admission-capture-red.log`,
`/tmp/dispatcher-cv08-codex-admission-green-2.log`,
`/tmp/dispatcher-cv08-codex-admission-final-check.log`.

This unit has no Controller service wiring or real provider/GUI acceptance.
R-005 still requires reserved Session identity/execution context, v3 input and
receipt/worker/delivery integration, other native writers and recovery. Native
startup admission remains closed; do not close CV-08 or original Gates. Rollback
is this isolated branch's previous SHA; original workspaces/data remain intact.
Official quota checked after this unit; percentage is recorded in Linear.

## CV-05e / R-009 legacy canonical Run selection

New canonical HTTP/Slack dispatch and legacy owning-Runner reroute now compile
ExecutionSelection at reservation from the chosen adapter's actual legacy
invocation defaults. Source is explicitly `legacy-config`; no catalog revision
or native freshness is invented. The optional adapter projection reports only
its known backend/model request defaults. Generic PTY reports its actual backend
instead of borrowing the manifest's first entry; ambiguous adapters without a
projection cannot silently choose a backend. No Controller provider/argument map
was introduced. Existing configured defaults remain ConfigPlan-owned.

Scheduler snapshots the explicit input selection and passes the reserved Run's
choice to start, including choices compiled during reservation. Codex, CLI, Qoder,
Generic and Devin sessions retain that same choice. Qoder continuation now uses
its stored Run/model snapshot, with post-await identity validation, rather than
a changed profile default. Direct legacy starts capture a known model omission/
value; historical missing snapshots stay unknown and are not repaired from
current profile config. No historical Run was backfilled.

The newly created WorkspaceHandle supplies frozen repository/baseRef/baseRevision
to the Run contract. The mutable Task contract is not changed. Legacy continuation
checks its scoped execution/credential fingerprint without pretending a native
catalog was queried; it still runs existing Task/Run/lease checks. Existing
physical drain, owning-Runner/workspace transfer, reroute receipt, frozen
verification and none/commit/PR behavior remain in place. Run.executionRef and
native control are deliberately not enabled by this increment.

Ruling: a configured model invocation predates native catalog qualification on
some CLI/Qoder consumers. Only those actual model-bearing boundaries accept
legacy-config explicit requests; unsupported interactive/manual selection still
rejects before native I/O. Generic/Devin model omission consumers cannot use that
exception. This preserves actual old consumers without granting UI capability or
pricing evidence. Cost: requested configured model remains distinct from a native
reported model, which may be unknown; full native qualification remains a Gate.

RED: two canonical HTTP/Slack cases observed no Run selection. Four adapter cases
then exposed dropped selections/legacy CLI qualification; a fifth PTY case exposed
missing backend ownership projection. The rebuilt targeted adapter/personal-loop
suite passes 2 files/41 tests, including every original personal-loop assertion.
Default `mise exec -- pnpm check` passes 109 files/1085 tests (43.11s test phase).
No original test assertion was changed, skipped or loosened; the -t diagnostic
run alone deselected unrelated cases before the full suite ran all of them.
Logs: `/tmp/dispatcher-cv05-legacy-run-choice-red.log`,
`/tmp/dispatcher-cv05-legacy-adapters-red.log`,
`/tmp/dispatcher-cv05-legacy-backend-red.log`,
`/tmp/dispatcher-cv05-legacy-backend-green.log`,
`/tmp/dispatcher-cv05-legacy-run-final-check.log`.

R-009 is locally implemented and verified; whole-branch/native evidence remains
open under CV-05/12. R-005 still requires reserved native Session/context, service
entry-point/final-SDK Guard composition and recovery. Rollback is the prior
isolated-candidate SHA; no live or primary worktree data was used. Official quota
checked after the unit; percentage recorded in Linear.


## CV-08e reserved adapter Session IDs and creation outcomes

Ported a499d84 `startSessionId`, local spawn/preparation failure classification
and the original cross-adapter start-intent contract suite. The shared
AdapterStartInput accepts an optional reserved Dispatcher Session ID; Codex,
Qoder, Structured/Generic CLI, Devin and local service retain it without using
it as a provider-native ID. Reusing it rejects before another create. CLI stores
its intent before awaiting credential/executable preparation, so a concurrent
same-ID request cannot cross that preparation gap. Existing callers may still
omit an ID and get a fresh one. Controller/Scheduler reservation is not changed
yet; native startup admission remains closed.

Proven owned-local spawn errors retain not-created/SPAWN_FAILED diagnostics.
Pre-HTTP credential failure is sanitized and marked not-created; a lost HTTP
response receives no such proof. Native/API failures are not inferred to be
pre-create just because the reply failed. These helpers will feed the durable
Controller creation receipt when its service composition is enabled.

Local service also preserves legacy Run selection for WorkBuddy/CodeBuddy using
the configured provider product, not the shared manifest's umbrella ID. Both
provider cases went RED with a context mismatch before that adaptation. This
completes the actual local-service omission consumer of R-009 without granting
model selection/native-interaction capability.

RED: all 13 original start-intent cases failed before the port; two additional
product-provider cases then failed before the fix. Added concurrent credential
preparation coverage and strengthened the lost-HTTP-reply assertion to require
no not-created proof. Targeted rebuilt suite passes 3 files/30 tests. Initial
default check found six unused imports after common start-input typing; removed
them without suppression. Final `mise exec -- pnpm check` passes 110 files/1101
tests (38.71s test phase). Logs:
`/tmp/dispatcher-cv08-start-identity-red.log`,
`/tmp/dispatcher-cv08-start-provider-red.log`,
`/tmp/dispatcher-cv08-start-identity-all-green.log`,
`/tmp/dispatcher-cv08-start-identity-final-check.log`,
`/tmp/dispatcher-cv08-start-identity-final-check-2.log`.

No new native binding, control transition, schema or SDK credentials were enabled.
R-005 remains open for logical invocation metadata, other final-SDK admissions
and v3 service creation/input/worker/delivery/cancellation composition. Rollback
is the prior isolated branch SHA; original data/workspaces remain intact.
Official quota checked after the unit; percentage recorded in Linear.

## CV-08f final built-in write admission and logical invocation facts

Qoder, Structured/Generic CLI and HTTP create/input writers now carry the same
synchronous final admission callback as Codex. HTTP checks after credentials;
Structured CLI constructs arguments before its final check. Guard failures
before creation prove not-created; input rejection proves not-sent. Lost native
responses keep their uncertain classification. Async injected Devin backends
must implement the callback contract to enter guarded mode; legacy unguarded
callers retain their existing behavior. This ABI does not qualify native control.

Start snapshots caller-supplied generation/attempt/lease, validates them and
stores them with the adapter Session. No counters or execution locations are
inferred. Persistence rejects replacing/erasing established execution metadata;
post-await continuation rejects drift even with an in-memory SessionStore.
No Controller native-control path or live data migration is enabled yet.

RED: 17 missing-admission/context cases, two post-await drift cases, two immutable
persistence cases, and argument preparation changing authority before spawn.
The new HTTP fixture was corrected to use Devin's real snake-case response key;
the existing parser/assertions were not loosened. Rebuilt targeted checks pass
4 files/47 tests. Default `mise exec -- pnpm check` passes 112 files/1123 tests
(44.03s test phase); `git diff --check` passes. Logs:
`/tmp/dispatcher-cv08-final-writers-red.log`,
`/tmp/dispatcher-cv08-execution-metadata-drift-red.log`,
`/tmp/dispatcher-cv08-persisted-context-red.log`,
`/tmp/dispatcher-cv08-cli-argument-admission-red.log`,
`/tmp/dispatcher-cv08-final-admission-green.log`,
`/tmp/dispatcher-cv08-final-admission-check.log`.

R-005 remains open for actual Controller/Scheduler composition and recovery.
Before activating controls, upgrade the minimum writer protocol again: an
already-open intermediate protocol-2 runtime understands selection but does not
guard all control paths. Preserve schema 4/5/6; use an additive atomic migration
and verify old-writer refusal/rollback/backup compatibility. Rollback for this
unit is 0249a88; original workspaces/data remain intact. Official quota checked
after the unit and recorded in Linear.


## CV-04 follow-up / CV-08g control-runtime minimum writer

Additive schema 7 raises the minimum connection writer to protocol 3 before
activating Controller controls. Protocol 2 intermediate runtimes know v3 choice
immutability but lack complete control admission. Original schema 4/5/6 SQL and
semantics remain unchanged. Both old-binary startup and already-open protocol-2
writes reject. A failed migration or outer rollback restores the SQL gate and
connection-local protocol. Snapshot backup uses its own schema protocol; schema
3/5/6 archives restore into a schema-7 copy behind reconciliation barriers.
Source databases and live user data are not upgraded by these tests.

RED: three protocol-2 fencing/rollback cases failed at schema 6. GREEN: targeted
persistence/recovery suite 8 files/69 tests. Existing default-schema assertions
were intentionally advanced from 6 to 7; no behavior/rollback assertion was
removed. A schema-6 backup case was added. Default `mise exec -- pnpm check`
passes 113 files/1127 tests (44.47s test phase). Logs:
`/tmp/dispatcher-cv08-control-writer-red.log`,
`/tmp/dispatcher-cv08-control-writer-all-green.log`,
`/tmp/dispatcher-cv08-control-writer-check.log`.

Controller startup admission remains closed for existing native controls. This
migration provides writer exclusion, not a claim that runtime composition or
native recovery is complete. Rollback uses the previous binary with its own
matching backup; never downgrade schema or remove triggers. No live migration
was performed. Official quota checked after this unit; recorded in Linear.


## CV-08h Scheduler reserved creation lifecycle

Ported/adapted the source startReserved lifecycle to v3 frozen selections and
existing replacement/preflight behavior. Guarded consumers require sending and
settlement callbacks together, reserve a real Dispatcher Session ID, and pass
actual logical counters. Sending admission occurs only in the adapter's final
callback, after its asynchronous preparation; retained callbacks close when that
invocation finishes. Created results must match the reserved identity, logical
execution and choice. Missing admission, wrong Session, lost reply or failed
success-receipt persistence retains RUNNER_UNAVAILABLE/manual/UNKNOWN with no
endedAt. Only proven not-created or pre-adapter failure becomes FAILED. Existing
unguarded consumers retain the v3 failure contract and remote unknown handling.
Controller activation remains a separate pending increment.

NativeInteractions provides a per-invocation start callback: repeated checks can
revalidate the same SENDING command without issuing a second start, while a new
callback cannot adopt SENDING/UNKNOWN. Reservation/begin/created settlement reject
a revoked lease; settlement also compares captured Task revision/control epoch.
An unqualified backend might create without invoking admission: only start
receipts may conservatively transition RESERVED to UNKNOWN, blocking retry.
This does not grant authority to send and cannot turn UNKNOWN back into SENDING.

Native ExecutionRef creation remains closed until actual backend-location
qualification is integrated. Source scheduler execution-context assertions have
not yet been ported; they are not represented by the new A-only lifecycle tests.
No managed location is fabricated for cloud/API backends, and the Controller
startup barrier for native records is retained.

RED: nine lifecycle cases, four revoked/repeated-admission cases, the
unacknowledged-admission UNKNOWN case, then the unqualified-context case.
Rebuilt target passes 6 files/76 tests, including every original v3 Scheduler
case. Default `mise exec -- pnpm check` passes 114 files/1144 tests (43.93s test
phase); no old assertion was removed or loosened. Logs:
`/tmp/dispatcher-cv08-scheduler-lifecycle-red.log`,
`/tmp/dispatcher-cv08-start-admission-revoked-red.log`,
`/tmp/dispatcher-cv08-start-admission-uncertain-red.log`,
`/tmp/dispatcher-cv08-start-context-red.log`,
`/tmp/dispatcher-cv08-start-lifecycle-final-green.log`,
`/tmp/dispatcher-cv08-start-lifecycle-check.log`.

R-005 remains open for Controller entry-point/worker/continuation/delivery/cancel
composition and recovery. Rollback is ff82d34; no real data/workspaces changed.
Official quota checked after the unit; percentage recorded in Linear.


## CV-08i Controller continuation Guard composition

Controller now instantiates NativeInteractions after the unchanged startup
preflight barrier. Web/Slack input and operator/resource resume capture Task,
Run and control authority and share a Session mutation lane. Their final adapter
callback rechecks it after awaited preparation. A local not-sent proof records
REJECTED; a lost reply or post-send authority change retains OUTCOME_UNKNOWN and
unavailable capacity. Accepted outcome acknowledgement clears the mutation marker
before notification-only work. Task revision binds on the first successful
mutation check even when its fence was captured before queuing. Persisted revoked
leases reject input despite an older in-memory lease cache.

Slack now uses the same durable Run-input ledger as Web/resume, so another reply
or channel cannot resend an uncertain waiting episode. Its existing confirmed
messaging receipt still retries only notification. Stale input cleanup compares
the original control and invocation fence and skips a different/locked owner;
it never cancels a new controller to make the old result fit. Standalone input
retains its existing context/stop gate plus the coordinator's ownership gate.
Existing remote continuation runs the callback before the established transport;
this does not qualify remote native handoff or add a protocol capability.

RED: all six new control-lock/final-await/post-effect cases failed on the previous
service. Rebuilt personal/lifecycle tests pass 2 files/59 cases; native coordinator
checks pass 5 files/91 cases. Added lost-Slack-ack/cross-channel, persisted revoke,
captured-revision, remote callback and Mock resume coverage. Mock resume first
went RED and now checks admission before changing its state.

Initial full check found that Mock omission and a pre-existing Controller fixture
that attached standalone trial Session IDs to different fabricated Run IDs.
The fixture now creates each adapter Session with its real intended canonical
Run ID; recovery and verification assertions remain unchanged. The async Devin
fixture timed out because it did not implement guarded backend admission; it now
checks the supplied callback after its await, with all original assertions kept.
No timeout was increased, no test was skipped or assertion weakened. Typecheck
also caught lost narrowing across the new callback; captured the validated text/
Run identity without suppression. Final target passes 5 files/102 tests. Final
default `mise exec -- pnpm check` passes 114 files/1155 tests (43.17s test phase).
`git diff --check` passes. Logs:
`/tmp/dispatcher-cv08-service-input-guard-red.log`,
`/tmp/dispatcher-cv08-service-inputs-all-green.log`,
`/tmp/dispatcher-cv08-mock-resume-guard-red.log`,
`/tmp/dispatcher-cv08-service-inputs-check.log`,
`/tmp/dispatcher-cv08-service-inputs-final-target.log`,
`/tmp/dispatcher-cv08-service-inputs-native-green.log`,
`/tmp/dispatcher-cv08-service-inputs-final-check.log`.

Worker advancement, verification/delivery, failure/cancellation, start reservation
and safe recovery are still pending in R-005. Native UI and startup admission
remain closed; no real provider, database or macOS service Gate is claimed.
Rollback is a33da7c on the isolated candidate; originals/data stay intact.
Official quota checked after the unit; percentage recorded in Linear.


## CV-08j background advancement and verification/delivery Guard

Background/API advancement now shares the Session mutation lane with input,
captures Task/control authority before queuing, checks it before reading native
status and again before saving an advanced Run. Existing verification, local Git,
commit/push/PR and completion fences now also check the coordinator. Remote
verification checks before/after its existing transport request. Own synchronous
Task transitions explicitly acknowledge only their newly committed revision;
concurrent edits during awaits cannot acquire that acknowledgement. Known
completed advancement clears its mutation marker before notification-only work.

RED: all three locked-control/awaited-status/control-or-Task revision cases
advanced to COMPLETE on the old service. They now stop with the Run ACTIVE,
Task RUNNING and zero push/PR/cancel. Target Controller/personal loop passes
2 files/64 tests. Initial full gate exposed another legacy fixture that assigned
a standalone trial Session to a different canonical Run/worktree. It now creates
its real canonical workspace and Session with the same Run ID; every original
process-tree termination/cancellation receipt assertion remains. That lifecycle
suite passes 1 file/15 tests, including real owned descendant drain.
Final default `mise exec -- pnpm check` passes 114 files/1158 tests (40.77s test
phase); `git diff --check` passes. Logs:
`/tmp/dispatcher-cv08-worker-guard-red.log`,
`/tmp/dispatcher-cv08-worker-guard-green.log`,
`/tmp/dispatcher-cv08-worker-controller-target.log`,
`/tmp/dispatcher-cv08-worker-check.log`,
`/tmp/dispatcher-cv08-worker-physical-cancel-green.log`,
`/tmp/dispatcher-cv08-worker-final-check.log`.

Remaining safety work before activation: fail/cancel/pause/reroute/start and
startup recovery composition. R-010 is now the immediate next dependency:
advanceRun still awaits captureProfileResource and standalone usage is awaited
by the background loop. A slow read could occupy the new shared lane and delay
input. Separate passive execution-resource facts from usage collection and fence
late telemetry, then verify cancellation/input/lease independence. This is an
open integration limitation, not a passed nonblocking-metering Gate. No native
controls or real service/data were enabled. Rollback is 40f3232; original sources
are unchanged. Official quota checked after this unit; percentage in Linear.


## CV-06c / R-010 Controller nonblocking usage collection

Canonical and standalone usage collection now run outside business advancement
and its Session mutation lane. Canonical reads coalesce per Run with at most four
owned underlying reads. Versioned read state retains actual read-attempt counts,
backoff, last successful scope/time, terminal retries and unknown outcomes. It
uses the existing UsageObservationV1 ledger; no second billing ledger, historical
backfill, inferred native IDs or provider price evidence was introduced. A
complete account-period observation alone cannot finish a Run's collection.

Collector scope pins owning adapter, Run generation/lease, Session/invocation,
control revision/epoch, original Session account context and current credential/
native configuration fingerprint. A queued read rechecks before SDK entry and
cannot query through changed or non-AUTOMATED control. Late old-context results
are discarded with scoped diagnostic state. Historical sessions cannot borrow
new credentials. Shutdown closes admission first, records pending UNKNOWN and
fences every late callback; failure to persist shutdown metadata does not skip
physical service cleanup. Manual resource reads also stop waiting on shutdown.
Underlying read cancellation/remote disappearance is not claimed by a closed
consumer; uncertain producers stay separate from execution authority.

Codex/Qoder/CLI status snapshots retain execution-resource facts from already
owned lifecycle results. HTTP status facts and existing remote status projections
use the same bounded metadata shape. They do not wait for billing queries.
Native success can establish execution availability while remaining quota stays
unknown. Missing usage/price values are not zero. Devin no longer invents a full
remaining session balance when consumed usage is absent. Query failure/no data
records read diagnostics and probe backoff without declaring PROVIDER_DOWN.
Known old resource events retain their original observation time; they are not
refreshed into a new successful check. Existing explicit recovery/probe behavior
and the stale-evidence regression remain covered.

RED: all four pending-read/reply/cancel/lease and read-failure cases failed on the
previous Controller; two provider resource/unknown-balance cases, two late-source/
shutdown-state cases and the queued-source case also went RED. The lease fixture
was corrected to reach the existing five-minutes-left renewal threshold rather
than expecting renewal after one minute; its required renewal assertion stays.
The shutdown fixture captures IDs/facts before closing its database. Terminal
retry plus last-success scope checks pass. Initial lint rejected an inline import
type annotation; used the existing type import, without suppression. A full gate
then exposed an existing Qoder consumer omitting its event array; missing events
remain unknown instead of breaking its unchanged model-continuation assertion.
No old assertion/timeout was weakened or skipped.

Final rebuilt target passes 3 files/63 tests. Default `mise exec -- pnpm check`
passes 115 files/1169 tests (40.95s test phase); `git diff --check` passes. Logs:
`/tmp/dispatcher-cv06-controller-nonblocking-red.log`,
`/tmp/dispatcher-cv06-resource-separation-red.log`,
`/tmp/dispatcher-cv06-usage-lifecycle-red-2.log`,
`/tmp/dispatcher-cv06-queued-source-red.log`,
`/tmp/dispatcher-cv06-controller-final-check-2.log`,
`/tmp/dispatcher-cv06-final-target.log`,
`/tmp/dispatcher-cv06-final-all-check.log`.

R-010's Controller blocking path is locally resolved. CV-06 stays open for full
legacy-origin/attempt/time reconciliation, scoped account-quota TTL/UI and native
capability/real-account qualification. Cost engine/price precision remains CV-07;
this unit does not establish billing or native handoff evidence. R-005 still
requires fail/cancel/pause/reroute/start/recovery composition before activation.
Rollback is 26fa064 with its matching data; original workspaces/data unchanged.
Official quota checked after the unit; percentage recorded in Linear.


## CV-08k owned failure cleanup and HUMAN stop protection

Failure handling now validates current Task/Run/control authority before cleanup
and uses the Session mutation lane. It reuses the existing private Session stop
state and uncertainty flag; no parallel stop registry was added. A live local
adapter must report an attached owned handle. A saved terminal snapshot alone is
not termination evidence. Native-bound/executionRef runtimes remain unavailable
until their qualified session-scoped stop is composed; this path never kills a
shared native host.

Failure first retains unavailable capacity, then waits for the owning adapter's
confirmed stop. Only after rechecking the captured authority does it atomically
mark Run/Task FAILED. Unknown cleanup retains unconfirmed stop state and manual
reconciliation without blindly issuing another stop. Its own synchronous
unavailable Task transition updates only the revision it just committed;
concurrent edits during awaits are not acknowledged. Explicit cancellation now
checks the coordinator before revoking/aborting a known Session, and HUMAN control
requires explicit native cancellation confirmation rather than legacy stop.

RED: all four owned-drain/unknown-cleanup/HUMAN-failure/HUMAN-cancel cases failed
on the old service. The first adaptation correctly rejected its own unavailable
Task transition as stale; explicitly acknowledge that synchronous transition,
without loosening cross-await revision checks. Target passes 4 cases. Default
`mise exec -- pnpm check` passes 115 files/1173 tests (44.40s test phase), including
the original expiry/heartbeat/physical cancellation checks; no assertion or
timeout was weakened. `git diff --check` passes. Logs:
`/tmp/dispatcher-cv08-failure-cancel-red.log`,
`/tmp/dispatcher-cv08-failure-cancel-green.log`,
`/tmp/dispatcher-cv08-failure-cancel-green-2.log`,
`/tmp/dispatcher-cv08-failure-cancel-check.log`.

Still pending: final cancel/pause SDK callbacks, actor-bound cancellation intent,
priority drain of active verification on failure, reroute/start and complete
startup recovery. This increment does not open native cancellation/handoff UI or
claim provider stop proof. No live data/service was changed. Rollback is 13bf6f7
on the isolated branch, with its matching backup. Official quota checked after
the unit; percentage recorded in Linear.
