# Durable Project Know-how

## M0–M4 invariants

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
  with `shell: false`, and permit only whole-argument placeholders. LLM or task
  text is data, never a shell fragment.
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

## Tooling details

- Required runtime: Node.js 24.12+ and pnpm 11.19.
- `pnpm typecheck` builds project references first. Calling an individual
  package typecheck from a clean tree may otherwise lack referenced declarations.
- Controller tests should pass a fake `SecretStore`; production construction on
  macOS intentionally selects Keychain.
- Build order is represented by workspace dependencies. Controller consumes the
  built Web directory at runtime but does not use a TypeScript project reference
  to Web because Web is a no-emit application project.
