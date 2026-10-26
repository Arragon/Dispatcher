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

## Whole-branch review and single Important-fix pass

One fresh independent reviewer inspected the production range19db456..4e76656
(77 commits/211 files; review package retained privately at
/tmp/dispatcher-convergence-review-19db456-4e76656.diff). This was a broad static
risk review with implementation/test inspection, not an exhaustive runtime Gate.
No Critical or Minor findings were reported. The verdict was partial candidate
"with fixes", explicitly not A/B acceptance or service activation. No second
review is requested; remaining implementation and external Gates stay open.

Ruling: accept Important automatic-verification replay finding — the mounted
advance path lacked per-command durable send identity, so revision loss or a
crash could invoke a registered command twice — effects may overlap unless held.
Each command now persists SENDING before Registry.run and SETTLED with its result
only under the captured Task/control/lease fence; uncertainty persists UNKNOWN.
Local VERIFYING startup is held for reconciliation, including old records with
no receipts. This intentionally sacrifices automatic recovery availability;
phase alone cannot prove an invocation did not happen. No schema downgrade,
receipt deletion or automatic retry/reconciliation endpoint is introduced.

Ruling: accept Important snapshot Git-queue finding — snapshot add bypassed the
physical common-directory queue used by Manager create/remove — incomplete Git
administration could break unrelated task preparation. Snapshot add now uses
that same mutation owner and rechecks authority after queue admission. Ownership
remains process-local; external Git processes are not serialized by this queue.

RED reproduced revision-change second advance200 and crash-copy command count2;
the initial blocked second-call fixture was corrected to resolve its duplicate
immediately, giving a concrete replay assertion instead of a test timeout.
SQLite online backup captures the actual SENDING/VERIFYING crash window into a
separate fixture; restart retains UNKNOWN, command count1 and zero native starts.
Controlled real-Git overlap tests failed snapshot-vs-create and snapshot-vs-remove,
then passed with the shared queue; queued authority revocation creates no snapshot.
Related target5 files26 tests pass. Red logs /tmp/dispatcher-final-review-red.log
and /tmp/dispatcher-final-review-replay-red.log; green target/build logs
/tmp/dispatcher-final-review-{build,target,broad-target}.log. Full default gate
is recorded below after completion. No tests were skipped or weakened.

Reviewer declined-to-judge rulings:

- Final: Ruling: keep actual GUI/account/takeover/cross-device Gates open in R-002/003/018
  — no such operations were qualified — an incorrect promotion risks real writes.
- Final: Ruling: keep real Pi protocol/default composition open in R-019 — the port is
  internal and unregistered — advertising it would imply unsupported capability.
- Final: Ruling: keep legacy usage origins/quota/price admission open in R-010/014 — pure
  engine tests cannot establish provenance — false precision would mislead costs.
- Final: Ruling: keep changed-data restore, credentials/native-store and real launchd
  lifecycle open in R-006/013 — local barriers do not prove activation/recovery —
  a mistaken release could strand user data or an owned process.
- Final: Ruling: keep browser/slow-reader/soak performance open in R-004 — synthetic API
  and controlled SSE evidence has narrower scope — real load could exceed budget.
- Final: Ruling: retain source restore checks from CV-01 and the latest11-file hash
  recheck as implementer evidence, not independent reviewer verification; keep
  third-party license qualification open in R-017 — reviewer did not inspect
  originals/licenses — omission could lose provenance or violate obligations.
- Final: Ruling: keep unexecuted paths and formal Gates open — whole-range review is
  static, with separate default-suite evidence — review cannot prove real runtime
  semantics for every provider/account/system condition.

Rollback uses source4e76656 with a compatible schema8 backup. New send receipts
must be retained; rolling an old binary onto a data directory with uncertain
verification is not an authorized recovery method. Original workspaces, frozen
WIP, private provider evidence and real service installation remain untouched.

Final: Ruling: append schema9/writer5 for the new automatic verification contract
— protocol4 binaries can ignore UNKNOWN receipts and replay commands, so rejecting
their startup and already-open writes is required — rollback now needs the
pre-upgrade schema8 backup plus its compatible binary, rather than reusing schema9.
Migration1–8 source text is byte-identical to4e76656 (migrations block prefix SHA256
e2ce5dcfb4b6c08c443a50d7b2ee3226f966d2f22f770c02413e3e003e9af2a9).
New writer regressions4 first failed, then passed: protocol4 live/raw/new-open
rejection; failed migration/outer rollback restore trigger SQL and writer4; schema8
archive uses writer4, only its restored copy upgrades to9 behind the barrier.
Upgrade quiescence separately rejects SENDING/UNKNOWN verification receipts even
without an active Run (two RED→GREEN cases). The protocol change intentionally
updates latest-schema expectations, current release fixtures and the future-schema
sentinel to10; old migration recovery/data assertions remain. No skips/suppression.
Target15 files121 tests pass after fixing two stale fixtures (future9 collision;
the deliberately non-cooperating writer now registers current5, preserving its
barrier-bypass simulation). Logs /tmp/dispatcher-final-review-{writer-red,
writer-target,upgrade-red,upgrade-target,persistence-build,persistence-target,
persistence-final-target,compat-target}.log. Initial pre-protocol default passed
154 files1597 tests72.51s; it is superseded by the final writer-check gate below.

Final: fixed automatic verification uncertain replay — Task revision-change and
SQLite crash-copy restart tests RED→GREEN, writer/upgrade regressions RED→GREEN,
suite1604/1604 (155 files); default pnpm check includes build/type/lint/boundaries
and passes73.03s. Final log /tmp/dispatcher-final-review-writer-check.log.
Final: fixed verification snapshot bypassing common-directory queue — snapshot
vs Manager create/remove tests RED→GREEN plus queued-authority rejection, same
green suite1604/1604. No re-review; no deferred Minor findings were reported.
All three original source SHAs and11 tracked/untracked content hashes rechecked
unchanged after the fix pass. Official quota last observed11%; check again after
the completed unit. A/B formal Gates remain open and the worktree is retained.

## Fixed partial candidate0d2cd42 staging and history measurements

Clean-source staging produced /Users/wangdongxin/.local/share/dispatcher/releases/
0d2cd42:6076 files117543898B, source0d2cd42dcca1696dd43ac6c9503b80e00ee00655,
Node24.21.0 fixed absolute path, schema9/writer5/admission1. Isolated offline
deployment, detached dependency closure, relocated HTTP/assets/API/PTY smoke and
release inventory passed; source dependency state unchanged. No host launchd or
real-user data activation. Log /tmp/dispatcher-final-candidate-stage.log.

The same fixed artifact was verified before/after three sequential benchmarks;
harness/source0d2cd42 clean captured at startup. Reports below are private in
.dispatcher/benchmarks; every child physically exited0 and cleanup confirmed.
Controller scoped generate attempts0; DBgrowth0 throughout. All remain
informational, not full P4/browser/provider/soak acceptance.

- 2026-10-21T05-49-23.598Z-history.json:1000 unique owning Runs/50 pages,
  5.004039542s, CPU3.397255329%, RSS176603136B, p95 3.57375ms,
  p99/max3.945708ms, response<=5906B, logs+15784B.
- 2026-10-21T05-49-30.540Z-history.json:10000 unique owning Runs/500 pages,
  7.353168042s, CPU93.429117365% (active query workload), RSS274251776B,
  p95 19.509417ms, p99 23.411334ms, max87.610084ms, response<=5952B,
  logs+155567B. This peak exceeds250MB and250MiB; it does not meet a claim of
  remaining below the planned memory budget. Preserve as R-004 investigation.
- 2026-10-21T05-49-40.142Z-smoke.json:5.005722958s, CPU counter delta0 at
  observed precision (not proof of zero CPU), RSS181174272B, logs+309B.

No benchmark code/threshold was changed to improve the result. These replace
neither prior fixed253a792 P0 numeric evidence nor missing current-candidate
idle/browser/slow-reader/long-running measurements. Logs
/tmp/dispatcher-final-{history1000,history10000,smoke}.log. Fixed release manifest
SHA256 fde3f55a55e8ad1762a87f463482d4305437650445635ec249473fdb0d6e42fe.
Rollback/preservation uses retained releases and matching backups; no original
schema8 evidence/data was opened by this new candidate. Official quota checked
after staging:11%; check again after this evidence unit.

## Quota stop checkpoint

Official usage after e90b3d7 is used90%/remaining10%, ordinary usage still allowed.
The user's <=10% stop condition is met: no further implementation, test workload,
provider/native account operation or service activation is started. Only this
handoff/status synchronization is recorded. Code/fixed candidate0d2cd42 remains
verified; docs checkpoint follows e90b3d7. All benchmark children have confirmed
exit0, and no host launchd install/start occurred. Keep the worktree/releases and
source backups; the goal is paused at the user's conditional stop, not complete.
Next work: re-audit quota/state, investigate R-004 10k active RSS274251776B,
complete guarded runtime/observer/Harness composition R-019, qualify account/model
R-018 and real A/B/Gate flows, and separately qualify schema8→9 data activation.
Do not reopen Done prototypes, replay UNKNOWN verification or treat local tests
as formal acceptance. Linear09/INH-1917/CV-13/MAC-01 receive this exact boundary.

## Resume and quota stop 2026-10-22

The user changed the stop threshold from10% to0%. Official quota now reports
used100%/remaining0% (ordinaryUsageAllowed remains true); the explicit user stop
condition takes precedence. No further implementation or tests are started.
HEAD remains c027ea3; fixed/last full-gate source remains0d2cd42. Preserve the six
uncommitted Pi adapter files recorded in quota-stop-20261022.json as unfinished
WIP. Controller registration has not been implemented. Agent-reported target
checks:19 RED then19 GREEN; adapters build FAILED TS2375 at
native-binding-events.ts:61 (possibly undefined nativeSessionId/nativeBinding).
No full gate ran for this WIP; prior155/1604 does not cover it. Further review is
needed for pre-creation observer error classification and durable sink-failure
identity blocking. Do not activate or promote this WIP. A/B remain incomplete.

R-004 diagnostic completed six private synthetic DB/API-inject processes against
fixed0d2cd42. Comparing no/page/all SQL statement caches did not materially
explain the earlier274251776B HTTP benchmark peak: API end RSS186351616 /
186089472 /185450496B; DB end RSS73678848 /71614464 /71319552B. The probe used
smaller synthetic documents and API injection, so it cannot overturn the retained
real-HTTP benchmark or qualify P4. No production optimization or threshold change
was made. Results are retained in quota-stop-20261022.json; probe script/log remain
/tmp/dispatcher-history-diagnose.{mjs,log}. An exact owned-process lookup confirmed
no remaining diagnostic process. Adapter agent reports commands completed and
fixture cleanup ran. Actual HTTP/startup allocation profiling remains open.

Resume only after user authorization, rechecking quota and worktree state. First
repair and verify the preserved Pi WIP, then complete Controller source/observer
registration, executionRef/admission plumbing and qualified shutdown behavior.
Continue R-004 investigation and all original A/B Gates. Existing sources, WIP
backups, schema9/writer5 boundaries, fixed artifacts and real evidence stay intact.

## Authorized continuation: guarded Pi, origin ledger and worker memory

The user resumed the full plan after the historical quota stop. This unit uses
the attached isolated `codex/dispatcher-plan-completion` checkout based on c027ea3.
Nine source WIP/evidence files were copied only after matching SHA256 checks;
`resume-source-20261022.json` retains their source paths, HEAD and hashes. Primary,
convergence and local-continuation dirty worktrees remain preserved.

### Worker memory root cause (R-004 / CV-13)

Five background methods decoded every Run before filtering. The regression first
observed50,000 irrelevant JSON decodes in one cycle with10k inert history, then0
after parameterized SQL filters. Lease, advancement, terminal usage, attention and
completed-PR eligibility retain their prior post-read authority checks. Actual
candidates and startup/Fleet global reads can still be large. No budget, worker
setting or historical document fixture changed.

The standard command was `mise exec -- pnpm benchmark -- --scenario history
--history-runs 10000 --duration 5`; the baseline added only `--release-dir
/Users/wangdongxin/.local/share/dispatcher/releases/0d2cd42`. Both verified10k
unique Runs,500 pages,5952B maximum response, zero DB growth and physical exit0.
Baseline peak257835008B/p95 19.431709ms; development fix peak174374912B/p95
29.7115ms. There is memory improvement, with no latency improvement claimed.
Retained reports: `history-baseline-20261022.json` and
`history-workers-filtered-20261022.json`. Diagnostic A/B with the same fixed
runtime identified worker allocations; disabling the worker was only a diagnostic
control. This is not fixed-artifact/browser/slow-client/soak or full P4 acceptance.
Targeted query/worker/history checks passed3 files/4 tests; existing
personal-loop/persistence/benchmark regressions passed3 files/98 tests.

### Pi runtime composition (R-019 / CV-10, R-005 / CV-08)

Explicit ConfigPlan configuration selects compatible pi-rpc in a managed
worktree, with absolute owning executable/native directories and explicit model.
The ordinary Pi CLI path retains its separate behavior. Scheduler now forwards
canonical ExecutionContextRef and independently requires creation and prompt
admission. Controller validates frozen workspace/selection/Run/Session/lease
identity. Native binding ingestion occurs before prompt; an event-storage failure
durably latches identity failure and leaves startup UNKNOWN.

Pi Runtime ports the committed a499d84 ownership implementation and adds strict
known-not-created cleanup. It never closes another active host or releases an
unknown cleanup barrier. Adapter/config/runtime target checks passed10 files/234
tests; runtime follow-up passed27 tests. Controller/Scheduler targeted composition
passed2 files/21 tests. Shutdown failure isolation first failed2 regressions, then
attempted every runtime, preserved each available receipt and closed HTTP before
reporting failure. Legacy→Pi reroute now transfers its canonical reference and
worktree/attempt with the existing stop/authority checks;3 new cases plus
personal-loop passed88 tests. Pi old-owner reroute remains blocked before any
stop or replacement creation because qualified native stop facts are absent.

`pi-readonly-gap-20261022.json` records the outstanding native loop boundary:
temporary protocol child dispatch201/ACTIVE, Adapter COMPLETED, native start
ACKNOWLEDGED, then advance409/NATIVE_STATE_UNKNOWN without any new RPC. Runtime
read capability is unqualified; synthetic read evidence still leaves pending
tools/approvals unknown. No settled event is promoted into quiescence. Controller
native-source registration and real capability/stop/handoff qualification remain
required. All children in this unit are disposable protocol fixtures; no real
account, GUI or native release Gate is claimed. One earlier combined target run
hit the unchanged3s version-probe deadline; later7 isolated probes passed, which
does not explain that failure or authorize a longer timeout.

### Canonical usage origin (R-010 / CV-06, R-014 / CV-07)

The owning producer registration can admit attempt/native-session provenance,
stable native origin and explicit billing occurrence. Equivalent event/query
collectors point to one immutable observation via aliases. Changed payloads
conflict atomically. Legacy record addresses/contexts remain unchanged; no
producer identity or billing time is inferred. Snapshot ordering uses native
occurrence; missing/ambiguous ordering exposes observations with unavailable
totals. Exact cost estimation deduplicates origin aliases and rejects conflicts.

Independent review reproduced old-writer alias double counting, collector-order
dependent totals and duplicate estimated consumption. Nine added RED cases now
pass; expanded16-file/148-test checks and domain/persistence/controller builds
passed. Migration10/canonical_usage_origin_writer_protocol raises writer6;
migrations1–9 remain byte-identical. Open old writers and old catalogs are
rejected; schema9 archives remain writer5, restored copies alone upgrade, and
inner/outer transaction rollback restores writer5. No real data was upgraded.
Qualified producer cutover, scoped account quota TTL and frozen billing
baseline/Controller/UI composition remain open.

### Full verification

First `mise exec -- pnpm check` completed build/typecheck/lint/boundaries, then
163 test files:162 passed,1 failed;1725 tests passed,2 failed. Both failures were
doctor fixtures pinned to schema9/future10. Updated expectations now cover
schema9 upgrade-required, schema10 current and future11 rejection, retaining
source-byte immutability. Log:
`/tmp/dispatcher-completion-full-check-20261022.log`. Targeted repair and final
full-gate results follow; the earlier155/1604 gate does not cover this unit.

The final default `mise exec -- pnpm check` passed build, all workspace
typechecks, ESLint and boundary checks, then163 files/1728 tests with no failures
(90.08s test duration). Log:
`/tmp/dispatcher-completion-full-check-final-20261022.log`. The doctor/Pi target
repair also passed2 files/22 tests. Pi advance regression explicitly retains
ACTIVE/NATIVE_STATE_UNKNOWN after a completed turn with no extra RPC. Full-gate
verification does not qualify native accounts, release activation or A/B Gates.

## Account quota composition (CV-06 follow-up)

Source reuse: a499d84 `apps/controller/src/metering.ts`,
`packages/adapters/src/codex-quota.ts` and their committed quota assertions.
The account-only portion is adapted into `account-quotas.ts`; the existing v3
UsageObservations remains the only Run usage ledger. Credit balances now preserve
exact decimal strings instead of the source's Number conversion. No new package
or third-party source was added. Generic entity persistence remains schema10/
writer6; no live data or original backup was opened.

New normalized account periods are separate from resource/Run/cost. Codex's
existing owned/cancellable read-only app-server permits account/rateLimits/read.
Controller background collection coalesces per-profile queries, admits at most4,
uses5-minute retries/10-minute source and last-success TTL, and expires native
period resets. It retains matching last-success evidence after failure and hides
another context's balance. Native query timeout31s aborts but retains ownership;
shutdown drains3s and records unknown cleanup rather than closing its database.
Account and credential replacement remain blocked while a read is pending.

New cached GET and explicit POST refresh endpoints use normal auth/CSRF. Account
details/model pages display exact values, zero/missing distinctions, source time,
staleness/error and last success. Cached GET polling does not invoke the provider.
UI mutation results remain keyed to the account originally requested.

Before Controller composition the two integration tests observed NOT_FOUND and
zero worker reads; after implementation both pass. Quota/normalization/cache/
Controller/UI plus existing native catalog/usage target6 files/22 tests pass.
New feature-module RED initially failed import resolution, recorded separately
from the behavioral Controller RED. Controller/web typechecks pass; an unused
test-fixture argument caught by ESLint was corrected without suppression.
Full default gate is running; no new full-gate claim yet. Real provider and
remote Runner quota remain unverified.

Linear synchronization of daca730 was attempted after its final gate, but both
save_comment and readback failed with MCP HTTP transport errors. A later readback
also failed. The earlier CV-06/Pi comments were verified before the outage; the
commit/full-gate and this quota checkpoint remain pending remote synchronization.
Development continues locally; the tracker is not assumed updated.

The transport subsequently recovered. INH-1917 comment
645361e7-20c6-490d-8628-18211cbc3b35 was saved and read back, synchronizing daca730,
its163/1728 full gate, the quota implementation and its first167/1742 full gate.

Additional review reproduced a settled reader promise releasing the account
barrier despite MODEL_CATALOG_CLEANUP_UNKNOWN. The new regression first failed,
then passed: cleanup uncertainty now remains in the account lifecycle across
restart, refuses another query/profile replacement and preserves the database
on shutdown. The full gate briefly caught an exact-optional undefined branch in
this refinement; it was corrected without a suppression. Final default
`mise exec -- pnpm check` passes167 files/1743 tests (80.92s), build/typecheck/
ESLint/boundaries. Logs: /tmp/dispatcher-quota-full-check-latch-final-20261022.log;
targeted quota/service/Pi shutdown3 files/15 tests also pass. The earlier
167/1742 result predates this additional lifecycle assertion.

Real read evidence uses installed Codex0.163.0-alpha.11.1 and a new independent
private Controller directory, existing authorized CODEX_HOME and ConfigPlan.
The first explicit quota query took5.072s and returned error/QUOTA_QUERY_FAILED;
saved GET preserved that error, with0 Tasks/Runs/AdapterSessions. Controller
stopped successfully; source hashes and native auth-file metadata were unchanged.
`account-quota-native-read-20261022.json` retains the report. A metadata-only
instrumented copy of the exact compiled read transport preserved its allowlist,
deadlines and owned drain: initialize38ms, quota response4089ms with result,
child close0 and owned-root absence confirmed (4115ms total). It collected no
account response values or stderr; report `account-quota-transport-20261022.json`.
A further bounded schema-classification read failed NATIVE_QUERY_FAILED before
normalization, report `account-quota-read-failure-20261022.json`. These differing
outcomes do not prove an authentication/network cause or a reliable normalized
account result. No repeated-until-success loop, deadline extension or inferred
balance was used. Real quota qualification remains open; continue independent
price/usage/native integration units with this error state visible.

Quota source was committed as1f3a87f after the167/1743 final gate. MCP HTTP
transport initially blocked the final synchronization. During the CV-07 unit,
INH-1923 was read first, then the1f3a87f/1743 evidence and retained real-read limits
were saved and read back: comment aca14007-7dea-424d-ac91-6a024a36357a. The older
umbrella comment645361e7-20c6-490d-8628-18211cbc3b35 covers the earlier167/1742
checkpoint. A fresh official quota read now reports21% used with ordinary usage
allowed; the intervening unavailable reads were never interpreted as remaining0%.

## CV-07 frozen native price and canonical Run estimate composition

Base5b542be in the same protected isolated worktree. This unit extends the
approved C1/C2 path and reuses the already ported exact decimal engine; no price
SDK, dependency, alternate ledger or public/static price table is introduced.

An owning fresh catalog can provide explicitly classified native-account-model
price evidence for the exact model/parameter choice. Private/unknown fields,
numeric rates, unmatched parameters, inventory basis, cached/unverified data and
native-default with no concrete model cannot acquire a price. Capture uses
canonical decimal strings and bounded public fields. Built-in adapters without
qualified account price producers continue returning no rate.

The admitted snapshot is inside the existing ExecutionSelection: preview exposes
it, reviewHash covers it, and Run/AdapterSession persistence protects it as one
immutable selection. Pre-start refresh compares terms even when catalog revision
does not change. An identical quote with a newer collectedAt preserves the
original reviewed snapshot; different rates require fresh review before native
start. Exact account/model/parameter scope remains the same execution authority.
No old Run or legacy selection receives a backfilled price.

Strict native protocol admits the bounded optional snapshot. New owning Runners
advertise native-model-pricing-v1, and Controller refuses a priced request to a
peer without that capability. Runner also revalidates native price terms before
creation and persists the same snapshot. Price metadata does not create another
native input or a Controller-local replacement for remote work.

Saved per-Run usage now projects through estimateCost using that Run's frozen
price and canonical observations, checking profile/session/generation/attempt/
native identity. BillingTimes derive only from admitted producer-origin native
occurrence, never observedAt/collectedAt. Current catalog updates cannot change
historical estimates. Actual cost metrics remain in their own unit; resources,
account quota and Run state are untouched by the read. Filtered observation
ranges mark complete results partial rather than claiming whole-Run coverage.
Usage UI preserves exact amount strings and shows formula, effective input IDs,
price, completeness, missing reason and rounding; publication review shows the
price before the existing confirmation action.

Additive schema11/frozen_native_pricing_writer_protocol raises writer7 because
writer6 cannot honor startup price review, even though whole-selection immutability
already protects its JSON. Migrations1–10 are byte-identical to5b542be (catalog
entries body SHA25645539329ff89610c2a3a4b5f7d6387adeb1a85c4a03e6d47762c7fac01da825c).
Already-open writer6/raw connections are rejected; inner and outer failed upgrade
restore schema10/writer6/trigger SQL. Source/archive schema10 bytes and writer6
stay intact while only a restored copy upgrades behind its restore barrier.
Existing doctor/backup/upgrade fixtures now test current11 and future12; the
usage-origin gate tests explicitly retain their schema10 catalog assertions.

Observed behavioral RED→GREEN: Adapter allowed malformed/legacy prices; strict
remote catalog and protocol rejected the valid new price field; preview omitted
its reviewed snapshot; saved usage still returned fixed unavailable; cost UI
omitted the amount/reason; and writer6 startup writes were not fenced. New pure
feature tests first failed missing-module import separately. After implementation,
transport/Adapter targets3 files/23 tests, domain/Runner/usage3 files/51 tests,
persistence/doctor/service recovery17 files/129 tests, publication price targets2
cases and existing usage UI5 cases pass. These target selections are not summed
as independent full-suite evidence.

