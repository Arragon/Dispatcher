# Publication backend verification — 2026-10-15

## Preview and creation

`c08356c` adds durable preview/create/read receipts. Stage 1 targeted verification: 6 files / 45 tests passed. Preview only reads registered Git state and stores the review; it does not create a worktree or task. Creation reserves receipt, task, contract and publication in one SQLite transaction. Tests cover duplicate/parallel keys, restart replay, rollback, expiry, configuration/base drift, unsafe references/scopes and incomplete tasks.

## Local execution

Stage 2 full gate: `pnpm check`, 44 files / 320 tests passed. The existing dispatch path owns managed worktrees and native startup. Contracts, command descriptions and selection are frozen per Run; publication state participates in startup reservation. Interrupted starts remain unknown rather than relaunching. Local results retain bounded changed paths and the worktree, without remote delivery evidence or automatic acceptance.

Real native evidence (separate from injected backends): Codex CLI `0.162.0-alpha.17.2`, native configuration selection, isolated repository/data directory. Publication `5813750e-04cf-4fec-b96d-71472b3670c8`, Task `13d81f94-a452-48f8-849d-bfb84bbc9341`, Run `cc0eff3f-bf35-4ca3-89f9-58543c5a774d`. The native process created `result.txt` with the exact requested bytes; registered verification passed, Run COMPLETE, Task REVIEW. No SCM connector, commit, push or PR was used. Evidence retained at `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-publication-KXdMD2/evidence.json`.

The first native probe exposed a missing Run provider-session update and stderr warnings overriding successful summaries; regression tests and fixes were added. A later explicit-model probe must verify those fixes against the native client. Native process exit zero alone now fails without a completed JSON turn and provider session identity.

## Supported boundary

Publication currently supports manual local Codex execution with `delivery=none`. Local project IDs are server-derived `local:<repositoryId>`; tasks without a repository use `local:inbox`. Policy routing, remote publication execution, commit/PR publication and other providers fail explicitly. Existing integration ingress/PR delivery remain available through their existing paths. This does not claim arbitrary-path sandboxing by an agent or end-user acceptance of generated code.

## Native model catalogs and independent review

