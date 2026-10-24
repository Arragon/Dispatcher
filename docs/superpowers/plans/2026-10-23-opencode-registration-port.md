# Explicit OpenCode Server Registration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, or the already authorized superpowers:subagent-driven-development workflow, to implement each reviewed task. The root preparation was read-only; execution follows the already authorized continuous parent goal. R1 and R2 now form one atomic registration task after the verified preflight ruling below.

**Goal:** Admit only explicitly reviewed `opencode-server-v2` profiles through ConfigPlan and the existing native adapter factory, while retaining standalone OpenCode behavior.

**Architecture:** Extend the existing narrow provider/backend registration union. Schema validation is structural and does not inspect native resources. Factory guards require the matching owning runtime without probing or starting it; Controller composition is a separate dependent plan.

**Tech Stack:** TypeScript, Ajv 2020, Vitest, existing ConfigurationEngine and native-profile factory. No new dependencies or third-party implementation.

**Spec:** `/tmp/dispatcher-opencode-config-catalog-composition-20261023.md`, section 4. Dependent composition: `docs/superpowers/plans/2026-10-23-opencode-controller-port.md`.

## Global constraints

- Only `mode: "compatible"`, `backendId: "opencode-server-v2"`, `executionLocation: "managed-worktree"`; owner provider is `opencode` and configured Runner must be embedded.
- No global enablement, GUI surface, cloud fallback, generic provider, native default execution, continuation, new home/account-directory/environment contract or credential reference.
- ConfigPlan remains the sole configuration mutation boundary; adding/removing/changing native registration is sensitive and confirmed under current engine policy.
- Supported server settings are exactly `executable`, optional `model`, optional `approveTools: false`. Absent approval is passed to execution as false through the existing adapter contract.
- Standalone OpenCode and other providers retain their current setting contracts. Do not narrow all CLI settings globally.
- Synthetic nativeStoreRef is unqualified. Native private-path exclusion for the effective XDG OpenCode data directory remains in `nativePrivatePaths`; it is not account/store ownership evidence.
- No tests, probes, native/provider/account operations or repository changes occurred during this plan preparation.

## Execution and evidence contract

Each numbered task is one sequential SDD implementation/review unit. One implementation agent at a time. Implementer writes focused RED/GREEN, self-reviews, runs one final default `mise exec -- pnpm check` on that task payload with exact command/exit/duration/log/source SHA256/result manifests, commits only owned paths and writes assigned report; root then dispatches combined independent specification/quality review. No worker-created reviewer/subagents. Earlier failed evidence remains separate; no unchanged-code retries, timeout/worker/assertion weakening or probe caches. Root compares committed payload to final manifest. Root owns convergence evidence/disposition/Linear and parent CV14 broad branch review/integration; local task reviews never complete CV09 or actual native Gates. If later steps mention parent combined gate, this contract still requires the current shared-contract/service task's own final default gate.

## Review focus

1. Adding the third backend must not fall through the current `pi ? pi : codex` branch; provider and required paths must be selected explicitly.
2. A disabled invalid registration must still fail structural schema validation, while a structurally valid disabled registration must not resolve a factory or inspect a file.
3. An injected OpenCode server backend cannot activate on an omitted nativeInteraction or another provider; configured mismatch rejects before invoking that provider factory.
4. A valid server profile with model omitted must round-trip without inserting a profile default; exact frozen per-Run selection is still required later.
5. Existing native-profile test fixtures deliberately exercise broad standalone inputs; preserve them rather than changing them to fit strict server settings.

## Verified source and file structure

Read at worktree `/Users/wangdongxin/.codex/worktrees/dispatcher-plan-completion/dispatcher`; reviewed catalog `0208bffab9805d7321acf6958246ee39d7620baa` and runtime `761dddd53c2d8aee4e4103d47ce0771661ce5849` are final dependencies. Root coordinated metadata follows those commits; record the actual clean dispatch BASE separately. No active WIP is authority.

