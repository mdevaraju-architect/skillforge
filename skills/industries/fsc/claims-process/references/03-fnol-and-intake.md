# FNOL and Claim Intake

## What is FNOL

First Notice of Loss (FNOL) is the initial report of a loss event by a claimant or insured. It is the entry point that creates the `Claim` record and kicks off the claims lifecycle.

FNOL can arrive via:
- **OmniScript** (agent-assisted or self-service portal)
- **Agentforce conversational intake** (AI-guided FNOL over chat or voice)
- **Inbound API** (from mobile app, partner portal, or IVR system)
- **Batch import** (for catastrophe events with mass losses)

## Required Fields on `Claim` at Creation

| Field | API Name | Notes |
|---|---|---|
| Insurance Policy | `InsurancePolicyId` | Must reference an active `InsurancePolicy` |
| Loss Date | `DateOfLoss` | Cannot be after today; cannot be before `InsurancePolicy.EffectiveDate` |
| Loss Type | `LossType` | Picklist; drives routing and ClaimItem subtype selection |
| Loss Description | `LossDescription` | Free text; minimum meaningful description required |
| Status | `Status` | Set to `'New'` on creation |
| Claim Number | `ClaimNumber` | Auto-generated; do not set manually |

Optional but recommended at FNOL:
- `LossLocation` (address fields) — required for property and auto claims
- `ReportedDate` — defaults to today if not set
- `LossAmount` — preliminary estimate; can be refined during adjudication
- `ClaimChannel` — how the FNOL was received (`Phone`, `Web`, `Mobile`, `Agent`, `Batch`)

## `ClaimParticipant` — Required at FNOL

At minimum, create a `ClaimParticipant` with `Role = 'Claimant'` before transitioning status to `Open`.

| Role | When required | Key fields |
|---|---|---|
| `Claimant` | Always | `ParticipantId` (Contact or Account), `Role` |
| `Insured` | When different from Claimant | `ParticipantId` |
| `Adjuster` | Can be added post-routing | `ParticipantId` (User) |
| `Witness` | Optional | `ParticipantId`, `WitnessStatement__c` if custom |
| `ThirdPartyClaimant` | First-party vs. third-party claims | `ParticipantId`, `RepresentedByAttorney__c` |
| `Attorney` | When legal representation involved | `ParticipantId` (Contact) |

## `ClaimCoverage` — Link Claim to Policy Coverage

Every `Claim` must have at least one `ClaimCoverage` record before adjudication begins.

Required fields:
- `ClaimId` — parent claim
- `InsurancePolicyCoverageId` — the specific coverage line being claimed against
- `CoverageType` — inherited from `InsurancePolicyCoverage.CoverageType`; confirm it matches the `Claim.LossType`

Coverage mismatch check (gotcha #3): If `LossType = 'AutoCollision'` and the policy has no auto collision coverage, the `ClaimCoverage` creation will succeed but adjudication will result in denial. Validate at FNOL.

## FNOL OmniScript Design Pattern

Standard FNOL OmniScript structure (5 steps):

1. **Policy Search** — Integration Procedure queries `InsurancePolicy` by policy number or insured name. Returns policy status, coverage summary, and insured details.
2. **Loss Details** — Collects `DateOfLoss`, `LossType`, `LossDescription`, `LossLocation`. Validates date against policy effective/expiry dates.
3. **Claimant Verification** — Matches caller to `Contact` or `Account`. Creates new Contact if first-time claimant. Captures `ClaimParticipant` data.
4. **Coverage Confirmation** — Displays relevant `InsurancePolicyCoverage` records. User confirms which coverage to file against. Auto-populates `ClaimCoverage`.
5. **Review and Submit** — Summary screen. On confirm: creates `Claim`, `ClaimParticipant`(s), `ClaimCoverage`. Returns `ClaimNumber` to user.

## Field Validation Rules to Implement

| Rule | Object | Logic |
|---|---|---|
| Loss date cannot be in the future | `Claim` | `DateOfLoss > TODAY()` → error |
| Loss date cannot predate policy | `Claim` | `DateOfLoss < InsurancePolicy.EffectiveDate` → error |
| Claimant required before Open | `Claim` | Status = `Open` with no `ClaimParticipant` where `Role = 'Claimant'` → error |
| Coverage required before In Review | `Claim` | Status = `In Review` with no `ClaimCoverage` → error |
| Loss type must match coverage type | `ClaimCoverage` | `Claim.LossType` not in `InsurancePolicyCoverage.CoverageType` list → warning |

## Batch / Catastrophe FNOL

For catastrophe events (hurricane, wildfire, earthquake):
1. Use Bulk API 2.0 to create `Claim` records from a CSV with `ClaimChannel = 'Batch'`.
2. Do NOT create individual `ClaimParticipant` rows in the same batch — run as a second load after `Claim` IDs are returned.
3. Set `Status = 'New'` for all batch claims; let the routing flow handle queue assignment.
4. Tag batch claims with a custom `CatastropheCode__c` field for grouping and reporting.

## Common FNOL Errors

| Error | Likely cause | Fix |
|---|---|---|
| `FIELD_INTEGRITY_EXCEPTION: InsurancePolicyId` | Policy ID is null or references inactive policy | Verify policy is active before `Claim` creation |
| `REQUIRED_FIELD_MISSING: DateOfLoss` | OmniScript did not map the date field | Check `DateOfLoss` mapping in OmniScript DataMapper |
| `DUPLICATE_VALUE: ClaimNumber` | Manual `ClaimNumber` entry | Remove — it is auto-generated; never set manually |
| ClaimCoverage created but wrong coverage type | Coverage selected doesn't match loss type | Add coverage-type validation in step 4 of OmniScript |
