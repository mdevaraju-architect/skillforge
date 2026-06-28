# FSC Insurance — Coverage, Participants, Assets, and Beneficiaries

## InsurancePolicyCoverage

### Coverage Types — Standard Picklist Values

FSC Insurance ships with these `CoverageType` values. Custom values can be added but must also be registered in `FSCInsurancePolicyType__mdt` if they affect product-line routing.

| CoverageType Value | Lines of Business | Notes |
|---|---|---|
| `Liability` | Auto, Commercial, Umbrella | Third-party bodily injury and property damage |
| `Collision` | Auto | Damage from vehicle collision regardless of fault |
| `Comprehensive` | Auto | Non-collision losses (theft, weather, vandalism) |
| `MedicalPayments` | Auto, Homeowners | Medical expenses for insured regardless of fault |
| `UninsuredMotorist` | Auto | Coverage when at-fault party is uninsured |
| `Dwelling` | Homeowners | Damage to the primary structure |
| `PersonalProperty` | Homeowners, Renters | Contents coverage |
| `LiabilityUmbrella` | Umbrella | Excess liability layer over primary policies |
| `TermLife` | Life | Death benefit for a defined term |
| `WholeLife` | Life | Permanent death benefit with cash value |
| `LongTermDisability` | Disability | Income replacement for extended disability |
| `ShortTermDisability` | Disability | Income replacement for short-duration disability |
| `LongTermCare` | LTC | Care costs for chronic illness or disability |

### Required Fields on InsurancePolicyCoverage

These fields must be populated before an `InsurancePolicyCoverage` record can be saved with `Status = 'Active'`:

| Field | Required At | Common Mistake |
|---|---|---|
| `InsurancePolicyId` | Insert | Trying to create a coverage without a policy — throws master-detail null error |
| `CoverageType` | Insert | Leaving blank and expecting the UI to default it |
| `CoverageStartDate` | Before `Active` | Setting to null and relying on `PolicyEffectiveDate` — they are separate fields |
| `CoverageEndDate` | Before `Active` | Omitting CoverageEndDate — FSC validation blocks the Active transition |
| `CoverageAmount` | Before `Active` | Storing the deductible here instead of in `DeductibleAmount` |
| `PremiumAmount` | Before `Active` | Leaving null until later; blocks `IP_QuoteRequiresPremium` validation |

### CoverageAmount vs. DeductibleAmount vs. PremiumAmount

These three fields are distinct and frequently confused:

- **`CoverageAmount`** — the maximum amount the insurer will pay for a loss (policy limit). Example: $100,000 liability limit.
- **`DeductibleAmount`** — the amount the insured must pay out of pocket before the insurer pays. Example: $500 collision deductible.
- **`PremiumAmount`** — the amount the insured pays for this coverage line per term. Example: $450/year for collision.

Do not add `CoverageAmount` and `DeductibleAmount` together as a "total exposure" — they serve entirely different purposes in claims settlement math.

### Coverage Exclusions

FSC does not ship a standard `InsurancePolicyCoverageExclusion` object. Exclusions are stored in two ways:

1. **Free text** — `InsurancePolicyCoverage.ExclusionDescription` (LongTextArea). Simple implementations use this.
2. **Structured exclusions** — implement a custom child object `InsurancePolicyCoverageExclusion__c` with fields `ExclusionType__c` (picklist), `ExclusionDescription__c`, and a master-detail to `InsurancePolicyCoverage`. This is required when exclusions must be individually tracked for regulatory reporting.

Never store exclusions as a free-text blob on `InsurancePolicy` itself — they belong on the coverage line, not the policy header.

---

## InsurancePolicyParticipant

### Participant Roles — Complete Reference

