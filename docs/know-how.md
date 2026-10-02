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
- ConfigPlan apply must preserve unchanged native adapter instances: replacing
  them drops live process handles. Reject replacement/removal while startup,
  follow-up or cancellation is pending, and keep the typed runtime rejection
  after transaction rollback so operators know to finish or cancel first.
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
- `pnpm dispatcher` runs in `apps/controller`, so its default relative data
  directory differs from invoking the built CLI directly at repository root.
  Pass an explicit `--data-dir` when restarting an existing instance; otherwise
  it opens a separate empty configuration, rather than losing saved profiles.
