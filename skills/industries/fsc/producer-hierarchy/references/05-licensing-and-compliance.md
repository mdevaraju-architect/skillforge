# Producer Hierarchy — Licensing and Compliance

## LegalEntity

Represents the carrier's legal entity. Parent of `AuthorizedInsuranceLine` records.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `Name` | Text | Legal entity name |
| `CompanyName` | Text | Operating company name |
| `Status` | Picklist | Entity status |
| `LegalEntityStreet` | Text | Street address |
| `LegalEntityCity` | Text | City |
| `LegalEntityState` | Text | State |
| `LegalEntityPostalCode` | Text | Postal code |
| `LegalEntityCountry` | Text | Country |

**Creation order:** `LegalEntity` must exist before `AuthorizedInsuranceLine`. `AuthorizedInsuranceLine` must exist before `DistributorAuthorization`.

---

## AuthorizedInsuranceLine

Represents the lines of business the carrier is authorized to offer.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `LegalEntityId` | Lookup(LegalEntity) | Required |
| `InsuranceLine` | Picklist | `Life`, `Disability`, `Property`, `Casualty`, `Accident & Health or Sickness` |
| `Country` | Text | Country of authorization |

### Demo records

| Insurance Line | Legal Entity |
|---|---|
| Life | Massachusetts Mutual Life Insurance Company |
| Disability | Massachusetts Mutual Life Insurance Company |
| Property | Massachusetts Mutual Life Insurance Company |

---

## BusinessLicense

Tracks state-level licenses held by carrier, distribution firms, and individual agents.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `AccountId` | Lookup(Account) | Firm or carrier Account |
| `ContactId` | Lookup(Contact) | Individual agent Contact — populated for individuals, null for firms |
| `LicenseNumber` | Text | License number from issuing authority |
| `LineOfAuthority` | Picklist | `Property`, `Casualty`, `Accident & Health or Sickness` |
| `JurisdictionType` | Picklist | Jurisdiction classification |
| `JurisdictionState` | Picklist | US state (two-letter) |
| `Status` | Picklist | `Verified`, `Draft`, `Inactive`, `Revoked` |
| `IsActive` | Checkbox | Active flag |
| `ResidenceStatus` | Picklist | `Resident`, `Non-Resident` |
| `PeriodStart` | Date | License effective date |
| `PeriodEnd` | Date | License expiration date |
| `IssueDate` | Date | Date issued |
| `Issuer` | Text | Issuing authority name (e.g. "New York Department of Financial Services") |
| `IsPrimaryLicense` | Checkbox | Marks the primary/resident license |

### License patterns by entity type

| Entity | AccountId | ContactId | Notes |
|---|---|---|---|
| Carrier (LegalEntity) | Carrier Account | null | 3 carrier licenses (A&H, Property, Casualty) |
| DST/RTF/CRP (firm) | Firm Business Account | null | 1 license per firm per jurisdiction |
| Individual agent | Agent firm Business Account | Agent Contact | 2 licenses per agent: primary (resident) + non-resident |

### Individual agent BusinessLicense pattern

```apex
// Firm-level license (agent's business entity)
BusinessLicense firmLicense = new BusinessLicense(
    AccountId = agentFirmAccountId,
    LicenseNumber = 'NY-AGENT-FIRM-001',
    LineOfAuthority = 'Life',
    JurisdictionState = 'NY',
    Status = 'Verified',
    IsActive = true,
    IsPrimaryLicense = false
);

// Individual license (the person's resident license)
BusinessLicense individualLicense = new BusinessLicense(
    AccountId = agentFirmAccountId,   // both AccountId AND ContactId for individuals
    ContactId = agentContactId,
    LicenseNumber = 'NPN-17829402-NY',
    LineOfAuthority = 'Life',
    JurisdictionState = 'NY',
    Status = 'Verified',
    IsActive = true,
    IsPrimaryLicense = true,
    ResidenceStatus = 'Resident'
);
```

---

## DistributorAuthorization

Records the carrier's formal appointment of a distribution entity (firm or individual) to sell a specific line of insurance.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `AccountId` | Lookup(Account) | Required — firm or agent firm Account |
| `ContactId` | Lookup(Contact) | Individual agent Contact — null for firm-level entries |
| `LicenseId` | Lookup(BusinessLicense) | Associated license (optional link) |
| `AuthorizedInsuranceLineId` | Lookup(AuthorizedInsuranceLine) | Required — line of insurance being authorized |
| `Status` | Picklist | `Appointed`, `Terminated` |
| `IsActive` | Checkbox | Active appointment flag |
| `EffectiveDate` | Date | Appointment effective date |
| `ExpirationDate` | Date | Appointment expiration date |

### ContactId rule

