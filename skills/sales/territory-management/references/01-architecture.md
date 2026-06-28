# ETM Architecture — Object Model and Field Reference

## Overview

Salesforce Enterprise Territory Management (ETM) is built on a dedicated object family prefixed with `Territory2`. These objects are separate from Classic Territory Management (`Territory` without the "2") and are not backward compatible. ETM is available in Enterprise Edition and above with the ETM feature enabled.

---

## Core Object Model

```
Territory2Model
  │
  ├── Territory2Type          (referenced by Territory2.Territory2TypeId)
  │
  └── Territory2 (root, ParentTerritory2Id = null)
        └── Territory2 (child)
              └── Territory2 (grandchild, unlimited depth)
                    │
                    ├── Territory2Rule         (filter criteria on Account)
                    │
                    ├── ObjectTerritory2Association   (Account-to-territory link)
                    │
                    └── UserTerritory2Association     (User-to-territory link)

Opportunity
  └── OpportunityTerritory2Association   (Opportunity-to-territory link)
```

---

## Object: Territory2Model

The container for an entire territory strategy. Only one model can be in `Active` state at a time.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `Name` | Text(80) | Human-readable model name |
| `State` | Picklist | `Planning`, `Active`, `Archived` |
| `Description` | TextArea | Optional description |
| `LastRunRuleDate` | DateTime | Timestamp of last rule execution |
| `LastModifiedDate` | DateTime | Standard audit field |

**State transition rules:**
- `Planning → Active`: triggers full rule run, creates `ObjectTerritory2Association` and `AccountShare` records
- `Active → Archived`: happens automatically when another model is activated; no direct API transition to Archived
- `Archived → Planning`: only via clone (creates a new Planning-state model based on the archived one)

---

## Object: Territory2Type

A classification for territories. Required before any `Territory2` can be created.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `Name` | Text(80) | E.g., "Named Account", "Geographic", "Overlay" |
| `Priority` | Integer | Lower number = higher priority; used when resolving multi-territory assignment |
| `Description` | TextArea | Optional |
| `MasterLabel` | Text | API label |

**Common territory types:**
- Named Account — specific accounts assigned to an account executive
- Geographic — region, state, or country-based
- Overlay — overlay sales (SE, specialists) who support geographic reps
- Industry Vertical — segmented by vertical market

---

## Object: Territory2

Represents a single territory within a model. Forms a tree via `ParentTerritory2Id`.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `Name` | Text(80) | Territory name |
| `Territory2ModelId` | Lookup(Territory2Model) | Required — parent model |
| `Territory2TypeId` | Lookup(Territory2Type) | Required — classification |
| `ParentTerritory2Id` | Lookup(Territory2) | Null for root territories |
| `Description` | TextArea | Optional |
| `AccountAccessLevel` | Picklist | Access level granted to territory members: `Read`, `Edit`, `All` (All = Edit + Transfer + Delete) |
| `OpportunityAccessLevel` | Picklist | `None`, `Read`, `Edit`, `All` |
| `CaseAccessLevel` | Picklist | `None`, `Read`, `Edit`, `All` |
| `ContactAccessLevel` | Picklist | `None`, `Read`, `Edit` |

**Hierarchy notes:**
- `ParentTerritory2Id = null` denotes a root (top-level) territory
- A model can have multiple root territories (a forest, not just a single tree)
- There is no API-enforced depth limit; practical limits are performance-driven
- SOQL relationship traversal is limited to 5 levels; deeper hierarchies require Apex recursion

---

## Object: Territory2Rule

Defines filter-based criteria that automatically assign `Account` records to a `Territory2`.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `Name` | Text(80) | Rule name |
| `Territory2Id` | Lookup(Territory2) | The territory this rule assigns accounts into |
| `IsInherited` | Boolean | Whether inherited from a parent territory's rule |
| `BooleanFilter` | Text | Optional boolean expression (e.g., `1 AND (2 OR 3)`) |

