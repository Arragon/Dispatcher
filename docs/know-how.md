# Durable Project Know-how

## M0–M10 invariants

- The frozen architecture/roadmap dated 2026-09-15 is authoritative over the
  tracker. Tracker differences are reconciled to the document, not vice versa.
- `domain` and `protocol` are pure contracts. Run `pnpm boundaries` after any
  dependency or import change involving either package.
- Embedded Mode changes transport, not protocol semantics. It uses the same
  envelope, message taxonomy, sequence checks, and error classification that a
  future remote Runner will use.
- `RESOURCE_BLOCKED` and `WAITING_RESOURCE` are recoverable states, not generic
  failures. Do not collapse them into `FAILED`.
- SQLite migration functions must remain replay-safe. Validate both a new
  database and an older fixture; a failed migration must leave the prior schema
  usable.
- Configuration revisions are optimistic concurrency tokens. UI, setup wizard,
  imports, and assistants must create a plan from a known base revision and
  surface revision conflicts instead of silently retrying with overwrite.
- Secret values never enter the canonical configuration document. Persist only
  opaque `secret://namespace/name` references. Secure UI inputs must remain
  outside RJSF form state.
- Local Dashboard password login uses the fixed `admin` username only over the
  loopback interface. Store the salted scrypt hash in SecretStore, not canonical
  config; changing it revokes browser sessions. One-time links and the owner
  token remain recovery and API paths.
- Enabled integrations must use their own namespace (`secret://linear/...`,
  `secret://github/...`, or `secret://slack/...`) and the referenced item must
  exist before a ConfigPlan can apply. Secret resolution additionally checks
  the caller principal and integration/provider/LLM purpose.
- Refuse SecretStore deletion while the current canonical configuration uses
  the reference. The user must first apply a disabling/removal ConfigPlan; this
  prevents a valid active configuration from being made unusable out of band.
- The non-macOS encrypted store intentionally fails closed when its master key
  is absent, weak, wrong, or the file permissions are broader than 0600.
- macOS `security ... -w` prompts twice and reads from a terminal. The Keychain
  backend supplies both prompts through a pseudo-terminal pipe so the value
  never appears in process arguments; changing that subprocess path requires a
  real Keychain smoke test, not only an injected executor test.
- RJSF must use an Ajv 2020 instance. Its default Ajv validator targets an older
  schema dialect and will render the form but reject submission of the shared
  Draft 2020-12 schema.
- Performance reports separate measured values from targets. Scenarios that
  require the execution harness must use a real harmless child process and Git
  worktree; do not synthesize agent-run measurements.
- Internal LLM endpoint credentials remain `secret://llm/...` references in
  canonical config. Resolve them only at the protocol invocation boundary;
  never include values in normalized requests, response objects, health state,
  logs, errors, audit records, or Web payloads.
- A manual LLM switch is probe-then-commit. Failure preserves the previous
  active profile. Automatic fallback follows the configured pool order;
  automatic failback requires repeated healthy probes instead of a single
  transient success.
- `DEGRADED_NO_LLM` degrades semantic features only. Health may report degraded,
  but Dashboard, ConfigPlan, SecretStore and deterministic Controller paths must
  stay available.
- Adapter discovery is an ID allowlist over manifest-declared probes. Do not add
  a raw command/path field to discovery requests. Probe free text is redacted
  and summarized before it enters trusted state.
- Generic CLI command templates have a fixed executable and argv array, run
  with `shell: false`, and allow placeholders only as complete argv values.
  Keep provider discovery on an allowlisted `--version`/health probe and never
  turn a user string into a shell command.
- Cursor and Kiro CLI credentials are `secret://` references resolved only at
  process start into provider-specific environment variables. Version/auth
  probes prove installation and login, not a business invocation.
- OpenCode desktop's bundled v2 CLI and a PATH v1 CLI can coexist. Prefer the
  known macOS app-bundled v2 path, or select an explicit executable; v1 lacks
  `--standalone` and is rejected by the native adapter capability probe.
