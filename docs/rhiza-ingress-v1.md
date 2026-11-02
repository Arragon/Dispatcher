# Dispatcher RHIZA ingress v1 — DP-001 contract

Contract date: 2026-10-22; internal baseline alignment 2026-10-24. The current candidate adapts committed compatibility source `8d24717710079dc831fabfab8a57edb4296a67be` against common base `3c1a565522e5f99595b57618c7c8fa70c40e4c75`, preserving later Dispatcher native and snapshot boundaries. Original compatibility baselines and check results below remain historical; current integration evidence is recorded in `docs/convergence-remaining-issues.md`. This is the Dispatcher-owned ingress contract, not RHIZA's future public Integration API or an assertion that RHIZA X1 is released.

## Ownership and release boundary

RHIZA owns Workspace/Workflow/Execution, Context, approval, evaluation and accepted artifacts. Dispatcher owns canonical Task/Contract/Run/native session and PR delivery. External IDs are references. No shared database, copied source, credentials, Workflow scheduler or Dashboard dependency is introduced. Dispatcher DP implementation may proceed independently; real RHIZA adapter and bilateral release require RHIZA M26/INH-1434 and the respective DP gates.

The first ingress accepts code + pull-request delivery only, registered repositories and verification commands, and explicit per-task model selection. Reuse existing canonical publication/TaskService/UoW, ConfigPlan, SecretStore, native authority and ExecutionSelection. Same Profile may run distinct explicit models/options in separate sessions; start/input/resume retain their frozen selection. No default model, policy-auto, automatic fallback or silent operator reroute is permitted for an externally bound job.

## Versioned source and routes

The single wire-schema source is `packages/protocol/src/rhiza-v1.ts` (`rhizaV1Schema`); protocol `1.1`, schema/fixture artifact `1.1.0`, schemaVersion `1`, event schema `1`. This pre-release successor accepts only a `1.1` handshake; a `1.0`-only client receives PROTOCOL_UNSUPPORTED and must upgrade. It is not a dual-version compatibility claim. Historical receipts and absent-field request hashes remain unchanged. This does not change Controller–Runner protocol `1.2`. `packages/protocol/test/fixtures/rhiza-v1.ts` contains synthetic examples, not native-provider evidence. Publish future schema/fixture artifacts from this source with a recorded SHA-256; consumers pin version + digest and never hand-copy internal TypeScript types. Removed/changed required semantics require a new negotiated major; unknown required capabilities fail closed. Sensitive bodies, endpoint paths and secret references never appear in capabilities or errors.

All paths below have prefix `/api/integrations/rhiza/v1`. Authentication, current grant expiry/revocation, Host/Origin, transport safety and limits apply to every request, including capabilities and handshake. Owner/session authentication is not an external service identity; no owner-token fallback is permitted.

| Method/path | Scope and behavior |
| --- | --- |
| GET capabilities / POST handshakes | Authenticated service identity; negotiate independent protocol/event schema and actually enabled capabilities/scopes; no session token or permission amplification |
| GET targets | targets:read; authorized redacted catalog, scoped by registered repository and Profile |
| POST jobs/preflights | jobs:submit + targets:read; validate full frozen workOrder, permission and exact catalog; no task/Run/worktree/child creation |
| POST jobs | jobs:submit; requestId + preflightId + targetHash + full workOrder; immutable accepted receipt, never wait for native execution to finish |
| GET operations/by-key/{requestId} | jobs:read; authenticated original client's submit idempotency domain; no new dispatch; absence is not proof of no external effect |
| GET jobs/{jobId} | jobs:read; authorized current snapshot with consistent resume cursor |
| GET events | events:read; bounded JSON business-event replay; cursor binds client/authorization/job filter/schema, every page reauthenticates |
| POST jobs/{jobId}/cancellations | jobs:cancel; independent requestId, expected job revision, runId/generation; durable intent then stop reconciliation |
| POST jobs/{jobId}/inputs | jobs:input; independent requestId plus job/intervention/task revisions, original session and lease; no model/target change |
| GET jobs/{jobId}/artifacts | artifacts:read; immutable candidate provenance/digests/evidence, not raw private paths |