Default `mise exec -- pnpm check` passes build/workspace typechecks/ESLint/
boundaries and170 test files/1762 tests (84.28s). Log:
/tmp/dispatcher-pricing-full-check-20261022.log. All price producers in these
positive tests are scoped protocol/backend fixtures. No real native account
price, service activation, installed-data migration, GUI or release Gate is
claimed. Conditional-free/rate-interval producer admission is still a code path
to complete; the pure engine retains its source assertions but cannot invent
those facts for Controller. This was the pre-review full gate.

Independent review reproduced an Important completeness defect: accepted complete
usage could still show a complete estimate after an unresolved native collection
error. New regressions first reproduced the error, then cover saved partial
amounts for read failures, unavailable amounts for identity/event/source conflicts,
pending reads, source-change precedence and recovery. A real Controller HTTP
fixture additionally reproduced generic USAGE_PARTIAL and later read exceptions
overwriting USAGE_EVENT_CONFLICT. Both writes now preserve the integrity failure
until an admitted recovery. The specific conflict → read exception → valid replay
regression was observed RED then GREEN. UI explains collection failures while
retaining exact saved amounts only as partial. Focused re-review reports no
remaining actionable findings. Final post-fix default `mise exec -- pnpm check`
passes build, workspace typechecks, ESLint, boundaries and170 files/1767 tests
(87.46s), exit0. Log /tmp/dispatcher-pricing-full-check-final-20261022.log.
`git diff --check` also passes. The earlier3-file/97-test target passed before
the extra retry branch assertion and is not a substitute for this final gate.

MCP HTTP transport recovered. INH-1924 checkpoint comment
72a9f2e3-8843-4d44-bd1f-33eba3167ea9 was saved and read back with the pre-review
170/1762 result and the code/real-provider gaps. The quota final evidence is now
also confirmed synchronized as described above. Append the final pricing commit
and post-review gate after verification; do not mark the whole CV-07 card Done.

CV-07 source and reviewed regression fixes are committed as254f866. The worktree
was clean after commit. The final INH-1924 save_comment and INH-1924/INH-1917
readbacks failed again at MCP HTTP transport; success is not assumed. A fallback
through the already authorized Linear desktop app reached workspace search for
INH-1924 but remained Syncing with no issue result, so no UI comment was posted.
CV-06 final comment aca14007-7dea-424d-ac91-6a024a36357a and CV-07 pre-review
checkpoint72a9f2e3-8843-4d44-bd1f-33eba3167ea9 remain the last confirmed reads.
The254f866/170-files/1767-tests final result and umbrella delta still need remote
read-before-write synchronization. This external outage does not block source
work, justify guessing tracker state, or close the open Gates.

Next independent CV-06 increment is owning-Runner account quota forwarding.
Current RemoteNativeAdapter exposes no accountQuota and NativeRunnerRuntime
registers no account-only quota command; canonical usage already has a separate
Run-fenced transport. The account read must remain profile/account scoped and
must not fabricate a Run or borrow its lease. Reuse the existing quota coordinator's
bounded/coalesced reads, TTL/reset, last-success, context and cleanup guards on
both physical owners rather than copying a weaker lifecycle. A pending physical
reader must continue to fence its Runner account registration and shutdown even
if the Controller's transport wait expires. New transport admission and DTO
validation must preserve exact public decimal periods, verify owner/registration
before and after awaits, and leave Runs/resources/native starts untouched.
Qualification requires protocol negatives, malformed/foreign response rejection,
capability/offline checks, pending-context/shutdown regressions, cached GET no
provider traffic, restart preservation, and final pnpm check. Actual remote/native
account evidence remains distinct from those controlled integration tests.

## CV-06 owning-Runner account quota

Base95b4081. The pending254f866 final pricing synchronization subsequently
succeeded after read-before-write: INH-1924 comment
e58c4c90-ddff-4d23-ad22-3ff5338e6ff9 was saved and read back. Umbrella INH-1917
comment59519e3f-1432-4646-a627-3a6a84ada85d was also saved/read back, recording
1f3a87f/1743,254f866/1767 and the new uncommitted remote quota checkpoint.

The existing AccountQuotas implementation is moved from Controller to
packages/runner, with the existing test infrastructure/decimal normalization
reused. Strict public capture helpers are in domain; no third-party dependency,
second Run ledger, static account values or new migration is added. Local-only
execution fingerprints preserve their prior metadata via nativeProfileEpoch in
config; a remote physical owner alone reads its own native-file metadata.

Native account read/refresh uses native-account-quota-v1 and carries only profile
identity/action, never Run/lease/workspace authority or Controller-native paths.
Runner uses the shared bounded/coalesced/TTL/reset/last-success/timeout/cleanup
coordinator and durable generic cache. Controller's existing worker is the one
periodic scheduler. Owner cached reads perform no provider request. The remote
facade validates bounded public state, exact decimal periods and owner/profile/
provider/source context. It preserves native source time, last success and
stale/error state, binding those facts to current Controller registration and
credential context. A successful owner response hiding another context's balance
cannot resurrect the previous Controller snapshot. A wire failure retains a
matching historical snapshot only as error, including its original source scope.

Physical pending/cleanup-unknown readers retain profile replacement and storage
barriers even after a wire wait/deadline ends. Runner registration/native-file
scope is checked before and after await; native account changes hide cached facts
and reject late results. Shutdown/close quiesce admission before preserving an
undrained database, so a failed close is not an open RPC service. A closing Runner
cannot return a prior fresh projection as a successful refresh. Native reads
never enter the canonical Run serialization lane; a held loopback quota query
does not block canonical cancellation.

RED→GREEN evidence: the strict protocol initially rejected the new account-only
command; domain capture and remote result/facade were missing; the prior
Controller cache returned unsupported for owner-state sources. An old peer then
accepted the new command before capability checks were added. Further regressions
reproduced registration removal hashing undefined instead of its busy error,
transport failure losing the retained source fingerprint, and shutdown returning
an earlier fresh owner state. The last close-admission case reproduced another
RPC accepted after storage close refusal, then passed after admission quiescence.
No suppression, skipped assertion or relaxed native deadline was added.

The 9-file/91-test targeted set passes, plus the additional held-quota canonical
cancellation case (selected1 test). First full default check completed build,
workspace typechecks, ESLint and boundaries, but172 files/1781 tests had2 failing
unchanged Pi first version probes (PI_RPC_RUNTIME_UNAVAILABLE after3s):
pi-rpc-client final synchronous cancellation and pi-rpc-read idle projection.
A two-file isolated default-worker rerun reproduced the same2 failures/78 passes.
Serial diagnostic with the exact same tests/deadlines passes2 files/80 tests
(60.84s). Four fresh /tmp-only owned/synchronous version probes all returned1.2.0
in505–612ms with confirmed exit; this does not prove a causal explanation for the
concurrent failures. Native helpers, test deadlines, worker defaults and unrelated
host processes were not modified. The latest close refinement postdates that
first gate; final default check and independent review are now in progress.
Logs: /tmp/dispatcher-remote-quota-full-check-20261022.log,
/tmp/dispatcher-remote-quota-pi-probe-diagnostic-20261022.log,
/tmp/dispatcher-remote-quota-pi-serial-diagnostic-20261022.log,
/tmp/dispatcher-pi-bootstrap-results-20261022.json.

No real native account read or actual remote service was activated in this unit.
Positive sources are controlled backend/loopback fixtures; real-account/provider,
production legacy-origin cutover and native/GUI/release Gates remain open. The
INH-1923 detailed interim save/readback again hit MCP HTTP transport errors; its
new remote-quota delta remains unconfirmed on that issue. Continue source work
and read current comments before the next synchronization attempt.

A subsequent default full check repeated the same2 Pi first-probe failures:
170/172 files and1780/1782 tests passed (61.79s), with all non-test gates passing.
This includes the added stale+error domain regression but its package capture
refinement requires a fresh build for cross-package consumers. The strict state
capture now preserves the existing legitimate stale+error combination after a
retained period resets; fresh+error remains rejected. The domain case was observed
RED then GREEN. A complete serial check using the existing --maxWorkers=1 option
is running with unchanged assertions/deadlines; it is not assumed green merely
because the isolated serial Pi diagnostic passed. No repeated-until-success loop
or provider/test weakening is used. These full failures remain an open regression
verification item while independently verified development continues.

The complete serial check is terminal, exit1: build/workspace typechecks/ESLint/
boundaries pass;171 of172 files and1781 of1782 tests pass (224.87s). The only
failure is unchanged pi-rpc-read.test.ts idle projection's first3s version probe.
Serial execution is therefore diagnostic, not a passing replacement full gate.
Current cross-package owner-state target (domain quota, Controller remote results,
shared coordinator) passes3 files/19 tests, including legitimate stale+error
preservation and retained exact source provenance. The earlier target9/91 and
selected close/cancellation cases remain individually scoped evidence; full
regression acceptance is unresolved and the overall goal/CV-06 stay In Progress.
Log /tmp/dispatcher-remote-quota-full-check-serial-20261022.log. All failures are
retained for unified Pi/version-probe follow-up; no causal claim is made merely
because these Pi files are unchanged by the quota increment.

Independent scoped code review is complete for the CV-06 owning-Runner quota
delta, including untracked modules and final stale/error capture refinement.
No concrete Critical/Important/Minor findings were identified. Review explicitly
withholds merge readiness because the required full check is red, and does not
qualify real providers/services, production origins or native/GUI/release Gates.
This delta is retained as a development checkpoint while R-020 investigation
continues. No default timeout, assertion, worker setting or existing test was
weakened. Linear INH-1923 progress save db7b687b-57cd-4175-8485-2b4858307e79
records the exact scoped passes, full failures and open Gates; its current latest
comment was read back successfully with the same id and body.

## R-020 timing investigation and CV-09 transport continuation 2026-10-23

Quota source checkpoint d5b6871 is saved with the failed full-regression evidence
above. INH-1923 commit receipt d2aaf130-0ee4-4805-aaff-d78148627a6c was read back;
INH-1927 R-020 receipt ef80d94c-aa30-4fcf-8746-0685370a7fcb was also read back.
The quota tool currently returns unavailable; this is not a zero-usage reading.

A temporary event trace of the existing version reader observed spawn returning
and its spawn event in approximately1ms. The first2 selected Pi fixture outputs
arrived at2582/2636ms; close/drain followed within2ms. Another complete Pi target
with that trace passes2 files/80 tests (35.36s), with first outputs725/778ms.
The full default-worker test command with tracing passes172 files/1782 tests
(79.31s). Expected TERM-resistant and aborted probes retain their physical stop
behavior. No unexpected first-probe timeout was reproduced in this diagnostic,
so it neither establishes root cause nor replaces the required uninstrumented
full check. The reader was restored byte-for-byte to committed content, SHA256
88355a1ab778f6231e717ab5886abbf188f74a0482f1d5bfff07a72f634e82c4,
with no remaining diff. All original failed logs remain. Raw /tmp diagnostics:
dispatcher-pi-probe-timing-20261023.jsonl, dispatcher-pi-probe-trace-run-20261023.log,
dispatcher-pi-probe-trace-full-target-20261023.log and
dispatcher-pi-probe-trace-full-suite-20261023.log. R-020 remains unresolved.

Next independent approved CV-09 unit: preserve the committed a499d84 owned Codex
stdio transport as an internal module, without activating a native backend.
Retain exact pinned version/physical home-workspace identity, bounded framing,
request correlation, original-connection callback ownership and local root-only
disconnect semantics. Preserve the two source owned-stdio assertions, three
source native-process disconnect assertions and both version-probe replacement
assertions, with explicit source-to-target mapping. Use the existing owned version
reader and childExecutionEnvironment to meet the target physical cleanup and
Controller authority boundary. Add regression evidence for that adaptation.
Backend/Controller composition follows separately; no registered capability or
real installed Codex qualification is inferred by the internal transport port.
This reuses repository-owned source, adds no external code/package/license and
does not change schema or live account/service/data. Verify RED, focused target,
full uninstrumented pnpm check and independent review before qualification.

The transport subset is now present. Source assertion mapping: a499d84
codex-app-server.test.ts's2 owned-stdio and2 version-probe directory cases plus
codex-native-process.test.ts's3 local disconnect cases map to the new
codex-app-server-transport.test.ts. Remaining backend tests are retained in the
source commit and are not silently disabled in this target. Nine additional cases
cover native authority/context, resistant probe cleanup, root exit with inherited
pipes, response ordering/split UTF-8, callback ownership/consumption/resolution,
unowned callback rejection, pending bounds, oversized frames and version refusal.

RED against literal source transport: fake authority canaries inherited by both
children and version cwd/PWD from Controller; TERM-resistant execFile version
probe still pending after6500ms; pending thread read still waiting after owned
root exited with inherited pipes. Target fixes use shared childExecutionEnvironment
and readOwnedNativeVersion, and fail pending RPC on root exit. No shared helper
semantics or existing deadline changed. Target16/16 passes (6.02s). The initial
full check passed build/types then stopped at one unused test import in ESLint;
the import was removed without suppression or behavioral expectation edits.
The uninstrumented default full check and independent read-only review follow.
Logs /tmp/dispatcher-cv09-transport-{authority-red,context-red,lifecycle-red,
green,target-final,check,check-final}-20261023.log preserve actual outcomes.
Linear INH-1926 get/save attempts currently fail MCP HTTP transport; this CV-09
delta has no confirmed remote receipt yet. Earlier CV-06/R-020 readback receipts
above remain confirmed. Continue implementation with local evidence pending sync.

The final uninstrumented default `mise exec -- pnpm check` is terminal exit0:
build, workspace typechecks, ESLint and boundaries pass;173 files/1798 tests pass
(68.52s). This covers the saved owning-Runner quota code and the new internal
transport. The earlier failed gates and diagnostic-only passes remain retained;
R-020 is an unresolved intermittency/root-cause follow-up rather than a current
red-gate claim. No probe helper/deadline/assertion/worker default changed.
Independent transport review is finishing; no additional broad rerun is required
without a new change or finding. Official quota now reads30% used/70% remaining,
ordinaryUsageAllowed true; it supersedes the unavailable reads, without consuming
any reset. Linear recovered: CV-09 receipt0d985620-eda0-4a02-b897-3742037e1844 and
CV-06 full-gate receipt571b2f4f-d4f3-4581-81c2-b85c760c1ab1 were both saved and
read back with identical ids/bodies. Both issues and the overall goal remain
In Progress for the listed production/native/runtime Gates.

Independent transport review identified one Important local lifecycle finding:
after root exit rejects pending reads, inherited stdout/stderr still left two
local PipeWrap handles until an explicit caller close. The owning backend may
only mark itself disconnected, so that implicit dependency could retain handles
across terminal hosts. A new assertion before explicit disconnect reproduced
5 versus3 baseline PipeWrap handles. Terminal fail now destroys all three local
pipes immediately while retaining the same root-only TERM/KILL and exit receipt;
no detached group/child is signalled and backgroundTools remains unknown.
The16-case target passes again (15.44s), including detached child still alive.
Logs /tmp/dispatcher-cv09-transport-review-pipes-red-20261023.log and
/tmp/dispatcher-cv09-transport-review-green-20261023.log. Final post-fix full check
is now running at /tmp/dispatcher-cv09-transport-review-check-20261023.log.

The same review seat's focused recheck confirms the local-pipe P2 is addressed,
with no residual scoped code finding. The final post-fix full check is RED,
exit1: build/typechecks/ESLint/boundaries pass;169/173 files and1792/1798 tests
pass (85.37s). All6 failures are Pi version-probe admission, now also occurring
mid-file: PiAdapter injected-backend selection; exec-no-proof successful-code
refusal; client final-guard directory recheck; client inherited-close cleanup;
read detached handle identity; read queued-send file recheck. New Codex16 cases
pass in that run. This refines R-020 from first-probe-only to intermittent native
version startup; it does not identify a causal explanation or make the previous
green command disappear. This development checkpoint is not merge-ready until
required regression is qualified. No repeat-until-green gate, deadline extension,
worker-default change, native helper weakening or unrelated host action follows.
The post-review Linear save currently failed MCP HTTP transport, so its new
pipe-fix/result delta is pending synchronization rather than assumed delivered.

Transport checkpoint9c85185 includes the reviewed pipe fix; the new file's final
EOF blank line was removed and full-range/staged diff checks pass. Linear
recovered: post-review result df3378c2-1d77-4c30-81ee-ef042daf6484 and source
receipt fa80ea5d-8ce5-4005-8cd2-de9e10aa4d8f were saved/read back on CV-09.
Umbrella INH-1917 receipt e1dac9b4-a97d-4673-9f0b-ede81456afa4 was saved/read back
with exact current red-gate results, source checkpoints and open Gates.

R-020 /tmp-only six-probe experiment used the unchanged owned version reader,
alternating full Pi and minimal Node fixture scripts. The first full fixture
failed at3031ms with no JavaScript-entry marker; all subsequent probes completed
25–44ms with confirmed exit. A read-only sample of that freshly owned failing
child recorded797 samples at _dyld_start,112KiB footprint and no loaded binary
image description during the observed window. It localizes this occurrence
before Node JavaScript execution, but does not identify the macOS condition that
caused the stall or prove every earlier failure has that cause. Sampling itself
is diagnostic instrumentation, not a production qualification. All owned fixture
roots and sampler children were cleaned; no unrelated process/service or host
policy changed. Raw records: /tmp/dispatcher-owned-version-os-results-20261023.json,
/tmp/dispatcher-owned-version-os-sample-20261023-0.txt and corresponding .mts/log.
The3s guard remains unchanged; R-020 stays open.

Next CV-09 canonical contract work is specified in
docs/superpowers/plans/2026-10-23-codex-native-contract-port.md, implementing the
existing approved CV-02/CV-08/CV-09 scope inline. Codex allocates thread identity
after thread/start, unlike Pi's preallocated UUID. Extend the existing durable
observer explicitly for that real boundary, preserving Pi's default rules, then
port source backend/history/producer assertions to canonical selection and guards.
No new design approval round, production account call or service activation is
required by this authorized development increment.

### CV-09 canonical observer allocation

NativeBindingEvents now has an explicit internal codex-thread identity mode;
the existing reserved default and Pi caller stay unchanged. Only product codex/
backend codex-app-server can request it. A fresh unbound STARTING invocation may
adopt the provider's exact global thread id, while an already bound thread must
match; partial historical identities are rejected. Provider id and binding save
together before the captured durable sink, with original failure latches and
pre/post-await authority checks preserved. No new schema, sink or provider call.

The new helper suite initially observed missing allocation/resume/adoption
restrictions RED. Two fixture mistakes were corrected before implementation:
reserved Pi must actually supply a forbidden thread id to test that refusal;
post-sink authority revoke must start with live authority. No production behavior
was changed to satisfy those erroneous fixture assumptions. The first allocation
implementation passes16 cases; store-failure/sink-revoke/Pi-positive additions
bring the helper to19 and pure helper+selection target to2 files/33 tests.
A combined target is54/55 with one Pi version-probe failure; it is not green.

Two further actual RED cases expose identity overwritten inside final synchronous
admission and an asynchronous guard treated as permission. Reuse the existing
assertAdapterWriteAdmission and check the same current facts before and after.
The pre-fix full check caught exactly those2 assertions (173/174 files;
1817/1819 tests), with all Pi tests passing in that run. The following uninstrumented
full check after that fix passes174 files/1819 tests (83.24s), including all
non-test gates; this is not post-state-fix qualification.

Independent scoped review found one further Important state gap: a currently
unbound invocation could leave STARTING during native creation/admission and
still adopt an id because only its captured initial state was checked. Six RED
cases cover RUNNING/COMPLETED/FAILED before callback and inside final admission.
assertCurrent now requires STARTING until the binding is saved. The current
helper27 cases plus selection14 pass2 files/41 tests. Same-seat focused recheck
and final default full check follow. Logs /tmp/dispatcher-codex-observer-*-20261023.log
retain every RED/target/full outcome, including state-red and state-green.
R-020 remains open despite individual green runs; no helper/deadline/test weakening
or host policy change was made. The OS-boundary Linear update currently failed
HTTP transport and is not assumed delivered.

The same review seat confirms the current-state gap is addressed; no residual
scoped findings. Final post-review uninstrumented default pnpm check is terminal
exit0: build/workspace typechecks/ESLint/boundaries pass;174 files/1825 tests pass
(83.80s), including helper27, all Pi cases and Codex transport16. This qualifies
Task1's local shared-observer increment, not the remaining Codex backend/runtime
or any actual-provider/native/GUI/release Gate. R-020 remains an unresolved OS
startup follow-up with all previous failed logs preserved. No additional broad
test is needed without a new code change/finding. Current Linear interim save
0e7eb03c-c30a-4700-a943-a989075cd27e records the scoped work; final source/full
receipt and readback follow after checkpointing.

Task1 source is saved at10088ad. CV-09 final receipt
0be27fb2-204a-4dbd-9b0d-6fb956c97768 and umbrella receipt
f2b7e5d3-dc9a-4263-93e2-7f2c41178308 were saved/read back. Official quota reads
35% used/65% remaining with ordinaryUsageAllowed true; no reset consumed.

### CV-09 Task2 initial backend port

The remaining a499d84 codex-app-server.test.ts assertions are now present in
packages/adapters/test/codex-app-server.test.ts. Its4 owned-stdio/version-directory
cases already live in the transport test, and3 original native-process disconnect
cases remain there as mapped above; no source assertion is skipped. Initial
target64/64 RED established the missing backend. A source-fixture cleanup defect
was corrected: roots are registered immediately, including constructor failures,
and afterAll removes only owned roots. The initial15 exact-window empty fixtures
were removed only after verifying ownership, birth window and empty directory
layout; receipt /tmp/dispatcher-codex-backend-red-empty-roots-cleanup-20261023.json.

Current uncommitted source ports the remaining original backend behind the
internal module; exported Codex turn/start types now describe its actual native
callbacks/ready/events, and reclaim uses canonical ExecutionSelection rather
than removed modelSelection. Nonblocking events reuse the existing Codex contract.
Adapter default behavior and public backend registration are not yet changed.
The source target now passes60/64 in781ms, with4 expected remaining Adapter
binding/sink/diagnostic and obsolete model-capability projection failures;
`mise exec -- pnpm --filter @dispatcher/adapters build` passes. These are WIP
results, not Task2/full acceptance. Logs /tmp/dispatcher-codex-backend-missing-red-
20261023.log, source-port-20261023.log and build-20261023.log (same prefix).

Next adapt the four cases to current canonical reserved input/observer and
observable usage evidence, preserving their intent instead of adding a legacy
manifest DTO. Add wrong/missing selection/reference and asynchronous final Guard
regressions before integrating CodexAdapter. NativeBindingEvents supplies the
proved codex-thread boundary. Also verify async event sinks explicitly: original
AppServerTurn synchronously projects completion and ignores returned Promises;
the current durable sink returns a Promise. Track those callbacks in the owning
runtime, await admission/terminal durability, retain unknown cleanup on timeout,
and never let a metadata failure enable another prompt or result. Reuse the
existing callback ownership/5s disconnect boundary rather than introduce another
observer or claim background writer release. These adaptations are not yet done.
Keep Task2 WIP/internal and all production/native/GUI/release Gates open.

### CV-09 Task2 canonical backend and durable callbacks

The internal source backend now requires a captured canonical ExecutionSelection,
managed reference and synchronous final guard plus binding/event callbacks before
native I/O. Duplicate model/effort arguments must match the same selection.
CodexAdapter selects its manifest only from an explicitly injected backend id,
uses the existing NativeBindingEvents codex-thread path, awaits readiness and
preserves the saved binding/provider identity. Default exec behavior remains.
Native generic send/resume/cancel are explicitly closed until the command/stop
path is qualified; the original internal backend resume/interrupt assertions
remain. No backend export/registration, ConfigPlan activation or provider call.

All64 remaining source cases are present, alongside the4 source transport cases
and3 native-process cases already mapped to the transport suite. Source fixture
adaptations supply canonical selections/references, reserved execution and the
owning observer; the old modelCapabilities token/cache flags are replaced by the
current observable contract: no tokens or usage observations from unsupported
App Server token events. No obsolete parallel manifest DTO was introduced.

