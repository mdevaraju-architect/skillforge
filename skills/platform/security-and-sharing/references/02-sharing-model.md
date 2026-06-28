# Sharing Model — OWD, Role Hierarchy, Sharing Rules, Apex Managed Sharing

## Organization-Wide Defaults (OWD)

### Accessing OWD Settings

**Setup → Sharing Settings** — the OWD section at the top of the page lists every object and its current default.

### OWD Values and When to Use Each

| Setting | Use case |
|---|---|
| **Private** | Records must be visible only to the owner, their role hierarchy, and explicitly shared users. Correct for sensitive data (financial, health, PII). |
| **Public Read Only** | All users need to view records but only the owner should edit. Common for Products, Pricebooks, Knowledge articles. |
| **Public Read/Write** | All users need to view and edit all records. Common for low-sensitivity shared reference data. |
| **Controlled by Parent** | Detail side of a master-detail. Access mirrors the master record automatically. |

### Changing OWD — Side Effects

1. After any OWD change, Salesforce runs an asynchronous **sharing recalculation** job that re-evaluates all sharing rules, role hierarchy access, and team sharing for the affected object. This can take minutes to hours in large orgs.
2. Changing OWD from Public to Private immediately restricts access. Records that were previously accessible to all users become inaccessible until sharing is explicitly granted via rules, hierarchy, or Apex.
3. Monitor sharing recalculation in **Setup → Recalculate** button or via the Apex Share Recalculation log.

### Grant Access Using Hierarchies

Each object OWD has a checkbox "Grant Access Using Hierarchies." When checked, users in superior roles in the role hierarchy can see records owned by subordinate users even if OWD is Private.

- **Standard objects**: Always enabled, cannot be unchecked.
- **Custom objects**: Can be unchecked to prevent role hierarchy from granting access. Useful when records must remain accessible only to the owner and explicit shares, never to managers.

---

## Role Hierarchy

### Setup

**Setup → Roles** — roles are arranged in a tree. Each role can have a parent role (its superior).

Users are assigned to roles on their user record. A user can have only one role. Roles can be assigned to:
- Individual users
- Queue membership (queues can be associated with roles)
- Sharing rules (as "role" or "role and subordinates" share targets)

### How Role Hierarchy Sharing Works

When User B owns a record and User A is in a role that is a parent (direct or indirect) of User B's role:
- User A inherits at minimum the same access level as User B on that record (up to their profile CRUD permissions)
- This happens automatically — no sharing rule or Apex is needed
- The `AccountShare` / share object for that record will show a row with `RowCause = 'Role'` or `'RoleAndSubordinates'`

---

## Sharing Rules

### Owner-Based Sharing Rules

Grant access to records based on the owner's role, role-and-subordinates, or public group membership.

**Example:** "Share all Accounts owned by users in the 'West Coast Sales' role with users in the 'East Coast Support' public group, with Read Only access."

**When they apply:** When a record's owner changes such that the new owner satisfies (or no longer satisfies) the "From" condition of the rule.

**Re-evaluation:** Owner-based rules are re-evaluated on ownership change and on OWD/sharing recalculation. They do NOT re-evaluate when non-owner fields on the record change.

**Setup:** Sharing Settings → [Object] Sharing Rules → New → Based on Record Owner

### Criteria-Based Sharing Rules

Grant access to records based on field values on the record itself, regardless of who owns it.

**Example:** "Share all Opportunities where `Stage__c = 'Closed Won'` with the 'Finance Team' public group, with Read Only access."

**When they apply:**
- When the criteria field(s) change (e.g. `Stage__c` is updated to `Closed Won`)
- When the record is created and matches criteria
- During sharing recalculation

**Re-evaluation trigger:** Every time a field used in the criteria is updated via any mechanism (user edit, flow, trigger, API). This is synchronous in the same transaction.

**Important behavior:** If a field update causes a record to NO LONGER match the criteria, the platform removes the criteria-based share. Users who had access because of that criteria will lose access in the same transaction. This is the expected behavior but frequently surprises teams.

**Setup:** Sharing Settings → [Object] Sharing Rules → New → Based on Criteria

### Sharing Rule Limits

- Up to 300 sharing rules per object (owner-based + criteria-based combined)
- Up to 50 criteria-based sharing rules per object
- Guest user sharing rules on Experience Cloud have separate, stricter limits

