# Producer Hierarchy — Architecture

## Module boundary

This skill covers the FSC Insurance distribution architecture: how carriers distribute policies through multi-tier agent and firm networks. It does not cover claims (use `industries-fsc-claims-process`), policy lifecycle (use `industries-fsc-policy-administration`), or wealth management.

---

## Tier definitions

| Tier | Code | Role |
|---|---|---|
| Distributor | DST | Top-level distribution channel. Appointed directly by the carrier via DistributorAuthorization. |
| Retail Firm | RTF | Broker-dealer platform sitting below a DST. Hosts individual agents. |
| Corporate Partner | CRP | Corporate partner entity sitting below a DST. Hosts individual agents. |
| Agent | — | Individual licensed agent with a Producer record, Business Account, and Contact. |

---

## Object relationship diagram

```
LegalEntity
    │ (1:many)
    ▼
AuthorizedInsuranceLine
    │ (via AuthorizedInsuranceLineId)
    ▼
DistributorAuthorization ──── AccountId ──── Account (DST/RTF/CRP/agent firm)
    │                    ──── ContactId ──── Contact (individual agent only, null for firms)
    │                    ──── LicenseId ──── BusinessLicense (optional)
    │
BusinessLicense ─────────── AccountId ──── Account
                             ContactId ──── Contact (individual agent only)

Account (Business) ──────── AccountId ──── Producer ──── ContactId ──── Contact
    │                                           │
    │ (AccountId)                        InsProducerRelationship__c
    ▼                                    ParentProducerId__c ──── Producer
AccountContactRelation                   ChildProducerId__c  ──── Producer
    │ (ContactId)
    ▼
Contact

InsurancePolicy ─────────────────────────────────────────────────────────
    │                             │                           │
    │ (1:many)                    │ (1:many)                  │ (ProducerId)
    ▼                             ▼                           ▼
InsurancePolicyParticipant   ProducerPolicyAssignment       Producer
(Role: Insured, etc.)        ─── ProducerId ──► Producer    (writing agent)
    │
    │ (1:many via InsurancePolicyId)
    ▼
ProducerCommission
    ParentProducerCommissionId ──── ProducerCommission (master/clearing)
    ProcessingProducerId       ──── Producer
    ProducerId                 ──── Producer
```

---

## Full distribution hierarchy (demo topology)

```
CARRIER
Massachusetts Mutual Life Insurance Company (LegalEntity)
    │
    ├── AuthorizedInsuranceLine: Life
    ├── AuthorizedInsuranceLine: Disability
    └── AuthorizedInsuranceLine: Property

DISTRIBUTOR TIER (DST)
┌─────────────────────┐        ┌─────────────────────┐
│  Thompson 004       │        │  Legacy Wealth 106  │
│  Account + Producer │        │  Account + Producer │
└─────────────────────┘        └─────────────────────┘
    │ InsProducerRelationship__c ▼
    └──────────────────┬────────┘
                       ▼
            RETAIL FIRM TIER (RTF)
            ┌──────────────────────┐
            │   Raymond James      │
            │   Account + Producer │
            └──────────────────────┘
                   │ InsProducerRelationship__c ▼
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   Robert Krebs  Jennifer   Sandra Peters
   Business Acct + Contact + Producer
   (each with BusinessLicense + DistributorAuthorization)

DISTRIBUTOR TIER (DST)
┌──────────────────────┐        ┌─────────────────────┐
│  Synergy Wealth 101  │        │  Stellarix 026      │
│  Account + Producer  │        │  Account + Producer │
└──────────────────────┘        └─────────────────────┘
    │ InsProducerRelationship__c ▼
    ├────────────────────────┐
    ▼                        ▼
 Colorado Wealth (CRP)   Financial Planning (CRP)
 Account + Producer      Account + Producer
    │                        │
    └──────────┬─────────────┘
               ▼
          Ray Jacobs
          Business Acct + Contact + Producer
          AccountContactRelation to BOTH CRPs
```

---

## Account record types summary

| Account | Distribution Role | Record Type |
|---|---|---|
| Carrier (MassMutual) | Carrier | Business Account |
| Thompson 004, Legacy Wealth 106, Synergy Wealth 101, Stellarix 026 | DST | Business Account |
| Raymond James | RTF | Business Account |
| Colorado Wealth, Financial Planning | CRP | Business Account |
| Robert Krebs firm, Jennifer Duffy firm, Sandra Peters firm, Ray Jacobs firm | Agent firm | Business Account |
| Policyholders | Named Insured | Person Account |

Person Accounts are used exclusively for policyholders. All distribution entities (including individual agent entities) are Business Account + Contact.

---

## Key data volumes (reference demo)

| Object | Count | Notes |
|---|---|---|
| LegalEntity | 1 | Carrier legal entity |
| AuthorizedInsuranceLine | 3 | Life, Disability, Property |
| Producer | 11 | 4 DST + 1 RTF + 2 CRP + 4 agents |
| BusinessLicense | 18 | 3 carrier + 7 firm + 8 agent (2 per agent: resident + non-resident) |
| DistributorAuthorization | 11 | 4 DST + 1 RTF + 2 CRP + 4 agents |
| InsurancePolicy | 4 | 1 dual-DST + 3 floating-agent |
| InsurancePolicyParticipant | 4 | One Insured per policy |
| ProducerPolicyAssignment | 21 | 6 for dual-DST policy + 5×3 for floating-agent policies |
| InsProducerRelationship__c | 10 | See hierarchy diagram above |
| AccountContactRelation | 12 | Agents to their distribution firms |

---

## Multi-channel policy assignment patterns

### Pattern 1 — Dual DST via shared RTF (Policy 22823736)

```
InsurancePolicy 22823736
         │
  Channel 1: Thompson 004      Channel 2: Legacy Wealth 106
         │                              │
  RTF: Raymond James ──────────── Raymond James (same Account/Producer)
         │                              │
  Robert Krebs (1 PPA)         Jennifer Duffy (1 PPA, shared across channels)
  Jennifer Duffy (1 PPA shared) Sandra Peters (1 PPA, shared across channels)
  Sandra Peters (1 PPA shared)
```

Total PPAs: 6 — Thompson 004, Legacy Wealth 106, Raymond James, Robert Krebs, Jennifer Duffy, Sandra Peters.
Raymond James, Jennifer Duffy, and Sandra Peters each have ONE PPA despite appearing in both channels.

### Pattern 2 — Floating agent across multiple CRPs and DSTs (Policies 32706155, 22847017, 38603784)

```
InsurancePolicy (per policy, identical structure)
         │
  Channel 1: Synergy Wealth 101    Channel 2: Stellarix 026
         │                                  │
  CRP: Colorado Wealth             CRP: Colorado Wealth (same Account/Producer, 1 PPA)
  CRP: Financial Planning
         │                                  │
  Ray Jacobs (1 PPA per policy, shared across all CRP and DST appearances)
```

Total PPAs per policy: 5 — Synergy Wealth 101, Stellarix 026, Colorado Wealth, Financial Planning, Ray Jacobs.
Ray Jacobs has ONE PPA per policy regardless of how many CRP/DST channels reference him.