Fourteen new canonical/backend cases first ran RED: together with the retained
source suite17 failed/61 passed (78 total). The async cases showed premature
terminal success, a prompt before received-event persistence and a false drained
shutdown receipt. Binding and event Promises now share runtime ownership; initial
durability precedes inference and terminal durability precedes result settlement.
The raw callback survives cancellation of its local waiter. Disconnect retains
callbacks unknown after the unchanged5s boundary, independently of root exit.
The first implementation passes78/78;8 additional Adapter guard/ownership cases
bring the current backend target to86/86. Targeted adapters build passes after
fixing optional-property narrowing without a type suppression.

Combined observer/selection/backend/transport target:4 files,142/143 tests;
the sole failure is the Codex transport malformed-error case's3s owned executable
version probe (not its malformed-error assertion). Preserve this as R-020
evidence extending beyond Pi, without inferring an exact OS cause. First full
check passes build/typecheck, then fails lint on an unused copied existsSync
import and one inline import type; both are corrected directly. The following
full check and independent read-only review are in progress. No deadline,
worker default, test skip or assertion weakening. Logs use
/tmp/dispatcher-codex-backend-{canonical-red,canonical-green,canonical-build2,
targets,full,full2}-20261023.log. Linear progress3621f6db-ea31-4186-a164-054d473ee8b1
is saved and read back. Official quota38% used/62% remaining; no reset consumed.

Independent read-only review reports2 Important findings: the read handle exposed
a cloned binding but closed over the mutable caller binding, and native
preparation errors escaped not-created classification. Four new RED cases
reproduce both; the pre-fix default full2 reaches174/175 files and1911/1915 tests,
failing exactly those4 cases (86.94s). All probes pass in that run; that does not
resolve R-020. A fifth RED proves that completed-event persistence could overtake
an admitted, still pending running-event sink. Each turn now submits its facts
through the same ordered sink path; earlier failure prevents later success.
The raw pending sink remains owned independently of the cancelled local wait.
The focused backend/observer/selection/exec/write/catalog/quota target passes
7 files/164 tests, including91 backend cases. Read-handle identity and ordering
fixes pass the same review seat's recheck.

That recheck identifies a remaining narrow pre-invocation edge: the invocation
flag is set before evaluating a store read in backend.start arguments. A store
failure there is still known unsent. Move input construction before the flag,
with a direct regression, after current full3 terminates; full3 cannot qualify
the final correction. No activation/merge readiness is claimed. Progress
9f1148f3-0553-4bea-a9d8-773bcdd3fee0 is saved and read back on CV-09.

Full3 terminates exit0 with175 files/1916 tests (82.16s), including every
non-test gate. The narrow argument-evaluation correction follows its own RED:
1 failed/91 passed, confirming backend.start was never called. The complete
backend input is now constructed before marking invocation. Post-fix target
4 files/130 tests passes, with92 backend cases. Same-seat focused recheck finds
no residual issue and approves the scoped code; final full4 remains required
for this exact version. No broad rerun is for retry-to-green: every rerun
followed a concrete code/test correction, and all earlier outcomes are retained.

Final full4 on the reviewed input-evaluation correction terminates exit1:
build/typecheck/lint/boundaries pass;172/175 files and1914/1917 tests pass
(84.65s). The3 failures are Pi version probes before their intended assertions:
pi-rpc-client Promise guard, pi-rpc-execution bounded consumer settlement and
pi-rpc-read port-file-outside. Codex backend92 and transport16 pass in this run.
The current whole-branch gate is RED, with no cause/fix claim for R-020 and no
retry-to-green. Preserve full3's175/1916 as pre-final-correction evidence only.
Task2 has scoped implementation/review evidence but remains unqualified by its
required final full gate. Save an explicit development checkpoint and proceed
with independent parent-plan work; no merge/service/provider promotion.

Task2 development source is saved at7c6e4bd. CV-09 receipt
72dfb630-66fa-4519-aa37-b31d06e89823, umbrella6705637c-a3f4-421b-b5a5-d2d10f95f496
and R-020/Pi7d1527c4-c00d-48d0-8cd3-32b517179324 are saved and read back.
Official quota40% used/60% remaining; no reset consumed. Task2's final required
whole-branch regression remains unqualified at this checkpoint.

### CV-09 internal per-execution host port

Plan2026-10-23-codex-runtime-host-port reuses a499d84's CodexExecutionRuntime,
current NativeRuntimeHosts and the canonical backend. All24 original host cases
are migrated, supplying the current selection/reference/guard/event callbacks
and explicit absolute fake executable without a real native process. The missing
module first fails suite loading RED; source port with those fixtures passes24/24.
The package index now exports only the backend/types consumed by the actual
internal host; no profile/config/Controller registration or capability promotion.

Ten new cases reproduce selection mutation, async owner/prompt guards, directory
replacement, stale durable binding and known-unsent cleanup gaps. A fixture
diagnostic was fixed before implementation: Chai's failed object display calls
the backend's public inspect method as custom inspection, causing2 artificial
unhandled rejections. Assert the same undefined-source boolean without formatting
the backend; the corrected RED is10 failed/24 passed with zero unhandled errors.
Physical home and workspace now capture path/dev/ino; scope fingerprints include
the same canonical reference/physical identity. Runtime selection is cloned and
must remain identical on reuse. Source lookup checks the exact durable binding
and physical scope before/after the owning lookup.

Known-unsent cleanup uses the actual backend receipt. The first cleanup fixture
incorrectly expected a transport disconnect despite transport never being opened;
it now checks the backend cleanup and absence of RPC acquisition. An additional
unknown-root receipt case proves the host barrier remains. Another RED shows a
Promise-returning original mutation authority was hidden by its wrapper; the
wrapper now reuses assertAdapterWriteAdmission. A separate factory foreign-store
RED requires the host's exact binding scope before durable projection or prompt.
Current37 runtime cases pass, preserving24 source plus13 new cases. Combined
runtime/Pi/backend/NativeRuntimeHosts target passes4 files/172 tests. Controller
build and scoped lint pass (build before the last factory-binding addition);
the current default full check and independent read-only review are pending.

Logs: /tmp/dispatcher-codex-runtime-{missing-red,source-port,canonical-red,
canonical-red2,canonical-green,canonical-green2,authority-red,factory-red,
targets,targets2,build,build2,lint,lint2,full}-20261023.log. No production account,
GUI, data or service operation. CV-09 progress0f58b684-c938-4ac2-a29b-214bebeab4fd
is saved; readback follows. R-020 retains every previous failed probe and its
unchanged deadlines; this internal host does not resolve the OS startup cause.

Progress0f58b684-c938-4ac2-a29b-214bebeab4fd is read back. The first exact runtime
full check terminates exit0 with176 files/1954 tests (81.93s), including all
non-test gates. No deadlines or worker settings changed. Quota43% used/57%
remaining; no reset consumed. Linear78b6c64b-6e14-486e-bfae-b1fa58e58a8d records
that pre-review-correction result without promoting it to final acceptance.

Independent scoped review found one Important post-lookup race: bindingFor could
synchronously begin shutdown and return the exact binding, while source still
returned its port and request metadata could reach the sink. Two RED cases
reproduce it. Source now captures the input binding and rechecks closed state,
current map entry, registered/persisted identity and physical directories after
the injected lookup. Focused4 files/174 tests pass, including runtime39 cases
(24 original plus15 regressions). Same-seat inspection reports no remaining
finding; final post-fix default full2 is running. The earlier176/1954 full check
does not cover this final correction. Controller/profile activation and all
actual native/GUI/service/release Gates remain outside this unit.

Final post-review full2 terminates exit0: build/typecheck/lint/boundaries pass;
176 files/1956 tests pass (82.21s), including runtime39, backend92 and all Pi
cases. This exact source includes the source-lookup shutdown correction and
the clean same-seat recheck. The completed local backend/host contracts do not
complete CV-09: native-profile/ConfigPlan/catalog context, Controller/Runner
activation, selected-source/history qualification and real native/GUI/service/
release Gates remain. R-020 retains its prior intermittent failures; the current
gate is green without an OS-root-cause resolution claim. No additional full
rerun is needed without a new code change, failure or material concern.

Reviewed host source is saved ata0d3d9f after backend7c6e4bd. Final CV-09 receipt
38b31d01-06d9-4c86-b3e3-0551565135a4 and umbrella550ab817-24d1-41f1-b42d-6ffad2906254
are saved and read back with that source and1956-test result. The goal remains
active/incomplete. Next concrete unit is ConfigPlan/native-profile/catalog backend
context plus Controller/Runner source and shutdown composition, preserving the
current generic native-mutation denial and separate real-provider qualification.

### CV-09 composition Task1: registration and catalog identity

The next composition plan2026-10-23-codex-runtime-composition retains Task2 as
the necessary Controller/Runner startup/source/shutdown work. Task1 now accepts
the actual compatible codex-app-server/provider pair through confirmed ConfigPlan,
embedded managed-worktree execution and explicit absolute executable/home paths.
Native login rejects credentialRef for this opt-in only; historical exec profiles
retain their existing credential contract. Pi's existing pair/model rules remain.
Structural native-profile creation requires the configured host, rejects wrong
or absent hosts and forbids injecting App Server without applied opt-in. Missing
runtime does not fall back to exec; the existing ConfigPlan engine restores the
prior runtime after apply failure. Task1 itself does not supply that runtime.

CodexAdapter now supplies its actual backend to the existing catalog reader.
The reader captures the profile/context/backend before awaits, rejects foreign
account and unsupported backend before I/O, and includes backend in fingerprint
and content revision. No native candidates are promoted into entitlement/price
or runtime confirmation, and no stored historical selection/catalog is rewritten.

Initial contract target is RED12 failed/21 passed. After adaptation, combined
Codex/Pi config, factory, catalog and execution-selection target passes5 files/81
tests. Build/typecheck/lint/boundaries plus first default full check pass177
files/1981 tests (82.17s). A final self-review regression demonstrates a known
foreign backend could still evaluate a factory before unconditional rejection;
the corrected guard now precedes construction. That regression is RED1/7, then
the combined target passes5 files/82 tests. Independent read-only review reports
no remaining actionable findings. The post-ordering-fix full2 is pending; the
177/1981 pre-fix pass cannot qualify this final correction. All logs use
/tmp/dispatcher-codex-composition-{contract-red,contract-green,contract-green2,
contract-lint,contract-full,factory-red,factory-green,contract-full2}-20261023.log.
Linear progressc341701b-ffa9-4efc-84e4-27fbea7bd008 is saved/read back. Quota47%
used/53% remaining with no reset consumed. R-020 prior failures remain retained;
no deadline/assertion/worker/retry policy changed and no real account/config/
service operation occurred. Task2 service composition and all original real Gates
remain incomplete rather than being replaced by this static prerequisite.

Final post-ordering-fix default full2 terminates exit0 with177 files/1982 tests
(86.66s), plus build/typecheck/lint/boundaries. This exact version includes the
zero-factory-call regression and the clean scoped review. Task1's local static
contracts are verified; Task2 remains required and unimplemented. No fresh full
rerun is needed without a new code change or concern, and R-020 is not declared
causally fixed by this green check.

Task1 source is saved ata007205. Final CV-09 receipt
1451ce9d-cf36-4b9b-ac0f-6cbeca502a89 and umbrella1e9c73f7-2eff-43ad-9b3e-e6fc47dabb46
are saved and read back with source and1982-test evidence. No unfinished source
edit or native process is left by this unit. Next Task2 must preserve the full
a499d84 codex-runtime-service assertions, adapting the old publication fixtures
to canonical selection/observer authority rather than accepting legacy DTOs.
Current CodexStartInput.commandId carries the Adapter's nativeInvocationId;
it is not the NativeInteractions native-start journal command id. Correlate the
managed workspace/Run/session/observer and keep the original beforePrompt guard.


### 2026-10-23 Codex Controller composition (Task2, work in progress)

Base7d4d799. The complete a499d84 codex-runtime-service source has59 expanded
cases. Fixtures now supply the existing immutable execution selection, frozen
run-contract, managed execution reference and original observer guards. Legacy
publication DTOs were replaced with the current v3 review/commit flow (HTTP200
normalized receipts); assertions load the exact Run by receipt.runId. Generic
source send/resume is deliberately denied by the already-frozen native command
boundary; internal exact continuation remains covered in the host/backend suites.
The three idle-account replacement cases explicitly terminate their canonical
fixture Run before expecting replacement, preserving the current active-Run
configuration guard without inferring writer release from native turn completion.
The existing CLEANUP_UNKNOWN code is retained. No source case is skipped.

Initial configured-host RED reproduces CODEX_RUNTIME_UNAVAILABLE. Composition
then moves54failed/5passed through14failed/45passed,2failed/57passed and finally
all59 source cases passing. Added8 regressions cover unknown-only restart,
four corrupt restart records, mixed Pi/Codex failure isolation and an original
UNKNOWN creation that cannot replay or reopen after persistence failure. Final
scoped native composition run has67 Codex cases and14 original recovery cases
passing; the sixth combined run has86/87 overall because one unchanged Pi
startup probe fails around3s before its intended observer assertion. Earlier
fifth run had84/84 before the final3 new cases were added. This is retained R-020
evidence, not a cause fix or a retry-to-green policy.

Current implementation owns exact scoped hosts/factories and actual backend
shutdown receipts, uses the original managed Run/invocation/lease/observer,
coalesces qualified read metadata and exact original approval callbacks, allocates
durable epochs and settles startup ingress only after canonical projection.
Closed cleanup receipts and observation invalidation commit atomically; failures
retain the closed host for durable-only retry. Restart accepts consistent bound
canonical Codex metadata for unknown/manual read reconciliation; partial or
conflicting data remains preflight-blocked, with no native reattachment/replay.

Logs: /tmp/dispatcher-codex-service-{composition-red,composition-first,
composition-second,composition-third,restart-red,composition-fourth,
composition-fifth,composition-sixth,full,full2}-20261023.log. The first defaultfull
passes build/typecheck, then reports one new test-only consistent-type-imports
lint error. A malformed local Python edit did not apply the intended correction,
so full2 retains the same lint failure; the ordinary import is now corrected
(no suppression). Independent read-only review and the final default gate are
pending. Real installed protocol, account, GUI, writer-release, service and release
Gates remain open; parentCV-09 and the full goal are incomplete. Native-history
API/service and other provider composition remain separate source-disposition
work, not silently claimed here.


Review/final-gate follow-up: the full3 exact source default check ran178 files/
2049 cases in89.01s and retained3 real regressions (frozen contract omitted on
native-summary failure/historical records; an unbound profile capability query;
new observer worker decoding10000 unrelated terminal Run documents). Existing
assertions were not changed. Summary now keeps the frozen contract on both paths,
protects legacy missing-session records and queries capabilities only for a
binding. The worker uses existing SQL listRunsMatching before decoding, restoring
zero unrelated decodes in the unchanged10k-history test.

Independent read-only review found2 P2 issues: the contract omission and accepting
foreign canonical Session provider/Codex product/region/thread/parent/control
shapes at restart. A focused RED run confirms7 failures and4 passing prior cases;
6 new corrupt variants plus the frozen-contract assertion fail before fixes.
An additional mismatched Adapter thread test already rejected before the fix and
is retained as defense regression, not falsely described as new RED evidence.
The recognizer now checks exact canonical provider, all binding copies and Codex
shape plus control row/counter consistency before any restart writes. The scoped
review rechecks both fixes with12 focused cases passing and no residual findings.
Executor accepts its declined installed/account/GUI/writer/service/release and
R-020 items as their original separate Gates; no requirement is dropped. The final
default check remains required. Focused final composition plus existing metadata,
recovery and history regression suites pass5 files/96 cases; Codex service has
74 cases (all59 original groups plus15 new cases). No source skip/loosened
assertion, lint suppression, timeout or worker/retry policy change was introduced.
Current Linear progressdad8b8b4-c65a-4089-a885-0c30f8508e35 is saved/read back.
Quota52% used/48% remaining; both reset credits unused.


Final Task2 source gate: defaultfull4 terminates exit0 with178 files/2056 tests
in87.11s plus build/typecheck/lint/boundaries. No source/test changes followed;
only evidence/plan/disposition notes are being finalized. The scoped review is
approved after both P2 fixes, and all full3 regressions remain covered without
changing their original expectations. Task1+Task2 composition is locally complete;
CV-09, native-history/OpenCode and original real Gates remain In Progress. This
checkpoint neither fixes R-020 causally nor promotes any fixture capability to
actual account/installed protocol qualification. No push/merge/PR/deploy/native
account operation, persisted-format change or dependency addition occurred.

Task2 source saved ate9f6329. Final CV-09 receipt2b4eee65-40e7-4b0d-b59d-1a70a20a0eca
and umbrella0344087c-9049-40cf-ad67-11a48e1d88bd are saved/read back with source
and2056-test evidence. Quota54% used/46% remaining; reset credits unused. Continue
the dependency-ready retained native-history reader/API using the saved follow-on
plan. Its source service110 lines and original tests80 lines are available from
a499d84; actual target files were absent at this checkpoint, not silently complete.


### 2026-10-23 bounded native history service/API port (in progress)

Basee9f6329. Reused the110-line same-repository a499d84 NativeHistoryService and
all27 expanded source cases without removing or changing their assertions.
Missing target module RED is retained, then27/27 pass with the preserved source.
Added16 API cases first fail because the route is absent, then pass after exact
Controller source/NativeInteractions composition: selected execution only,
auth before read, default50/max100/native cursor, no transcript persistence or
native input/replacement, unknown unqualified reads, malformed queries, original
adapter/runtime/generation/lease/selection/reference/shutdown drift and authorized
terminal history. The existing manual canonical fixture now names its local
project, as required by real history authorization, without production DTO changes.

Own review reproduces one queued-read gap: immediate scope revocation still
called history once despite a forbidden response. A new RED case now passes after
recheck at actual queued read admission. Independent read-only review confirms a
P2 timestamp normalization gap: Date.parse can accept parenthesized credential
text that the generic reader returned unchanged. Three credential-bearing date
cases reproduceRED; safeMetadata now rejects the whole page while retaining the
existing length/date constraints. Actual Codex omits this field and Pi has an
additional timestamp-prefix guard; this is a core reader fix, not claimed as a
proven current Codex/Pi end-to-end leak. Original assertions remain unchanged.

Current target has31 reader and90 service cases; focused6-file/143-case checks
pass. The first default full passes179 files/2100 cases (87.54s) before the3 new
timestamp regressions/fix; final full2 and scoped review recheck remain required.
Logs: /tmp/dispatcher-native-history-{red,first,api-red,api-first,admission-red,
targeted,timestamp-red,targeted2,full,full2}-20261023.log. No skips, weakened tests,
new deadline/worker/retry policy, native/account action, dependency or persisted
format change. Current Linear447c9f9c-f035-4d86-9072-0678dcb14071 is saved/read back.
Review's actual-provider/cursor/service/GUI/writer/release limits are accepted as
existing separate Gates; the parent CV-09 and overall goal remain incomplete.


Timestamp P2 is fixed and independently approved:3 new RED dates now reject via
safeMetadata while keeping length/date parsing and ordinary ISO values. Focused
final history/regression suite passes6 files/143 tests. Finalfull2 passes all
non-test gates and2102/2103 tests in87.95s; its sole failure is a transport fixture
publication race at codex-app-server-transport.test.ts:90 (Unexpected end of JSON
input after observing reply.json existence), distinct from the retained R-020
startup-probe issue. The child wrote directly to its observable JSON path, so the
parent could see an empty file during write. Only that fixture now writes a
sibling temporary file then renames after completion. Original callback-once,
exact receipt, timeout and worker assertions/settings remain unchanged; production
transport is untouched. Scoped review approves this synchronization fix, and
transport+reader+service checks pass3 files/137 cases. An API assertion also keeps
ordinary ISO timestamp metadata unchanged. Finalfull3 is running after the
fixture correction, not an unchanged-code retry to green. No original failure log
is discarded. Actual provider/cursor and native Gates remain separate; the
executor accepts those scoped-review exclusions without promoting their status.


Final native-history source gate: defaultfull3 exits0 with179 files/2103 tests in
86.37s, plus build/typecheck/lint/boundaries. It contains the timestamp safe-metadata
fix, ordinary ISO API preservation and atomic child receipt publication. No source
or test edits followed this check; only final evidence/plan/disposition notes.
Scoped review has no residual findings. The native-history increment is locally
complete, while parentCV-09/OpenCode and all original actual Gates stay open.
Current Linear19a8a185-939f-4953-9b0e-5cc542fdc7d0 is saved/read back. Quota57%
used/43% remaining with both reset credits unused. The source manifest remains503
rows; no synthetic source entry or real capability promotion was added.

Native-history source saved ate583f77. Final CV-09 receiptac528c30-2bd3-4073-be51-8f1b322aee71
and umbrellad5b29685-7d10-41d2-938c-65909f5b9020 are saved and read back with the
exact source and2103-test evidence. The managed checkout has no remaining source
WIP or root test session. Continue the preserved OpenCode backend/host/service
source (a499d84:424/64/21 lines respectively) and its original assertions via
canonical selection, exact ownership and ConfigPlan; these files are not yet
ported or qualified. Do not mark the overall goal or CV-09 complete, reset quota,
activate real native accounts, or weaken pending original Gates from this receipt.

### 2026-10-23 OpenCode bounded server preservation (locally complete)

Source5698afa63e163855668fb875e16faca61349e09a reuses a499d84's server and all145
expanded direct cases:59 server /49 lifecycle /7 interrupt /30 turn-result.
Canonical fixture adaptations are explicit: current Runner import; independently
registered original managed refs and ExecutionSelection for attach; canonical
selection mutation; waiting before input instead of an unearned received fact.
The last two suites are unchanged. Added32 regressions yield177 focused cases.
Captured original repository/base/ref authorizes attach, not incoming request
fields; context-free reads cannot become attachment authority by re-registration.
Async waiting follows durable binding and precedes prompt; received follows native
accepted input and persistence failure fences the port. Project identity is
pinned and stable foreign sessions rejected; pending approvals are checked during
prompt preparation. Local callbacks remain owned; native writer release unknown.

Original missing-module RED,42-failure canonical/async regression RED and narrow
exactOptionalPropertyTypes failure remain in /tmp/dispatcher-opencode-{original-
missing-module-red,contract-red,adapters-typecheck}.log. Focused177 passes and
adapters typecheck/scoped lint pass. One final-code default mise exec -- pnpm check
exits0 with183 files/2280 tests88.19s plus build/typecheck/lint/boundaries; complete
log /tmp/dispatcher-opencode-full-check.log. Tests ran on cde9407 plus the saved
production/test payload; only plan/report text followed verification. No skipped
assertion, deadline/worker change, probe cache or unchanged retry. Independent
fresh-context spec and quality review approves with no findings; original145 and
saved logs checked, no duplicate suite run. /tmp/dispatcher-opencode-server-review-
20261023.md is the scoped report. R-020 historical failures are retained unchanged;
a green current gate is not a causal fix or fixed-service/runtime qualification.

Only standalone optional readonly injection is restored here; no server execution
profile/factory/ConfigPlan/catalog/Controller activation. Continue owned server+
producer and original20+20 cases through the next explicit plan, then runtime/
service12+8 and actual backend catalog identity. CV-09 and goal remain incomplete.
Official quota64% used/36% remaining; ordinaryUsageAllowed=true; reset credits2
unused. Linear startup6fb45a4d and focused31cdf2ca plus source/full e666364f-
209d-4496-862d-abbc2a74d5fb saved/read back; final reviewed receipt follows.

Read-only next-unit inventory (/tmp/dispatcher-remaining-native-inventory-20261023.md)
distinguishes existing equivalents from missing filenames/stale pending labels.
After OpenCode: restore qualified protocol dependencies/license and root-only
ownership; Devin ACP/client/catalog/runtime/config/service; Copilot committed
modules then8 separately frozen WIP files (hashes verified against manifest);
Cursor locator/resume protection; existing Devin v3 hardening; canonical history/
capability/control UI; native retention/delivery assertion gaps; CV-13/14 evidence.
These are development units, not passed external Gates or permission to enable
cloud work. Preserve the frozen503-row source list and record actual mappings.