- Bind both child `cwd` and `PWD` to the worktree. OpenCode v2 consulted the
  inherited PWD and wrote in Controller's directory despite the correct child
  cwd. Real file verification detected it; normalizing PWD fixed the invocation.
- Headless CLI errors can be JSON on stdout with exit code zero. Inspect native
  error records, retain resource evidence across later output, and distinguish
  unavailable model configuration from provider outages. OpenRouter HTTP 402
  and pi's missing API-key diagnostic are resource/auth failures.
- Native JSON exit zero needs execution evidence, not merely initialization or
  parseable informational records. Empty or invalid-only output must fail closed.
- Unix child `close` does not prove its process group exited. A tool descendant
  can ignore SIGTERM with detached stdio; retain SIGKILL escalation until the
  group has stopped. Awaited cancellation also fences profile replacement.
- ConfigPlan apply must preserve unchanged adapter instances for every provider: replacing
  them drops live process handles. Reject replacement/removal while startup,
  follow-up or cancellation is pending, and keep the typed runtime rejection
  after transaction rollback so operators know to finish or cancel first.
  Legacy SDK/HTTP starts need a Controller reservation before their first await,
  since no session row exists until the provider responds. Bind retention to the
  owning Runner mode/credential reference too; display labels and capacity are
  independent. A completed native turn does not release a verifying canonical Run.
- Grok's `--session-id` creates a new conversation; `--resume` continues one.
  A prompt starting with `-` requires the `--single=<prompt>` argv form. On
  Grok 1.0.46, `acceptEdits` and scoped Write/Edit allow rules did not approve
  the observed native `write` tool in headless mode. Explicit `approveTools`
  opts into `--always-approve`; default profiles preserve native policy.
- CLI print/JSON mode accepts follow-up turns after completion, not live
  permission responses. Never start two turns against one provider session.
  Native credential discovery must not call export/print-credential commands.
- Devin v3 has verified create/get/message session operations, waiting/resource
  normalization, and PR evidence. Do not claim remote cancel support until an
  official endpoint is verified; the adapter intentionally declares no cancel
  capability.
- An HTTP cancel response with no state or an unknown/running state is not a
  stop acknowledgement. Drain earlier input requests before issuing stop, fence
  later inputs immediately, and retain uncertainty when provider or disk writes
  fail. Local canonical cancellation must also abort and await verification,
  then drain the existing advancement before reporting CANCELLED.
- WorkBuddy/CodeBuddy local-service paths are configuration, not guessed vendor
  defaults. Every session endpoint must place `{sessionId}` in its own path
  segment so percent-encoding cannot escape the configured endpoint shape.
- Routing capabilities come from the selected AdapterManifest backend plus the
  Runner, never from provider-brand conditionals. Persist required capabilities
  on the Run so manual reroute is checked by the same hard gate.
- One Run owns one writable worktree. Canonicalize every candidate path against
  the real worktree root, then enforce declared scope paths; lexical prefix
  checks alone do not stop symlink escape.
- Worktree cleanup is planned before execution and fails closed on dirty,
  unknown, or out-of-root paths. Never force-remove uncommitted user work.
- Raw Agent output belongs in redacted, bounded rotating files. SQLite stores
  normalized metadata and summaries only. Slow observers must not create an
  unbounded in-memory queue.
- Verification commands are repository/project registrations, not request
  strings. Required failures block delivery; optional failures remain visible
  without being promoted to success.
- Connector definition IDs are namespaced by kind (`task.*`, `messaging.*`,
  `scm.*`). Capability versions describe behavior; configured instances carry
  credentials, health, and revisions. Do not merge the two concepts.
- External IDs and provider revisions live in `ExternalBinding`. Canonical
  entities keep stable local IDs; provider-only fields stay under
  `platformExtensions` and must not leak into scheduler/domain decisions.
- Canonical task mutation and projection enqueue are one transaction. A remote
  outage is represented by pending/retried/dead-letter outbox state, never by
  rolling back a committed canonical revision.
- Webhook signatures are computed over exact request bytes before JSON
  normalization. Apply size and time-window limits first, deduplicate on the
  provider event ID, and never persist the raw provider payload.
