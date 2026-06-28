# FSC Claims Object Reference

Quick field-level lookup for all core FSC Claims objects.

## `Claim`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim Number | `ClaimNumber` | Auto Number | Never set manually |
| Insurance Policy | `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| Status | `Status` | Picklist | New/Open/In Review/Pending Payment/Closed/Denied/Withdrawn |
| Loss Date | `DateOfLoss` | Date | Required |
| Reported Date | `ReportedDate` | Date | Defaults to today |
| Loss Type | `LossType` | Picklist | Drives routing and subtype selection |
| Loss Description | `LossDescription` | Text Area | Required |
| Loss Amount | `LossAmount` | Currency | Preliminary estimate |
| Loss Location | `LossLocation` | Address | Property/auto claims |
| Claim Channel | `ClaimChannel` | Picklist | Phone/Web/Mobile/Agent/Batch |
| Owner | `OwnerId` | Lookup(User/Queue) | Adjuster or queue |

## `ClaimParticipant`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Master-Detail(Claim) | |
| Role | `Role` | Picklist | Claimant/Insured/Adjuster/Witness/Attorney/ThirdPartyClaimant |
| Participant | `ParticipantId` | Lookup(Contact/Account/User) | |
| Primary | `IsPrimary` | Boolean | Primary claimant |

## `ClaimCoverage`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Master-Detail(Claim) | |
| Policy Coverage | `InsurancePolicyCoverageId` | Lookup(InsurancePolicyCoverage) | Required |
| Coverage Type | `CoverageType` | Picklist | Inherited from policy coverage |
| Coverage Limit | `CoverageLimit` | Currency | From policy coverage |
| Deductible | `Deductible` | Currency | From policy coverage |

## `ClaimItem`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Master-Detail(Claim) | |
| Claim Coverage | `ClaimCoverageId` | Lookup(ClaimCoverage) | |
| Item Number | `ItemNumber` | Auto Number | |
| Loss Type | `LossType` | Picklist | |
| Damage Type | `DamageType` | Picklist | TotalLoss/PartialLoss/BodilyInjury/PropertyDamage |
| Damage Amount | `DamageAmount` | Currency | Adjuster estimate |
| Status | `Status` | Picklist | Open/Under Review/Settled/Denied |
| Description | `Description` | Text Area | |

## `ClaimBuildingItem`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim Item | `ClaimItemId` | Master-Detail(ClaimItem) | |
| Building Type | `BuildingType` | Picklist | Dwelling/OtherStructure/PersonalProperty |
| Estimated Repair Cost | `EstimatedRepairCost` | Currency | |
| Actual Cash Value | `ActualCashValue` | Currency | |
| Replacement Cost Value | `ReplacementCostValue` | Currency | |
| Year Built | `YearBuilt` | Number | |

## `ClaimVehicleItem`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim Item | `ClaimItemId` | Master-Detail(ClaimItem) | |
| Vehicle | `VehicleId` | Lookup(InsurancePolicyAsset) | |
| VIN | `VIN` | Text | |
| Year | `VehicleYear` | Number | |
| Make | `VehicleMake` | Text | |
| Model | `VehicleModel` | Text | |
| Total Loss | `IsTotalLoss` | Boolean | |
| Actual Cash Value | `ActualCashValue` | Currency | |
| Airbag Deployed | `AirbagDeployed` | Boolean | |

## `ClaimLifeEventItem`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim Item | `ClaimItemId` | Master-Detail(ClaimItem) | |
| Life Event Type | `LifeEventType` | Picklist | Death/Disability/CriticalIllness |
| Event Date | `LifeEventDate` | Date | |
| Insured Person | `InsuredPersonId` | Lookup(Contact) | |
| Beneficiary | `BeneficiaryId` | Lookup(Contact/Account) | |
| Cause of Loss | `CauseOfLoss` | Picklist | |

## `ClaimPolicyItem`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim Item | `ClaimItemId` | Master-Detail(ClaimItem) | |
| Policy Item Type | `PolicyItemType` | Picklist | Liability/Medical/LostWages/Other |
| Claimed Amount | `ClaimedAmount` | Currency | |
| Supported Amount | `SupportedAmount` | Currency | Adjuster validated |

## `ClaimReserve`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Claim Coverage | `ClaimCoverageId` | Lookup(ClaimCoverage) | |
| Reserve Type | `ReserveType` | Picklist | Indemnity/Expense/Medical/LegalExpense |
| Reserve Amount | `ReserveAmount` | Currency | Current ceiling |
| Initial Reserve | `InitialReserveAmount` | Currency | Set at creation |
| Status | `Status` | Picklist | Active/Closed/Pending |

## `ClaimPayment`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Claim Coverage | `ClaimCoverageId` | Lookup(ClaimCoverage) | |
| Claim Reserve | `ClaimReserveId` | Lookup(ClaimReserve) | |
| Amount | `Amount` | Currency | Net after deductible |
| Payee | `PayeeId` | Lookup(Contact/Account) | |
| Payment Method | `PaymentMethod` | Picklist | Check/EFT/Wire |
| Payment Status | `PaymentStatus` | Picklist | Pending/Approved/Issued/Failed/Voided |
| Payment Date | `PaymentDate` | Date | |
| Payment Reference | `PaymentReference` | Text | Check # or transaction ID |

## `ClaimAction`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Action Type | `ActionType` | Picklist | See adjudication reference |
| Action Date | `ActionDate` | DateTime | |
| Actor | `ActorId` | Lookup(User) | |
| Notes | `ActionNotes` | Text Area | |
| Claim Coverage | `ClaimCoverageId` | Lookup(ClaimCoverage) | Optional |

## `ClaimCase`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Case Type | `CaseType` | Picklist | Dispute/Litigation/Escalation |
| Dispute Reason | `DisputeReason` | Text Area | |
| Status | `Status` | Picklist | Open/In Review/Closed |

## `ClaimDocument`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Document Type | `DocumentType` | Picklist | See documents reference |
| Content Document | `ContentDocumentId` | Lookup(ContentDocument) | |
| Status | `Status` | Picklist | Pending/Received/Reviewed/Accepted/Rejected |
| Required | `IsRequired` | Boolean | |

## `AssessmentTask`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Claim | `ClaimId` | Lookup(Claim) | |
| Task Type | `AssessmentTaskType` | Picklist | Inspection/STPCheck/FraudReview/ISOQuery |
| Assignee | `AssigneeId` | Lookup(User/Queue) | |
| Due Date | `DueDate` | Date | |
| Status | `Status` | Picklist | Pending/InProgress/Completed/Cancelled |
| Result | `Result` | Picklist | Pass/Fail/Inconclusive |

## `AssessmentIndicator`

| Field | API Name | Type | Notes |
|---|---|---|---|
| Assessment Task | `AssessmentTaskId` | Lookup(AssessmentTask) | |
| Claim | `ClaimId` | Lookup(Claim) | |
| Indicator Type | `IndicatorType` | Text | Rule or model name |
| Score | `Score` | Number | 0–100 |
| Result | `Result` | Picklist | Pass/Fail/Review |
| Confidence | `Confidence` | Number | 0.0–1.0 |
| Source | `Source` | Picklist | Rules/EinsteinML/ISOClaimSearch/Verisk |