| Role Value | Description | Constraints |
|---|---|---|
| `PolicyHolder` | The party that owns the policy and is responsible for premium | Exactly one per policy; enforced by `IPP_SinglePolicyHolder` |
| `Insured` | The party whose life, health, or property is covered | Can differ from PolicyHolder (e.g., parent insuring a child) |
| `Beneficiary` | Receives the benefit on a life or disability claim | Use `InsurancePolicyBeneficiary` object for detailed allocation; `InsurancePolicyParticipant` with `Role = Beneficiary` is the legacy pattern |
| `Agent` | The producer/agent of record | Multiple allowed; commission split tracked on `ProducerPolicyAssignment` |
| `Broker` | External broker who placed the policy | Can coexist with `Agent` |
| `JointInsured` | Co-insured on joint policies (e.g., spouses on a homeowners policy) | |
| `Payor` | Party paying the premium (if different from PolicyHolder) | Common on life policies where an employer pays |
| `Mortgagee` | Lienholder on a mortgaged property | Required on homeowners policies with a mortgage |

### Common Mistakes with InsurancePolicyParticipant

1. **Creating two `PolicyHolder` participants.** FSC validation rule `IPP_SinglePolicyHolder` will reject the second insert with a clear error, but only if the rule is active. In scratch orgs, always verify the rule is not deactivated.

2. **Using `InsurancePolicyParticipant` for beneficiary allocation percentage.** `InsurancePolicyParticipant` does not have a `BeneficiaryPercent` field. Use `InsurancePolicyBeneficiary` for life/annuity percent-allocation, which is the correct FSC object for this purpose.

3. **Querying participants without a role filter.** A policy can have many participants. Always filter by `Role` when you need a specific type: `SELECT Id FROM InsurancePolicyParticipant WHERE InsurancePolicyId = :policyId AND Role = 'PolicyHolder'`.

4. **Leaving `StartDate` null.** `StartDate` is not enforced as required by FSC but is expected by reporting Flows and OmniStudio panels. Null `StartDate` causes participant to appear as "date unknown" in the servicing UI.

5. **Deleting the PolicyHolder participant without replacing it.** FSC does not prevent deletion of the sole `PolicyHolder` participant if the deletion happens outside a controlled transaction. Always enforce in a trigger: if the deleted participant is the last `PolicyHolder`, block with an error.

### InsurancePolicyParticipant — Relationship to Account vs. Contact

- **Person Account orgs:** `PrimaryParticipantId` (Lookup(Account)) holds the Person Account Id. `InsuredId` (Lookup(Contact)) is the auto-created Contact behind the Person Account.
- **Contact-based orgs (no Person Accounts):** `PrimaryParticipantId` is null; `InsuredId` holds the Contact Id. `InsurancePolicy.PrimaryInsuredId` is also null.
- **Commercial lines with Business Accounts:** `PrimaryParticipantId` = Business Account Id. The `Contact` behind the account is not used for `InsurancePolicyParticipant` in commercial implementations.
- **Never mix these patterns within a single org.** Pick one and enforce it via validation rules and triggers.

---

## InsurancePolicyAsset

### Asset Types and Their Specific Fields

| AssetType | Key Fields | Notes |
|---|---|---|
| `Vehicle` | `VIN`, `Year__c` (custom or standard `YearBuilt`), `Make__c`, `Model__c` | VIN validated by FSC standard check if configured; 17-character alphanumeric |
| `RealProperty` | `PropertyStreet`, `PropertyCity`, `PropertyState`, `PropertyPostalCode`, `YearBuilt`, `AssetValue` | Full compound address required for rating engine integration |
| `PersonalProperty` | `AssetName`, `AssetValue` | Used for scheduled personal articles (jewelry, art, collectibles) |
| `LifeEvent` | `AssetName`, `AssetValue` | Used in life/annuity policies to track insured life events |
| `Vessel` | `VIN` (hull ID), `AssetName`, `AssetValue` | Marine policies |
| `AircraftItem` | `VIN` (N-number for US aircraft), `AssetName`, `AssetValue` | Aviation policies |

### Critical Relationship Rule

`InsurancePolicyAsset.InsurancePolicyCoverageId` is a **lookup to `InsurancePolicyCoverage`**, not to `InsurancePolicy` directly. The path is:

```
InsurancePolicyAsset
  └── InsurancePolicyCoverageId → InsurancePolicyCoverage
                                    └── InsurancePolicyId → InsurancePolicy
```

