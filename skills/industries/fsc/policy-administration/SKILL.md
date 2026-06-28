---
name: industries-fsc-policy-administration
description: >-
  InsurancePolicy, InsurancePolicyCoverage, InsurancePolicyParticipant,
  InsurancePolicyAsset, InsurancePolicyBeneficiary, PolicyHolder,
  InsurancePolicyMemberPlan, FSC Insurance, policy issuance, policy renewal,
  policy endorsement, policy cancellation, policy reinstatement, premium,
  coverage, deductible, exclusion, policy lifecycle, policy search,
  InsurancePolicyDocument, BillingAccount, PolicyTransaction
compliance:
  regulations: ["FINRA", "SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "restricted"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: industries/fsc
  module: policy-administration
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# FSC Insurance — Policy Administration Skill

You are helping with the **Policy Administration** module of **Salesforce Financial Services Cloud (FSC) Insurance**. This skill covers the full lifecycle of an insurance policy from initial application through issuance, active management, endorsements, renewals, cancellations, and reinstatements.

This file is your routing layer. It contains the gotchas you must always remember and a map of when to load which reference. **Do not answer detailed policy questions from this file alone — load the right reference first.**

---

## Always-true gotchas — read before writing any code or SOQL

> These facts are commonly missed in FSC Insurance implementations. Apply every one of them before writing a single line of code, SOQL, or configuration.

1. **`InsurancePolicy` is the hub — every related object looks up to it.** `InsurancePolicyCoverage`, `InsurancePolicyParticipant`, `InsurancePolicyAsset`, `InsurancePolicyBeneficiary`, and `InsurancePolicyMemberPlan` all carry a lookup or master-detail to `InsurancePolicy`. Never create child records before the parent `InsurancePolicy` record exists with a valid `PolicyName` (the auto-generated policy number).

2. **`Status` is a restricted picklist — the exact API values are case-sensitive.** Valid values are `Draft`, `InReview`, `Quoted`, `Active`, `Cancelled`, `Lapsed`, `Expired`, `PendingCancellation`, and `Reinstatement`. The value `Active` (not `active`, not `ACTIVE`) is required before any `InsurancePolicyCoverage` record can be added with a non-null `CoverageStartDate` that falls in the past.

3. **`PolicyEffectiveDate` and `PolicyExpirationDate` drive everything downstream.** Premium calculations, coverage validity checks, renewal triggers, and cancellation pro-rata math all derive from these two fields. Both are required on `InsurancePolicy` before the record can transition to `Active`. Setting them on the wrong calendar (e.g., using `CreatedDate` as a proxy) corrupts every downstream calculation.

4. **`InsurancePolicyCoverage` requires `CoverageType`, `CoverageStartDate`, and `InsurancePolicyId` before save.** `CoverageEndDate` is not enforced on insert but must be populated before the policy can move to `Active`. `CoverageAmount` (the coverage limit) and `DeductibleAmount` are distinct numeric fields — do not store the deductible inside `CoverageAmount`.

5. **`InsurancePolicyParticipant` role values are picklist-controlled.** The FSC-delivered values are `PolicyHolder`, `Insured`, `Beneficiary`, `Agent`, `Broker`, `JointInsured`, `Payor`, and `Mortgagee`. A policy must have exactly one `PolicyHolder` participant. Attempting to save a second participant with `Role = 'PolicyHolder'` will trigger the standard FSC validation rule `IPP_SinglePolicyHolder`.

6. **`PrimaryInsuredId` on `InsurancePolicy` is a lookup to `Account`, not `Contact`.** FSC Insurance uses Person Accounts for individuals. If your org uses a Contact-based model, `PrimaryInsuredId` will be null and participant records must carry the Contact reference through `InsurancePolicyParticipant.InsuredId`. These are two different relationship patterns — choose one architecture and enforce it consistently.

7. **Cancellation reason codes live in a custom metadata type, not a picklist.** `InsurancePolicy.CancellationReason` stores a string; the allowed values are governed by `FSCInsuranceCancellationReason__mdt`. If you need to add a new cancellation reason (e.g., `NonPayment`, `UnderwritingDecline`), add the record to the custom metadata type first — a picklist edit alone will not make the reason available to FSC validation logic.

8. **`InsurancePolicyDocument` is a metadata wrapper — the file bytes live on `ContentVersion`.** Attach documents via `ContentDocumentLink` with `LinkedEntityId = InsurancePolicyId`. The `InsurancePolicyDocument` record holds classification fields (`DocumentType`, `DocumentSubType`, `IsDeliveredElectronically`). Never use the deprecated `Attachment` object for new FSC policy implementations.

9. **`InsurancePolicyAsset` links an insured asset to a specific `InsurancePolicyCoverage`, not directly to `InsurancePolicy`.** The lookup chain is `InsurancePolicyAsset.InsurancePolicyCoverageId → InsurancePolicyCoverage.InsurancePolicyId`. An asset lookup that points only to the policy header and skips coverage will fail FSC asset validation in Summer '25 and later.

10. **Endorsement (mid-term change) creates a new effective-dated row, not an update to the existing record.** The FSC pattern is to set `InsurancePolicy.PolicyEndorsementDate` and create a `PolicyTransaction` record with `TransactionType = 'Endorsement'`. Directly editing the base policy fields without a `PolicyTransaction` audit record breaks the regulatory change history and will fail SOC 2 audit assertions.

11. **`BillingAccountId` on `InsurancePolicy` is a lookup to `BillingAccount`, which is a separate FSC object.** `BillingAccount` is not a standard `Account` — it is the FSC billing entity tied to payment method and billing cycle. A policy cannot be transitioned to `Active` if `BillingAccountId` is null and the `FSCInsurance` setting `RequireBillingAccountForActivation` is enabled (default: on in production orgs).

12. **Renewal creates a new `InsurancePolicy` record — it does not extend `PolicyExpirationDate` in place.** The renewal record carries `PriorPolicyId` pointing back to the expiring policy. The expiring policy's `Status` transitions to `Expired`, not `Renewed`. Queries that look for "current" policies by navigating `PriorPolicyId` chains must handle multi-year renewal chains; a simple `Status = 'Active'` filter is insufficient without also checking `PolicyExpirationDate > TODAY`.

13. **`InsurancePolicyMemberPlan` is required for group or employer-sponsored policies.** For individual policies, this object is not used and should not be created. Attempting to add `InsurancePolicyMemberPlan` records to a policy with `PolicyType = 'Individual'` will fail the FSC validation `MemberPlanNotAllowedForIndividual`. For group policies (`PolicyType = 'Group'`), at least one member plan must exist before the policy can be marked `Active`.

14. **FSC Insurance permission sets stack — profiles alone are not sufficient.** The minimum permission set for policy administration is `FSCInsurance`. Users who manage billing also need `FSCInsuranceBilling`. Agents who service policies need `FSCInsuranceAgent`. Granting all via a single profile is not supported and causes FLS failures on fields such as `InsurancePolicyCoverage.PremiumAmount`.

---

## When to load a reference

Load only the reference(s) relevant to the current task. Each reference is self-contained.

| User intent | Load |
|---|---|
| "How does FSC Insurance policy administration work?", object model overview, hub-and-spoke diagram, status lifecycle | `references/01-architecture.md` |
| Permission sets, FSC feature enablement, FLS, queue configuration, custom metadata setup, Named Credentials | `references/02-setup-and-permissions.md` |
| Policy application, quote-to-issue workflow, issuance checklist, renewal logic, cancellation types, reinstatement rules, lapse handling | `references/03-policy-lifecycle.md` |
| InsurancePolicyCoverage (types, limits, deductibles, exclusions), InsurancePolicyParticipant roles, InsurancePolicyAsset, InsurancePolicyBeneficiary | `references/04-coverage-and-participants.md` |
| Rating engine integration, PAS integration, InsurancePolicyDocument, ContentDocumentLink, e-delivery, Platform Events, outbound messaging, Named Credential patterns | `references/05-integrations-and-documents.md` |

When the user's question spans multiple areas, load multiple references — but only the ones needed.

---

## Standard workflows

### Workflow 1 — Policy Issuance: Quote to Active

1. **Application/Quote creation.** Create `InsurancePolicy` with `Status = 'Draft'` or `Status = 'Quoted'`. Populate `PolicyName`, `PolicyType`, `PolicyEffectiveDate`, `PolicyExpirationDate`, `PrimaryInsuredId`, `OwnerId` (servicing agent). Load `references/03-policy-lifecycle.md` for required field checklist.
2. **Coverage setup.** Create one `InsurancePolicyCoverage` record per covered line. Required fields: `InsurancePolicyId`, `CoverageType`, `CoverageStartDate`, `CoverageEndDate`, `CoverageAmount`, `DeductibleAmount`, `PremiumAmount`. Load `references/04-coverage-and-participants.md`.
3. **Participant setup.** Create `InsurancePolicyParticipant` records. Minimum: one `PolicyHolder`. Add `Insured` if different from holder. Add `Agent` or `Broker` as applicable. Validate no duplicate `PolicyHolder`. Load `references/04-coverage-and-participants.md`.
4. **Asset linking (property/auto/life).** If coverage applies to a specific asset, create `InsurancePolicyAsset` linked to the relevant `InsurancePolicyCoverage`. Load `references/04-coverage-and-participants.md`.
5. **Billing account association.** Set `InsurancePolicy.BillingAccountId`. If no `BillingAccount` exists, create one with `BillingAccountType` matching the payment method. Load `references/02-setup-and-permissions.md` for setup context.
6. **Underwriting review.** Transition `Status = 'InReview'`. Attach underwriting documents via `ContentDocumentLink` and `InsurancePolicyDocument`. Load `references/05-integrations-and-documents.md`.
7. **Policy activation.** Validate all checklist items (see `references/03-policy-lifecycle.md`). Transition `Status = 'Active'`. Create `PolicyTransaction` with `TransactionType = 'NewBusiness'`. Trigger policy document generation and e-delivery.

### Workflow 2 — Policy Endorsement (Mid-Term Change)

1. **Identify the change type.** Coverage limit change, address change, vehicle substitution, or named insured addition each require different field edits. All endorsements require a `PolicyTransaction` audit record.
2. **Set endorsement date.** Set `InsurancePolicy.PolicyEndorsementDate` to the effective date of the change. Do not change `PolicyEffectiveDate`.
3. **Create `PolicyTransaction`.** `TransactionType = 'Endorsement'`, `TransactionEffectiveDate` = endorsement date, `TransactionDescription` = free-text reason. Save before editing policy fields.
4. **Edit policy or coverage fields.** Apply the field-level changes to `InsurancePolicy` or `InsurancePolicyCoverage`. For coverage limit changes, update `CoverageAmount`. For deductible changes, update `DeductibleAmount`. Never delete and recreate a coverage record to effect a change — use the existing record.
5. **Premium adjustment.** If the endorsement changes premium, update `InsurancePolicyCoverage.PremiumAmount` and create a `PolicyTransaction` with `TransactionType = 'PremiumAdjustment'` and the pro-rated `TransactionAmount`.
6. **Re-attach documentation.** Attach the endorsement schedule or amendment via `ContentDocumentLink` with `InsurancePolicyDocument.DocumentType = 'Endorsement'`.
7. **Notify insured.** Trigger notification flow or Platform Event to the insured's preferred contact channel. Load `references/05-integrations-and-documents.md`.

### Workflow 3 — Policy Cancellation and Reinstatement

1. **Determine cancellation type.** Flat cancellation (policy never took effect — full return of premium), pro-rata (return calculated from cancellation date to expiration), short-rate (insured-initiated, penalty applied). Each type uses a different `PolicyTransaction.TransactionType` value. Load `references/03-policy-lifecycle.md` for calculation formulas.
2. **Set `PendingCancellation` status.** Transition `InsurancePolicy.Status = 'PendingCancellation'`. Populate `CancellationEffectiveDate` and `CancellationReason` (must match a `FSCInsuranceCancellationReason__mdt` record).
3. **Mandatory notice period.** Do not transition to `Cancelled` until the jurisdiction-required notice period has elapsed. Use a scheduled Flow triggered on `CancellationEffectiveDate - NoticeDays__c` to enforce this.
4. **Finalize cancellation.** Transition `Status = 'Cancelled'`. Create `PolicyTransaction` with `TransactionType = 'Cancellation'` and `TransactionAmount` = return-of-premium (negative for insurer payback).
5. **Reinstatement eligibility check.** A cancelled policy is eligible for reinstatement if: (a) the cancellation reason was `NonPayment` or `CustomerRequest`, (b) the `CancellationEffectiveDate` was within the jurisdiction's reinstatement window (commonly 30–180 days), and (c) outstanding premium is paid. Underwriting review is required for lapsed policies beyond 30 days.
6. **Reinstatement execution.** Transition `Status = 'Reinstatement'` (FSC uses this transitory status). Create `PolicyTransaction` with `TransactionType = 'Reinstatement'`. Verify `PolicyExpirationDate` is still in the future; if not, a new policy (renewal) must be issued instead. On success, transition `Status = 'Active'`.
7. **Document and notify.** Attach reinstatement notice via `InsurancePolicyDocument`. Trigger notification to insured.

---

## NOT covered by this skill

- **FSC Claims** — `Claim`, `ClaimParticipant`, `ClaimReserve`, `ClaimPayment`, `ClaimAction`, FNOL, adjudication. Use `industries-fsc-claims-process`.
- **FSC Wealth Management** — `FinancialAccount`, `AssetsAndLiabilities`, `ReferralStage`, portfolio management, investment advisory. Use the FSC Wealth Management skill.
- **FSC Mortgage Origination** — `MortgageApplication`, `LoanApplicant`, `LoanApplicationAsset`, residential/commercial loan origination. Use `industries-fsc-mortgage-origination`.
- **Revenue Cloud / CPQ pricing** — `SBQQ__Quote__c`, `PricebookEntry`, `QuoteLineItem`, product catalog pricing. Policy premium is not a CPQ product price.
- **Health Cloud** — `CarePlan`, `ClinicalEncounterCode`, member management objects in Health Cloud. FSC Insurance and Health Cloud are distinct Salesforce industries clouds.

If the user crosses into any of these, say so explicitly and stop rather than improvising an answer.