Capabilities are advertised only when the corresponding production path is implemented and its policy can be fulfilled. A catalog listing or installed Adapter cannot imply `model.verified`. A valid handshake grants no permission beyond the current service grant; revocation/expiry is checked again after awaits and on subsequent reads/commands/stream delivery.

## Frozen data and semantic identity

The executable schema defines bounded structures for origin, exact target, Context, constraints, approval, delivery, preflight, immutable receipt, mutable snapshot, event, controls, artifact and model evidence. `origin` contains authority/workspace/executionRun/dispatch/generation and optional Workflow/step attempt. It is correlation, never authentication. Additional fields are rejected rather than stripped. Reject unknown repos/commands, expired deadline/approval, invalid relative scope, oversized UTF-8 Context and unavailable target before admission. Approval digest/reference bind the exact work order; a remote reference is only the authenticated client's attestation, never a Dispatcher owner approval or scope extension.

`context.inputHash` is lowercase SHA-256 over the exact UTF-8 `context.content` bytes; no trimming, newline rewriting or Unicode normalization. `targetHash` hashes all schema-defined target fields. Work-order/request semantic hashing uses UTF-8 JSON with object keys recursively sorted by JavaScript UTF-16 code-unit order, arrays kept in order, finite JSON numbers serialized by JSON.stringify, and no Unicode normalization. Reject unpaired surrogates and non-JSON values. This is versioned ingress canonicalization, not the existing publication helper's locale-sensitive sorting. Include all workOrder fields (origin/generation, Context, target/options, constraints, approval, deadline and delivery); exclude request/trace IDs, transport timestamps and replaceable preflight token. Original lookup authenticates before reading or replaying a receipt.

The exact submit semantic preimage is `{schemaVersion: 1, targetHash, workOrder}`. Submit idempotency domain is authenticated client + command scope `jobs:submit` + requestId. Same semantic hash returns the original immutable receipt; a different hash is IDEMPOTENCY_CONFLICT. Separate control commands have their own idempotency domains. Expiring/replacing a preflight does not create a second accepted job. Existing accepted retries never call launch again. Save canonical Task/Contract, external correlation, frozen work order, dispatch intent and accepted receipt atomically before native start. Constraints must reach TaskContract and invocation unchanged; the existing PublishDraft's empty constraints path is not a valid external mapping.

The approval digest preimage is `{workOrder: <all workOrder fields except approval>, approval: {reference, expiresAt}}` under the same canonicalization; exclude the digest itself to avoid a circular definition. This checks binding to the submitted intent, not whether a human actually approved it: the authenticated client's attestation and the local service grant remain the trust boundary. The job/request hash includes the completed approval object.

## Snapshot, effects and model evidence

Accepted receipt is immutable (`state=accepted`), while snapshot revision evolves. Snapshot + cursor observe one durable consistency boundary; eventId and job revision deduplicate changes, and expired cursors require re-reading the authorized snapshot. In-memory Fleet events and stdout/token chunks are not this durable business history. Export only allowlisted safe metadata. Bound artifact descriptor to job/Run/generation/target/input/repository/commit/digest/verification/model evidence; verification evidence must describe that exact commit. A PR URL alone is not provenance, trusted CI or completed RHIZA work.

| Dispatcher observation | External meaning / allowed RHIZA interpretation |
| --- | --- |
| Accepted, queued or starting | accepted; wait/query, no successor activation |
| Running | running; actual stop not asserted |
| Waiting for original user input | waiting_input only if supported; frozen target/session and current lease |
| Run COMPLETE + Task REVIEW with qualified delivery | candidate; RHIZA must verify and independently Evaluate |
| Native failure / canonical failure | failed only when known; no automatic cross-target retry |
| Lost startup/runner ownership | unknown / LAUNCH_UNCERTAIN; query original key and reconcile, never retry spawn blindly |
| Cancel request accepted | cancellationRequested + stop_requested/unknown; not proof of stopped |
| Qualified terminal cancellation | canceled with observed stop proof; any unknown external effect remains visible |