| Entity type | ContactId |
|---|---|
| DST, RTF, CRP (firm) | **null** — firm-level authorization |
| Individual agent | **populated** — the agent's Contact record |

### Demo records — 11 DistributorAuthorizations

| Account | ContactId | Level | Status |
|---|---|---|---|
| Thompson 004 | null | DST | Appointed |
| Legacy Wealth 106 | null | DST | Appointed |
| Synergy Wealth 101 | null | DST | Appointed |
| Stellarix 026 | null | DST | Appointed |
| Raymond James | null | RTF | Appointed |
| Colorado Wealth | null | CRP | Appointed |
| Financial Planning | null | CRP | Appointed |
| Robert Krebs firm | Robert Krebs Contact | Agent | Appointed |
| Jennifer Duffy firm | Jennifer Duffy Contact | Agent | Appointed |
| Sandra Peters firm | Sandra Peters Contact | Agent | Appointed |
| Ray Jacobs firm | Ray Jacobs Contact | Agent | Appointed |

---

## Compliance gate — pre-issuance validation pattern

Before transitioning `InsurancePolicy.Status` to `In Force`, validate that every assigned producer holds valid licenses and active appointments.

```apex
public class FSCComplianceGate {
    public static void validatePolicySubmission(Id policyId) {
        List<ProducerPolicyAssignment> assignments = [
            SELECT ProducerId, Producer.AccountId, Producer.ContactId
            FROM ProducerPolicyAssignment
            WHERE InsurancePolicyId = :policyId
        ];

        for (ProducerPolicyAssignment ppa : assignments) {
            // Check individual license for writing agents
            List<BusinessLicense> licenses = [
                SELECT Id FROM BusinessLicense
                WHERE (AccountId = :ppa.Producer.AccountId
                       OR ContactId = :ppa.Producer.ContactId)
                  AND Status = 'Verified'
                  AND IsActive = true
                  AND (PeriodEnd = null OR PeriodEnd >= TODAY)
            ];
            if (licenses.isEmpty()) {
                throw new AuraHandledException(
                    'Submission blocked: Producer ' + ppa.ProducerId +
                    ' lacks an active verified license.'
                );
            }

            // Check firm appointment (DistributorAuthorization)
            List<DistributorAuthorization> appointments = [
                SELECT Id FROM DistributorAuthorization
                WHERE AccountId = :ppa.Producer.AccountId
                  AND Status = 'Appointed'
                  AND IsActive = true
                  AND (ExpirationDate = null OR ExpirationDate >= TODAY)
            ];
            if (appointments.isEmpty()) {
                throw new AuraHandledException(
                    'Submission blocked: Producer firm lacks an active carrier appointment.'
                );
            }
        }
    }
}
```

**Safety rules for this Apex:**
- Always use bound variables (`:ppa.Producer.AccountId`) — never string concatenation
- Use `with sharing` on the class — respect record-level access
- Log compliance check results to an audit object before throwing

---

## License expiration monitoring

`BusinessLicense.PeriodEnd` stores the expiration date. Implement a scheduled Flow or Apex batch to detect approaching expirations:

```soql
SELECT Id, AccountId, ContactId, LicenseNumber, JurisdictionState, PeriodEnd
FROM BusinessLicense
WHERE IsActive = true
  AND PeriodEnd != null
  AND PeriodEnd <= :Date.today().addDays(60)
ORDER BY PeriodEnd ASC
```

On detection: create Tasks for compliance review, create `RecordAlert` on the related Account, and evaluate whether related `DistributorAuthorization` records should be flagged (`IsActive = false`) if the underlying license expires.

---

## Pre-flight validation checklist (before deployment)

Run this Apex anonymous to verify org readiness before deploying the producer hierarchy:

```apex
System.debug('ProducerRelationship available: ' +
    Schema.getGlobalDescribe().containsKey('ProducerRelationship'));
System.debug('InsProducerRelationship__c deployed: ' +
    Schema.getGlobalDescribe().containsKey('InsProducerRelationship__c'));
System.debug('Producer count: ' + [SELECT COUNT() FROM Producer]);
System.debug('LegalEntity count: ' + [SELECT COUNT() FROM LegalEntity]);
System.debug('AuthorizedInsuranceLine count: ' + [SELECT COUNT() FROM AuthorizedInsuranceLine]);
System.debug('DistributorAuthorization count: ' + [SELECT COUNT() FROM DistributorAuthorization]);
System.debug('BusinessLicense count: ' + [SELECT COUNT() FROM BusinessLicense]);
System.debug('Contacts to Multiple Accounts enabled: ' +
    UserInfo.getOrganizationName()); // verify via Setup → Account Settings
```

Expected counts for reference demo:
- LegalEntity: 1, AuthorizedInsuranceLine: 3, Producer: 11
- BusinessLicense: 18, DistributorAuthorization: 11
