# FSC Insurance Policy Administration — Setup and Permissions

## Required Salesforce Features and Licenses

| Feature / License | Where to enable | Notes |
|---|---|---|
| Financial Services Cloud Insurance | Setup → Company Information → Licenses | Base FSC license; required for all FSC Insurance objects |
| FSC Insurance Policy Administration | Setup → Financial Services Settings → Insurance | Enables `InsurancePolicy`, `InsurancePolicyCoverage`, `PolicyTransaction`, and related objects |
| FSC Insurance Brokerage (optional) | Setup → Financial Services Settings → Insurance | Required for `ProducerPolicyAssignment` and multi-producer workflows |
| FSC Billing | Setup → Financial Services Settings → Billing | Required for `BillingAccount` and premium billing integration |
| OmniStudio | Setup → Installed Packages or Setup → OmniStudio Settings | Required if using FlexCards or OmniScripts for policy servicing UI |

---

## Required Permission Sets

Compose permission sets via Permission Set Groups. Do not grant all capabilities through a single profile.

| Permission Set API Name | Required for |
|---|---|
| `FSCInsurance` | Base FSC Insurance objects: `InsurancePolicy`, `InsurancePolicyCoverage`, `InsurancePolicyParticipant`, `InsurancePolicyAsset`, `InsurancePolicyBeneficiary`, `InsurancePolicyDocument` |
| `FSCInsuranceBilling` | `BillingAccount` read/write; billing cycle configuration |
| `FSCInsuranceAgent` | Agent-facing policy search, servicing actions, `ProducerPolicyAssignment` read |
| `FSCInsuranceAdmin` | `PolicyTransaction` create/edit, `FSCInsuranceCancellationReason__mdt` management, setup access |
| `OmniStudioUser` | Required to run OmniScripts and view FlexCards in policy servicing |
| `OmniStudioAdmin` | Required to deploy or edit OmniStudio components |

### Minimum Permission Matrix by Persona

| Persona | Permission Sets |
|---|---|
| Policy Servicing Agent | `FSCInsurance`, `FSCInsuranceAgent`, `OmniStudioUser` |
| Underwriter | `FSCInsurance`, `FSCInsuranceAdmin` |
| Billing Specialist | `FSCInsurance`, `FSCInsuranceBilling` |
| System Administrator | `FSCInsurance`, `FSCInsuranceAdmin`, `FSCInsuranceBilling`, `OmniStudioAdmin` |
| Integration / API User | `FSCInsurance`, `FSCInsuranceAdmin` (assigned to the integration-dedicated user) |

---

## Object-Level and FLS Permissions

The following objects require explicit object-level and FLS grants in the permission sets above. They are **not** automatically accessible via standard Salesforce profiles, even System Administrator profiles in FSC-enabled orgs.

| Object | Minimum Access | Notes |
|---|---|---|
| `InsurancePolicy` | Read, Create, Edit | Delete restricted to `FSCInsuranceAdmin` |
| `InsurancePolicyCoverage` | Read, Create, Edit | Delete restricted; master-detail with InsurancePolicy |
| `InsurancePolicyParticipant` | Read, Create, Edit, Delete | Deletable; participants can be removed from a policy |
| `InsurancePolicyAsset` | Read, Create, Edit, Delete | |
| `InsurancePolicyBeneficiary` | Read, Create, Edit, Delete | Sensitive — data-sensitivity: restricted |
| `InsurancePolicyDocument` | Read, Create | Edit/Delete controlled by document lifecycle |
| `InsurancePolicyMemberPlan` | Read, Create, Edit | Group policies only |
| `PolicyTransaction` | Read, Create | Edit restricted; transactions are immutable audit records |
| `BillingAccount` | Read, Edit | Create only by billing integration or admin |
| `ProducerPolicyAssignment` | Read, Create, Edit, Delete | Requires FSC Brokerage license |

### Critical FLS Fields

These fields are commonly denied by default FLS and cause silent failures (field appears blank rather than throwing an error):

- `InsurancePolicyCoverage.PremiumAmount` — write access required for issuance workflow
- `InsurancePolicyCoverage.DeductibleAmount` — read access required for all agent personas
- `InsurancePolicyBeneficiary.BeneficiaryPercent` — restricted; requires explicit FLS grant
- `InsurancePolicy.CancellationReason` — write access required for cancellation workflow
- `InsurancePolicy.CancellationEffectiveDate` — write access required for cancellation workflow
- `PolicyTransaction.TransactionAmount` — write access required for endorsement premium adjustment

