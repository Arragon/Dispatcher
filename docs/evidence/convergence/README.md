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
| CV-08 | continuation/worker/delivery/failure/cancel/pause Guard, failure priority drain, stop audit and read-only local start recovery qualification verified at 115/1204; ordinary local start composed; schema-8 writer increment verified at 116/1208; known-unsent cancellation/publication journal recovery verified at 116/1215; general guarded local recovery verified at 116/1218; captured reroute stage Guard and default Generic drain verified at 116/1224; shared guarded replacement startup and original owned-CLI cleanup verified at 116/1229; legacy/remote/qualified native recovery remain pending |
| CV-12 | pending complete selection/control integration |
| macOS service / LP / backup | MAC-01a CLI data-directory ownership verified at 117/1237; MAC-01b lifecycle/fixed definition verified at 117/1251; MAC-01c read-only doctor verified at 118/1264; MAC-01d structured logs/safe tail verified at 119/1273; MAC-01e offline DB backup/restore preparation verified at 121/1281; MAC-01f release closure/hash foundation + packaged asset fix verified at 122/1292; MAC-01g isolated offline staging + relocated package/PTY fixture verified at 123/1298; release binding/early stdio/upgrade/qualified restore activation and real evidence pending |
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


## CV-08l final stop and pause adapter admission

AgentAdapter cancel/pause now accept the same synchronous final admission hook
as send/resume. Codex, Qoder, Structured CLI and Generic CLI check before owned
stop or cancellation intent; LocalService checks again after pending input and
credential awaits, immediately before fetch. Rejected unsent HTTP cancellation
removes only its own in-memory stop intent. Mock and remote adapter transitions
forward the hook. Unsupported pause/cancel remains unsupported.

The original Generic late-start cancellation regression caught a moved stop
latch. Restore that latch after admission but before the detached-handle check,
so a late owned process is still stopped. No assertion or timeout was weakened.
RED: 5 new final-stop cases failed before implementation. Rebuilt target passes
3 files/52 tests including original late-start cancellation. Default `mise exec -- pnpm check` passes 115 files/1180 tests (40.50s test phase).
`git diff --check` passes. Official quota: 60% remaining, ordinary use allowed. Logs: /tmp/dispatcher-cv08-stop-adapter-admission-red.log,
/tmp/dispatcher-cv08l-target.log, /tmp/dispatcher-cv08l-final-check.log.

This is adapter admission plumbing only; Controller stop/pause composition and
qualified native stop remain open in R-005. No live data or service changed.
Rollback: 91b04b3 and its matching backup.


## CV-08m Controller final cancellation and pause Guard

Cancellation captures the semantic caller and complete Task/Run/control fence
before asynchronous dispatch. It revokes/aborts the original work before queuing
its owned stop, then checks the same fence at the adapter callback and after
stop/drain. Run and Task cancellation commit atomically only after confirmation.
The existing Session stopState persists unknown outcomes and blocks blind stop
retries. Known unsent admission rejection clears only its own pending stop;
opaque adapters that omit final admission cannot report confirmed cancellation.
Failure and stale-input cleanup also forward the final callback. Pause now uses
the mutation lane and final callback, validates the returned identity/state, and
rechecks before its atomic Run/Task update. HUMAN ownership blocks legacy pause.
Explicit cancellation permits stopping an expired original lease but never
permits continuation from it. Local native-bound stop remains closed.

Ruling: retain the existing Runner lease-revoke contract when an unknown legacy
start has no Controller Session ID. Shared cancel Guard accepts only the exact
unstarted:<runId> placeholder with no Session, binding or control row; all Task,
Run, lease, principal and zero-control fence checks still apply. It grants only
cancellation and waits for owning Runner acknowledgement. Full regression caught
this supported consumer, so it was preserved rather than bypassing authority.

RED: original implementation failed HUMAN pause and both late-control stop cases.
The initial new pause fixture incorrectly supplied the next revision to a CAS
writer; correcting that fixture then reproduced the intended stale-write failure.
Additional opaque-stop receipt failed before its callback proof was added.
Target personal-loop + physical lifecycle: 2 files/81 tests; remote + shared Guard:
2 files/36 tests. Existing async cancellation test wrappers now forward the new
callback; no assertion/deadline weakened. Default `mise exec -- pnpm check` passes 115 files/1187 tests (40.12s test phase).
`git diff --check` passes. Official quota after unit: 59% remaining, ordinary use allowed.
Logs: /tmp/dispatcher-cv08m-stop-red.log, /tmp/dispatcher-cv08m-pause-red.log,
/tmp/dispatcher-cv08m-stop-receipt-red.log, /tmp/dispatcher-cv08m-target.log,
/tmp/dispatcher-cv08m-remote-target.log, /tmp/dispatcher-cv08m-final-check.log.

Remaining: failure priority drain, legacy startup/reroute/recovery composition,
durable actor/fence metadata for stop audit, full qualified native stop and real
Gates. This increment supplies no real account/process GUI evidence. Source and
rollback: cb31c22 with matching data backup; original workspaces/data unchanged.


## CV-08n failure priority drain and Session stop audit

Failure now revokes its exact lease, fences advancement and aborts the original
owned verification command before waiting for the Session mutation lane. It
waits for adapter stop and owned command/advance drain before FAILED. Unknown
owned-command cleanup stays unavailable. Attention delivery is isolated from
the already committed failure result, so a notification error cannot relabel
confirmed cleanup unknown.

The existing Session authority now optionally retains stopIntent (actor, operation,
captured fence and requested time). Failure/cancel populate it before SDK stop;
DatabaseSessionStore retains it through adapter saves and restart. It is private
audit metadata, not a second stop registry or a native stop proof.

All four new cases failed before implementation and then passed. Personal-loop
and physical lifecycle target passes 2 files/85 tests. Default `mise exec -- pnpm check` passes 115 files/1191 tests (40.27s test phase).
`git diff --check` passes. Official quota checked after the unit; percentage recorded in Linear. Logs: /tmp/dispatcher-cv08n-failure-red.log,
/tmp/dispatcher-cv08n-failure-green.log, /tmp/dispatcher-cv08n-target.log,
/tmp/dispatcher-cv08n-check.log. No old assertion/deadline changed.

Rechecked all three source HEAD/status snapshots and all 11 WIP file SHA-256
hashes: unchanged. No original data/service touched. Rollback: cd2821a plus its
matching backup. R-005 remains open for start/reroute/recovery and qualified
native context/stop; no formal or real-provider Gate is closed.


## CV-08o read-only local start recovery qualification

Before wiring startup sending, the constructor barrier can recognize only this
Controller's exact unbound embedded start reservation: frozen selection, frozen
contract hash, marker, Session/profile/backend, invocation, lease/generation and
initial AUTOMATED revision/epoch 1, exclusion none. Native binding/executionRef,
legacy modelSelection, changed ownership, malformed/corrupt records and orphan
control remain blocked. Missing ACK adapter projection is rejected. Admission
performs no native call, retry or mutation replay.

InteractionCommand intentionally stores only its semantic hash. Reuse the
existing hash algorithm through a new read-only matchesCommand method, rather
than persisting private request input or calling reserveCommand as a probe.
The first helper assumed full semantics were persisted; inspection corrected
that assumption. The initial corrupted-Run-selection fixture was correctly
blocked by immutable selection enforcement; replace it with a conflicting
adapter projection to test recovery without disabling that safeguard.

Three positive boot cases failed before implementation. Final target passes
14 cases, including the unchanged four original fail-closed candidate cases and
seven corrupt certificate cases. Default `mise exec -- pnpm check` passes
115 files/1201 tests (41.73s test phase); `git diff --check` passes.
Official quota checked after unit; percentage recorded in Linear.
Logs: /tmp/dispatcher-cv08o-preflight-red.log,
/tmp/dispatcher-cv08o-preflight-green.log,
/tmp/dispatcher-cv08o-preflight-final-target.log, /tmp/dispatcher-cv08o-check.log.

This foundation does not yet switch ordinary dispatch to the guarded start
callbacks, recover owned process attachment or open native control. Those stay
in R-005. No source/live database or service changed. Rollback: 3709924 with its
matching backup.


## CV-08p ordinary local dispatch start composition

Embedded dispatch reserves the immutable Dispatcher Session ID, initial control
and native start receipt in its existing Task/Run reservation transaction. It
uses Scheduler's final sending/settlement callbacks; preparation cannot silently
acquire a new Task revision, control epoch, profile adapter or execution context.
SENDING is committed at final native I/O. The returned session/receipt and final
Task/Run projection must match the original authority. Source selection remains
ExecutionSelection. Native catalog and base execution fingerprints are distinct;
freeze the base context at reservation and retain the existing fresh catalog
preflight. Remote startup retains its owning-Runner contract for CV-12.

Ruling: a canonical comment changes Task revision just like another edit. The
approved strict revision requirement intentionally changes the prior startup
comment test: preserve the comment, return conflict, retain one UNKNOWN start and
manual unavailable capacity without automatic resend/cleanup of an uncertain
owner. Strengthen that regression with inbox/receipt/start-count checks. This is
an intentional behavior change, not weakened verification. Pre-create rejected
startup cannot overwrite a concurrent Task edit. Owned worktrees are retained
when a canonical Run reservation exists. Source preflight errors no longer
justify deleting a referenced worktree.

Three new start cases failed before implementation. Targets: local/start/recovery
3 files/108 tests; publication/real Git delivery/lifecycle 3 files/84 tests. The
full suite exposed a wrong base-vs-catalog fingerprint comparison; correct their
separate authority rather than weakening selection checks. Two OS-error fixtures
now supply actual ENOENT codes, retaining their original FAILED assertions. The
async Devin test backend honors the final callback after its gate; all original
capacity/delivery assertions remain. A new comment assertion initially used a
nonexistent persistence helper; it now checks the existing canonical inbox API.
Default `mise exec -- pnpm check` passes 115 files/1204 tests (41.05s test phase);
`git diff --check` passes. Official quota checked after unit; percentage in Linear.
Logs: /tmp/dispatcher-cv08p-start-red.log,
/tmp/dispatcher-cv08p-start-green.log, /tmp/dispatcher-cv08p-green-target.log,
/tmp/dispatcher-cv08p-publication-target.log, /tmp/dispatcher-cv08p-final-check.log.

Before activation, R-011 requires a new minimum-writer protocol so intermediate
protocol-3 binaries cannot write the upgraded candidate. Follow-ups: known-unsent
start cancellation, priority startup outcome/reconciliation, legacy adoption,
reroute, complete recovery and qualified native stop. No live database/service
changed; no native or A/B Gate closes. Source/rollback: eba4b2f with matching
pre-activation data backup, never an older binary against an incompatible DB.


## CV-04h guarded startup minimum writer (R-011)

Additive migration 8, guarded_controller_start_writer_protocol, raises the
connection/trigger protocol to 4 before ordinary local start activation. It
fences protocol-3 intermediate writers even when their SQLite connection is
already open; their old migration catalog also refuses the newer schema.
Migration entries 1–7 match 127910c byte-for-byte (array prefix SHA-256
78fd06a8e9fb6e5ac871333ae004e0a9e1fe901d6c1da63a24eeb9ff48e20b8a).

Interrupted upgrade and outer rollback restore both schema-7 trigger SQL and
connection writer 3. Snapshot writer detection follows exact schema/name: a
schema-7 backup remains writer 3, archive/source bytes stay unchanged, and only
its restored copy upgrades to schema 8 behind RESTORE_RECONCILIATION_REQUIRED.
No schema downgrade or trigger deletion bypass is used.