- Projection events include connector identity, canonical revision, and a
  stable idempotency key. Treat a matching origin/revision as echo, not as a new
  canonical edit.
- A TaskDraft with missing repository, scope, acceptance criteria, or
  verification becomes `NEEDS_SPEC`. Scheduling a partial contract is a policy
  bypass, not a fallback.
- Deterministic routing filters capability, capacity, runner tags, provider,
  and resource state before stable identity ordering. LLM output must never
  override these hard gates.
- Every task dispatch resolves a registered repository and creates a managed
  worktree. Manual Codex APIs reject paths that are not registered by the
  current WorkspaceManager.
- Delivery is fenced by the current run generation and lease and requires
  passed verification. Commit, PR, and CI records are durable evidence with
  idempotent external identities; retries must not create duplicate PRs.
- Remote Runner transport uses the mature `ws` package (MIT, pinned at 8.21.3)
  rather than a custom WebSocket implementation. Bearer credentials travel in
  the Authorization header, never in protocol payloads; a non-loopback listener
  must be attached to a TLS server. Runner journal entries are checksummed and
  replayed by sequence, while delivery authority is re-fenced before branch,
  push, pull-request, and completion mutations.
- A transport response cache is not native execution authority. The owning
  Runner persists Run reservations and operation receipts separately, before
  side effects. Lost process handles after restart remain OUTCOME_UNKNOWN;
  a stored PID must never be treated as an attached or resumable process.
  Native adapters must save STARTING after asynchronous credential preparation
  and before spawn, so the SessionStore can recheck the current lease at that
  final boundary. Verification children also need abort signals on revocation.
- Runner registration CLI and service share one ConfigPlan database. Acquire
  its atomic single-writer claim before reading execution recovery records;
  a second live process must fail without rewriting RUNNING as unknown.
  Local configuration commands run while the service is stopped. Controller
  authorization loss (WebSocket1008) ends reconnect attempts and cancels owned
  execution; ordinary connection loss stays bounded by the existing lease.
- A repository and selected account must resolve to the same owning Runner.
  Remote root syntax is validated without interpreting it on Controller;
  actual Git/root/scope checks run on that device. Comparing only a repository
  ID is insufficient: publication inspection must also match the owning root
  registration and frozen verification commands. Global Policy qualification
  excludes repositories on other Runners.
- `COMMAND_OUTCOME_UNKNOWN` is a startup authority outcome, not a known failed
  process. Scheduler preserves RUNNER_UNAVAILABLE and the publication keeps an
  OUTCOME_UNKNOWN receipt; neither may trigger another native start. Keep the
  Runner slot until canonical verification/result delivery is finalized, even
  when the native turn already reports COMPLETED. Use configured capacity as
  an admission ceiling over a device's reported capacity.
- Reconnect must flush old outgoing frames before answering new RPCs, and late
  replies from the former socket must still enter the current ordered stream.
  Merely replaying at the end of an asynchronous start leaves a sequence race.
  Native ownership reconciliation additionally binds the original start hash
  and session identity; stored PIDs alone are insufficient. Durable completed
  result evidence may survive Runner restart without claiming a live handle.
- Native PTY uses Microsoft `node-pty` (MIT, pinned at 1.1.0) for Unix PTY and
  Windows ConPTY. pnpm must explicitly allow its native build; some pnpm
  installations lose the executable bit on the packaged Unix `spawn-helper`,
  so Runner repairs that one known helper path before spawning. Platform code
  stays in `runner`; scheduler/domain see only capability strings.
- Run advancement is phase-idempotent. Persist `VERIFYING` before executing
  registered checks and `DELIVERING` before calling an SCM provider; retry from
  the stored phase after a temporary provider failure.
- Codex profiles isolate `CODEX_HOME`; Web/API surfaces expose alias and
  normalized status only. A CLI probe and a real business invocation are
  separate pieces of evidence.
- Codex quota and rate-limit signals become durable profile ResourceSnapshots.
  Block the Run/task and future routing on that profile; do not collapse a
  provider resource condition into task failure.