Model evidence separates requested, resolved and reported identities. verified requires trusted native-session metadata, a reported identity, actual model/option comparison and the exact RHIZA Run/dispatch/generation plus Dispatcher Run/session/targetHash. configuration_confirmed requires captured actual invocation matching the frozen target, not just configuration. Self-report, labels, catalog, request echo, login and exit 0 do not qualify as verified. Minimum policy defaults to verified at product selection; lower policy requires an explicit work-order choice and is never an automatic downgrade. mismatch blocks candidate acceptance. Structural schema validation alone proves none of these runtime facts.

Cancellation first persists intent/fence, then requests stop. A failed/unknown stop cannot authorize replacement or release uncertain external effects. Input rechecks job/intervention/task revisions, original session, lease and generation after awaits. Explicit reassignment is a new RHIZA attempt/generation/requestId with fresh preflight/approval; prior authority must be safely stopped/resolved. Reject operator target changes with TARGET_AUTHORITY_CHANGED. Database fencing prevents local commit, not a runaway process writing files. COMPLETE racing with cancellation must resolve through the existing canonical transaction/authority boundary, never a second state machine.

`generation` always identifies the RHIZA origin dispatch generation; `runGeneration` separately identifies the Dispatcher Run generation. Snapshot exposes both when a Run exists. `jobs:input` in allowedOperations requires a waiting snapshot with runId/runGeneration and current intervention revision/sessionId/leaseId/taskRevision, so a client can construct the exact input fence without private API reads. Queued cancellation explicitly sends runId=null and no runGeneration; server accepts it only while the job still has no Run, persists cancellation before dispatch, and rejects any racing Run assignment through expectedJobRevision. Once assigned, cancellation must match both Run identity and Run generation.

## Explicit successor admission (DP-007c)

An optional `workOrder.reassignment` binds `jobId`, `expectedJobRevision`,
`runId` and, when non-null, `runGeneration` of the predecessor. It is copied into
its successor's immutable acceptance receipt. It participates in both approval
and request hashes. `jobs.reassign` must be enabled by the service as well as the
current `jobs:submit` and `targets:read` grants. The service currently withholds
both submit and reassignment capabilities pending real tuple qualification.

The authenticated client, authority, workspace and optional Workflow stay the
same. The successor has a different RHIZA executionRunId, dispatchId, requestId
and approval reference, a strictly greater origin generation, and for a Workflow
a different non-empty stepAttemptId. executionRunId is correlation, not the
lineage key. A scoped dispatch can be admitted once; unrelated parallel dispatches
may share a generation. At most one successor can consume a predecessor. The
predecessor's snapshot revision must still match at canonical commit, after
asynchronous preparation. Replaying the accepted key returns its original receipt
without re-consuming that revision or launching again. Without a reassignment
link the request attests independent work; the server cannot infer lineage from
arbitrary fresh external IDs.

The predicate runs at preflight, canonical acceptance and final dispatch review.
It reauthorizes both old and new repository/Profile resources, then checks every
prior Run for unresolved inputs, native commands/queues, external controls,
verification mutations, Git/push/PR creation intents and external write blockers.
Unknown launch/publication/stop remains a blocker. Read-only CI pending is not an
uncertain PR creation. Queued cancellation qualifies only with canonical canceled
Task, no Run and its immutable not-sent observation. This first release qualifies one canonical Run per external job; unexpected
additional Runs require reconciliation. Run-backed paths additionally
require current AUTOMATED control of the exact Run, no native-takeover binding,
and an immutable physical drain record for the latest invocation with matching
session, provider session, generation, attempt and lease.

The local Codex adapter emits this private record only after its concrete owned
process group reports empty following stop/drain. Adapter terminal state, custom
backend self-report, SQL fencing and exit 0 do not produce it. It is physical
process-group evidence, not model identity proof or a claim about escaped external
processes. Other backends remain unqualified. A failed attempt may be explicitly
retried after qualified failed drain; a completed candidate also needs the exact
model policy and canonical artifact/source evidence. Cancellation requires the
original immutable stopped observation and matching stop intent. It never
converts unknown external effects into safe termination.

Schema 18 / writer protocol 14 stores this private completion journal and adds
scoped dispatch and single-successor uniqueness to immutable admissions. Every
unique replacement key, including rowid, is guarded. Existing duplicate dispatch
identities cause an atomic migration failure, preserving all old receipts; an
operator must resolve the source ambiguity before upgrade. Successor admission
and predecessor revision/event commit together. Once admitted, the old attempt
cannot accept new input, perform native writes or publish a candidate. Historical
receipt queries and known canceled/failed observations remain available under
current authorization. A fresh Controller never adopts either pending launch.

