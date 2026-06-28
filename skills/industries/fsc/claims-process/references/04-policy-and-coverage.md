# Policy and Coverage Validation

## Object Relationships

```
InsurancePolicy
  ├── InsurancePolicyCoverage  (one per covered risk/line)
  │     └── InsurancePolicyAsset (vehicle, property, or person linked to coverage)
  └── InsurancePolicyParticipant (named insured, beneficiaries, additional insureds)
```

A `Claim` always references exactly one `InsurancePolicy`. A `ClaimCoverage` always references exactly one `InsurancePolicyCoverage`.

## Key Fields: `InsurancePolicy`

| Field | API Name | Notes |
|---|---|---|
| Policy Number | `Name` | Human-readable; use for search |
| Status | `Status` | Must be `'Active'` to accept a new claim |
| Effective Date | `EffectiveDate` | `Claim.DateOfLoss` must be ≥ this |
| Expiration Date | `ExpirationDate` | `Claim.DateOfLoss` must be ≤ this |
| Policy Type | `PolicyType` | `Auto`, `Homeowners`, `Life`, `Disability`, `Commercial`, etc. |
| Named Insured | `NameInsuredId` | Lookup to Account |
| Product | `InsuranceProductId` | Links to the insurance product definition |

## Key Fields: `InsurancePolicyCoverage`

| Field | API Name | Notes |
|---|---|---|
| Coverage Type | `CoverageType` | Picklist: `Collision`, `Comprehensive`, `Liability`, `MedPay`, `Dwelling`, `PersonalProperty`, `Life`, `Disability`, etc. |
| Coverage Limit | `CoverageLimit` | Maximum payout for this coverage line |
| Deductible | `Deductible` | Amount claimant pays before insurance; critical for `ClaimReserve` calculation |
| Status | `Status` | Must be `'Active'`; inactive coverage cannot be claimed |
| Effective Date | `EffectiveDate` | Per-coverage effective date |
| Expiration Date | `ExpirationDate` | Per-coverage expiry |
| Policy | `InsurancePolicyId` | Parent policy |

## Coverage Validation at FNOL

Validate in this order before creating `ClaimCoverage`:

1. `InsurancePolicy.Status = 'Active'`?
2. `Claim.DateOfLoss` between `InsurancePolicy.EffectiveDate` and `InsurancePolicy.ExpirationDate`?
3. At least one `InsurancePolicyCoverage` with `Status = 'Active'` exists for this policy?
4. The `InsurancePolicyCoverage.CoverageType` is compatible with `Claim.LossType`?
5. `InsurancePolicyCoverage.ExpirationDate` has not passed as of `Claim.DateOfLoss`?

Coverage type compatibility matrix (common mappings):

| `Claim.LossType` | Compatible `CoverageType` values |
|---|---|
| `AutoCollision` | `Collision` |
| `AutoComprehensive` | `Comprehensive` |
| `AutoLiability` | `Liability`, `UninsuredMotorist` |
| `PropertyDwelling` | `Dwelling`, `StructuralCoverage` |
| `PropertyContents` | `PersonalProperty`, `Contents` |
| `Liability` | `PersonalLiability`, `UmbrellaLiability` |
| `Life` | `Life`, `TermLife`, `WholeLife` |
| `Disability` | `ShortTermDisability`, `LongTermDisability` |

## Deductible Handling

The deductible reduces the net payable amount. In `ClaimReserve` and `ClaimPayment`:

- Set `ClaimReserve.ReserveAmount = InsurancePolicyCoverage.CoverageLimit - InsurancePolicyCoverage.Deductible` as the initial reserve.
- `ClaimPayment.Amount` = gross damage estimate − deductible.
- Record the deductible separately as a `ClaimAction` note or custom field `ClaimCoverage.DeductibleApplied__c`.

## Multiple Coverages on One Claim

A single claim can have multiple `ClaimCoverage` records (e.g., auto collision + medical payments):

- Create one `ClaimCoverage` per `InsurancePolicyCoverage` being invoked.
- Each `ClaimCoverage` has its own `ClaimReserve` and `ClaimPayment` records.
- Total exposure = sum of `ClaimReserve.ReserveAmount` across all `ClaimCoverage` records.

## Policy Lookup Integration Procedure Pattern

Standard Integration Procedure for policy lookup at FNOL:

```
Input: PolicyNumber (string) OR InsuredId (Id)
Steps:
  1. DataRaptor Transform: normalize input (trim, uppercase policy number)
  2. DataRaptor Extract: query InsurancePolicy WHERE Name = :PolicyNumber AND Status = 'Active'
  3. DataRaptor Extract: query InsurancePolicyCoverage WHERE InsurancePolicyId = :PolicyId AND Status = 'Active'
  4. DataRaptor Extract: query InsurancePolicyParticipant WHERE InsurancePolicyId = :PolicyId
  5. DataRaptor Transform: merge into response payload { policy, coverages[], participants[] }
Output: { policyFound: boolean, policy: {}, coverages: [], participants: [] }
```

## Common Policy Validation Errors

| Error scenario | Detection | Handling |
|---|---|---|
| Policy lapsed (status Expired) | `Status != 'Active'` | Block claim creation; offer renewal or refer to underwriting |
| Loss date before policy start | `DateOfLoss < EffectiveDate` | Block; loss not covered |
| Loss date after policy expiry | `DateOfLoss > ExpirationDate` | Block; loss not covered |
| No active coverage for loss type | No matching `InsurancePolicyCoverage` | Warn adjuster; may be coverage dispute |
| Coverage limit exceeded | `LossAmount > CoverageLimit` | Allow claim; adjuster decides net payable |
| Deductible exceeds damage estimate | `LossAmount < Deductible` | Warn; claim may not be worth pursuing |
