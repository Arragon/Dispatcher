# Durable Project Know-how

## M0–M2 invariants

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
- The non-macOS encrypted store intentionally fails closed when its master key
  is absent, weak, wrong, or the file permissions are broader than 0600.
- Performance reports separate measured values from targets. Scenarios that
  require the M4 execution harness must be marked `not-runnable` before M4; do
  not synthesize agent-run measurements.

## Tooling details

- Required runtime: Node.js 24.12+ and pnpm 11.19.
- `pnpm typecheck` builds project references first. Calling an individual
  package typecheck from a clean tree may otherwise lack referenced declarations.
- Controller tests should pass a fake `SecretStore`; production construction on
  macOS intentionally selects Keychain.
- Build order is represented by workspace dependencies. Controller consumes the
  built Web directory at runtime but does not use a TypeScript project reference
  to Web because Web is a no-emit application project.