## Operations, migration and evidence

### Target catalog and preflight implementation (DP-003)

`GET targets?repositoryId=<registered-id>` projects only the authenticated grant's
Profiles for that repository. The single wire source additionally defines
`targetCatalog`/`catalogTarget`. Each row distinguishes selection availability
from `releaseQualified`; every current row is releaseQualified=false. Account
catalog entries with unconfirmed access, native-auto/tier identifiers, stale
probes, unsupported selection or unavailable owning Runner remain unverified.
No alias/settings, native account, path, endpoint or raw probe diagnostic leaves
this projection. A required capability can be negotiated only when offered;
this stage offers targets.read, not jobs.submit or model.verified.

The endpoint reads existing owner-populated native catalog/probe snapshots only.
It never refreshes a native catalog or runs a profile probe on the client's
behalf. Missing/expired snapshots require an owner-side refresh through existing
controls. Profile revision hashes the profile's scoped execution/credential/native
context plus the installed adapter implementation byte digest. The external row's
catalogRevision separately hashes the native catalog revision and physical
repository directory/device/inode. Owner catalog reads retain this directory
metadata only if it is unchanged across the read. RHIZA rejects old/mismatching
metadata; replacing a directory cannot revive its approved target after a refresh.
The private ExecutionSelection keeps the original native catalog revision and
contextFingerprint, preserving existing native selection/continuation checks.
Unrelated global config
changes do not become profile revisions. Remote filesystem paths are never
interpreted as Controller paths; remote native qualification is still pending.

`POST jobs/preflights` validates a bounded PR work order, exact target/options,
registered command IDs/scope, caller authority, exact UTF-8 Context hash, approval
digest/expiry and deadline. It reuses the Adapter's explicit ExecutionSelection
guard and WorkspaceManager's extracted filesystem-only scope check, including
private paths and symlink escape. After the filesystem await it repeats authority,
target and time validation, then stores a versioned private preflight record and
returns only its receipt. It creates no child process, Task, Run or worktree. Git
baseline and SCM write-access checks remain mandatory at atomic admission/start;
a filesystem scope check is not Git or PR-provider qualification.

Current production facts declare no model-evidence capability; they therefore
cannot satisfy either evidence policy and cannot yield a runnable preflight.
Positive core tests supply explicit synthetic facts to verify freezing two models
on one Profile, parameter/permission/drift/expiry rejection and post-await fences.
They are not native invocation evidence. DP-005 must implement actual invocation
and trusted-model proof before those capabilities can be offered. DP-008 and the
release Gate still qualify the exact real tuple. Cached owner catalogs that
predate the optional RHIZA directory metadata remain unverified to RHIZA until
refreshed. Existing native Run/session fingerprints and continuation semantics
are unchanged. Wire metadata is validated and the catalog projection is bounded
to 1 MiB. Native revision/fingerprint fields accept only the SHA-256 formats
emitted by current adapters; unknown diagnostic strings remain private.

### Native target/session lock (DP-005a)

Existing ExecutionSelection and adapter session snapshots remain the single model
choice for start, send and resume. Two explicit targets on one Profile retain
their separate model/options and native session IDs after an adapter restart and
a changed Profile default. No current default supplies a replacement choice.
Controller configuration/context/credential checks remain in force: this adapter
fixture proof does not waive a changed native execution fingerprint.
Admitted pricing remains in the private frozen selection. Start and continuation
re-admit current terms; changed, expired or unavailable evidence blocks before
send, while a collection-time-only refresh retains the original reviewed quote.

The common model-binding guard now also checks already-known provider session
identity across result awaits. Initial native identity may be learned once;
later native results or store callbacks cannot replace it and continue another
session. Codex and structured CLI results are checked before session publication.
Legacy missing snapshots still require review. These are offline invocation and
continuation contracts; they neither establish actual model use nor advertise
model-evidence capability or a real supported tuple.

### Model evidence and candidate policy (DP-005b)

