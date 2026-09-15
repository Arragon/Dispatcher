# Dependency Decisions and License Gate

Dependency versions are exact in workspace manifests and locked by
`pnpm-lock.yaml`. The M0–M2 implementation uses maintained, established
components only where the frozen architecture calls for them:

| Capability | Decision |
| --- | --- |
| HTTP and static serving | Fastify 5 and `@fastify/static`; avoids a custom server/router |
| Durable local state | Node's built-in `node:sqlite`; avoids a native add-on lifecycle |
| Dashboard | React, React Router, TanStack Query, and Vite |
| Schema-driven configuration | Ajv plus RJSF and its Ajv 8 validator |
| Structured logs | Pino behind the project redaction boundary |
| Tests and quality | Vitest, Testing Library, TypeScript, and ESLint |

`pnpm licenses list --json` was run against the resolved M0–M2 lockfile. The
reported license families were MIT, MIT-0, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, BlueOak-1.0.0, MPL-2.0, and CC0-1.0. No GPL/AGPL dependency was reported.
MPL-2.0 appears only in transitive Lightning CSS packages; no source was copied
or modified. RJSF packages are Apache-2.0. This is an engineering dependency
gate, not a legal opinion; re-run it whenever the lockfile changes.

No third-party source code was copied, forked, vendored, or derived into this
repository for M0–M2.
