# Territory2Rule — Assignment Rules

## Overview

Territory assignment rules (`Territory2Rule`) define filter-based criteria that automatically assign `Account` records to territories. Rules evaluate Account field values and create `ObjectTerritory2Association` records when accounts match. Rules are the primary mechanism for scalable, data-driven territory assignment.

---

## Territory2Rule Structure

Each `Territory2Rule` belongs to exactly one `Territory2` record. When an account matches the rule's criteria, it is assigned to that territory.

### Key fields on Territory2Rule

| Field | Type | Description |
|-------|------|-------------|
| `Id` | ID | Standard Id |
| `Name` | Text(80) | Descriptive rule name (e.g., "California Accounts") |
| `Territory2Id` | Lookup(Territory2) | The territory accounts will be assigned to |
| `IsInherited` | Boolean | True if inherited from a parent territory's rule set |
| `BooleanFilter` | Text(255) | Optional boolean expression for criteria logic, e.g., `1 AND (2 OR 3)` |
| `IsActive` | Boolean | Whether the rule is evaluated during rule runs |

### Territory2RuleCriterion (child records)

Criteria are stored as child `Territory2RuleCriterion` records (managed via Metadata API or Setup UI). Each criterion has:

| Field | Description |
|-------|-------------|
| `Field` | Account field API name (e.g., `BillingState`, `Industry`, `AnnualRevenue`) |
| `Operator` | Comparison operator |
| `Value` | Comparison value as a string |
| `SortOrder` | Criterion number (referenced in BooleanFilter) |

### Supported operators

| Operator | Description |
|----------|-------------|
| `equals` | Exact match |
| `notEqual` | Not equal |
| `startsWith` | String starts with |
| `contains` | String contains |
| `notContain` | String does not contain |
| `greaterThan` | Numeric/date greater than |
| `greaterOrEqual` | Numeric/date greater than or equal |
| `lessThan` | Numeric/date less than |
| `lessOrEqual` | Numeric/date less than or equal |
| `includes` | Multi-select picklist includes value |
| `excludes` | Multi-select picklist excludes value |

---

## Account Fields Commonly Used in Rules

Rules can reference any field on the `Account` object, including custom fields.

| Field | API Name | Use Case |
|-------|----------|----------|
| Billing State/Province | `BillingState` | Geographic territory segmentation |
| Billing Country | `BillingCountry` | International territory split |
| Industry | `Industry` | Vertical market segmentation |
| Annual Revenue | `AnnualRevenue` | SMB vs. Enterprise split by revenue threshold |
| Number of Employees | `NumberOfEmployees` | Size-based segmentation |
| Account Owner | `OwnerId` | Named account assignment (rule per owner) |
| Account Type | `Type` | Prospect vs. Customer split |
| Custom Segment Field | `Segment__c` | Internal segment classification |
| Region | `Region__c` | Custom region field |
| Partner Flag | `Is_Partner_Account__c` | Partner/channel territory overlay |

**Reminder:** Rules can ONLY reference `Account` fields. If you need to drive territory assignment from a field on another object, copy the value to an Account field first via Flow or Apex.

---

## Boolean Logic

By default, all criteria on a rule are combined with AND logic — all criteria must match for the account to be assigned.

To use mixed AND/OR logic, populate `BooleanFilter` using criterion sort order numbers:

```
BooleanFilter = "1 AND (2 OR 3)"
```

This means: criterion 1 must match, AND either criterion 2 or criterion 3 must match.

**Example:** Assign accounts to "Western Named Account" territory if:
- `BillingState` is in {CA, OR, WA} (criteria 1, 2, 3 with OR)
- AND `AnnualRevenue` >= 1,000,000 (criterion 4)

```
BooleanFilter = "(1 OR 2 OR 3) AND 4"
```

---

## Multiple Rules Matching the Same Account

An account can match rules from multiple territories. When this happens, the account is assigned to ALL matching territories (not just the highest-priority one). The `ObjectTerritory2Association` table will have one record per territory for that account.

This is by design for overlay models — an account can be in a Geographic territory AND an Overlay territory simultaneously.

If you want exclusive (single-territory) assignment, enforce uniqueness through rule design (non-overlapping criteria) rather than relying on the rule engine to choose one.

---

## AssociationCause Values

`ObjectTerritory2Association.AssociationCause` indicates how an account was assigned to a territory.

