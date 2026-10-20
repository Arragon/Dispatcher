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
| CV-05 | in progress: catalog scope/lifecycle, default ConfigPlan, per-Run provenance and adapter selection fences pass 91/833 default gate; remaining legacy/catalog authority assertions tracked |
| CV-06 | private legacy reader and passive Codex/Qoder snapshots verified at 93/849; Controller collection, canonical origin/attempt/time and quota wiring pending |
| CV-08 | optional adapter port, bounded read observer/dispatch and event/release/stop/reclaim foundations pass 99/927; Controller composition remains pending |
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
