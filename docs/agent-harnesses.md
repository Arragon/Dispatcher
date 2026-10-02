# Local agent harnesses

Dispatcher profiles use the same TaskContract, managed worktree, Run lease,
verification and delivery flow. Select an adapter in **Agents & Profiles**,
scan it, save an alias through ConfigPlan, then select that alias for dispatch.
Installation and login readiness are separate evidence.

## Current personal configuration (2026-10-02)

Local dashboard: <http://127.0.0.1:8347/agents>. Profiles were saved through
Controller ConfigPlan. This running instance uses the existing data directory
`/Users/wangdongxin/projects/dispatcher/apps/controller/.dispatcher`. Start it
with an explicit directory to avoid creating another empty instance:

```sh
cd /Users/wangdongxin/projects/dispatcher
pnpm dispatcher -- serve --with-runner --data-dir /Users/wangdongxin/projects/dispatcher/apps/controller/.dispatcher
```

Stop with Ctrl-C in its service terminal. Disabled profiles stay visible and are excluded from
routing; use **Enable dispatch** after native login and health/model testing.

| Alias | Native entry / account | Current evidence |
| --- | --- | --- |
| `ronna` | Codex 0.159.0-alpha.12.1, existing `~/.codex` | Logged in; real managed-worktree file creation and exact-session edit passed |
| `kite` | Same Codex binary, separate `~/.codex-kite` | Reserved, disabled, no credentials copied; login deferred by user |
| `cursor` | Cursor Agent 2026.10.01-e373342 | User completed CLI login; real file creation and exact-session edit passed; `trustWorkspace: true`, blanket `approveTools` remains false |
| `antigravity` | `~/.local/bin/agy` 1.2.14 | Official SHA512-verified CLI installed; native OAuth requested; disabled pending login |
| `zcode` | ZCode bundled CLI 0.16.9 via local wrapper | JSON/session flags and runtime verified; no CLI default model selected; bundled TUI missing; disabled pending native model setup |
| `workbuddy` | WorkBuddy bundled CodeBuddy CLI 2.147.0 via local wrapper | Native JSON/session flags verified; actual model invocation requires `/login`; disabled |
| `qoder` | Qoder CN `qoderclicn` 1.1.65, native `~/.qoder-cn` | Official CLI installed; model listing requires login; disabled |
| `opencode` | OpenCode app-bundled v2, `openrouter/openai/gpt-4o-mini` | Current real file creation and exact-session edit passed; explicit native tool approval |
| `pi` | pi 0.99.2 via pinned Node wrapper | Protocol verified; no selected OpenAI credentials; disabled pending native login/model choice |
| `grok` | Existing `~/.grok/bin/grok` | Current real file creation and exact-session edit passed; existing `agent` alias preserved |

Wrappers under `~/.local/bin` pin a compatible Node runtime for the app-bundled
JavaScript entries. They reference native configurations rather than copying
credentials. ZCode's current builtin provider path includes the desktop version
and endpoint identity; re-check it after a desktop update.

### Native login actions still needed

Use the same native clients as Dispatcher. No password or API key needs to be
pasted into a chat. These are operator commands for this Mac:

```sh
# Optional later, per the user's explicit reservation:
CODEX_HOME="$HOME/.codex-kite" /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex login --device-auth

# Qoder CN opens its own login flow:
"$HOME/.local/bin/qoderclicn" login

# Antigravity starts its native Google sign-in flow when unauthenticated:
"$HOME/.local/bin/agy"

# WorkBuddy bundled CLI: enter /login in its interactive client:
"$HOME/.local/bin/workbuddy-cli"

# pi: select the desired provider/model and authenticate through /login:
"$HOME/.local/bin/pi"

# ZCode: the bundled CLI's Z.AI login can save a native default model:
"$HOME/.local/bin/zcode" login
```

