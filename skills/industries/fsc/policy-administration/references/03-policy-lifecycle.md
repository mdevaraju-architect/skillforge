# FSC Insurance Policy Administration — Policy Lifecycle

## Overview

The FSC Insurance policy lifecycle spans six distinct phases: Application, Underwriting/Quote, Issuance, Active Management, Renewal, and Termination (Cancellation, Lapse, or Expiry). Each phase maps to one or more `InsurancePolicy.Status` values and generates one or more `PolicyTransaction` records.

---

## Phase 1 — Application and Quote

### Status values: `Draft`, `Quoted`

**Creating the application (`Draft`):**

Required fields at creation:
- `PolicyName` — if blank, the system auto-generates a policy number using the sequence defined in `FSCInsurancePolicySettings__c.PolicyNumberFormat__c`.
- `PolicyType` — `Individual`, `Group`, or `Blanket`.
- `ProductId` — links to the `Product2` record representing the insurance product line.
- `OwnerId` — the servicing agent User or the Issuance Queue.
- `PolicyEffectiveDate` — must be today or a future date.
- `PolicyExpirationDate` — must be after `PolicyEffectiveDate`.
- `PrimaryInsuredId` — required for `PolicyType = 'Individual'`.

**Transitioning to `Quoted`:**

A quote is valid when all `InsurancePolicyCoverage` records have non-null `PremiumAmount`. The standard FSC validation rule `IP_QuoteRequiresPremium` blocks the `Quoted` transition if any coverage has a null or zero premium. Premium is typically populated by a call to the external rating engine (see `references/05-integrations-and-documents.md`).

---

## Phase 2 — Underwriting Review

### Status value: `InReview`

The policy transitions from `Quoted` to `InReview` when submitted for underwriting. During this phase:
- `InsurancePolicyDocument` records for applications, inspection reports, and MVR (motor vehicle records) are attached.
- An underwriter may reject (`Status → Draft` with a `PolicyTransaction.TransactionType = 'UnderwritingDecline'`) or approve.
- Approval transitions to `Active`.

---

## Phase 3 — Issuance: Full Checklist

Before transitioning `InsurancePolicy.Status` from `Quoted` or `InReview` to `Active`, verify every item:

| # | Check | Field / Object |
|---|---|---|
| 1 | Policy effective date is today or future | `InsurancePolicy.PolicyEffectiveDate` |
| 2 | Policy expiration date is after effective date | `InsurancePolicy.PolicyExpirationDate` |
| 3 | At least one `InsurancePolicyCoverage` record exists | Child query |
| 4 | All coverages have non-null, non-zero `PremiumAmount` | `InsurancePolicyCoverage.PremiumAmount` |
| 5 | All coverages have non-null `CoverageAmount` | `InsurancePolicyCoverage.CoverageAmount` |
| 6 | All coverages have `CoverageEndDate` populated | `InsurancePolicyCoverage.CoverageEndDate` |
| 7 | At least one `InsurancePolicyParticipant` with `Role = 'PolicyHolder'` | Child query |
| 8 | Exactly one `PolicyHolder` participant (no duplicates) | Validation rule `IPP_SinglePolicyHolder` |
| 9 | `BillingAccountId` is non-null (if setting enabled) | `InsurancePolicy.BillingAccountId` |
| 10 | `ProductId` is non-null | `InsurancePolicy.ProductId` |
| 11 | For `PolicyType = 'Group'`: at least one `InsurancePolicyMemberPlan` | Child query |
| 12 | For vehicle policies: `InsurancePolicyAsset` with `VIN` populated exists on auto coverages | Child query on coverage |
| 13 | `PolicyTransaction` with `TransactionType = 'NewBusiness'` will be created on activation | Trigger/Flow |
| 14 | Policy document (declarations page) generated and attached | `InsurancePolicyDocument.DocumentType = 'PolicyDeclarations'` |

Create the `PolicyTransaction` record in the same transaction as the status change. Do not create it in a separate DML operation — this risks the audit record being orphaned if the status update fails.