This means you cannot query assets directly from the policy in a single-hop lookup. Use a subquery:

```soql
SELECT Id, PolicyName,
  (SELECT Id, CoverageType,
    (SELECT Id, AssetName, VIN FROM InsurancePolicyAssets__r)
   FROM InsurancePolicyCoverages__r)
FROM InsurancePolicy
WHERE Id = :policyId
```

Child relationship names: `InsurancePolicyCoverages__r` (on InsurancePolicy), `InsurancePolicyAssets__r` (on InsurancePolicyCoverage).

### Common Asset Mistakes

1. **Linking the asset to `InsurancePolicyId` instead of `InsurancePolicyCoverageId`.** The field `InsurancePolicyCoverageId` is required; a null value here means the asset is orphaned from coverage and will fail the Summer '25 asset validation.
2. **Creating multiple `InsurancePolicyAsset` records for the same physical asset across renewals.** The correct pattern is to copy the asset record to the new coverage on the renewal policy — or query the prior policy's assets via `PriorPolicyId` and re-link. Do not leave assets on expired policies as the "source of truth."
3. **Storing VIN in a custom field instead of the standard `VIN` field.** The standard `VIN` field is indexed and used by integrations. Custom VIN fields break standard PAS integrations.

---

## InsurancePolicyBeneficiary

### When to Use InsurancePolicyBeneficiary vs. InsurancePolicyParticipant

Use `InsurancePolicyBeneficiary` when:
- The policy is life, annuity, or disability.
- Beneficiaries have a percentage allocation that must be tracked and validated to sum to 100%.
- Multiple tiers of beneficiaries exist (Primary and Contingent).

Use `InsurancePolicyParticipant` with `Role = 'Beneficiary'` only for simple one-beneficiary scenarios where allocation percentage is not relevant (e.g., a property policy naming a loss payee).

### Beneficiary Percent Validation

The total `BeneficiaryPercent` across all `InsurancePolicyBeneficiary` records with the same `BeneficiaryType` must equal 100. Implement this validation in an Apex trigger on `InsurancePolicyBeneficiary` (after insert, after update, after delete, after undelete):

```apex
Decimal totalPrimary = 0;
Decimal totalContingent = 0;
for (InsurancePolicyBeneficiary__c b : [
    SELECT BeneficiaryType, BeneficiaryPercent
    FROM InsurancePolicyBeneficiary
    WHERE InsurancePolicyId = :policyId
]) {
    if (b.BeneficiaryType == 'Primary') totalPrimary += b.BeneficiaryPercent;
    else if (b.BeneficiaryType == 'Contingent') totalContingent += b.BeneficiaryPercent;
}
if (totalPrimary != 100 && totalPrimary != 0) {
    trigger.new[0].addError('Primary beneficiary percentages must total 100%.');
}
```

### Required Fields on InsurancePolicyBeneficiary

| Field | Required | Notes |
|---|---|---|
| `InsurancePolicyId` | Yes | |
| `BeneficiaryId` | Yes | Contact or Account Id; polymorphic |
| `BeneficiaryType` | Yes | `Primary` or `Contingent` |
| `BeneficiaryPercent` | Yes | Must be > 0; total per type must = 100 |
| `RelationshipToInsured` | Recommended | Required by some carriers for life insurance compliance |

### Common Beneficiary Mistakes

1. **Creating beneficiaries on property policies.** Property policies do not use `InsurancePolicyBeneficiary`. A loss payee or mortgagee on a property policy is an `InsurancePolicyParticipant` with `Role = 'Mortgagee'`.
2. **Leaving contingent beneficiary percentages unvalidated.** Contingent beneficiaries only receive a benefit if all primary beneficiaries predecease the insured. Their percentages must also total 100% independently of primary beneficiaries.
3. **Storing the beneficiary as a Contact Id in the `BeneficiaryId` field when the org uses Person Accounts.** In Person Account orgs, the beneficiary record should be a Person Account (`AccountId`), not a `ContactId`. Using the Contact Id in a Person Account org causes record-not-found errors in FSC beneficiary panels.
