# CV-02 contract decisions

Sources: v3 `19db456`, continuation `a499d84`, ancestor `a1e8083`.
`source-disposition.csv` assigns all 503 changed paths (81 both, 103 v3-only,
319 continuation-only) to preservation decisions and a CV owner. These are
port decisions, not claims that target behavior has passed. WIP is separately
frozen in `source-manifest.json`. Preserve independent assertions from both
sources; test totals are not additive delivery evidence.

## Supported consumers and entrypoints

| Interface | Actual source consumer | Frozen target decision |
| --- | --- | --- |
| `GET /api/agents/profiles/:id/models` | v3 `NativeModelPicker`, `ModelsPage`, publication and owning-Runner tests | Default remains `AccountModelCatalog` with `repositoryId` and owning execution context. No legacy response negotiation on the same URL. |
| Legacy catalog/default-model plans | continuation `ModelDefaultEditor` and `ModelRoutingView`; no v3 CLI/HTTP consumer found | Port their behavior to v3 `ModelsPage` + ConfigPlan. Do not mount the old components/DTO as another live entrypoint. Legacy records remain readable as historical data. |
| `/api/local/tasks` / spec / result / accept | continuation `PublishPage` and `LocalResultReview`; no current v3 consumer found | Preserve creation/accept receipts and candidate evidence, adapt reads to canonical Task; v3 publication + canonical result/accept remain the write entrypoint. Do not replay old create receipts as new requests. |
| Slack, CLI and owning Runner | current canonical dispatch/input/delivery and versioned native execution protocol | Keep public behavior and authority. Native additions use their owning Adapter/Runner, never a Controller-local replacement of remote work. |

Search evidence: `rg` on current apps/packages and `git grep a499d84` on old
Web/CLI consumers. No claim is made about unknown third-party clients; they
cannot silently select a different shape by `version:1` or missing fields.

## Persistence and authority

- New Runs retain `ExecutionSelection`; native bindings reference that frozen
  selection and Run contract/context. `RunModelSelection` is legacy historical
  input, never a second selection on a new Run. Keep requested/reported/price
  facts separate. Legacy `ModelCatalogContext` must be explicitly named when
  imported, leaving the v3 public name unchanged.
- New usage is `UsageObservationV1`: decimal strings, event identity, units,
  inclusion, scope/period, observed/collected times. Import legacy records with
  a source-format/record identity, raw evidence and completeness diagnostic.
  A native event seen through two collectors must not be counted twice.
- Legacy finite safe numbers can preserve their stored decimal representation;
  they cannot recover original upstream precision. Reject unsafe integers,
  non-finite/negative quantities and ambiguous conversion from exact estimates.
  Do not pass canonical quantities/rates through JavaScript number arithmetic.
  Native billing occurrence is separate from observation time; missing billing
  time cannot be invented to allocate a rate segment.
- Retain schema 4 `native_session_interaction` and schema 5
  `minimum_writer_protocol`, including their SQL/afterApply semantics and
  `dispatcher_writer_protocol()` registration. Never remove writer triggers.
  Use backups and old-schema fixtures only, not the original live data.
- The verified source catalogs stop at 3/5, so allocate migration 6 for writer
  protocol 2. Old protocol-1 clients do not understand v3 immutable selections;
  leaving protocol 1 writable would let them erase new facts. Replace the gate
  transactionally during migration 6, preserving migration 4/5 definitions,
  and restore connection-local protocol on migration/outer-transaction rollback.
- One canonical Session id keys NativeBinding and SessionControl. Unknown or
  conflicting legacy identity is read-only and cannot become AUTOMATED by
  filling fields from current config. Lease/currentRun/task revision and
  control epoch/revision guard every side effect, including post-await commit.

## Port and verification sequence

CV-04 ports the existing pure native contract, drift and persistence modules
with their tests first, adapting binding validation to v3 selection + frozen
repository/base context. CV-05 then adapts native selection producers; CV-06
and CV-07 consume canonical decimal/provenance rules; CV-08 joins every v3
write path to control authority. Existing source runtime code is reused within
its boundary, not copied wholesale over Controller/service or v3 UI.

Required acceptance fixtures span manual/policy/native-default, actual legacy
Run/selection, unknown identity, safe/unsafe numbers, missing/zero values,
HUMAN/UNKNOWN control, old writer and migration failure. They are exercised
in their producing units; the current baseline full gate is 80 files / 724
tests passed with default workers at `87ab99d`. It does not prove the new
migration/port fixtures or any real native UI/provider Gate.


## Default-model review compatibility

