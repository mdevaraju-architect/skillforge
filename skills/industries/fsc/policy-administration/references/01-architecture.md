# FSC Insurance Policy Administration — Architecture

## Module Boundary

FSC Policy Administration owns the lifecycle of an `InsurancePolicy` record from initial creation through issuance, active management, renewal, endorsement, cancellation, and reinstatement. It does not own Claims processing (`Claim` hierarchy) or Wealth objects (`FinancialAccount`).

| Adjacent module | Interaction point |
|---|---|
| FSC Claims (`Claim`) | `Claim.InsurancePolicyId` references the active policy; coverage validated against `InsurancePolicyCoverage` |
| FSC Billing (`BillingAccount`) | `InsurancePolicy.BillingAccountId` links to the billing entity for premium collection |
| Salesforce Files | `InsurancePolicyDocument` → `ContentDocumentLink` → `ContentVersion` for policy documents |
| External PAS / Rating Engine | Integration via Named Credentials, Platform Events, or Outbound Messaging |
| OmniStudio | FlexCards for policy summary panels; OmniScripts for intake and servicing workflows |
| Producer / Distribution | `ProducerPolicyAssignment` links a `Producer` record to an `InsurancePolicy` |

---

## Hub-and-Spoke Object Model

```
InsurancePolicy  ←── central hub
  │
  ├── InsurancePolicyCoverage       (one per covered line; master-detail)
  │     └── InsurancePolicyAsset    (vehicle, property, life event — lookup to Coverage)
  │
  ├── InsurancePolicyParticipant    (PolicyHolder, Insured, Beneficiary, Agent, Broker …)
  │
  ├── InsurancePolicyBeneficiary    (life/annuity — beneficiary + allocation %)
  │
  ├── InsurancePolicyMemberPlan     (group policies only — individual member enrollments)
  │
  ├── InsurancePolicyDocument       (metadata wrapper → ContentDocumentLink → ContentVersion)
  │
  ├── PolicyTransaction             (audit log of every status-changing event)
  │
  └── ProducerPolicyAssignment      (links Producer to policy; supports split commissions)
```

---

## InsurancePolicy — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard Salesforce ID |
| `PolicyName` | Text(80) | Auto-generated policy number; required; unique |
| `PolicyType` | Picklist | `Individual`, `Group`, `Blanket` |
| `Status` | Picklist | See status lifecycle below |
| `PolicyEffectiveDate` | Date | Inception date; required before `Active` |
| `PolicyExpirationDate` | Date | Termination date; required before `Active` |
| `PolicyEndorsementDate` | Date | Date of most recent endorsement; updated on each mid-term change |
| `CancellationEffectiveDate` | Date | Date cancellation takes effect; required when `Status = PendingCancellation` |
| `CancellationReason` | Text(255) | Must match `FSCInsuranceCancellationReason__mdt` record name |
| `PriorPolicyId` | Lookup(InsurancePolicy) | Points to the expiring policy on a renewal |
| `PrimaryInsuredId` | Lookup(Account) | Person Account for the primary insured; null if Contact-based model |
| `OwnerId` | Lookup(User/Queue) | Servicing agent or queue |
| `BillingAccountId` | Lookup(BillingAccount) | Required for activation if `RequireBillingAccountForActivation = true` |
| `ProductId` | Lookup(Product2) | Insurance product (e.g., Auto, Homeowners, Term Life) |
| `NameInsuredId` | Lookup(Account) | Distinct from `PrimaryInsuredId` in commercial lines |
| `JointInsuredId` | Lookup(Account) | Co-insured on joint policies |
| `AnnualPremium` | Currency | Aggregate; rolled up from `InsurancePolicyCoverage.PremiumAmount` via trigger or rollup |
| `Description` | LongTextArea(32000) | Free-text policy notes |

---

## InsurancePolicyCoverage — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard ID |
| `CoverageName` | Text(80) | Auto-named or agent-assigned |
| `InsurancePolicyId` | Master-Detail(InsurancePolicy) | Required; cannot be reparented |
| `CoverageType` | Picklist | `Liability`, `Collision`, `Comprehensive`, `MedicalPayments`, `UninsuredMotorist`, `Dwelling`, `PersonalProperty`, `LiabilityUmbrella`, `TermLife`, `WholeLife`, `LongTermDisability` (and custom values) |
| `CoverageStartDate` | Date | Must match or follow `InsurancePolicy.PolicyEffectiveDate` |
| `CoverageEndDate` | Date | Must match or precede `InsurancePolicy.PolicyExpirationDate` |
| `CoverageAmount` | Currency | Coverage limit (max insurer exposure); NOT the deductible |
| `DeductibleAmount` | Currency | Amount insured pays before coverage applies |
| `PremiumAmount` | Currency | Premium for this coverage line |
| `ExclusionDescription` | LongTextArea | Free-text exclusions; structured exclusions use child `InsurancePolicyCoverageExclusion__c` (custom) |
| `Status` | Picklist | `Active`, `Cancelled`, `Expired`; child status mirrors parent policy status on cancellation |