Recorded rulings: terminal durability stays in the execution wrapper that owns its
sink; optional original-context registration preserves readonly consumers while
missing context closes attach; optional standalone read injection does not enable
a server; broad whole-branch review/integration remains at parentCV-14 after all
development and local task reviews. If wrong these cost bounded consumer/context
or cross-boundary rework; no native authority is granted by the rulings. Retain
SDD reports/ledgers until that final review rather than finishing the branch now.

### 2026-10-23 OpenCode owned host and canonical execution (locally complete)

Source105ef8bc3c149c0b5b28a57a6f9276831c06e5fd plus reviewed compatibility
fixa0096262f12e7c0bbe4c12083dae0bd9623fc550 preserve all20 owned-host and20
execution source cases with canonical selection/observer adaptations. Current
owned23/producer82/shared-observer66 include captured sanitized environment,
root/group/natural-stream distinctions, sticky unknown cleanup, raw callback
ownership, binding-before-prompt, durable terminal facts and pending-create
uncertainty. Exact allocated opencode-session observation is separate from Pi's
reserved and Codex's thread shapes; existing27 observer cases remain unchanged.
Internal typed server execution is injected explicitly; no applied server
profile, catalog qualification or Controller activation is inferred.

Independent review found one Important prompt-bound regression and two Minor
executable-bound/factory-receiver regressions. RED producer82 records8 failed/
74 passed (exit1);3 production lines restore262144 UTF-16 units,4096 safe
executable characters and the original factory receiver. Added13 regressions
preserve accepted ASCII/CJK/surrogate inputs and reject actual oversized values
before factory/I/O. Scoped fix re-review passes round1/5, all3 addressed, no new
finding: /tmp/dispatcher-opencode-owned-execution-rereview-20261023.md.

Retained gates are distinct: initial185/2410 exit0; pending-create RED exit1 then
185/2411 exit0; fix1 lint no-this-alias exit1 before tests, then changed receiver
test observation without suppression and final185/2424 exit0. Final focused4files/
247 tests9.14s and scoped lint pass. Final default mise exec -- pnpm check passes
build/typecheck/lint/boundaries and185 files/2424 tests87.92s (wall98.485s).
Evidence: /tmp/dispatcher-opencode-task1-fix1-logs/full-check-after-receiver-style
{.log,-source.json,-result.json}; earlier logs/manifests remain separately saved.
Root compares all11 source/test/architecture/know-how Git blobs to the final gate
SHA256 payload: exact match. Only documented plan checklist/evidence text changed
afterward. No suite rerun by reviewers, skipped/loosened assertion, timeout/worker
change, probe cache or unchanged-code retry. R-020 remains a separate unresolved
historical native-probe issue, not resolved by a green current gate.

Ruling: fix both Minor same-path constructor compatibility issues together with
the Important source-contract regression because dependent runtime/config must
receive one consistent constructor. If wrong, cost is bounded constructor/test
rework; no native authority change. Broad review remains parentCV-14; retain SDD
artifacts. Next canonical OpenCode catalog plan preserves31 source invariants on
AccountModelCatalog, then scoped runtime12/service8 and explicit configuration.
No dependency/persisted-format or real account/native/service activation occurred.
CV-09 and goal remain incomplete. Official last quota79% used/21% remaining,
ordinaryUsageAllowed=true and2 reset credits unused. Linear fix source receipt
fec84563-dac7-4922-804c-1eb5ecfa485c saved; final reviewed receipts follow.


### 2026-10-23 canonical OpenCode catalog (locally complete)

Source0208bffab9805d7321acf6958246ee39d7620baa preserves the current canonical
AccountModelCatalog/ExecutionSelection boundary and actual backend identity for
standalone and explicit internal server injection. All31 source safety groups
are mapped below;71 new owned fixture cases augment unchanged CLI/selection
assertions. Reader captures original method/receiver/profile/context/signal and
sanitized native account environment before awaits; physical workspace/account
before resolution, executable physical target/alias/stamp before spawn. It pins
PID/version/native project, safe selectors/eligible defaults and final context
after actual group/stream cleanup. Native project identity stays separate from
canonical repository identity, no native reasoning/access/prices are invented.
Relative effective account locations reject before I/O rather than choosing a
different parent/child account. Optional native project strings preserve512 range;
canonical model/composite selectors remain240. Existing material label/config
revision, enabled filtering and native2.0.26 catalog schema pin remain explicit.

Final default mise exec -- pnpm check exits0:186 files/2495 tests91.05s,
wall101.969s, build/typecheck/lint/boundaries pass. Root verifies all10 committed
source/test/docs/tooling Git hashes equal final manifest and raw log SHA256
7047cb3001f22b3605f7e22afdf9179c57e3a04324bd03580f1c756c34921fd5. Final report:
.superpowers/sdd/2026-10-23-opencode-catalog-port/task-1-report.md. Saved evidence:
/tmp/dispatcher-opencode-catalog-task1-logs/full-gate-final{.log,.manifest.json,
.sources/}; all21 run logs and210 saved source payload hashes verified. Earlier
payloads reconstructed from recorded edit commands match original per-run hashes;
this is historical integrity evidence, not independent native qualification.

Preserve initial36fail/19pass RED, getter single-capture RED, native-project512
range RED, relative-account-path RED, real root-loss EPERM diagnostic and4 lint
errors separately. No existing assertion/timeout/worker is weakened. The first
complete186/2495 pass precedes a real disabled-default fixture strengthening:
that ID now exists in raw inventory but is ineligible. Focused2files/90 passes,
then the distinct final full gate verifies this final test payload. No production
change or unchanged-code retry was used between those successful full checks.

Independent report /tmp/dispatcher-opencode-catalog-review-20261023.md approves
spec and quality with no Critical/Important/Minor findings, no suite rerun.
Cannot-verify items resolved as explicit other units/Gates or evidence limits:
actual provider/account/GUI/Controller/writer/service/P4/release are not promoted;
deterministic unmocked root-exit success is not claimed. Controlled cleanupunknown
and known socket-loss fixtures prove their exact rejection paths. Shared owner
was unchanged; root-loss uncertainty and R-020 remain separate. Original source31
bodies/invariant inventory were read by root; final current assertions reviewed.

CV09 reviewed receipt0a21c720-a16b-4361-8fcd-796fec135aa9 saved; final coordinated
readback follows. Previous owned final CV09 receipt6c15965b-0ff4-4bdc-87dd-55ae680b2ecd
and umbrella48dd5fe5-7c66-46dd-83aa-8ac8b3d3baab are saved/read back. Latest official
quota89% used/11% remaining, ordinaryUsageAllowed=true,2 reset credits unused;
authorized continuous execution continues. Source list remains503 frozen rows.
Next is scoped runtime12/service8, explicit registration and Controller/restart
composition, then remaining native/UI/retention/delivery units. Whole-branch
review/integration stays parentCV14; no server profile/native account/service
activation, dependency or persisted-format change in this increment.

#### Source31 durable assertion disposition

Source is `a499d84:packages/adapters/test/opencode-catalog.test.ts`, with IDs/line groups from `/tmp/dispatcher-opencode-config-catalog-composition-20261023.md` section 1. C denotes new `packages/adapters/test/opencode-catalog.test.ts`; CLI denotes unchanged `cli-catalog.test.ts`; ES denotes unchanged `execution-selection.test.ts`. IDs describe invariant groups, not a claim that obsolete DTOs or 31 one-to-one test titles were restored.

| ID | Source invariant | Current assertion/disposition |
| --- | --- | --- |
| 1 | Composite selector / safe fields / native default effort | C safe-only fields exact entry assertion; slash-containing native/model preserved; CLI existing enabled-text test retained. Empty options/unknown billing, no manufactured native-default reasoning. |
| 2 | Time/order/labels/backend/default revision | C time/order fixed-fingerprint test; labels intentionally material; actual backend normalizer+reader tests and native default identity material test. Raw configuration order stays material. |
| 3 | Empty model list | C malformed table `empty`, reader empty-bound test. |
| 4 | Duplicate model | C malformed `duplicate` plus unchanged CLI duplicate assertion. |
| 5 | Disabled-only model list | C malformed `disabled-only`; C exact safe-field mixed-enabled test plus unchanged CLI filtering preserve current mixed-disabled policy. |
| 6 | Empty native model ID | C malformed `empty id`. |
| 7 | Provider ID containing `/` | C malformed `provider slash`. |
| 8 | Native model ID containing `#variant` | C malformed `model variant`, plus provider `#` rejection; slash within model ID remains valid. |
| 9 | Invalid modality array | C malformed `modality array` and `modality value`. |
| 10 | More than 4000 models | C malformed `4001` and exact permitted 4000 test. |
| 11 | Nontext filtering/default membership/absence | C nontext-only rejection and mixed filtering; native default missing/disabled/variant rejection (disabled ID is explicitly present in raw inventory but filtered from eligible entries); absent undefined/null accepted with no public isDefault. |
| 12 | Fresh readonly host/exact backend/project/cleanup before success | C owned cwd/PWD/route/query/auth assertions, two backend fingerprints, exact owning Adapter pair, cleanup marker before returned success; unchanged CLI real-host cleanup test. |
| 13 | Startup/read failures cleaned/redacted | C malformed-handshake, spawn-permission, bad JSON/native HTTP error and filesystem failures with exact safe messages/cleanup; unchanged CLI cleanup/version assertions. |
| 14 | Version unsupported | C 2.0.22 catalog rejection and dropped credential-table schema rejection as NATIVE_VERSION_UNSUPPORTED; unchanged future-version CLI fixture. Execution version support is not copied. |
| 15 | Catalog not ready | C thirty-empty-read count, safe unavailable, confirmed cleanup; bound not expanded. |
| 16 | Model catalog changed | C double-read changed-model response rejects NATIVE_CONTEXT_CHANGED with cleanup. |
| 17 | Location mismatch | C wrong location, foreign model/default project and changed supplied project directory tests; final native project change test. Uses current safe/context errors. |
| 18 | Server identity changed | C wrong initial PID and late PID change final handshake; version checked at both handshakes. Owned process handles, not API PID, retain cleanup authority. |
| 19 | Native schema invalid | C bad JSON/model shape/modality, unsafe selector and account-schema cases; safe current categories replace obsolete source aliases. |
| 20 | Local connection closed | C real socket-loss generic unavailable+cleanup, admitted stalled-read exact cancellation+cleanup, controlled root-loss uncertain-cleanup case; unchanged CLI stalled-read fixture. |
| 21 | Reconciliation required | C controlled root-loss asserts one PID/one model read, exact cleanup-unknown and no candidate; original-signal cancellation before spawn and during cleanup cannot return late success. No replacement host path exists. |
| 22 | Unknown native code never published | C unknown HTTP native code, plain resolver error and actual AdapterContractError unknown-code cases map to static generic unavailable, with private text absent. |
| 23 | Duck-typed known code untrusted | C Error with code=NATIVE_VERSION_UNSUPPORTED remains generic unavailable; actual known own instance keeps only safe allowlisted category/message. |
| 24 | Usable read + unknown cleanup rejected | C cleanup uncertainty `success` executes real drain, then controlled unknown rejects exact MODEL_CATALOG_CLEANUP_UNKNOWN. |
| 25 | Unknown cleanup overrides known failure | C cleanup uncertainty `known failure` after unsupported native version; exact cleanup category wins. |
| 26 | Physical context before executable resolution | C resolver replaces physical workspace and gets NATIVE_CONTEXT_CHANGED without host; C physical executable vs alias argv check and cleanup alias retarget rejection. |
| 27 | Logical scope frozen across resolution | C reader receiver/context/profile/backend/path/signal/environment mutation test, executable getter read-once RED/GREEN, Adapter definition resolver receiver+cloned-profile test, account metadata change during resolution rejection. |
| 28 | Account-only/invalid project context no executable query | C relative-account-location regression asserts zero metadata prepare/resolver/host I/O; six invalid-context/backend variants reject NATIVE_CONTEXT_CHANGED before resolver and requests; canonical repository/execution context fields remain mandatory. |
| 29 | Typed backend-specific catalog/selection / standalone retained | C actual OpenCodeAdapter standalone/server pair asserts actual manifest/backend, supportsExecutionSelection, safe canonical entries; direct normalizer/reader default remains standalone. CLI/ES preserve standalone selection behavior. |
| 30 | Requested model captured before delayed read | C request inputs captured before async resolver; ES freezes OpenCode selection before caller/store callback and rejects stored replacement during awaited prior result; unchanged CLI per-session concurrent/continuation selection tests. Removed modelInfo API remains removed. |
| 31 | Physical replacement during cleanup rejected | C three confirmed-cleanup replacements (workspace/executable/account) and caller alias retargeting reject NATIVE_CONTEXT_CHANGED; late cancellation is also rejected. |


### 2026-10-24 scoped OpenCode runtime (locally complete)

Runtime source `761dddd53c2d8aee4e4103d47ce0771661ce5849` changes only the new
Controller runtime/test, one unchanged validator named export, and the directly
affected owned-host source/test. It composes exact per-execution producers, captures
full canonical input and original receivers before awaits, checks physical executable
and workspace identities, and selects only the exact persisted backend source.
Original configured alias remains Controller authority; private producer scope and
input both use the captured physical path. The existing hostFactory supplies the
same synchronous runtime guard immediately before owned version-probe acquisition
and service spawn; existing direct one-argument/PATH host consumers are preserved.
Custom producer factories remain trusted injection, and pathname checks do not claim
atomic file execution against unrelated OS replacement after the final check.

Raw executable access, host acquisition and persistence remain owned independently
of public shutdown/cancellation. Invalid async/thenable guard work is normalized
once, tracked until actual settlement and still rejected synchronously. Losers cannot
close another invocation's winner; rejected persistence withdraws source. Only the
complete normalized not-created receipt can clear an unsent local barrier. Cached
unknown receipts remain cloned and unknown after late settlement; native tools,
writer release, deletion and cold continuation are not promoted.

Frozen source `a499d84:apps/controller/test/opencode-runtime.test.ts` has12 expanded
cases; all survive explicit canonical fixture/executable/observer adaptations.
Current runtime111 adds99 independent admission/source/callback/physical/cleanup
regressions. Existing owned-host23 (original20 plus3 prior regressions) retain every
assertion; two new tests prove pre-probe async rejection and post-probe revocation
before service spawn. Source bodies were captured before runs; no reconstruction.

| Source ID | Current decisive assertion |
| --- | --- |
| R01 | Two exact hosts; no aggregate source; exact persisted source only; removing binding withdraws it; proven local cleanup clears only local barrier. |
| R02 | Missing managed reference rejects synchronously before factory. |
| R03 | Foreign owning Runner rejects before factory. |
| R04 | Cold continuation/provider session reuse rejects before factory. |
| R05 | Standalone/wrong backend rejects before factory. |
| R06 | Original canonical owner revocation rejects before factory. |
| R07 | Caller prompt/ref mutation cannot replace capture; revocation across real executable access rejects ready/result with zero factory. |
| R08 | Duplicate start gets one factory/one native create; loser ready/result reject without closing winner. |
| R09 | Disconnect withdraws source; closed runtime/cold continuation cannot create replacement; unused recovered runtime cleans without host. |
| R10 | Never-started cleanup returns[] with zero factory/unclosed host. |
| R11 | Original async beforePrompt is rejected; no native POST escapes. |
| R12 | Workspace replacement across real executable access rejects before factory; ready/result reject. |

Final focused command is `mise exec -- pnpm vitest run
apps/controller/test/opencode-runtime.test.ts
packages/adapters/test/opencode-owned-server.test.ts`:2 files/136 tests, exit0,
Vitest12.88s/wall13.624s. Final unmodified default `mise exec -- pnpm check` passes
build/typecheck, lint, boundaries and187 files/2608 tests, exit0, Vitest104.11s,
wall118.1734139919281s. Source/result/log are
`/tmp/dispatcher-opencode-runtime-task1-logs/full-check-final-{source,result}.json`
and `full-check-final.log`; log SHA256
`9d6f1e8207e8465f96a8284280a2838b055bd412009a8c57ae09b4551ca11495`.
Root compared21 committed Git blob hashes and16 generated inputs separately against
the final manifest, and808 saved payload hashes across25 run snapshots: no mismatch.
All37 inputs were rechecked unchanged on2026-10-24. Generated dist is not staged;
coordinated documentation here follows that source gate and changes no tested code.

Earlier evidence remains separate: wiring RED includes missing module and unexpected
live-port inspect errors; behavior RED86failed/30passed; initial56failures included
unbuilt package-dist linkage; received-persistence source fencing failed115/116;
recursive test fs spy caused SIGABRT, with the exact owned leftover fixture audited
and no matching fixture process found; strict compile/lint errors were corrected
without suppression. The typed-owner leak suspicion passed unchanged through the
existing helper and is not claimed as a defect. Factory-shutdown RED130/131 and
thenable/getter REDs produced narrow runtime fixes. The first187/2603 full success
is retained as pre-thenable evidence; final2608 follows actual changed code/tests,
not an unchanged retry. No timeout, worker, skip, assertion or probe cache changed.

Independent `/tmp/dispatcher-opencode-runtime-review-20261024.md` returns spec
compliant and quality Approved, no Critical/Important. The earlier review failed at
service usage limit without a report and is not counted as a review pass. The only
Minor observation is existing routine full-suite request-log noise; optional fixture
logger cleanup is outside this runtime change and is not a correctness blocker.
Root resolved cannot-verify items: catalog0208bff and its independent review remain
prerequisites; the default gate covers existing local Codex/Pi regressions; original
runtime12 bodies were compared directly; coordinated architecture/know-how are
updated. Actual native/account/GUI/writer/restart/formal Gates remain explicitly
unverified, and parentCV14 owns whole-branch review/integration.

Next registration plan combines its originalR1/R2 as one atomic task: six existing
Controller/Runner type callers require matching structural backend unions, and a
schema-only intermediate payload can otherwise select standalone with no owning
factory. The existing ConfigPlan policy, disabled-before-factory behavior and exact
factory safeguards must land together. No physical validator is copied into schema.
Controller/source/retention/shutdown/restart, the other native providers, audited
Pi and retention/delivery gaps, and the overall goal remain incomplete. No real
profile/config/account/service was activated, no dependency/persisted format changed,
and no push/merge/release occurred.


### 2026-10-24 atomic OpenCode registration (locally complete)

Source `394a33dc5532023ee4d079ec854fb05f9a47caae` changes exactly schema.ts,
native-profile.ts and their two owned test files. Both structural backend unions
admit only the explicit compatible/opencode-server-v2/managed-worktree variant
on the owning embedded OpenCode profile. Server settings are executable, optional
exact model and optional approveTools:false; path validation is structural only,
selector240 uses canonical safe-text/first-slash rules, and omitted values stay
omitted. Disabled invalid shapes still fail validation; valid disabled registration
returns before factory work. Existing Codex/Pi/standalone contracts are retained.

The existing factory boundary rejects foreign configured ownership before any
callback, requires an owning result, checks its exact backend, and rejects server
injection without opt-in or into foreign CLI providers. No default Controller
runtime composition, executable existence/probe, native account operation or
capability qualification is added by this registration unit. ConfigPlan remains
the sole mutation/review boundary, with unchanged sensitive agentProfiles policy.

There is no original a499d84 OpenCode-specific config test file. The four historical
native-interaction-config.test.ts groups have these explicit current dispositions:

| Historical group | Current assertion / contract decision |
| --- | --- |
| Omitted config and disabled profile | New structural omitted/disabled cases and factory disabled-zero-callback case; invalid disabled settings still reject. |
| Confirmed arbitrary backend/GUI and cloud rejection | Sensitive concrete agentProfiles addition is confirmed through real ConfigurationEngine/SQLite; arbitrary/global/GUI/cloud shapes intentionally reject under the narrow current contract. |
| GUI surface and disabled HUMAN protection | Surface/global fields reject; unchanged interaction-guard tests retain HUMAN mutation protection. No config-time GUI path is restored. |
| Optional global removal diff | Per-profile nativeInteraction removal/settings change appears in sensitive /agentProfiles diff and unconfirmed apply preserves current config/revision. |

New config62 plus native-profile32 (existing7+25 new) produce the final focused
`mise exec -- pnpm vitest run packages/adapters/test/native-profile.test.ts
packages/config/test/opencode-native-interaction.test.ts`:2files/94tests, exit0,
0.797s wall. Earlier8files/279tests used the same final production but both tests
were later strengthened; it remains earlier-payload evidence. R1 RED44failed/16pass
and R2 RED20failed/12pass prove missing enum and factory guards. The U+2028 RED
1failed/61pass intentionally restored an intermediate regex to demonstrate the
regression; it is not described as the first natural failing implementation.
Final2/94 shares all four final hashes; subsequent default `mise exec -- pnpm check`
passes build/typecheck, lint, boundaries and188files/2695tests, exit0, Vitest90.23s,
wall102.482469541s. No unchanged retry, deadline/worker/skip/assertion/cache change.

Evidence root `/tmp/dispatcher-opencode-task1-evidence/` contains each actual
pre.json/source copies/output.log/result.json. Root audit
`/tmp/dispatcher-opencode-registration-root-payload-audit-20261024.json` matches
all4 owned committed Git/pre/post/source hashes,11530 saved payload hashes across
10 snapshots and668 generated post values. The full gate legitimately rebuilt8
generated schema/native-profile artifacts; the sole tracked pre/post delta was
root-owned next-Controller-plan documentation. The four owned inputs were stable;
the entire repository pre/post set was not identical. Full log SHA256 is
`b8e0550cae02a6c5879cb83db95c0ce5d6ca1caa63907ab14a61e2af9cd31bc9`.
Generated outputs and reports are not committed; root coordinated metadata follows.

Independent `/tmp/dispatcher-opencode-registration-review-20261024.md` returns
spec compliant/quality Approved with no Critical/Important. It independently
confirms the final-payload chronology, canonical selector/approval contract and
unchanged XDG exclusion; inherited fixture warn/error log noise is an optional
separate hygiene follow-up. Root resolves cannot-verify with reviewed runtime761dddd
physical admission, while Controller activation, actual provider/account/native
qualification and parentCV14 remain open. Source inventory retains503 rows and
original objects/decisions, with four verification descriptions updated; the new
config test is not invented as an additional historical source row.

Next Controller C1/C2/C3 plan is preflighted: one shared exact Codex/OpenCode helper,
three-registry source/lifecycle composition, raw-operation profile/SQLite barriers,
and explicit read-only OpenCode restart consistency. Pi's authority path stays
unchanged in this task. No real configuration, service, account, dependency,
persisted format, push or merge changed; CV09 and the overall goal remain incomplete.


### 2026-10-24 Controller OpenCode C1 (locally complete)

Source809c315 plus callback-currentness fixbc3e252 composes the reviewed runtime
for applied enabled local server profiles. One required-field Codex/OpenCode helper
retains the existing workspace-derived Run/currentTask/reserved Session/selection/
reference/invocation/generation-attempt-lease/repository-branch-base/spawn fences.
The native invocation is distinct from both Run and native-start journal identity.
Pi's start predicate is unchanged. The common registry/source/pruning/shutdown
enumeration includes OpenCode; exact runtime and current Adapter are associated.
Only existing observer durability is connected, with no Codex native-request or
native capability promotion. Missing OpenCode registry refuses aggregate fallback.

Historical `a499d84:apps/controller/test/opencode-runtime-service.test.ts` S1-S5
are preserved with canonical fixtures: two exact physical worktrees/bindings/native
sessions and no standalone argv; currentRun, reserved session, provider/selection
and lease authority refuse before allocation. Current OpenCode55 includes50 added
canonical/physical/callback/source regressions; current Codex98 retains59 source,
15 composition and16 history cases plus8 shared-authority regressions. S6-S8 are
explicitly later C2 drain/retention/receipt acceptance, not declared complete here.