---

## Phase 4 — Active Policy Management

### Status value: `Active`

During the active phase, the policy can receive:
- **Endorsements** — mid-term changes (see Workflow 2 in SKILL.md and the endorsement section below).
- **Premium notices** — triggered by the `BillingAccount` billing cycle integration.
- **Inspections / loss control surveys** — attached via `InsurancePolicyDocument`.
- **Coverage inquiries** — agent reads `InsurancePolicyCoverage` fields; no status change required.

---

## Phase 5 — Renewal Processing

### Status transition: `Active` → `Expired` (existing) + new `InsurancePolicy` with `Status = 'Active'`

Renewal creates a **new** `InsurancePolicy` record. It does NOT update `PolicyExpirationDate` on the existing record.

**Renewal record requirements:**
- `PriorPolicyId` = the expiring policy's `Id`.
- `PolicyEffectiveDate` = day after expiring policy's `PolicyExpirationDate`.
- `PolicyExpirationDate` = one term after the new `PolicyEffectiveDate`.
- `PolicyName` = new auto-generated number (or carrier assigns a renewal suffix, e.g., `POL-00042-R1`).
- All `InsurancePolicyCoverage` records copied from the prior policy (with updated dates and potentially new premiums from the rating engine).
- `PolicyTransaction.TransactionType = 'Renewal'` created on the **new** policy.

**Expiring the prior policy:**
- After the renewal record is active, update the expiring policy: `Status = 'Expired'`. Do not set `CancellationEffectiveDate` or `CancellationReason` — these fields are for cancellations only, not natural expiry.
- A scheduled Apex batch or scheduled Flow should handle this automatically on `PolicyExpirationDate`.

**Auto-renewal vs. manual renewal:**
- If `FSCInsurancePolicySettings__c.AutoRenewalEnabled__c = true` and the product supports it, a scheduled Flow triggers renewal 30 days before expiry.
- Manual renewal requires the agent or underwriter to initiate the new policy record.

---

## Phase 6 — Cancellation Types and Calculations

### Flat Cancellation

**Definition:** Policy cancelled as if it never took effect. Full return of premium.

**When used:** Policy issued in error, payment not received before inception, applicant withdrew before coverage began.

**`PolicyTransaction` fields:**
- `TransactionType = 'Cancellation'`
- `TransactionAmount = -(full premium paid)` (negative = return to insured)
- `TransactionEffectiveDate = PolicyEffectiveDate` (back-dated to inception)

### Pro-Rata Cancellation

**Definition:** Return of premium proportional to unused coverage days. Used when insurer initiates cancellation (e.g., non-renewal, underwriting grounds).

**Formula:**
```
UnusedDays = PolicyExpirationDate - CancellationEffectiveDate
TotalDays  = PolicyExpirationDate - PolicyEffectiveDate
ReturnPremium = AnnualPremium × (UnusedDays / TotalDays)
```

**`PolicyTransaction` fields:**
- `TransactionType = 'Cancellation'`
- `TransactionAmount = -(ReturnPremium)`
- `TransactionEffectiveDate = CancellationEffectiveDate`

### Short-Rate Cancellation

**Definition:** Return of premium with a penalty applied because the insured initiated cancellation mid-term. The penalty compensates the insurer for setup costs.

**Formula (standard short-rate table varies by jurisdiction; simplified):**
```
EarnedPremium = AnnualPremium × ShortRateFactor(ElapsedDays / TotalDays)
ReturnPremium = AnnualPremium - EarnedPremium
```

`ShortRateFactor` is typically 10–25% higher than the pro-rata earned percentage. Store the factor table in a custom metadata type `FSCInsuranceShortRateTable__mdt` keyed on `(PolicyType, ElapsedDaysBucket)`.

**`PolicyTransaction` fields:**
- `TransactionType = 'Cancellation'`
- `TransactionAmount = -(ReturnPremium)` (smaller than pro-rata return)
- `TransactionEffectiveDate = CancellationEffectiveDate`