Each actual Codex/structured-CLI backend invocation records a bounded model/options
fact, with a unique turn ID and Run/session/generation/attempt/lease binding.
Records append in Dispatcher SQLite and cannot be updated, deleted or replaced;
the mutable session stores only its latest reference. Prompt, environment, full
argv and routing explanations are excluded. A backend failure creates no proof;
a post-spawn persistence failure uses existing owned-turn stop and unknown/reconcile
handling. Schema 14 / writer protocol 10 fences binaries without candidate policy.
This capture is limited to synchronous legacy effect-admission paths. Async
native Codex/OpenCode acquiring turns retain observer invocation/binding fields
without manufacturing that proof from `start()` return, readiness or price.

Requested comes from the immutable work order; resolved comes from the frozen Run
selection. An exact actual invocation proves configuration_confirmed, with no
reported model. Verified additionally needs a qualified executed-model report
for this invocation/native session, with matching model/options and CLI/adapter
versions. The internal qualified-report contract is exercised by synthetic tests;
no currently registered producer supplies that qualification. Codex exec output,
Pi current-configuration observations, request echo, model self-report, UI fields
and old baseline metadata cannot open verified capability. Production evidence
capabilities and supported tuple whitelist remain empty.

Mismatch always blocks, including under an explicitly lower policy. A verified
policy never downgrades to configuration_confirmed. RHIZA candidate checks run
at Git/PR delivery, canonical Run completion, and canonical Task REVIEW/DONE
writes. Proof for a previous turn cannot qualify a new or unfinished invocation.
These are Dispatcher candidate checks; RHIZA still owns its independent Evaluate.

### Canonical admission details (DP-004b)

`POST jobs` validates the frozen private preflight and exact wire work order, then
uses the existing canonical PublicationService/TaskContractCompiler/TaskService.
Optional typed `inputContext` and `constraints` now pass through that canonical
boundary, preserving existing callers that omit them. Context content is limited
to 64 KiB of exact UTF-8, rejects unpaired surrogates, and must match its SHA-256;
the scheduler renders its complete structured JSON separately from instructions.

The publication transaction hook commits Task/Contract, execution intent,
RHIZA correlation/job authority and immutable external acceptance together.
Canonical publication keys use a bounded digest of the authenticated command
domain. A semantic collision retains `IDEMPOTENCY_CONFLICT` even across instances.
The response is the immutable accepted receipt; native completion never rewrites
it. A dispatch claim is persisted before the first launch await, and launch uses
the original canonical dispatcher only after commit. Startup failure/unknown
effects stay queryable and do not create automatic retries. A fresh Controller
marks interrupted jobs unknown, preserving original-key lookup and receipt replay.

The original request/principal/job association is immutable while only its effect
journal may change. Owner redispatch and silent reroute cannot bypass a new RHIZA
attempt/approval. Embedded start checks bound authority at the final synchronous
native send callback, including credential expiry, preflight/deadline and closed
admission. Shutdown closes admission and drains already-running launch promises
before closing storage. Remote targets remain unavailable here.

Schema 13 / writer 9 fences earlier code that would ignore structured Context or
RHIZA job ownership. Migrations 10/11 remain isolated and require reconciliation
with the other in-flight branch before merge/deploy. No live database is upgraded.
Production target facts still declare no model proof, so no new real acceptance
or runnable tuple is enabled. DP-006 adds the implemented jobs.read/events.read/
artifacts.read paths; submission, input and actual model-proof/native
qualification retain their dependent Gates.

### Durable cancellation (DP-007a)

POST jobs/{jobId}/cancellations returns a distinct immutable controlReceipt with
kind=cancel and state=accepted (202); it never rewrites the original job acceptance.
The authenticated client + jobs.cancel + requestId bind the exact job and request,
including expected revision, both products' generations and original Run. Retry
returns that receipt without another stop; changed semantics conflict. Intent
and its event commit before native I/O. The existing canonical cancellation path
checks current service authority at the native boundary and preserves the original
session/lease/selection. Unsupported local backends and remote/native takeover
paths reject rather than claiming capability. Global disable preserves this exact
scoped POST cleanup path; revocation denies it.

