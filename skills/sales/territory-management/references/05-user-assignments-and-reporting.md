# User Assignments, Opportunity Territory, and Reporting

## UserTerritory2Association

### What it is

`UserTerritory2Association` is the junction record that assigns a Salesforce user to a territory. Creating this record is what gives a sales rep access to accounts in that territory (subject to the territory sharing model configuration).

### Field reference

| Field | Type | Description |
|-------|------|-------------|
| `Id` | ID | Standard Id |
| `UserId` | Lookup(User) | The sales rep or manager |
| `Territory2Id` | Lookup(Territory2) | The territory (must be in the Active model) |
| `RoleInTerritory2` | Picklist | `Owner`, `Partner`, `User` |
| `IsActive` | Boolean | Whether the assignment is currently active |

### RoleInTerritory2 values

| Value | Typical Use |
|-------|-------------|
| `Owner` | Primary account executive owning the territory; typically one per territory |
| `User` | Secondary or supporting rep; access governed by territory sharing settings |
| `Partner` | Partner or channel rep with territory visibility; limited access typical |

### Creating user assignments

```apex
UserTerritory2Association uta = new UserTerritory2Association(
    UserId = '005...',
    Territory2Id = '0M5...',
    RoleInTerritory2 = 'Owner'
);
insert uta;
```

User assignments can be made while the model is in either `Planning` (for pre-activation setup) or `Active` state (for in-flight rep changes). Assignments to `Archived` model territories are not meaningful and should be avoided.

### Removing user assignments

Deleting the `UserTerritory2Association` record removes the user from the territory. Salesforce automatically removes the corresponding `AccountShare` records.

```apex
delete [
    SELECT Id FROM UserTerritory2Association
    WHERE UserId = '005...' AND Territory2Id = '0M5...'
];
```

### Access model

Territory membership grants account access through `AccountShare` records (auto-created by the territory engine). The level of access is determined by:
1. `Territory2.AccountAccessLevel` — the access level configured on the territory itself (`Read`, `Edit`, `All`)
2. Territory sharing settings in Setup — whether territory membership grants Read-Only or Read/Write
3. Whether "Grant access to parent territories" is enabled

If a user is in a territory but cannot see an account, check:
- Does `ObjectTerritory2Association` exist for the account + territory combination?
- Does `UserTerritory2Association` exist for the user + territory combination?
- Does `AccountShare` with `RowCause = Territory2` exist for the user + account?
- Is `Territory2.AccountAccessLevel` set to at least `Read`?

---

## OpportunityTerritory2Association

### What it is

`OpportunityTerritory2Association` links an `Opportunity` to a `Territory2`. This is the record that drives territory-based forecast rollup — the opportunity appears in the forecast hierarchy of whichever territory this record points to.

### Field reference

| Field | Type | Description |
|-------|------|-------------|
| `Id` | ID | Standard Id |
| `OpportunityId` | Lookup(Opportunity) | The opportunity |
| `Territory2Id` | Lookup(Territory2) | The territory for forecasting |

### How opportunity territory is set

1. When an `Opportunity` is created, Salesforce looks up the Account's current territory assignment (via `ObjectTerritory2Association`) and sets `OpportunityTerritory2Association.Territory2Id` to the Account's primary territory in the active model.
2. If the Account has multiple territory assignments, Salesforce selects the territory from the highest-priority `Territory2Type` (lowest `Priority` number).
3. If the Account has no territory assignment, no `OpportunityTerritory2Association` is created, and the opportunity does not appear in any territory forecast.

### Opportunity territory does NOT auto-update

When an Account's territory changes (due to a rule re-run or manual reassignment), existing `OpportunityTerritory2Association` records are NOT updated. The opportunity keeps its old territory assignment.

**Implications:**
- After a territory realignment (model activation), open opportunities may still be assigned to old territories
- Territory-based forecasts will be incorrect until `OpportunityTerritory2Association` records are updated
- Closed/Won opportunities should typically retain their original territory for historical accuracy

**Bulk update after realignment:**
```apex
// Find open opportunities whose account territory has changed
List<ObjectTerritory2Association> accountTerritories = [
    SELECT ObjectId, Territory2Id
    FROM ObjectTerritory2Association
    WHERE Territory2.Territory2ModelId = :activeModelId
    AND AssociationCause = 'Territory2AssignmentRule'
];

Map<Id, Id> primaryTerritoryByAccount = new Map<Id, Id>();
for (ObjectTerritory2Association ota : accountTerritories) {
    // Simplified — use Territory2Type.Priority to select primary territory
    primaryTerritoryByAccount.put(ota.ObjectId, ota.Territory2Id);
}

List<OpportunityTerritory2Association> opptyTerritories = [
    SELECT Id, OpportunityId, Territory2Id, Opportunity.AccountId
    FROM OpportunityTerritory2Association
    WHERE Opportunity.IsClosed = false
];

List<OpportunityTerritory2Association> toUpdate = new List<OpportunityTerritory2Association>();
for (OpportunityTerritory2Association ota : opptyTerritories) {
    Id correctTerritory = primaryTerritoryByAccount.get(ota.Opportunity.AccountId);
    if (correctTerritory != null && correctTerritory != ota.Territory2Id) {
        ota.Territory2Id = correctTerritory;
        toUpdate.add(ota);
    }
}
update toUpdate;
```

### Manual territory override on an opportunity