| File | Responsibility / action |
| --- | --- |
| `packages/config/src/schema.ts:39,306-308,447-466` | Extend TypeScript/schema backend union and targeted cross-field validation. |
| `packages/config/test/opencode-native-interaction.test.ts` (new) | Real server structural/ConfigPlan test groups, following current Codex/Pi tests. |
| `packages/adapters/src/native-profile.ts:13,54-78` | Extend structural union and guard new server construction through `cliBackendFactory`. |
| `packages/adapters/test/native-profile.test.ts` | Add OpenCode factory/disabled/no-start/private-path regressions; preserve seven existing groups. |
| `packages/config/src/engine.ts:59-77` | Read-only reference: agentProfiles diff already makes the plan sensitive. No anticipated change. |
| `docs/architecture.md:39-57` | Update the precise boundary only after registration review; Controller remains separate. |
| `docs/know-how.md:967-975` | Preserve invocation and durable runtime constraints; add only a new durable server-specific rule if not enforced clearly by tests. |

## Task 1: Atomic structural registration and owning factory admission

**Preflight ruling (2026-10-23):** R1 and R2 share one implementation/review/commit. Expanding only AgentProfileConfig breaks assignability at six current Controller/Runner callers of NativeProfileRegistration; adding its literal alone still lets configured server profiles select standalone when no factory exists. Therefore both narrow unions, structural validation and the already specified factory guards land together. This adds no Controller wiring or new contract. Source-only audit: `/tmp/dispatcher-opencode-registration-preflight-20261023.md`; no test failure was claimed from that audit.

Root owns architecture, know-how, convergence records and Linear after review. Implementer owns exactly schema.ts, new config test, native-profile.ts and its test, plus this plan receipt. No adapters-to-config import, cast, dropped field, temporary fallback or shared framework is permitted.

### Phase R1: Structural registration plus ConfigPlan acceptance

**Interfaces**

- Consumes current `AgentProfileConfig`, `DispatcherConfig`, `validateConfig(input: unknown): DispatcherConfig`, `ConfigurationEngine.buildPlan/applyPlan/current`.
- Produces `AgentProfileConfig.nativeInteraction.backendId` union `"pi-rpc" | "codex-app-server" | "opencode-server-v2"`. No new public configuration field or engine API.
- Server settings: required string executable is absolute on the current validation host, length 1..4096, without C0/DEL. Optional model is an exact provider/model selector, bounded to the current canonical selection/catalog composite-selector limit (240), with nonempty provider and model, no C0/DEL or `#`, provider has no `/`; model may contain `/`. The producer also invokes freezeExecutionSelection, whose requestedModel text bound is240; its earlier512 identifier precheck is not the effective public selector limit. Existing standalone settings are unaffected.

- [ ] Re-read current schema, Codex/Pi native config tests and config engine after catalog/runtime commits. Confirm nested rules and no other owner is editing schema/native-profile.
- [ ] Create `opencode-native-interaction.test.ts` with these named groups and concrete assertions:
  - `round-trips explicit server configuration without probing`: a nonexistent absolute `/native/bin/opencode` validates, omitted model/approval remain omitted, input stays unchanged.
  - `preserves omitted native interaction as standalone`: executable `opencode` with existing standalone settings is still structurally valid.
  - `rejects unsupported interaction fields`: parameterize mode native-session/native-gui/control, backend standalone/arbitrary, locations cloud/self-hosted, surface desktop/tui, enabled true and top-level nativeInteraction enablement. All reject; none create a ConfigPlan.
  - `rejects a server backend on a foreign provider or remote Runner`: codex/pi/cursor/generic and remote owning Runner; include valid runner secret reference so failure is about native ownership.
  - `requires only the explicit absolute executable path`: missing/empty/relative, C0, DEL, over4096 and nonstring reject. No codexHome/agentDirectory/sessionDirectory is required or accepted for this variant.
  - `accepts omitted model or a safe exact model`: `provider/model`, `provider/vendor/model`, safe ordinary-space and CJK native IDs pass; empty/bare model/empty provider/empty suffix/#variant/C0/DEL/nonstring/over240 reject. Ordinary whitespace is not an argv boundary for this typed server selector; preserve canonical/native safe-text behavior instead of copying Pi regex restrictions.
  - `keeps tool approval unqualified`: omitted/false pass and remain unchanged; true/string/number/null reject.
  - `rejects unsupported server settings`: configDir, opencodeHome, dataHome, sessionDirectory, environment, trustWorkspace, unknown key reject. Test each separately to identify the cause.
  - `keeps OpenCode native login outside credential storage`: credentialRef rejects with current native-login semantics.
  - `retains disabled structural registration without activation`: valid disabled server profile validates; invalid executable shape or forbidden settings reject even when disabled.
  - `reviews activation and removal through sensitive ConfigPlan`: before is standalone; unconfirmed apply rejects `CONFIG_CONFIRMATION_REQUIRED` with current config/revision unchanged; confirmed apply preserves exact registration. Removing/changing it produces concrete agentProfiles diff and requires confirmation.