Immutable command/effect journals use schema16/writer12. Pending or claimed effects
on restart become unknown with no resend. Queued, unclaimed dispatch can be canceled
atomically without native I/O. Once intent exists, late startup, continuation,
advance and candidate delivery are blocked through the canonical authority guards.
Snapshot cancellationRequested, stop_requested/unknown/stopped, and business canceled
remain distinct: stopped requires original owned stop proof and matching canonical
CANCELLED; interrupted effects remain blocked for owner reconciliation. Input and
new-attempt reassignment are DP-007b/c and are not offered by this batch.

### Durable reads and candidate provenance (DP-006)

GET jobs/{jobId} returns an explicit redacted current snapshot and a cursor.
SQLite triggers maintain job revision plus immutable job.changed in the same
transaction as canonical business writes. Snapshot source and cursor are read
together; repeated/older event notifications cannot supply older snapshot data.
Token usage, stdout and heartbeat timestamps are excluded from this history.
RHIZA verification captures the managed source tree before registered commands,
includes it in command semantic identity, and rejects source changes after commands.
An immutable source proof records that tree, exact Run/session/lease/target and
command definitions. Local commit compares the staged and actual commit trees;
an immutable commit proof then records the observed SHA. Artifacts require both
this exact commit proof and provider-reported matching PR head. Missing proof,
post-verification edits, old proof or replaced commit remain unqualified even if
Run verification says PASSED. Remote source-proof production is not implemented.

Schema 15 / writer 11 fences older writers and backfills an initial revision for
existing acceptances. Current writers cannot reset/delete/replace a revision,
event or candidate descriptor; all unique keys are protected without rowid aliases.

GET events?cursor=... returns at most 100 notifications, next cursor and hasMore.
GET events?jobId=... starts authorized replay from that job's initial event; a
supplied jobId must match an existing cursor filter. Cursors are persistent
opaque references, bind client/authorization/job/schema/position, and expire
after 24 hours. An unchanged position reuses the existing cursor. Expiry,
credential/grant revision changes or invalid cursor require a fresh snapshot.
Events use bounded JSON replay; this implementation has no open SSE stream.

Registered job/event/artifact reads continue during global disable and still
authenticate the credential and current resources. Revocation and expiry deny
the client immediately. Capabilities advertise these implemented reads, while
native submission/control/model capabilities remain unavailable. The strict
Fastify validator evaluates the original response schema directly because its
serializer cannot merge the conditional snapshot/model schemas. No condition or
additional-field check is removed; DTO construction excludes private source data.

Artifacts require Task REVIEW/DONE, Run COMPLETE, frozen model policy, matching
commit/push target, recorded provider PR head and passed registered verification
for the same commit. Delivery's inferred pushed commit is tagged separately and
cannot substitute for a provider PR head. A later read with no PR head marks that
source unavailable. The immutable descriptor digest is canonical SHA-256 over
all wire fields except artifactId and digest. Its generation is Dispatcher Run
generation; RHIZA generation remains in modelEvidence.binding. Repeat reads
return the original descriptor. Changed source, target, head or proof blocks
current qualification while retaining that original audit record.

These endpoints perform no native or SCM probe and no launch. A physical process
is not inferred alive/stopped from persisted business state. Canonical cancellation
intent is reported separately; its stop/control proof remains DP-007 work. A
Dispatcher candidate still requires RHIZA's own Evaluate/Gate. No real supported
tuple, production model proof or real RHIZA X1 connection is established here.

### Original acceptance storage and query (DP-004a)

`GET operations/by-key/{requestId}` requires current `jobs:read` authority and
checks the receipt's stored repository/Profile/authority against the current
grant. It cannot create a Task, Run, session or dispatch. `NOT_FOUND` states only
that no acceptance receipt is available; it cannot prove that no process started.
The registered query remains available during global ingress disable. Client
disable/revocation, expiry and credential changes still deny all client access.
Other routes remain closed during global disable; job cleanup controls are added
with their owning endpoints before job submission is enabled.

