# Fraud Detection, STP, and AI Triage

## Objects Used

| Object | Purpose |
|---|---|
| `AssessmentTask` | Work items for investigation: inspection orders, document requests, ISO queries |
| `AssessmentIndicator` | Scored signals from rules or AI: fraud probability, STP eligibility, severity class |

These are FSC-native objects, not legacy Survey or Task objects. Do not substitute `Task` for `AssessmentTask`.

## Straight-Through Processing (STP)

STP automatically approves and pays low-complexity claims without adjuster touch. Eligibility is determined by a set of configurable indicators.

### STP Eligibility Criteria (configure in `ClaimsSTPRules__mdt`)

Typical rules:
- `LossAmount < $2,500`
- `Claim.LossType IN ('AutoComprehensive', 'PropertyContents')`
- `ClaimParticipant (Claimant).ClaimHistory__c = 0` (no prior claims in last 3 years)
- `InsurancePolicyCoverage.CoverageType != 'Liability'` (liability excluded from STP)
- All `AssessmentIndicator.FraudScore__c < 30` (configurable threshold)
- No `ClaimBuildingItem.IsTotalLoss = true`
- Claimant identity verified (KYC check passed)

### STP Flow Pattern

```
Trigger: Claim.Status transitions to 'Open'
  → Create AssessmentTask (STPEligibilityCheck)
  → Integration Procedure: evaluate all ClaimsSTPRules__mdt rules
  → For each rule, create AssessmentIndicator:
      AssessmentIndicator.IndicatorType = rule name
      AssessmentIndicator.Score = 0 (pass) or 1 (fail)
      AssessmentIndicator.Result = 'Pass' / 'Fail'
  → IF all indicators pass:
      Create ClaimAction(STPApprove, ActorId = STPSystemUser)
      Set ClaimReserve, create ClaimPayment(Pending)
      Transition Claim.Status = 'Pending Payment'
      Trigger payment Integration Procedure
  → ELSE:
      Route to adjuster queue (standard adjudication)
```

## `AssessmentTask`

| Field | API Name | Notes |
|---|---|---|
| Claim | `ClaimId` | Parent claim |
| Task Type | `AssessmentTaskType` | `Inspection`, `Appraisal`, `STPCheck`, `FraudReview`, `ISOQuery`, `DocumentRequest` |
| Assignee | `AssigneeId` | User, queue, or external vendor |
| Due Date | `DueDate` | SLA-driven; source from `ClaimsRouting__mdt` |
| Status | `Status` | `Pending`, `InProgress`, `Completed`, `Cancelled` |
| Result | `Result` | `Pass`, `Fail`, `Inconclusive` |
| Notes | `Notes` | Investigation findings |

## `AssessmentIndicator`

| Field | API Name | Notes |
|---|---|---|
| Assessment Task | `AssessmentTaskId` | Parent task |
| Claim | `ClaimId` | For direct claim-level indicators |
| Indicator Type | `IndicatorType` | Named rule or ML model signal |
| Score | `Score` | Numeric (0–100); 0 = low risk |
| Result | `Result` | `Pass`, `Fail`, `Review` |
| Confidence | `Confidence` | ML model confidence 0.0–1.0 |
| Source | `Source` | `Rules`, `EinsteinML`, `ISOClaimSearch`, `Verisk` |

## Fraud Detection Signals

Common `AssessmentIndicator` types for fraud detection:

| Indicator | High-risk signal |
|---|---|
| `ClaimFrequency` | > 2 claims in 12 months |
| `RecentPolicyInception` | Policy < 30 days old at time of loss |
| `LossAmountRounding` | Loss amount is round number (e.g., exactly $5,000) |
| `MultipleVehicleClaims` | Same VIN claimed more than once |
| `ISOHit` | ISO ClaimSearch returns prior matching claim |
| `InconsistentStatement` | Claimant statement contradicts police/fire report |
| `LateNotice` | Claim filed > 30 days after loss |
| `HighValueContents` | Contents claim > 80% of dwelling coverage limit |
| `RepresentedByAttorney` | Attorney involved on first contact (property/auto) |

## ISO ClaimSearch Integration

ISO ClaimSearch is the industry database for prior claims history. Query via Integration Procedure:

```
Input: { VIN or PropertyAddress, ClaimantSSN or Name+DOB }
Named Credential: ISO_ClaimSearch
Output: { hitFound: boolean, priorClaims: [{ date, type, amount, outcome }] }
```

On `hitFound = true`:
1. Create `AssessmentIndicator(ISOHit, Result='Fail', Source='ISOClaimSearch')`.
2. Create `AssessmentTask(FraudReview)` and assign to SIU queue.
3. Do NOT automatically deny — SIU must review.

## Agentforce AI Triage

Agentforce can assist with:
- **Initial severity classification**: analyzing loss description text → recommended `DamageType` and `AssessmentTaskType`
- **Document completeness check**: verifying required documents are attached before adjudication
- **Fraud signal summarization**: summarizing `AssessmentIndicator` records into adjuster briefing
- **Customer communication**: handling status inquiries via chat without adjuster involvement

Agentforce actions for claims:
- `GetClaimStatus` — reads `Claim` status and returns human-readable summary
- `RequestMissingDocuments` — creates `AssessmentTask(DocumentRequest)` and sends notification
- `EscalateToAdjuster` — creates `ClaimAction(Escalate)` and transfers conversation
- `SummarizeFraudSignals` — aggregates `AssessmentIndicator` records into readable brief

## SIU Workflow

When fraud is suspected (any `AssessmentIndicator.Result = 'Fail'` with `Source = 'ISOClaimSearch'` or `FraudScore > 70`):

1. Auto-create `AssessmentTask(FraudReview)` assigned to SIU queue.
2. Create `ClaimAction(Escalate, ActionNotes = 'SIU Referral')`.
3. Freeze claim in `'In Review'` status — no payment until SIU concludes.
4. SIU adjudicates: `ClaimAction(Approve)`, `ClaimAction(Deny)`, or `ClaimAction(Settle)`.
5. If denied for fraud: create regulatory referral record (custom object or external system).
