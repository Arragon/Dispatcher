# Devin Local ACP cold read-only stored recovery

> Use superpowers:subagent-driven-development. One fresh implementer and required
> task reviewer; no worker subagents. Parent CV14 owns broad integration/review.
> Accepted C1 is175b2d4+bee6483; reuse its strict shared fixture unchanged.
> Record actual clean dispatch BASE after root metadata before implementation.

**Goal:** Accept only internally consistent bound managed Local ACP records for
cold metadata reads and existing recovery reconciliation, without opening native
sessions, reading physical/native/account data or restoring mutation authority.

**Spec/source authority:** The one original restart/no-reattach case in frozen
/tmp/dispatcher-devin-acp-preflight-20261024/apps/controller/test/devin-runtime-service.test.ts
at a499d84e88c9f4ff1d01c89cc20304f236fe2bbd, SHA256
70a77ec668612baf61cc9840e8e74fa4c3898e2152656079e52492a35d8b0e47. C1 owns the
other29 source cases and the catalog's actual exact-selector trial. All30 source
case inventories must remain mapped explicitly; source counts are not evidence of
passing tests. C1 real fixture/composition and accepted internal runtime are inputs.

## Global constraints

- Only /Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher,
  codex/dispatcher-plan-completion; preserve dirty primary. One source writer, root
  owns docs/source503/Linear/ledgers; no worker subagents or external/native account,
  service activation, paid/cloud operations, push/merge.
- Exactly three paths: apps/controller/src/start-recovery.ts,
  apps/controller/src/service.ts and new apps/controller/test/devin-runtime-recovery.test.ts.
  Reuse the accepted C1 fixture module unchanged and existing
  apps/controller/test/fixtures/managed-restart-storage.ts helpers. Do not clone a
  subprocess server or implement runtime read/eval of test source. Report concrete
  fixture scope conflicts before changing a fourth path.
- Extend the existing private checkedManagedRun storage predicate with only a
  narrow isReadableManagedDevinRun wrapper. No copied full predicate/new generic
  framework. Keep every existing Codex/OpenCode/Pi certificate and legacy/unbound
  start journal guard unchanged. The common helper already checks normalization,
  Run/Task/currentRun/Session/Adapter/reference/selection/invocation/execution tuple,
  run-contract repository/base, exact binding copies, unique SQL/document control
  ownership, identity diagnostics and validateExecutionBinding.
- New certificate requires provider/product devin-local, backend devin-local-acp,
  managed-worktree ownership, global region, no nativeThreadId/parentSessionId and
  bound opaque nonempty native Session ID <=512 UTF-16 code units, with no C0/DEL
  or unstarted prefix. Match actual reviewed producer shape; do not impose Pi UUID,
  OpenCode ses grammar, Unicode normalization or account provenance assumptions.
  Consistent opaque store/ID rewrites prove stored agreement only.
- Add the wrapper to the existing constructor startup guard and
  reconcileLocalStartJournals provider admission ORs only. Reuse existing transaction,
  observation invalidation/read barrier, NATIVE_OUTCOME_UNKNOWN/manual Run recovery,
  canonical Task transitions and saved publication/dispatch receipt projection.
  No new persisted shape/version, recovered live source, automatic continuation,
  history, quiescence, mutation or writer qualification.
- Predicate is pure stored validation: total_changes unchanged and zero filesystem,
  process, native account/provider calls. Test valid stored records after deleting
  fixture executable/homes/worktree: predicate still qualifies; the existing
  assertDevinRuntimeSettings separately rejects those missing physical paths (C1
  already covers real enabled ConfigPlan admission failures). Do not bypass that
  gate, disable a saved profile, fake a terminal Run or widen exception handling to
  manufacture successful startup.
- Preserve the original restart case's literal settings/binding, zero producer,
  no new/load/prompt, no native source and unchanged prior root log. Use the real
  canonical C1 setup rather than old ModelSelection or incomplete Session records.
  Cover both QUEUED and RUNNING canonical Task outcomes, exact recovered Run and
  Session/Adapter identity, task-dispatch receipt, fresh unknown observation/barrier,
  empty new runtime hosts and denied continue/steer/approval/verify/deliver/advance.
  A stored prior readable observation cannot restore authority after restart.
- Corruption matrix must isolate storage boundaries. Use editStored for inconsistent
  documents and replaceBindingCopies for consistent binding-shape mutations; a bad
  copied field must not mask ID grammar. Cover at least the actual existing Pi narrow
  shared-boundary field set, missing rows/currentRun/diagnostic/unique control/SQL vs
  document mismatch and provider-specific consistent malformed bindings. Existing
  OpenCode full shared matrix stays unchanged. Before/after invalid constructor
  compare original Run/native logs; reject before producer/native/file operations.
- Explicit malformed Local ID controls: empty, length513, unstarted prefix, C0 and
  DEL (including leading/embedded/trailing LF/CR), wrong type; consistent binding
  ownership/product/backend/region/thread/parent mismatches. Positive controls:
  opaque Unicode ID, exact length512, opaque store rewrite; 1-character valid ID
  if not otherwise covered. Do not infer external provenance from these positives.
- Add actual behavior regressions. Capture current C1 startup refusal on the valid
  bound source case as loadable RED before adding the certificate; a missing export
  or import is setup evidence only. Preserve previous C1/source/provider bodies and
  budgets, no ignored/skipped/loosened assertions or worker/cache/timeout changes.
- Every verification command actual pre/post source/tests/config/lock/dist/buildinfo/
  ignored lint/executed script bytes outside checkout, UTC/argv/cwd/HEAD/status/exit/
  wall/output/digests, external copies keyed by full absolute-path hash. Explicit
  runtime/node_modules exclusions, no hermetic claim. Build before cross-package
  tests; self-review before final freeze; one unchanged final pnpm check.
- Original group/EPERM/R020/CV13 audit28, MinorCV14 diagnostic noise, parent CV14 and
  real provider/account/GUI/writer/service/release Gates remain open; no production
  logging suppression, native session deletion or local-to-formal promotion.

## Task 1: Certify stored Local ACP identity for metadata recovery only

**File map**

- start-recovery.ts: one explicit Local wrapper using existing checkedManagedRun.
- service.ts: narrow import and constructor/reconciliation predicate extensions.
- New devin-runtime-recovery.test.ts: original source restart1, both canonical Task
  recovery states, pure no-physical/no-write certificate, decisive corruption matrix
  and consistent opaque positives using the unchanged actual C1 fixture/helpers.

**Steps/acceptance**

- [ ] Verify C1 exact accepted fixture/API, source-case map and read actual affected
  files/AGENTS/relevant architecture/knowledge. Record source1/current-case inventory.
- [ ] Loadable valid stored restart RED on current startup guard, then narrow owning
  predicate/OR extensions and full corruption/positive/authority regressions.
- [ ] Self-review, build, changed-file lint and actual focused command:
  `mise exec -- pnpm vitest run apps/controller/test/devin-runtime-recovery.test.ts apps/controller/test/devin-runtime-service.test.ts apps/controller/test/opencode-runtime-service.test.ts apps/controller/test/pi-runtime-service.test.ts apps/controller/test/native-recovery-preflight.test.ts`.
  The existing four named suites were verified; native-recovery-preflight is the
  actual recovery suite, replacing an absent draft control-recovery path.
- [ ] One unchanged final `mise exec -- pnpm check`, all non-test gates plus tests;
  preserve failures, no unchanged retry or scope widening without concrete ruling.
- [ ] Scoped three-path commit; final Git/pre/post input audit and exact complete
  assigned report. Required independent task review/root metadata follow separately.