After each native login, use **Test health**, then **Enable dispatch**. Generic
native discovery proves the executable/protocol and intentionally reports auth
as unknown until model execution. Do not mistake a desktop login for CLI login.
ZCode's CLI log resolves `Model creation failed` to `CONFIGURATION_ERROR:
Select a model before continuing`; the shared personal provider config has no
`defaultModelSelection`. Existing provider credentials alone do not select a
headless model. The bundled interactive entry also fails because `@zcode/tui`
is absent. Do not use that TUI as a recovery instruction. Its native Z.AI login
can save a default model; using an existing OpenRouter model instead still needs
a verified native configuration path and the user's model choice. No native
credentials or provider configuration were modified during diagnosis.

Current regression coverage also checks cross-profile session rejection,
reserved account exclusion, ConfigPlan activation, unchanged Codex/Cursor/native
handle retention, and rejection of active profile replacement/disable.

## Earlier installation inventory (2026-10-01)

| Harness | Observed installation | Dispatcher interface / evidence |
| --- | --- | --- |
| Codex | ChatGPT-bundled CLI | Existing Codex adapter |
| OpenCode | Desktop 2.0.21; PATH CLI 1.18.34 | New v2 JSON CLI adapter; real same-session file create/edit passed with explicit tool approval; v1 rejected |
| Grok Build | CLI 1.0.46 in `~/.grok/bin/grok` | New JSON CLI adapter; real same-session file creation/edit smoke passed with explicit tool approval |
| pi | CLI 0.99.2 installed under WorkBuddy's Node runtime | New JSON CLI adapter; default model credentials missing on this Mac |
| Devin | Desktop 3.10.48; CLI 3000.11.3 | Existing cloud v3 API adapter; installed local CLI advertises ACP, requiring a separate local transport implementation |
| Cursor | Desktop 3.22.12 | Existing adapter requires Cursor Agent CLI; desktop presence alone does not satisfy it |
| Kiro | Desktop 1.2.4; `kiro` launcher | Existing adapter requires `kiro-cli`; the IDE launcher is a different executable |
| Qoder CN | Desktop 0.4.3 | Existing Qoder CLI adapter; CLI was absent from PATH |
| WorkBuddy | Desktop 5.6.2 | Existing explicitly configured local-service adapter; no vendor HTTP endpoints inferred from installation |
| Antigravity, Zed, ZCode, Grok Bot, Hermes | Desktop applications installed | No task execution API inferred from GUI availability; inspect their published automation contracts before adding adapters |

No harness was installed or upgraded for this change. No SDK dependency or
third-party source was incorporated. The wrappers invoke locally installed
binaries using their documented command contracts.

## New profile settings

| Provider ID | Executable selection | Model / login | Follow-up |
| --- | --- | --- | --- |
| `opencode` | On macOS prefer `/Applications/OpenCode.app/Contents/Resources/opencode-cli`; explicit path overrides this; otherwise PATH | Native `opencode auth login`; optional `provider/model` | `run --standalone --session <exact-id> --format json` |
| `grok` | Prefer `~/.grok/bin/grok`, otherwise PATH; explicit path overrides | Native `grok login`, or `secret://grok/<name>`; optional model ID | `--resume <exact-id> --output-format streaming-messages-json` |
| `pi` | PATH or an explicit executable | Native `pi` login; optional `provider/model`; `auth check --json --no-refresh` tests selected model readiness | `--session <exact-id> --print --mode json` |

On this Mac pi's executable is
`~/.workbuddy/binaries/node/versions/22.22.2-3/bin/pi`. Specify its full absolute
path if the Controller's launch environment does not include that directory.
Pinning an executable also avoids unintentionally switching between installed
versions when PATH changes.

OpenCode and pi profiles use native provider accounts and do not accept
`credentialRef`. Grok's optional reference belongs to the `grok` namespace and
is resolved into `XAI_API_KEY` only when starting the child. Login probes never
export credentials or return account IDs.

OpenCode/Grok profiles default `approveTools` to false. This retains native
permission policy; headless calls requiring an unanswered permission may end
without making the requested change. For a trusted unattended development
worktree, explicitly select **Unattended native tool approval** before saving.
Grok then receives `--always-approve`, approving all native tools. OpenCode
receives `--auto`, which retains explicitly denied native permissions. These
options expand tool authority and are profile configuration choices, not a
Dispatcher sandbox. pi retains its own native tool policy. Never assume that a
managed worktree is itself a filesystem sandbox.

