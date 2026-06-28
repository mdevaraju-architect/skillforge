# FSC Claims Architecture

Salesforce Financial Services Cloud Claims is built on core FSC objects, OmniStudio for UI and integration orchestration, Salesforce automation (Flows, Apex), and optionally Agentforce for AI-assisted triage and adjudication.

## Module Boundary

FSC Claims owns the end-to-end lifecycle from First Notice of Loss (FNOL) through payment and closure. Adjacent modules it interacts with but does not own:

| Adjacent module | Interaction point |
|---|---|
| FSC Insurance Policy (`InsurancePolicy`) | Claim references a policy; coverage validation reads from it |
| Salesforce Payments / External Billing | `ClaimPayment` triggers an outbound payment call |
| Salesforce Files | `ClaimDocument` → `ContentDocumentLink` → `ContentVersion` |
| Agentforce / Einstein | `AssessmentTask`, `AssessmentIndicator` feed AI scoring |
| OmniStudio | FlexCards for UI, OmniScripts for intake/adjudication, Integration Procedures for external calls |
| Case Management | `ClaimCase` is a specialised Case subtype for disputes and escalations |

## Core Object Map

```
InsurancePolicy
  │
  ├── InsurancePolicyCoverage (one per covered line)
  │     └── InsurancePolicyAsset (vehicle, property, person)
  │
  └── InsurancePolicyParticipant (named insured, beneficiaries)

Claim  ←──────────────────── central hub
  │
  ├── ClaimParticipant      (Claimant, Insured, Adjuster, Witness, …)
  ├── ClaimCoverage         (links Claim ↔ InsurancePolicyCoverage)
  │     └── ClaimReserve    (financial ceiling per coverage line)
  │           └── ClaimPayment  (actual disbursements)
  ├── ClaimItem             (abstract — always with a subtype row)
  │     ├── ClaimBuildingItem   (property damage)
  │     ├── ClaimVehicleItem    (auto damage)
  │     ├── ClaimLifeEventItem  (life / disability event)
  │     └── ClaimPolicyItem    (general policy-level item)
  ├── ClaimCase             (dispute, litigation, escalation)
  ├── ClaimDocument         (metadata wrapper → ContentDocumentLink)
  ├── ClaimAction           (adjudication decisions and audit trail)
  ├── AssessmentTask        (inspection, appraisal, investigation tasks)
  └── AssessmentIndicator   (AI/rules-based scoring signals)
```

## Status Lifecycle

```
New ──► Open ──► In Review ──► Pending Payment ──► Closed
                    │                                  ▲
                    ├──────────────────────────► Denied
                    └──────────────────────────► Withdrawn
```

Key automation triggers on status transitions:
- `New → Open`: adjuster assignment flow fires; initial reserve creation prompt.
- `Open → In Review`: escalation or additional-info request captured as `ClaimAction`.
- `In Review → Pending Payment`: payment workflow initiates; reserve sufficiency check runs.
- `Pending Payment → Closed`: all `ClaimPayment` records verified as `Issued`; reserve reconciliation.

## Technology Stack

```
User / Agent
    │
    ▼
OmniStudio FlexCards (claim summary panels, policy quick-view)
    │
OmniStudio OmniScripts (FNOL intake, adjudication wizard, payment confirmation)
    │
OmniStudio Integration Procedures + DataMappers
    │              │
    │         External systems: ISO ClaimSearch, Verisk, Mitchell,
    │         payment processors, document repositories
    │
Salesforce Platform
    ├── FSC Claims objects (Claim, ClaimParticipant, …)
    ├── Flows (status transitions, assignment, notifications)
    ├── Apex (complex validations, reserve enforcement, batch jobs)
    ├── Einstein / Agentforce (AssessmentTask, AssessmentIndicator)
    └── Salesforce Files (ContentDocument, ContentVersion)
```

## Data Flow: FNOL to Closure

1. **FNOL Intake**: OmniScript collects loss details → creates `Claim` + `ClaimParticipant` + `ClaimCoverage`.
2. **Policy Validation**: Integration Procedure queries `InsurancePolicy` + `InsurancePolicyCoverage`; verifies policy is active and coverage applies to loss type.
3. **Assignment**: Flow routes claim to adjuster queue based on `Claim.LossType`, `ClaimCoverage.CoverageType`, and `ClaimReserve.ReserveAmount` threshold.
4. **Investigation**: Adjuster creates `ClaimItem` subtypes with damage estimates, orders appraisals via `AssessmentTask`.
5. **AI Triage**: `AssessmentIndicator` records scored for STP eligibility and fraud signals.
6. **Decision**: `ClaimAction` records the adjudication decision. Status transitions accordingly.
7. **Payment**: `ClaimPayment` created; Integration Procedure calls payment system; status updated to `Issued`.
8. **Closure**: All payments issued → `Claim.Status = 'Closed'`; reserves reconciled; `ClaimAction` audit record created.

## FSC Claims Is Not Health Cloud, Revenue Cloud, or Legacy Policy Admin

- FSC Insurance Claims uses `Claim`, `ClaimParticipant`, `InsurancePolicy`, and related objects. These are FSC-specific objects, not generic Salesforce objects.
- Health Cloud has its own `CarePlan`, `ClinicalEncounterCode`, and care management objects. Do not conflate with claims.
- Revenue Cloud pricing objects (`ProductCatalog`, `PriceBook`, `Quote`) are unrelated to claim settlement amounts.
- Legacy policy administration systems (Guidewire, Duck Creek) may coexist via Integration Procedures — they are external, not Salesforce native objects.