- [ ] Run only this new file and record the expected missing-union/validation failures before code changes. Do not treat a test failing for a malformed fixture as a useful red test.
- [ ] Extend both union/schema enum entries and replace the binary backend/provider/path branch with explicit handling for the three existing allowed variants. Keep Codex/Pi validation and error meanings intact; add server-only allowlist/model/approveTools checks. No host filesystem/process access in schema or ConfigPlan validation.
- [ ] Run `mise exec -- pnpm vitest run packages/config/test/opencode-native-interaction.test.ts packages/config/test/codex-native-interaction.test.ts packages/config/test/pi-native-interaction.test.ts packages/config/test/config.test.ts`.
- [ ] Review the R1 diff before continuing R2 in this same task; no intermediate R1 commit or activation. Passing means all listed structural/ConfigPlan groups pass without native reads; no change to engine risk policy is needed.

### Phase R2: Owning factory guards without server activation

**Shares Task 1 with R1:** both structural contracts and factory guards must be present before this task is reviewable. Consumes reviewed adapter producer/manifest and canonical catalog identity; does not depend on Controller runtime wiring. Do not create an intermediate activation-capable schema commit without guards.

**Interfaces**

- Preserve `createNativeProfileAdapter(profile: NativeProfileRegistration, options?: NativeProfileFactoryOptions): AgentAdapter | undefined`.
- Preserve `cliBackendFactory(provider, profile): CliAgentBackend | undefined`; server identity is returned backend's exact `backendId`. No additional generic factory framework.
- Extend only NativeProfileRegistration's backend union. The configured server must receive an existing owning factory result; this task creates no runtime itself.

- [ ] Add OpenCode analogues beside the four Codex guard tests in native-profile.test.ts:
  - Configured server and absent factory/undefined result reject `OPENCODE_RUNTIME_UNAVAILABLE` (choose this narrow new own code; do not reuse catalog errors), with no native backend.start.
  - Profile configured for server with provider codex/pi/cursor/unsupported rejects `BACKEND_MISMATCH` before any codex/CLI factory callback. A valid OpenCode profile configured for pi-rpc/codex-app-server also rejects before callback.
  - Valid configured OpenCode whose factory returns standalone/foreign backend rejects `BACKEND_MISMATCH` before start.
  - Omitted nativeInteraction plus injected OpenCode server result rejects `NATIVE_INTERACTION_REQUIRED`; foreign CLI provider receiving server backend must reject `BACKEND_MISMATCH`. The factory may be consulted to know its returned backend, but its start must never run.
  - Valid matching server selects server manifest, supports executionRef/ExecutionSelection, and leaves registration/model unchanged; no eager start, catalog, version, filesystem or authentication query.
  - Disabled profile returns undefined before any factory call, including a nonexistent physical absolute executable. Structural validation remains R1's responsibility.
  - Omitted interaction preserves default standalone manifest and existing broad CLI factory behavior. Preserve all current Codex/Pi/other CLI tests.
  - Effective XDG OpenCode directory remains in nativePrivatePaths. Assert process env fixture restoration; do not create/read real native data.