Filter criteria are stored as child `Territory2RuleCriterion` records (not shown here; accessed via Setup UI or Metadata API). Each criterion specifies:
- `Field` — an `Account` field API name
- `Operator` — `equals`, `notEqual`, `startsWith`, `contains`, `greaterThan`, `lessThan`, etc.
- `Value` — the comparison value

**Important constraints:**
- Criteria can only reference `Account` fields
- Rules can only be edited when the parent `Territory2Model.State = Planning`
- Multiple rules on the same territory use OR logic by default (an account matching any rule is assigned); use `BooleanFilter` for AND/OR combinations

---

## Object: ObjectTerritory2Association

The junction record linking an `Account` to a `Territory2`.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `ObjectId` | Lookup(Account) | The assigned Account's Id |
| `Territory2Id` | Lookup(Territory2) | The territory the account is assigned to |
| `AssociationCause` | Picklist | `Territory2AssignmentRule` (from a rule) or `Manual` (manually inserted) |
| `SobjectType` | Text | Always `Account` for territory assignments |

**Access patterns:**
- To find all accounts in a territory: `SELECT ObjectId FROM ObjectTerritory2Association WHERE Territory2Id = :territoryId`
- To find all territories for an account: `SELECT Territory2Id FROM ObjectTerritory2Association WHERE ObjectId = :accountId`
- An account can be in multiple territories simultaneously
- `AssociationCause = Manual` records persist across rule re-runs; `Territory2AssignmentRule` records are refreshed on each run

---

## Object: UserTerritory2Association

The junction record linking a `User` to a `Territory2`.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `UserId` | Lookup(User) | The assigned user's Id |
| `Territory2Id` | Lookup(Territory2) | The territory |
| `RoleInTerritory2` | Picklist | `Owner`, `Partner`, `User` |
| `IsActive` | Boolean | Whether the user assignment is active |

**Role meanings:**
- `Owner` — primary sales owner for the territory; typically one per territory
- `User` — standard territory member with access per territory sharing settings
- `Partner` — partner/channel user with territory access

---

## Object: OpportunityTerritory2Association

Links an `Opportunity` to a `Territory2` for forecasting purposes.

| Field | Type | Notes |
|-------|------|-------|
| `Id` | ID | Standard Salesforce Id |
| `OpportunityId` | Lookup(Opportunity) | The opportunity |
| `Territory2Id` | Lookup(Territory2) | The territory driving this opportunity's forecast |

**Key behaviors:**
- Created automatically when an Opportunity is saved, based on the Account's territory at that time
- Does NOT auto-update if the Account's territory changes after the Opportunity is created
- Territory here drives territory-based `ForecastingItem` rollups — wrong territory = wrong forecast
- Can be manually updated via DML (no rule engine; direct `Territory2Id` update)

---

## Territory2Model State Lifecycle

```
             ┌─────────────┐
             │   Planning   │◄──── Clone from Archived
             └──────┬──────┘
                    │ Activate
                    ▼
             ┌─────────────┐
             │    Active    │  ◄── Only one at a time
             └──────┬──────┘
                    │ Another model activated
                    ▼
             ┌─────────────┐
             │   Archived   │──── Clone to new Planning
             └─────────────┘
```

- **Planning**: rules editable, rule run is a preview (no live sharing impact), user assignments can be configured
- **Active**: rules locked, rule run is live (creates/updates AccountShare), single active model enforced
- **Archived**: read-only, cannot be re-activated, can be cloned to a new Planning model

---

## AccountShare — Territory-Derived Records

Territory membership automatically produces `AccountShare` records. These are system-managed and must not be created or deleted directly.

| Field | Value |
|-------|-------|
| `RowCause` | `Territory2` |
| `AccountId` | Account assigned via `ObjectTerritory2Association` |
| `UserOrGroupId` | User from `UserTerritory2Association` |
| `AccountAccessLevel` | Inherited from `Territory2.AccountAccessLevel` |

Attempting to insert `AccountShare` with `RowCause = Territory2` or `RowCause = Territory` throws:
```
System.DmlException: Insert failed. First exception on row 0; first error:
INVALID_FIELD_FOR_INSERT_UPDATE, Unable to create/edit Record: [RowCause]
```
