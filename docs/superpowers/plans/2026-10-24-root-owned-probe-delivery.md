# Root-owned version probe delivery

> Execute with `superpowers:subagent-driven-development`: one fresh implementer,
> one task review, no worker subagents. Parent CV14 owns the final branch review
> and integration; retain all SDD workspaces.

**Goal:** Deliver the independently useful root-only cleanup/probe capability
for later ACP/Copilot/Cursor work, preserving existing shared group consumers and
keeping their proposed hardening explicitly unfinished.

**Architecture:** One freshly spawned non-detached ChildProcess has one concrete
`OwnedProcessRoot`. A structural `stop()` capability plus independent bounded
natural `close` confirmation feeds the current version reader. Group ownership
and Codex execution remain exactly at the pre-WIP baseline behavior.

**Spec:** This plan's binding requirements; the dated partition ruling in
`2026-10-24-native-ownership-prerequisite.md`; independent review/partition
assessment `/tmp/dispatcher-native-ownership-task1-review-20261024.md`.
The preserved candidate is `56db4b540ed86a8a66fd1e896269670127c7f41e`; exact
pre-WIP group baseline is `84cde57a9c2f1d40414e0f1dc967befa5de91326`.

## Global constraints

- Use `/Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher`
  on `codex/dispatcher-plan-completion`; preserve the dirty primary checkout.
  Root records the clean actual dispatch BASE after the separate fixture fix.
- Preserve WIP56db4b5 and every original failure/evidence byte. Original combined
  ownership Task1 remains incomplete, including group source cases1/2/3/5/6 and
  real drainage acceptance. R020 is independent and unresolved. No global PID
  policy exemption, retry-to-success, toggle or duplicate owner is authorized.
- Restore `owned-process.ts`, `codex.ts`, `owned-process-status.test.ts` and all
  pre-existing portions of `owned-native-process.test.ts` byte-for-byte against
  84cde57. No existing assertion, timeout, worker, cache, lint or shutdown-policy
  weakening. Candidate-only group tests stay in the preserved WIP and pending
  source map; omission in this narrower payload is not a fix/pass claim.
- Retain the real root owner, structural drain and explicit root probe opt-in.
  Exactly one owner per fresh spawn. Root uses the original bound child kill
  method only; never process.kill, group/taskkillT signaling, enumeration,
  inferred/recovered PID or descendant/writer-release claims.
- Root `stop()` caches one operation and failures, captures PID/bound method,
  latches original exit/close or observed not-created spawn failure, and refuses
  changed/missing identity. TERM then25ms polling up to2000ms then KILL; successful
  delivery or child.killed is not exit/close evidence. Caller confirms closure.
- Version `ownsGroup?:false` selects detached false/root ownership/500ms natural
  close; omission preserves existing group/platform/2000ms behavior. Preserve
  childExecutionEnvironment, cwd/PWD, 3000ms timeout default/cap, 16384byte stdout
  bound, pre-abort/invalid timeout refusal, unconditional drainage and pipe-error/
  cleanup-error precedence. Do not destroy pipes to manufacture close success.
- No provider/Controller production wiring, dependencies/lock, index/public API,
  persisted format, migration, native/account/service activation or real-provider
  qualification. Existing separate quota fixture correction is not this task.
- Before each verification command capture actual argv/cwd/HEAD/status/UTC and
  input bytes outside the checkout: tracked source/tests/manifests/config/lock,
  all runtime-consumed dist/buildinfo, ignored lint inputs and executed scripts.
  Capture actual output/exit/end/wall/post bytes and digest each record. Preserve
  failures; no reconstruction or unchanged reruns. Runtime/tool identities are
  metadata; node_modules and runtime binaries are excluded, not hermetic proof.

## Task 1: Isolate and accept the root-only delivery

**Files**

- Restore the three complete baseline paths specified above.
- Reconstruct `packages/adapters/test/owned-native-process.test.ts` from exact
  baseline plus only the candidate's root-only fixture/test additions. Preserve
  every baseline test/fixture statement; omit candidate cooperative Codex changes.
