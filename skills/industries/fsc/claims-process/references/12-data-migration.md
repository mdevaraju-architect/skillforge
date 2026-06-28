# FSC Claims Data Migration

## Load Order (Dependency Sequence)

FSC Claims objects have strict parent-child dependencies. Load in this order:

```
1.  Contact / Account             (claimants, payees — must exist first)
2.  InsurancePolicy               (policies being claimed against)
3.  InsurancePolicyCoverage       (coverage lines per policy)
4.  InsurancePolicyAsset          (vehicles, properties linked to coverage)
5.  InsurancePolicyParticipant    (named insureds, beneficiaries)
6.  Claim                         (with Status='New'; do not set ClaimNumber)
7.  ClaimParticipant              (requires Claim.Id + Contact/Account.Id)
8.  ClaimCoverage                 (requires Claim.Id + InsurancePolicyCoverage.Id)
9.  ClaimItem                     (requires Claim.Id + ClaimCoverage.Id)
10. ClaimBuildingItem / ClaimVehicleItem / ClaimLifeEventItem / ClaimPolicyItem
                                  (requires ClaimItem.Id)
11. ClaimReserve                  (requires Claim.Id + ClaimCoverage.Id)
12. ClaimAction                   (historical audit trail; requires Claim.Id)
13. ClaimPayment                  (requires Claim.Id + ClaimCoverage.Id + ClaimReserve.Id)
14. ClaimCase                     (disputes; requires Claim.Id)
15. ContentVersion                (file content — load separately)
16. ContentDocumentLink           (requires ContentDocument.Id + Claim.Id)
17. ClaimDocument                 (requires Claim.Id + ContentDocument.Id)
18. AssessmentTask                (requires Claim.Id)
19. AssessmentIndicator           (requires AssessmentTask.Id)
```

## CSV Shape: `Claim`

Required columns for initial migration:
```csv
InsurancePolicyId,DateOfLoss,LossType,LossDescription,Status,LossAmount,ClaimChannel,ReportedDate,ExternalClaimId__c
```

- `ExternalClaimId__c` — external system claim number; use as upsert key for subsequent updates
- `Status` — set to the historical status; do NOT auto-advance via Flow on migration loads (disable Flow before batch import)
- `ClaimNumber` — **omit entirely**; auto-generated; including it causes errors

## CSV Shape: `ClaimParticipant`

```csv
ClaimId,Role,ParticipantId,IsPrimary
```

Use the `ExternalClaimId__c` → `ClaimId` ID map from the Claim load.

## CSV Shape: `ClaimCoverage`

```csv
ClaimId,InsurancePolicyCoverageId,CoverageType,CoverageLimit,Deductible
```

`CoverageLimit` and `Deductible` should match `InsurancePolicyCoverage` values — pull from policy load.

## ID Mapping Pattern

Use a manifest file to track source-ID → target-ID mappings across all objects:

```json
{
  "claims": { "LEGACY-CLM-001": "0015g00000XxYzZ" },
  "coverages": { "LEGACY-COV-001": "0016g00000AbCdE" },
  "reserves": { "LEGACY-RES-001": "0017g00000FgHiJ" }
}
```

Load each CSV → capture Salesforce IDs from success file → write to manifest → reference manifest in subsequent CSVs.

## Disabling Automation During Migration

Before bulk-importing historical claims:

1. **Disable record-triggered Flows** on Claim, ClaimParticipant, ClaimCoverage — status transition Flows will fire incorrectly on historical records.
2. **Disable validation rules** that check current-date logic (e.g., DateOfLoss > TODAY()) — historical claims predate today.
3. **Disable Apex triggers** that enforce reserve sufficiency — reserve amounts being loaded may not match sequential payment totals until all records are loaded.
4. Use a **named migration user** with `SystemAdministrator` profile to bypass FLS restrictions during load.
5. **Re-enable all automation** and run smoke tests after migration completes.

## Bulk API 2.0 Load Example

```bash
# Load Claims
sf data import bulk \
  --sobject Claim \
  --file migration/claims.csv \
  --target-org <alias> \
  --wait 10

# Load ClaimParticipants
sf data import bulk \
  --sobject ClaimParticipant \
  --file migration/claim_participants.csv \
  --target-org <alias> \
  --wait 10
```

Use `--upsert-field ExternalClaimId__c` for re-runnable loads.

## Sandbox Test Seeding

For sandbox seeding (not historical migration), use `scripts/seed-test-claims.sh` which creates:
- 1 active `InsurancePolicy` with 3 coverage lines
- 5 `Claim` records across all status values
- Full child record set for each claim (participants, coverages, items, reserves, payments, actions)
- 1 disputed claim with `ClaimCase`
- 1 STP-eligible claim with `AssessmentIndicator` records

## Common Migration Errors

| Error | Cause | Fix |
|---|---|---|
| `FIELD_INTEGRITY_EXCEPTION on InsurancePolicyId` | Policy not loaded yet | Check load order; confirm policy IDs in manifest |
| `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY: Claim trigger` | Apex trigger blocking status | Disable trigger before migration load |
| `DUPLICATE_VALUE on ClaimNumber` | ClaimNumber column included in CSV | Remove column entirely |
| `FIELD_CUSTOM_VALIDATION_EXCEPTION: DateOfLoss` | Validation rule blocking historical dates | Disable date validation rule during migration |
| `REQUIRED_FIELD_MISSING: ClaimCoverageId` on ClaimReserve | Coverage IDs not mapped | Ensure ClaimCoverage load completed and manifest updated |