- Codex approval or input-required signals are `WAITING_USER`, not failures.
  Resume through the existing provider session ID, then restore Run/task active
  state before advancing the pipeline.
- A task-platform switch changes the primary connector binding, not execution
  identity. Dry-run unsupported fields first; preserve task ID, TaskContract,
  Run history, and delivery evidence throughout the switch.
- Fleet is a disposable projection over canonical records. Never repair an
  inconsistency by editing Fleet state; fix the canonical record and rebuild.
- Meaningful activity is deterministic. Heartbeat/observer noise must not clear
  a stall, while real activity clears suspect/stalled state on the next rebuild.
- Dashboard event history is bounded and coalesced by type/entity key. An
  expired reconnect cursor requires a reset snapshot. EventSource is the
  refresh path; do not add a hidden polling loop.
- Typed Intent v2 is the only semantic execution input. Resolve external IDs
  and aliases to canonical IDs first; ambiguous or missing resolution enters
  clarification and never silently chooses the first match.
- Semantic tools are allowlisted with bounded schemas and risk levels. Recheck
  role and confirmation at execution. Assistants may call ConfigPlan APIs, but
  may not write tables or execute arbitrary shell commands.
- Reject literal credentials before an LLM request. Assistant and Slack flows
  request secure input and pass only `secret://` references.
- Approval and clarification use durable optimistic-concurrency records. A
  stale workflow revision must not execute after restart or a newer decision.
- A Qoder first invocation owns an explicit provider session ID; every later
  send/resume uses that same ID. Controller and provider session IDs are
  distinct and must not be substituted.
- Qoder usage/credit parsing uses shared ResourceSnapshot states. A Qoder quota
  event blocks Qoder capacity only and must not make Codex globally unavailable.
- Scheduler candidates derive `providerId` from the configured profile. A
  hard-coded provider in Controller reintroduces single-provider coupling.
- Slack HMAC is computed over exact raw bytes and guarded by timestamp and
  replay checks before parsing. Never reserialize JSON for signature checking.
- Slack display names are presentation only. Authorization requires a durable,
  admin-approved PrincipalBinding; unknown and revoked principals fail closed.
- A Slack intervention thread binds to one task/run/session generation. Replies
  and buttons recheck binding revision and generation before resuming the
  original provider session; stale controls are conflicts.
- Remote notifications are attention-only and idempotent. Deduplicate per
  task/state/generation with cooldown and do not stream routine activity.
- Persist only normalized Slack Inbox records. Redact credential-shaped text
  before persistence, and route the user to a short-lived signed Dashboard
  link; never echo or audit the submitted literal.
- Slack approval buttons identify a semantic workflow plus its expected
  revision. Recheck the durable principal, roles, and revision before execute;
  stale or cross-principal buttons fail closed.

## Tooling details

- Delivery evidence insertion is intentionally idempotent (`INSERT OR IGNORE`).
  Use `updateDeliveryEvidence` with its current revision for CI/PR changes;
  calling the insert method again silently retains the old evidence. No schema
  migration is needed: the existing evidence JSON carries its revision.
- Workspace package imports resolve built `dist` files. Rebuild changed
  packages before Controller integration tests, or a passing source-unit test
  can coexist with an integration test exercising old code.
- A Linear binding's external ID is the issue UUID. Its human identifier
  (`INH-xxx`) is stored in the normalized task platform extension and must be
  included separately in semantic aliases.
- `doneOnCiPassed` defaults to false. Configuring it true makes CI success a
  terminal acceptance decision; later CI regression produces comments and
  Slack feedback. The canonical domain does not automatically reopen DONE;
  an operator must decide how to track any follow-up work.
- Run advancement may await verification or GitHub while heartbeats renew its
  lease. Recheck the stored state/generation before saving and preserve the
  latest expiry; saving the original snapshot shortens the durable lease.
- Waiting episodes need distinct canonical command IDs. A Run-only command
  key deduplicates the second WAITING_USER transition after resume. Consumed
  Slack answers need durable receipts independently of notification delivery;
  retrying the old inbox message must not answer a later question.