`rhiza_admissions` stores immutable acceptance under client + `jobs.submit` +
request ID. Hashing binds schema version, target hash and the complete work order;
request ID is in the key domain, preflight ID may be refreshed, and trace/sending
time never enter this hash. Schema validation still rejects extra wire fields.
The synchronous acceptance callback participates in the existing database
transaction/savepoint. Replaying an accepted key never calls that callback;
different semantics conflict. The jobs endpoint was deferred to DP-004b in that storage-only batch.
The table rejects UPDATE, DELETE and INSERT replacement through any conflicting
key/job/task identity. Receipt retention is required for v1 idempotency; future
retention changes require a versioned recovery policy. Schema 12/writer 8 rejects
older binaries and already-open writers, and backups/restores retain receipts.
Committed upstream1–11 and RHIZA12–18 now share a contiguous reviewed catalog.
Conflicting old private16 catalogs are rejected intact before migration or restore.
No live data or enabled configuration was migrated here.

### Implemented identity boundary (DP-002)

`rhizaIngress` is persisted by ConfigPlan, defaults to `{enabled:false, clients:[]}`
for old configurations, and any grant change requires privileged confirmation.
Each client has a unique id/credential reference, authorityId, explicit registered
repository/Profile/scopes, enabled flag and UTC expiry. `secret://rhiza/...` values
are Controller-only integration credentials, never Runner/provider credentials.
An owner can provision/rotate through the existing authenticated SecretStore PUT
route and revoke through ConfigPlan. Generate a fresh cryptographic 32-byte nonce
and encode a bearer as `rhiza.<base64url UTF-8 clientId>.<base64url nonce>`; never
reuse the owner token. Prepare disabled metadata and its secret before enabling.
The owner secret-write response exposes metadata only; the RHIZA client stores
the supplied bearer on its server. There is no browser enrollment or public token
minting endpoint in this batch.

Authentication rechecks grant content, CredentialContext epoch and the durable
ConfigPlan revision after secret resolution. The last is an authorization fence
for pending work and closes revoke/regrant ABA; it conservatively invalidates
in-flight authority on any configuration change, without making an unrelated
global revision a target profile revision. Every service method checks a present
Origin against actual protocol/Host/port; forwarded headers cannot assert TLS.
Existing owner/session/CSRF behavior is retained. An expired/revoked request has
no owner fallback. Host/Origin and per-IP request/auth-failure limits still apply.

At the DP-002 baseline (`7c9b785`), only capabilities/handshake existed and their
offered arrays were empty. DP-003 adds targets.read and the fail-closed preflight
path described above. No job, native process, stream or supported release tuple
is created by a handshake. DP-004a/006 later register original-key, job, event
and artifact cleanup reads during disable, each with current resource authority.
The event API uses reauthenticated JSON pages; a future streaming extension must
independently preserve revocation during delivery.

Ingress remains default-off and grants are managed only through ConfigPlan with opaque `secret://rhiza/...` references. Restrict repository/Profile/scopes and validity; every request authenticates current grant. Cross-host traffic requires real TLS; untrusted forwarded headers cannot assert TLS. Reject browser cross-origin access. Disable blocks new work but preserves authorized cleanup queries/cancel; revocation blocks that client immediately and leaves owner reconciliation available. Do not delete accepted jobs, controls or events on disable.

Persistence additions remain in Dispatcher's own database, migration catalog and writer compatibility gates. Older writers must fail closed on active external authority. The isolated combined branch pins committed convergence3c1a565 and preserves upstream1–11, adding RHIZA12–18/writer8–14. Real legacy private16 databases and archives must be rejected unchanged, never relabeled or converted. Never copy moving dirty objects or run candidate binaries against another checkout's live data. Back up and verify test-database restore before migration; do not destructively downgrade with active/uncertain jobs.

Current baseline `pnpm check`: build/typecheck/lint/boundaries pass; 155 test files / 1604 tests pass (host-local log `/tmp/dispatcher-rhiza-baseline-check.log`). New structural contract tests: 45 pass after observed RED, including the independent review's actionable-input and queued-cancel fixes. A default-concurrency full rerun had three unchanged Pi version-probe deadline failures; the unchanged three-file diagnostic passed 120/120 with one worker. Preserve both observations; never raise the production deadline or rewrite its assertions. Real supported tuple whitelist is EMPTY. Codex is a candidate, not a supported tuple; actual OS/release/CLI/adapter/Profile revision/backend/model/options, two-turn artifact and stop/recovery proof are all pending DP-008. No public ingress is active at DP-001. Independent contract/security review and later runtime review are recorded with exact source hashes; structural PASS is never a release Gate.

