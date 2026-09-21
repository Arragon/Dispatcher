# Agent Dispatcher

Agent Dispatcher is a lightweight control plane for running and observing
multiple coding agents across one or more computers. Linear owns tasks,
GitHub owns delivery evidence, Slack is the remote control, and the Web
Dashboard is the configuration and fleet console.

The repository implements the M0–M6 MVP foundation: typed Controller/Runner
contracts, durable canonical tasks, transactional configuration and secret
references, isolated Codex profiles, Linear task ingestion and projection,
deterministic scheduling into managed Git worktrees, and idempotent GitHub
delivery evidence.

## Local development

Requirements: Node.js 24.12 or newer and pnpm 11.19.

```bash
pnpm install
pnpm check
pnpm build
pnpm dispatcher -- serve --with-runner
```

Open `http://127.0.0.1:8347`. Runtime data defaults to `.dispatcher/` and can
be moved with `DISPATCHER_DATA_DIR`.

To exercise the M6 path, configure through Settings:

1. A registered local repository (`id`, absolute root, base ref, scope paths,
   and fixed verification commands keyed by stable IDs).
2. A Linear connector with `secret://linear/...` token and webhook-secret
   references plus the registered repository ID.
3. A GitHub connector with a `secret://github/...` reference.
4. A Codex profile with an alias and isolated `CODEX_HOME`.

Linear webhook delivery creates or updates a canonical task. Complete issue
scope, acceptance criteria, and verification make it `READY`; dispatch then
creates a managed worktree and starts the selected Codex profile. Connector
outages remain visible as retry/dead-letter state instead of losing task state.
Advancing the Run observes Codex completion, executes only the registered
verification IDs, and records fenced commit, pull-request, and CI evidence.

See `docs/architecture.md` for boundaries and `docs/operations.md` for CLI,
configuration, launchd, and benchmark instructions.