| C1 preserved or new boundary | Decisive assertion |
| --- | --- |
| S1 / lazy exact composition | No factory at apply; two distinct managed worktrees/native sessions; persisted exact bindings and server model/backend; no aggregate source or standalone argv. |
| S2 / currentRun | Pre-create currentRun drift has zero factory; awaited binding/observer revocation has one create but zero prompt. |
| S3 / session/invocation | Typed Run/session and reserved Adapter session/id/run/profile/backend/native invocation match; drift refuses before factory. |
| S4 / canonical ownership | Profile/provider/Runner/full selection/reference/native-default drift rejects; publication uses actual canonical server catalog identity. |
| S5 / spawn fencing | Generation/attempt/lease and registered repository/branch/base remain authoritative; cancellation/terminal/shutdown refuse before factory. |
| Existing-provider preservation | Eight paired Codex cases include valid invocation unequal to Run/journal; Pi predicate, activity predicate and start-recovery byte-match C1 BASE. |
| Exact source callbacks | Runtime removal/replacement, Adapter/association removal/replacement and missing defined owner reject stale return; stable owner returns exact port with no new factory/host/create/prompt. |

Independent initial review found I1: nativePort checked Controller ownership only
before runtime.source. Runtime→producer→port.readHandle can synchronously change
outer registry/Adapter ownership, which inner entry/binding/physical checks cannot
prove. The real nested-source RED6failed/1stablepass drove the fix. Common source
lookup now captures original profile key and a defined saved owner, then rechecks
runtime registry/current Adapter/WeakMap after resolution. Non-runtime fallback
and existing missing-registry refusal are preserved. Scoped fix-round1 review
`/tmp/dispatcher-opencode-controller-c1-fix1-review-20261024.md` closes I1 with no
new breakage; the earlier full review is
`/tmp/dispatcher-opencode-controller-c1-review-20261024.md`.

Final focused six files/334 tests and unmodified default189files/2758tests pass,
exit0; Vitest89.34s, command-only full wall107.792753708s. Exact full command is
`mise exec -- pnpm check`; build/typecheck/lint/boundaries pass. Fix artifacts are
`.superpowers/sdd/2026-10-23-opencode-controller-port/evidence-c1-fix-1/` with
per-run pre-bytes/pre.json/post.json/start.json/result.json/output.log. Root audit
`/tmp/dispatcher-opencode-controller-c1-fix1-root-payload-audit-20261024.json`
matches3 committed Git/pre/post payloads, all1090current post hashes including668
generated values, and3270 actual pre-byte copies across3 fix runs plus metadata/
log digests. No tracked delta; only3 generated service artifacts changed in build.
Final full log SHA256:
`3eb0c594d38a5b376c852578de22737ab792a8a13cee5f940c14128ccaa3462f`.

Earlier C1 has9 hash-manifest/log/result runs, not saved source-byte copies or
per-run HEAD/UTC metadata; this limitation is retained, never reconstructed.
Root links its final809c315 Git payload to2751-test hash/log evidence, but does not
claim recovery of historical RED bytes. The real I1 source/test change justifies
the later default2758 gate with live bytes/full metadata, not an unchanged retry.
Initial33failures/3passes included physical tests masked by missing runtime;
those were tightened before GREEN. Later fixture timing/source-loss/tags errors,
non-exported normalizer diagnostic, and live-port formatter inspect errors remain
separate from real missing-registry and post-source-owner defects. Final focused
and full gates have no unhandled Vitest errors. CLI name filtering is recorded as
diagnostic deselection, not permanent skip or test-setting relaxation.

Minor M1 expected fixture request/background warn/error logging is deferred for
parentCV14 triage; results are not claimed warning-free. Root read both complete
reviews, verified the unchanged Pi/activity/start-recovery bytes, and retains prior
catalog/runtime/registration reviews. C2 raw-operation profile/SQLite barriers and
S6-S8, C3 read-only restart, other providers, original native/account/GUI/writer/
release Gates and the overall goal remain open. Cold OpenCode restart is still
conservatively refused. No real profile/account/config/service or persisted format,
dependency, push or merge changed. Coordinated metadata follows the tested source.

The later one-task native ownership prerequisite plan is now saved at
`docs/superpowers/plans/2026-10-24-native-ownership-prerequisite.md`, carrying the
existing expert two-owner ruling and all6 original cancellation assertions. It is
queued after reviewed OpenCode/Pi work, not implementation or native qualification.

### 2026-10-24 Controller OpenCode C2 (locally complete)

Source `db9744e4e3aad0d121c7147537396be2e2f5d03c` (BASE `99bcd32`) changes
only service.ts and OpenCode service tests. Exact registered Codex/OpenCode raw
activity now participates in the existing profile guard and final SQLite barrier.
The common stop tail preserves concurrent local-review/native/raw-uncertainty
errors, retaining single error identity and aggregating multiple failures. Pi has
no raw-status method; capability narrowing preserves its actual host/receipt
contract without treating absence as drain proof. Codex/Pi tests and Pi runtime
remain byte-identical to BASE.

| Source/new boundary | Current decisive local assertion |
| --- | --- |
| S6 idle versus ACTIVE | Terminal Run/Task plus completed Adapter still requires explicit durable cleanup before profile replacement; ACTIVE Run blocks after cleanup. |
| S7 storage lifetime | Receipt and unknown observation precede actual SQLite close; read-only reopen retains binding/session and ACTIVE Run. Unknown connection/root/callbacks and independent raw work retain storage. |
| S8 persistence retry | Local receipt/read-barrier fault rolls back all observations; exact closed runtime/source withdrawal retained; durable-only retry never repeats physical disconnect. |
| Raw activity | Terminal Run, durable local receipt, false Adapter activity and false host barrier isolate actual raw admission/callback status; profile change remains blocked. |
| Three registries | Each singleton provider disconnect/receipt fault attempts peer cleanup, closes HTTP/events and retains DB. Multiple provider/local-review/raw failures preserve every error. Real OpenCode runtime/producer/port is used for its own path. |
| Late work/start journal | Rejected/never-opened acquisition uses normalized not-created proof; unresolved acquisition/observer retains cached unknown cleanup and original UNKNOWN start/invocation without create/prompt replay or source reacquisition. |

Final focused5files/239tests passes (`final-scoped-pi-contract`, command19.530890875s).
Final default `mise exec -- pnpm check` passes build/typecheck/lint/boundaries and
189files/2787tests (Vitest88.99s, command106.569717292s). Evidence:
`/tmp/dispatcher-c2-evidence-new-runs-20261024/final-default-check-external-v2`.
Log SHA256 `5e9d4920f0074667621b3cae34a3aa2f3a8bfb59f20fa5c4700e42e388fb4a31`.
Root audit `/tmp/dispatcher-opencode-controller-c2-root-payload-audit-20261024.json`
verifies2 committed Git blobs,1090post values/668generated,48run metadata and52320
actual saved pre-byte copies, plus42712 migrated archive files, without mismatch.
No root test rerun was needed for coordinated documentation.

The first default gate exited1 at lint after109.909466s: historical TS snapshots
inside ignored `.superpowers` were still scanned by ESLint and had10 unused imports.
Build/typecheck passed; boundaries/full tests were not reached. After all writers
closed, the whole old evidence tree moved byte-for-byte to
`/tmp/dispatcher-c2-evidence-20261024`; matching before/after relative SHA inventories
are under the new root's `migration-preserve`. Old location retains MOVED.md only.
No old JSON/log/bytes or lint/boundary rules changed. The separately labeled final
gate follows both the actual Pi-double payload correction and this evidence-layout
correction, not an unchanged blind retry. All future live byte snapshots are outside
checkout. Earlier fixture handling/spy/acquisition assumptions, real raw-barrier/
aggregation REDs and introduced Pi6/6 interface failure remain distinct evidence.

Independent `/tmp/dispatcher-opencode-controller-c2-review-20261024.md`: spec
compliant, quality Approved,0 Critical/Important and1 Minor expected fixture log
noise deferred to parentCV14. Root resolves unchanged prerequisite items via reviewed
catalog/runtime/registration/C1 evidence, verified ancestry and the exact two-file
diff; it independently verifies the migration and final input bytes. OpenCode suite
is now84 cases,29 added in C2. All original sourceS1-S8 now have current local
composition/retention assertions. C3 restart, other native providers, Pi raw-status
audit and original provider/account/GUI/writer/service/release Gates remain open.
CV09/CV14 and the overall goal are not complete. No native account/session deletion,
real configuration/service activation, dependency/migration, push or merge occurred.

### 2026-10-24 Controller OpenCode C3 (locally complete)

Source `c82af5c188880ca7b9902123a5fbf6b53833f26b`, BASE `3c1a565`, changes
start-recovery, its service import/two consumers, OpenCode tests and one existing
Codex test's assertions. Private checkedManagedRun preserves persisted canonical
agreement and unique control ownership; explicit Codex/OpenCode wrappers enforce
their own provider/backend/product/region/thread/parent/session rules. OpenCode
session uses exact `^ses[A-Za-z0-9_-]+$`, maximum512. Both constructor preflight
and journal reconciliation accept only consistent read-only records, invalidate
observation/read barrier and retain original identity as unavailable/unknown/manual.
No source/reattach/native replay/continuation/writer or account provenance is granted.
Existing QUEUED→WAITING_RESOURCE and RUNNING→WAITING_USER transitions remain intact.

| Requirement | Current local assertion |
| --- | --- |
| Positive restart | Two canonical Task states retain exact Run/Session/Adapter/binding/invocation; unchanged original factory/transport counts, no source/mutation/advance/continue, fresh unknown barrier and retained receipt projection. |
| Read-only storage | SQLite total_changes before/after unchanged. Removing executable does not affect stored qualification; enabled-runtime construction rejects it separately. Codex reciprocal provider/zero-write assertions remain. |
| Corruption | 86 isolated cases cover canonical/selection/reference/contract/Adapter/invocation/diagnostics/binding/control and SQL row/document/duplicate ownership conflicts. Constructor refuses before new host and retains original Run. Consistent copy replacement makes provider-specific shape decisive. |
| Boundary/provenance | 512-character safe session accepted,513 refused; consistent opaque store accepted as storage agreement only. No external provenance oracle invented. |

91 added OpenCode cases (86negative+5positive) bring that suite to175. Codex
extends an existing case and does not add a case to totals. Focused required
5files/318tests pass (Vitest26.94s/command27.352209333s); final default
`mise exec -- pnpm check` passes189files/2878tests and all non-test gates
(Vitest95.52s/command115.460641375s). Final actual command UTC
2026-10-24T12:57:53.193605Z→12:59:48.654847Z. Log SHA256
`022ac4c5cceec7f5ea5cacbafb62b47208710a1cbbca972008a0dbdaf0bf9e39`.
Evidence `/tmp/dispatcher-opencode-controller-c3-evidence-20261024/014-final-default`;
full implementer report `.superpowers/sdd/2026-10-23-opencode-controller-port/task-3-report.md`.

Root final audit `/tmp/dispatcher-opencode-controller-c3-root-payload-audit-final-20261024.json`
verifies4Git blobs,3451finalpost files/668livegenerated and32258pre+32258post
actual copies across16recorded runs. All hashes match at audit. Root's future Pi/
ownership plan metadata is separately excluded from the source commit; later
coordinated documentation changes do not alter tested source/test inputs. No
root suite rerun for metadata. The source owner/start/profile/stop functions
compare byte-identical to C3 BASE and prerequisites are verified ancestors.

RED008 establishes two real prior preflight failures. GREEN009 had306pass/4new
fixture failures: error nesting, missing referenced Session/foreign-key construction
and an incorrectly assumed invalid `session_other` spelling. Corrected fixture
logic retains the exact grammar and production foreign keys; focused012 then
passes318. Earlier inspection glob failure is separate. Bootstrap read-only
commands preceded the recorder, so no byte capture is claimed for them. Runs001–012
UTC timestamps bound capture/command execution; exact command timestamps were
not invented later. Future records013 onward separate capture/actual command UTC
and include output/manifest digests. Final014 contains all real bytes, including
ignored TS/JS/JSON ESLint inputs; earlier metadata remains unchanged.

Independent `/tmp/dispatcher-opencode-controller-c3-review-20261024.md` gives
spec compliant/quality Approved,0Critical/Important,1Minor expected fixture log
noise deferredCV14. Reviewer checked delegated domain binding validation for a
concrete extraction risk. Root resolves unchanged prerequisites through their
reviewed receipts, exact scope, ancestry and unchanged guard comparison. All
three OpenCode Controller units now have clean scoped reviews. ParentCV14 owns
whole-branch review/integration; retained SDD artifacts are evidence, not deleted
or merged per unit. CV09/the full goal and actual provider/account/GUI/writer/
service/release Gates remain open. Next: saved Pi source-gap plan, native ownership
prerequisite and remaining provider/UI/retention/delivery units.

### 2026-10-24 Pi direct source assertions (Task1 locally complete)

Source `76b7839f02b3c619c4ef89a9277343bfa2989789`, BASE `dc9096a`, changes
only Pi service/Adapter tests and additive synthetic per-command child trace. No
production/runtime/API/persistence/capability change.15 new service cases and an
existing Adapter case assertion restore current canonical equivalents of the
frozen source without inventing a product-defect RED.

| Source gap | Decisive current assertion |
| --- | --- |
| G1 six service35 drift cases | Real reserved invocation enters runtime.start; currentRun/session/provider/lease/generation/attempt drift synchronously rejects not-created before default construction. Empty execution map, zero producer.start and absent probe/environment/RPC/prompt traces; exact current HTTP/Run/start projection is asserted separately. |
| G3 service34 two Runs | Actual distinct UUIDs/PIDs/workspaces and persisted reference/selection/binding; same original native directories, exactly two scoped prompts, no print/no-session, unknown capability and foreign source refusal. |
| G3 service49 duplicate | Refused duplicate cancellation leaves original actual PID/source and single prompt intact; only original owned synthetic root is then disconnected. |
| G4 RPC194 | Injected Adapter has no aggregate interaction port; default print manifest and all prior continuation/native-stop refusals preserved. |
| G5 retired global toggle adaptation | Explicit disable/removal ACTIVE cases block before/after real drain. Separate checked terminal fixture requires host drain; held callback unknown receipt stays blocked after late settlement, shutdown retains cleanup uncertainty. Binding/session marker preserved. |
| Saved-config G2 service46 | Applied ConfigPlan reopens before dispatch with pi-rpc Adapter and zero native work; bound cold restart remains Task3. |

Terminal fixture waits for actual Adapter result, checks legal ACTIVE→FAILED and
RUNNING→FAILED transitions, then explicitly records FAILED Run/endedAt and matching
Task as synthetic canonical setup. This isolates the host barrier without inferring
terminality, native quiescence or writer release from Adapter completion. Current
service has no Pi factory injection seam; the actual guard order and zero effects
prove pre-allocation, not a separately spied constructor count. No new seam added.

Final focused all7 fixture consumers/196tests pass (command21.715s). Sole final
default `mise exec -- pnpm check` passes non-test gates and189files/2893tests
(Vitest94.78s/command112.287602875s). Actual UTC
2026-10-24T13:08:31.514257Z→13:10:23.792871Z. Evidence
`/tmp/dispatcher-pi-gap-task1-evidence-20261024/022-final-default-gate`; logSHA256
`18cbac8ff2918f0ebe1e1c42877ce126896ae31691333c05daf6bd0b35fb3439`.
Root `/tmp/dispatcher-pi-gap-task1-root-payload-audit-20261024.json` verifies
3Git inputs,3451post/668livegenerated,25runs and86275pre+86275post real copies,
all matched. Source/test payload is unchanged across final focused/default/commit.

007first6fail/34pass and011fourfail/42pass are retained fixture assumptions: final
HTTP projection, stale-authority STARTING retention, duplicate Task command ID and
Runner capacity. Corrected new fixtures retain decisive not-created/no native
effects; no old assertion was weakened. Read-only inspection diagnostics and
uncaptured initial bootstrap/helper establishment are disclosed in task report.
All implementation/test/gate runs have real outside-checkout bytes/metadata.
No historical reconstruction or unchanged-code retry.

Independent `/tmp/dispatcher-pi-gap-task1-review-20261024.md` gives spec compliant/
quality Approved,0Critical/Important,1Minor expected refusal-log noise deferredCV14.
Reviewer checked actual guard-before-constructor ordering and domain transitions;
root resolves unchanged authority/wire prerequisites by prior source/observer
evidence and exact test-only scope. Task2raw lifetime and Task3bound restart,
other providers and original account/GUI/native writer/service/release Gates remain
open. The frozen155-case inventory is static mapping, not a new test total. No
actual Pi/account/native activation, deletion, push or merge occurred. Architecture
and know-how need no change for this test-only increment.

### 2026-10-24 Pi raw-work lifetime (Task2 locally complete)

Source `fc4685e31b6c440fa8dad0e2e298f698005e6f53`, BASE `10887c8`, changes
Pi runtime/producer and their three directly affected tests. Real hasActiveOperations
combines entered runtime guard/admission/readiness work with producer acquisition/
turn/callback state. Forbidden guard results normalize once into the same tracked
and consumed Promise. Producer reuses its callbacks set so initial rejection can
no longer falsely report drained callbacks. Current raw status is distinct from
immutable cached cleanup. Existing Controller consumers need no source change.

| Requirement | Decisive local regression |
| --- | --- |
| Initial/admitted forbidden guards | Held thenable stays tracked despite synchronous rejection/public failure; actual cleanup callbacks unknown with root not-created, no RPC/prompt/source. Existing admitted client error remap retained. |
| Acquisition/readiness | Existing AcquiringTurn.ready Promise remains one lifetime including onFailure cleanup; beginShutdown does not erase pending readiness. |
| Assimilation/rejection | Getter/then each run once, throwing getter and late rejection consumed, current raw status clears only on actual settlement. |
| Producer/raw composition | Actual producer acquisition/turn/callback status consumed by runtime; public terminal state and cached receipt never fabricate drain. |
| Controller lifetime | Terminal canonical fixture, completed Adapter, durable drained local receipt and inactive host/producer isolate held runtime work. Profile refuses; stop closes HTTP/events and retains exact registration/SQLite. Resolve/reject late cannot regain source/replay or change original binding/wire. |
| Precedence/cached unknown | Open pending callback yields ACTIVE_AGENT_PROFILE. Closed+unknown host yields earlier NATIVE_RUNTIME_DRAIN_REQUIRED even rawtrue; late rawfalse never upgrades cached unknown. Closed+durably drained hosts+independent raw still reaches ACTIVE. |

10 added cases (runtime5/producer3/service2). Finalfocused7files/399tests pass
(Vitest26.54s/command26.936818375s); one default `mise exec -- pnpm check` passes
all non-test gates and189files/2903tests (95.05s/112.797663709s). Actual command UTC
2026-10-24T13:20:48.493016Z→13:22:41.291055Z. Full log SHA256
`1401a495736af95df9836e905a7694265655601e5847917363f9e378738a43c3`; evidence
`/tmp/dispatcher-pi-gap-task2-evidence-20261024/24-final-default-gate`.
Root audit `/tmp/dispatcher-pi-gap-task2-root-payload-audit-20261024.json` verifies
5Git inputs,3453post/668livegenerated,28runs with74331pre+74331post real copies,
7external scripts and28actual harness versions. All match, including final output/
manifest digests. Run-indexSHAf2f7a4eb1a644d260aa322207a28e1d9d41a4ed5dae978ccf6026dbbb44db872.

Meaningful RED06/08/12 shows false callbacksdrained, profile replacement and
premature successful SQLite close. Supplemental missing-method TypeErrors are not
that behavioral proof. A test-finally DB close initially masked an assertion and
was corrected with its failure retained. FirstGREEN95pass/2fail reflected requested
raw precedence; later369pass/2fail overextended that expectation after disconnect.
Root's earlier ruling was too broad and is explicitly corrected by actual source
order; only the second expectation returned to original drain code. No service
error behavior changed. All failed attempts/afterEach rejection output retained.

Capture limits: read-only bootstrap preceded helper; runs01–06 have tracked inputs
and only Controller/adapters/domain/protocol dist, and add_tests.py05 lacks its
execution-time copy/hash. Runs07 onward add all dist+external scripts;10 onward
also includes ignored lint inputs. These limitations remain, never reconstructed.
Finalfocused22/default24 have full actual expanded pre/post capture. Local default
Controller guards are synchronous; adversarial callback regressions are not a
claim of an observed real-provider failure.

Independent `/tmp/dispatcher-pi-gap-task2-review-20261024.md`: spec compliant,
quality Approved,0Critical/Important,1Minor expected fixture log noise deferredCV14.
Reviewer checks readiness lifetime, common consumers/precedence and existing async
client open/error remap. Root retains reviewed Task1 transition/observer boundaries,
exact unchanged service/recovery source, and evidence limits. PiTask3cold readonly
restart remains; false current raw status still does not prove native quiescence,
tool/approval absence, automatic advancement, native writer release or GUI/account
qualification. No session deletion, real activation, dependency/migration, push or
merge. ParentCV14/full goal and original Gates remain open.

### 2026-10-24 Pi readonly saved-binding restart (Task3 locally complete)

Source `e526609c56b319519e8acf096397feed21f32d68`, BASE `0348c04`, changes
only explicit isReadableManagedPiRun, the import/two existing readonly consumers
and adjacent accurate comment, Pi tests, and a17-line shared test storage utility
extracted exactly from OpenCode. Generic/private checked predicate and existing
Codex/OpenCode qualifiers are byte-preserved. Pi provider/product/backend/global,
exact36-character case-insensitive UUID and no thread/parent rules are explicit.
No native source/reattach/replay/continuation/writer is granted.

49 added cases (44negative+5positive), Pi suite72. Genuine synthetic start/bind/
result/drain/reopen verifies both Task transitions and original Run/Session/
Adapter invocation/binding/selection/reference/tuple/worktree identity, receipt
projection, unknown observation/new barrier, no live port/runtime entry or new
native trace and denied actions. Direct qualifier total_changes stays unchanged
after removing executable/native directories/worktree; actual Pi construction
still rejects missing directories, preserving its own filesystem contract.
Corruption covers every listed category, SQL owner/row/document disagreements,
consistent-copy provider shape and malformed UUIDs. Uppercase UUID and opaque
consistent store rewrite prove only storage agreement. OpenCode matrix/helper
extraction is exact and retains every existing row/assertion; no suite side effects.

PiGREEN72 (43.70s/44.088244250s) and required5files/380tests
(43.94s/44.333191792s) pass. Sole default `mise exec -- pnpm check` passes
non-test gates and189files/2952tests (103.18s/121.206177750s). Actual command
UTC2026-10-24T13:31:45.304632Z→13:33:46.511089Z; evidence
`/tmp/dispatcher-pi-gap-task3-evidence-20261024/08-final-default-gate`.
LogSHA256 `bc684bc779cd0fcb296a16e492b797052a9600fca50ad99c4a600257ecfb533f`.
Root audit `/tmp/dispatcher-pi-gap-task3-root-payload-audit-20261024.json` verifies
5Git inputs,3470post,12runs with41541pre+41542post copies,5scripts/12harnesses.
The3470 final inputs include668live dist outputs and16tsbuildinfo;1667total
dist-named paths also include999 historical ignored lint snapshots, not1667
live outputs. All hashes match; root does not duplicate the passing suite.
Run-indexSHA5a6a44be85b085478238c859e6738241714227eee537766934351f6c4afd93d3.

01 retained setup failure used invalidateObservation incorrectly; corrected
unknown barrier plus saved prior idle/readable observation is artificial storage
input. ActualRED02 then fails both constructors at existing native preflight.
Initial read-only/bootstrap/inline test edits were tool-observed outside harness;
first verification onward has actual complete tested source/dist/lint bytes.
Before the build gate, future capture adds ignored tsbuildinfo compiler inputs;
no historical copies/times were reconstructed.

Independent `/tmp/dispatcher-pi-gap-task3-review-20261024.md` gives spec compliant/
quality Approved,0Critical/Important,1Minor expected log noise deferredCV14. It
checks the unchanged private storage seam and retained evidence. Root independently
confirms runtime/producer untouched and exact permitted test extraction. One prose
rationale in implementer/review text incorrectly attributed newline refusal to
length preventing JavaScript end-anchor behavior; root target-node probe rejects
LF/CR/U2028/U2029 for both non-multiline regexes already. Reviewer appends a dated
factual correction, preserving original text; explicit length36/newline negative
remain valid. No new OpenCode defect/code change or rerun is inferred.