- Reserve Run/task dispatch before adapter startup, then use the latest task
  revision when finalizing. A harmless concurrent comment otherwise leaves a
  live Run outside its canonical task lifecycle.
- Remote runner shutdown waits for in-flight command results to reach the
  journal. A reply belongs to its originating socket and must not be sent
  through a replacement connection.

- Required runtime: Node.js 24.12+ and pnpm 11.19.
- `pnpm typecheck` builds project references first. Calling an individual
  package typecheck from a clean tree may otherwise lack referenced declarations.
- Controller tests should pass a fake `SecretStore`; production construction on
  macOS intentionally selects Keychain.
- Build order is represented by workspace dependencies. Controller consumes the
  built Web directory at runtime but does not use a TypeScript project reference
  to Web because Web is a no-emit application project.

- This Mac's Qoder installation is Qoder CN. Use the actual `qoderclicn`
  bootstrap binary, not an IDE launcher, and isolate accounts with its native
  `--config-dir`. Desktop login did not authenticate the newly installed CLI.
- The Cursor installer also overwrites `~/.local/bin/agent`. Preserve an
  existing Grok `agent` alias by installing only the `cursor-agent` entry.
- WorkBuddy bundles a Node CLI at `app.asar.unpacked/cli/bin/codebuddy`.
  Its auth failure was a structured `result.is_error` with process exit zero;
  desktop installation/login does not prove bundled CLI readiness.
  The desktop package lacks `dist/codebuddy.js` and the native Web UI, so its
  interactive `/login` entry is unavailable. A complete same-version official
  CodeBuddy CLI can provide the native login UI, but WorkBuddy and CodeBuddy
  declare different authentication IDs even under `~/.codebuddy`. Verify both
  initial and resumed runs before assuming credentials work across entries; keep its installation separate and preserve the bundled headless
  entry rather than editing app files or copying account credentials.
  CLI 2.147.0's macOS auth storage is separate from settings: it uses
  `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth`, so
  `CODEBUDDY_CONFIG_DIR` does not isolate accounts. A native
  `AtRestEncryption category=missing-key` read warning followed by refresh
  HTTP 401 is a credential-read/refresh gate, not evidence that a Dispatcher
  resume parser failed. Do not recover by copying credentials or extracting
  desktop encryption keys.
- pi can reuse the active OpenCode OpenRouter credential without storing a
  second raw key: its native `models.json` accepts an `apiKey: "!command"`
  resolver. Use OpenCode's official `auth export openrouter`, select only the
  active key credential in a private helper, and pipe its output directly to
  pi. Never print the export or resolver output. Model defaults remain native
  pi settings; Dispatcher selects the explicit `provider/model` per profile.
- ZCode's bundled CLI needs both `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` and
  `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` to reuse its native runtime config.
  Setting only the bundled-provider fallback variable did not fix packaging
  lookup. Use a wrapper and existing native paths; do not modify app binaries
  or copy credentials. Explicit `--mode edit` avoids its headless `yolo`
  default. Model selection stays in the native client, not an unsupported CLI
  `--model` flag. Runtime provider paths can change after a desktop upgrade.
  Provider credentials do not imply a headless model selection: a missing
  personal `defaultModelSelection` caused `Model creation failed`, whose nested
  CLI log error was `CONFIGURATION_ERROR: Select a model before continuing`.
  Persist selection inside `provider_config.json.config`, not its root.
  Selection also requires a usable native account/model registry; the same
  error can remain after saving a valid catalog model. The standalone CLI's
  credential resolver requires its native coding-plan account identity entry
  as well as an account key. Desktop OAuth presence alone is insufficient;
  use native CLI authorization to establish those entries, not credential copy.
  The desktop-bundled 0.16.9 CLI also lacked `@zcode/tui`; do not recommend its
  interactive `/model` menu without verifying that package is present.
- Shared session persistence must validate profile ownership before status,
  input, usage or cancellation. Codex and structured native adapters enforce
  this in their session lookup; Controller session routes reject mismatches
  before calling any provider. A disabled account must not be continued through
  another enabled account with a different native credential directory.
