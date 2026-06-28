# FSC Claims Setup and Permissions

## License Requirements

FSC Claims requires the **Financial Services Cloud** license. Within FSC, the Insurance vertical requires the **FSC Insurance add-on**. Confirm with `sf org display --target-org <alias>` and check installed packages.

Key managed packages:
- **Financial Services Cloud** (namespace: `vlocity_ins` for OmniStudio-based components, or core objects if OmniStudio is natively enabled)
- **OmniStudio** (if using managed package OmniStudio rather than native) — check `InstalledPackage` via Tooling API

## Permission Sets

Never use profiles for FSC Claims access. Stack permission sets via permission set groups.

| Permission Set | Who needs it | What it grants |
|---|---|---|
| `FSCInsurance` | All FSC Insurance users | Base FSC Insurance objects (InsurancePolicy, InsurancePolicyCoverage, etc.) |
| `FSCInsuranceClaims` | All claims users | Claim, ClaimParticipant, ClaimCoverage, ClaimItem, ClaimAction, ClaimPayment, ClaimReserve |
| `OmniStudioUser` | Users who run OmniScripts / FlexCards | OmniStudio runtime access |
| `OmniStudioAdmin` | Admins who build OmniStudio components | Full OmniStudio metadata access |
| `EinsteinAnalyticsForFSC` | Adjuster managers / supervisors | Claims analytics dashboards |

**Recommended permission set groups:**
- `ClaimsUser`: `FSCInsurance` + `FSCInsuranceClaims` + `OmniStudioUser`
- `ClaimsAdjuster`: `ClaimsUser` + any custom PS for adjuster-specific fields
- `ClaimsManager`: `ClaimsAdjuster` + `EinsteinAnalyticsForFSC`
- `ClaimsAdmin`: `ClaimsManager` + `OmniStudioAdmin`

## Queue Configuration

Adjusters receive claims via queues, not direct ownership.

Required queues (create via Setup > Queues):
- `Claims_New` — inbox for unassigned new claims
- `Claims_Auto` — auto/vehicle claims routing
- `Claims_Property` — property/homeowner claims routing
- `Claims_Life` — life and disability claims routing
- `Claims_Dispute` — disputed claims and ClaimCase records

Queue membership: assign adjusters to the appropriate queue(s). Flow-based assignment reads `Claim.LossType` and routes to the matching queue.

## Named Credentials

For external system integrations (ISO ClaimSearch, Verisk, payment processors):

1. Create a **Named Credential** in Setup > Named Credentials for each external endpoint.
2. Reference in Integration Procedures as `Input:namedCredential` — do not hard-code endpoints in Apex or OmniStudio components.
3. For OAuth2 external systems, create an **External Credential** linked to the Named Credential.

## Custom Metadata for Claims Configuration

Use **Custom Metadata Types** (not Custom Settings) for:
- `ClaimsRouting__mdt` — maps `Claim.LossType` to queue API name and SLA hours
- `ClaimsReserveThreshold__mdt` — reserve amount thresholds that trigger auto-approval (STP) vs. adjuster review
- `ClaimsSTPRules__mdt` — eligibility criteria for Straight-Through Processing

## Field-Level Security Checklist

Fields that commonly need explicit FLS grants (not covered by base permission sets):

- `Claim.SettlementAmount` — visible only to adjusters and above
- `ClaimPayment.Amount` — visible to adjusters; editable only by payment workflow user
- `ClaimReserve.ReserveAmount` — visible to adjusters; editable only by adjuster + manager
- `ClaimParticipant.TaxId__c` (if custom) — restrict to payment processing persona only
- `AssessmentIndicator.FraudScore__c` (if custom) — restrict to adjuster managers

## Org Setup Validation

Run `scripts/check-claims-config.sh` to validate:
- FSC Insurance license is active
- Required permission sets are deployed
- OmniStudio package version meets minimum (v238+ for native OmniStudio, or OmniStudio package 14+)
- All required queues exist
- Named Credentials are configured
- `ClaimsRouting__mdt` records exist for all `LossType` picklist values
