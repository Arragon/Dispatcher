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
| CV-05 | in progress: catalog scope, default ConfigPlan proof and per-Run account-default provenance pass 90/813 default gate; lifecycle and old capability/price evidence remaining |
| CV-06/08/12 | pending complete catalog/selection integration |
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
