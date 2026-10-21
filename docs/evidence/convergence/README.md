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
| macOS service / LP / backup | MAC-01a CLI data-directory ownership verified at 117/1237; MAC-01b lifecycle/fixed definition verified at 117/1251; MAC-01c read-only doctor verified at 118/1264; MAC-01d structured logs/safe tail verified at 119/1273; MAC-01e offline DB backup/restore preparation verified at 121/1281; MAC-01f release closure/hash foundation + packaged asset fix verified at 122/1292; isolated stager/early stdio/upgrade/qualified restore activation and real evidence pending |
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
