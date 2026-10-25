# Devin Local ACP atomic configuration and factory registration

> Use superpowers:subagent-driven-development. One fresh implementer and required
> task reviewer; no worker subagents. Record actual clean BASE after root metadata.
> Parent CV14 owns broad final review/integration; preserve every SDD workspace.

**Goal:** Admit only explicit structural Local ACP settings through ConfigPlan
and construct only its owning scoped Adapter, with no native startup/fallback.

**Spec/source authority:** Frozen a499d84e88c9f4ff1d01c89cc20304f236fe2bbd test:
/tmp/dispatcher-devin-acp-preflight-20261024/packages/config/test/devin-local-config.test.ts
(40lines,17expanded cases including every inner invalid-path value), manifest:
/tmp/dispatcher-devin-acp-preflight-20261024/source-manifest.json. Current
native-profile.ts is a newer real canonical boundary absent from that frozen Git
tree; extend it, do not invent a historical file to restore. Reviewed client/
producer/catalog and reviewed runtime c76d315 are prerequisites. Source case
counts are inventories, not target passing evidence.

## Global constraints

- Work only in /Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher
  on codex/dispatcher-plan-completion. Preserve dirty primary/unrelated work. One
  source writer; root owns docs/knowledge/source503/Linear/ledgers.
- Read actual affected modules/scoped AGENTS and relevant architecture/knowledge.
  Reuse ConfigurationEngine/ConfigPlan/schema and current native profile factory,
  scoped DevinLocalAcpAdapter and nativePrivatePaths. No new registry/framework,
  provider SDK/dependency, compatibility alias or separate configuration lane.
- Atomic four-path unit only: schema.ts/new config test/native-profile.ts/existing
  factory test. No Controller service registry/routes/runtime wiring, public index
  or package export change, domain/protocol/persisted format change, remote/native/
  account/service activation. Providerdevin cloud/v3 remains distinct and unchanged.
- New providerdevin-local requires explicit nativeInteraction modecompatible,
  backenddevin-local-acp, executionLocationmanaged-worktree and embedded Runner.
  Missing/foreign/native cloud ownership or credentialRef fails. Disabled rows
  still need valid explicit structural configuration; filesystem/native work is
  not part of schema validation and reserved disabled rows create no Adapter.
- Exact settings keys only executable/dataHome/configHome, all explicit absolute
  nonempty strings<=4096 with no C0/DEL. No model/default/args/environment/approveTools/
  cloud/organizationId/createAsUserId/configDir/credential/remote settings silently
  dropped, inferred, migrated or resolved. No native credentials copied into config.
- Preserve same explicit settings through actual ConfigPlan apply/restart in
  isolated database, with separate devin v3 credential/settings roundtrip. Settings
  persisted/exported only through existing safe ConfigPlan/opaque secret references.
- Add actual NativeProfileRegistration backend union and exact factory branch.
  Do not add devin-local to generic NativeCliProvider/probe/default CLI routing.
  Use dedicated devinLocalBackendFactory?:(profile:CliAgentProfile)=>CliAgentBackend|
  undefined in NativeProfileFactoryOptions, matching current provider-specific
  codexBackendFactory seam. This actual distinct ACP runtime avoids widening
  Controller's existing generic CLI callback parameter or importing Controller.
- Enabled Local factory validates its structural settings/opt-in/credential owner
  before invoking backend factory, captures original profile/scope, requires exact
  returned backenddevin-local-acp and constructs existing scoped Adapter with its
  optional fourth catalog scope. Missing host fails DEVIN_ACP_RUNTIME_UNAVAILABLE,
  mismatched host BACKEND_MISMATCH, absent required opt-in NATIVE_INTERACTION_REQUIRED.
  No generic backend/default executable/home/model fallback or eager start/probe.
- Preserve disabled factory early return before factory/physical access. Reject
  foreign configured Devin backend before invoking any provider factory, and reject
  generic CLI factory's injected Devin backend on other providers. Preserve all
  current Codex/OpenCode/Pi/generic caller behavior and supported real boundaries.
- Native private paths include actual Local dataHome/configHome, including reserved
  disabled profiles, preserving existing other-provider paths/remote-owner filtering.
  No fallback personal XDG/home directory or process environment mutation.