Codex `account/read` and paginated `model/list` are queried through a bounded,
read-only RPC client. Every native query process is reaped before return. The
installed CLI generated protocol schemas in `/tmp/dispatcher-codex-protocol`;
`ModelListParams`, `GetAccountParams` and `GetAccountResponse` match the used
methods. Seven native models and model-specific reasoning effort values were
observed. All entries remain unconfirmed access with unknown billing; no API
price or account entitlement was fabricated. Official references:
[app-server protocol](https://learn.chatgpt.com/docs/app-server) and
[native catalog versus entitlement](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

Real explicit selection: `gpt-6-luna`, reasoning `low`; publication
`9a6cc6fe-fa0e-4dd8-9936-ec25cc06ef23`, Task
`a7c92f1e-3b23-4874-adbd-5fe2ab390c69`, Run
`c2fa4699-598e-48b0-8196-43e6bb7a9008`, native session
`01a141f1-bd19-74d3-b077-94b3e1866b4c`. Exact file bytes and registered
verification passed; Run COMPLETE and Task REVIEW. Retained evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-explicit-sLUieO/evidence.json`.

Browser verification used the real isolated Controller at `http://localhost:4176`:
account/repository native catalog, supported effort choices, unconfirmed access,
unknown pricing, preview/confirm/create, then reload/read of the same canonical
Task `ff57b0c3-2912-4b2f-b3d2-237988d6141c`. Browser console reported no errors.
Screenshots are saved as `native-model-catalog.jpg` and
`publication-receipt.jpg` in the current Codex visualizations directory.

A fresh-context independent reviewer identified five issues. Regression tests
were observed failing before fixes: repository override/current scope changes,
create-only model-intent loss, detached ACTIVE restart, source/base-worktree
symlink differences and definitive authentication failure on native defaults.
All were corrected. Additional tests cover native RPC process cleanup, strict
uncoerced DTO inputs, concurrent per-session frozen selection, late account
responses and verification after repository registration removal. Controlled
reroute of publication Runs requires a fresh review and is explicitly refused
by the legacy reroute command; automatic physical-session reattachment is not
claimed.

## Final gate and recovery guard

Final `pnpm check`: **46 files / 333 tests passed**, including build, typecheck,
lint and architectural boundaries. `git diff --check` passed. Logs:
`/tmp/dispatcher-final-check.log`.

After the independent-review fixes, another real `gpt-6-luna / low` publication
completed from preflight to retained local REVIEW: publication
`467f4155-00d1-4851-bc55-b2aceb10e2d1`, Task
`675aae5a-7d40-45a5-adbe-e9013a3a64a1`, Run
`e101ed2b-dc9c-46e5-8a6d-ad226e7969a0`, provider session
`01a141f9-b3f6-7063-9027-fbb923fa8455`. Exact file verification passed. Evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-native-explicit-XuYEHm/evidence.json`.

Stable browser draft IDs plus atomic `publication-draft` bindings coalesce
identical previews across tabs. An uncertain commit persists its original key
and prevents a replacement preview until the original receipt or a durable
rejection is read. A confirmed created task may be followed by an explicit new
draft. Final-build browser reload and Controller restart still recovered Task
`ff57b0c3-2912-4b2f-b3d2-237988d6141c`; actual execution details display the
requested model separately from runtime model confirmation. Final screenshots:
`publication-receipt-final.jpg` and `native-execution-final.jpg`.

Official quota at completed checkpoints: 94% after preview/create, 93% after
local execution. A later safety check showed 89% remaining; no reset was used.
The final checkpoint quota is reported in the completion response.


## Additional native Harness catalogs and per-run selection

The adapter capability now qualifies Cursor, Qoder CN, Grok, Antigravity and
OpenCode alongside Codex. Explicit selection is saved on the adapter session
and reused by `send`/`resume`; native-default omits the model argument instead
of substituting Dispatcher profile defaults. Unsupported per-model parameters
are rejected. Catalog display preserves native IDs, including native Auto and
IDs that encode effort; no static model lists, invented effort ranges, account
prices or entitlement claims were added.

Native commands use bounded owned subprocesses with cwd and PWD set to the
selected project. CLI account/configuration state is checked before and after
querying. OpenCode 2.0.26 uses a fresh private service, verifies its PID and
physical location, reads stable enabled text candidates and native default,
and reaps the service before returning. Account/credential identity metadata
is read from native SQLite in read-only mode; token/value columns are excluded.
Its version/schema gate rejects unqualified versions. Antigravity has no
non-interactive account identity command; macOS keyring metadata supplies a
conservative change fence that can invalidate a review after an unrelated
keyring update. Hosts without a usable native account fence offer native default
only. Runtime-reported model identity is still unknown when the native event
stream does not confirm it; requested model identity is not treated as proof.

### Real native executions

All successful rows used a disposable Git repository, real native credentials,
an isolated Controller DB/ConfigPlan, managed worktree, and an exact-byte
Controller verification command. The required artifact is `result.txt` containing
`dispatcher-publication-ok` plus one newline. Each successful Run reached
COMPLETE, Task REVIEW, local delivery only. No commit/push/PR was requested.

| Harness | Requested native selector | Result | Run |
| --- | --- | --- | --- |
| Qoder CN | `Qwen3.8-Flash` | Exact file verification passed | `4018ee03-f0c8-498e-93c5-bba83d9320b1` |
| Antigravity | `gemini-3.8-flash-low` | Exact file verification passed | `37fa2b43-9681-42d1-be88-27a09ed4bf37` |
| OpenCode 2.0.26 | `openrouter/openai/gpt-4o-mini` | Exact file verification passed | `ab9f9359-9c4b-4664-983c-9044c921d120` |
| Cursor | `gpt-5.4-nano-low` | Native startup reached; upstream TLS connection failed, RESOURCE_BLOCKED | `3dfb175f-3a2f-464c-a738-38f26391fc9c` |
| Cursor | `composer-2.5` | Still ACTIVE after 180 seconds; owned QA process group 54649 terminated | `01c41ded-58ba-45be-9123-65346a84f3a8` |
| Grok | Native default and `grok-4.6` | Both real previews blocked with NATIVE_AUTH_REQUIRED | No execution |

Evidence files (retained outside source repositories):

- Qoder CN: `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-harness-qoder-cn-urMLnH/evidence.json`
- Antigravity: `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-harness-antigravity-WfW8E4/evidence.json`
- OpenCode: `/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-harness-opencode-9BACaG/evidence.json`
- Grok: `/tmp/dispatcher-grok-auth-evidence.json`

Qoder CN refused its own Bash permission prompt; the Controller independently
executed its registered verification command successfully. The agent's text
summary is not the verification authority. After adding stricter account-query
fences, a repeated Antigravity catalog query was blocked by upstream
`loadCodeAssist` EOF. Its earlier execution is proven; stable later availability
and the strengthened fence's real execution path are not yet requalified.
Cursor's timed-out fixture preserves an ACTIVE snapshot taken before physical
cleanup; it is not a successful result and must not be blindly redispatched.

### Other Harness boundaries

- Grok's `models` exited zero while reporting expired OAuth and retaining its
  prior model list. This is a definitive auth failure, not a fresh account catalog.
  Reauthentication through the native application is required.
- Pi startup fails MODULE_NOT_FOUND for its installed CLI entry point.
- WorkBuddy's wrapper reports version 2.161.0, but normal startup/help fails
  because its app-unpacked `../dist/codebuddy` module is missing.
- ZCode's installed CLI does not expose the existing adapter's headless/session
  flags or a qualified per-invocation model catalog; it remains unsupported here.
- Kiro and Qoder international executables were not found in PATH/declared local
  locations. Their catalogs and real native execution remain unqualified.
- Devin's configured adapter is the cloud v3 API. The separately installed local
  Devin CLI is not substituted for that backend. Generic/custom HTTP adapters do
  not inherit native model capabilities from unrelated CLI flags.

No native login, package installation or user account configuration was changed
to turn these external blockers into passing results. Production Dispatcher
configuration and credentials were not copied into the QA databases.

### Regression and browser evidence

Latest full gate `pnpm check --maxWorkers=4`: **47 files / 352 tests passed**,
including build, typecheck, lint, boundaries and tests. Log: `/tmp/dispatcher-harness-check.log`. Tests cover CLI
parsing, stale/auth fallbacks, duplicate IDs, before/after account switching,
per-session frozen selection, native-default argument omission, unsupported
parameters, owned OpenCode host cleanup/version rejection, non-Codex publication
and both-mode auth blocking. Browser displayed Qoder CN's 14 native choices,
selected `Qwen3.8-Flash`, and omitted the effort selector without native metadata.
Screenshots: `qoder-native-catalog.png`, `qoder-native-result.png` in the current
Codex visualization directory. QA browser: `http://localhost:4177`.

Official readable quota checkpoints: 87% after shared/CLI stages, 86% after
OpenCode verification, 85% after the full regression/fence stage. Some quota reads
were unavailable and were retried; no reset was used. The final checkpoint is
reported separately in the completion response.

Native references: [Qoder CLI model semantics](https://docs.qoder.com/cli/model),
[Grok CLI reference](https://docs.x.ai/build/cli/reference),
[Antigravity authentication](https://antigravity.google/docs/install?tab=cli).
Installed CLI output and the recorded real executions determine local support;
documentation examples do not populate catalogs.

A final Qoder CN rerun after the account before/after fence passed: Run
`8df6ecb7-238c-48c9-8979-e018103bc6b0`, Task
`42764fd3-f881-4d43-afa2-ce9aab51f346`, provider session
`1755561c-01aa-4bb1-9785-1f637e4864f8`. Evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-harness-qoder-cn-BLimDR/evidence.json`.

One additional full run exposed an invalid ordering assumption in the new
concurrency test (native executable resolution may complete in either order),
plus existing three-second fake-CLI probe timeouts under 47 concurrent workers.
The new assertion now checks model selection by its prompt/session, independently
of startup order. Existing probe deadlines/expectations are unchanged; the full
gate is repeated with Vitest worker concurrency limited to four.

A later OpenCode catalog correctly refused a context change. A fresh read and
publication retry passed: Run `33860287-4389-4946-8f0e-2997a9396d3d`, Task
`7e525092-ba56-4235-bd38-262c01e0d411`, native session
`ses_ebde96148ffeQnNX2TpXBXE9oP`, exact-byte verification PASSED. Evidence:
`/private/var/folders/_t/c66q7css0195p3yktsz3h3jc0000gn/T/dispatcher-harness-opencode-BfXkX5/evidence.json`.

The fresh-context independent review found one schema qualification gap:
missing native OpenCode tables/columns were downgraded to ordinary query failure,
which allowed native-default. A real empty SQLite fixture reproduced
`canCommit=true` before the fix. Incompatible schema reads now throw
NATIVE_VERSION_UNSUPPORTED; Controller marks selection unsupported and blocks
the default preview/commit without creating a task or native execution.
No other material findings were reported in the reviewed selection/freezing and
account-change paths. The final full gate was rerun after this correction.
