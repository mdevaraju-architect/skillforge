# Architecture — Salesforce Security and Sharing Model

## Overview

Salesforce enforces data access through a layered security model. Each layer either sets a baseline or adds access on top of a lower layer. No layer can restrict access below what a lower layer has already granted. Understanding the order and interaction of layers is essential before making any sharing or permissions change.

---

## Security Model Layers

### Layer 1 — Organization-Wide Defaults (OWD)

OWD is the floor. It determines the default level of access any user has to records they do not own and are not granted access to through another mechanism.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   SALESFORCE SECURITY MODEL                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 5 — Apex Managed Sharing (custom RowCause)                │  │
│  │  Programmatic DML on Share objects, survives owner change        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 4 — Manual Sharing                                        │  │
│  │  Record owner / admin shares individual records with user/group  │  │
│  │  Deleted on record owner change (RowCause = Manual)              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 3 — Sharing Rules                                         │  │
│  │  Owner-based: grants access based on record owner's role/group   │  │
│  │  Criteria-based: grants access based on field values on record   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 2 — Role Hierarchy                                        │  │
│  │  Users higher in the hierarchy inherit access to records owned   │  │
│  │  by users below them (when "Grant Access Using Hierarchies" = ON)│  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 1 — Organization-Wide Defaults (OWD)                      │  │
│  │  The floor. Sets minimum access for all records of an object.    │  │
│  │  Private → Public Read Only → Public Read/Write                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

Layers 2–5 can only ADD access. They cannot subtract access below the OWD baseline.

---

## OWD Values

| OWD Setting | Record owner | Other users (no other sharing) |
|---|---|---|
| Private | Full access | No access |
| Public Read Only | Full access | Read access |
| Public Read/Write | Full access | Read + Write access |
| Public Read/Write/Transfer | Full access | Read + Write + Transfer ownership |
| Controlled by Parent | Inherits from parent record | Inherits from parent record |

**Controlled by Parent** is used for detail objects in master-detail relationships (e.g. Opportunity Line Items controlled by Opportunity). The detail record's access mirrors the master record's access exactly.

---

## Role Hierarchy

The role hierarchy is a tree structure where each node represents a role. Users assigned to a role inherit access to records owned by users in subordinate (lower) roles when "Grant Access Using Hierarchies" is enabled on the object's OWD.

```
                    ┌────────────────────┐
                    │  CEO               │ ← Can see all records owned by
                    └────────┬───────────┘   VP Sales, Regional Managers, Reps
                             │
              ┌──────────────┴──────────────┐
              │                             │
    ┌─────────┴──────────┐       ┌──────────┴─────────┐
    │  VP Sales          │       │  VP Support        │
    └─────────┬──────────┘       └──────────┬─────────┘
              │                             │
    ┌─────────┴──────────┐       ┌──────────┴─────────┐
    │  Regional Manager  │       │  Support Manager   │
    └─────────┬──────────┘       └──────────┬─────────┘
              │                             │
    ┌─────────┴──────────┐       ┌──────────┴─────────┐
    │  Sales Rep (West)  │       │  Support Agent     │
    └────────────────────┘       └────────────────────┘
```

Role hierarchy is enabled by default. For custom objects it can be disabled via the OWD "Grant Access Using Hierarchies" checkbox. For standard objects (Account, Opportunity, Case, Lead, Contact), it is always enabled and cannot be disabled.

---

## Share Object Structure

For every object with a Private or Public Read Only OWD, Salesforce maintains a corresponding share object that records who has access to each record and why.

### Standard Object Share Objects

| Object | Share Object | Key Fields |
|---|---|---|
| Account | AccountShare | AccountId, UserOrGroupId, AccountAccessLevel, CaseAccessLevel, OpportunityAccessLevel, RowCause |
| Opportunity | OpportunityShare | OpportunityId, UserOrGroupId, OpportunityAccessLevel, RowCause |
| Case | CaseShare | CaseId, UserOrGroupId, CaseAccessLevel, RowCause |
| Contact | ContactShare | ContactId, UserOrGroupId, ContactAccessLevel, RowCause |
| Lead | LeadShare | LeadId, UserOrGroupId, LeadAccessLevel, RowCause |
| Campaign | CampaignShare | CampaignId, UserOrGroupId, CampaignAccessLevel, RowCause |

### Custom Object Share Objects

For a custom object `MyObject__c`, the share object is `MyObject__Share` with fields:
- `ParentId` — the Id of the `MyObject__c` record being shared
- `UserOrGroupId` — the Id of the User, Role, RoleAndSubordinates, or Group being granted access
- `AccessLevel` — `Read`, `Edit`, or `All`
- `RowCause` — the reason for the share (system or custom)

---

## RowCause Values

| RowCause Token | Who creates it | Deleted on owner change? | User-deletable? |
|---|---|---|---|
| `Manual` | Users (via Sharing button), Apex | YES | YES (by user) |
| `Rule` | Sharing rule engine | No (re-evaluated) | No |
| `Role` | Role hierarchy | No (re-evaluated) | No |
| `Team` | Account/Opportunity Teams | No (re-evaluated) | No (owner manages) |
| `Owner` | System (record owner always has full access) | N/A (owner row updates) | No |
| `CustomShare__c` | Apex code only | NO | NO |

Custom RowCause values are defined in **Setup → Object Manager → [Object] → Sharing Reasons**. The token is `<DeveloperName>__c`. Apex managed sharing must always use a custom RowCause so shares survive owner changes and cannot be deleted by users.

---

## AccessLevel Values

| AccessLevel | What it grants |
|---|---|
| `Read` | View record and related fields (subject to FLS) |
| `Edit` | View + edit record fields (subject to FLS) |
| `All` | View + edit + delete + transfer (full owner-equivalent access) |

`All` can only be granted on AccountShare (for accounts). On other objects, `Edit` is the maximum grantable level via share objects. The `All` level cannot be granted via sharing rules — only the record owner and Apex with `All` access level can grant it.

---

## FLS and CRUD Permission Model Layers

Field-level and object-level permissions follow a separate stack from the record sharing model:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 FLS / CRUD PERMISSION MODEL                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 3 — Permission Set Group                                   │  │
│  │  Bundles multiple Permission Sets. Can include Muting PS         │  │
│  │  (requires specific license). Effective permissions = union.     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 2 — Permission Sets                                       │  │
│  │  Assigned to users individually. Additive only — cannot          │  │
│  │  revoke what a Profile grants. Multiple PSets can be assigned.   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LAYER 1 — Profile                                               │  │
│  │  Every user has exactly one Profile. Sets the baseline           │  │
│  │  object CRUD, FLS, system permissions, login hours, IP ranges.   │  │
│  │  Industry best practice: Minimum Access profile + PSets.         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

A user's effective permissions are the UNION of their profile and all assigned permission sets. If ANY layer grants a permission, the user has it. There is no "deny" layer (except for Muting Permission Sets in Permission Set Groups with specific licenses).

---

## How Record Sharing and FLS/CRUD Interact

Record sharing determines **which records** a user can see. FLS/CRUD determines **which fields and objects** a user can interact with. Both must allow access for a user to successfully view or edit a field on a record.

Example:
- User A has `AccountShare` granting `Read` access on Account ID `001xx` (record sharing: pass)
- User A's profile grants Read on the `Account` object (CRUD: pass)
- User A's profile does NOT grant Read on `Account.AnnualRevenue` (FLS: fail)
- Result: User A can see the Account record but `AnnualRevenue` is blank / null

In Apex without FLS enforcement, the query would return `AnnualRevenue` value even though the UI hides it — this is the FLS enforcement gap in Apex.
