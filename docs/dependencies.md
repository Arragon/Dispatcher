# Dependency Decisions and License Gate

Dependency versions are exact in workspace manifests and locked by
`pnpm-lock.yaml`. The M0–M6 implementation uses maintained, established
components only where the frozen architecture calls for them:

| Capability | Decision |
| --- | --- |
| HTTP and static serving | Fastify 5 and `@fastify/static`; avoids a custom server/router |
| Durable local state | Node's built-in `node:sqlite`; avoids a native add-on lifecycle |
| Dashboard | React, React Router, TanStack Query, and Vite |
| Schema-driven configuration | Ajv plus RJSF and its Ajv 8 validator |
| Structured logs | Pino behind the project redaction boundary |
| Tests and quality | Vitest, Testing Library, TypeScript, and ESLint |

`pnpm licenses list --json` was run against the resolved lockfile. The
reported license families were MIT, MIT-0, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, BlueOak-1.0.0, MPL-2.0, and CC0-1.0. No GPL/AGPL dependency was reported.
MPL-2.0 appears only in transitive Lightning CSS packages; no source was copied
or modified. RJSF packages are Apache-2.0. This is an engineering dependency
gate, not a legal opinion; re-run it whenever the lockfile changes.

No third-party source code was copied, forked, vendored, or derived into this
repository for M0–M6. M5–M6 use built-in Node crypto, fetch, child-process,
and SQLite APIs plus existing workspace packages; no new production third-party
dependency was added.

M14 adds no dependency. Cursor, Kiro, and Generic CLI execution use Node's
`child_process` with `shell: false`; Devin and configured local services use
Node's built-in fetch. Provider SDKs are intentionally not linked into Core,
and no vendor source was copied or vendored.

## Internal ACP client dependency increment

The internal Devin Local ACP client pins
[@agentclientprotocol/sdk1.8.0](https://registry.npmjs.org/@agentclientprotocol%2fsdk/1.8.0)
(Apache-2.0) and explicit [Zod4.6.7](https://registry.npmjs.org/zod/4.6.7) (MIT)
in Adapter only. SDK's Zod peer accepts this version; neither new package has
runtime dependencies or install hooks. Existing workspace and resolved versions
are retained. The official SDK supplies client/ndJsonStream; no upstream source
was copied, modified or vendored, and Core/Domain/Protocol remain SDK-free.

Exact registry tarballs match their SRI and packaged license bytes. The actual
isolated production-deploy manifests/LICENSE texts match those tarballs, with
copyright attribution retained and no SDK NOTICE present. SDK licenseSHA256 is
6ed4f049cce59e05197d585bdf8a39980b45d546d6ea718ee344555f3a867c3a;
Zod is3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8.
Resolved licenses were rechecked. Artifact facts and exact source/staged/deployed
locks are retained at
/tmp/dispatcher-devin-acp-client-evidence-20261024/license-artifact/facts.json.
Existing node-pty lifecycle scripts ran in that isolated deployment; their actual
script bytes/hashes are retained. No Controller/service smoke or host activation
belongs to this attribution check.

Current resolved audit exits1 with28 unrelated graph advisories (6low,17moderate,
5high) for @vitest/mocker, brace-expansion, fast-uri, fastify, source-map-js,
undici and vite. SDK/Zod have no entry in that result; this is not a clean
workspace-security claim. Raw audit and primary-source checks are retained under
/tmp/dispatcher-devin-acp-client-evidence-20261024; CV13 owns the remaining audit
work. No suppression or unrelated upgrade was used. The native CLI/account and
project-wide release license/qualification remain separate obligations.
