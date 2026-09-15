# Agent Dispatcher repository guide

Architecture and boundaries: `docs/architecture.md`  
Durable project knowledge: `docs/know-how.md`

## Commands

- Build: `pnpm build`
- Test: `pnpm test`
- Targeted test: `pnpm vitest run <test-file>`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Full gate: `pnpm check`
- Benchmark harness: `pnpm benchmark -- --scenario smoke --duration 5`

The frozen design and roadmap remain in
`agent-dispatcher-architecture-roadmap-v2026-09-15.md`. Keep `domain` and
`protocol` free from Web, persistence, transport, and provider SDK imports.
Configuration changes must go through `ConfigPlan`; secrets use opaque
`secret://` references and must never be returned by APIs or exports.