---

## Team-Based Sharing

### Account Teams

An Account Team is a set of users who work together on an Account. Each team member can be granted Read Only or Read/Write access to the Account, its Opportunities, and its Cases.

- Account owners manage their account team
- Team members appear on the `AccountShare` object with `RowCause = 'Team'`
- Account Team roles are separate from the role hierarchy

### Opportunity Teams

Similar structure for Opportunities. Team members are granted access to the specific Opportunity record. `OpportunityShare` rows with `RowCause = 'Team'`.

---

## Manual Sharing

Manual sharing allows record owners (and admins/users with "Modify All" permission) to share individual records with specific users or groups from the UI.

**Accessed via:** The **Sharing** button on a record detail page (must be enabled in org settings).

**RowCause:** `Manual` — this is the critical distinction from Apex managed sharing.

**Deleted on owner change:** YES. When a record is reassigned to a new owner, ALL `Manual` RowCause shares are deleted. The new owner must re-create manual shares if needed. This is a known platform behavior that causes support tickets.

**Deleted when user revokes:** YES. Any user who was granted manual share access can also have the share revoked by the record owner via the Sharing button.

---

## Apex Managed Sharing

Apex managed sharing allows code to programmatically grant access to records by inserting rows into Share objects. It is the only sharing mechanism that uses custom RowCause values.

### Custom RowCause (Share Reason) Setup

1. **Setup → Object Manager → [Object] → Sharing Reasons → New**
2. Enter a Label (e.g. "Integration Share") and Name (developer name, e.g. `IntegrationShare`)
3. This creates the token `IntegrationShare__c` usable in the `RowCause` field on `[Object]__Share`

### Custom Object Share Object DML

```apex
// Grant Edit access to a custom object record for a specific user
MyObject__Share share = new MyObject__Share();
share.ParentId = recordId;
share.UserOrGroupId = targetUserId;
share.AccessLevel = 'Edit';       // 'Read', 'Edit', or 'All' (All only for Account)
share.RowCause = Schema.MyObject__Share.RowCause.IntegrationShare__c;

Database.SaveResult result = Database.insert(share, false);
if (!result.isSuccess()) {
    for (Database.Error err : result.getErrors()) {
        // Handle error — common cause: duplicate share (same ParentId + UserOrGroupId + RowCause)
        System.debug('Share insert error: ' + err.getMessage());
    }
}
```

### Standard Object Share Object DML

```apex
// Grant Read access to an Account for a specific user
AccountShare accShare = new AccountShare();
accShare.AccountId = accountId;
accShare.UserOrGroupId = targetUserId;
accShare.AccountAccessLevel = 'Read';
accShare.OpportunityAccessLevel = 'None';  // Required field on AccountShare
accShare.CaseAccessLevel = 'None';         // Required field on AccountShare
accShare.RowCause = Schema.AccountShare.RowCause.Manual;
// NOTE: Using Manual here — for Apex managed sharing, use a custom RowCause instead
```

### Querying Existing Shares

Before inserting, always check for existing shares to avoid duplicate errors and to identify stale shares to delete:

```apex
List<MyObject__Share> existingShares = [
    SELECT Id, UserOrGroupId, AccessLevel
    FROM MyObject__Share
    WHERE ParentId IN :recordIds
    AND RowCause = :Schema.MyObject__Share.RowCause.IntegrationShare__c
];

// Build a map of existing shares for comparison
Map<Id, Map<Id, MyObject__Share>> existingShareMap = new Map<Id, Map<Id, MyObject__Share>>();
for (MyObject__Share s : existingShares) {
    if (!existingShareMap.containsKey(s.ParentId)) {
        existingShareMap.put(s.ParentId, new Map<Id, MyObject__Share>());
    }
    existingShareMap.get(s.ParentId).put(s.UserOrGroupId, s);
}
```

### Deleting Stale Shares

When access is revoked, delete the corresponding share rows. Leaving stale shares accumulates over time and causes incorrect access.

```apex
List<MyObject__Share> sharesToDelete = [
    SELECT Id
    FROM MyObject__Share
    WHERE ParentId = :recordId
    AND RowCause = :Schema.MyObject__Share.RowCause.IntegrationShare__c
    AND UserOrGroupId = :removedUserId
];
if (!sharesToDelete.isEmpty()) {
    delete sharesToDelete;
}
```

