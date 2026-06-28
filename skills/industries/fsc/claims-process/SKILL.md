---
name: fsc-claims-process
description: >-
  Salesforce Financial Services Cloud (FSC) Claims process: end-to-end claims
  intake, adjudication, payment, and dispute lifecycle on core FSC objects.
  Use for any design, build, query, troubleshoot, migrate, automate, or audit
  task involving Claim, ClaimParticipant, ClaimCoverage, ClaimItem,
  ClaimBuildingItem, ClaimLifeEventItem, ClaimPolicyItem, ClaimVehicleItem,
  ClaimCase, ClaimParty, ClaimDocument, AssessmentIndicator,
  AssessmentTask, BusinessMilestone, FinancialDeal, InsurancePolicy,
  InsurancePolicyCoverage, InsurancePolicyParticipant, InsurancePolicyAsset,
  ClaimAction, ClaimPayment, ClaimReserve, ClaimAdjuster, or any FSC claims
  Flow, Apex trigger, OmniScript, Flexcard, or Integration Procedure. Do not
  drift to Health Cloud CarePlan, Revenue Cloud, or non-FSC insurance objects
  unless explicitly requested.
license: MIT
metadata:
  author: SkillForge / aCoE
  version: 1.0.0
  domain: salesforce-fsc
  module: claims-process
---

# Salesforce FSC Claims Process

You are helping with the **Claims** module of **Salesforce Financial Services Cloud (FSC)**. FSC Claims uses a combination of core FSC objects, OmniStudio (FlexCards, OmniScripts, Integration Procedures, DataMappers), standard Salesforce automation (Flows, Apex), and optionally Agentforce agents for triage and adjudication assistance.

This file is your routing layer. It contains the gotchas you must always remember and a map of when to load which reference. **Do not answer detailed claims questions from this file alone — load the right reference first.**

## Always-true gotchas (never forget these)

1. **`Claim` is the hub object — everything hangs off it.** `ClaimParticipant`, `ClaimCoverage`, `ClaimItem` (and its subtypes), `ClaimCase`, `ClaimDocument`, and `ClaimPayment` all have a master-detail or lookup to `Claim`. Never create child records before the parent `Claim` exists and has a valid `ClaimNumber`.

2. **`ClaimItem` has four subtype objects — choose the right one.** `ClaimBuildingItem` (property), `ClaimLifeEventItem` (life/disability), `ClaimPolicyItem` (general policy-level item), `ClaimVehicleItem` (auto). Each subtype has its own required fields. A `ClaimItem` without the right subtype row is incomplete.

3. **`InsurancePolicy` ≠ `Claim`.** The claim references a policy via `Claim.InsurancePolicyId`. You must resolve the policy and its coverages (`InsurancePolicyCoverage`) before you can populate `ClaimCoverage`. Never create a `ClaimCoverage` record without a matching `InsurancePolicyCoverage` parent.

4. **Status lifecycle is strict and drives automation.** Standard FSC claim statuses: `New` → `Open` → `In Review` → `Pending Payment` → `Closed` / `Denied` / `Withdrawn`. Flows and validation rules fire on status transitions. Skipping a status (e.g., moving from `New` directly to `Closed`) will break downstream automation.

5. **Reserves must be set before payments.** `ClaimReserve` establishes the financial ceiling per coverage line. Attempting to post a `ClaimPayment` that exceeds the reserve without adjusting it first will trigger a validation error on compliant implementations. Always check `ClaimReserve.ReserveAmount` against `ClaimPayment.Amount`.

6. **`ClaimParticipant` roles are picklist-controlled and matter.** Key roles: `Claimant`, `Insured`, `Adjuster`, `Witness`, `ThirdPartyClaimant`, `Attorney`, `MedicalProvider`. Role drives the fields that become required and the automations that fire. A claim with no `Adjuster` participant will never route to an adjuster queue.

7. **OmniStudio is the primary UI layer for FSC Claims.** FlexCards render claim summaries and policy panels. OmniScripts drive intake and adjudication workflows. Integration Procedures handle external system calls (e.g., ISO ClaimSearch, Verisk, Mitchell). DataMappers normalize payload shapes. Do not suggest building claim intake as a plain LWC unless OmniStudio is explicitly unavailable.