Account-default is an explicit publication choice carrying the concrete saved
model ID, current catalog/context and per-run parameters. It does not silently
replace the native-default omission path. New default-model ConfigPlans retain
v3 edit semantics with optional `NativeModelDefaultReviewV1`; evidence format
`v3-model-default-plan-v1` binds actor/revision/scope and must requalify on apply.
Old `model-default-plan` records are retained and rejected for fresh review.
This compatibility is required by persisted records; it is not response-shape
negotiation or a second live selection authority.


## Legacy usage read admission

Legacy UsageMeasurement objects have source-specific identity, attempt and optional
billing occurrence. The pure reader returns private historical evidence and
explicitly unproven native event equivalence. It must not be sent directly to
the canonical writer or counted alongside v3 observations. Preserve raw source
records and reconcile event origin/attempt/time before producing canonical
UsageObservationV1; collection time cannot stand in for missing billing time.

## CV-07 frozen native price admission

The approved C1/C2 price requirement extends the current catalog/selection path:
an owning catalog may attach explicit native-account-model price evidence for an
exact parameter set. Fresh account/model/backend/context and parameter identity
must match the reviewed choice; model inventory costs and subscription labels are
not rates. Native-default without a proved model keeps price unavailable.

The admitted `PricingSnapshotV1` is one optional fact inside the existing immutable
ExecutionSelection. It is never another RunModelSelection or a live price lookup
for historical Runs. Preview exposes it, confirmation covers it, pre-start
rechecks terms while retaining the original collection timestamp, and persistence
protects the full selection JSON. The existing immutable-selection checks protect
price edits, but an old writer6 does not revalidate price before startup. Additive
schema11/writer7 therefore rejects those old connections. Migrations1–10 remain
unchanged; schema10 archives retain writer6 and only restored copies upgrade.

The strict native execution protocol must preserve/validate this optional field.
Owning Runners advertise price-snapshot support; a priced request cannot be sent
to a peer that lacks it. A newer catalog cannot rewrite an existing Run's price.
Estimation consumes the canonical ledger, with billing time only from admitted
native occurrence, and returns formula/input/price/rounding/completeness evidence.
Account quota, resource truth and native actual cost remain independent.
Unresolved collection/read gaps make any retained saved amount partial. Unresolved
identity/event/source conflicts make it unavailable, including through subsequent
read exceptions. A valid admitted recovery may restore collection completeness;
no read failure rewrites the immutable accepted observations.

Implementation sequence: pure admission + source math regressions; catalog,
publication/Adapter/Runner propagation with immutability and revalidation tests;
canonical Run estimate projection; current usage UI and complete pnpm check.
Positive cases use scoped fixture price producers. Built-in providers without
qualified price reads keep unavailable; fixture results cannot qualify real prices.

## CV-06 owning-Runner quota projection

Ruling: share the existing account-only quota coordinator in packages/runner —
Controller and owning Runner both need its coalescing, deadlines, context guards,
TTL/reset and durable cleanup ownership — copying only the successful read would
lose those safeguards. Physical native reads return snapshots; the remote facade
returns a validated owning-cache state, preserving source status/last success and
an opaque source context fingerprint. Controller transport failure may retain its
last matching success as error, but a successful owner response with a new context
must not resurrect an older snapshot or restamp its time. If wrong, one shared
coordinator can affect both owners; retain its existing regressions and add proxy
state, pending registration/shutdown and strict transport cases before admission.

Account commands are profile-only read/refresh, with a separate additive capability
and no Run/lease/workspace authority. The owning Runner validates registration and
native-file epoch before and after waits. Pending or cleanup-unknown reads fence
physical registration replacement and storage closure even if a remote wait ends.
No native inference, Run/resource change or Controller native path is involved.

Ruling: keep periodic quota scheduling in the existing Controller background
worker — the owning Runner supplies physical collection/cache/cleanup, while one
scheduler avoids independent duplicate polls — a disconnected Controller leaves
retained source facts to expire under the existing TTL until reconnection or
explicit collection. Native read and refresh remain distinct RPC actions.

## 2026-10-26 scheme B overlay: shared ownership and fixed sources