- Actual new factory imports Adapter internally; it does not justify exporting
  every client/reader/manifest. Later Controller manifest/profile consumer is separate.
  Existing catalog65/helper46/client113/producer59/runtime accepted tests and fixtures
  stay unchanged. No real provider/account/GUI/writer/release qualification claim.
- Add regressions for every changed behavior. Preserve source17 exact purposes,
  inner invalid values and current old factory bodies/budgets; use actual physical
  fixture files/homes for scoped construction, no fake success/noop native owner.
  Count actual old cases via AST rather than guessing. Missing import/unimplemented
  stub is setup evidence only; capture meaningful loadable behavioral RED.
- Every verification command actual pre/post source/tests/config/lock/dist/buildinfo/
  ignoredlint/executed scripts outsidecheckout, UTC/argv/cwd/HEAD/status/output/exit/
  wall/digests, explicit runtime/node_modules exclusion/no hermetic claim. Preserve
  failures, no unchanged retry/worker/timeout/cache/assertion/lint weakening. Build
  before crosspackage focus and complete self-review before final freeze.
- Original group/EPERM/R020/CV13audit28/formal Gates/parentCV14 remain open. Expected
  full-suite rejection diagnostics retain MinorCV14; no production suppression.

## Task 1: Register explicit ConfigPlan settings and the scoped owning factory

**File map**

- packages/config/src/schema.ts: current TypeScript/backend JSON enum plus exact
  Local provider/embedded-runner/path/settings/credential validation. Share directly
  affected existing native validation path where it naturally fits; no unrelated
  validator refactor or broader acceptance of existing provider settings.
- New packages/config/test/devin-local-config.test.ts: frozen17, all inner invalid
  values and actual ConfigPlan restart/disabled/v3 separation; direct regressions
  for new own/backend/mode/setting boundaries not already covered.
- packages/adapters/src/native-profile.ts: distinct structural union/factory slot/
  owning Adapter branch and explicit native private homes. Preserve disabled early
  return, current generic provider enum and actual backend mismatch protections.
- packages/adapters/test/native-profile.test.ts: additive real-branch, zero-start/
  no-factory invalid ownership, explicit scope capture/unsupported settings/private
  paths/disabled and existing provider preservation tests; old bodies unchanged.

**Steps/acceptance**

- [ ] Read/map all17source cases/current factory and callers before edits. Retain
  exact source scalar values and explicit canonical substitutions only if needed.
- [ ] Write source tests and new factory regressions first. Capture loadable RED
  through current schema/factory's real missing behavior, not only import errors.
- [ ] Implement schema/factory together, using only explicit settings/new dedicated
  real slot; no native startup or standalone fallback. Preserve old provider paths.
- [ ] Self-review exact diff/named callers and source/body parity; build, changed
  filelint, then actual seven-suite focused command (existing six paths verified):
  `mise exec -- pnpm vitest run packages/config/test/devin-local-config.test.ts packages/adapters/test/native-profile.test.ts packages/adapters/test/devin-catalog.test.ts packages/config/test/config.test.ts packages/config/test/pi-native-interaction.test.ts packages/config/test/codex-native-interaction.test.ts packages/config/test/opencode-native-interaction.test.ts`.
- [ ] One unchanged final `mise exec -- pnpm check` after final source freeze;
  build/typecheck/lint/boundaries/tests all required. Preserve failures and report
  concrete conflict before widening scope; no policy/test weakening or blind retry.
- [ ] Commit four scoped files, audit actual final gate pre/post/Git bytes and
  source17/old factory preservation, write exact RED/GREEN/commands/evidence/noise/
  limitations report. No worker subagents/reviewer/docs/Linear/native/push/merge.
  Root dispatches sole independent task review and handles source503/metadata.

**Handoff:** Actual Controller runtime composition, physical enabled admission,
profile endpoint/manifest view, private repository protection, allRuntime raw/drain/
storage fences, sourceController30+pendingcataloglookup1 and cold readonly recovery
come next. Pure ConfigPlan/factory registration does not qualify an enabled personal
profile, native catalog account access, continuation/source or writer release.