| Value | Meaning |
|-------|---------|
| `Territory2AssignmentRule` | Assigned by a `Territory2Rule` during a rule run |
| `Manual` | Inserted directly via API or UI, bypassing rules |

**Behavior during rule re-runs:**
- `Territory2AssignmentRule` records are refreshed on every rule run — accounts that no longer match the rule lose the assignment; new matches gain it
- `Manual` records are NOT affected by rule runs — they persist until explicitly deleted
- An account can have both a `Territory2AssignmentRule` and a `Manual` association to different (or the same) territories simultaneously

---

## Running Rules Programmatically

Rules do not fire automatically when Account fields change. Execution must be triggered explicitly.

### Via Setup (manual)
Setup → Territory Management → Territory Models → [Model Name] → Run Rules

### Via REST API
```http
POST /services/data/v60.0/territory2/models/{modelId}/territories/{territoryId}/runRules
Authorization: Bearer {accessToken}
```
Omit `territories/{territoryId}` to run rules for all territories in the model.

### Via Apex (triggered by Flow or Schedule)
```apex
// Scheduled Apex — run rules nightly
public class TerritoryRuleScheduler implements Schedulable {
    public void execute(SchedulableContext sc) {
        TerritoryRuleRunner.runForActiveModel();
    }
}

// Helper class
public class TerritoryRuleRunner {
    public static void runForActiveModel() {
        List<Territory2Model> activeModels = [
            SELECT Id FROM Territory2Model WHERE State = 'Active' LIMIT 1
        ];
        if (!activeModels.isEmpty()) {
            // Invoke via HTTP callout to REST API, or use a platform event
            // to trigger an async job — direct Apex DML cannot trigger rule execution
        }
    }
}
```

**Note:** There is no native `Database.executeBatch` method that directly invokes the territory rule engine from Apex. The common pattern is to call the REST API from Apex via `Http`/`HttpRequest`, or to use a Platform Event to trigger a connected app action.

### Via Flow (Account After Save)
Build an Account Record-Triggered Flow that fires on update of the fields used in territory rules, then calls the territory rules REST API via an External Service or HTTP action. This provides near-real-time territory reassignment when Account fields change.

---

## Manual Assignment via ObjectTerritory2Association

To assign an account to a territory outside of rule logic:

```apex
ObjectTerritory2Association ota = new ObjectTerritory2Association(
    ObjectId = accountId,       // Account Id
    Territory2Id = territoryId, // Territory2 Id (in the Active model)
    AssociationCause = 'Manual'
);
insert ota;
```

**Manual assignment considerations:**
- Manual assignments are not re-evaluated on rule runs — they persist until deleted
- Manual assignments can coexist with rule-based assignments on the same account
- To remove a manual assignment: `delete [SELECT Id FROM ObjectTerritory2Association WHERE ObjectId = :accountId AND Territory2Id = :territoryId AND AssociationCause = 'Manual']`
- Manual assignments do not require the model to be in Planning state — they can be made on the Active model

---

## Rule Testing in Planning State

Before activating a model, use the Planning state to test rule coverage without impacting live sharing or forecasting.

**Testing workflow:**
1. Ensure model is in `Planning` state
2. Run rules via Setup → Territory Models → [Model Name] → Run Rules
3. Query `ObjectTerritory2Association` for the Planning model's territories:
```soql
SELECT Territory2.Name, COUNT(ObjectId) accountCount
FROM ObjectTerritory2Association
WHERE Territory2.Territory2ModelId = '0M...'  -- Planning model Id
GROUP BY Territory2.Name
ORDER BY Territory2.Name
```
4. Identify accounts not assigned to any territory:
```soql
SELECT Id, Name, BillingState, Industry, AnnualRevenue
FROM Account
WHERE Id NOT IN (
    SELECT ObjectId FROM ObjectTerritory2Association
    WHERE Territory2.Territory2ModelId = '0M...'
)
ORDER BY Name
```
5. Investigate gaps — adjust rule criteria, add catch-all rules, or confirm exclusions are intentional
6. Iterate until coverage meets requirements, then activate

**Catch-all rule pattern:**
Create a territory named "Unassigned" with a rule that matches all accounts (e.g., `Id != null`). After activation, accounts in "Unassigned" are those not caught by any other rule. This prevents invisible gaps.