- Antigravity CLI 1.2.14 can return `status: SUCCESS` with non-empty
  `denied_actions` after declining native file creation in `accept-edits` mode.
  Reject that envelope as a failed turn; model text or exit zero does not prove
  the requested tool action ran. Do not enable dispatch from a text-only probe.
  Its `approveTools` profile setting is an explicit opt-in for
  `--dangerously-skip-permissions` on both initial and resumed calls. Keep it
  false by default; native tool approval does not impose a worktree sandbox.
- `pnpm dispatcher` runs in `apps/controller`, so its default relative data
  directory differs from invoking the built CLI directly at repository root.
  Pass an explicit `--data-dir` when restarting an existing instance; otherwise
  it opens a separate empty configuration, rather than losing saved profiles.

- Console grouping must use a coherent full Fleet snapshot, never a first-page
  task/run sample. Keep `currentRunId` even if the Run is missing so a historical
  attempt cannot silently become current. Completing or failing a task does not
  archive it; archive is explicit local metadata with a reversible restore.
- Capture selected model at dispatch and reset model/token evidence on reroute.
  A configured model is not runtime confirmation. Codex `turn.completed.usage`
  reports the latest turn; cached input is a subset of input, not an extra token
  charge. Account quota, token count, and currency are separate measurements.
- Sectioned settings must merge into the complete draft, keep hidden sections,
  avoid injecting RJSF defaults into untouched data, and invalidate a ConfigPlan
  after any edit. Keep dirty drafts across query refreshes; apply the reviewed
  plan ID and preserve the server's revision/confirmation checks.

- A Web decision answer belongs to the displayed waiting episode. Do not fetch
  newer revisions and silently attach an old answer to them. Reset the input on
  episode changes and fence current task/run/lease before and after adapter send.

- Serve the HTML entry with no-cache; only hashed assets may be immutable.
  Missing asset paths must return 404 rather than the SPA HTML fallback.
  After rebuilding production assets, restart the static-file registration.

- The v3 HTML is a visual reference, not runtime capability evidence. Keep its
  sample tasks, model catalogs, authentication claims, prices, and quota values
  out of production. A local draft review is not a server publication preview
  or receipt. Missing publication/catalog APIs must leave submission unavailable.
- Before building a configuration plan from an edited form, re-read the applied
  revision and reject a changed base while preserving the draft. This client
  check alone is not atomic: console plans must also send baseRevision, which
  Controller compares immediately before building the plan. ConfigPlan's apply
  revision fence remains required, including for legacy callers without a base.
  Device/repository/policy editors share
  the complete-draft settings path and must not discard hidden fields.
- `/api/system-impact` currently returns a placeholder local-process count and
  non-windowed LLM counters. Do not display these as measured process counts or
  hourly usage. Diagnostics exports must exclude config, free text, paths and
  credentials rather than serializing raw API responses.

- Publication preview and commit hashes bind raw instructions, applied config,
  repository base commit and native selection. A successful receipt replay must
  bypass preview expiry while a changed payload on the same key conflicts.
  Reserve receipt/task/contract/intent atomically; native I/O stays outside SQLite
  transactions. Preserve taskId after startup failure or uncertainty.
- Automatic routing normalizes text only for keyword matching. Approval binds
  the untouched draft; original evidence spans must remain valid through NFKC
  expansion, emoji and collapsed whitespace. A winning invalid project rule
  blocks execution rather than allowing a lower/global/default model to win.
  Keep the decision immutable and store confirmation in the publication/Run
  snapshot. Refresh catalogs at commit/start, but never rerun classification as
  part of approval or receipt replay. Native-default reasoning means omission,
  even when the catalog advertises a default such as medium.
- Semantic analysis caching and native catalog freshness have different lifetimes:
  cache validated analysis by actor/draft/raw text/type/prompt/role configuration,
  while refreshing native execution evidence at every approval/start boundary.
  A role's successful-call preference is mutable and cannot identify the model
  used by another concurrent call; use the response's per-attempt provenance.
  A new analysis for unchanged input must supersede its prior publication review
  so two outstanding reviews cannot independently create two tasks.