Sales managers sometimes need to assign an opportunity to a specific territory (e.g., for overlay or joint coverage). Update `OpportunityTerritory2Association.Territory2Id` directly:

```apex
OpportunityTerritory2Association ota = [
    SELECT Id, Territory2Id FROM OpportunityTerritory2Association
    WHERE OpportunityId = :oppId LIMIT 1
];
ota.Territory2Id = overlayTerritoryId;
update ota;
```

---

## SOQL Patterns for Territory Reporting

### All accounts assigned to a specific territory
```soql
SELECT Account.Id, Account.Name, Account.BillingState, Account.AnnualRevenue
FROM ObjectTerritory2Association
WHERE Territory2Id = '0M5...'
AND AssociationCause IN ('Territory2AssignmentRule', 'Manual')
ORDER BY Account.Name
```

### All territories for a specific account
```soql
SELECT Territory2.Name, Territory2.Territory2Type.Name, AssociationCause
FROM ObjectTerritory2Association
WHERE ObjectId = '001...'
```

### All users assigned to a territory (with role)
```soql
SELECT User.Name, User.Email, RoleInTerritory2
FROM UserTerritory2Association
WHERE Territory2Id = '0M5...'
AND IsActive = true
```

### Accounts with no territory assignment (coverage gap detection)
```soql
SELECT Id, Name, BillingState, Industry, AnnualRevenue, OwnerId
FROM Account
WHERE Id NOT IN (
    SELECT ObjectId FROM ObjectTerritory2Association
    WHERE Territory2.Territory2ModelId = :activeModelId
)
ORDER BY AnnualRevenue DESC NULLS LAST
```

### Territory coverage by rep (all territories per user)
```soql
SELECT Territory2.Name, Territory2.Territory2Model.Name, RoleInTerritory2
FROM UserTerritory2Association
WHERE UserId = '005...'
AND Territory2.Territory2Model.State = 'Active'
```

### Opportunities by territory (for pipeline analysis)
```soql
SELECT Territory2.Name, COUNT(OpportunityId) oppCount, SUM(Opportunity.Amount) pipeline
FROM OpportunityTerritory2Association
WHERE Territory2.Territory2ModelId = :activeModelId
AND Opportunity.IsClosed = false
GROUP BY Territory2.Name
ORDER BY SUM(Opportunity.Amount) DESC NULLS LAST
```

### Territory hierarchy (one level deep)
```soql
SELECT Id, Name, ParentTerritory2Id, ParentTerritory2.Name,
       Territory2Type.Name, Territory2Model.Name
FROM Territory2
WHERE Territory2ModelId = :activeModelId
ORDER BY ParentTerritory2Id NULLS FIRST, Name
```

### Territories with no user assignments (orphan territory detection)
```soql
SELECT Id, Name, Territory2Model.Name
FROM Territory2
WHERE Territory2ModelId = :activeModelId
AND Id NOT IN (
    SELECT Territory2Id FROM UserTerritory2Association WHERE IsActive = true
)
```

---

## Standard Report Types for ETM

Salesforce provides built-in report types for territory data.

| Report Type | Description |
|-------------|-------------|
| Territories | Territory2 records with hierarchy fields |
| Territory with Users | UserTerritory2Association joined to Territory2 and User |
| Territory with Accounts | ObjectTerritory2Association joined to Territory2 and Account |
| Territory with Opportunities | OpportunityTerritory2Association joined to Territory2 and Opportunity |

**Note:** Territory report types are only available when ETM is enabled and a model is Active.

---

## Territory Hierarchy Traversal in Apex

For hierarchies deeper than 5 levels (the SOQL relationship query limit), use Apex recursion:

```apex
public static List<Territory2> getAllDescendants(Id rootTerritoryId) {
    List<Territory2> result = new List<Territory2>();
    Set<Id> toProcess = new Set<Id>{ rootTerritoryId };
    Set<Id> visited = new Set<Id>();
    Integer maxDepth = 20; // Guard against runaway recursion
    Integer depth = 0;

    while (!toProcess.isEmpty() && depth < maxDepth) {
        visited.addAll(toProcess);
        List<Territory2> children = [
            SELECT Id, Name, ParentTerritory2Id
            FROM Territory2
            WHERE ParentTerritory2Id IN :toProcess
        ];
        result.addAll(children);
        toProcess.clear();
        for (Territory2 t : children) {
            if (!visited.contains(t.Id)) {
                toProcess.add(t.Id);
            }
        }
        depth++;
    }
    return result;
}
```

This pattern handles unlimited hierarchy depth within governor limits (100 SOQL queries per transaction). For extremely deep or wide hierarchies, use a Queueable or Batch Apex pattern.

---

## Territory User Membership Report (SOQL → CSV pattern)

For territory coverage audits (e.g., before a realignment), generate a full membership snapshot:

```apex
List<UserTerritory2Association> memberships = [
    SELECT Territory2.Name, Territory2.Territory2Type.Name,
           User.Name, User.Email, RoleInTerritory2
    FROM UserTerritory2Association
    WHERE Territory2.Territory2Model.State = 'Active'
    AND IsActive = true
    ORDER BY Territory2.Name, RoleInTerritory2, User.Name
];

// Output to debug log or serialize to a ContentVersion for download
for (UserTerritory2Association m : memberships) {
    System.debug(m.Territory2.Name + ',' + m.User.Name + ',' + m.RoleInTerritory2);
}
```