### Original-session input (DP-007b)

POST jobs/{jobId}/inputs accepts an immutable kind=input controlReceipt (202).
Acceptance checks current job, intervention/control and Task revisions, both
products' generations, the original session/lease and explicit target. It reserves
the existing native RunInputReceipt in that same transaction, before native I/O.
Retries return the original external receipt; changed input or authority conflicts.

The existing console input sender is shared with owner calls. Its original
selection validation, mutation lane, native final guard and stale-input cleanup
remain in force. Only the exact process-owned reservation can execute. Admission
requires a paused original backend with declared send/resume/cancel capabilities;
its own send may then advance Adapter state to STARTING/RUNNING without changing
provider session, model/options or lease. Unknown native input never creates a
new session or repeats an earlier message. Cancellation, revoked authority and
changed revisions block continuation; global disable does not allow new input.

Schema17/writer13 fences older input coordinators and notifies current-job control
changes and material current-Run input receipt changes in the same transaction
as the durable job revision/event. Timestamp-only updates and obsolete Run/session/
generation receipts do not notify the current job. All canonical senders recheck
availability inside reservation and at the native send boundary. Snapshot
jobs:input and its intervention require current input authorization, enabled
ingress and a valid waiting intervention without unresolved input/cancellation. Receipt acceptance and native input acknowledgement are separate
from candidate delivery and RHIZA Evaluate. Real tuple and new-attempt qualification
remain open; synthetic sender evidence does not release them.

### Reproducible contract artifact and isolated consumer (DP-009a)

`packages/protocol/releases/rhiza/1.1.0/` contains generated schema.json,
fixtures.json and manifest.json. The exporter reads the sole wire source and
synthetic fixture source; the manifest records exact bytes, SHA-256 and source
hashes without absolute paths or timestamps. The independent consumer reference
is `packages/protocol/test/fixtures/rhiza-release-pin.json`. Check it with:

```sh
node --import tsx packages/protocol/scripts/export-rhiza-contract.ts --check
pnpm exec vitest run packages/protocol/test/rhiza-release.test.ts apps/controller/test/rhiza-conformance.test.ts --maxWorkers=1
```

To construct a new artifact, pass `--output <owned-directory>` to the exporter.
Once released to consumers, do not overwrite its version: bump the artifact
version and review the new consumer pin. A valid manifest digest is checked before
parsing schema/fixtures; both file digests and lengths must agree. Literal semantic
vectors cover code-unit ordering, non-BMP keys, array order and distinct Unicode
forms. Wire examples have internally consistent hashes but are all synthetic;
none supplies actual model, process or PR qualification.

`scripts/rhiza-fake-client.mjs` imports only Node, existing Ajv and published JSON,
not product TypeScript or RHIZA code. It validates strict DTOs, object identity,
preflight/receipt hashes, immutable receipt replay, monotonic snapshots, staged
whole-page event validation and artifact digest/model/Run/target/input binding.
Cursor-only resume remains valid. The consumer binds cursors from snapshots and
fully validated pages to their observed job; explicit filters or known cursor
bindings reject cross-job replies. A new opaque cursor is never decoded or given
an invented filter. A transport failure is returned once; the tool never creates a replacement key,
retries execution or advances Workflow/Evaluate. Unknown fields/states and
cross-job responses fail closed. This is a test consumer, not a production RHIZA
adapter.

The optional CLI accepts one JSON object on stdin: artifactDirectory, pin,
baseUrl, a synthetic token and commands. It permits loopback HTTP only, refuses
redirects and outputs only status/schema counts; credentials never go on argv.
The HTTP suite also launches this CLI as a detached Node process against an
isolated Controller. Full admission tests supply explicitly synthetic native/SCM
facts and deferred execution; input/candidate tests reuse existing controlled
backend and canonical provenance fixtures. Real Controller restart, cursor
expiry, disable/revocation and schema/version denial are verified separately.
Production submit/reassign/model-verified capability withholding remains tested.
No RHIZA runtime source dependency, live enablement or bilateral release follows
from these conformance tests.
