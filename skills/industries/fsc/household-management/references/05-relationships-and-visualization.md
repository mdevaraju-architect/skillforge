# FSC Household Management — Relationships and Visualization

This reference covers the `Relationship__c` FSC Contact relationship junction, how it differs from `AccountContactRelation`, the FSC relationship map visualization, managing reciprocal pairs, and SOQL patterns.

---

## Relationship__c — FSC Contact Relationship Junction

### What It Is

`Relationship__c` models an interpersonal relationship between two Contacts — for example, John Smith is the Spouse of Jane Smith, or John Smith is the Father of Emily Smith. It is a junction object with two Contact lookups and a relationship type.

`Relationship__c` is strictly about the relationship *between two people*. It does not control household membership. Household membership is modeled exclusively via `AccountContactRelation`.

### Relationship__c — Field Table

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Contact | `Contact__c` | Lookup (Contact) | "This" Contact in the relationship |
| Related Contact | `RelatedContact__c` | Lookup (Contact) | "That" Contact in the relationship |
| Type | `Type__c` | Picklist | The relationship type (see values below) |
| Related Contact Role | `RelatedContactRole__c` | Picklist | The reciprocal relationship type label |
| Is Active | `IsActive__c` | Boolean | `true` for current relationships, `false` for ended ones |
| Relationship Details | `RelationshipDetails__c` | Text Area | Free-text notes |
| Start Date | `StartDate__c` | Date | When this relationship began |
| End Date | `EndDate__c` | Date | When this relationship ended |

> Note: FSC field API names for `Relationship__c` may use a `__c` suffix (custom fields in the FSC managed package) or standard API names, depending on the FSC version. Always verify in Setup > Object Manager > Relationship > Fields.

### Type Picklist Standard Values

| Type Value | Reciprocal Value | Description |
|---|---|---|
| `Spouse` | `Spouse` | Married spouse |
| `Partner` | `Partner` | Domestic partner or life partner |
| `Child` | `Parent` | Child of the related Contact |
| `Parent` | `Child` | Parent of the related Contact |
| `Sibling` | `Sibling` | Brother or sister |
| `Grandchild` | `Grandparent` | Grandchild of the related Contact |
| `Grandparent` | `Grandchild` | Grandparent of the related Contact |
| `Business Partner` | `Business Partner` | Business co-owner or partner |
| `Employer` | `Employee` | Employer of the related Contact |
| `Employee` | `Employer` | Employee of the related Contact |
| `Colleague` | `Colleague` | Work colleague |
| `Friend` | `Friend` | Personal friend |
| `Trustee` | `Beneficiary` | Trustee relationship to a trust beneficiary |
| `Power of Attorney` | `Grantor` | POA holder and the person who granted POA |
| `Guardian` | `Ward` | Legal guardian and the ward |
| `Accountant` | `Client` | Professional accountant relationship |
| `Attorney` | `Client` | Legal attorney relationship |
| `Other` | `Other` | Custom relationship not covered by standard types |

---

## Difference Between Relationship__c and AccountContactRelation

This is one of the most commonly confused distinctions in FSC.

| Aspect | `AccountContactRelation` | `Relationship__c` |
|---|---|---|
| Purpose | Household/group membership | Interpersonal relationship between two Contacts |
| Objects Linked | Account (household) ↔ Contact | Contact ↔ Contact |
| Question Answered | "Is this person a member of this household?" | "What is the relationship between these two people?" |
| Used by FSC Rollup | Yes — ACR drives household membership rollup | No |
| Used by Relationship Map | Yes — defines who is in the household node | Yes — defines edges between person nodes |
| Ends a Relationship | Set `IsActive = false` | Set `IsActive__c = false` |
| Reciprocal Record | No — one record per membership | Yes — FSC auto-creates a reciprocal record |

**Example:**
- John Smith is a member of the Smith Household → this is modeled as an `AccountContactRelation` record.
- John Smith is the Spouse of Jane Smith → this is modeled as a `Relationship__c` record.
- Both ACR and Relationship__c are needed for a complete FSC household view.

