# Agent Design: Claims Triage Agent

## Problem statement

An adjuster or supervisor needs to quickly assess an incoming claim: is it STP-eligible (straight-through processing, no human needed), does it need an adjuster, or does it need SIU referral? Today this routing is manual and inconsistent. The Claims Triage Agent automates the initial assessment and routes accordingly.

## Scope

### What this agent does

- Retrieves a claim by number and summarises its current status, coverage, and key data points
- Evaluates STP eligibility against configured `ClaimsSTPRules__mdt` thresholds
- Assigns the claim to the appropriate queue (Auto, Property, Life, Dispute) based on type and coverage
- Surfaces fraud signal indicators from `AssessmentIndicator` records
- Summarises missing documents required for processing
- Requests missing documents from the claimant

### What this agent escalates to a human

- Claims where the SIU fraud score exceeds the configured threshold
- Coverage disputes or denial decisions (these require human judgment and regulatory risk)
- Claims involving fatalities or catastrophic loss over the reserve threshold
- Any claim the agent cannot classify with confidence

### What this agent refuses to do

- Approve or deny a claim
- Set reserve amounts
- Issue or void payments
- Provide legal advice or coverage interpretation to claimants
- Access claim data for a policy not associated with the authenticated session

## Topic design

| Topic | Description | Typical actions |
|---|---|---|
| GetClaimStatus | User asks for current claim status, summary, or timeline | GetClaimStatus action |
| TriageClaim | User asks agent to assess and route a new or unassigned claim | EvaluateSTPEligibility, AssignToQueue |
| RequestDocuments | User asks agent to request missing documents from claimant | RequestMissingDocuments |
| SummarizeFraudSignals | User asks for fraud indicators on a claim | SummarizeFraudSignals |
| EscalateToAdjuster | User asks agent to escalate claim to human adjuster | EscalateToAdjuster |

## Action inventory

| Action | Type | Source | Description |
|---|---|---|---|
| GetClaimStatus | Apex | `ClaimsTriageActions.getClaimStatus` | Returns Claim + ClaimParticipants + ClaimCoverage + status |
| EvaluateSTPEligibility | Flow | `ClaimSTPEvaluationFlow` | Checks claim against ClaimsSTPRules__mdt |
| AssignToQueue | Flow | `ClaimQueueAssignmentFlow` | Routes claim to appropriate queue |
| RequestMissingDocuments | Apex | `ClaimsTriageActions.requestDocuments` | Creates ClaimAction + sends notification |
| SummarizeFraudSignals | Prompt Template | `FraudSignalSummary_PT` | Grounds on AssessmentIndicator records, returns summary |
| EscalateToAdjuster | Flow | `ClaimEscalationFlow` | Creates ClaimAction (type: Escalation), assigns owner |

## Guardrails

- Always state "I cannot approve, deny, or set reserves for this claim" if asked to do so.
- Always include the claim number in every response.
- Never speculate on coverage interpretation — direct to the policy document or a human adjuster.
- Never share one claimant's information with another claimant in the same session.
- Always confirm the claim number before taking any routing action.

## Evaluation strategy

- Primary dimension: routing accuracy (does the agent route STP vs adjuster vs SIU correctly?)
- Edge case: claim with mixed coverage types, partial STP eligibility
- Edge case: claim number not found
- Regression criteria: agent must never approve or deny a claim; must always escalate fraud-flagged claims

## Known limitations

- Does not handle catastrophe event batch FNOL (multiple claims from one event)
- Reserve calculation is not surfaced — directs to adjuster
- Does not handle multi-party disputes in a single session

## Deployment notes

- Minimum API version: 63.0
- Required permission sets: FSCInsuranceClaims, OmniStudioUser
- Required connected apps: ClaimsTriageConnectedApp (JWT flow for headless)
- Approval tier: draft
