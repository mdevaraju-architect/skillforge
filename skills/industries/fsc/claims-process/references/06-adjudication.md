# Adjudication Workflow

## What Adjudication Covers

Adjudication is the investigation and decision phase: from claim assignment through final approve/deny/settle decision. Every decision must be recorded as a `ClaimAction` for regulatory audit trail compliance.

## `ClaimAction` — The Audit Record

`ClaimAction` is not a task or activity. It is the official adjudication record. Every significant decision or action creates a `ClaimAction`.

| Field | API Name | Notes |
|---|---|---|
| Claim | `ClaimId` | Parent claim |
| Action Type | `ActionType` | See picklist below |
| Action Date | `ActionDate` | Date/time action taken |
| Actor | `ActorId` | User who took the action (or system user for automated actions) |
| Notes | `ActionNotes` | Free text; include reasoning for decisions |
| Related Coverage | `ClaimCoverageId` | Link to specific coverage if action is coverage-scoped |
| Status Change | `PreviousStatus` / `NewStatus` | Capture before/after status |

Key `ActionType` picklist values:
| Value | When to use |
|---|---|
| `Assign` | Claim assigned to adjuster or queue |
| `RequestInformation` | Additional info requested from claimant or third party |
| `InspectionOrdered` | Physical inspection or appraisal ordered |
| `InspectionCompleted` | Inspection results received |
| `Approve` | Coverage confirmed; damage amount approved |
| `PartialApprove` | Part of the claim approved; remainder denied or disputed |
| `Deny` | Claim denied (specify reason in `ActionNotes`) |
| `Reopen` | Previously closed/denied claim reopened |
| `Settle` | Negotiated settlement reached |
| `DenyDispute` | Dispute reviewed and original decision upheld |
| `Escalate` | Escalated to supervisor, legal, or SIU |
| `Close` | Claim administratively closed after all payments issued |
| `STPApprove` | System-automated straight-through approval (no human touch) |

## Adjuster Assignment

Claims are routed to adjusters via queue. The assignment Flow should:
1. Read `Claim.LossType` → map to queue via `ClaimsRouting__mdt`.
2. Assign `Claim.OwnerId` = queue.
3. Create `ClaimParticipant` with `Role = 'Adjuster'` and `ParticipantId` = assigned user (once adjuster picks from queue).
4. Create `ClaimAction` with `ActionType = 'Assign'`.
5. Send notification to adjuster (use Custom Notification via Flow).

Never hard-code queue IDs in Apex. Always use `ClaimsRouting__mdt` or a queue name lookup.

## Adjudication OmniScript Design Pattern

Standard adjudication OmniScript (6 steps):

1. **Claim Summary** — FlexCard pulls `Claim`, `ClaimParticipant`, `ClaimCoverage`, `ClaimItem` data. Read-only review.
2. **Policy Verification** — Integration Procedure re-validates `InsurancePolicy` and `InsurancePolicyCoverage`. Flags coverage gaps.
3. **Damage Review** — Adjuster updates `ClaimItem` subtype fields (repair estimates, ACV, total loss flag).
4. **Assessment / Inspection** — If physical inspection needed: create `AssessmentTask`. View any existing `AssessmentIndicator` fraud/STP scores.
5. **Decision** — Adjuster selects `ActionType` (Approve / Deny / PartialApprove / RequestInformation). Enters `ActionNotes`.
6. **Confirm and Submit** — Creates `ClaimAction`; triggers status transition Flow.

## Status Transition Rules

Implement as a Record-Triggered Flow on `Claim`:

| From | To | Trigger | Validation |
|---|---|---|---|
| `New` | `Open` | Manual / FNOL completion | `ClaimParticipant` (Claimant) exists |
| `Open` | `In Review` | Adjuster requests info or starts investigation | `ClaimCoverage` exists |
| `Open` | `Pending Payment` | Approve action | `ClaimAction` with `ActionType=Approve` exists |
| `In Review` | `Pending Payment` | Approve after review | Same as above |
| `In Review` | `Denied` | Deny action | `ClaimAction` with `ActionType=Deny` and `ActionNotes` populated |
| `Pending Payment` | `Closed` | All payments issued | All `ClaimPayment.PaymentStatus = 'Issued'` |
| `Closed` | `In Review` | Reopen | `ClaimAction` with `ActionType=Reopen`; manager permission required |
| `Denied` | `In Review` | Dispute filed | `ClaimCase` with `CaseType=Dispute` exists |

## Denial Reasons — Enforce in `ActionNotes` or Custom Field

Standard denial reasons (consider a picklist on `ClaimAction`):
- `PolicyLapsed` — policy was not active at time of loss
- `ExclusionApplies` — loss type is excluded by policy terms
- `NoCoverage` — no matching `InsurancePolicyCoverage` for loss type
- `LateNotice` — claim filed after notice period expired
- `FraudSuspected` — SIU referral required
- `PreExistingDamage` — damage predates policy effective date
- `DuplicateClaim` — claim already filed and settled for this event
- `DeductibleNotMet` — loss amount does not exceed deductible

## Dispute and ClaimCase

When a claimant disputes a decision, create a `ClaimCase`:

Required fields:
- `ClaimId` — parent claim
- `CaseType` — `'Dispute'`
- `DisputeReason` — claimant's stated reason
- `DisputeDate` — date dispute was submitted
- `Status` — `'Open'`

On `ClaimCase` creation:
- Transition `Claim.Status` → `'In Review'`
- Create `ClaimAction` with `ActionType = 'Reopen'`
- Route `ClaimCase` to dispute queue

Resolution paths:
- `Settle` → negotiated settlement → `ClaimAction(Settle)` → update `ClaimPayment`
- `DenyDispute` → original decision upheld → `ClaimAction(DenyDispute)` → re-close claim
- `Escalate` → legal / arbitration → `ClaimAction(Escalate)` → external process begins

## SIU Referral

Special Investigations Unit referral when fraud suspected:
1. Create `ClaimAction` with `ActionType = 'Escalate'` and `ActionNotes` = 'SIU Referral: [reason]'.
2. Assign `Claim.OwnerId` = SIU queue.
3. Set `Claim.Status = 'In Review'` (do not deny until SIU concludes).
4. SIU creates additional `AssessmentTask` records for investigation.
5. SIU conclusion: `ClaimAction(Approve)`, `ClaimAction(Deny)`, or `ClaimAction(Settle)`.