- [ ] Run the focused file and confirm failures occur at the intended missing server guards.
- [ ] Add a narrow pre-factory check for configured server ownership, then matching result/unconfigured-injected checks at the existing CLI factory boundary. Preserve disabled early return and existing Codex guards. Do not restore obsolete Controller-specific OpenCodeAdapter construction.
- [ ] Run `mise exec -- pnpm vitest run packages/adapters/test/native-profile.test.ts packages/adapters/test/native-cli.test.ts packages/adapters/test/cli-catalog.test.ts packages/config/test/opencode-native-interaction.test.ts` (plus the reviewed new canonical catalog file if one was created).
- [ ] Self-review the combined four-path payload and source-group mapping, then run the one final default `mise exec -- pnpm check` required by this task execution contract. It includes typecheck/build, lint, boundaries and tests; record exact logs/source/result manifests. Do not duplicate these broad checks beforehand without a concrete independent need.
- [ ] Commit only the combined four code/test paths and own plan receipt after verification; write the assigned SDD report for root independent spec/quality review. Root updates the explicit registration architecture boundary afterward. Do not claim Controller activation or any real provider qualification from these tests.

## Historical source test disposition

`a499d84` does **not** contain `packages/config/test/opencode-native-interaction.test.ts`. Its `packages/config/test/native-interaction-config.test.ts` has four real test groups, all for a now-obsolete generic/global native feature:

| Historical group | Canonical disposition / test owner |
| --- | --- |
| Omitted config remains compatible; disabled profile never enabled | R1 omitted/disabled groups; R2 disabled factory remains uncalled. No global switch is restored. |
| Confirmed arbitrary backend + GUI policy; rejects cloud fallback | R1 confirmed exact server activation preserves the review invariant; arbitrary backend, GUI and cloud shapes are deliberately rejected by narrow current contract. Historical privileged global switch is replaced by existing sensitive agentProfiles plan. |
| GUI requires surface; disabled feature preserves HUMAN lock | GUI/global enablement are invalid in R1. Current HUMAN mutation protection lives in `apps/controller/test/interaction-guard.test.ts:26`, and is preserved by Controller plan verification; no config-time GUI path is reintroduced. |
| Removing optional global feature appears in plan diff | R1 removal of per-profile nativeInteraction appears in concrete agentProfiles diff and requires sensitive confirmation. Current engine does not expose old top-level global native field. |

Current applicable config tests are **real** Codex/Pi native-interaction groups plus config.test.ts schema/ConfigPlan rollback and failure groups; do not describe the historical generic file as existing current OpenCode coverage.

## Handoff and unresolved dependency seam

- This combined registration/factory task is a standalone reviewable change: default production behavior is unchanged and enabled server activation without the exact owning factory fails closed until composition ships. This statement does not apply to a schema-only intermediate payload.
- Enabled-runtime construction/admission is the sole physical executable authority: qualify an existing regular executable with `access(X_OK)` without running it, and pin its realpath/dev/ino/metadata across async admission/source checks. That belongs to the reviewed runtime task, not this structural schema/factory task. Do not add a second filesystem validator in registration or service. `nativeProfileEpoch` currently omits realpath/dev/regular-file requirements and marks missing files unavailable, so it is insufficient alone. Composition tests exercise enabled missing/directory/non-executable/replaced files indirectly through the actual runtime constructor/admission seam; disabled registrations perform no factory/file work.
- The reviewed runtime must export the concrete factory and lifecycle contract documented in the Controller plan before that plan is implemented. No active catalog WIP or inferred runtime API is an accepted dependency.

Root preflight amendment records the atomic task boundary; the original R1/R2 requirement groups and historical source dispositions are retained above. Confirm current BASE and re-read all four implementation paths after runtime review before dispatch; historical line numbers are navigation hints, not authority.