---

## InsurancePolicyParticipant — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard ID |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `Role` | Picklist | `PolicyHolder`, `Insured`, `Beneficiary`, `Agent`, `Broker`, `JointInsured`, `Payor`, `Mortgagee` |
| `PrimaryParticipantId` | Lookup(Account) | Person Account or Business Account |
| `InsuredId` | Lookup(Contact) | Used when org uses Contact-based model (not Person Account) |
| `BeneficiaryPercent` | Percent | For `Role = Beneficiary`; sum across beneficiary participants must equal 100 |
| `StartDate` | Date | Effective date of this participant's role |
| `EndDate` | Date | Null = still active |

---

## InsurancePolicyAsset — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard ID |
| `AssetName` | Text(80) | Descriptive name (e.g., "2022 Honda Civic") |
| `InsurancePolicyCoverageId` | Lookup(InsurancePolicyCoverage) | Required — links to coverage, NOT directly to policy |
| `AssetType` | Picklist | `Vehicle`, `RealProperty`, `PersonalProperty`, `LifeEvent`, `Vessel`, `AircraftItem` |
| `AssetValue` | Currency | Stated or appraised value at inception |
| `VIN` | Text(17) | Vehicles only; validated by standard FSC VIN check |
| `YearBuilt` | Number(4,0) | Real property |
| `PropertyAddress` | compound | `PropertyStreet`, `PropertyCity`, `PropertyState`, `PropertyPostalCode`, `PropertyCountry` |

---

## InsurancePolicyBeneficiary — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard ID |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `BeneficiaryId` | Lookup(Contact or Account) | Polymorphic |
| `BeneficiaryType` | Picklist | `Primary`, `Contingent` |
| `BeneficiaryPercent` | Percent | Must total 100% within each `BeneficiaryType` |
| `RelationshipToInsured` | Picklist | `Spouse`, `Child`, `Parent`, `Trust`, `Estate`, `Other` |

---

## PolicyTransaction — Key Field Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | Standard ID |
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `TransactionType` | Picklist | `NewBusiness`, `Endorsement`, `Renewal`, `Cancellation`, `Reinstatement`, `PremiumAdjustment`, `Reinstatement` |
| `TransactionEffectiveDate` | Date | Required |
| `TransactionAmount` | Currency | Premium change; negative = return of premium |
| `TransactionDescription` | Text(255) | Reason or description |
| `CreatedById` | Lookup(User) | System records the user or integration that initiated the transaction |

---

## Status Lifecycle

```
Draft ──► InReview ──► Quoted ──► Active ──► PendingCancellation ──► Cancelled
                                    │
                                    ├──────────────────────────────► Lapsed
                                    │
                                    └──────────────────────────────► Expired
                                                                        │
                                                                        ▼
                                                               Renewal (new InsurancePolicy
                                                               with PriorPolicyId set)
```

Key transition rules:
- `Draft → InReview`: underwriting submission; validation rule checks `PolicyEffectiveDate` is not null.
- `InReview → Quoted`: underwriting approval; premium set on all `InsurancePolicyCoverage` records.
- `Quoted → Active`: issuance; `BillingAccountId` required; `PolicyEffectiveDate` must be today or future; all participants and coverages validated.
- `Active → PendingCancellation`: `CancellationEffectiveDate` and `CancellationReason` required.
- `PendingCancellation → Cancelled`: only after notice period elapsed; `PolicyTransaction` with `TransactionType = 'Cancellation'` created.
- `Active → Lapsed`: triggered by billing failure; `BillingAccount` integration sends lapse event.
- `Active/Lapsed → Expired`: scheduled job on `PolicyExpirationDate`; system-initiated.
- `Cancelled/Lapsed → Reinstatement → Active`: reinstatement workflow; see `references/03-policy-lifecycle.md`.