- Reusing a publication review for an existing Task must bind both canonical
  revision and contract content, including the gap before adapter startup. Keep
  browser receipt identities separate per Task. Reconstruct task text on the
  server and use the contract's frozen commit when inspecting its workspace;
  the current source branch may have advanced since create-only publication.
- Native rule qualification belongs before ConfigPlan creation/apply, outside its
  synchronous SQLite transaction. Bind fresh evidence and revision, and keep
  successful plan replay independent of later native availability. Read ConfigPlan
  lifecycle state from the canonical stored row, not its original embedded plan
  document, which captured PLANNED at creation.
- Remote RPC identity binds raw payload plus lease ID/generation, independently
  of property order and renewable expiry. Never overwrite a successful command
  receipt with a changed-payload conflict. Responses carry the command hash in
  envelope idempotencyKey so an unacknowledged conflict replay cannot settle a
  later valid retry. After full journal compaction, the next outgoing sequence
  must remain above the acknowledged sequence.
- A source-checkout scope check is insufficient when executing another commit.
  Recheck physical scope roots in the created worktree before native queries or
  execution. Workspace-bound contracts cannot accept another repository through
  a dispatch override; current configured scope may only narrow execution.
- Freeze verification descriptions and repository identity per Run. Removing a
  repository registration must not replace or erase the commands and physical
  origin used by an already approved execution. Restore only worktrees whose
  managed path, Git common directory, branch and base ancestry still agree.
- Preserve create-only execution intent for fresh validation at later dispatch.
  A per-run model/effort override belongs to its adapter session and must survive
  continuation independently of current profile defaults. Revalidate native
  account/project context before continuing a managed session.
- Codex model/list is a native candidate catalog, not an entitlement or price
  source. Keep access unconfirmed and require acknowledgment for explicit
  selection. Known missing authentication blocks native defaults too. A
  completed native turn supplies recent availability evidence, without implying
  a remaining quota value. Exit zero alone is insufficient: require native
  thread identity and a completed JSON turn.
- A persisted RUNNING adapter session with no attached process cannot establish
  liveness after Controller restart. Mark affected publication execution unknown
  and retain the worktree for inspection; do not automatically resume or reroute.

- Native `models` exit zero does not prove fresh or authenticated results. Grok
  returned expired OAuth diagnostics and its old model list with exit zero;
  inspect both streams and block native-default as well as explicit selection.
- Cursor status can render different progress/spinner lines for the same login.
  Fence the qualified `Logged in as` identity marker, together with native
  account/configuration hashes; do not compare whole terminal progress output.
  Unknown or contradictory login markers remain unqualified.
- Plain CLI model IDs may already encode effort, fast mode, tiers or routing.
  Preserve the native selector exactly; never derive supported parameter ranges
  from its suffix or from a CLI-wide effort flag. OpenCode variant overlays and
  inventory costs likewise do not establish per-model effort or account prices.
- OpenCode 2.0.26 `models --standalone` can exit zero with empty output while an
  owned private service exposes enabled text candidates through `/api/model`.
  Qualify the native response/account metadata schema, bind the physical project,
  query twice for a stable snapshot, and close the owned process before returning.
- A successful native turn with no quota number is recent availability evidence,
  not a numeric balance. Preserve explicit resource/auth failures over completion.
  Verification commands execute independently through Controller's registry;
  an agent refusing its own Bash tool does not invalidate a passed Controller check.
- Controller tests import compiled workspace adapter exports. After adapter edits,
  rebuild before running targeted Controller tests; a direct targeted rerun can
  otherwise exercise stale `dist` code. The full `pnpm check` builds first.

- React Query structural sharing can preserve data identity after an explicit
  refetch. Discard/reload must copy the returned applied data and revision into
  the draft directly; toggling a dirty ref does not rerun a data-keyed effect.
- Internal model role reset must fence pending invoke, switch and failback
  selection writes. A completed pre-reset call remains valid output, but cannot
  repin the old profile after the user restored pool order.
