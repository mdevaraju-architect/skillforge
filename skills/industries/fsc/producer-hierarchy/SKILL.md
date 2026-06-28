---
name: industries-fsc-producer-hierarchy
description: >-
  Producer, ProducerRelationship, InsProducerRelationship__c, ProducerPolicyAssignment,
  ProducerCommission, BusinessLicense, DistributorAuthorization, AuthorizedInsuranceLine,
  LegalEntity, AccountContactRelation, FSC Insurance distribution, multi-tier channel,
  producer hierarchy, DST distributor, RTF retail firm, CRP corporate partner,
  NPN national producer number, license appointment, commission split, floating agent,
  dual DST channel, FSCInsurancePsl, InsurancePolicyParticipant, agent mobility,
  carrier appointment, compliance gate, multi-channel policy assignment
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "restricted"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: industries/fsc
  module: producer-hierarchy
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# FSC Insurance — Producer Hierarchy Skill

## Always-true gotchas

1. **`ProducerRelationship` (standard) is gated behind `FSCInsurancePsl`** — the standard object for modeling parent-child producer hierarchies requires the `FSCInsurancePsl` permission set license. Orgs without seats allocated cannot use `ProducerRelationship`. The production-safe alternative is a custom object `InsProducerRelationship__c` that mirrors the standard schema. When `FSCInsurancePsl` is provisioned, it is a data migration, not a redesign, because the schemas align field-for-field.

2. **Every distribution entity — DST, RTF, CRP, and individual agent firm — must have exactly one `Producer` record** — the `Producer` object is the FSC construct that gives an Account (firm) or Contact+Account (individual agent) an identity in the distribution system. Without a `Producer` record, an entity cannot appear in `ProducerPolicyAssignment`, `ProducerCommission`, `DistributorAuthorization` (ContactId), or the hierarchy. You cannot skip this and link policy assignments directly to Accounts.

3. **Individual agents use Business Account + Contact, NOT Person Account** — Person Accounts are reserved for policyholders only. An individual agent needs a Business Account (their firm entity, which holds `BusinessLicense` and `DistributorAuthorization` at the firm level) and a Contact (the individual, which holds the `NPN`, individual `BusinessLicense`, and individual `DistributorAuthorization`). The `Producer` record links both: `Producer.AccountId` → Business Account, `Producer.ContactId` → Contact.

4. **One `ProducerPolicyAssignment` per producer per policy — not one per DST channel** — when an agent appears in multiple DST channels for the same policy, they share a single PPA record. Creating duplicate PPAs per channel inflates production volume and commission calculations. Channel-level tracking lives in the `InsProducerRelationship__c` hierarchy and `AccountContactRelation` records, not in PPA multiplicity.

5. **`BusinessLicense` and `DistributorAuthorization` cannot be added to the Account page layout via Metadata API** — attempts to deploy these as related lists on the Account layout via layout XML in SFDX fail with a deployment error at API 65.0. They must be added manually through Setup → Object Manager → Account → Page Layouts after every fresh deployment. This is a known API constraint, not a permissions issue.

6. **`DistributorAuthorization.ContactId` is populated for individual agents only** — for firm-level entries (DST, RTF, CRP accounts), leave `ContactId` null. Populating `ContactId` on a firm-level `DistributorAuthorization` creates ambiguity between the firm appointment and the individual appointment, and breaks the compliance validation pattern that distinguishes firm-level from individual-level authorization.

7. **`ProducerCommission.ParentProducerCommissionId` drives the commission hierarchy, not the producer hierarchy** — the commission tree is: master (carrier level, `ParentProducerCommissionId = null`) → clearing/aggregator → individual agent splits. This is a separate hierarchy from `InsProducerRelationship__c`. A producer may have multiple `ProducerCommission` records across different policies. Never read the producer hierarchy from `ProducerCommission` — use `InsProducerRelationship__c` or `ProducerRelationship` for hierarchy, `ProducerCommission` only for money.

8. **Floating agent pattern uses `AccountContactRelation`, not multiple `Producer` records** — an agent like Ray Jacobs who operates across multiple CRP firms has one `Producer` record, one PPA per policy, and multiple `AccountContactRelation` records linking his Contact to each firm he is affiliated with. Creating one `Producer` per firm affiliation is wrong — it breaks `NPN` uniqueness and duplicates policy assignments.

9. **`InsProducerRelationship__c` lookup fields must use `deleteConstraint=Restrict`** — both `ParentProducerId__c` and `ChildProducerId__c` should be set to `Restrict` delete constraint. Without this, a `Producer` record can be deleted while still referenced in a hierarchy record, leaving orphaned relationship records that break hierarchy queries. The standard `ProducerRelationship` uses the same constraint.

10. **`InsurancePolicyParticipant` and `ProducerPolicyAssignment` serve completely different purposes** — `InsurancePolicyParticipant` links policyholders (Insured, Beneficiary, Owner, Driver) to the policy. `ProducerPolicyAssignment` links agents/distributors (producers) to the policy. These objects do not overlap. Never put an agent in `InsurancePolicyParticipant` or a policyholder in `ProducerPolicyAssignment`.

11. **`DistributorAuthorization` requires a linked `AuthorizedInsuranceLine`, which requires a `LegalEntity`** — the creation order is: `LegalEntity` → `AuthorizedInsuranceLine` → `DistributorAuthorization`. `AuthorizedInsuranceLine.LegalEntityId` is required. If `LegalEntity` doesn't exist when you try to create `AuthorizedInsuranceLine`, the insert fails silently in some Apex anonymous contexts. Always confirm `LegalEntity` exists first.

12. **`relatedListType=Enhanced` is not supported in page layout XML at API 65.0** — including this attribute in layout metadata XML causes a deployment error. Omit it entirely from SFDX layout XML; configure enhanced related lists manually after deployment if needed.