All3 local Pi tasks have clean scoped reviews; G1–G5/boundG2 and addedG6 have
current direct/composed/replaced assertion mappings. Frozen155 is a source map,
not an added passing-test count or native qualification. Pi idle/completed/zero
pending still cannot advance automatically. ParentCV14 owns broad review and all
SDD evidence remains retained. Goal/CV10, other providers/UI/retention/delivery and
original account/GUI/native writer/service/release Gates stay open. Next ownership
plan has preparation/preflight only; no native/account activation, dependency,
migration, deletion, push or merge occurred.

### 2026-10-24 ownership candidate rejected; independent delivery partition

WIP `56db4b540ed86a8a66fd1e896269670127c7f41e`, BASE `84cde57`, preserves
the nine-file group/root/Codex candidate. First default attempt stopped at four
lint defects after build/typecheck; cause/type-import fixes have direct RED and
scoped lint evidence. A subsequent sticky-error cause regression corrected lost
diagnostic cause without changing policy. Earlier two actual owned-drain failures
remain causally unresolved despite a later changed-payload diagnostic pass.

Final changed-payload `mise exec -- pnpm check` exits1, wall127.729430167s:
build/typecheck/lint/boundaries pass;191files/2999tests,186files/2980pass and
5files/19fail. Evidence `/tmp/dispatcher-native-ownership-evidence/final-default-gate-lint-fix-v2`;
logSHA256 `3809d4168462ab4a4c3fbdbcd2a05c2a4cb9143d28429b6e3338cca50a7d0c22`.
Root audit `/tmp/dispatcher-native-ownership-root-payload-audit-20261024.json`
checks9Git inputs/4567finalpost,23runs/105010pre+105014post actual copies and
92digested records; zero hash/current-byte differences. Runtime/tool identities
are recorded; third-party node_modules/runtime binary bytes are excluded. This
audit links retained bytes to a **failed** gate; it is not acceptance.

Independent `/tmp/dispatcher-native-ownership-task1-review-20261024.md` reports
spec incomplete/quality Needs fixes. Three actual subprocess paths (Controller
adapter lifecycle, Generic owned cancellation and Runner lifecycle) preserve
post-exit `kill(-pid,0)` EPERM; the new mandated sticky unknown prevents later
probe/signal. Review found no fixture-injected EPERM on those paths. OS reason,
numerical reuse, zombie/reaping hypothesis and relation to R020 are unproven.
The other16 QUOTA_CLEANUP_UNKNOWN afterEach failures cannot establish the native
reader's pending-vs-uncertain branch or a shared OS cause.

Fixture-only fix `e0621180011d32bd3b2ed1d3415bcd95c02478ff` injects the existing
independent codexNativeReader seam into two otherwise mocked Controller fixtures.
Two new regressions first fail on missing seam, then check real quota normalization,
exact pre-abort reason and unexpected-method rejection. Required four files/202
tests pass18.154624333s; scoped ESLint passes1.063980750s. All original body/stop
assertions and dedicated account-quotas/real codex-catalog files are retained.
Full gate was deliberately not retried while group conflict remains open.
Fix evidence `/tmp/dispatcher-native-ownership-evidence/fix1-handoff.json`;
independent scoped re-review pending. A failed payload audit caught root-owned
plan metadata; its result is preserved and the corrected audit excludes only
those two named plans. No tests were repeated for that metadata correction.

The review's dated follow-up supports an independent root-only partition under
`docs/superpowers/plans/2026-10-24-root-owned-probe-delivery.md`. It restores exact
baseline group/Codex behavior, retains root/probe/sourcecase4 tests and requires
fresh shared/default full acceptance. Original combined Task1 is **not complete**;
WIP/history/all failures and group sourcecases1/2/3/5/6 remain open for Generic,
Runner, catalogs/default probes, Codex and all other group consumers. No policy
toggle/fallback/duplicate owner, test deadline/worker/cache relaxation or native
release assertion is authorized. Later root-only providers must prove actual
detached:false/root construction, explicit root probe and independent500ms natural
close on every relevant path. ParentCV14 and all formal Gates remain open.

### 2026-10-24 independent root-only delivery locally complete

Source659fc1b489c4829bc02229e6d9726e1b334c5e11, BASE8d43bf1, restores three
complete group/Codex/status blobs exactly to84cde57, preserves every baseline
native fixture statement and adds only the retained root inherited-pipe block.
Candidate root assertion suffix moves unchanged to owned-root-process.test.ts;
sourcecase4 retains its exact scenario/no-child-kill assertion and strengthens
mutation-after-exit/global-zero checks. Root/probe/drain implementation bytes stay
exact56db4b5; only two candidate default-mode mock sequences adapt to the actual
baseline exit ordering. No existing assertions/budgets/policies are weakened.

First focused attempt passed296/297 with Runner loading candidate dist through
the package export while source had already restored84cde57. That captured mixed
state failure stays retained. Actual pnpm build changes ten runtime/declaration/
map/buildinfo inputs; focused on these changed inputs then passes12/297
(19.034803125s). Sole unchanged default pnpm check passes build/typecheck/lint/
boundaries plus191/2985 (Vitest103.12s, wall120.966620875s). UTC actualcommand
2026-10-24T14:21:17.608237Z→14:23:18.575029Z; evidence
/tmp/dispatcher-root-owned-probe-evidence-20261024/fullgate-final-payload;
logSHA256 c2b541354675652f83949d580f934cfbd28840117bc40d5bca873f4e16371447.

An earlier external restoration-audit wrapper fails after output/post capture;
9158retained files are hashed and missing command completion metadata stays absent.
It was not reconstructed/retried; final committed-HEAD audit checks new commit
input. Root /tmp/dispatcher-root-owned-probe-root-audit-20261024.json independently
verifies493tracked Git/fullgate-pre/post inputs,6normalruns with27462pre+27462post
actual copies,24recorddigests/1executed external input,4577finalpost/672liveDist/
16buildinfo and all9158failed-wrapper records; zero errors/live differences.
Separate root Git checks verify exact native baseline minus additive root block,
root suffix equality and unchanged publicindex. No native wiring/export or new
dependency/persisted format/activation occurs. Node_modules/runtime binary bytes
remain excluded and identity-only; no hermetic claim.

Independent /tmp/dispatcher-root-owned-probe-task1-review-20261024.md gives spec
compliant/qualityApproved,0Critical/Important,1MinorM1 expected fixture JSON noise
deferredCV14. Retained implementation/mode/close precedence and all moved root
assertions checked. Root resolves byte/callsite/WIP/primary/Linear scope items
without repeating passing tests. Fixe062118 separately has finding2 ADDRESSED in
/tmp/dispatcher-native-ownership-fix1-review-20261024.md; root verifies2Git blobs,
13710pre+13710post across3verificationruns/44digests/688unchanged generated inputs.
Neither result diagnoses the original16quota failures or3sharedgroupEPERM paths.

Only the independent root delivery is complete. Original combined ownership
Task1/sourcegroup1/2/3/5/6 and every affected group consumer's stronger safety
remain open, WIP56db4b5 and failed gates stay reachable. R020, later provider/
account/GUI/writer/service/release Gates and parentCV14 remain open. Official
quota62%used38%remaining,2resetcredits unused. Next internal ACP client uses exact
SDK/peer artifact/security/license verification and canonical ExecutionSelection;
producer/catalog/runtime/config/Controller registration follow separately.

### 2026-10-24 internal Devin Local ACP client locally complete

Sourcee53ceb21b43602aef9e49b0c1c987495513688da, BASEf3dac4b, adds only the
internal client/tests and exact SDK1.8.0/Zod4.6.7 Adapter/lock entries. Current
canonical explicit model/owner/reference, captured creation Guard/scope/options,
root-only cleanup, original PID and cached unknown receipts replace obsolete
ModelSelection/ProcessCancellation without public registration. All66definitions/
91expanded source client cases retain assertion/budget bytes after named canonical
substitutions;22direct regressions cover actual current authority/cleanup gaps.
Source producer32/catalog30/runtime28/config17/Controller30 remain queued.

Meaningful directRED12fail/8pass precedes fixes; current client113 and focused
5/271 pass after build. Sole unchanged default check passes non-test gates and
192/3098 (Vitest115.57s, wall133.826532834s), UTC14:36:56.436570Z→14:39:10.263391Z.
Final logSHA4b5e2a8e4d014dbaffd686c0211829f1c082ab880abadae965a5b806042aac03;
evidence /tmp/dispatcher-devin-acp-client-evidence-20261024/final-check.
Root /tmp/dispatcher-devin-acp-client-root-audit-20261024.json independently checks
496trackedGit/fullgateprepost,14runs/64226pre+64230post copies,56digests/6external
scripts,4590finalpost/676liveDist/16buildinfo and frozen-source assertion parity.
Only2ignoredSDDprogressMarkdown change during fullgate, recorded separately;
code/tests/config/lock/generated inputs remain exact. No hermetic binary claim.

Exact official tarballSRI/licenses/peer graph match fresh registry and actual
deployed package manifests/LICENSE; source/staged/deployed lock and dependency
state checked. Production deploy exits0; first inspection fails on pnpm-layout
assumption, corrected on the same artifact without redeploy. Existing isolated
node-pty lifecycle scripts are retained; no new-package install hooks. GitHub
advisoryAPI403 and audit exit1 are retained. Resolved audit28unrelated advisories
(6low17moderate5high) remainCV13; no SDK/Zod entry, unrelated upgrades or suppression.
This artifact proves attribution only, no service/native-account/release Gate.

Independent /tmp/dispatcher-devin-acp-client-task1-review-20261024.md: speccompliant/
qualityApproved,0Critical/Important,1Minor fullgate fixture-noise finding deferred
CV14; focused output clean. Reviewer inspects real SDK writer/notification close,
canonical selection and root/probe boundaries. Root resolves source/byte/artifact
audits without repeating tests. Source503 keeps immutable identity/decision/owner.
Formal group/R020/provider/account/GUI/writer/service/release and parentCV14 remain
open. Quota70%used30%remaining/reset2unused; continue independent development.


### 2026-10-24 internal Devin Local ACP producer locally complete

Source2631e36d0508a29686c8e3e254e6c609c884dd76, BASE0a1387d, changes eight scoped
paths. Explicit devin-local-session allocation reuses the current durable owner;
canonical producer waits for binding and asynchronous fact persistence before
model/prompt/readiness/terminal publication. Individual and aggregate observation
checkpoints500ms, raw acquisition/work/Guard/consumer lifetime, pre-invocation64
callback limit and immutable unknown cleanup preserve authority across awaits.
Client implementation changes only internal Identity/identity exports. No public
index, schema, factory, Controller, package/lock or persisted contract changes.

Original20definitions/32expanded producer assertions retain exact bodies after
listed canonical selection/reservation/observer substitutions;27direct regressions
cover actual async/raw/ID/deadline defects. Existing client113 bodies match BASE
and original NativeBindingEvents66 prefix stays exact, plus18new owner cases.
Shared fixture helper is byte-identical except its declaration/roots parameter:
7434bytes SHA049e9fc01d8a2bec5573655fcdee30fab603242161af7d14311567cece67ac9d
becomes7466bytes SHA595163271a77873501ebfc7e32fc4ff7c8adf74560ca2a445f05f20c4c243d3c.
Source/fixture mapSHAc0d60581cc271a245ec4538c1d37b0051e07f2ac36d5c4c23f7e6e3240f711f3.

Final-v4 `mise exec -- pnpm check` passes build/typecheck/lint/boundaries and
193files3175tests (Vitest136.26s, wall155.510445s), actualUTC
2026-10-24T15:11:16.636846Z→15:13:52.147547Z. LogSHA
359c6013bb0c794bddf4055f869c013be9a5a629553c332aa36bc896dd1fceeb;
/tmp/dispatcher-devin-acp-producer-evidence-20261024/final-check-observation-pipeline-v4.
Earlier unused-import lint failure, meaningful native-ID/aggregate-pipeline/
callback-cap REDs and superseded v2/v3 gates remain retained; no unchanged retry
or assertion/policy weakening. Final affected3files256pass after actualbuild.

Root /tmp/dispatcher-devin-acp-producer-root-audit-20261024.json independently
checks35actualcommandcaptures/161111pre+161116post copies/140digests/7external
scripts,500trackedGit/finalprepost/live,4604finalinputs/680liveDist/16buildinfo;
zeroerrors and finaldrift, dirty primary preserved. Historical snapshot dist is
not counted as live. Root verifies actual frozenGit source, reruns only the
assertion/fixture map into a separate artifact and matches workerJSON. Final
report-write drift is solely assigned ignored Markdown. Runtime binaries and
node_modules explicitly excluded; no hermetic execution claim.

Required independent /tmp/dispatcher-devin-acp-producer-task1-review-20261024.md:
spec compliant/quality Approved,0Critical/Important. One Minor inherited fixture
warning/error noise deferredCV14; output not pristine. Root resolves source/bytes/
primary prerequisite items. Runtime must consume actual producer raw operations,
not Adapter turn wrappers; neither is native quiescence proof. LinearCV10 receipt
b6471e95-8152-44e3-bf9d-b6deae26de43 saved/readback, InProgress retained.

Next canonical catalog29direct+oneobsoleteModelInfo exact-ID case through real
later Controllerconsumer, runtime28, atomicconfig/factory17 and Controller30.
Source503 immutable identities/decisions retained; formal group/EPERM/R020,
CV13audit28/native/account/GUI/writer/service/release and parentCV14 remain open.
Officialquota84%used16%remaining ordinaryUsageAllowedtrue/reset2unused.


### 2026-10-24 canonical Devin Local catalog locally complete

TaskBASEe956907, sourcea10a2c1 and I1fix13389134a320d6226e655e34082e07a17269e8f9.
Five task paths, four fix paths. Internal AccountModelCatalog reader/normalizer and
scoped Adapter override preserve explicit physical homes, literal command and
canonical owner, exact selectors/unknown billing/unconfirmed access. Independent
bounds/fatalUTF8/wholedeadline and unconditional rootstop/naturalclose500ms guard
all completion paths. Binary exact Unicode ordering closes a reproduced content
revision defect without normalizing distinct IDs. Source30=29direct+oneobsolete
modelInfo lookup pending realController routing trial, currentcatalog65.

Initial task review found ImportantI1: shared version helper discarded stderr.
Root explicitly expanded directlyaffected scope, originalimplementer fixround1
adds actualcaller strictOutput option and additive helper tests. Strict mode keeps
16384stdoutcap, independentstderr<=1048576/fatalbothstreams afterdrain; legacy
callers retain prior contract. Realexactversion oversized/invalidstderr REDs and
positivecontrols verified. Scoped re-review I1ADDRESSED/no newCriticalImportant;
/tmp/dispatcher-devin-acp-catalog-task1-fix1-review-20261024.md. Original expected
fullsuite diagnostic-noise Minor remainsCV14. No output suppression or pristineclaim.

Finalfix1/full-check-i1 `mise exec -- pnpm check`:194files3263tests and
build/typecheck/lint/boundaries pass; Vitest132.92s wall151.382018375s,
UTC2026-10-24T15:53:54.148224Z→15:56:25.530474Z, logSHA
a36fba389d3a181cf88fe3b8c37d736de712e20de64f8bcd5a41aef687ccd9f2.
Focus4files283tests pass; earlier7/308 preceded Unicodefix, notfinalpayload claim.
Setup missingmodule/parse/unimplementedstub, firstI1newtesttimer/table errors,
meaningful cleanup/pipe/Unicode/stderr REDs and superseded complete gates retained;
no unchanged retry or timeout/worker/cache/lint/assertion weakening.

Root /tmp/dispatcher-devin-acp-catalog-fix1-root-audit-20261024.json verifies
35actualrecords161631pre+161635post/140digests/5externalscripts,503trackedGit
matchingfinalprepost/live and4620inputs/684liveDist/16buildinfo,zeroerrors.
AssignedignoredreportMarkdown finalizedaftergate onlyliveinputdrift, primary
HEAD/status unchanged. FrozenGit source matches,29bodies exactafterlistedcanonical
substitutions, priorcatalog61bodies exact, oldhelper23(notmistaken28)prefix/bodies
exact; currenthelper46. Client113/producer59/ACPfixture andowningroot/drain bytes
unchanged; approvedhelper-source exception explicit. RootseparatemapSHA
170286e491d9fa025295a3bbefdef8a3c10856f88db659f42b3d9cf4aacdb7d8.
Pre-I1audit preserved separately; runtime/node_modules exclusions mean nohermeticclaim.

LinearCV10a1db2978-f23b-48da-a82e-fc4d1c4f06e2/CV05cb3939aa-0b7c-4a5a-a933-5810c33d626b
saved/readback, states unchanged. Next runtime28, atomicfactory/config17 and
Controller30+lookup1; no publicprofile/account/service activation. Source503
immutable identities/decisions retained. Group/EPERM/R020/CV13audit28/native/
account/GUI/writer/release/parentCV14 remainopen. Quota92used8remaining,allowed,
reset2unused; continuing latestgoal.


### 2026-10-25 Devin managed runtime locally complete

TaskBASE90041be; sourcea3a4e66 and fixc76d315ab0aa89dfbdf41decd945f1e61733d40f.
Three taskpaths: runtime/test and two named real producer class/scope root exports;
fix onlyruntime/test. Current NativeRuntimeHosts and real producer own their
boundaries. Canonical selection/physical owner/callback receiver capture, reserved
original work, asyncdurability500ms/ownership rechecks and raw acquisition/ready/
result retention guard the internal route. Sourcealwaysundefined; native control/
history/continuation/quiescence/writer remainunqualified. Originalhost receipts
intact, owncallbackunknown appended separately with no inventedidentity/PID.

Independent taskreview found I1forcedpublicabort couldsaynotcreated after
session/new-written/pre-binding, and I2getter/sharedresult couldchange after
validation. Bothfixed inround1; scopedreview confirmsADDRESSED/no newCritical/
Important. Ordinaryproduceroutcomeproof stays unchanged; forcedabort afterentry
isunknown, preentrynotcreatedcontrol remains. Result capturedbefore awaitedfinish
andvalidatedsnapshot alone returned. /tmp/dispatcher-devin-acp-runtime-task1-fix1-review-20261025.md.

Source19definitions28expandedwholecanonicalASTstatements includingparameter tables
preserved; prior47definitions95cases+helperprefix exactexcepttypeimport. Current
106=source28+78regressions/controls. RED6fail/100pass, GREEN106/106, compat3/278;
actualcreate-ignore localfixture proveswrittencreateinterval. Finalfix1-final-check
`mise exec -- pnpm check` passes195files3369tests andbuild/typecheck/lint/boundaries,
Vitest137.50s wall156.27945525s, UTC2026-10-25T18:28:54.077694Z→18:31:30.357314Z,
logSHA25cc711f73a455c6417b5cca22a169ea98f16ce13f059cb9af7904f02b348bad.
Evidence /tmp/dispatcher-devin-acp-runtime-fix1-evidence-20261025. Earlier6/406
focus and3357/3358gates are retainedonsupersededbytes, notfinalpayloadclaim.

Root /tmp/dispatcher-devin-acp-runtime-fix1-root-audit-20261025.json independently
checks52actualcommandrecords240903pre+240908post/208digests/42externalinputs,
506trackedGit matchingfinalprepost/live and4635inputs/688liveDist/16buildinfo,
zeroerrors. AssignedignoredreportMarkdown aftergate onlyliveinputdrift; dirty
primaryunchanged. Sharedfixture/fiveexistingfocusfiles exact toBASE. Rootwholecase/
priorhelper proofs retained; mapSHAf1d48d742886bd6e6b64e54630edfe2e1d71ec5d085fb912e0cc9d016d44915e.
Historical8basenamecollisions matcheddeclaredprehashes/retainedworking or earlier
snapshot/frozenGitbytes: byteequivalence, NOToriginaluniquecaptureguarantee. New
fix copiesexternalinputsunderfull-pathhashdirs atcommandstart. Nohermeticclaim.

Initial loadable30:27sourcepassed, onecanonicalfreezesanitizationporterror plus
twoactualasync/durableREDs, then30GREEN; no retrospectivebaseline replay. Further
reentrant/raw/getter/capacity REDs, compiler/lint failures andoriginalhostreceipt
factloss RED retained; finalcorrection onlynarrowcleanupbranch thennewgate. No
oldassertion/worker/timeout/cache/lint weakening. Quota-terminatedagent leftclean
BASE; officialavailability laterverified andsamefixround resumed, no resetused.

OriginalMinorM1expectedfixture/service/SDKnoise remainsCV14, no pristineclaim or
production suppression. Rootallcannotverifylocalscopeitems resolved; no real
native/account/GUI/writer/service/releaseGate. LinearCV10e3f0045f-1be9-4224-a283-632bb765cd65/
umbrellac7c1f534-3774-45ef-b639-4a2bd5195afa saved/readback. Nextatomicfactory/
config17 thenController30+lookup1/coldreadonly/storagefences; source503 immutable
identities/decisions preserved. Group/EPERM/R020/CV13audit28/formalGates/CV14open.
Officialquota4used96remaining allowed/reset2unused, fullgoalcontinues.

## Devin Local ACP atomic ConfigPlan and factory acceptance (2026-10-25)

Commit ac61772a8c2624fc0a50c6c37bc77e90db025300 changes exactly four assigned
paths. Explicit structural settings/ownership, dedicated owning backend factory,
scoped catalog construction and disabled native-home protection are locally
implemented. No Controller registration, personal profile, native account or
service activation is included. Cloud Devin v3 remains distinct.

Frozen source17 retains whole canonical test calls, parameter tables and all inner
invalid scalars. Its ConfigPlan source string fixture maps to current import;
original factory32 across17 declarations plus its whole non-import block remain
unchanged. Current config46/factory80 total126; meaningful RED52 failed/74 passed,
GREEN126, requested seven-suite focus323. Final unchanged mise exec -- pnpm check
passes196 files/3463 tests plus build/typecheck/lint/boundaries. UTC
2026-10-25T18:48:43.889500Z to18:51:31.967540Z; wall168.077716459s,
Vitest143.27s; logSHA256
edd1f3f3b63a56c1804dbf2ef9493dbb900f6097f7a3e6a7ecd3a00a313389ed.
Evidence: /tmp/dispatcher-devin-acp-config-factory-evidence-20261025.

Independent spec/quality review:
/tmp/dispatcher-devin-acp-config-factory-task1-review-20261025.md. Root independently
checks12 actual command records,55703 pre/55704 post copies,48 digests and150
uniquely keyed external copies;508 tracked Git files match final pre/post and
4642 final inputs,688 dist/16 buildinfo, zero errors. Primary dirty checkout is
preserved. Root audit: /tmp/dispatcher-devin-acp-config-factory-root-audit-20261025.json;
source whole-call/table proof mapSHA256
6cf86072e9014278d5daa697145dd0013a226cea5abf154212ae14eab415f92f.
Runtime binaries/node_modules excluded; no hermetic claim. Post-gate report/review
packaging is separate from frozen executable inputs.

Zero-start backend spies prove no factory-boundary execution only; real scoped
Adapter, physical fixture paths and explicit catalog subprocess remain actual.
Expected rejection diagnostics and mise/committer notices are retained; MinorCV14
noise stays open without production suppression. No assertion/budget/worker/cache/
lint weakening or unchanged retry. Current quota9used91remaining, allowed, two
reset credits unused; latest nonstop authorization remains active.

Next Controller C1 owns29 of the30 source cases plus the catalog's deferred actual
exact-ID routing trial. The source restart/no-reattach case belongs to C2's checked
storage certificate and corruption matrix: current startup otherwise rejects a
nonterminal bound Local Run. C1 also reproduces the observed catalog-unknown
shutdown/storage risk before fixing the directly affected shared path. No obsolete
ModelInfo/status/model-catalog-state surface restored. Original group/EPERM/R020,
CV13 audit28, real provider/account/GUI/writer/service/release Gates and CV14 remain open.

Required review is spec compliant / task quality Approved,0 Critical/Important and
1 MinorCV14. Root resolved both cannot-verify items: independent byte/source proof
as above and explicit out-of-unit real Gates. LinearCV10
34ccaf0d-ce10-427b-a651-8a42d310f7f3 saved and exact body read back.

## Devin Local ACP Controller C1 and strict teardown acceptance (2026-10-25)