All three support start/status/result, cancellation, and a subsequent turn in
the same conversation. A concurrent send is rejected as `SESSION_BUSY`.
Pause and live native permission dialogs are unsupported. Already recorded
provider IDs can continue a completed conversation; an active process cannot
be reattached after Controller shutdown. A restored RUNNING snapshot without
its handle is failed explicitly. Session handles are currently in process
memory; use the existing operator recovery path after interrupted execution.
Applying unrelated configuration or adding another profile preserves the three
native adapters' live handles. A ConfigPlan changing or removing an active
native profile is rejected as `ACTIVE_AGENT_PROFILE`; finish or cancel its
operations first, then create a new plan. Pending startup, follow-up credential
resolution and cancellation cleanup also count as active operations.

## Personal task loop

1. Scan the selected adapter. `installed=true` and `compatible=true` establish
   the executable/JSON/session contract. OpenCode and Grok authentication remains
   `unknown`; pi can report local credential readiness for an explicit model.
2. Authenticate in the harness's native client, choose a usable model, and save
   a uniquely named profile. ConfigPlan records profile changes; secrets stay
   outside its ordinary form. Enable native tool approval only when intended.
3. Use a READY canonical task with repository, scope, acceptance criteria and
   registered verification commands. In an authorized Slack thread issue
   `task dispatch INH-xxx <profile-alias>` and confirm Dispatcher approval.
4. Controller creates the managed worktree and selects the declared provider.
   The ordinary worker advances execution, verification and delivery. A model
   response saying "done" must still pass registered verification.
5. Quota/rate/auth failures become `RESOURCE_BLOCKED` / `WAITING_RESOURCE` for
   that profile. Repair native login, billing or model configuration and use
   explicit recovery/resume. Background advancement does not automatically
   resume `RESOURCE_BLOCKED`. PR/CI feedback retains the MVP's existing flow.

## Verification evidence

Deterministic adapter tests cover native JSON/session IDs, leading-dash prompt
argv, nested errors, zero-exit failures, resource retention, output bounds,
missing executables, busy sends, cancellation during credential resolution and
SIGKILL escalation, including descendants surviving the direct child's exit.
Empty, malformed or initialization-only native streams fail without valid
execution evidence, even on exit zero. Controller tests cover all three provider profiles,
ConfigPlan/discovery/test routes, managed-worktree enforcement, canonical
routing, live-handle preservation, active profile replacement rejection and
per-profile resource blocking. UI tests distinguish installation
from authentication.

Real local invocations used disposable directories and literal marker files:

- Grok 1.0.46 completed file creation, then changed the file using the exact
  same provider session ID, with content verification after each turn and
  explicit `approveTools: true`. A separate default-policy text-only first
  turn and continuation also completed.
- OpenCode v2's default model produced an OpenRouter credit error. With
  `openrouter/openai/gpt-4o-mini` and explicit `approveTools: true`, both file
  creation and exact-session edit passed content verification. The child must
  receive its worktree as both `cwd` and `PWD`; inheriting Controller's PWD
  caused this CLI to write in the Controller directory during the first smoke.
- pi 0.99.2's default invocation lacked model credentials. Installation/native
  protocol is verified; a successful model/business run requires native login.

CLI cancellation is tested against real local child processes. These tests do
not establish provider session reattachment after restart or remote Windows
process-tree cancellation.

## Primary references and next integration

- [OpenCode v2 CLI commands](https://opencode.ai/v2/docs/cli/commands/)
- [Grok headless scripting](https://docs.x.ai/build/cli/headless-scripting)
- [Grok detailed headless protocol](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)
- [pi CLI integration](https://pi.dev/docs/latest/cli-integration)
- [pi session format](https://pi.dev/docs/latest/session-format)

The installed Devin CLI's `devin acp --help` is the next concrete local
integration entry. Keep it distinct from `provider=devin`, which currently
means the cloud organization API. Implement stdio ACP initialization,
session/new/load, prompt/update/permission handling and cancel against its
verified capability negotiation, then test authentication and actual managed
worktree execution. Do not register a GUI launcher as a headless backend.