---

## Phase 7 — Lapse and Grace Period

**Lapse** occurs when a premium payment is missed and the grace period expires without payment. The `BillingAccount` integration sends a lapse event via Platform Event `FSC_PolicyLapsedEvent__e`.

On receipt of the Platform Event:
1. Transition `InsurancePolicy.Status = 'Lapsed'`.
2. Create `PolicyTransaction.TransactionType = 'Lapse'`.
3. Suspend all new `InsurancePolicyCoverage` records (set child `Status = 'Suspended'`).
4. Start the reinstatement eligibility clock.

Grace period length is stored in `FSCInsuranceBillingSettings__c.GracePeriodDays__c` (default: 30 days). Do not hardcode 30 days in Apex.

---

## Phase 8 — Reinstatement Rules

A lapsed or cancelled policy is eligible for reinstatement if **all** of the following are true:

1. `CancellationReason` is `NonPayment` or `CustomerRequest` (not `UnderwritingDecline` or `Misrepresentation`).
2. The calendar days since `CancellationEffectiveDate` (or lapse date) is within the jurisdiction's reinstatement window. Default: 180 days. Stored in `FSCInsurancePolicySettings__c.ReinstatementWindowDays__c`.
3. Outstanding premium (including any lapse-period premium) is paid in full.
4. Underwriting review is completed if the lapse was longer than 30 days (configurable in `FSCInsurancePolicySettings__c.ReinstatementUnderwritingThresholdDays__c`).
5. `PolicyExpirationDate` is still in the future. If the expiration date has passed, a new policy (renewal) must be issued, not a reinstatement.

**Reinstatement execution:**
1. Verify eligibility (checklist above).
2. Set `InsurancePolicy.Status = 'Reinstatement'` (transitory FSC status).
3. Create `PolicyTransaction.TransactionType = 'Reinstatement'`.
4. Collect outstanding premium and update `BillingAccount` balance.
5. Reactivate suspended `InsurancePolicyCoverage` records (set child `Status = 'Active'`).
6. Transition `InsurancePolicy.Status = 'Active'`.
7. Attach reinstatement notice via `InsurancePolicyDocument.DocumentType = 'ReinstatementNotice'`.

**Validation rules to implement:**

```apex
// Block reinstatement if expiration date has passed
IF(
  AND(
    OR(Status = 'Lapsed', Status = 'Cancelled'),
    PolicyExpirationDate < TODAY()
  ),
  'Policy has expired. A new policy must be issued rather than reinstated.',
  null
)

// Block reinstatement if UnderwritingDecline cancellation
IF(
  AND(
    Status = 'Cancelled',
    CancellationReason = 'UnderwritingDecline'
  ),
  'Policies cancelled for underwriting reasons cannot be reinstated through self-service. Contact underwriting.',
  null
)
```

---

## Validation Rules to Implement on InsurancePolicy

Beyond the FSC-delivered rules, implement these custom validation rules:

| Rule Name | Fires On | Formula |
|---|---|---|
| `IP_EffectiveDateNotPast` | Insert/Edit when `Status = 'Active'` | `PolicyEffectiveDate < TODAY()` (blocks back-dating activation) |
| `IP_ExpirationAfterEffective` | Insert/Edit | `PolicyExpirationDate <= PolicyEffectiveDate` |
| `IP_CancellationDateRequired` | Edit when `Status = 'PendingCancellation'` | `ISBLANK(CancellationEffectiveDate)` |
| `IP_CancellationReasonRequired` | Edit when `Status = 'PendingCancellation'` | `ISBLANK(CancellationReason)` |
| `IP_RenewalRequiresPriorPolicy` | Insert when `PolicyTransaction.TransactionType = 'Renewal'` | Enforced in Apex trigger, not formula rule |
| `IP_GroupRequiresMemberPlan` | Status change to `Active` when `PolicyType = 'Group'` | Enforced in Apex trigger |
