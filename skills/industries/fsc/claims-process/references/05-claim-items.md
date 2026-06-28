# ClaimItem Subtypes

## Object Hierarchy

`ClaimItem` is the parent object. Every `ClaimItem` record must be paired with exactly one subtype record:

```
ClaimItem  (abstract parent — holds common fields)
  ├── ClaimBuildingItem    (property damage — dwelling, structure, contents)
  ├── ClaimVehicleItem     (auto damage — collision, theft, total loss)
  ├── ClaimLifeEventItem   (life / disability — death benefit, income replacement)
  └── ClaimPolicyItem      (catch-all general policy-level item)
```

The subtype record has a master-detail relationship to `ClaimItem`. Creating a `ClaimItem` without the matching subtype results in incomplete records that will fail adjudication workflows.

## Common Fields on `ClaimItem`

| Field | API Name | Notes |
|---|---|---|
| Claim | `ClaimId` | Master-detail to `Claim` |
| Claim Coverage | `ClaimCoverageId` | Which coverage line this item is against |
| Item Number | `ItemNumber` | Auto-generated |
| Loss Type | `LossType` | Should match parent `Claim.LossType` |
| Damage Type | `DamageType` | Picklist: `TotalLoss`, `PartialLoss`, `BodilyInjury`, `PropertyDamage` |
| Damage Amount | `DamageAmount` | Adjuster's estimate |
| Status | `Status` | `Open`, `Under Review`, `Settled`, `Denied` |
| Description | `Description` | Free text description of loss item |

## `ClaimBuildingItem` — Property Claims

Use for: homeowner, renter, commercial property claims involving structures or contents.

Additional required fields:
| Field | API Name | Notes |
|---|---|---|
| Building Type | `BuildingType` | `Dwelling`, `OtherStructure`, `PersonalProperty`, `CommercialBuilding` |
| Damage Description | `DamageDescription` | Detailed structural damage description |
| Estimated Repair Cost | `EstimatedRepairCost` | From adjuster or contractor estimate |
| Actual Cash Value | `ActualCashValue` | ACV = replacement cost − depreciation |
| Replacement Cost Value | `ReplacementCostValue` | Full replacement cost |
| Year Built | `YearBuilt` | Affects depreciation calculation |
| Square Footage | `SquareFootage` | For dwelling damage estimates |

ACV vs RCV: Whether the policy pays ACV or RCV is on `InsurancePolicyCoverage`. ACV policies deduct depreciation; RCV policies pay full replacement. This distinction drives `ClaimPayment.Amount`.

## `ClaimVehicleItem` — Auto Claims

Use for: auto collision, comprehensive, uninsured motorist, total loss claims.

Additional required fields:
| Field | API Name | Notes |
|---|---|---|
| Vehicle | `VehicleId` | Lookup to `InsurancePolicyAsset` (the vehicle asset) |
| VIN | `VIN` | Vehicle Identification Number |
| Year | `VehicleYear` | Model year |
| Make | `VehicleMake` | |
| Model | `VehicleModel` | |
| Mileage | `Mileage` | At time of loss |
| Point of Impact | `PointOfImpact` | Picklist: `Front`, `Rear`, `LeftSide`, `RightSide`, `Rollover` |
| Airbag Deployed | `AirbagDeployed` | Boolean; affects severity classification |
| Total Loss | `IsTotalLoss` | Boolean; triggers different payment workflow |
| Actual Cash Value | `ActualCashValue` | Market value at time of loss (from Kelley Blue Book, CCC) |

Total loss workflow: if `IsTotalLoss = true`, integration procedure calls Mitchell/CCC for ACV lookup and populates `ActualCashValue`. Payment = ACV − deductible − salvage value.

## `ClaimLifeEventItem` — Life and Disability Claims

Use for: term life, whole life, accidental death, short-term disability, long-term disability.

Additional required fields:
| Field | API Name | Notes |
|---|---|---|
| Event Type | `LifeEventType` | `Death`, `Disability`, `CriticalIllness`, `AccidentalDismemberment` |
| Event Date | `LifeEventDate` | Date of death, disability onset, etc. |
| Insured Person | `InsuredPersonId` | Contact who is the insured life |
| Beneficiary | `BeneficiaryId` | Contact who receives the benefit |
| Cause | `CauseOfLoss` | `Natural`, `Accidental`, `Occupational`, `Unknown` |
| Death Certificate Number | `DeathCertificateNumber` | Required for life claims |
| Disability Start Date | `DisabilityStartDate` | For disability claims |
| Elimination Period | `EliminationPeriod` | Days before disability payments begin (from policy) |
| Monthly Benefit Amount | `MonthlyBenefitAmount` | For disability; from `InsurancePolicyCoverage` |

Life claim documents required: death certificate, medical examiner report, beneficiary identification. All attached via `ClaimDocument` → `ContentDocumentLink`.

## `ClaimPolicyItem` — General Policy-Level Items

Use for: claims that don't fit property/auto/life subtypes, or liability-only claims.

This subtype has fewer required fields:
| Field | API Name | Notes |
|---|---|---|
| Policy Item Type | `PolicyItemType` | Picklist: `Liability`, `Medical`, `LostWages`, `PainAndSuffering`, `Other` |
| Claimed Amount | `ClaimedAmount` | Amount claimant is requesting |
| Supported Amount | `SupportedAmount` | Adjuster's validated amount (may differ from claimed) |
| Third Party Claimant | `ThirdPartyClaimantId` | For liability claims against the insured |

## Subtype Selection Logic

Implement in a Flow or OmniScript decision step:

```
IF Claim.LossType IN ('AutoCollision','AutoComprehensive','AutoLiability','AutoTheft')
  → Create ClaimVehicleItem
ELSE IF Claim.LossType IN ('PropertyDwelling','PropertyContents','PropertyLiability','Fire','Water','Theft')
  → Create ClaimBuildingItem
ELSE IF Claim.LossType IN ('Life','Disability','CriticalIllness','AccidentalDeath')
  → Create ClaimLifeEventItem
ELSE
  → Create ClaimPolicyItem
```

## Multiple Items Per Claim

A single claim can have multiple `ClaimItem` records (e.g., damaged vehicle + medical expenses):
- Each item links to the appropriate `ClaimCoverage`.
- Items can have different statuses (one settled, one still under review).
- `ClaimReserve` should exist per `ClaimCoverage`, not per `ClaimItem`.