- Publication receipt recovery must retain the original reviewed draft identity.
  Do not label an old dispatch commit from the currently edited create-only draft;
  late preview reads must not interrupt newer editing. Legacy receipts without
  a bound review snapshot remain readable but require a fresh review to commit.
- Scroll wrappers containing absolutely positioned screen-reader text need a
  positioning context: clipped hidden table headings can otherwise expand the
  document on narrow viewports even while the table itself scrolls correctly.

- Remote reconnect must match the native start hash and current lease/session/
  workspace before adopting ownership. Do not update lastActivityAt just for
  reattachment: it participates in native-input retry identity. Bound inventory
  application to identities present before the query, and coalesce a later
  heartbeat so a slow empty snapshot cannot hide a newly started Run.
- Remote cancellation cannot depend on a received native session ID: a dropped
  start acknowledgement leaves only the reserved lease. Persist revocation,
  require owning-Runner stop acknowledgement, and keep uncertainty visible.
  Shutdown revokes all leases synchronously before awaiting the first adapter.

- A SIGKILL request is not a stop acknowledgement. Shared owned-group cleanup
  waits for absence after escalation; native status/result stays running until
  cleanup completes, even on a nominally successful parent exit. Verification
  revocation awaits its serialized command cleanup before returning a stop ACK.
  An in-memory cancelled-session fence survives cancellation-record write failure.

- Never submit a redacted console config as a full replacement. Omitted private
  values are preserved by applying revision-bound leaf edits to the real server
  document. Bind array edits to entity IDs as well as their same-revision index;
  normalization sorts configured entity arrays after validation.

- Native profile enabled omission means true. RJSF's generic checkbox displays
  undefined as false; wrap its existing checkbox for that field's presentation,
  without adding a default to form data. Otherwise a harmless edit can appear to
  disable an account or manufacture an untouched configuration change.

- Preserve only reviewed configuration plan IDs in browser recovery state;
  re-read canonical plan lifecycle and the applied revision before restoring
  actions. An applied plan with later configuration changes is historical,
  not an available rollback target. Ordinary account edits preserve stable IDs;
  removal/creation stays explicit so historical ownership is not silently renamed.

- Account installation, native flag compatibility and login are independent
  evidence. Cursor's login-success/unable-to-fetch-details output is not a
  qualified identity. Qoder CN version/help/status probes must all use the
  applied configDir and both cwd/PWD of the registered repository. Persist only
  normalized evidence with its original check time; refreshes must not promote
  old or unknown authentication to success.

- A persisted active session without an owned child is not a stopped process.
  Native cancellation must refuse to report CANCELLED from stored PID/state
  alone. Revoke canonical authority, retain unknown outcome, and never kill a
  recorded PID. Fence STARTING writes after async preparation, then retain
  post-spawn cleanup for changes that happen after that final check.

- Resource reads must not await an unfinished native turn. Preserve a stable
  per-turn observation ID across status updates; a changed updatedAt timestamp
  is not a new usage event. Keep old snapshots for historical queries, but use
  only the latest snapshot plus later deltas when calculating the same scope.
- Generic credential redaction matches the tokens and tokenScope field names.
  Remote usage needs an allowlisted numeric token projection and validated
  scope enum; never relax generic secret redaction or return arbitrary vendor
  usage objects to preserve those metrics.

- A resource collection time is not automatically a new native observation.
  Preserve cached event/session timestamps through local and remote reads;
  explicit probe results may establish a new time. Retain the recovery path
  where a newer verified probe supersedes an earlier quota/error signal.
- Diagnostic GET/export paths only project facts. Registered checks declare
  provider-query cost and cannot accept executable strings or a client-supplied
  cost. Connector health binds applied configuration, expires after five minutes,
  and rejects results whose configuration changed while awaiting the provider.
  Legacy unbound health records require another check rather than a green state.
- Input uncertainty belongs to a waiting episode, not just a client nonce.
  A new nonce, actor or task-description revision must not authorize resending
  an unconfirmed native reply. Store its original authority/message hashes and
  replay confirmed receipts before checking the now-advanced task revision.
