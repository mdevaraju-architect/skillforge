# Producer Hierarchy — Producer Object and Hierarchy Modeling

## Producer object

The `Producer` object is the FSC construct that gives a distribution entity (firm or individual agent) an identity in the distribution system. Every entity that appears in a `ProducerPolicyAssignment`, `DistributorAuthorization` (ContactId), or hierarchy relationship must have a `Producer` record.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | System |
| `Name` | Text | Auto-assigned or custom |
| `AccountId` | Lookup(Account) | Required. Links to the distribution firm's Business Account |
| `ContactId` | Lookup(Contact) | Populated for individual agents; null for firm-only producers |
| `Type` | Picklist | `Independent Agent (Contractor)`, `Captive Agent`, `Partner Agent`, `Partner/Reseller` |
| `NationalProducerNumber` | Text | National Producer Number (NPN) — should be set as Unique + ExternalId |

### Producer record patterns by entity type

| Entity | AccountId | ContactId | Pattern |
|---|---|---|---|
| DST (Thompson 004) | Thompson 004 Business Account | null | Firm-only producer |
| RTF (Raymond James) | Raymond James Business Account | null | Firm-only producer |
| CRP (Colorado Wealth) | Colorado Wealth Business Account | null | Firm-only producer |
| Individual agent (Robert Krebs) | Robert Krebs firm Business Account | Robert Krebs Contact | Individual producer |

### 1:1 Producer rule

One Contact (individual person) = one Producer record. If Sarah Jenkins starts her own firm (Jenkins Financial Group) while retaining trading rights at Beacon Wealth Advisors, she has ONE Producer record. Her dual affiliation is modeled through:
- `AccountContactRelation` to both firms (multi-account contact)
- `InsProducerRelationship__c` records showing her in the hierarchy under both firms

Creating two `Producer` records for the same person duplicates NPN, inflates PPA counts, and creates ambiguous commission splits.

---

## InsProducerRelationship__c — hierarchy object

### Purpose

Models the parent-child hierarchy between producers: DST → RTF/CRP → Agent. This is the custom proxy for the standard `ProducerRelationship` object (gated by `FSCInsurancePsl`).

### Relationship pattern

```
Producer (parent — DST or RTF/CRP)
    │
    │ ParentProducerId__c
    ▼
InsProducerRelationship__c
    │
    │ ChildProducerId__c
    ▼
Producer (child — RTF/CRP or individual agent)
```

### Demo hierarchy records

| Record Name | Parent Producer | Child Producer | Role | Type | Active |
|---|---|---|---|---|---|
| Thompson 004 → Raymond James | Thompson 004 (510004) | Raymond James (452129) | General Agent | Hierarchical | true |
| Legacy Wealth 106 → Raymond James | Legacy Wealth 106 (510106) | Raymond James (452129) | General Agent | Hierarchical | true |
| Raymond James → Robert Krebs | Raymond James (452129) | Robert Krebs (623525) | Independent Contractor | Hierarchical | true |
| Raymond James → Jennifer Duffy | Raymond James (452129) | Jennifer Duffy (623544) | Independent Contractor | Hierarchical | true |
| Raymond James → Sandra Peters | Raymond James (452129) | Sandra Peters (623532) | Independent Contractor | Hierarchical | true |
| Synergy Wealth 101 → Colorado Wealth | Synergy Wealth 101 | Colorado Wealth (678810) | Managing General Agent | Hierarchical | true |
| Synergy Wealth 101 → Financial Planning | Synergy Wealth 101 | Financial Planning (694504) | Managing General Agent | Hierarchical | true |
| Stellarix 026 → Colorado Wealth | Stellarix 026 | Colorado Wealth (678810) | Managing General Agent | Hierarchical | true |
| Colorado Wealth → Ray Jacobs | Colorado Wealth (678810) | Ray Jacobs (616583) | Independent Contractor | Hierarchical | true |
| Financial Planning → Ray Jacobs | Financial Planning (694504) | Ray Jacobs (616583) | Independent Contractor | Hierarchical | true |

Note: Raymond James appears as a child of BOTH Thompson 004 AND Legacy Wealth 106. This is correct and intentional — RTFs can serve multiple DSTs.

---