175b2d4db2335dff83dd4820686ec13912232dbd plus
bee64835c5b1e7e519f33f8951d12d948f003530 compose the real Local runtime/Adapter/
manifest, exact ConfigPlan route, canonical owner Guard and raw catalog/profile/
shutdown storage barriers. The fifth path task-publications.test.ts was explicitly
authorized after its old stop-resolves expectation conflicted with the required
unknown-cleanup barrier; only that test changes, normal teardown and69 case count
remain. No schema/dependency/other-provider runtime or personal activation change.

Source30 maps29 C1 +1 C2 restart. Original parameter tables retained with explicit
canonical ExecutionSelection/contract/Session/API substitutions. Nonexistent old
global native switch maps to ConfigPlan disabling all owning Local profiles.
Catalog's prior exact-ID consumer is now actual /api/model-routing/test: chosen
ready, cho unavailable, unchanged routing/config stores and no ACP allocation.
Current Local73 includes source29 plus44 regressions/consumer cases. Root mapSHA
85d810008daedcc87c100c316d34dc25ea55b37377b3687fe13cf6e155b7dfd4;
/tmp/dispatcher-devin-acp-controller-fix1-root-source-map-20261025.json.

Required full review /tmp/dispatcher-devin-acp-controller-task1-review-20261025.md
found I1: new fixture globally swallowed unexpected aggregate/unknown stop errors.
Fix1 makes successful stop default; exact service/error enrollment follows an
explicit successful assertion. Five real cleanup regressions prevent unexpected,
nonmatching or cross-service exceptions; enrolled cleanup still refuses active
raw work. Wrong-version9.9.9 now explicitly asserts its existing conservative
unknown receipt/raw settlement, without changing production receipt policy. Scoped
/tmp/dispatcher-devin-acp-controller-task1-fix1-review-20261025.md: I1 ADDRESSED,
no new Critical/Important/Minor. All local cannot-verify items resolved by root
case/input proof; C2/real Gates explicitly remain outside C1.

First full3530/3531 failure and passing3531 candidate vulnerable to I1 remain
retained. Final covering2/142 (Local73 +publication69), lint and one unchanged
fix1 mise exec -- pnpm check pass197files3536tests and all non-test gates.
UTC2026-10-25T19:27:43.533241Z to19:30:23.979129Z,wall160.445464542s,
Vitest142.35s; logSHA
8b7ec385b4f1cc5058cf1ad5d468e66e6927fab033c0fe7e78825ee12923922a.
Evidence /tmp/dispatcher-devin-acp-controller-fix1-evidence-20261025.

Root /tmp/dispatcher-devin-acp-controller-fix1-root-audit-20261025.json checks34
actual command records158124pre/158125post copies,136digests,109external copies
and971actual generated fixture copies;511trackedGit matches4652finalinputs,
688dist/16buildinfo,zeroerrors. Fix touches only two authorized test paths;
production/publication payload remains exactly175b2d4. Primary HEAD/status and
all three dirty document contents match preserved original hashes.

Historical limitation: red-catalog/red-catalog-profile/green-initial/focus-02 lack
original ephemeral Local executable copies; source/helper/output remain, no replay
or reconstruction claimed. First original capture focus-03; fix1 captures from
its first RED. One non-final covering-final-02 self-review text changed while its
command ran: original pre copy plus later matching bytes prove equivalence, not
an original unique postcopy. Final gate source/external inputs frozen. Intentional
post-gate append-report changes have original source/post-source report copies.
Initial root audit correctly rejected the previously unlisted report mutation;
the exact documented packaging case was verified, not a blanket drift exemption.
Runtime binaries/node_modules excluded, no hermetic claim.

LinearCV10 acceptance1efa0859-21f7-42a3-b49e-93a4da6614dd and umbrella
19bca02d-5dc1-48f4-b928-86ed4ceaefc9 saved and exact bodies read back.
Quota23used77remaining allowed/reset2unused. Full goal active; next C2 owns pure
checked-storage Local certificate/corruption matrix and original restart1.
Copilot committed147/runtime41 and WIPconfig17/service29 are only prepared inputs
under /tmp/dispatcher-copilot-preflight-20261025, not passing target claims.
Original group/EPERM/R020/CV13 audit28, expected diagnostic noise/CV14 and real
provider/account/GUI/writer/service/release Gates remain open.

## Devin Local ACP C2 checked-storage recovery acceptance (2026-10-25)

Commit b7d0651fe20dc26e48efc0a23ecee3359d7397b7 changes exactly three assigned
paths. Narrow Local wrapper delegates checkedManagedRun and is added only to the
constructor/reconciliation admission ORs. The entire prior start-recovery.ts prefix
is byte-identical; C1 strict fixture/common corruption helper and old provider
code/tests/package/lock remain unchanged. No persisted version or live authority.

Original sourceCase23 restart1 now has QUEUED/RUNNING variants with literal settings,
exact stored identity and receipt projection, unknown fresh observation/barrier,
manual Run/Task recovery, no new producer/root/prompt and denied mutations. C1other29
and actual catalog exact-ID consumer remain accepted. Combined original Controller30
source purposes are covered, not a claim of native/provider/GUI qualification.
New94 =restart2 +pure stored/physical separation1 +corruption86 +opaque positives5.
All C0/DEL and LF/CR boundary controls use consistent binding-copy edits; Unicode,
decomposed Unicode,1unit/512units and opaque store positives imply agreement only.
Root static mapSHA
d1dbcff73643261c5a78fe058cfb032064a8588f0dda57cff4b7d9e9de67c16b.

Loadable initial RED2 reaches real constructor refusal. First GREEN92 then added
missing Task/decomposed Unicode before final freeze. Initial lint control-regex
failure fixed with producer character-code style, no suppression. Final focus5/428
and one unchanged mise exec -- pnpm check pass198files3630tests plus all non-test
gates, UTC2026-10-25T19:44:03.111475Z to19:46:54.682959Z,wall171.570866s,
Vitest153.84s. logSHA
d4888d315bd7c758ba5d06dbfdc3373a84e47168aeba68e0517a1bc9d458a4ef.
Evidence /tmp/dispatcher-devin-acp-recovery-evidence-20261025.

Required /tmp/dispatcher-devin-acp-recovery-task1-review-20261025.md: spec compliant,
quality Approved,0Critical/Important; existing expected-diagnostic noise MinorCV14
retained. Root resolved local cannot-verify items with exact prior helper/provider
prefix, all513Git inputs and C1 source-case/fixture fidelity plus the unchanged
full shared matrix in focused428. Real/formal Gates explicitly outside scope.
Root /tmp/dispatcher-devin-acp-recovery-root-audit-20261025.json checks13commands,
60554pre/60555post copies,52digests,72external copies,1068actual generated Local
fixture copies from firstRED;513Git matches4658finalinputs/688dist/16buildinfo,
zeroerrors. Primary HEAD/status and three dirty file contents match originals.
Final source/self-review/external inputs frozen; report/review post-gate metadata
separate. Runtime binaries/node_modules excluded, no hermetic claim.

CV10 acceptance0c678b10-f377-43ec-89ae-ad1ff34ed9b5 saved/exactbodyreadback.
Quota27used73remaining allowed/reset2unused; whole goal active. Original group/
EPERM/R020/CV13audit28/CV14 and real provider/account/GUI/writer/service/release
Gates open; no personal account/profile/service activation.

Next Copilot client113 uses frozen committed source76read/bootstrap+37prompt;
producer34/runtime41 and WIPconfig17/service29 remain separate unimplemented inputs.
Eight frozen Copilot source files and eight WIP backup files were hash-verified under
/tmp/dispatcher-copilot-preflight-20261025; no wholesale restore. A bounded experiment
/tmp/dispatcher-copilot-codec-probe-20261025 compared official8.2.1 and10.0.0:
identical316-byte Unicode frames/ordered coalesced+one-byte decode, timeout0/dispose
onNode24.21.0. Prefer exact maintained10.0.0 with new /node export. Actual Microsoft
MIT License/SRI/zero-proddeps verified, single-package advisory lookup{} time-specific.
This is only API/wire compatibility preparation, not113client/native/security Gate
evidence. New codec/package/deployed notice and all source tests remain next task;
no SDK/commercial CLI incorporation or package change in this C2 unit.


## Internal Copilot RPC client acceptance (2026-10-25)

aa856718625973b03a08818fddd3f16bcc405486+80ab301648b4d961344959452b437ac457aa95aa preserve internal
client only. Source113 =76read/bootstrap+37prompt whole calls/bodies/tables/budgets
remain exact; initial7 and fix9 direct cases add16, total129client. Producer34,
runtime41 and WIPconfig17/service29 remain separate unfinished units. No package
root exports/registration, schema or persisted-format change.

Actual root-only stdio with filtered child environment, exact CLI1.0.97/protocol3,
bounded ingress/final-write Guard, single bootstrap/local exact resume, known binding
before qualification and correlated prompt/denial/abort facts retain source purpose.
Full review found I1 pre-input unresolved permission could be ignored during model
read; actual fake-child probe returned apparent success without denial. Fix1 adds
sticky qualified pre-input permission admission/final-sink fence. Meaningful RED6
and3 existing positive controls preceded fix; covering149 includes all source113,
initial7,fix9 and existing20root/process cases. Same-buffer idle/hook-tail cannot
erase unresolved pre-input facts; valid in-turn denial/ACK and resolved-hook,
sibling/subagent controls remain. Scoped required re-review /tmp/dispatcher-copilot-client-task1-fix1-review-20261025.md addressesI1
without new Critical/Important breakage. M1 inherited expected-service diagnostics
remain parentCV14 harness work; no suppression/test weakening.

One unchanged final mise exec -- pnpm check passes200files3759tests plus build/
typecheck/lint/boundaries. UTC2026-10-25T20:21:04.197460+00:00 to2026-10-25T20:24:38.818653+00:00,
wall214.624451041s; outputSHAed2e73d5aa6b4e59b781dc223df0e156e23f5e93462734f4600863f00eddd365. Evidence /tmp/dispatcher-copilot-client-fix1-evidence-20261025. Final source,
self-review, external and generated inputs remain frozen; original candidate's
200/3750 green and I1 diagnostic retained as superseded, not accepted proof.

Only exact vscode-jsonrpc10.0.0 was added, published /node export; actual Microsoft
MIT notice/package/entry/official tar SRI match installed and isolated relocated
production dependency bytes, zero new transitive production nodes. ACP SDK1.8.0/
Zod4.6.7 unchanged; no CopilotSDK/CLI/koffi incorporation. Fixed deployed source/dist
match final tested bytes,1360regularfiles+6containedsymlinks/14833553bytes;102
workspace hardlinks detached locally with all bytes preserved/zero shared inodes.
No install/research rerun in fix; audit reused actual UTC20:01 snapshot against
unchanged lock,28advisories6low17moderate5high0critical on unchanged BASEversions,
no codec path. This does not clear security/NS068.

Root historical audit /tmp/dispatcher-copilot-client-root-audit-20261025.json checks
26actualcommands/121431pre121436post/104digests/1170externalcopies/961generated
fixturefiles248executables/517Git,909final deploy directory originalcopies; zeroerrors.
Root fixed audit /tmp/dispatcher-copilot-client-fix1-root-audit-20261025.json checks
16commands/74768pre/74768post/64digests/
1121externalcopies/1023generatedfiles
271executables,517Git/4673finalinputs/
692dist/16buildinfo; zeroerrors and primary HEAD/status/all3
dirty content hashes preserved. Static root source map and prior120 cases verified.

Limitations retained: early deployment directory argv had no unique per-command
copies; final909 inputs do. Native scripts have unique mkdtemp names and manifest
byte proof, no original absolute-path identity record. Static inspectors initially
failed on as-const AST and artifact after.files schema, corrected actual inspectors
retained without production/test changes. Initial dependency inspection false
/tmp-vs-/private/tmp escape, quoted-lock parser and workspace hardlinks have retained
failed outputs and exact subsequent corrections. Runtime binaries/node_modules
excluded from whole-input capture; selected codec bytes separately checked, no
hermetic/account/provider/GUI/VSCode/service/writer/release/formal Gate claim.

CV10 acceptance 6fcee9f9-0d38-4c10-ad36-3d26654db812 and umbrella 718e47ea-2888-42b9-8548-083724701058 saved and
exact bodies read back. Goal remains active; source503 identities unchanged. Next
producer34 uses actual canonical allocation/durable observer, then runtime41 and
config17/service29. Group/EPERM/R020/CV13/CV14 and all real Gates remain open.


## Internal Copilot producer acceptance (2026-10-25)

Commit66789bd7a181e58a0255c4412ec3d2ca06e0f914 changes the six planned paths only. Internal producer owns one
explicit canonical ExecutionSelection/managed creation, uses the accepted client
physical helper through a named internal export, and extends the existing allocated
observer with copilot/copilot-rpc. No root export/registration/config/Controller,
package/lock or deployed-release change. Original source147 purposes now mapped as
client113 +producer34; runtime41/WIPconfig17/service29 remain separate unfinished units.

Source34 retains all20names/whole inner tables/scalars;18bodies equal under named
canonical model/parameter/import substitutions. Declaration16 uses actual canonical
Adapter reservation/observer and unsupported catalog instead of obsolete manifest
fields;20 retains exact fake-child array/wire assertions plus actual reservation/
sink and root receipt. Source18 unresolved async fact still fails500ms with raw
unknown;19 acquisition retains2500close/500drain. Client129 whole test files unchanged;
old84 observer entire26116-byte prefix/calls unchanged and35Copilot controls appended.
Current producer73/observer119, with reentry/cap64/raw thenables/positive async
durability/ordered500ms per+aggregate/failure classification/pending mutation/stop
diagnostic/physical drift controls. Root independent static map
/tmp/dispatcher-copilot-execution-root-source-map-20261025.json.

Actual loadable01RED32/35 captures missing allocation and Guard ownership;02build
Promise.withResolvers lib failure fixed in new source without config change.05RED
182/187 captures reentrant start/internal failure cancellation errors; new revoked
authority test corrected to assert actual STALE_NATIVE_OBSERVER, no boundary weakened.
First7-suite450, later502 pass. Expanded12tenfiles611/612 retains unchanged Devin
late real acquisition entered poll failure at existing1s, before cleanup assertions.
Actual open includes version3000ms/initialize5000ms; no underlying error retained to
distinguish delay/failure. No unchanged focused retry/test/deadline/worker/cache change
or R020 same-cause/solution claim. Its ephemeral native bytes were not captured;
source/output retained, no reconstruction.

One planned default mise exec -- pnpm check passes201files3867tests and build/
typecheck/lint/boundaries, UTC2026-10-25T20:42:44.257732Z→20:45:57.347729Z,
wall193.089858667s, logSHA
0e21c0799de66fbb298b38f44447cc89e3b9f68fd6f716a3b82a0b07ab23c618. Earlier focused
failure is not erased by this current whole-suite pass. Required fresh review
/tmp/dispatcher-copilot-execution-task1-review-20261025.md fully read: spec compliant,
quality Approved,0Critical0Important1Minor inherited service/Git output noise deferred
CV14. Root resolved local cannot-verify via source/API/fixture/Git/input proof; real
provider/account/entitlement/GUI/writer/descendant-release/formal Gates excluded.

Root /tmp/dispatcher-copilot-execution-root-audit-20261025.json checks18actualruns/
84304pre84309post/72digests/418externalcopies/3097generatedretainedfiles/364producer
identity+executablecopies/32Gitobservations;520Git/4684finalinputs/696dist/16buildinfo,
zeroerrors; primary HEAD/status/all3dirty contents preserved. All product/test/check/
self-review/external bytes frozen. FinalSnapshotFrozen=false: root wrote ignored SDD
progress.md after freeze; exact e505aa9bb0da9df2617b8679e4b9cc12ecfa0071b64d91407b161c2948f297ed
→388cd1a6df006e8fe8805a9970f8994b3854afbb21af9e995e3a4306204d49a0 metadata pair
retained/disclosed, no directory waiver/restore/retry. Root owns this avoidable
coordination error; no false whole-directory frozen claim.

Original01/04/05 captures use full-root keys(36/36/70),08/12/15 full-executable
keys(72/75/75). Report's05 transition was corrected append-only after root inspector
failed; original failed inspector/corrected exact-schema check retained. Derived
full-file index is not retroactive original capture. Legacy client unique-mkdtemp
layout unchanged. Actual final fake rootPID56649 exited/ESRCH, exact bound input and
native-file preservation captured; this is local root proof only, backgroundTools
unknown/nativeSessionDeletedfalse. First report-generator optional-key failure and
original script/tool transcript retained; corrected18 report is packaging only.
Node_modules/runtime binaries excluded, no hermetic or new release-artifact claim.

CV10 acceptance 64883009-2178-465b-8d9f-f736c93f6fd4 and umbrella e4284f8d-7ab6-40c6-b8a5-05111572e0cf saved/exact
readback. Quota46used54remaining allowed/reset2unused. CV13 audit28 grouped7modules
read-only preparation and four official high-advisory range reads saved in
/tmp/dispatcher-cv13-current-audit-preparation-20261025.json; Linear183c9de8 saved/
readback. No dependency mutation; those advisory minima are not latest/security
clearance. Whole goal active: next runtime41 actual producer raw-status consumer,
then atomic config/factory17, Controller29/pure restart certificate. Group/EPERM/
R020/CV13-14 and all actual provider/account/GUI/service/writer/release Gates open.

## Copilot runtime candidate and owning Devin verification follow-up

Candidate94da9c1+1652a79+73f0c33, not whole-task acceptance. Required Fix2 review
/tmp/dispatcher-copilot-runtime-task1-fix2-review-20261025.md resolves I1/N1 with
zero newCritical/Important; direct final canonical tuple mutation and final lookup
revocation failures retained. One mandatory synchronous assertCurrent now owns
canonical permission plus the exact persisted tuple; pure local fences follow.
Diagnostics-only lookup grants no input. Actual default Adapter reservation,
invocation/generation/attempt/lease, managed selection/reference/workspace/store
owner is exercised; future Controller C1 must implement the real joint assertion.

Source41 titles/full tables/script array and prior103 purposes/tables/164matcher
expressions verified by independent AST. All original100 scalar occurrences
retained; only later fix1 counter scaffolding/error text retired with explicit
mapping. Current114 runtime/10focused761/build/lint pass; old whole-test-prefix is
false after mandatory API migration. Same report includes all RED/GREEN/inputs.
Root fix2 audit10runs46990pre/post/40digests149external/24fixturecopies8manifests/
20Gitobservations/523Git/4699finalinputs700dist16buildinfo, zeroerrors; final
focused/external snapshots frozen and committed bytes agree. Primary HEAD/status/
all3dirty contents preserved. Fix1 and original candidate audits/failures retained.

Required full gate remains red:202files201pass1fail,3967tests3966pass1fail; unchanged
Devin observer-entry predicate at:160, before its cleanup assertions. No unchanged
full retry. Separate owning plan2026-10-25-devin-entry-phase will retain59 source
purposes, actual-open setup/error barrier and unchanged post-open1s/native budgets,
then one changed-source full gate covers both. Controlled actual stdio baseline
open401ms/entry406ms versus1200ms version delay open1613ms/entry1617ms proves a
structural setup/poll assumption only, not historical OS/R020 causation. Probe
outputSHA72343f01063853aff434615459c6518b6fea0b858d2b3e6eb4b4651e51d4a4b2,
4698pre/post equal and14original generated file copies independently verified.

First exploratory green43 native identity/bytes/files/receipt were discarded;
original source/log retained. Explicit root historical CV14 exception forbids
initial-run/release attribution, reconstructed proof or another missing final
capture. Later contemporaneous captures have outer root hashes and per-original-
absolute-file-path hashes; they prove their own runs. M2 existing log noise stays
deferred without suppression. I2 still blocks Task1 completion; no source503
acceptance/real provider/account/GUI/writer/release/P4 promotion. Quota59used41left,
ordinaryallowed/reset2unused. Goal and remaining plans continue.

## Copilot runtime local acceptance via owning Devin phase correction

Owning3935178 changes only devin-acp-execution.test.ts, preserving34decl/59cases/
124matchers/19originalwaits/tables/safetybudgets; only "open" instrumentation moves
to the shared local actual-open spy. It awaits real open success/rejection before
11original initial-poll declarations (13cases), preserves held-delivery raw work,
restores exceptional spy state, and captures actual inputs before the first RED.
Direct RED3fail/2pass/59filtered retained, including current no-delay open1057ms
and delayed1609/1602ms; this is current phase evidence, not historical OS/R020 cause.
Current64/focused7files520/build/lint pass. Required fresh review Speccompliant/
QualityApproved0C/I/newMinor; expected existing full diagnostic/Gitidentity2minor
observations deferred to CV14. No suppression, production or shared fixture edits.

One changed-input full passes202files3986tests/all non-test checks, UTC21:53:22.066901
..21:56:36.151564, wall194.084451042s, logSHA
19161286d74c3299cf188eec93c19982901262458e016f73fbd8faf4dd393246. During command HEAD
was281cfe0 with frozen changed test; its bytes exactly equal committed3935178.
Correct post-build reviewed Copilot source/test/JS/declaration/map five hashes
agree with73f0c33 focused and this full pre/post. Earlier green-owner-final had stale
compiledJS/map; that comparison is preserved, not used as the current reference.
Prior runtime code I1/N1 scoped review plus this owning review/byte agreement
resolves runtime I2 without another unchanged full run. Local runtime unit complete,
source41/current114/prior103tables164assertions preserved with explicit owner API.

Root /tmp/dispatcher-devin-entry-phase-task-root-audit-20261025.json verifies8runs/
37632pre37632post/32digests185external661generatedfilecopies347manifests16Gitobs/
524Git/4704fullinputs700dist16buildinfo, zeroerrors. All command input/external
prepost maps equal; both live ledgers frozen, primary HEAD/status/all3dirty contents
preserved. Full47Devinpre-spawn/64cleanup roots include17no-acquisition fixtures;
separate actual Copilotdefault6copies retained. Every declared file hash/size/path
key checked; after-only fixtures and unknown receipts are not root-absence proof.
Other provider ephemeral bytes and runtime binaries/node_modules excluded; no
hermetic/real provider/account/GUI/writer/release/P4 Gate proof. Historical runtime
3966/3967/producer611/612 and original I3 lost-first-run exception remain unchanged.

CV03a40877df, CV10af4626ed and umbrellab68ced73 exact bodies saved/readback at
/tmp/dispatcher-copilot-runtime-phase-linear-acceptance-20261025.json. Official
quota66used34remaining ordinaryallowed/reset2unused. Next atomic ConfigPlan/factory
17+existing console private-field protection6paths; preparation pure projection
shows exact five native directory keys survive console/plan views, export still
omits settings. CV13e1d40644 records synthetic probe only, no server/auth/account
disclosure claim. New actual regression RED/frozen qualification required next.
Controller29/readonly recovery, remaining provider/UI/retention/delivery/security/
performance/CI/whole-branch/formal Gates and goal remain active.

## Copilot explicit config/factory and native-directory privacy — a77d48f

Exactly six implementation/test files, BASEe0628e1→a77d48f. Source17 five full
calls/tables/inner invalid values retained; only actual buildPlan source scalar
fixture→import changes (GUI fixture unchanged). Old factory30decl80cases and
console7decl7cases wholecalls/script exact; current factory125/config34/console18.
Root independent AST map: /tmp/dispatcher-copilot-config-factory-root-source-map-20261025.json.
Dedicated backend slot, captured minimal profile/detached callback/original receiver,
explicit opt-in even disabled, exact two paths/native login and disabled private
home protection. Console/plan omit dataHome/configHome/agentDirectory/sessionDirectory/
copilotHome through existing privateKey; exact leaf/private sibling/parent refusal,
export settings omission and unrelated future key preserved. Existing constructor
physical executable check remains after valid owning backend; no home/account probe.

