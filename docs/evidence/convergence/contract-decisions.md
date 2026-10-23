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