8. **`ClaimDocument` uses Salesforce Files (ContentDocument / ContentVersion), not Attachments.** Always use `ContentDocumentLink` with `LinkedEntityId = ClaimId` to attach documents. Never use the deprecated `Attachment` object for new FSC Claims implementations.

9. **`AssessmentTask` and `AssessmentIndicator` power AI-assisted triage.** These objects feed Agentforce models for fraud scoring, STP (straight-through processing) eligibility, and severity classification. They are not legacy Survey objects — do not confuse them.

10. **FSC permission sets stack — do not grant everything via profiles.** Key permission sets: `FSCInsurance`, `FSCInsuranceClaims`, `OmniStudioUser`, `OmniStudioAdmin`. Compose via permission set groups. Claims users need `FSCInsuranceClaims` at minimum; adjusters need it plus the right queue membership.

11. **`ClaimAction` is the audit log, not a task.** `ClaimAction` records capture every adjudication decision (approve, deny, request info, escalate, settle). Do not replace `ClaimAction` with `Task` or `CaseComment` — it exists specifically for regulatory audit trail requirements.

12. **API version matters.** Core FSC Claims objects appear from API v50.0+. `ClaimReserve` and `ClaimPayment` in their current form require v54.0+. `AssessmentIndicator` and AI-triage integrations require v58.0+. Verify before assuming a field or object exists in the target org.

## When to load which reference

Read **only** the reference(s) relevant to the current task. Each reference is self-contained.

| User intent | Load |
|---|---|
| "How does FSC Claims work?", overall architecture, module boundaries | `references/01-architecture.md` |
| Edition, licenses, permission sets, queues, profiles, named credentials | `references/02-setup-and-permissions.md` |
| Claim intake — FNOL, intake OmniScript, required fields, claimant capture | `references/03-fnol-and-intake.md` |
| Policy lookup, coverage validation, linking claim to policy | `references/04-policy-and-coverage.md` |
| ClaimItem subtypes — property, auto, life/disability, policy-level | `references/05-claim-items.md` |
| Adjudication workflow — assignment, review, decisions, ClaimAction | `references/06-adjudication.md` |
| Reserves and payments — ClaimReserve, ClaimPayment, financial controls | `references/07-reserves-and-payments.md` |
| Fraud detection, STP, AssessmentTask, AssessmentIndicator, Agentforce triage | `references/08-fraud-and-triage.md` |
| Documents — ContentDocument, ClaimDocument, e-signature, attachments | `references/09-documents.md` |
| OmniStudio components — FlexCards, OmniScripts, Integration Procedures | `references/10-omnistudio.md` |
| Field-level lookup for ANY claims object | `references/11-object-reference.md` |
| Data migration — load order, CSV shapes, sandbox seeding, dependencies | `references/12-data-migration.md` |

When the user's question spans multiple areas, load multiple references — but only the ones needed.

## Standard workflows

### Workflow A — First Notice of Loss (FNOL) to Open Claim

1. Validate the caller's identity and policy. Load `references/04-policy-and-coverage.md` to confirm `InsurancePolicy` is active and the `InsurancePolicyCoverage` exists.
2. Create the `Claim` record: set `InsurancePolicyId`, `LossDate`, `LossDescription`, `LossType`, `LossLocation` (if applicable), `Status = 'New'`. System generates `ClaimNumber`.
3. Create `ClaimParticipant` rows: `Claimant` (required), `Insured` (if different), and `Adjuster` (can be set later by queue routing).
4. Create at least one `ClaimCoverage` record linking to the relevant `InsurancePolicyCoverage`.
5. Attach FNOL documents via `ContentDocumentLink`. Load `references/09-documents.md`.
6. Transition `Status` → `'Open'`. This triggers the adjuster assignment flow.
7. Set initial `ClaimReserve` per coverage line. Load `references/07-reserves-and-payments.md`.

Detail in `references/03-fnol-and-intake.md`.

### Workflow B — Adjudication to Decision