## Standard ProducerRelationship (when FSCInsurancePsl is available)

### Key fields

| Field | API Name | Notes |
|---|---|---|
| Parent Producer | `ParentProducerId` | Lookup to Producer — the parent in the hierarchy |
| Producer | `ProducerId` | Lookup to Producer — the child in the hierarchy |
| Role | `Role` | Picklist — same values as `Role__c` on the custom object |
| Start Date | `StartDate` | Date |
| End Date | `EndDate` | Date |
| Is Active | `IsActive` | Checkbox |

On the Producer page layout, two related lists surface:
- **Producer Relationships** — where this producer is the **parent** (their downline)
- **Related Producers** — where this producer is the **child** (their upline)

---

## Floating agent pattern (AccountContactRelation)

An agent who operates across multiple distribution firms without a fixed primary firm uses `AccountContactRelation` to model their affiliations. This is the standard Salesforce "Contacts to Multiple Accounts" feature.

### Ray Jacobs floating agent setup

```
Ray Jacobs Contact
    │
    ├─── AccountContactRelation ──► Colorado Wealth Account (Role: Registered Representative)
    └─── AccountContactRelation ──► Financial Planning Account (Role: Registered Representative)
```

Ray Jacobs has:
- One Business Account (his sole-proprietor firm entity)
- One Contact
- One Producer record (AccountId = his Business Account, ContactId = his Contact)
- Two `AccountContactRelation` records (to Colorado Wealth and Financial Planning)
- Two `InsProducerRelationship__c` records as child (Colorado Wealth → Ray Jacobs, Financial Planning → Ray Jacobs)

### SOQL for floating agent affiliations

```soql
SELECT Id, AccountId, Account.Name, Roles, IsActive
FROM AccountContactRelation
WHERE ContactId = :agentContactId
  AND IsActive = true
```

Note: `Roles` is a multipicklist — use `INCLUDES` for filtering:
```soql
WHERE ContactId = :agentContactId AND Roles INCLUDES ('Registered Representative')
```

---

## Querying the full hierarchy from any producer

### Find all producers below a DST (downline)

```soql
SELECT ChildProducerId__c, ChildProducerId__r.Name, Role__c, IsActive__c
FROM InsProducerRelationship__c
WHERE ParentProducerId__c = :dstProducerId
  AND IsActive__c = true
```

### Find all upline producers for an agent

```soql
SELECT ParentProducerId__c, ParentProducerId__r.Name, Role__c, IsActive__c
FROM InsProducerRelationship__c
WHERE ChildProducerId__c = :agentProducerId
  AND IsActive__c = true
```

### Traverse full hierarchy (3-level: DST → RTF/CRP → Agent)

```apex
// Level 1: DST direct children
List<InsProducerRelationship__c> level1 = [
    SELECT ChildProducerId__c, ChildProducerId__r.Name
    FROM InsProducerRelationship__c
    WHERE ParentProducerId__c = :dstId AND IsActive__c = true
];
Set<Id> rtfCrpIds = new Set<Id>();
for (InsProducerRelationship__c r : level1) rtfCrpIds.add(r.ChildProducerId__c);

// Level 2: RTF/CRP direct children (the agents)
List<InsProducerRelationship__c> level2 = [
    SELECT ChildProducerId__c, ChildProducerId__r.Name, ParentProducerId__r.Name
    FROM InsProducerRelationship__c
    WHERE ParentProducerId__c IN :rtfCrpIds AND IsActive__c = true
];
```

---

## Dual-hatted agency (concurrent career / reporting channels)

A producer can be the child of multiple parent producers simultaneously — this models an agent or firm that operates in multiple DST channels at the same time.

Example: Raymond James is a General Agent under BOTH Thompson 004 and Legacy Wealth 106. This creates two `InsProducerRelationship__c` records with the same `ChildProducerId__c` (Raymond James) but different `ParentProducerId__c` values.

```
InsProducerRelationship__c record A:
  ParentProducerId__c = Thompson 004
  ChildProducerId__c  = Raymond James
  IsActive__c = true

InsProducerRelationship__c record B:
  ParentProducerId__c = Legacy Wealth 106
  ChildProducerId__c  = Raymond James
  IsActive__c = true
```

This is valid and expected. Do not collapse these into one record.

