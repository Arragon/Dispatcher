# Restore orphan inspection and guarded owning-process maintenance

Execute inline fromeab18333; reuse its267/5908 accepted baseline. Restore the
actual missing a499d84 orphan report, read-only CLI and guarded current-owner
maintenance through existing Controller/WorkspaceManager/ProcessManager owners.

Outcome: an authenticated owner can inspect bounded ordinary/retained worktrees
and saved-versus-live process facts, preview safe retirement/stop, and explicitly
confirm only an eligible currently owned orphan. Stored PIDs never grant signal
authority. Referenced, unknown, restore-blocked or replaced work remains protected.
Retirement moves the whole tree; it does not delete source data.

Scope: runner process.ts/current process tests; persistence backup.ts/current backup
tests and one owning-handle lock regression; workspace orphans.ts/index.ts and the
actual optional assertCurrent cleanup consumer; original workspace orphan tests;
Controller orphans.ts/service.ts/cli.ts and original orphan tests. Necessary existing
architecture/know-how/operations/convergence metadata only. No new dependency,
schema/writer/data format, provider, credential or user-worktree operation.

The old HTTP implementation reopened the database pathname in its owning process.
Current diagnostic constraints forbid that. Extract only the existing bounded
RecoveryInventory projection: live requests use the current DispatcherDatabase
handle in a consistent transaction; offline CLI inspects a stable private copy.
Keep the existing offline reader's integrity/schema/byte/row checks unchanged.
Use current OwnedProcessGroup and captured ProcessStartInput/env; do not replace
stronger modern group drain with the older source implementation. Preserve source
assertion purposes; demonstrate any obsolete fixture premise before adapting it.

- [x] Reproduce actual missing HTTP/CLI/report interfaces with focused source tests.
- [x] Restore original bounded workspace report and process inventory/stopOwned
  semantics, preserving current drain, native unknown boundaries and captured inputs.
- [x] Reuse the existing inventory parser through the online owner and private CLI
  snapshot. Prove existing outer SQLite lock remains held; no raw source fd/connection
  is opened by live maintenance. No PRAGMA integrity scan on every live API read.
- [x] Register original protected routes and read-only CLI, reuse actual final
  current-reference checks before stop/retirement and after shared queue admission.
- [x] Run original17 declarations/18 Controller cases and9 declarations/10 workspace
  cases plus directly affected current process/backup/retention regressions. Derive
  actual files/counts, retain original failures and deadlines; no speculative matrix.
- [x] One milestone review; fixes get affected-only review. One final changed-code
  pnpm check on the frozen deliverable, then exact scoped commit, quota read and
  Linear progress/scope readback. No merge/push or formal-Gate promotion.

Latest official remaining69%, no reset; safely stop after unit at<=7%. P01/M17
priority and B-C conditional serialization remain. Primary19db456/three dirty files,
other trees, immutable previous runtime/data and503 source owners remain protected.
Only owned fixture children/worktrees exercise maintenance; no real provider or
live service starts. agent-gc alone handles allowed regenerable cache cleanup;
retained worktrees are source data and never become cache candidates.

Fixture ruling from actual sequential result17PASS/1FAIL: the old same-group child
is killed by the current stronger OwnedProcessGroup drain (ESRCH). Preserve that
production behavior and all original assertions. Use the existing PTY unverified
membership contract plus an escaped fixture child for this one completed-handle
uncertainty case; current process-group drain tests remain unchanged.

A second fixture RED showed a real qualification mismatch: real NodePTY inherits
EventEmitter.once, so the generic group helper projected a qualified empty group.
Restore the original ProcessManager PTY evidence contract explicitly as unknown/
unverified; keep physical OwnedProcessGroup drain unchanged. This one-line owning
mode ruling is the minimal necessary fix after reassessment, without a shared
helper refactor or weaker test assertions.

Final local acceptance: unified review0Critical/Important/Minor, all11functional
hashes unchanged. Default `mise exec -- pnpm check` terminalexit0:270files/5937tests
and all non-test gates,544.79s test phase. Sourceworkspace implementation/tests
byte-identical, Controller original assertions/deadline unchanged after documented
fixture adaptation. Official remaining66%, ordinaryusageallowed/noreset; agent-gc
dry221.5GB/no candidates/0removed. Primary19db456/three dirty files and503source
rows/seven immutable columns preserved;10eligible verification cells updated.
Exact scoped commit and final Linear receipt follow; original formal Gates and
overall goal remain open.