All four new regressions failed first; target passes 4 files/30 tests, including
older writer/backup regression cases. Existing default-schema assertions now
expect 8; old-version rollback and snapshot assertions retain their actual
versions. Default `mise exec -- pnpm check` passes 116 files/1208 tests
(40.87s test phase); `git diff --check` passes. Official quota checked after
unit; percentage recorded in Linear. Logs:
/tmp/dispatcher-start-writer-red.log, /tmp/dispatcher-start-writer-green.log,
/tmp/dispatcher-start-writer-check.log.

R-011's local gate gap is resolved; full branch review and real recovery/upgrade
remain open. Source/rollback: 127910c with the corresponding schema-7 backup;
never run that binary against schema 8. No live data or service touched.


## CV-08q known-unsent cancellation and publication journal recovery

A local RESERVED start now cancels in one Core transaction: validate the full
current fence, cancel the start reservation, revoke the lease, atomically settle
Run/Task, persist the existing scoped NATIVE_START_NOT_SENT cancellation proof,
and update existing publication/idempotency receipts. If an adapter projection
exists it retains the stop intent. No SDK call or mutation-lane wait is needed.
Ruling: this exception is a pure SQLite decision before any native send; the
RESERVED CAS and final SDK admission callback prohibit later creation. A failed
Task write rolls the whole durable decision back and keeps execution fenced.
A late proven-not-created receipt cannot overwrite an already cancelled intent.

Known no-send cancellation reports START_FAILED with a cancellation reason; a
sent startup's delayed acknowledgement still uses physical stop and keeps its
uncertain startup receipt distinct. Restart/idempotent commit cannot start it
again. Publication recovery now reads the command journal: reserved Session IDs
are not creation evidence, SENDING becomes UNKNOWN and detached ACK does not
prove a live process. The retained RESERVED journal can be explicitly cancelled
after recovery, using current authority and no SDK.

Initial new tests waited behind model precheck because their draft omitted a
reviewed account/model. Correct them to the existing explicit fresh-catalog
fixture. Replay corrected tests against e966596 source in the isolated worktree
and restore current source bytes in finally: both unsent/atomic rollback cases
then fail for the intended reasons; the sent-path regression already passes.
Strengthen rollback to compare complete Run/Task records and require the target
Task transition was actually attempted. Four controlled journal recovery cases
also fail before their fix. These are synthetic metadata/process fixtures, not
real crash/provider/GUI Gates. No old assertion or timeout was weakened.

New target: 7 cases; complete local/start/publication target: 3 files/160 tests.
Default `mise exec -- pnpm check` passes 116 files/1215 tests (40.57s test phase);
`git diff --check` passes. First full gate stopped at test type-import lint; fix
the imports without suppressions and rerun the whole gate. Logs:
/tmp/dispatcher-cv08q-atomic-red.log, /tmp/dispatcher-cv08q-atomic-green.log,
/tmp/dispatcher-cv08q-journal-four-red.log, /tmp/dispatcher-cv08q-full-green.log,
/tmp/dispatcher-cv08q-target.log, /tmp/dispatcher-cv08q-final-check.log.

Remaining: non-publication and failed-start recovery, atomic legacy adoption,
reroute/remote composition and qualified native stop/real Gates. No original
workspace/data/service changed. Source/rollback: e966596 and matching schema-8
backup; do not reuse a newer journal with an older binary without compatibility
review. Official quota checked after unit; percentage recorded in Linear.


## CV-08r qualified direct-Run startup recovery

After publication recovery, the constructor also reconciles qualified local
STARTING/ACTIVE journals without a publication record. It retains the exact
Run/Session/generation/lease and marks unknown process ownership unavailable with
manual policy, without native calls or replay. Stable waiting, verification,
delivery and remote/legacy unsupported journals retain their existing paths.
A sealed not-created FAILED receipt can finish its original queued Task when
Run projection previously succeeded but the Task write failed. Match the initial
control certificate and original queued revision; later edits stay unchanged.
This is past-fact projection even after expiry, never new lease/execution
authority. The completion is idempotent across another restart. Existing startup
cache/publication writes share saveStartupReceipts instead of duplicated logic.

Two new cases fail first (direct restart falsely live; failed Task projection
left queued), while the concurrent-edit preservation case already passes. Final
3 cases pass. The known-failure case also passes with a 24-hour expired lease.
Positive recovery-preflight tests now separately assert total_changes is
unchanged by qualification, then assert the constructor's intended unavailable
recovery delta and original identity. Original corrupt/foreign fail-closed tests
retain full unchanged-record assertions. No check/timeout weakened.

Targets: 4 files/166 tests including publication, physical Git/PR recovery and
legacy continuation; default `mise exec -- pnpm check` passes 116 files/1218
tests (45.70s test phase). `git diff --check` passes. Logs:
/tmp/dispatcher-cv08r-recovery-red.log, /tmp/dispatcher-cv08r-recovery-green.log,
/tmp/dispatcher-cv08r-target.log, /tmp/dispatcher-cv08r-expired-projection.log,
/tmp/dispatcher-cv08r-check.log.

This does not reattach native processes or open foreign/native binding/HUMAN
records. Atomic legacy adoption, reroute/remote composition, qualified native
context/stop and real recovery/soak remain in R-005/R-003/R-004. No original data
or service changed. Source/rollback: 4b3f634 with matching schema-8 backup.
Official quota checked after unit; percentage recorded in Linear.


## CV-08s captured reroute preflight and stopped-owner stage Guard

Reroute now captures the original Run/profile/Task/control fence before queuing.
The existing receipt lookup remains first inside execution, preserving idempotent
reads after authority changes. A new mutation must pass its captured Guard before
and after standalone refresh and again across delivery/stop awaits. Stop uses
the real actor and that original fence, acknowledging only its own synchronous
unavailable Task transition.

Post-stop reuse cannot use general reroute authority because the old Run is now
SUPERSEDED. A narrow coordinator guard requires its exact revoked lease, Task
revision/currentRun, unchanged AUTOMATED control, matching adapter invocation and
confirmed owned-stop receipt. Native bindings/executionRef, uncertain commands,
unconfirmed queues and external blockers remain rejected. Worktree restore
checks this stage again before replacement reservation. Dirty/untracked local
files stay intact when any authority check fails.

All four new queue/refresh/post-stop Task/control cases fail before the fix, then
pass. Full personal loop plus shared Guard passes 2 files/90 tests, retaining
original frozen-context, idempotent outcome and cancellation-race assertions.
Default `mise exec -- pnpm check` passes 116 files/1222 tests (40.59s test phase);
`git diff --check` passes. Logs: /tmp/dispatcher-cv08s-reroute-red.log,
/tmp/dispatcher-cv08s-reroute-green.log, /tmp/dispatcher-cv08s-target.log,
/tmp/dispatcher-cv08s-check.log. No assertion/deadline weakened.

Replacement start still needs the shared reserved-start path. Inspection of stop
status found R-012: Generic child status sets cancelled before owned group drain
finishes, unlike the Codex/Qoder/Structured close handlers that await drain
before terminal completion. Reproduce and repair this before further activation;
no provider/real-process Gate is claimed by metadata fixtures. Original data and
services unchanged. Source/rollback: a872c18 plus matching schema-8 backup.
Official quota checked after unit; percentage recorded in Linear.


## CV-08t Generic default owned-stop status barrier (R-012)

SpawnProcessExecutor no longer sets terminal cancelled on request. Its separate
cancellationRequested latch rejects stdin immediately, while status stays
nonterminal until OwnedProcessGroup drain and the outcome complete. Failed drain
stays unconfirmed/nonterminal. Outcome rejection remains observable to consumers
and is also safely observed when no result reader has attached.

Scope correction to the initial R-012 concern: Controller creates Generic with
its ProcessManager-backed executor, whose status already awaits its result. The
defect is in the exported default SpawnProcessExecutor; do not claim that the
Controller's ordinary path had this same early terminal report. Preserve and
regress both paths rather than replacing the safe executor.

Two controlled real-child tests hold/reject owned drain and fail before the fix.
They also retain immediate input rejection; cleanup releases only their own
spawned child through its original owned group. Existing physical descendant/
normal-completion/permission-uncertainty and legacy cancellation target passes
2 files/27 tests. Default `mise exec -- pnpm check` passes 116 files/1224 tests
(41.30s test phase); `git diff --check` passes. Initial full gate caught the test
this-alias lint; replace it with a scoped cleanup callback, without suppression,
and rerun the whole gate. No old assertion or timeout changed. Logs:
/tmp/dispatcher-cv08t-generic-drain-red.log,
/tmp/dispatcher-cv08t-generic-drain-green.log, /tmp/dispatcher-cv08t-final-check.log.

R-012's local default-executor defect is fixed; this does not qualify a native
provider/shared-host stop or formal A/B Gate. No live data/service changed.
Source/rollback: 3102d03 with its matching schema-8 backup. Official quota checked
after unit; percentage recorded in Linear.


## CV-08u shared replacement start and original owned-CLI cleanup

Ordinary local dispatch and same-Runner reroute now use one reservation helper:
fixed Dispatcher Session, actual attempt/generation/lease, initial control and
start receipt commit with the canonical reservation. The final SDK callback
checks the captured base execution context, ConfigPlan revision, adapter identity
and original Task/control frame. Reroute no longer creates an unguarded Session
or cancels whichever adapter row happens to match after a stale acknowledgement.

A narrow cleanup-start operation may stop only the original attached CLI under
its captured generation/lease/AUTOMATED epoch and exact start-command fence.
Other uncertain commands, native bindings/executionRef, detached handles and new
control owners remain closed. Final stop admission runs after adapter awaits;
requested/confirmed/unconfirmed stop evidence remains durable. Its owned wrapper
stop does not settle the native UNKNOWN start or grant a new session/capacity.

Three new replacement cases reproduce RED before implementation: missing receipt/
control at creation, Task drift during preparation still spawning, and HUMAN
control being cancelled after creation. They pass with two additional cleanup
cases for control change at final stop admission and detached handle. The old
comment-during-start expectation intentionally changes from no cleanup to exactly
one qualified owned stop; canonical comment/Task preservation and UNKNOWN/manual
Run assertions remain. Existing reroute stale-Task cleanup and lost-reply
idempotency assertions remain intact.

Target: 3 files/172 tests passed. Default `mise exec -- pnpm check` passes
116 files/1229 tests (41.87s test phase), including build/typecheck/lint/boundaries.
`git diff --check` passes. Logs: /tmp/dispatcher-cv08u-replacement-red.log,
/tmp/dispatcher-cv08u-target.log, /tmp/dispatcher-cv08u-check.log. No timeout,
skip or suppression added. Metadata/controlled SDK fixtures do not qualify a real
provider handoff/stop or A/B Gate. Source/rollback: 730bd3b with matching schema-8
backup. No live data/service changed. Official quota checked after unit; result
recorded in Linear.


## MAC-01a CLI data-directory ownership

The CLI acquires a dedicated `.controller-instance.sqlite` exclusive transaction
before constructing Controller or opening the business database for offline
config/doctor. The canonical directory resolves aliases; a conflicting process
fails closed before migration. Shutdown releases ownership only after successful
Controller stop, while constructor failure releases immediately. Kernel process
exit releases a crashed owner's lock without deleting a file, guessing PID
expiry or stealing ownership. This does not qualify direct library embedding or
older CLIs. No business schema/data or live service is changed.