---

## Key Custom Metadata Types

| CMT API Name | Purpose | Default Records |
|---|---|---|
| `FSCInsuranceCancellationReason__mdt` | Governs valid values for `InsurancePolicy.CancellationReason` | `NonPayment`, `UnderwritingDecline`, `CustomerRequest`, `Misrepresentation`, `HazardIncrease` |
| `FSCInsurancePolicyType__mdt` | Maps `PolicyType` picklist values to product lines | `Individual`, `Group`, `Blanket` |
| `FSCInsuranceEndorsementType__mdt` | Maps endorsement descriptions to `PolicyTransaction.TransactionDescription` standard values | `CoverageIncrease`, `CoverageDecrease`, `NamedInsuredChange`, `AddressChange`, `VehicleSubstitution` |

Do not add new cancellation reasons or endorsement types via picklist edits alone. Always add a corresponding `__mdt` record first.

---

## Custom Settings

| Custom Setting API Name | Type | Purpose |
|---|---|---|
| `FSCInsurancePolicySettings__c` | Hierarchy | Controls `RequireBillingAccountForActivation`, `EnablePolicyEndorsementAudit`, `MaxBeneficiaryPercent` (default 100) |
| `FSCInsuranceBillingSettings__c` | Hierarchy | Grace period days, lapse threshold, billing cycle default |

Access custom settings via `FSCInsurancePolicySettings__c.getInstance()` in Apex. Do not query the SObject directly in production code — the `getInstance()` method is null-safe.

---

## Queue Configuration

Policy administration typically uses two or three queues:

| Queue Name (recommended) | Object | Purpose |
|---|---|---|
| `Policy_Issuance_Queue` | InsurancePolicy | Holds new business applications awaiting underwriter review |
| `Policy_Endorsement_Queue` | InsurancePolicy | Holds endorsement requests requiring manual review |
| `Policy_Cancellation_Queue` | InsurancePolicy | Holds pending cancellations awaiting notice period expiry |

Assign queue membership via permission sets or directly in Setup → Queues. OmniStudio routing rules can reference queue names dynamically.

---

## Named Credential Patterns for Rating Engines and PAS

### Rating Engine Integration

Create one `Named Credential` per rating engine environment (dev, uat, prod):

```
Label:             AcmeRatingEngine_Prod
Name:              AcmeRatingEngine_Prod
URL:               https://rating.acmeinsurance.com/api/v2
Authentication:    OAuth 2.0 (JWT Bearer) or Named Principal
Certificate:       mutual-TLS certificate if required by carrier
```

Reference the credential in Apex via `HttpRequest.setEndpoint('callout:AcmeRatingEngine_Prod/quote')`.

### Policy Admin System (PAS) Integration

```
Label:             AcmePAS_Prod
Name:              AcmePAS_Prod
URL:               https://pas.acmeinsurance.com/services/rest
Authentication:    Basic (username/password stored securely) or OAuth 2.0
```

Never hardcode PAS credentials in Apex class constants. Always use Named Credentials.

### External Certificate Storage

For carriers requiring mutual TLS, store the client certificate in Setup → Certificate and Key Management. Reference it in the Named Credential `Certificate` field. Rotate annually and update the Named Credential before expiry — policy issuance calls will silently fail if the certificate is expired.

---

## Org Validation Checklist (run before go-live)

1. `sf org display --target-org <alias>` confirms FSC license is active.
2. SOQL `SELECT Id FROM InsurancePolicy LIMIT 1` returns without error (object exists).
3. `FSCInsurance` permission set exists: `SELECT Id, Name FROM PermissionSet WHERE Name = 'FSCInsurance'`.
4. `FSCInsuranceCancellationReason__mdt` has at least the five default records.
5. `FSCInsurancePolicySettings__c.getInstance()` returns non-null from anonymous Apex.
6. Named Credentials for rating engine and PAS are present and callout test succeeds.
7. `Policy_Issuance_Queue` and `Policy_Cancellation_Queue` exist in Setup → Queues.