- Remove candidate combined `packages/adapters/test/owned-process.test.ts` from
  this payload after moving its root-only cases and required faithful helper to
  new `packages/adapters/test/owned-root-process.test.ts`. All group-only candidate
  cases remain reachable in56db4b5 and explicitly pending; do not edit/reclassify
  their frozen source assertions. Preserve every moved root assertion.
- Retain `packages/adapters/src/owned-root-process.ts`,
  `packages/adapters/src/catalog-process.ts`,
  `packages/adapters/src/native-version-probe.ts` and
  `packages/adapters/test/native-version-probe.test.ts`. Avoid rewriting unchanged
  root code. A new default-group test's exact mock-call sequence may need adapting
  to the restored baseline ordering; preserve its concrete signal/environment/
  unconditional-drain/budget assertions, report the exact reason and both values.
- Root owns coordinated docs/knowledge/source503/Linear; implementer reports facts
  for them without editing those files.

**Steps and acceptance**

- [x] Read current affected code/tests, scoped AGENTS and relevant architecture/
  knowledge; verify actual BASE/status and preserve unrelated root metadata.
- [x] Record the partition before editing: which complete blobs restore, which
  root assertions/fixture hunks move and which deferred group cases remain WIP.
  This is extraction/restoration of existing candidate work. Reuse its actual
  root RED evidence at `/tmp/dispatcher-native-ownership-evidence/phase2-red`,
  with explicit byte/history limits; do not invent a new RED by repeating it.
  Any newly discovered behavior defect still needs meaningful regression RED.
- [x] Perform the scoped extraction/restoration. Audit complete restored blobs
  against84cde57 and baseline native fixture prefix/hunks exactly; preserve all
  root tests, including source case4's original scenario/signal assertion.
- [x] Verify root identity before/after await, captured method/exit, shared promise/
  cached denial, missing PID vs observed spawn failure, TERM/KILL no fabricated
  exit, zero group authority, real inherited descendant survival and natural pipe
  closure failure. Preserve test fixture cleanup only for its freshly owned roots.
- [x] Verify explicit/default probe modes, exact environment and stdout/time caps,
  abort/error/denied cleanup paths, unconditional drain and natural500/2000ms
  distinction. Default-group assertions must exercise restored actual owner.
- [x] Run focused acceptance using existing tooling:
  `mise exec -- pnpm vitest run packages/adapters/test/owned-root-process.test.ts packages/adapters/test/native-version-probe.test.ts packages/adapters/test/owned-process-status.test.ts packages/adapters/test/owned-native-process.test.ts packages/adapters/test/codex.test.ts packages/adapters/test/pi-rpc-client.test.ts packages/adapters/test/codex-app-server.test.ts packages/adapters/test/opencode-owned-server.test.ts packages/adapters/test/codex-catalog.test.ts packages/runner/test/process.test.ts packages/runner/test/native-runtime-lifecycle.test.ts apps/controller/test/adapter-lifecycle.test.ts`.
  No provider executable/account calls. Retain exact failures and report concrete
  defects before any wider edit; no unchanged retry or test budget alteration.
- [x] Self-review exact diff/call sites and restored-byte audit. Derive command
  expansion from current package.json, then run one unchanged default
  `mise exec -- pnpm check` on final payload. Build/typecheck/lint/boundaries/tests
  must pass for this root unit; old focused/gate results do not qualify it.
- [x] Commit only the listed payload after verification; never reset/amend/delete
  WIP/history. Report exact tested/Git bytes, command/result digests, local scope,
  output noise, all unresolved native/group/formal Gates. No push/merge/deploy.
- [x] Write full report to assigned task report; return only status/commit/test
  summary/concerns/report path. Root creates required independent spec/quality
  review package and coordinates metadata afterwards.

**Later provider contract:** Every ACP/Devin, Copilot or Cursor consumer must
prove detached false, fresh root-only construction at every spawn/exception/close
path, explicit ownsGroup:false for this reader and separate500ms natural-close
confirmation. Importing a helper does not establish these facts, native completion,
background tool absence, Session deletion or writer release. Shared group safety
remains open for Generic, Runner, catalogs/default probes, Codex and other group
consumers; a provider retaining one of those paths cannot claim independence.

Local Task1 completed659fc1b after independent spec/quality Approved; focused12/297 and default191/2985. Original combined group Task1 remains open; see original plan/ruling and retained evidence.
