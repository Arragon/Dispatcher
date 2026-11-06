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

The retained pre-update audit exited 1 with 28 graph advisories (6 low,
17 moderate, 5 high) for @vitest/mocker, brace-expansion, fast-uri, fastify,
source-map-js, undici and vite. SDK/Zod had no entry in that result. Original
raw audit and artifact evidence remain under
/tmp/dispatcher-devin-acp-client-evidence-20261024.

## CV13 project runtime and dependency security increment

Project mise, CI and the supported Node minimum are 24.22.1. The actual installed
Node executable reports builtin Undici 7.30.1 and OpenSSL 3.5.9. pnpm remains
11.19.0; its compiled executable reports a separate bundled Node 26.0.0 runtime,
whose internal dependencies are not qualified by the project Node update.

Exact direct patches are Fastify 5.12.6, Vite 8.3.3 and Vitest 5.0.3. Vitest's
mocker/spy family is 5.0.3. Existing compatible parent ranges resolve fast-uri
3.1.9 and 4.2.3 and brace-expansion 5.0.12. Three exact-parent overrides resolve
source-map-js 1.2.2 under css-tree 3.2.1 and postcss 8.5.28, and Undici 8.12.2
under jsdom 30.0.1; all satisfy their existing parent ranges. Vite's updated resolution uses the
Rolldown 1.2.15/platform binding and oxc types 0.155.0 family; Vitest requires
why-is-node-running 3.2.1, removing its old siginfo/stackback dependencies.
Other package versions and the esbuild/node-pty build allowlist are retained.

The ordinary frozen install and resolved audit both exited 0; the audit reports
324 dependencies and zero advisories in every severity. Resolved license families
remain the nine listed above. Changed packages use MIT or BSD-3-Clause. Official
registry tarballs match their SRI; host-selected changed package bytes, including
packaged license/NOTICE files, match those archives. Other platform binding
artifacts were checked as archives only. Unchanged esbuild's approved installer
replaces bin/esbuild with its platform binary; that installed binary matches the
owning native package rather than the tarball's wrapper script. Existing license
obligations, including the SDK/Zod attribution above, remain in force.

Raw registry, archive, installed graph/runtime, license, audit, lifecycle and
isolated production attribution evidence is retained under
/tmp/dispatcher-project-security-task1-evidence-20261026. The task report records
the unchanged full gate and packaging results separately. These facts establish
this scoped security increment, not exploit reachability, pnpm-binary security,
real-account/provider acceptance or the remaining CV13/CV14 and formal Gates.
