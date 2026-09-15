# Agent Dispatcher

Agent Dispatcher is a lightweight control plane for running and observing
multiple coding agents across one or more computers. Linear owns tasks,
GitHub owns delivery evidence, Slack is the remote control, and the Web
Dashboard is the configuration and fleet console.

This repository currently implements the M0–M2 foundation: typed domain and
Runner contracts, a Controller with an Embedded Runner, SQLite persistence,
a static Dashboard, transactional canonical configuration, and opaque secret
storage.

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

See `docs/architecture.md` for boundaries and `docs/operations.md` for CLI,
configuration, launchd, and benchmark instructions.