### Full Apex Managed Sharing Pattern (Trigger-Based)

```apex
// Trigger: after insert, after update on MyObject__c
trigger MyObjectSharingTrigger on MyObject__c (after insert, after update) {
    MyObjectSharingService.processSharingChanges(Trigger.new, Trigger.oldMap);
}

// Service class
public with sharing class MyObjectSharingService {

    public static void processSharingChanges(
        List<MyObject__c> newRecords,
        Map<Id, MyObject__c> oldMap
    ) {
        Set<Id> recordIds = new Set<Id>();
        for (MyObject__c rec : newRecords) {
            // Only reprocess sharing if the relevant field changed
            if (oldMap == null || rec.ShareWithUser__c != oldMap.get(rec.Id).ShareWithUser__c) {
                recordIds.add(rec.Id);
            }
        }
        if (recordIds.isEmpty()) return;

        // Delete stale shares for affected records
        List<MyObject__Share> staleShares = [
            SELECT Id FROM MyObject__Share
            WHERE ParentId IN :recordIds
            AND RowCause = :Schema.MyObject__Share.RowCause.IntegrationShare__c
        ];
        if (!staleShares.isEmpty()) delete staleShares;

        // Insert new shares
        List<MyObject__Share> newShares = new List<MyObject__Share>();
        for (MyObject__c rec : newRecords) {
            if (recordIds.contains(rec.Id) && rec.ShareWithUser__c != null) {
                MyObject__Share s = new MyObject__Share();
                s.ParentId = rec.Id;
                s.UserOrGroupId = rec.ShareWithUser__c;
                s.AccessLevel = 'Edit';
                s.RowCause = Schema.MyObject__Share.RowCause.IntegrationShare__c;
                newShares.add(s);
            }
        }
        if (!newShares.isEmpty()) {
            Database.insert(newShares, false);
        }
    }
}
```

### Testing Apex Managed Sharing

```apex
@isTest
private class MyObjectSharingServiceTest {
    @isTest
    static void testShareGranted() {
        User targetUser = [SELECT Id FROM User WHERE Profile.Name = 'Standard User' LIMIT 1];
        MyObject__c rec = new MyObject__c(ShareWithUser__c = targetUser.Id, Name = 'Test');
        insert rec;

        // Verify share record was created
        List<MyObject__Share> shares = [
            SELECT Id, AccessLevel, RowCause
            FROM MyObject__Share
            WHERE ParentId = :rec.Id
            AND UserOrGroupId = :targetUser.Id
            AND RowCause = :Schema.MyObject__Share.RowCause.IntegrationShare__c
        ];
        System.assertEquals(1, shares.size(), 'Expected 1 share record');
        System.assertEquals('Edit', shares[0].AccessLevel);

        // Verify user can actually access the record
        System.runAs(targetUser) {
            List<MyObject__c> visible = [SELECT Id FROM MyObject__c WHERE Id = :rec.Id];
            System.assertEquals(1, visible.size(), 'Target user should see the record');
        }
    }
}
```

### Sharing Recalculation

When an OWD changes or a large batch of sharing rules is modified, Salesforce runs an asynchronous sharing recalculation job. This job:
- Re-evaluates all sharing rules for the object
- Re-evaluates role hierarchy access
- Does NOT re-evaluate Apex managed sharing (custom RowCause rows are preserved)

You can manually trigger recalculation from **Setup → Sharing Settings → Recalculate** next to an object's sharing rules. In Apex, you can invoke it via `Database.executeBatch(new RecalculateSharingRules())` (this is a platform-provided mechanism, not custom code).

---

## Granting Access to Groups vs Individual Users

The `UserOrGroupId` field on share objects accepts:
- User ID (`005xx...`) — grants access to a specific user
- Public Group ID (`00Gxx...`) — grants access to all members of the group
- Role ID (`00Exx...`) — grants access to all users in that role
- RoleAndSubordinates ID (`00Exx...` with a special type) — grants access to the role and all subordinate roles

Using groups and roles is strongly preferred over individual user IDs in sharing rules to avoid stale access when users change roles or leave the org.