Evidence /tmp/dispatcher-copilot-config-factory-evidence-20261025. Original RED
59fail118pass177 is behavioral; earlier overbroad evidence-map scalar matcher setup
failure retained separately. Final focused10files593tests, build/lint pass. A newly
added hostile typed fixture changed to Reflect.set after self-review, then covering
lint/focused repeated; no production change or unchanged retry. One full command
mise exec -- pnpm check UTC22:15:39.198439..22:18:53.826869 wall194.627884834s,
203files4076tests and all build/typecheck/lint/boundary checks pass. Full log SHA
335a6173b49384f1fbbb89802ff4c5cbb1c7f1bdbfec8372fcf2e4edf4749fd7.
Command HEAD was e0628e1 plus six frozen changed files; those equal committed a77d48f,
not an assertion that this command ran at a clean a77d48f HEAD. CV14 owns final candidate.

Required review /tmp/dispatcher-copilot-config-factory-task1-review-20261025.md fully
read: Spec/Quality Approved0C/I, two inherited diagnostic/local committer observations.
No suite reruns. Cannot-verify cross-task items resolved by root source/primary audit
and source503 five verification-only updates; no formal/account/service Gate claimed.
Root /tmp/dispatcher-copilot-config-factory-root-audit-20261025.json checks7runs,
32977pre32977post/28digests168external/227hashed-path generatedfilecopies117manifests,
20Local-factory relative copies16manifests/14Gitobs526trackedGit/full4711inputs700dist/
16buildinfo, zeroerrors. Original full repository and28external maps unchanged;
all committed bytes and current files agree. Initial build updates15compiled/build-info
files; all snapshots retained, later focused/full unchanged. Primary HEAD/status/three dirty contents
preserved. Root source mapper separately preserves37 old wholecalls plus allsource17.

Native-profile fixtures have original-root-relative copies/dev/ino/mode with actual
version then models-list calls; changed-registration path is not mistaken for the
original executable. No-spawn root-drift fixture is separate, no invented root
receipt. Existing Copilot/Devin full captures also verified; other providers' ephemeral
bytes/runtime binaries/node_modules excluded. Seven check phases have full payloads;
Git-only staging/commit records exact argv/cwd/UTC/output but no identical pre/post
capture layout. Historical earlier capture loss and root producer ledger exception
remain unchanged. Current unit ledgers/docs stayed frozen until completed audit.
No hermetic/account/GUI/native writer/release/P4 proof. Official quota72used28remaining,
ordinaryallowed/reset2unused; goalactive and next C1/C2 dispatched in dependency order.

## Copilot Controller C1 — locally accepted8122556

BASE026c724→8122556554fd9a5d9996768effc5b9006c1486e2, exactly6files/403insertions/
30deletions. Dedicated owning registry/Adapter association, ConfigPlan enabled
physical preflight/disabled home reservation, strict authenticated profile route,
all-runtime raw retention/shutdown/receipt/persistence retry and undefined source
with exact copilot-rpc aggregate denial. Public unsupported model/routing trial/
standalone trial/publication preview+blocked commit allocate no canonical Task/Run/
Adapter Session/native producer. Actual final assertCurrent reads current canonical
Task/Run/config selection/session/workspace/invocation/lease/cancellation/observer/
start/control document+row and complete Adapter/InteractionStore tuple in one
synchronous transaction AFTER external fence/clock callbacks. Shared pure predicate
extraction preserves Codex/OpenCode/Devin call order; Pi separate guard unchanged.
Two real fixture families share only proven exact service/error retained-stop and
raw/catalog storage safety; provider descendant/capture/teardown remains local.

Source WIP29 SHA d106ee8e03c953e40ff788fe0e00ab85ca2d98c24d4b74e755c2152bbbac06d9
maps28 C1+explicit C2restart1, current56/control28. OldDevin73 wholefile and protocol
arrays Copilotb1165204a82187ded7349213f8f4a63a56bc77dec085f8d3af59e5e8bdf6456b /
Devin920166736660a0eb6db195648175e8e211e2643e096041e8690b4c0ac69ee772 unchanged.
Root independent source/table/scalar/target map:
/tmp/dispatcher-copilot-controller-c1-root-source-preservation-20261025.json.
Explicit API adaptations: real STARTING/reserveLocalStart/ExecutionSelection;
terminal idle setup only for idle drain; global flag→all-owning-profile disable;
actual safe ProfileConsoleView; wrong-version9.9.9 accepted-runtime outcomeunknown
while original oneproducer/no create/send/replacement remains. No native store
private API, artificial catalog/default/entitlement or runtime/client/schema change.

Original28failure behavioral RED is loaded but many paths were blocked at missing
composition; not28 independently exercised purposes. Original build/private-field,
stale-dist manifest, public payload/schema/verification, wrong open spy and lint
setup failures remain. Final workspace/config reentry RED failed later authority
code instead of final SCOPE_CHANGED, then corrected. HUMAN_ACTIVE row mutation
caused SQL CHECK error, not a send: original claims retained/corrected Linear
99109762/root trace SHA669f7671... and wiredbf8f3e1...zero sends. Separate corrected
lawfulHUMAN RED returnedRUNNING and actual wiree5486b36...sentonce; final direct row/
document agreement plus workspace/config revision checks cover eleven finalseams.
All original failed outputs/trace/source remain, no deadline/worker/cache/assertion
weakening or unchanged full retry. Diagnostic noise M1 remains, no suppression.

Final build/lint/focus14files1121 and ONE mise exec -- pnpm check pass204files4132
plus all build/typecheck/lint/boundary checks. Command UTC2026-10-25T22:53:01.496374
..22:56:20.989191, wall199.4920095s, logSHA
7e71aebf639c98f84c5804d5336358f897017040542ac551a7699ca56377c6b1.
Evidence /tmp/dispatcher-copilot-controller-c1-evidence-20261025. Command ran at
BASE026c724 with six frozen changed files, exactly equal committed8122556; not a
claim of clean committed-HEAD full execution. Required independent review
/tmp/dispatcher-copilot-controller-c1-task1-review-20261025.md fully read:Spec✅/
QualityApproved0C/I/M1 inherited output noise, no suite rerun. Root cannot-verify
cross-task checks resolved by actual audit/source preservation/primary checks and
three source503 verification-only cells; all503 identity columns unchanged.

Root /tmp/dispatcher-copilot-controller-c1-root-audit-20261025.json verifies28phases
(12historicalv1/16v2),123584pre123584post copies/513external/151078identityrows/
64digests32Gitobs/530trackedGit, all committed bytes agree; full4722input/39external
prepost equal, direct700dist16buildinfo, primary HEAD/status/allthree dirty contents
unchanged. C1 controlled full96trees56roots3806fileRefs verified; across phases335
whole-tree snapshots13333fileRefs912owned admin references,7707unique content payloads/
14485capture events. Older capture shapes are explicit:1540legacy content records/
124legacy events lack retained length; producer225executable pins plus459retained
members do not imply original per-member digest declarations. Other-provider/native
format exclusions remain; node_modules/runtime payload/globalGit excluded. Initial
build4compiled outputs and source-map generator's own output are intended recorded
deltas; fullstrict freeze passed. Root audit inspector initially misclassified
output mutation/legacy identity schemas; failed attempt1..4 scripts retained,
corrected to actual schemas without test rerun or dropping final requirements.

Full report was frozen SHA4b180ef61da92c98e917ca9efdbbde2ff42499740d2c5193f2a819a7c3640373;
after gate only its status line and completion addendum changed to
8f0fedd7c8454c34400828a857ec28ebf9fb3819a4a336ecef1a6da96c062094. Root comparison
/tmp/dispatcher-copilot-controller-c1-root-report-freeze-comparison-20261025.json
preserves that exact difference; self-review stayed frozen. All code/root ledgers/
external gate inputs unchanged during full. Current code and repository tracked
inputs match committed blobs. No current final input/capture waiver.

NEW historical exception under root rulings4/5: initial removed fixture Git object/
managed-tree bytes and intermediate ignored dist/external/pure-command time are
unrecoverable despite original executable/path/stat/native bytes and seed metadata.
Early runs are partial, not exactly reproducible/hermetic; later complete captures
are fresh executions and do not repair/replay originals. Full current C1 captures
all controlled in-tree objects/admin refs before actual starts and after drain,
hashes/sizes from same buffer with source stat separate. These are live-file byte
observations, never an atomic DB backup/OS image. This follows user's explicit
recorded-blocker alternative, not closure of the breach. Carry alongside old
runtimeI3 and producer-ledger exception to CV14/final summary. Root primary original
state preserved. No public push/globalidentity change; local committer notice remains
for eventual separately authorized publication review. C2 readonly certificate next,
all account/provider/GUI/writer/stop/history/continuation/release/P4/CI/rollback/
wholebranch/remaining-development/formal Gates stay open. Latest official83used17
remaining ordinaryallowed, two reset credits unused; user's nonstop goal active.

## Copilot C2 stored readonly restart — locally accepted4881a25

BASE67a1efe→4881a2565eaa8ec087afaea185be23482a6ec922, exactly3paths/164insertions/
3deletions. Appended isReadableManagedCopilotRun uses existing full checkedManagedRun
and exact Copilot/copilot-rpc/global/opaque1..512UTF16/noC0DEL/no unstarted/no thread/
parent shape. Only constructor compatibility and bound readonly reconcile expressions
consume it; no physical/native/credential/config/schema/runtime/SDK changes or writer.
Full10263byte old helper/provider prefix SHA
82b97306d429080234ac4cf3758cb6a7cae20da0eb2073fce7cfe9a071ee9c2c exact,
new871byte suffix. Root independently reversed only import and two admission tokens
to exactBASE service bytes: /tmp/dispatcher-copilot-controller-c2-root-prefix-20261025.json.
Root first inline prefix check miscopied one zero in expectedSHA; corrected literal,
actual Git bytes unchanged and no tests rerun. No source503 helper/test row invented;
these are new owning modules, originalWIPrestart1 maps through service/source29 manifest.

Source WIP declaration12/restart1 SHA
 d106ee8e03c953e40ff788fe0e00ab85ca2d98c24d4b74e755c2152bbbac06d9 is now covered:
TaskQUEUED/RUNNING after actual native result/raw settlement, actual C1STARTING/crash
reservation replaces old unreservedACTIVE fixture explicitly. Exact original Run's
state becomes recoveryState, unknown/manual/unavailable Task/readAPI/observation/
receipt mapping and no producer/factory/root/source or mutation. Existing startup
SENDING→UNKNOWN/NATIVE_START_OUTCOME_UNKNOWN changes only state/code/revision+1/time;
first new expectation of byteexactSENDING failed and was corrected to this real
contract, no production projection change/ACK/terminal bypass. Direct certificate
purity after aliases disappear has zero DBwrites/Node physical-fs/process calls;
aliases restored for strict owned-reference teardown. Whole Controller recovery's
intentional existing writes are separate, enabled physical preflight still applies.

Current101 =2original Task-state positives+1purity+20field+52shape+17structural
corruptions+5opaque+4malformed. Opaque all-copy agreement is not external provenance;
realclientUUID does not narrow actual supported runtime grammar. Existing wrappers,
fixtures/helpers/provider suites, original71ledger/brief/plan files and503 identities
unchanged during implementation. BehavioralRED2 actualconstructor denials; missing
certificate purity separate; three controlled faults make missing shared agreement,
C0 filter and forcedUUID fail actual tests before restoring final source. Original
101matrix GREEN and firstfocus19files1504pass/2newreceipt failures retained; corrected
finalfocus20files1506 pass, no worker/cache/deadline/skip/expectation weakening.

ONE defaultfull mise exec -- pnpm check passes205files4233tests/all non-test checks.
Command-only UTC2026-10-25T23:20:53.147452..23:24:25.932542, wall212.784139833s,
logSHA6bcc8fa81f378826bc8fa8e6636c09d470e0f46e6b7752c1c0c05c37e76bcbbb.
Execution HEAD was67a1efe with three frozen changed files, exactly equal committed
4881a25; not clean final-candidate SHA qualification. Evidence
/tmp/dispatcher-copilot-controller-c2-evidence-20261025. Independent review
/tmp/dispatcher-copilot-controller-c2-task1-review-20261025.md fully read:Spec✅/
QualityApproved0C/I/M1 expected request/denial log noise, no suite/audit rerun. Root
cannotverify state/payload items resolved by audits below and immutable503 policy;
formal/account/provider/GUI/writer/stop/history/continuation/release/P4/CI remain open.

Root /tmp/dispatcher-copilot-controller-c2-root-audit-20261025.json verifies25v2runs,
118258pre118259post source copies,760pre760post external copies/1520external identity
rows/236517source identityrows/100digests50Gitobs/532trackedGit, zeroerrors, primary
HEAD/status/allthree dirtycontents preserved and every committed blob matches full.
Full4731inputs43external prepost identical and commonGit head/status/diff/index equal;
700 directdist16buildinfo vs2004historical compiled paths (2720aggregate),52fullrebuild
stat identities changed but bytes equal.1094controlledtree snapshots44867fileRefs/
3192ownedadminrefs;24801content payloads48293captureevents, firstRED4trees166fileRefs
and full290trees153fixture roots11857fileRefs checked. Standard unrelated-provider
formats explicit:225producer exe pins/459retained members are not per-member original
hash declarations; runtime/node_modules/globalGit payload exclusions stay. No new
historical missing-fixture waiver: original first native/Git objects/admin inputs
captured contemporaneously. Earliest explicit Git-tool identity was absent; later
wrapper adds it without retroactive metadata claims. Current capture is individual
live bytes, never atomic OS/SQLite backup or real-provider qualification.

Recorded expected output changes: build7compiled bytes, fixture/source audit outputs,
report-preparation creating report and report-finalization updating only report/results
after full. Root /tmp/dispatcher-copilot-controller-c2-root-report-diff-20261025.patch
retains exact frozen/final report difference; existing live drift only that report,
no code/ledger gate drift. Intermediate matrix-green had external wrapper/input-list
metadata edited while it ran (only Gittool identity and accepted C1audit refs); both
pre/post payload versions and actually executed old wrapper retained, source/test
bytes unchanged. Root /tmp/dispatcher-copilot-controller-c2-root-matrix-tooling-delta-20261025.json
records it. Do not call that intermediate tooling frozen; actual finalfocus/full
use completed frozen tooling and no unchanged rerun. Root initial audit falsely
classified handoff JSON as old flat schema; removed unused v1 path (C2allv2), failed
attempt script retained, no tests rerun or final requirements weakened. Existing
C1 partial original Git/dist/time breach/olderruntimeI3/group/R020 remain separate
history. Local committer notice kept, no global identity/push/primary changes.

Source29 WIP controller purposes now all mapped28C1+1C2; source17ConfigPlan and all
local Copilot client/producer/runtime units remain their recorded reviewed scope.
NextCursor locator/resume46, then Devinv3/UI/retention/delivery/Node/dependency/perf/
wholebranch/CI/formal work. Latest official91used9remaining ordinaryallowed=true,
reset2unused; latest nonstop goal continues, no obsolete stop threshold applied.

## Cursor inventory/exact resume — locally accepted88265e9

BASE5fbefc4→6d01f89507a36b4de47467137ac76574109c103e→
88265e9dd0fb6902674527d55a539f1f4bf4700a, exactly4paths. Restores original root
metadata API/types with existing SDK1.8 codec/root owner/environment and actual
CursorDefinition exact-ID consumer before credentials. Only initialize/session/list;
metadata sessionId/cwd, bounded100/page10pages1000/1MiB64records, literal opaque IDs,
exact physical scope and unknown cleanup preserved. No Controller source/history/
writer registration or installed Cursor/account/protocol qualification.

Source26decl46→current37decl73 (27regressions). Root AST independently verifies all
seven original parameter tables byteexact; only title mapping is the explicit
canonical pre-snapshot MODEL_SNAPSHOT_UNKNOWN refusal with zero credentials/backend
and historical Session bytes unchanged. NativeInput assertions map actual argv/
stored choice, no unused mirror. Original fake construction call4413bytes including
one indent SHA f2768537292755dfdd662c7485f69d4fc6470e1780ede969e25b77b4a14fd28e;
array literal4361 and unindented call4412 separately exact. Root corpus/source maps:
/tmp/dispatcher-cursor-inventory-root-{corpus,source-preservation}-20261025.json.
No source503 row added/removed or identity/owner changed; four verification cells updated.

Final focus8files304tests, build/changed lint pass. First full206/4304 applies only
6d01f89. During that frozen gate, implementer raised raw synchronous spawn exception
edge. Root verified actual Node24.21 internal branch (SHAace05809adf0d02482984f6b9fb8418b3c788df2d8fb8fec3527bfcfd7465d2f);
two controlled ENOMEM/private-diagnostic REDs now cover actual version/ACP call sites.
Separate correction keeps typed guards/cleanup unknown/no retry and shared helpers
unchanged. Changed-input full2, never an unchanged retry, passes206files4306tests/
all non-test gates. UTC2026-10-25T23:58:49.088864..2026-10-26T00:02:29.879760,
command wall220.789822459s, logSHA
07f6b512f4922f26cd42fd299aae039aa8864a09bbf0fe845d479cca5938cb51.
Execution HEAD6d01f89+two frozen changed files equals final88265e9, not clean final
candidate CV14 qualification. Independent gpt-6-astra task review fully read:
/tmp/dispatcher-cursor-inventory-task1-review-20261025.md, Spec✅/QualityApproved0C/I/M.

Root19run audit /tmp/dispatcher-cursor-inventory-root-audit-20261025.json verifies
90100pre90104post source copies419+419external/180204identityrows/90digests38Git,
535trackedGit committed bytes and protected primary, zeroerrors. Full4744source/
29external frozen;704currentdist16buildinfo vs2004historical compiled paths,
52reemit stat changes byteidentical and commonGit unchanged.2381Cursor manifests/
7365payloads;580other managed tree snapshots23714fileRefs1680adminrefs;13174content/
25550captureevent references verified. Other-provider formats remain explicit:
150producer exe pins306retained members are not per-member original digest claims.
Only build output deltas occurred during checks, no external tooling/list drift.
Final report bookkeeping and root ledger update occur after gate; exact report
comparisons retained in /tmp/dispatcher-cursor-inventory-root-report-*.patch.

First native generated input bytes/stat/mode/scope/calls retained before execution
at23:42:48.725Z, red-environment/37roots150manifests; normal version lacks independent
PID/pipe telemetry, and old helper boolean does not prove ESRCH. These remain
API/code-path outcomes with recorded limitations, not replayed physical receipts.
Outside-array actual lifecycle instrumentation and strict PID classification added
before later checks; final323manifests60roots700unique recorded lifecycle events,
271absent/4present strict observations/0real unknownerrno. Four present observations
belong to two inherited children before their natural exit; later exit never promotes
CLEANUP_UNKNOWN. The EPERM/EACCES and ENOMEM regressions are injected faults, not
observed OS failures. Root observation audit verifies exact source fields/bytes:
/tmp/dispatcher-cursor-inventory-root-observation-audit-20261025.json. No current
missing generated payload/unresolved controlled root/pipe found. Earlier C1/oldI3
historical losses, group/R020, logging/committer and formal Gates stay open; current
Node/runtime/node_modules/globalGit exclusions and non-atomic capture limits remain.

NextDevinv3 now source74 (native53+Config13+Controller8) with current final Guard/
STARTING reservation preserved, then UI history14 and other controls/retention/
security/Node/perf/wholebranch/CI/formal work. Goal remains active. Official98used2
remaining ordinaryallowed=true/reset2unused; tool prohibits Codex UI automation and
quota API is readonly, manual-reset request pending, no bypass or obsolete stop rule.

## Devin v3 principal/readonly safety — locally accepted b091d6c

Task BASE28f77a3→45130fb07b86a9d0f650ee16affe6720a4552b71→
b091d6c399776b2685c208dfe5b901e7fb57910c, exactly8 authorized paths. Existing
ConfigPlan/Controller composition validates explicit human owner and integer ACU,
passes native fields/minimum budget, preserves invalid persisted bytes and rejects
malformed discovery before I/O. HTTP org/session/owner attribution is exact;
supported custom backend optionalorg remains, snapshots captured once before use.
Current callback-aware input capture, final guards, STARTING duplicate reservation,
execution selection/resource and canonical SESSION_PROFILE_MISMATCH remain.
Readonly library port requires exact binding/runtime-qualified evidence and bounded
GET projection; coverage stays partial, mutations/stop/writer/GUI unknown. No default
Controller cloud source registration, account activation, DELETE or provider call.

Root AST audit independently locates all source74=53native+13Config+8Controller,
40 declarations, actual call hashes/locations and literal tables. Two native call
adaptations preserve current foreign-profile error and unpromoted STARTING reservation;
Controller8 uses actual existing ConfigPlan plus stronger zero-create/preview/export/
restart checks. Source74 map byte-identical through the fix, SHA
6cec874491ae2f3de46c8851ea9f24b478760a64feccca083a8379a9c90847dd.
Root corpus /tmp/dispatcher-devin-v3-root-corpus-fix1-20261026.json has zero errors.
Source503 identities/owners/decisions stay exact; only7 scoped verification cells
updated, with whole original config/controller/start-intent suites still separately
owned rather than promoted wholesale by this increment.

Concrete raw fetch-write diagnostics are now static DEVIN_WRITE_UNAVAILABLE, while
possibly-delivered uncertainty and Local-service response-lost behavior remain.
Original full1 failed one current errorcode expectation, retained; root ruling5
preserves current canonical code without weakening legacy tests. Full2 passed
209files4411tests but independent review found prefetch cancellation classification
and long BOM fidelity defects. Fix1 adds6 cases: RED4fail/2contrast-pass, focus12/248,
build/lint/map pass; prefetch creation now typed not-created, final Guard and entered
fetch uncertainty unchanged, literal BOM/astral prefix and byte/page bounds proven.
Controlled signal spies assert requested10000ms and restore in finally; these are
stage faults, not elapsed10s or raw physical cancellation proof.

Changed-input final default pnpm check passes209files4417tests and all non-test
gates. UTC2026-10-26T16:09:41.884680..16:13:27.206214, wall225.321203375s,
logSHA9d6a5818afd7b1121647ccff6f7b76a6cd4c40a73418719caee836c7620db044.
It ran HEAD45130fb plus frozen2file fix, equal committedb091d6c; this is not the
later clean exact-candidate CV14 gate. Full1/full2 remain exact earlier evidence.
Independent originalreview0C/1I/1M then scoped re-review I1/M1 ADDRESSED,
QualityApproved0C/I/M: /tmp/dispatcher-devin-v3-task1-fix1-review-20261026.md.
Existing Controller expected error/request log noise is deferred to branch review.

Root /tmp/dispatcher-devin-v3-root-audit-fix1-20261026.json checks33 runs,
156856pre+156856post source copies,3137+3137external,313712source identities,
6274external identities,183digests/66Git observations and539committed Git payloads.
Final4754source/261external frozen,704currentdist16buildinfo vs2004historical dist;
all committed bytes agree and protected primary remains intact. Only allowed build
output changes during checks, no input/tool drift.265Controller tree snapshots retain
413original identity files plus126early retained files/124142528bytes;25LF JSONL
files3632records/586raw data chunks13569467bytes;69918generated artifact identity
rows verified. Other-provider controlled fixtures are independently verified under
their recorded formats, not relabeled physical/account/Gate receipts.

Early native HTTP first-run23 responses actually retain all23 raw bodies; the earlier
missing-body hypothesis was corrected by decoding original data, no replay/waiver.
Early Controller payloads lack original stat inventory/local inject JSONL; later
actual captures add those layers and do not retroactively fill them. Root's first
JSONL inspector incorrectly split legal U+2028; corrected LF parsing verifies raw
records unchanged. Root's post-fix append-only report assumption also failed before
edits because author updated Status after gate; full diffs and a precise Status-only
prior-byte exception verified, all other prior report bytes remain. Model capacity
after original full2 required root mechanical exact-index commit only; actual original
agent resumed for fix1, no second writer/root implementation patch. Report/status/
result bookkeeping after gate is separately retained. No new historical byte loss.

Original C1/I3 losses, group/EPERM/R020, general logging/committer and formal Gates
remain. Node/runtime/node_modules/globalGit exclusions and non-atomic captures are
explicit. Whole goal active; next scoped project Node/dependency security increment,
then UI14/other controls/retention/delivery/recovery/performance/wholebranch/CI.
Current official quota snapshot15used85remaining/ordinaryallowedtrue/reset2unchanged;
user said continue without reset, none consumed. No real-account/service activation.
