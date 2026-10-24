# Devin Local ACP canonical read-only catalog

> Use superpowers:subagent-driven-development: one fresh implementer and one
> required task reviewer, no worker subagents. Parent CV14 owns broad final
> review/integration; preserve all SDD workspaces. Record actual clean BASE.

**Goal:** Port the frozen local catalog through the existing AccountModelCatalog
contract without restoring obsolete ModelInfo or manifest capability fields.

**Spec:** Frozen a499d84e88c9f4ff1d01c89cc20304f236fe2bbd devin-acp.ts150–193
and all30 expanded cases in devin-catalog.test.ts, captured under
/tmp/dispatcher-devin-acp-preflight-20261024/packages/adapters. Current domain
contracts, reviewed root/probe659fc1b, client e53ceb2 and producer2631e36 bind
this port. Source counts are inventories, not target passing totals.

## Global constraints

- Work only in /Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher
  on codex/dispatcher-plan-completion. Preserve dirty primary and unrelated work.
  One source writer; root owns docs/knowledge/503 dispositions/Linear/ledgers.
- Read affected implementation/scoped AGENTS and relevant architecture/knowledge
  before editing. Prefer existing OwnedProcessRoot, drainCatalogProcess,
  readOwnedNativeVersion, childExecutionEnvironment and physical identity helpers.
  No new package, transport facade or copied cancellation implementation.
- Only internal catalog module/test and minimal DevinLocalAcpAdapter constructor/
  virtual modelCatalog changes. No index/domain/protocol/schema/factory/Controller/
  persisted contract or package/lock change; no real provider/account/service work.
- ModelCatalogContext is exactly current profileId/runnerId/repositoryId/
  executionContextRef/reason; no old baseRevision/configRevision restoration.
  AccountModelCatalog is authoritative. definition.catalogProvider is an enum,
  not a callback: no enum expansion, provider alias or generic routing workaround.
- Preserve original30 dispositions:29 directly ported semantic cases, one obsolete
  modelInfo exact-ID/no-Session case explicitly pending real later canonical
  Controller ModelRoutingService.preview(trial) composition. Do not invent
  ModelInfo, test-only Array.find proof, or a cross-layer Controller import.
- Root-only, shell:false, detached:false, private physical executable/workspace/
  XDG homes, pinned devin 3000.11.3 (9c803229faa4), literal models list --format json.
  No ACP Session new/load/prompt, auth command, cloud/account inventory, args/env/
  approval/model/profile fallback. Preserve original PID and descendant assertions.
- A usable query requires unconditional root stop and natural close500ms on all
  success/error/abort/deadline paths. Cleanup unknown takes precedence over valid
  data or abort/timeout. Never swallow stop errors or manufacture close by destroying
  streams before required confirmation. No group ownership or writer/tool absence.
- Whole query deadline1..30000ms/default30000 includes version (cap3000ms), child,
  parsing/normalization and final physical checks. Preserve source120/1200ms and
  latency bounds; no worker/timeout/cache/assertion/lint weakening or same-input retry.
- Capture scope/context/signal/options before awaits; executable/workspace/homes
  identities and captured expected Adapter roots checked before any spawn and after
  awaited boundaries, closing and normalization. Physical alias/inode replacement
  fails. Caller-only mutation cannot retarget an entered read.
- Native projection: exact variant IDs, adaptive→native-auto, selectable:true,
  access:unconfirmed, parameterOptions:{}, billing.mode:unknown, fixed provider
  devin-local/backend devin-local-acp. No alias/default/price/effort/access inference
  or raw native metadata/diagnostics. source:cli-query, freshness:native-fresh and
  selectionSupport:explicit only on validated query. Stable content revision across
  timestamp/order; fingerprint binds canonical owner/context and physical roots.
- Bounds: families200, total variants4000, unique family/variant IDs, nonempty safe
  ID<=240 with no C0/DEL, nonblank label<=240/noNUL, normalized JSON<=1048576bytes;
  stdout and stderr independently<=1048576bytes; fatal UTF-8 and JSON validation.
  Sanitize all external diagnostics/errors. No raw secrets/physical metadata export.
- Existing client113, producer59 and NativeBindingEvents84 assertion behavior and
  fixture bytes stay unchanged. Inherited expected full-suite diagnostics remain
  Minor CV14; no production suppression or pristine-output claim.
- Every verification command captures actual pre/post code/tests/config/lock/dist/
  buildinfo/ignored lint inputs and executed scripts outside checkout, with actual
  UTC/argv/cwd/HEAD/status/output/exit/wall/digests. Runtime/node_modules exclusions
  explicit, no hermetic claim. Reuse retained wrapper pattern under a new evidence
  root, not historical reconstruction. Preserve failures. Build before cross-package
  focus. No native probe/audit/deploy repetition.
- Original shared-group source cases1/2/3/5/6, EPERM/R020, CV13 audit28 and real
  provider/account/GUI/writer/service/release Gates stay open.

## Task 1: Add the bounded canonical catalog and scoped internal Adapter

**File map**