---

## FSC Relationship Map

### What the Relationship Map Shows

The FSC Relationship Map (available on the Household Account page via the FSC Lightning component) is a graph visualization that displays:

1. **The Household node** — centered, labeled with the Household Account name.
2. **Member nodes** — each active ACR member appears as a person node connected to the household.
3. **Interpersonal edges** — `Relationship__c` records create labeled edges between person nodes (e.g. "Spouse", "Child").
4. **Financial Account nodes** — FinancialAccount records linked to the household or members may appear as additional nodes (varies by FSC version and map configuration).

### What Drives the Relationship Map Display

| Data Source | What It Drives |
|---|---|
| `AccountContactRelation` (IsActive = true) | Who appears as a member node in the map |
| `Relationship__c` (IsActive__c = true) | Edges and labels between person nodes |
| `AccountContactRelation.Roles` | Role label displayed under each member node |
| `FinancialAccount.PrimaryOwner` | Financial account nodes (if enabled) |
| `Contact.Deceased__c` | Deceased icon/indicator on person node |

### Why the Relationship Map May Not Render Correctly

- Member is missing from map → check that `AccountContactRelation.IsActive = true` for that member
- No edges between members → check that `Relationship__c` records exist with `IsActive__c = true`
- Deceased member still showing as active → check that both `Contact.Deceased__c = true` and `ACR.IsActive = false`
- Relationship label is wrong → check `Relationship__c.Type__c` value; FSC uses Type to render the edge label
- FSC map not loading at all → verify the FSC Lightning component is added to the Household Account page layout, and that the user has FSC permission set assigned

---

## Reciprocal Relationship Auto-Creation

FSC automatically creates a reciprocal `Relationship__c` record when you create a relationship. For example, creating:

```
Contact__c = John (Child record)
RelatedContact__c = Jane (Parent record)
Type__c = 'Spouse'
```

FSC creates an automatic reciprocal:

```
Contact__c = Jane
RelatedContact__c = John
Type__c = 'Spouse'
```

### Managing Reciprocals

- When you update a `Relationship__c` record, update the reciprocal too (FSC may or may not automatically sync updates depending on version).
- When you end a relationship (`IsActive__c = false` or `EndDate__c = today`), also end the reciprocal record.
- Do not create manual reciprocal records if FSC auto-creates them — this creates duplicate relationship pairs.
- To check whether FSC auto-reciprocal is enabled in your org: **Setup > Financial Services Cloud > Relationship Settings > Auto-create reciprocal relationships**.

### Creating a Relationship — Apex

```apex
// Create the primary relationship record
Relationship__c spouseRel = new Relationship__c(
    Contact__c = johnContactId,
    RelatedContact__c = janeContactId,
    Type__c = 'Spouse',
    IsActive__c = true,
    StartDate__c = Date.newInstance(1995, 6, 15)
);
insert spouseRel;
// FSC will auto-create the reciprocal Jane → John relationship (if enabled)
```

```apex
// Parent-child relationship
Relationship__c parentChild = new Relationship__c(
    Contact__c = johnContactId,
    RelatedContact__c = emilyContactId,
    Type__c = 'Parent',
    IsActive__c = true
);
insert parentChild;
// Reciprocal: Emily → John = 'Child' (auto-created by FSC)
```

---

## Ending Relationships

### Divorce / Separation

```apex
// Find John and Jane's Relationship__c records (both directions)
List<Relationship__c> marriageRels = [
    SELECT Id, IsActive__c, EndDate__c
    FROM Relationship__c
    WHERE (
        (Contact__c = :johnContactId AND RelatedContact__c = :janeContactId)
        OR (Contact__c = :janeContactId AND RelatedContact__c = :johnContactId)
    )
    AND Type__c = 'Spouse'
    AND IsActive__c = true
];

for (Relationship__c rel : marriageRels) {
    rel.IsActive__c = false;
    rel.EndDate__c = Date.today();
}
update marriageRels;

// Also deactivate Jane's ACR in the Smith Household if she is moving out
AccountContactRelation janeACR = [
    SELECT Id FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND ContactId = :janeContactId
    LIMIT 1
];
janeACR.IsActive = false;
update janeACR;
```