Authority: [adopted architecture](https://linear.app/inhandy/document/013da3a666f5),
[roadmap](https://linear.app/inhandy/document/b15aa19a4b54) and
[P01 ownership/resource registration](https://linear.app/inhandy/document/bea4a7dfe3e4).
The earlier sections preserve their historical source decisions. This overlay
records integration requirements and reuse candidates; it does not certify a
combined runtime. The 503 original disposition rows and their seven identity/owner
columns are unchanged.

### Authority by semantic field (names remain those of the frozen wire schema)

| Facts/effects | Single owner | Consumer rule |
| --- | --- | --- |
| Workflow, business origin/attempt/approval, Context, Evaluate, accepted artifact | RHIZA | Dispatcher returns execution/candidate facts; RHIZA decides business acceptance. Ordinary Chat/Provider remains RHIZA-owned. |
| Canonical Task/Contract/Run, native Session/Harness/Adapter, Runner/process/worktree, credentials and physical retry | Dispatcher | RHIZA uses one restricted consumer, with no duplicate native scheduler or CLI fallback. |
| Exact external Harness/model/options/revisions/evidence policy | RHIZA freezes the business choice; Dispatcher admits the authorized exact execution and reports observed evidence | No second Policy selection. Requested/configured/observed/verified remain distinct. Local manual/policy paths are preserved. |
| Semantic request key/hash and immutable receipt | Dispatcher owns canonical acceptance; RHIZA owns its durable intent/receipt association | Lost replies query the original key. Rework explicitly creates a new business attempt; no client-side physical retry. |
| Job revision/cursor, native control/session/lease/generation, candidate tree/commit/PR/digest and required verification | Dispatcher | Validate current authority and original correlation; cancel ACK is not stop, terminal/idle/zero pending is not quiescence. RHIZA evaluates candidates separately. |
| Wire schema/artifact generation | Dispatcher compatibility owner; RHIZA pins the generated artifact | No cross-product TypeScript, database, migration or credential sharing. Protocol extensions require explicit versioned review. |

### Fixed source to capability, tests and migration/writer mapping

Readback on 2026-10-26 verified the following Git commit objects and evidence-file
digests. Historical check results below are read from those retained artifacts,
not rerun or transferred to this candidate. INH-1981/1982/1984/1985 source commits
are ancestors of the fixed compatibility source `8d24717710079dc831fabfab8a57edb4296a67be`;
this observation does not appoint a moving branch HEAD as an integration cut.

| Fixed source / evidence | Capability and preserved regression purposes | Schema / writer; owner | Disposition in convergence |
| --- | --- | --- | --- |
| D candidate `8bbd07e65867d5bfa977e3897d0d0f9f41998179` (functional Profile UI `e9edf1a566fd6b6b3e3298b8f0d142d6ffe382f7`) | Canonical local routing/delivery, admitted native runtimes and read-only UI. Latest local gate: 213 files / 4525 tests plus build/typecheck/lint/boundaries; source assertions and actual fixture browser evidence remain in their CV records. | Current source 11 / 7; D owns candidate service/persistence/domain/protocol integration and its lock/CI. | **Reuse** current canonical boundaries. New integration must preserve their full original regression purposes, not replace them with older source copies. |
| INH-1981 `af039cfa441f0a9e86f1b0515d75a14f50bcc3d2`; evidence SHA `f116565dffe62082b5b2c08a3111ac55703e2e5d01f76d59c60f78fec9225485` | Ingress alignment, exact price/selection admission, shutdown drain and bounded canonical lookup. Retain every-step migration failure/retry/outer rollback, old-writer refusal, backup restore and original private16 DB/archive refusal. Historical gate 226 / 3249. | Upstream 1–11 unchanged, RHIZA 12–18 / writer 8–14; compatibility owner. | **Adapt** committed ingress delta to fixed D source. **Defer** adoption until schema/afterApply/writer/test differences are reconciled; never relabel or downgrade private16 data. |
| INH-1982 `129c2c6408456285cdbc1e36c6dd075fd09860d6`; evidence SHA `935a4709d35c0082fb75d1e61be8895289d8d9336e1c2a7ed26277a0561bec6d` | OpenCode/Pi stored identity and raw-work lifecycle; original-key receipt/query/restart, unknown/manual snapshot/cursor, disabled versus revoked access. Historical gate 226 / 3416. | 18 / 14 unchanged; compatibility owner. | **Reuse/adapt** original receipts and read-only recovery through current native boundaries; never cold-resume or infer a new writer/model from restored identity. |
| INH-1983 execution source `c4f509f5b6c971f07c3c567bbd145758334900a4`, diagnostic fix `8d24717710079dc831fabfab8a57edb4296a67be`; diagnostic evidence commit `30f6391db536b57710bf92138653dd7e69cc9d9a`, SHA `33dde6dc98ebab3aa83bf18661a1b68a95d3fc174e8ba6fc00369ba2fa65495b` | One-shot beforePrompt versus current beforeObserve, ACK→read barriers, every GET before/after authority checks, revoked/generation/lease/runtime/Adapter/target/account negatives and held-header diagnostics. Final historical gate 234 / 3864. | 18 / 14 unchanged; compatibility owner. | **Adapt** to current callback capture/raw lifecycle. Preserve write and observation admission separately; do not roll ACK back or weaken SENDING/start fences to make reads succeed. |
| INH-1984 `f6e5dce9765342646d808336e1815afa77479f6e`; evidence commit `9204f830014fa7df54e22d7b36f282d80b393959`, SHA `6d5d47054a43b7f6e72c376dcbe02d00597681e41d771c956d38666bc387703e` | Default Codex version-probe and actual spawn authority; held real marker process, async guard raw settlement, direct/custom consumer and cleanup contracts. Historical gate 227 / 3445. | 18 / 14 unchanged; compatibility owner. | **Reuse/adapt** original authority across current spawn boundaries. Marker fixtures do not qualify installed Codex, a model or physical writer stop. |
| INH-1985 `09fdfc6cfe8432ee3fe6193543c3134f23ca3318`; evidence commit `f4f9e201b1deca29c011970d50d0bd1f21b13d45`, SHA `a74506475c6f4074f22ae2e1a2345d397da749b7aa822c641a8f76777428fdb5` | Fixed ACP/root-only source `a3a4e66d2c393b39425e9ca27376ca80cb204b57`, write/observe receiver and raw-callback capture, pipe failure and reason-independent catalog identity; upstream assertions retained with explicit phase fixture mapping. Historical gate 234 / 3862. | 18 / 14 unchanged; compatibility owner. | **Adapt** only still-missing committed deltas; current D has later ACP/Copilot/Pi work. Do not overwrite it or duplicate an Adapter. Root-only probe-budget Minor and descendant/writer qualification remain explicit. |

The evidence files above live at their fixed commits under `docs/evidence/rhiza/`;
they are not asserted to exist in the D candidate. The compatibility artifact at
`8d247177:packages/protocol/releases/rhiza/1.1.0/manifest.json` was read byte-for-byte:
715 bytes, protocol 1.1 / artifact 1.1.0, SHA256
`2cae1cc869c3c689a6f3ac11eaa6f5e87dddb9f9f0facb43b584349d672f2d74`,
explicitly synthetic. Its current scope is code+PR. Unsupported external Agent
task types are refused pending a versioned contract; existing local none/commit/PR
support does not silently expand that scope.

**2026-11-02 implementation adoption:** current D `3cdb5f7` now adapts the frozen
`8d247177` delta against common `3c1a565`. Later native runtimes, canonical snapshot
preparation/verification and strict commit owners remain current-D authorities.
The combined code retains migrations1–11, adds12–18/writer8–14 and preserves the
original private16 rejection/rollback fixtures. Source wire artifacts are byte
identical, including the manifest digest above. The only lock delta adds the
config-to-protocol workspace edge; all324 third-party resolutions remain fixed.
The 38-file focused slice exposed one omitted Input Context compiler dependency;
its correction and direct consumers passed a scoped3-file/70-test rerun without
weakening the original assertion. Milestone review identified and resolved the three missing committed Devin
phase/catalog/pipe deltas against their originala3a4 file base; affected-fix
re-review has no remaining Critical/Important findings. The final default combined
`pnpm check` passed264files/5875tests and build/typecheck/lint/boundaries; exporter
`--check` passed the original manifest digest. This locally accepts the source
adaptation. No live database, provider or credential was
touched by this integration unit; no bilateral/native Gate is discharged.

P01 completion registers isolated ownership/resources only. RHIZA A/B/C worktrees
and heavy-test windows remain independently owned. Basic M24 single-order real
acceptance (INH-1994) moves before M25/M26; complete X1/DP-009b remains after M26,
DP-010 remains unchanged, and local Dispatcher release keeps its own Gates.
Real tuple/model/PR/GUI/stop/recovery evidence, historical M19 ordering and M17
performance requirements are not discharged by these source readbacks.

## Local native snapshot PR owner (2026-11-02)

The current local PR path reuses the strict snapshot commit owner and the existing
version1 push receipt/journal, selected SCM and DeliveryService. One Run/generation
keeps one frozen push identity; proof/target changes cannot silently adopt that
effect. Existing unscopable push PENDING records remain barriers. Receipt inventory
and cancellation are checked after the original authority callback before a Git
write. Strict source/target/commands share one captured environment and require
the current registered workspace tuple; ordinary callers keep their prior path.

The owner returns the existing RunGitDelivery, including the actual qualified
commit/tree and push. Controller retains pushed evidence before HTTP, uses the
original PR intent/lookup on response loss, requalifies source after SCM, and
checks the original complete proof/control/Task/lease basis after transactional
COMPLETE/REVIEW writes. Matching RHIZA source/model provenance remains mandatory.
No persisted receipt format, schema18/writer14, wire artifact, remote capability
or dependency changes. Current local regressions and milestone review pass with
no Critical/Important/Minor findings. Final default `pnpm check` passed265files/
5883tests and build/typecheck/lint/boundaries on the same six functional hashes. Real provider/native
exclusion/physical-stop/GitHub and human acceptance retain their original Gates.