- New packages/adapters/src/devin-acp-catalog.ts: normalization and read-only reader.
  normalizeDevinLocalCatalog(raw,{context,contextFingerprint,fetchedAt}) returns
  AccountModelCatalog. readDevinLocalCatalog({profileId,scope,context,signal?,
  timeoutMs?},expectedRoots?) captures and validates current ownership; profileId
  must equal context.profileId. Reuse Identity/identity from reviewed client.
  Normalizer remains an internal implementation export, no root index addition.
- packages/adapters/src/devin-acp-execution.ts: add optional fourth constructor
  catalogScope?:Omit<DevinLocalAcpScope,"workspacePath">; clone profile/scoped homes
  and capture executable/dataHome/configHome expected identities synchronously.
  Require scoped executable to agree with the actual explicit profile executable.
  Override existing modelCatalog(context:ModelCatalogContext & {workspacePath:string;
  signal?:AbortSignal}):Promise<AccountModelCatalog>. Unscoped delegates existing
  unsupported snapshot (unverified/unsupported/entries[]/MODEL_CATALOG_UNSUPPORTED),
  with no spawn. Scoped calls reader using captured roots, never current caller
  configuration fallback. Keep producer/client behavior otherwise unchanged.
- New packages/adapters/test/devin-catalog.test.ts: local synthetic executable and
  all29 direct source semantic ports plus necessary regressions. Keep cleanup local
  to this file and avoid duplicating ACP fixture or runtime-evaluating test source.

**Canonical source adaptation map**

- Old catalog.context is now owner IDs and opaque contextFingerprint; nativeSelectionId
  becomes id; auto becomes native-auto; catalogVersion becomes revision; collectedAt
  becomes fetchedAt; old pricing/reasoning/default flags become current unknown
  billing/empty parameterOptions and no inferred default/access. Preserve raw-data
  projection refusal and exact sorted selectors. Record case-level substitutions.
- Legacy account context remains invalid; old configRevision:0 negative maps to a
  missing/invalid current owner/ref/reason, preserving invalid-context rejection.
  Do not silently drop the negative purpose or enforce an unused old revision.
- Captured context assertion compares returned owner/fingerprint/revision with a
  legitimate same-scope control query after caller-only mutation; changed canonical
  scope must differ. Do not add response.context or a test-only hash API. Control
  query is isolated from the separate literal-command test's exact two-root count.
- Old manifest.modelCapabilities unscoped assertion maps to real unsupported
  snapshot and no spawns; scoped capability maps to native-fresh/explicit snapshot.
  Keep exact modelInfo lookup case separately pending composition, not falsely
  counted among29. Existing source home's inode replacement test remains zero-spawn.

**Steps and acceptance**

- [ ] Inspect current contracts/root/probe/producer/canonical catalog patterns and
  frozen source; record all30 case dispositions and exact substitutions before code.
- [ ] Port29 direct cases first. Missing-module RED is port evidence only. Add
  meaningful loadable RED for unconditional success drain/denied stop/inherited
  pipe unknown precedence, stdout/stderr/invalid UTF-8 bounds, captured signal and
  physical alias drift, current owner/context validation and scoped/unscoped Adapter.
  Use real production reader/Adapter with local fixtures; narrow spies may model an
  OS denial but cannot supply a fake success or replace owning callbacks.
- [ ] Implement pure canonical projection and owned reader, reusing shared helpers.
  Validate all family/variant bounds and normalized bytes, stable identity, captured
  ownership and pinned version before model command. Every completion drains the
  original root and pipes before returning data/error; no stop-failure masking.
- [ ] Wire only the existing internal Adapter override and captured physical scope.
  Preserve prior client/producer/body maps and all old provider behavior; no public
  registration or obsolete manifest/API restoration.
- [ ] Self-review final diff and named callers before freezing. Build with
  `mise exec -- pnpm build`, targeted lint for changed files, then focus:
  `mise exec -- pnpm vitest run packages/adapters/test/devin-catalog.test.ts packages/adapters/test/devin-acp.test.ts packages/adapters/test/devin-acp-execution.test.ts packages/adapters/test/owned-root-process.test.ts packages/adapters/test/owned-native-probe.test.ts packages/adapters/test/execution-selection.test.ts packages/adapters/test/native-profile.test.ts`.
  Derive tools from package configuration. No unchanged repeat after passing.
- [ ] Run one unchanged default `mise exec -- pnpm check` on final payload, all
  build/typecheck/lint/boundaries/tests required. Preserve any failure/actual input
  drift and report concrete blockers; do not silently amend tests/policy or rerun.
- [ ] Commit only scoped source/tests; verify Git blobs against actual final gate
  pre/post input bytes, source29 assertions/adaptations and unchanged client/producer.
  Write full assigned report with RED/GREEN, commands/UTC/exits/wall/log hashes,
  scope/count mapping, self-review/noise/limitations. No subagents/docs/Linear/push/
  merge/service/native activity. Root will dispatch one independent task review.

**Handoff:** Runtime28 consumes real producer raw status; atomic config/factory17
then Controller30 and the pending exact-ID catalog case follow separately. This
unit establishes local fixture behavior only, no native qualification/activation.