### Death of a Contact

```apex
// Deactivate all active relationships for the deceased
List<Relationship__c> activeRels = [
    SELECT Id, IsActive__c, EndDate__c
    FROM Relationship__c
    WHERE (Contact__c = :deceasedContactId OR RelatedContact__c = :deceasedContactId)
    AND IsActive__c = true
];
for (Relationship__c rel : activeRels) {
    rel.IsActive__c = false;
    rel.EndDate__c = Date.today();
}
update activeRels;
```

Never delete `Relationship__c` records — preserve for compliance history.

---

## AccountContactRelation Roles That Affect Relationship Map Display

Certain ACR `Roles` values affect how the FSC Relationship Map renders member nodes:

| ACR Role | Map Effect |
|---|---|
| `Head of Household` | May be rendered with a distinct visual indicator as the primary node |
| `Member` | Standard member node |
| `Power of Attorney` | May display POA indicator depending on FSC version and map config |
| `Decision Maker` | Displayed as a labeled role under the member node |

The map's exact rendering of ACR roles depends on the FSC version and any custom map configuration in your org.

---

## SOQL — Relationship Queries

### All Active Relationships for a Contact (Both Directions)

```soql
SELECT Id, Type__c, IsActive__c, RelatedContact.Name, RelatedContact.AccountId,
       StartDate__c, EndDate__c
FROM Relationship__c
WHERE Contact__c = :contactId
AND IsActive__c = true
ORDER BY Type__c
```

```soql
-- Also query the reverse direction
SELECT Id, Type__c, IsActive__c, Contact.Name, Contact.AccountId,
       StartDate__c, EndDate__c
FROM Relationship__c
WHERE RelatedContact__c = :contactId
AND IsActive__c = true
ORDER BY Type__c
```

### Combined Both Directions — Apex

```apex
List<Relationship__c> outbound = [
    SELECT Id, Type__c, RelatedContact__c, RelatedContact.Name, IsActive__c
    FROM Relationship__c
    WHERE Contact__c = :contactId
    AND IsActive__c = true
];

List<Relationship__c> inbound = [
    SELECT Id, Type__c, Contact__c, Contact.Name, IsActive__c
    FROM Relationship__c
    WHERE RelatedContact__c = :contactId
    AND IsActive__c = true
];

// Combine for a full relationship graph view
List<Relationship__c> allRelationships = new List<Relationship__c>();
allRelationships.addAll(outbound);
allRelationships.addAll(inbound);
```

### All Household Members and Their Interpersonal Relationships

```apex
// Step 1: Get all active member Contacts in the household
List<AccountContactRelation> acrs = [
    SELECT ContactId, Roles
    FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND IsActive = true
];

Set<Id> memberContactIds = new Set<Id>();
for (AccountContactRelation acr : acrs) {
    memberContactIds.add(acr.ContactId);
}

// Step 2: Get all Relationship__c records where both Contacts are household members
List<Relationship__c> memberRelationships = [
    SELECT Id, Type__c, Contact__c, Contact.Name,
           RelatedContact__c, RelatedContact.Name, IsActive__c
    FROM Relationship__c
    WHERE Contact__c IN :memberContactIds
    AND RelatedContact__c IN :memberContactIds
    AND IsActive__c = true
];
```

### Check for Reciprocal Pair Existence

```soql
SELECT Id, Type__c, Contact__c, RelatedContact__c
FROM Relationship__c
WHERE (
    (Contact__c = :contactAId AND RelatedContact__c = :contactBId)
    OR (Contact__c = :contactBId AND RelatedContact__c = :contactAId)
)
```