1. Adjuster reviews claim: loads policy details, coverage limits, and claimant history.
2. Requests additional info if needed — creates `ClaimAction` with `ActionType = 'RequestInformation'`, sends notification.
3. Orders inspection/appraisal — creates `AssessmentTask` records. If AI triage is enabled, `AssessmentIndicator` records are auto-created. Load `references/08-fraud-and-triage.md`.
4. Updates `ClaimItem` subtypes with damage amounts or estimates.
5. Creates `ClaimAction` with final decision: `'Approve'`, `'Deny'`, or `'PartialApprove'`.
6. Transitions `Status` → `'Pending Payment'` (if approved) or `'Denied'`.

Detail in `references/06-adjudication.md`.

### Workflow C — Payment and Closure

1. Verify `ClaimReserve.ReserveAmount` covers the intended payment amount.
2. Create `ClaimPayment` record: set `ClaimId`, `ClaimCoverageId`, `Amount`, `PaymentMethod`, `PayeeId`, `PaymentStatus = 'Pending'`.
3. Integration Procedure or external call posts payment to financial system.
4. Update `ClaimPayment.PaymentStatus` → `'Issued'` on success, `'Failed'` on rejection.
5. On all payments issued: transition `Claim.Status` → `'Closed'`. Create `ClaimAction` with `ActionType = 'Close'`.
6. Release remaining reserves: update `ClaimReserve.ReserveAmount` to actual paid amount.

Detail in `references/07-reserves-and-payments.md`.

### Workflow D — Dispute and Reopening

1. Claimant submits dispute. Create new `ClaimCase` linked to `Claim` with `CaseType = 'Dispute'`.
2. Transition `Claim.Status` → `'In Review'` (reopen). Create `ClaimAction` with `ActionType = 'Reopen'`.
3. Adjuster re-examines. New `AssessmentTask` records if re-inspection needed.
4. Resolution: `ClaimAction` with `ActionType = 'Settle'` or `'DenyDispute'`.
5. Re-close or escalate to litigation.

Detail in `references/06-adjudication.md`.

### Workflow E — Straight-Through Processing (STP) for Low-Complexity Claims

1. FNOL intake triggers `AssessmentTask` for STP eligibility check.
2. `AssessmentIndicator` records score: loss amount, claimant history, coverage type, fraud signals.
3. If all indicators pass threshold: auto-approve — create `ClaimAction` (system actor), set reserve, create `ClaimPayment` without human adjuster touch.
4. Notify claimant via OmniScript-driven messaging.
5. Close claim automatically.

Detail in `references/08-fraud-and-triage.md`.

## Available scripts

Shell scripts in `scripts/` use the Salesforce CLI (`sf`) authenticated to a target org. Use them when inspecting real org data.

- **`scripts/describe-claims-objects.sh`** — Describes all FSC Claims objects and writes schemas to `claims-describe/`. Run before migration or any API-version-sensitive work.
- **`scripts/query-claim-lifecycle.sh`** — Given a `ClaimId` or `ClaimNumber`, prints the full claim record, participants, coverages, items, reserves, payments, documents, and action history in order.
- **`scripts/check-claims-config.sh`** — Validates org setup: FSC license presence, required permission sets, OmniStudio package version, FlexCard/OmniScript deployments, queue configuration.
- **`scripts/seed-test-claims.sh`** — Creates a minimal set of test claims with all required child records in a sandbox org. Useful for smoke-testing new deployments.

## Things this skill explicitly does NOT cover

- **Health Cloud CarePlan** — separate module; do not conflate `CarePlan` with `ClaimCase`.
- **Revenue Cloud / CPQ pricing** — claim settlement amounts are not product prices.
- **Financial Services Cloud Wealth / Banking** — different FSC domains (`FinancialAccount`, `ReferralStage`).
- **Salesforce Health Cloud insurance** — Health Cloud has its own insurance objects distinct from FSC Insurance Claims.
- **Document generation (Conga, Nintex, SF DocGen)** — document content generation is outside scope; this skill covers `ClaimDocument` metadata, not template rendering.

If the user crosses into any of these, say so and stop rather than improvising an answer.