Reuse: existing Node built-in SQLite, no new package or third-party code.
[SQLite's locking reference](https://www.sqlite.org/lockingv3.html) documents the
rollback-mode exclusive lock. First real child test caught a POSIX pitfall:
closing an extra descriptor to an existing inode releases that process's lock.
Creation now closes only its newly created descriptor before SQLite opens it;
existing files use lstat and SQLite alone. New regression verifies a rejected
same-process attempt does not lose exclusion against another actual process.

RED: missing module; initial implementation reproduces cross-process exclusion
failure, then all 8 cases GREEN: contention, crash, alias, same-process rejection
followed by another process, symlink preservation and CLI serve/doctor/config
rejection before touching sentinel business bytes. Target 3 files/12 tests.
First full check caught the required preserve-caught-error lint; attach narrow
cause without suppression. Final default `mise exec -- pnpm check` passes
117 files/1237 tests (41.70s test phase); diff check passes. Logs:
/tmp/dispatcher-mac01a-red.log, /tmp/dispatcher-mac01a-green.log,
/tmp/dispatcher-mac01a-target.log, /tmp/dispatcher-mac01a-final-check.log.

MAC-01 remains open: launchd lifecycle, stable deployment, bounded logs, offline
read-only doctor/upgrade/restore workflow and real login/sleep evidence pending.
Independent service development proceeds while qualified native/remote CV-08
activation remains closed per R-005. Rollback: fba8e9a and matching schema-8 data
backup; do not remove a possibly owned lock file. Official quota checked after
unit and recorded in Linear.


## MAC-01b fixed launchd definition and safe lifecycle

Reuse the existing per-user launchd adapter/CLI, no package addition. Plists now
bind absolute paths/WorkingDirectory, explicit safe PATH/umask, RunAtLoad,
SuccessfulExit=false with ThrottleInterval=30 and ExitTimeOut=60. Managed worktree
and temporary runtime paths are rejected. CLI can select --cli-path for an
existing stable release; it does not copy/build a release at install time.

Installation publishes a complete mode-600 plist without overwriting an existing
definition. Matching reinstall/start never uses kickstart -k. A differing file
requires reviewed upgrade; failed bootstrap retains evidence without blind
bootout. Stop checks loaded plist ownership, persistently disables, boots out,
waits for the reported Controller PID and checks the data lock. Restart and
uninstall depend on that confirmed stop. A manually started Controller blocks
restart. Non-install CLI commands decode the installed definition through native
plutil rather than select logs/data from cwd. Status returns only selected
metadata, never raw launchctl environment output; command errors are bounded and
classified by typed exit status, not message substring.

Sources: [Apple launchd guide](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
and this host's `man launchctl`/`man launchd.plist` for disable persistence,
kickstart -k, SuccessfulExit, ThrottleInterval and ExitTimeOut. Read-only
`launchctl print gui/501/dev.dispatcher.controller` confirmed absent, exit 113;
no host lifecycle mutation was run. A temporary generated plist with Chinese,
spaces and ampersand paths passes real /usr/bin/plutil lint and JSON decode
roundtrip on darwin/Node v24.21.0. This is parser evidence, not service evidence.

RED: 13 new/updated lifecycle assertions fail against the prototype. GREEN:
17 lifecycle/definition cases, plus instance/CLI target 3 files/26 tests. Full
default `mise exec -- pnpm check` passes 117 files/1251 tests (42.12s test phase);
diff check passes. Logs: /tmp/dispatcher-mac01b-red.log,
/tmp/dispatcher-mac01b-green.log, /tmp/dispatcher-mac01b-target.log,
/tmp/dispatcher-mac01b-check.log. Existing KeepAlive=false and blind-replacement
expectations intentionally change to the approved daily-service behavior.

MAC-01/R-013 remains open for release staging, bounded/redacted logs, doctor,
upgrade/rollback/recovery and actual login/sleep/Keychain/Agent evidence. Rollback:
ce3f292 plus matching schema-8 data backup; preserve current installed plist and
never restore it over a loaded unknown owner. No live service/data changed.
Official quota checked after unit and recorded in Linear.


## MAC-01c genuinely read-only diagnostic CLI

Reproduced the old doctor on a disposable schema-5 fixture: exit 0 silently
upgraded it to schema 8 and changed its bytes. Doctor no longer constructs
DispatcherDatabase/ConfigurationEngine, initializes a missing directory or takes
execution/writer ownership. It reuses persistence inspection and recovery
inventory readers, reports schema/upgrade/integrity/barriers/aggregate counts,
and always keeps executionReadiness=not-assessed. Unknown/future/corrupt or
attention-required sources remain unresolved; no provider/lease/control writes.

A first readOnly implementation still failed five full-file-set preservation
assertions because SQLite created WAL/SHM beside the source. Keep those failures:
all SQLite reads now use a private mode-700 temporary main/WAL copy, mode-600
files, no-follow source descriptors and a 256 MiB/file limit. Source identity,
size, nanosecond mtime/ctime and WAL/journal set must remain stable through copy.
Changed/busy sources fail closed; only the newly owned temporary directory is
removed. Raw source descriptors belong in this separate CLI process, never in a
process holding business SQLite locks. This does not alter the shared online
backup implementation or claim its complete recovery Gate.

Fourteen doctor cases plus existing instance/launchd checks pass 3 files/38 tests:
schema 3/5/7/8 preservation, no initialization, archive/restore barriers, unsafe
symlink, corrupt data, metadata-change fault, rollback journal, future schema,
committed WAL via a real CLI child and diagnosis while the data lock is held.
All source files use hash comparisons, including WAL/SHM, without dumping data.
The prior CLI doctor lock-rejection case intentionally becomes read-only active
diagnosis; serve/config still reject before business opening. No expectation
about source-byte preservation was weakened.

Default `mise exec -- pnpm check` passes 118 files/1264 tests (41.91s test phase);
diff check passes. Initial lint caught inline import types in the fault-injection
test; use explicit type imports, no suppression. Logs:
/tmp/dispatcher-mac01c-doctor-red.log, /tmp/dispatcher-mac01c-doctor-green.log,
/tmp/dispatcher-mac01c-target.log, /tmp/dispatcher-mac01c-final-check.log.
Three original source HEAD/status sets and all 11 WIP hashes rechecked unchanged.
No original database opened and no live service mutation. MAC-01/R-013 remains
open for logs, staging/upgrade/recovery and true service evidence. Rollback:
58ec710 and matching schema-8 data backup. Official quota checked after unit and
recorded in Linear.


## MAC-01d bounded Controller structured logs and safe inspection

Reuse the existing Runner BoundedLogWriter, with no package addition. A RED
regression proves its former total-budget scan deleted an unrelated user-notes.log;
retention now owns only its explicit stream family. No-follow regular-file writes
reject substituted targets. Single retained-file and total<file budgets are also
bounded. Existing stdout/stderr sharing, owned process/PTY/drain and verification
regressions remain intact.

Controller accepts a destination on its existing redacting logger. New launchd
definitions bind --log-dir to their private runtime subdirectory, whose structured
logs use four 256 KiB files / 1 MiB total. Runtime failure paths write sanitized
metadata there. Each structured record is re-redacted and written separately; an
oversized batch RED reproduces lost following records, then too-large entries
become LOG_ENTRY_TOO_LARGE. Unknown unstructured entries are withheld. CLI logs
reads at most 64 KiB/100 lines by default, capped options, no-follow regular files,
full record parsing and redaction before display. Old six-argument plist reading
is retained; new eight-argument definitions bind the exact log path.

Target passes 3 files/39 tests, including Controller HTTP behavior/redaction,
whole-file budget, stored JSON secret filtering, partial/raw record withholding,
symlink preservation, oversized batch continuation and existing physical process
checks. Final default `mise exec -- pnpm check` passes 119 files/1273 tests
(42.00s test phase); diff check passes. Real macOS plutil lint/Unicode+space+XML
JSON roundtrip and new runtime-log argument verification pass without launchctl
mutation. Logs: /tmp/dispatcher-mac01d-red.log,
/tmp/dispatcher-mac01d-oversize-red.log, /tmp/dispatcher-mac01d-final-target.log,
/tmp/dispatcher-mac01d-final-check.log. Initial oversize fixture was over-redacted
into a short token; use spaced text to reproduce actual byte truncation, keeping
secret assertions intact. No deadline/skip/suppression added.

MAC-01/R-013 stays open: launchd's raw early stdout/stderr descriptors are outside
this structured writer, so its retention and pre-import failure evidence still
need completion. No renaming/deleting open launchd files to pretend they rotate.
Release staging, upgrade/rollback/recovery and real service Gates remain pending.
R-006 wording corrected after repository inspection: persistence backup/restore
functions exist; Controller HTTP backup/restore routes are not currently wired.
No live data/service changed. Rollback: 1eb4056 with matching schema-8 backup.
Official quota checked after unit and recorded in Linear.


## MAC-01e offline database backup and restore preparation

Add CLI backup/restore using the existing persistence archive/checksum/manifest/
barrier functions. Backup validates an existing source, takes its data-directory
ownership, uses the same stable private main/WAL copy as doctor (backup limit
2 GiB/file), then creates a verified archive. It explicitly reports database-only,
secretStoreIncluded=false and nativeStorageIncluded=false. Source schema/bytes
remain unchanged. Restore defaults to preview; --execute --confirm prepares only
a new target behind filesystem + database barriers. It does not reconcile, clear
UNKNOWN, start Controller or replay external effects.

Move the existing instance-lock primitive into persistence so both CLI and restore
share one implementation. New-target restore must win that lock after mkdir and
before any staging/barrier write. If another Controller wins the interval, no
records or marker overwrite its files. No migration entry changes; the complete
migration-array segment is byte-identical to 6c37615 (checksum printed in local
verification output). Snapshot copying is factored only for its two real readers.

Seven app/actual CLI cases cover old-schema/hash preservation, archive refusal by
normal binary, active-owner rejection/no bundle creation, missing-source no-init,
preview/confirmation, copy-only upgrade + both barriers, original-directory
refusal and checksum tampering. A separate persistence boundary race confirms
competing ownership and preserves its uncommitted file. Initial race test failed
to enter its hook: the target was /var while newDirectory canonicalized it to
/private/var. Move it to the persistence source test, canonicalize the fixture
and retain an explicit ownership-installed assertion; no protection assertion
was removed. CLI subprocess tests exercise the compiled consumer separately.

Target passes 6 files/51 tests. Default `mise exec -- pnpm check` passes
121 files/1281 tests (41.71s test phase), including original native migration/
writer/rollback cases; diff check passes. Logs: /tmp/dispatcher-mac01e-red.log,
/tmp/dispatcher-mac01e-race-green.log, /tmp/dispatcher-mac01e-final-target.log,
/tmp/dispatcher-mac01e-check.log. No new dependency, schema downgrade, trigger
removal, test timeout/skip/suppression or live service/data mutation.

MAC-01/R-006/R-013 remain open for qualified restore reconciliation/activation,
full native/credential recovery, early raw stdio, stable staging/upgrade/rollback
and real macOS drill. A prepared blocked copy is not A acceptance. Rollback:
6c37615 with its matching schema-8 backup; retain all source archives and barriers.
Official quota checked after unit and recorded in Linear.


## MAC-01f release closure preflight and packaged Web ownership

Controller now resolves its default HTML through the existing Web package's
index.html export, keeping one owner in development and deployment. A disposable
injected package reproduced READY=200 but home=404 with the old relative path;
updating only the consumer/provider in that owned probe yields HTML=200 and
READY=200. This is controlled package evidence, not real browser/native A Gate.

Release foundation records complete relative files/links, SHA256/modes, source
commit, exact Node/host and schema/writer metadata, explicitly labeling isolated
package-fixture smoke. Verification rejects escaping/absolute/broken symlinks,
shared hardlinks, substituted runtime roots, persisted/credential files, changed
content or unfinished preparation. Owned inactive hardlinks can be detached
without changing their source bytes. No release command/activation is claimed yet.

Reuse evaluation: [pnpm deploy](https://pnpm.io/cli/deploy) is the existing mature
workspace deployment boundary; no new dependency. Local pnpm 11.19 help confirms
legacy and injection options, rather than assuming newer documentation defaults.
Real --legacy --prod --offline probe still escaped to this worktree. Per-command
injection removes symlink escapes but left 647 hardlinks; detachment then validates
6133 entries / 119062331 bytes, zero escaped symlinks/shared hardlinks. Both are
unqualified disposable probes (not frozen releases), never installed.

Deploy also changed this candidate's ignored pnpm dependency-state cache so a
subsequent ordinary command tried production-only auto-install. One RED diagnostic
bypassed that auto-repair only; it is not Gate evidence. Ordinary `pnpm install
--frozen-lockfile --offline --prod=false` restored development state without
changing tracked files. Plain default checks run again successfully. Future
staging must perform deploy inside its own workspace snapshot, not this source
node_modules. Original three candidates were not involved in either probe.

New foundation target: 2 files/16 tests; eleven file/ownership cases include
relocation, later source-hardlink mutation, external/absolute links, foreign root,
state material, added/tampered files, pending marker and mismatched host. Default
`mise exec -- pnpm check` passes 122 files/1292 tests (44.27s test phase), diff
check passes. Initial cleanup failed no-unsafe-finally lint; use owned temporary
rm(force), no suppression. Logs: /tmp/dispatcher-mac01f-deploy-probe.log,
/tmp/dispatcher-mac01f-deploy-injected.log,
/tmp/dispatcher-mac01f-dev-deps-restore.log,
/tmp/dispatcher-mac01f-manifest-red.log,
/tmp/dispatcher-mac01f-helper-target.log,
/tmp/dispatcher-mac01f-helper-final-check.log.

MAC-01/R-013 stays open for isolated stager, relocated actual package/PTY smoke,
verified release binding, early stdio, upgrade/rollback/recovery and real service
Gates. No original data or host service changed. Rollback: 1412af3 with matching
schema-8 backup. Official quota checked after unit and recorded in Linear.


## MAC-01g isolated offline staging and a fixed package candidate

Add stage:controller using existing pnpm deployment. It requires committed clean
source and a new output directory, builds normally, then copies only tracked
package source/manifests plus compiled dist into a private workspace. Source
node_modules/cache, .npmrc and persisted state are excluded. Deployment runs
offline with per-command workspace injection inside that workspace, verifies
the source dependency-state hash stayed unchanged, detaches hardlinks and moves
the entire runtime before an isolated package smoke. Only successful completion
creates/verifies release.json; preparing/failed markers remain closed.

Five copy/source tests verify tracked+compiled copying, cache/data exclusion, no
shared inode, existing-target preservation, build-state rejection, traversal and
dirty-checkout preservation. Add a failed-marker qualification regression. Target
2 files/17 tests, default `mise exec -- pnpm check` 123 files/1298 tests
(42.25s test phase); diff check passes. Logs: /tmp/dispatcher-mac01g-target.log,
/tmp/dispatcher-mac01g-final-target.log, /tmp/dispatcher-mac01g-final-check.log.

Freeze code at 82a4f26184e802e35287baf62a5a2731f7d6f243, then run the real stage
command in /tmp/dispatcher-mac01g-stage.log. Verified local candidate:
/Users/wangdongxin/.local/share/dispatcher/releases/82a4f26184e802e35287baf62a5a2731f7d6f243
(entry runtime/dist/cli.js, manifest release.json). It contains 5983 inventory
entries / 116905523 bytes, no escaping links/shared hardlinks, exact Node
/Users/wangdongxin/.local/share/mise/installs/node/24.21.0/bin/node. Moved-runtime
HTML, referenced JS asset, authenticated diagnostics and a real PTY subprocess
pass on darwin/arm64; schema 8/protocol 4. The source dependency-state file hash
is unchanged across isolated deploy. Independent verify also passes in
/tmp/dispatcher-mac01g-release-verify.log. All 11 source WIP hashes rechecked
unchanged. No original database opened or host service installed.

Evidence scope stays isolated-package-fixture, nativeProviderVerified=false.
This is one actual fixed runtime candidate, not A acceptance or real Codex/
launchd/login/Keychain/restore proof. Install/start must still bind its verified
manifest; early stdio, upgrade/rollback and qualified restore activation remain.
Code/rollback source: daf6750 with matching schema-8 backup. Keep the qualified
82a4f26 directory immutable; this evidence-only update does not change its code.
Official quota checked after unit and recorded in Linear.


## MAC-01h release identity and pre-database startup admission

Code frozen at 3dc0e008979b7f769f401ab101c9f6981b5a3514. Manifest v2
records packaged runtime-contract admission v1. New service install requires a
verified source/release/exact Node/CLI binding; start/restart reverify it before
launchctl mutation. Serve rejects partial/stale pins before ownership or database
construction. Stop/status/logs remain available for a damaged artifact. V1 remains
inspectable, never silently promoted. Plist pin decoding is strict and roundtrips
through native plutil. No extra compatibility layer, secret, schema or dependency.

New cases RED before implementation (including legacy admission mistakenly
accepted), target 4 files/45 tests. Default `mise exec -- pnpm check` passes
124 files/1309 tests (43.03s test phase); diff check passes. Logs:
/tmp/dispatcher-mac01h-red.log, /tmp/dispatcher-mac01h-legacy-red.log,
/tmp/dispatcher-mac01h-final-target.log, /tmp/dispatcher-mac01h-check.log.

Actual stage at /Users/wangdongxin/.local/share/dispatcher/releases/3dc0e008979b7f769f401ab101c9f6981b5a3514
contains 5983 inventory entries/116918623 bytes, source cache unchanged,
relocated HTTP/assets/API/real PTY and CLI admission smoke passed. Separate
actual staged serve probe: home=200, ready=200, SIGTERM exit=0, ownership released;
native plutil release pin roundtrip passed. Evidence: /tmp/dispatcher-mac01h-stage.log
and /tmp/dispatcher-mac01h-bound-probe.log. Probe used an owned temporary database
and fixture owner token; cleaned only its child/directory. Host launchctl
mutations=0, nativeProviderVerified=false. All source candidate data untouched.

MAC-01/A remain open: early raw stdio, upgrade/rollback, qualified full restore
and real host/login/sleep/native Gates. Rollback code 9180f92 with matching schema-8
backup; retain source artifacts. Official post-unit quota: 41% remaining; continue.


## CV-07a exact decimal cost engine

Reuse source a499d84 packages/domain/src/metering.ts and its cost assertions;
adapt directly to canonical UsageObservationV1 instead of installing legacy
UsageMeasurement/RunModelSelection as a second authority. Share domain decimal
parsing/formatting with the existing Controller ledger. Amount/rate/multiplier
math uses reduced BigInt fractions, final scale 18 half-up once; record formula,
inputs, price snapshot, completeness, missing dimensions and rounding. No provider
SDK, static rate, new dependency or schema.

Twelve mathematical/provenance tests preserve old per-1k/per-1M, multiplier/final
rate, separate cached-input, conditional free/base-consumption and partial/missing
semantics; add cache writes/inclusion, conflicting replay, replaced snapshots,
later deltas, overlapping scopes, mixed sources/generations, >JS-safe amounts,
final-only rounding, mixed currency/overlap/actual billing-time segmentation,
validity and invalid decimals. Explicit excluded cache requires separate scoped
source evidence; absent includedIn is not false. Session/account facts are not
billed as Run usage. Collection/observation time is never promoted to billing time.

Initial missing module RED, then 2-file/17-test target. Default full check passes
125 files/1321 tests (44.09s test phase), diff check passes. Logs:
/tmp/dispatcher-cv07a-red.log, /tmp/dispatcher-cv07a-target.log,
/tmp/dispatcher-cv07a-check.log. Initial lint/type errors fixed without suppression.
This is pure-engine/local-ledger reuse only: CV-07 stays In Progress pending
legacy decimal/provenance bridge, authoritative price admission, Controller/UI
wiring and real billing evidence. Existing API still correctly says unavailable
without a baseline. Rollback e239e75, matching schema-8 backup; no live data change.


## MAC-01i discard unstructured launchd streams

New service definitions route raw stdout/stderr to /dev/null, including failures
before app imports/logger construction. This closes the unbounded launchd file
path without a competing lock/wrapper/rotator. Bounded redacted structured logs
still use the fixed --log-dir. Parser derives the log owner from that argument,
rejecting mixed discard/file definitions and invalid runtime paths. Legacy six/
eight-argument definitions remain inspectable; no installed file is rewritten.
CLI logs explicitly reports RAW_STDIO_NOT_RETAINED or LOG_NOT_CREATED; early
failure diagnosis uses selected launchd status, read-only doctor and release verify.

Regression RED then target 2 files/30 tests; default full check passes
125 files/1323 tests (43.21s test phase), diff check passes. Native plutil lint
and real parser roundtrip confirm both /dev/null paths and fixed structured
directory. Logs: /tmp/dispatcher-mac01i-red.log, /tmp/dispatcher-mac01i-green.log,
/tmp/dispatcher-mac01i-check.log, /tmp/dispatcher-mac01i-plutil.log. Only an owned
temporary plist was created/removed; no host launchctl mutation or live data.
MAC-01 remains open for upgrade/rollback/full restore/native Runner stream and
real service Gates. Rollback 6b1eb80 with matching schema-8 backup; old service
definitions remain preserved. Official quota checked after unit; continue above10%.


## CV-07b historical pricing and lossless legacy numeric projection

Add an explicitly named legacy-pricing-snapshot-v1 reader for source a499d84
PricingSnapshot. Preserve raw private source and record identity, keep omitted
fields absent, expand only safe stored numeric representations to decimal strings,
and retain LEGACY_PRICE_ADMISSION_UNPROVEN/STORED_NUMERIC_PRECISION_ONLY. No
current account/model/price provenance is inferred and no historical event is
written into the canonical ledger. Reuse the existing legacy usage numeric reader
through the directly related domain decimal helper.

The compatibility number projection exists only when exact decimal -> stored JS
number representation -> decimal roundtrips unchanged. Large unsafe integers,
extra fractional precision, negative/nonfinite rates and malformed validity are
refused. Five new RED→GREEN cases include old formula 0.135 equivalence using
explicit fixture units, exponent expansion, immutable source and missing facts.
Target 3 files/22 tests. Default full check passes 126 files/1328 tests (39.73s);
final whitespace-only cleanup and diff check pass. Logs:
/tmp/dispatcher-cv07b-red.log, /tmp/dispatcher-cv07b-green.log,
/tmp/dispatcher-cv07b-check.log. No dependency/schema, API display or data migration.
CV-07 still pending authoritative billing admission/Controller/UI and real account
evidence. Rollback 2f47f70 with matching schema-8 backup. Official quota checked.


## CV-09a qualified native access descriptions

Port committed a499d84 native-access.ts and its entire 24-case suite unchanged.
Separate trusted registrations, exact URL allowlist, scope/profile/store identity,
viewer/Runner host and UI-roundtrip evidence are all required for exact session
entries. Project/application entries retain explicit labels. Unknown redirects,
pairing/credential URLs/argv, shells, foreign hosts/workspaces and missing proof
fall back to bounded sanitized instructions. Resolver/validator describe only;
they never launch, resolve credentials, follow URLs or contact native accounts.

Missing module RED then 24 cases GREEN. Default full check passes 127 files/1352
tests (43.26s), diff check passes. Logs: /tmp/dispatcher-cv09a-red.log,
/tmp/dispatcher-cv09a-green.log, /tmp/dispatcher-cv09a-check.log. Core/runtime/UI
composition and real native clients still pending; no live entry enabled.
Rollback 4a7737e with matching schema-8 backup. Full source modules/tests retained
without skips or rewritten expectations; no dependency/schema changes.

Additional informational baseline: existing `pnpm benchmark -- --scenario smoke
--duration 5` exercised the real Controller fixture at source 4a7737e; five samples,
CPU average 10.02%, RSS max116408320B. This includes cold startup, is marked
informational and does not pass idle CPU/soak Gate. Report remains ignored under
.dispatcher/benchmarks/2026-10-21T01-03-00.190Z-smoke.json and command output
/tmp/dispatcher-cv13-smoke.log. No real provider/browser/launchd evidence implied.


## LP directory-picker process drain and blocked native GUI probe

Actual Controller/native picker probe at 028c7db created only its own temporary
data/repository and two osascript children. CUA explicitly reported HOST_LOCKED
and automatic unlock unavailable. Both test selection requests were cancelled
through the real API, not by native UI; both ended cancelled with unchanged
configuration revision and Task count. Owned Controller/osascript children exited
and the owned temporary directory was removed. Native dialog selection/cancel and
Chinese/space-path GUI acceptance remain UNVERIFIED. No prompt to unlock blocks
independent development. Evidence /tmp/dispatcher-native-picker-result.json and
/tmp/dispatcher-native-picker-probe.log; never count this as GUI/A acceptance.

Native dialog execution now uses the existing OwnedProcessGroup. Cancel/timeout/
oversized output wait for owned group absence and callback close before completion;
late paths are discarded. Failed drain reports NATIVE_PICKER_CLEANUP_UNKNOWN and
blocks another dialog. Output stays bounded16KiB and failures never expose raw
stderr. StringDecoder preserves multibyte UTF-8 across pipe chunks; a new real
child fixture first reproduced corrupt Chinese path before that correction.

Five added cases RED→GREEN: delayed TERM/cancel/physical absence, pre-abort and
output bound, native cancel vs valid path, split UTF-8, cleanup-unknown latch.
Target2 files8 tests; default full check128 files1357 tests (43.33s), diff check
passes. Logs /tmp/dispatcher-lp-picker-red.log, -utf8-red.log, -unknown-red.log,
-final-target.log and -check.log (same prefix). The initial Promise.withResolvers
compile failure was corrected to existing project-compatible promises, without
changing tsconfig or weakening checks. No data/schema/dependency or host service
change. Rollback028c7db with matching schema8 backup. R-002 stays open for unlocked
real GUI evidence. Official quota checked after unit.


## CV-11a A-stage read-only native Session summary

Port a499d84 native-session-view.ts read semantics to canonical ExecutionSelection,
existing Run runtime-model facts and InteractionStore. Share RunNativeSessionView
as a pure domain DTO and append nativeSession to the existing authenticated Run
response; no extra route/selection/control authority. It reads stored metadata,
checks exact Session/Run/binding/control epoch, marks stale/future/mismatched
observations unknown and never queries an Adapter/native service or writes SQL.
MutationAvailable stays false; no native write operation or actual entry enabled.

TaskDetail reuses that response for a scoped read-only section: requested model/
effort and last native reported model are distinct, identity/control/observation
state and diagnostic versions remain visible, missing facts stay unknown. New
component has no fetch, native URL, launcher or command button. Stored native
credential/domain metadata stays private. Directly required redactNativeText
helpers are ported from a499d84, preserving safe opaque IDs/workspace paths while
withholding short credentials and native auth directories. Existing global log/
redactValue semantics are unchanged in this unit.

New missing modules/helper RED, then 3 files10 tests GREEN: zero SQL/native side
effects, auth, separate requested/reported, stale/future/epoch/ownership conflict,
unknown/deleted UI and native credential filtering. Default full check131 files/
1367 tests (42.96s), diff check passes. Initial exact-optional fixture/type errors
were fixed without suppression. Logs /tmp/dispatcher-cv11a-red.log,
-redaction-red.log, -ui-red.log, -target.log and -check.log. No dependency/schema,
real provider/account or GUI acceptance. Source test file has broader native
history/control routes not yet composed; retained in a499d84, not silently skipped.

This is the A-allowed CV-11 subset. Full CV-09/10/11 and R-003/R-015 remain open
for qualified drivers/history, handoff/reclaim and real client evidence. Rollback
903a1d7 with matching schema8 backup. Official post-unit quota checked.


## A real Codex file/required-verification/REVIEW evidence

Source 9e07caed9c492e75341abfc27d40e81693cf5a74. Installed packaged CLI
0.163.0-alpha.10.2 login status authenticated, no credential contents printed.
All11 frozen source WIP hashes rechecked unchanged. First two disposable probes
were preflight-rejected (scope under CODEX_HOME), zero native starts and zero
Task creation; artifacts retained. No policy bypass. Corrected probe uses a new
independent .local/share/dispatcher/provider-probes directory, original Controller
data untouched. Real CodexCliBackend, ConfigPlan, publication preview/commit,
managed worktree and registered required command were used, no mocked provider.

Report: /Users/wangdongxin/.local/share/dispatcher/provider-probes/2026-10-21T01-20-30.588Z/probe-report.json
Run9ebd4b90-cc6b-4ca1-8854-5cd388f89b19; native Session
01a15c0b-db14-70d2-9d3f-197541461f42. Exactly1 real start, owned cwd under the
probe data/worktrees, model/effort both explicitly omitted as native-default.
evidence.txt exact expected content, required probe-required PASSED, Run COMPLETE,
Task REVIEW and run-result persisted; source repository clean. Controller stopped
confirmed by its own cleanup. Probe database and dirty managed worktree retained;
no acceptance, commit, push or cleanup of candidate files. Command log:
/tmp/dispatcher-real-codex-probe-3.log.

This proves only real native-default file execution -> required verification ->
REVIEW via isolated Controller API. Browser GUI, explicit model/effort/native
reported selection, same-session reply, actual cancellation, restart replay,
launchd/login/sleep, recovery and human acceptance remain open. The v3 TaskActions
currently lacks the legacy local manual-accept/candidate-binding flow; next local
implementation must port that behavior into the canonical Task/Run entrypoint
before A can be called usable. Never transition this real probe to DONE on behalf
of human acceptance. A/B and formal LP/CV Gates remain open.

An existing benchmark audit also found lifetime ps%CPU averaging, missing-sample
zero fallback, and 100ms cleanup without confirmed child exit. R-004 retains this
instrumentation work before idle/soak acceptance; prior smoke remains informational.
Official quota checked after this real-provider unit, no quota reset consumed.


## CV-12a result candidate and verification snapshot primitives

Port a499d84 WorkspaceCandidate capture/identity checks, git-inspection and
VerificationSnapshots into the existing WorkspaceManager. Candidate capture
binds managed root inode/path, source Git common directory, branch/HEAD, scope,
tracked diff and bounded no-follow untracked contents. A restarted manager can
inspect the same retained worktree. Existing private-path policy runs first.
Unknown filters/partial clones/submodules fail closed before status/diff.

Snapshots retain a separate Git tree/commit and detached directory; original
execution index stays unchanged. Content/root/common-directory/HEAD/remote/source
authority are rechecked, failed/mutated or over-capacity snapshots are retained.
Eight new RED→GREEN cases include changed candidates, source/branch/scope denial,
filter no-execution, immutable retained content, index preservation, mutation/
capacity and revoked authority. Two additional REDs reproduced inherited GIT_DIR/
GIT_WORK_TREE identity interference and post-checkout hook execution. New
inspection environment clears inherited Git overrides; all snapshot Git calls
disable checkout hooks/fsmonitor and preserve optional-lock avoidance.

Target2 files11 tests; default full check132 files1375 tests (43.54s), diff check
passes. Logs /tmp/dispatcher-cv12a-red.log, -git-red.log, -target.log, -check.log.
No new dependency/schema or source-candidate mutation. API/Run result proof,
manual acceptance/receipts and v3 UI are next; these primitives alone do not
complete LP/CV-12/A. Rollback ccb0fb7 with matching schema8 backup. No actual
provider or original data involved in fixture tests. Official quota checked.


## CV-12b canonical local verification and acceptance service

Adapt a499d84 local-results.ts behavior to one canonical Run/Task service; no
legacy /api/local creation/result entrypoint is mounted. Shared pure DTOs name
Task revision, generation/retired lease identity, control epoch/revision, candidate
and verification receipt. Ordinary guarded local delivery.none only: exact
ACKNOWLEDGED start certificate, COMPLETED adapter, AUTOMATED unchanged control,
no pending native commands, frozen contract/registered required commands, current
profile/repository context and currentRun must match. Legacy/advanced native or
remote control stays unqualified, never adopted from current configuration.

Explicit verification preserves a retained content snapshot and uses the existing
registered commands in the managed source environment; before/after source and
snapshot fingerprints must match. Evidence basis is matching-managed-source,
not hermetic snapshot execution or native quiescence. This preserves existing
verification environment/dependency behavior. Failed commands/candidate/context
changes produce no accepting proof. Historical Run verification is retained.

Verification receipt/current pointer reserve before async work, identical active
requests join once, lost SENDING/UNKNOWN never replay with either old or new key.
Known failures permit another explicit verification. Acceptance compares retired
lease identity without lease renewal/native input, requires confirmed current
proof/Task/control/candidate and transacts DONE+acceptance+idempotency receipt
atomically. Exact replay returns the original acceptance fact; changed replay
conflicts. Close aborts owned verification and refuses confirmed cleanup on an
unknown process outcome. All request fields are captured before awaits.

Seven new cases: successful verification/one acceptance/replay/one native start,
changed candidate, authority/confirmation/control fences, coalescing/lost-SENDING,
failed required command then explicit correction, Task change while verifying,
and transactional acceptance rollback. Initial missing module RED; a fixture
used an unsupported handoff for exclusion.none, corrected to the supported
conflict event without weakening control transitions. Default full check133
files1382 tests (47.41s), diff check passes; target7 tests11.61s. Logs
/tmp/dispatcher-cv12b-red.log, -target.log, -check.log.

This service is not yet mounted in production API/UI; next unit wires canonical
result/reverify/accept/cancel and lifecycle. No new schema/dependency, public
secret payload, real acceptance or native account call. Rollback c0a0a1f with
matching schema8 backup. Formal LP/CV/A/B remain open; quota checked after unit.


## CV-12c canonical routes, owned cancel, lifecycle and v3 review UI

Controller now owns exactly one CanonicalLocalResults after ConfigurationEngine
initialization. Existing authenticated GET Run result adds review for delivery.none.
Strict operator/CSRF/schema routes provide local-verification, captured verifier
cancel, and accept-local-result; no /api/local duplicate entrypoint. Lost SENDING/
UNKNOWN reads require no filesystem/native query and never claim an owned cancel
handle. Cleanup stops only the captured verifier, including after Task authority
changes. Unknown shutdown preserves database ownership rather than claiming stop.

TaskDetail reuses its existing result query. LocalResultReview shows current
candidate/registered verification and separates historical Run verification.
Explicit content-bound checkbox precedes accepting a candidate. Candidate/Task/
generation/lease/control changes invalidate that consent. Pending verification/
acceptance body and idempotency key survive browser refresh; no automatic POST.
Only the same original request may be retried. HTTP receipt must match Run,
generation, candidate and verification; unknown outcomes stay closed. Active
verification polls saved status and exposes only its exact owned stop. Known
acceptance and a later failed detail refresh are reported separately.

Three API regressions: auth/origin/strict payload/acceptance replay, real owned
registered-process cancellation with role check, and lost-SENDING restart with
zero native replay. Four UI cases: explicit fenced accept, uncertain request
restore/same-key retry, invalidated consent and owned-vs-unknown stop. Core7 cases
continue passing. Target3 files14 tests11.66s; default full check135 files1389
tests49.22s, diff check passes. Logs /tmp/dispatcher-cv12c-api-red.log,
-ui-red.log, -api-green.log, -final-target.log, -check.log. Initial integration
constructed the service before ConfigurationEngine; fixed owner initialization
order, without weakening assertions. No dependency/schema or native account call.

Verification basis stays matching-managed-source with a retained content snapshot,
not hermetic/native qualification. Real provider trial is still REVIEW; automated
fixture DONE assertions are not human acceptance. Next: offline backup and real
retained-candidate read/reverification with no native restart, browser checks if
available; LP-07/A/B remain open. Rollback d1f95e7 with matching schema8 backup.
Official quota checked after unit; no reset used.

## LP-07 real retained candidate revalidation at 28cfd4c

Backed up the isolated real-Codex trial database before opening it with the new
review service. Qualified 3dc0e00 CLI database-only backup reports schema8, one
Task/Run/Session, zero unresolved commands and unchanged source-main bytes;
archive SHA256 5283f71b9576678b679ed0c0feed8473b55f7b983c846e964ff8526666cd7533.
Backup excludes native storage and SecretStore; it is not a complete recovery
drill. All artifacts remain under the private local provider-probes directory
2026-10-21T01-20-30.588Z; no credential or one-time browser login was published.

Restarted Controller at source 28cfd4c against that retained trial database with
native starts explicitly rejected and counted. Real registered probe-required
command passed, creating retained snapshot 720bfc9a25aaa3cb8c14def81d3b4bb506602677.
Review transitioned unverified -> verified -> changed after a temporary owned
file edit -> verified after exact byte restoration. Native start attempts stayed
zero. Original file SHA256 7ee38f252e54e9e537c1acdd0c0004db5de5c454fd167bd5963b27826c8e6d6a
was restored. Task remains REVIEW; no acceptance call, commit or push occurred.

In-app browser opened the actual Controller, navigated overview -> actual Task,
and displayed native-default, managed worktree, original native session,
historical verification, current matching candidate, explicit unchecked human
confirmation and disabled accept. Missing native binding/model/usage remain
unknown. This verifies rendering and preserved REVIEW, not human acceptance,
same-session reply/cancel or native GUI directory selection. Controller stopped
after the browser closed; waiting on an open event stream exposed a shutdown
ordering defect to fix next. Private review-qa-28cfd4c/report.json records
controllerStopped:true, nativeStartAttempts:0, humanAcceptance:false. Source
workspaces and dirty trial candidate are retained. Official quota: 34% remains.

## MAC-01j browser-independent graceful shutdown

Actual retained-candidate browser QA exposed Controller.stop waiting indefinitely
on Fastify's hijacked SSE response until the browser closed. A real authenticated
HTTP event stream regression reproduces the failure with the client left open.
Controller now owns idempotent stream closers, rejects new streams after stopping
starts, removes subscriptions/timers and ends responses before app.close. Client
EOF is explicitly awaited in the regression, independently of server-close timing.
No provider process or database ownership checks are bypassed.

RED /tmp/dispatcher-dashboard-stop-red.log; target one real HTTP case passes;
default pnpm check136 files1390 tests (49.39s), diff check passes. Logs
/tmp/dispatcher-dashboard-stop-target.log and -check.log. Rollback c50c881 with
matching schema8 backup. Host launchd stop/login/sleep and slow-client performance
remain separate Gates. Official quota checked after this unit; no reset used.

## CV-13a measured CPU windows and confirmed benchmark cleanup

Correct the existing harness: strict ps RSS/cumulative-time parsing and monotonic
counter deltas replace lifetime %CPU averages and zero-on-failure coercion.
At least two samples are required; raw samples, elapsed time, source SHA/dirty
state, built CLI hash, host/kernel/CPU facts and measurement basis are retained.
SQLite main+WAL+SHM and structured log bytes/growth are separate. A missing main
database or invalid process clock fails the run. Real Agent load remains
not-runnable; metadata/log reads and short idle remain informational. P0/P1
CPU/RSS can pass only after the frozen 600-second window. Soak, event-loop,
handles, network, historical load and native descendants remain unmeasured Gates.

The spawned Controller is owned from creation; TERM must reach child close with
exit0 before removing its temporary data. Unknown/non-graceful exit retains data
and PID diagnostics and fails. Dashboard stream stays open until Controller
stops, exercising MAC-01j. No guessed PID/group kill or destructive uncertainty
cleanup. HTTP readiness/reads are bounded and response bodies consumed.

Five cases cover platform clocks/invalid samples, weighted counters, assessment
boundaries, WAL/SHM and actual delayed/ignored TERM children. RED missing module;
GREEN target5 cases. Default check137 files1395 tests (49.22s), diff passes;
subsequent console-only output change checked with lint. Actual smoke5s measured
0.1997%/116457472B RSS (6 samples), 543656B database including WAL/SHM, confirmed
exit0; informational. Actual dashboard5s kept one SSE client and also confirmed
exit0, informational. Reports under .dispatcher/benchmarks and logs
/tmp/dispatcher-benchmark-{red,target,lint,check,smoke,dashboard}.log. No performance
or A/B Gate closed. Rollback26a9ab6 with schema8 backup; quota checked per unit.

## CV-13b prevent Controller authority inheritance by execution children

A fake-canary real child reproduced inherited DISPATCHER_OWNER_TOKEN and
DISPATCHER_SECRET_STORE_KEY in ProcessManager (exit71). Shared execution-child
boundary now removes exactly those two Controller authority keys after overlays,
case-insensitively; provider credentials/account homes/PATH/PWD and other existing
variables remain supported. Apply at Codex/Qoder/Generic/structured CLI starts,
all native catalogs and version/auth probes including no-workspace probes,
Runner process/PTY/verification, workspace Git and legacy integration Git, plus
native directory helper processes. Controller's own configuration/SecretStore
access is unchanged. No credential value was printed or sent to a provider.

Reuse existing shared workspace package; internal dependency edges only, offline
install downloaded zero packages. No external dependency or license change, no
schema/API/auth relaxation. Three regressions cover immutable environment/
override filtering and real process/PTY/verification/Codex/CLI/catalog/probe
children with provider context preserved. RED /tmp/dispatcher-child-env-red.log;
target3 cases pass; default check140 files1398 tests49.39s and diff pass. Logs
/tmp/dispatcher-child-env-{install,target,check}.log. Prior actual Codex trial used
a constructor fixture token, not an inherited Controller token; no observed
actual credential exposure is asserted. Rollback1de0c41 with matching schema8
backup. This is not a general environment sandbox or formal security Gate.
Official quota checked after unit; no reset used.

## CV-13c preserve native evidence validator assertions in default discovery

Port source a499d84 scripts/validate-native-evidence.mjs and native roundtrip
version1 schema byte-for-byte. Rehome all31 cases from scripts/test into the
existing apps/controller/test discovery, changing only relative module/CLI paths.
No Vitest include expansion or skipped source assertion. Recursive native payload
sanitizer reuses the already ported native-text rules, adds scoped cookie-key
handling and leaves generic logger behavior unchanged. One extra scoped sanitizer
case preserves opaque hashes/secret references while rejecting private metadata.

Validator separates consistency from qualification: strict current tuple,
identity/control-epoch/stage account/model/thread, GUI scenarios, writer release/
reclaim, return snapshot verification, bounded no-follow regular artifacts/hash,
reviewed-record digest from a trusted out-of-record source. CLI has no review
argument and cannot register/enable a capability; exit0 is consistency only.
No historical qualification JSON, account data or artifacts copied into target.
No native account/UI launch, new dependency or schema migration.

RED missing module; target31 source cases pass. Default check141 files1430 tests
(50.45s), diff passes; logs /tmp/dispatcher-native-evidence-{red,target,check}.log.
Source-disposition rows and operations command updated. Rollback8182c29 with
matching schema8 backup. Formal provider roundtrips and native capability admission
remain open; synthetic valid records do not establish real-provider qualification.
Official quota checked after unit; no reset used.

## CV-13d freeze benchmark runtime identity before spawn

The first 600s development measurement completed with597 samples, CPU0.049999%,
RSS118374400B, DB growth313120B, log growth309B and confirmed exit0. However,
concurrent source/build work exposed that identity was sampled at report time:
the report labels ac0b8f5 although startup occurred at1de0c41. Preserve original
samples/report unchanged, and attach an assessment-correction.json sidecar with
its hash: diagnostic/informational, loaded runtime source unproven. No Gate pass.

Harness now captures source/script/entrypoint facts before spawn. Optional
--release-dir binds an already qualified v2 release, launches its exact CLI with
pinned release environment and verifies its complete runtime/manifest again
after measurement. Harness source is recorded separately from runtime source.
Development always stays informational, including600s; changed release fails.
No inherited release environment can silently select another runtime. Native
qualification and all other performance Gates remain separate.

Two regressions exercise independent immutable release vs mutable harness source,
post-capture artifact tampering and unqualified development. Assessment tests
now require qualified runtime for a600s pass. RED missing module; target2 files7
cases; full check142 files1432 tests49.91s, diff passes. Actual5s development and
fixed3dc0e00 release smokes both exit0/informational; the latter records the
release source and verified runtime. Logs /tmp/dispatcher-benchmark-runtime-*.log
and /tmp/dispatcher-benchmark-release-smoke.log. No host service or provider call.
Rollbackac0b8f5 with schema8 backup. Next: stage current clean candidate and rerun
fixed-artifact idle while independent source work continues. Quota checked.

## MAC-01k captured service definition revision

A three-case RED reproduces stale parsed definitions being bootstrapped after an
async supervisor/enable change, missing captured revision, and decoder access
through a linked definition. Bound service reads now open bounded user-owned
single-link non-group/world-writable regular files with no-follow/nonblocking,
verify descriptor/path identity/size/timestamps, and hash captured bytes. Native
plutil receives these bytes on stdin (including binary plist), not another path
open. Existing injected decoders remain test dependencies; real existing files
still require capture. Parsed definition hashes flow through CLI start/restart.

Start checks revision before supervisor access, after status and after enable,
then rechecks bound runtime and definition before bootstrap/kickstart. Detected
drift preserves the changed file and rejects activation. This is an observed
revision fence, not an OS-atomic defense against a same-user concurrent filesystem
attacker. Stop/status/inspection remain separate; no unknown process kill added.

Target2 files27 cases incl all old launchd tests pass; full check143 files1435
tests47.78s and diff pass. Actual /usr/bin/plutil XML and binary fixtures both
roundtrip captured hashes/paths/pins; no host service mutation. Logs
/tmp/dispatcher-launchd-definition-{red,target,check}.log and
/tmp/dispatcher-plist-read-probe.log. Rollback253a792 with matching schema8 backup.
Upgrade/rollback/qualified restore and login/sleep/Keychain/provider Gates remain
open. Official quota checked after unit; no reset used.

A clean253a792 staging also completed independently:6046 files117245795B, unchanged
source dependency state, relocated HTTP/assets/API/real PTY smoke, schema8/writer4,
admission1, nativeProviderVerified:false. Runtime retained privately at
~/.local/share/dispatcher/releases/253a792. Fixed-artifact600s idle is in progress;
source development cannot alter this runtime tree.

## MAC-01l offline compatible upgrade preparation

Add prepare-upgrade CLI preview/explicit-confirmed reviewed-plan execution.
Capture request fields before awaits; bind existing normalized pinned plist,
qualified source/target releases, canonical data and raw main/WAL fingerprints.
Require unloaded service plus data ownership, exact schema/writer agreement,
operational source and no active/uncertain work, pending effects or native
bindings. Legacy/custom definitions and migrations require separate review.
Streaming file hashes avoid loading multi-GB snapshots into memory.

Preparation creates only a new DB-only archive, validates actual restore into a
private new target while preserving both barriers, removes only that owned test
copy, rechecks release/definition/source and retains previous/candidate plist plus
PREPARED receipt. Installed plist and source DB are untouched; no launchctl
mutation, restored-data activation or native action. Incomplete archive/preparing
marker stays for inspection. This is the preparation phase, not an implementation
of switching or qualified rollback; those remain open.

Three regressions cover backup/restore proof and source/definition preservation,
review/confirmation/data drift/active Run/barrier, and loaded service/schema/
definition rejection. RED missing module, target3 files13 tests; first full build
caught two exact-optional parameter errors, corrected without changing contracts.
Final default check144 files1438 tests50.30s, diff passes. Logs
/tmp/dispatcher-service-upgrade-{red,target,check}.log.

An isolated fictional service definition used real qualified3dc0e00->253a792
releases and the preserved real-Codex trial DB. Preparation succeeded schema8/
writer4, one Task/Run/Session, source-main and fixture-plist bytes unchanged,
only two simulated supervisor print reads, no real supervisor/provider/human
acceptance. Report and archive stay in the private provider-probes root under
upgrade-preparation-4ead780 / backup-upgrade-preparation-4ead780. Native homes and
SecretStore excluded. Log /tmp/dispatcher-service-upgrade-real-data.log.
Rollback4ead780 with matching schema8 backup. Official quota checked; no reset.

## CV-13 fixed253a792 P0 CPU/RSS window

Isolated fixed release253a792041e6ac564022988076c15863b1b4deb9 completed596 samples
across600.010853s: average CPU0.0599989%, maximum RSS170000384B, DB growth321360B
(main4096+WAL832272+SHM32768=869136B), structured log growth309B/total755B.
Complete release/manifest verified before and after, no dashboard clients or
Agent load, process close confirmed exit0. Report
.dispatcher/benchmarks/2026-10-21T02-30-58.598Z-idle.json; source/harness captured
at start; log /tmp/dispatcher-benchmark-release-idle-253a792.log. This meets the
frozen P0 CPU/RSS numeric budgets for this empty configured Controller+Runner
window only. Event-loop/handles/network/history/native descendants, real host
service and8h soak are not qualified. One authenticated SSE-client600s window
is now running separately; it is not a complete browser workload.

## MAC-01m offline definition switch and explicit local reconciliation

Add apply-upgrade/reconcile-upgrade to the existing CLI. Service mutations share
an operation OS lock; unsupported platforms reject before creating it. Source
instance ownership, same reviewed plan/data/release/definition, sealed archive
and unloaded supervisor precede disabling the job. Before moving any installed
file, journal APPLYING and create a nonce-bound service-definition-switch marker
through the existing dispatcher.sqlite.restore-pending operational barrier.
Compatible binaries already refuse that barrier; schema/SQL/triggers are unchanged.

Known source file moves into a private transaction directory; candidate links
use no-overwrite installation, own extra links are settled by exact inode/hash,
then source/runtime/supervision recheck precedes SWITCHED receipt and removal of
only the owned marker. File/parent fsyncs order the journal, marker and namespace
changes. File mutation failure/lost response preserves displaced file and barrier.
Explicit reconciliation reads exact candidate/old bytes and unchanged quiescent
data, completing a known install or restoring captured old bytes when the path
is missing. Foreign definitions, source changes, unrelated restore markers and
unconfirmed effects stay blocked. No directory force cleanup, schema downgrade,
trigger removal, native query/replay, user-data restore or automatic start.

Seven cases cover successful switch/replay/no bootstrap, failed install with
legacy startup barrier, lost write response, unrelated restore/foreign definition,
confirmation/data/artifact drift, non-cooperating writer and start rejection
before launchctl. Existing prep fixtures refactored only into one test helper.
RED missing module; target4 files37 cases; first full lint caught missing cause
on two mapped errors, fixed without suppression. Default145 files1445 tests
50.69s and diff pass. Logs /tmp/dispatcher-service-switch-{red,target,check}.log.

Actual retained real-Codex DB + qualified3dc/253 releases with fictional service
supervision exercised a failed install. Barrier was observed; real older3dc CLI
config import (deliberately absent input) exited1 at RESTORE_RECONCILIATION_REQUIRED,
without reaching file/config work. Explicit reconciliation restored the fixture
old definition, unchanged source-main bytes, removed only its marker and left
activation explicit. No host supervisor/provider/human acceptance. Private report
upgrade-switch-0c69c87/report.json under the retained provider-probes root; log
/tmp/dispatcher-service-switch-real-data.log. Prepared backup and displaced file
remain. Rollback0c69c87 with matching schema8 backup. Normal post-switch rollback
and changed-data recovery remain separate work/Gates. Official quota checked.

## CV-13 fixed253a792 authenticated SSE window

Separate fixed-artifact600.010963s/596-sample window measured CPU0.0699987%, max
RSS169771008B, DB growth317240B and structured log growth446B; one authenticated
SSE client remained, full runtime/manifest reverified, process close exit0. Report
.dispatcher/benchmarks/2026-10-21T02-42-50.531Z-dashboard-open.json and log
/tmp/dispatcher-benchmark-release-dashboard-253a792.log. Numeric CPU/RSS budgets
met for this SSE workload. The script does not drive browser rendering/polling,
slow consumers, event bursts, native Run load or8h soak; formal P1/P2–P7 stay open.

## MAC-01n distinguish unsettled execution evidence from telemetry

Re-read RunInputReceipts, publication reconciliation and native-cancel storage.
Offline upgrade eligibility now also rejects reserved/unknown run-input receipts,
STARTING/OUTCOME_UNKNOWN publication receipts, cancellation without explicit
nativeMayBeRunning:false, and retained adapter-session nativeBinding (including
legacy metadata outside the canonical binding table). These are real existing
control facts, not inferred from an absent active Run. No repair/adoption or
state deletion is performed to make them eligible.

Five negative cases reproduced acceptance before the fix; all now reject with
no archive creation. One positive case retains unknown usage-read/error facts
and known rejected input/stopped cancellation without treating telemetry failure
as execution uncertainty. Target2 files16 cases; default145 files1451 tests
50.90s and diff pass. Logs /tmp/dispatcher-upgrade-pending-{red,target,check}.log.
No native query or source database migration. Rollback8410002 with schema8 backup.
Full native/account quiescence and changed-data recovery remain unqualified.
Official quota checked after unit; no reset used.

## LP-07 explicit native model probe blocked at account/read

Run the qualified fixed253a792 package with installed Codex0.163.0-alpha.10.2,
new private repository/data and existing authorized native home. ConfigPlan
applied. GET models returned200/unverified/native-default-only/zero entries after
15.079s. No Task/publication/native execute start occurred (invocations[]). Closed
Controller and reverified release; all failed-probe data retained privately under
provider-probes/2026-10-21T03-19-25.237Z. No default-model fallback or human accept.

Two bounded read-only diagnostics used the existing production reader and a
private metadata-only instrumented copy of its exact compiled transport, preserving
method whitelist/cleanup. Generated installed CLI schemas confirm request/client
fields and --stdio support. Initialize responded successfully in37ms; a status
notification followed. account/read then returned RPC error-32603 after~15s with
a timeout classification. Process closed0; production reader reports
NATIVE_QUERY_FAILED. No model/list response, account values, raw stderr, credentials
or session creation were exposed. Root cause beyond that SDK RPC timeout is
unproven; do not label login/network failure or raise deadlines to claim success.
Private catalog-diagnostic reports/schema and /tmp/dispatcher-codex-{schema-0163,
read-diagnostic,transport-diagnostic}.log retain metadata only. Earlier real
native-default execution evidence remains scoped to its earlier trial; this does
not qualify explicit model/effort or native handoff. Continue independent work.


## MAC-01o explicit offline definition rollback

Reuse the same reviewed upgrade journal/barrier for a reverse definition switch.
The database main/WAL must exactly match preparation; both releases, source/target
definitions and unloaded supervision are rechecked. Retain prior transaction
locations and direction, including interrupted retries. Old V1 forward journals
without direction remain reconcilable. Failed reverse installation restores the
captured pre-rollback candidate; lost-response reconciliation can confirm the
installed old definition. Foreign edits/restore markers stay untouched. No data
restore, schema change, native effect or service activation occurs.

Four new behavior groups first failed due to missing rollback implementation;
target11 cases then passed. Added original V1 journal compatibility, default build,
typecheck/lint/boundaries passed; default tests145 files/1456 cases produced one
failure in the existing concurrent Codex-profile test: simultaneous same-repository
Git worktree add read another incomplete .git/worktrees/.../commondir. The other
1455 passed, including rollback. Retain /tmp/dispatcher-service-rollback-{red,
target,check}.log. Do not call this a passing full gate. Track the concurrency
failure in R-001; continue an independent scoped correction rather than weaken
the assertion or serialize the test. Rollback source283c018, compatible schema8
backup; changed-data recovery and real host service Gates remain open.


## CV-03c order same-repository worktree administration

The MAC-01o default gate reproduced Git reading another concurrent add's partially
written commondir. Keep existing concurrent assertions. WorkspaceManager now
serializes add/remove by physical Git common directory across repository aliases
and manager instances within the owning Runner process. It rechecks beforeCreate
inside the queue, leaves distinct repository mutations independent and releases a
failed operation without retrying Git or deleting unknown artifacts. This is not
an OS lock against other applications/Runner processes.

A controlled delay around real Git reproduced overlap and poisoned-queue failures
before correction (2 RED cases); target2 files5 cases passed, then an additional
real remove/add regression passed in the full gate. Initial build caught the
package ES target rejecting Promise.withResolvers; used its existing Promise
constructor without changing targets. Initial lint caught import-type annotation;
fixed the test import without weakening lint. Default146 files1459 tests and all
build/type/lint/boundary checks now pass51.93s. Log /tmp/dispatcher-worktree-
concurrency-{red,target,check}.log. MAC-01o rollback is now included in a passing
full gate. Rollback sourcee240e6e; no persisted schema or external side effect.


## MAC-01p stop SSE output at transport backpressure

CV-03c's second independent default gate passed146/1459 in52.31s at999d911
(/tmp/dispatcher-worktree-concurrency-stability.log); both default runs retain
normal workers and concurrent assertions. No serial-only qualification.

Dashboard SSE now stops initial ready/reset/replay and live/keep-alive writes on
write(false), closed transport or write exception. It removes its subscriber and
keep-alive immediately, never queues later frames, ends the accepted buffer and
forces owned response destruction after2s if a peer does not drain. The shutdown
closer remains owned until physical close. Existing cursor replay/reset supplies
subsequent state; no native execution/control semantics change.

Three real HTTP connection tests inject Node's backpressure signal at ready,
replay and live output; each first failed client count1!=0, then passed alongside
the existing open-stream graceful-shutdown regression (2 files4 cases). The
initial test detector used getHeader after writeHead and timed out; corrected to
observe actual SSE ready bytes, then reran RED before implementation. No timeout
was raised to hide a failure. Default147 files1462 tests/build/type/lint/boundaries
pass54.06s. Logs /tmp/dispatcher-dashboard-backpressure-{red,target,check}.log.
This is a controlled transport-bound regression, not measured real slow-reader,
burst-memory or long-soak acceptance. R-004 remains open for those workloads.
Rollback source999d911; no data/schema or service activation. Official quota
checked after unit; no reset used.


## CV-13b remove Controller authority from all Workspace Git commands

Inspection found CV-13a/R-017 covered workspace inspection Git but had not covered
WorkspaceManager's ordinary promisified execFile calls. Correct the earlier broad
wording: mutating/ordinary workspace Git remained inherited until this unit.
A real post-checkout hook with fake canaries reproduced Controller authority
presence (RED true!=false) while retaining provider context. The existing internal
execute boundary now filters the effective child environment for every command,
including worktree administration, refs, restore, fetch, cleanup and result reads;
explicit inspection environments retain their original restrictions. UTF-8 output,
argv, native Git hooks/credentials, signals and timeouts retain their contracts.

The hook regression is GREEN; target2 files7 cases and default147 files1463 tests
plus build/type/lint/boundaries pass53.35s. No real secret value was read/printed;
only fake-canary presence and a fake provider-context string were recorded in the
owned fixture. Logs /tmp/dispatcher-workspace-authority-{red,target,check}.log.
Rollback source9244e40; no schema/config/provider or host service mutation. This
closes this observed environment gap, not general child isolation/security review.


## CV-10a preserve the committed Pi RPC transport

Port a499d84 packages/adapters/src/pi-rpc.ts's PiRpcClient/Scope/protocol and all
34 transport assertions into the internal pi-rpc-client module/test. Original
source blob b32344138bf69f6756393c76ba822960f38107a9 remains preserved. Reuse the
source native version-probe behavior (blob b136f4e94af023cb78bfa27ce5dd70ed02464ac8),
adapting its newly owned probe to the target OwnedProcessGroup and drained catalog
boundary. Both version/RPC children strip Controller authority and retain native
account/PWD context. RPC close preserves its original owned-root-only contract;
background-tool/native writer release is not inferred or cancelled by PID adoption.

This retains exact UUID/new/resume argv, source protocol pin1.2.0, directory identity,
UTF8/CRLF framing, correlated ACKs, bounded input/events, synchronous final Guard,
uncertain-turn non-replay, prompt/settled distinction and diagnostic redaction.
Import absence first failed; migrated34 assertions then passed. Added a real
fake-canary environment test; it initially read evidence at spawn before RPC code
ran, then awaited get_state (no timeout change). Target35 cases and default148
files1498 tests/build/type/lint/boundaries pass59.85s. Preserve /tmp/dispatcher-pi-
rpc-client-{red,target,environment,environment-race,check}.log; previous34-case
full gate148/1497 also passed60.16s before the additional test.

The module is not exported/registered in the default adapter or Controller. Existing
Pi print/JSON execution remains unchanged. Read-only identity/history port,
ExecutionSelection/managed binding producer, Controller lifecycle/source registry
and real installed/account qualification remain pending. Devin ACP and committed
Copilot modules still need adaptation; Copilot WIP remains separately frozen.
CV-10 moves to In Progress, never Done. Rollback sourced13bae9; no installed Pi,
provider/account, schema, host service or external write. Official quota checked.


## CV-10b preserve the Pi read-only identity/history port

Port a499d84 PiRpcInteractionPort and all44 read/identity assertions into the
internal pi-rpc-read module. Reuse the client's exact directory/text validators;
share the original owned-child fixture across transport/read tests, retaining all
35 transport/environment cases. No package entrypoint, default Pi print adapter,
Controller runtime registration or surface/write capability is added.

The port requires supplied scope-matching runtime evidence for durable identity
and history only. It fences UUID/profile/backend/Runner/native storage/execution
identity, captures read cancellation, rechecks guards before queued native reads
and pins materialized session files against replacement/deletion/alias retarget.
Inspect requires stable repeated state; history requires repeated stable native
entries/state, validates IDs/times/cursors and bounds entry/page bytes. It labels
append-order/tree/incomplete pagination gaps and never turns idle/root close into
background-tool, approval, external-change continuity or writer-release proof.

Missing port import first failed. Target79 cases initially had78 pass and one
missing PiAdapter test import; corrected the import, retained the assertion and
verified that case independently. Initial lint caught a type-only import; fixed
without suppression. Default149 files1542 cases and build/type/lint/boundaries
pass93.06s. Logs /tmp/dispatcher-pi-rpc-read-{red,target-missing-import,import,
check}.log. No actual installed native application/account or provider call.

Readonly port qualification/composition, canonical ExecutionSelection producer,
Controller lifecycle/source registry and real same-session handoff remain open.
Supplied fixture evidence is not production qualification; native write methods
and surfaces stay absent/unknown. Source backup unchanged; rollback source9b8bf00
and schema8 backup. Official quota checked after this unit; no reset used.


## CV-10c guarded canonical Pi execution producer

Port a499d84 PiRpcExecutionBackend into the internal pi-rpc-execution module,
retaining31 source producer assertions. One original Adapter-injection/manifest
assertion stays in the frozen source pending actual default Adapter integration;
no existing target assertion is removed or skipped. Keep the producer's readiness,
binding-before-prompt, bounded native callbacks/events, exact UUID/model state
reads and local-shutdown uncertainty contracts. New invocations require canonical
ExecutionSelection and managed execution reference; reject parallel legacy model
fields, unsupported parameters and different profile/provider/backend/Runner.
There is no newly registered/default backend, native writer or Controller source.

Add8 canonical-selection regressions (ownership, second authority, parameters,
malformed model type and capture-before-await). Target39 cases initially passed.
Inspection found a source gap: version-await completed before RPC spawn, but final
creation Guard happened only after open. A new revoke-during-probe case reproduced
unknown creation instead of not-created (RED). PiRpcClient now captures scope/options,
threads cancellation into its owned version probe and invokes the captured
synchronous admission immediately before RPC spawn, with no intervening await.
Recheck signal after the callback too: a separate direct acquisition-cancel case
first fulfilled incorrectly (RED), then rejected before RPC creation. Failed probe
drain remains unconfirmed; it is never normalized by cancellation.

All3 Pi targets119 cases passed before the extra acquisition-cancel assertion;
that new case independently passed. Final default150 files1583 cases plus
build/type/lint/boundaries pass87.60s. Logs /tmp/dispatcher-pi-rpc-execution-{red,
target,create-guard-red,check}.log and /tmp/dispatcher-pi-rpc-acquisition-cancel-
{red,target}.log. Initial lint found one unused import; removed it, no suppression.
Readonly port shares its internal record validator; default CLI contracts and
Controller/API configuration remain unchanged. This proves controlled fixtures,
not real Pi/account/native writer release or human handoff.

Re-read all original workspaces: v3 HEAD19db456 with1 tracked/2 untracked, personal
HEAD297c32c clean, continuation HEADa499d84 with6 tracked/2 untracked, unchanged
from frozen observed HEAD/status. No content cleanup/edit of these workspaces.
Default Adapter integration, observer/source lifecycle and real qualification
remain R-019. Rollback sourcea217d40 with compatible schema8 backup; official quota
checked after unit. No native provider/account call or host service activation.


## MAC-01q retained real database definition roundtrip

Run the implementation at02e70192d4f29bdd742487133a39ab414a6a145c against the
retained successful Codex trial database, with a new private fixture plist and
simulated supervisor (only print/disable accepted). Both previously qualified
fixed releases3dc0e008979b7f769f401ab101c9f6981b5a3514 and253a792041e6ac564022988076c15863b1b4deb9
were reverified. No actual launchd label or native provider was invoked.

Private evidence: provider-probes/2026-10-21T01-20-30.588Z/
upgrade-rollback-02e7019-2026-10-21T04-55-40.422Z/report.json; corresponding
backup-upgrade-rollback-02e7019-2026-10-21T04-55-40.422Z retains the sealed archive,
reviewed plan and both transaction directories. Plan
c7c937a724abf2456afe6cbf2c423b21659c7af0269441e2edd77d17dafc45f9.
Preparation validated restored data, forward reached SWITCHED with exact candidate
hash, reverse reached ROLLED_BACK, repeated reverse returned replayed:true.
Both displaced files remain, original definition restored and owned barrier absent.
MainSHA b73fc55032ae699b02f1632a102165e887baf08a704d66ac2052fab03a4f663a stayed exact;
WAL absent before/after. One Task/Run/Session retained. Actual helper source and
fixed binary identities are recorded separately; this is not activation proof for
an02e7019 staged CLI. Log /tmp/dispatcher-service-rollback-real-data.log and probe
/tmp/dispatcher-service-rollback-real-data.mjs. No human acceptance or data restore.

Also rehash all frozen source/WIP files from source-manifest: v3's3 and
continuation's8 match exactly; personal-local has no WIP and remains clean.
This strengthens the prior HEAD/status observation without modifying any original.
Code unchanged since default150/1583 pass; doc-only diff check passes. Changed-data
recovery, actual login/sleep/Keychain/native stop and service activation Gates remain
open. Official quota checked after evidence unit; no reset used.


## CV-11b / CV-13c bounded canonical task Run history

The frozen M10/P4 design requires historical Run pagination (1000 queryable;
10k history acceptance). Add opt-in runsOffset/runsLimit to the existing canonical
Task resource, using SQLite count/LIMIT/OFFSET before JSON decoding, ordered by
saved updated_at DESC/id ASC. Page size1..100 and nonnegative safe integer offsets
are validated. Current Run is read independently and checked against owning Task;
all-task hasActiveRun is counted separately so older/out-of-page active evidence
cannot disappear from archive or action decisions. This is a read projection,
never write authority or native evidence.

V3 TaskDetail requests20 rows, pages history independently of current Task/Run,
retains selected/current options outside the visible page, handles loading/errors
and refreshes the viewed history on existing events. The owning TasksPage already
keys TaskDetail by Task ID; a task switch resets its page/selection through that
existing mount boundary. Archive uses all-task active metadata. Default unpaged
GET remains for actual existing public/PublishPage consumers; no second UI/write
entry is introduced. Task deliveries, Fleet/global scans and legacy default reads
remain outside this bounded-Run scope; do not claim whole-history memory Gates.

Two HTTP regressions first failed (unbounded-read guard and invalid bounds200),
then passed:45 owned Runs plus foreign active Run,20/20/5 disjoint pages,
out-of-page current/active facts and invalid bounds. UI first failed the missing
paged request; now covers paging, current selection/archive and keyed task switch.
Target3 files19 cases includes existing PR delivery assertions. Default152 files
1586 tests and build/type/lint/boundaries pass80.23s; diff clean. Logs
/tmp/dispatcher-task-run-pages-{red,ui-red,build,target,check}.log. Persistence
built before cross-package targets. No schema/index/migration/config/native write.
Actual1000/10k workload, browser performance and other P4 metrics remain R-004.
Rollback sourcea4962cc with schema8 backup. Official quota checked after unit.


## CV-13d runnable synthetic history API benchmark

The existing benchmark entry now supports --scenario history --history-runs
1000|10000 (bounded1..100000). It refuses an existing data directory, imports the
selected runtime's own persistence package and seeds only new synthetic terminal
Run metadata in one transaction. No adapter sessions, native commands or real
Agent workload are configured. API traversal verifies every unique owning Run,
page count/progression and separately scoped current Run, rejecting legacy
unpaged, duplicate, foreign or non-progressing replies. It records page timings,
response bytes and samples Controller CPU/RSS during the workload. Source capture
includes the new history helper hash before spawn. Controller LLM counters retain
their actual generate-attempts scope, never all-provider billing claims.

History assessment stays informational, including a qualified artifact: full
browser rendering, native/provider workload, event-loop/open-handle/network and
soak Gates remain unmeasured. Existing-directory rejection creates no replacement;
a pre-spawn failure records not-created rather than unconfirmed process exit.
Owned generated fixtures are removed only after physical close exit0.

Missing helper first failed; target3 files13 tests passed (new6 ownership/page
validation cases). Default153 files1592 tests/build/type/lint/boundaries pass71.78s.
Actual development entry runs (harness5eda9d0 dirty=true; helper hash captured)
verified1000 Runs/50 pages: p95 1.826417ms, max3.099042ms, RSS135839744B,
CPU2.99760087% over5.004s; report2026-10-21T05-23-54.852Z-history.json.
10000 Runs/500 pages: p95 16.327541ms, p99 18.900333ms, max100.133584ms;
report2026-10-21T05-30-11.324Z-history.json. Both had DB-growth0, scoped Controller
LLM generate attempts0 and confirmed child exit0. Exact CPU/RSS/window for10k
are in that raw report; these are active-query workloads, not an idle CPU Gate.
Prescribed smoke5s returned informational: CPU0.19962042%, RSS117129216B,
report2026-10-21T05-25-29.102Z-smoke.json; exit0. All reports remain under
.dispatcher/benchmarks. Logs /tmp/dispatcher-benchmark-history-{red,target,check,
development,10000-development}.log and /tmp/dispatcher-benchmark-smoke-history.log.
Unpackaged/short windows cannot qualify a fixed candidate or complete P4.
Rollback source5eda9d0; no persisted format or actual user data/service change.
Official quota checked after unit; no reset used.