13. **`ProducerPolicyAssignment` has no split percentage field** — commission percentages live on `ProducerCommission.CommissionAmount` relative to `CommissionableAmount`, not on `ProducerPolicyAssignment`. If you need to report on who sold what percentage, the source of truth is `ProducerCommission`, not `PPA`. A common mistake is creating custom `SplitPercent__c` fields on `PPA` and then discovering `ProducerCommission` already exists for this purpose.

14. **`AccountContactRelation.Roles` is a multipicklist — query with `INCLUDES`, not `=`** — agents who serve multiple distribution firms are linked via `AccountContactRelation` with a role such as `'Registered Representative'` or `'Employee'`. Because `Roles` is a multipicklist field, SOQL must use `INCLUDES ('Registered Representative')` not `= 'Registered Representative'`, otherwise the query returns no results.

---

## Routing table

| User intent | Reference file |
|---|---|
| Object model, tier definitions, distribution architecture overview | `references/01-architecture.md` |
| Setup, metadata deployment, `InsProducerRelationship__c` custom object, permission sets, known API constraints | `references/02-setup-and-deployment.md` |
| Producer hierarchy — DST → RTF/CRP → Agent chain, `ProducerRelationship` vs `InsProducerRelationship__c`, floating agent pattern | `references/03-producer-hierarchy.md` |
| Policy assignment — `ProducerPolicyAssignment`, multi-channel policies, commission splits, `ProducerCommission` hierarchy | `references/04-policy-assignment-and-commissions.md` |
| Licensing and compliance — `BusinessLicense`, `DistributorAuthorization`, `AuthorizedInsuranceLine`, `LegalEntity`, compliance gate pattern | `references/05-licensing-and-compliance.md` |

---

## Workflows

### Workflow 1 — Set up a new distribution channel (DST → RTF/CRP → Agent)

1. Create `LegalEntity` for the carrier if it does not exist. Populate `Name`, `CompanyName`, `Status`, `LegalEntityStreet/City/State/PostalCode/Country`
2. Create `AuthorizedInsuranceLine` records (Life, Disability, Property) linked to the `LegalEntity` via `LegalEntityId`
3. Create the DST Business Account. Create a `Producer` record with `AccountId` pointing to the DST Account
4. Create `DistributorAuthorization` for the DST — set `AccountId`, `AuthorizedInsuranceLineId`, `Status = Appointed`, `IsActive = true`. Leave `ContactId` null
5. Create the RTF or CRP Business Account. Create its `Producer` record
6. Create `DistributorAuthorization` for the RTF/CRP
7. For each individual agent: create Business Account (agent firm) + Contact (individual). Create `Producer` with both `AccountId` and `ContactId` set
8. Create `BusinessLicense` for the agent firm (Account-level) and for the individual agent (Account + Contact)
9. Create `DistributorAuthorization` for the individual agent — populate both `AccountId` and `ContactId`
10. Create `AccountContactRelation` records linking agent Contact to their distribution firm Account(s)
11. Create `InsProducerRelationship__c` records: DST → RTF/CRP, RTF/CRP → Agent

### Workflow 2 — Assign producers to a multi-channel policy

1. Confirm all involved `Producer` records exist and have active `BusinessLicense` + `DistributorAuthorization` records
2. Create the `InsurancePolicy` — set `NameInsuredId` to the policyholder Person Account, `ProducerId` to the writing agent's `Producer`
3. Create `InsurancePolicyParticipant` with `Role = Insured`, linking the policyholder Person Account via `PrimaryParticipantAccountId`
4. For each producer (DST, RTF/CRP, individual agents): create one `ProducerPolicyAssignment` with `InsurancePolicyId` and `ProducerId`. Do NOT create duplicate PPAs for the same producer even if they appear in multiple DST channels
5. Create `ProducerCommission` master record (carrier level) linked to the policy
6. Create `ProducerCommission` clearing record — set `ParentProducerCommissionId` to the master
7. Create individual `ProducerCommission` split records per agent — each with `ParentProducerCommissionId` pointing to the clearing record, `ProducerId` to the agent, and `CommissionAmount` = the agent's split amount

### Workflow 3 — Compliance gate validation before policy issuance

1. Query `ProducerPolicyAssignment` where `InsurancePolicyId = :policyId` to get all assigned producers
2. For each assigned `Producer`, verify an active `BusinessLicense` exists: `SELECT Id FROM BusinessLicense WHERE (AccountId = :producer.AccountId OR ContactId = :producer.ContactId) AND Status = 'Verified' AND IsActive = true AND PeriodEnd >= TODAY`
3. For the writing agent's firm, verify a `DistributorAuthorization` exists: `SELECT Id FROM DistributorAuthorization WHERE AccountId = :firmAccountId AND Status = 'Appointed' AND IsActive = true`
4. If any check fails, block the policy status transition and surface the specific failing producer and reason
5. Run SOQL binding only — never concatenate user-supplied values into SOQL strings (SOQL injection risk)
6. Log the compliance check result as a `ClaimAction` equivalent or custom audit record before proceeding

---

## NOT covered by this skill

- **FSC Claims processing** — use `industries-fsc-claims-process` (Claim, ClaimParticipant, ClaimReserve, ClaimPayment)
- **FSC Insurance Policy lifecycle** — use `industries-fsc-policy-administration` (InsurancePolicy endorsements, renewals, cancellations)
- **FSC Wealth Management** — use `industries-fsc-wealth-management` (FinancialAccount, household model)
- **FSC Mortgage Origination** — use `industries-fsc-mortgage-origination` (ResidentialLoanApplication)
- **Commission calculation engines** — custom split logic, automated commission rules, RevShare platforms
- **Health Cloud** — care plans, clinical objects
