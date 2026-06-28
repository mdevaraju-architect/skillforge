# FLS, CRUD, Permission Sets, and Profiles

## Field-Level Security (FLS) in Apex

### The Core Problem

By default, Apex runs in **system context** — it ignores FLS, object-level CRUD, and sharing rules. This means:

```apex
// This query returns Account.AnnualRevenue even if the running user
// cannot see AnnualRevenue in the UI. This is a security vulnerability.
List<Account> accounts = [SELECT Id, Name, AnnualRevenue FROM Account];
```

The Apex security model has three mechanisms to enforce FLS. Choose based on behavior requirements.

---

### Option 1: `WITH SECURITY_ENFORCED`

Added in API v48.0. Appended to a SOQL query. If ANY field or object in the query is inaccessible to the running user, the query throws `System.QueryException: Not accessible`.

```apex
try {
    List<Account> accounts = [
        SELECT Id, Name, AnnualRevenue, Phone
        FROM Account
        WHERE Industry = 'Technology'
        WITH SECURITY_ENFORCED
    ];
} catch (System.QueryException e) {
    // One or more fields are inaccessible to the running user
    throw new AuraHandledException('Access denied: ' + e.getMessage());
}
```

**When to use:** When partial data would cause incorrect behavior and you need a hard failure. Good for financial calculations, report generation, or any case where missing fields would produce wrong results.

**Limitations:**
- Does not cover fields in subqueries on some relationship patterns
- Throws on any inaccessible field, which can be fragile if field access varies by profile

---

### Option 2: `WITH USER_MODE`

Added in API v55.0. Enforces both FLS and object-level sharing. Inaccessible fields are silently returned as `null`. Queries against inaccessible objects return empty results without error.

```apex
// Fields the user cannot see are returned as null — no exception thrown
List<Account> accounts = [
    SELECT Id, Name, AnnualRevenue, Phone
    FROM Account
    WITH USER_MODE
];

// Also works for DML
insert as user new Account(Name = 'Test');   // Enforces CRUD
```

**When to use:** When graceful degradation is acceptable — the UI can display what's available, and null fields are handled. Good for LWC wire calls, display-only Apex, and cases where users with different profiles use the same code path.

**`USER_MODE` for DML:**
```apex
// Enforces object-level Create permission. Throws if user cannot create Account.
insert as user accountList;

// Enforces object-level Update permission.
update as user accountList;
```

---

### Option 3: Explicit `Schema.describe` Checks

Most verbose but most flexible. Use when you need per-field conditional logic rather than a blanket fail or strip.

```apex
public static Boolean isFieldReadable(SObjectType objType, String fieldName) {
    Schema.DescribeFieldResult dfr = objType.getDescribe()
        .fields.getMap()
        .get(fieldName)
        ?.getDescribe();
    return dfr != null && dfr.isAccessible();
}

public static Boolean isFieldWritable(SObjectType objType, String fieldName) {
    Schema.DescribeFieldResult dfr = objType.getDescribe()
        .fields.getMap()
        .get(fieldName)
        ?.getDescribe();
    return dfr != null && dfr.isUpdateable();
}

// Usage
if (isFieldReadable(Account.SObjectType, 'AnnualRevenue')) {
    // Safe to read
    System.debug(account.AnnualRevenue);
}
```

**`DescribeFieldResult` key methods:**
| Method | Checks |
|---|---|
| `isAccessible()` | User can read this field |
| `isCreateable()` | User can set this field on insert |
| `isUpdateable()` | User can modify this field on update |
| `isFilterable()` | Field can be used in SOQL WHERE |
| `isEncrypted()` | Field is Shield-encrypted |

---

### Option 4: `Security.stripInaccessible()`

API v49.0+. Strips inaccessible fields from SObject records before or after DML. Returns a `SObjectAccessDecision` object.

```apex
// Before reading — strip fields user cannot read
SObjectAccessDecision decision = Security.stripInaccessible(
    AccessType.READABLE,
    [SELECT Id, Name, AnnualRevenue, SSN__c FROM Account WHERE Id = :accountId]
);
List<Account> safeAccounts = (List<Account>) decision.getRecords();
// safeAccounts has AnnualRevenue and SSN__c nulled out if user cannot read them

// Before insert — strip fields user cannot create
List<Account> incoming = getIncomingAccountData();
SObjectAccessDecision createDecision = Security.stripInaccessible(
    AccessType.CREATABLE,
    incoming
);
insert createDecision.getRecords();

// Before update — strip fields user cannot update
SObjectAccessDecision updateDecision = Security.stripInaccessible(
    AccessType.UPDATABLE,
    incoming
);
update updateDecision.getRecords();
```

**`AccessType` enum values:**
| Value | Strips fields where |
|---|---|
| `READABLE` | `isAccessible()` = false |
| `CREATABLE` | `isCreateable()` = false |
| `UPDATABLE` | `isUpdateable()` = false |
| `UPSERTABLE` | `isCreateable()` = false OR `isUpdateable()` = false |

**Getting removed fields:**
```apex
SObjectAccessDecision d = Security.stripInaccessible(AccessType.READABLE, records);
Map<String, Set<String>> removedFields = d.getRemovedFields();
// removedFields = { 'Account' => { 'AnnualRevenue', 'SSN__c' } }
```

---

## CRUD Enforcement in Apex

### Object-Level CRUD Check Pattern

```apex
public class AccountService {

    public static void createAccount(Account acc) {
        // Check Create permission before insert
        if (!Schema.SObjectType.Account.isCreateable()) {
            throw new AuraHandledException(
                'Insufficient permissions to create Account records.'
            );
        }
        insert acc;
    }

    public static void updateAccount(Account acc) {
        // Check Update permission before update
        if (!Schema.SObjectType.Account.isUpdateable()) {
            throw new AuraHandledException(
                'Insufficient permissions to update Account records.'
            );
        }
        update acc;
    }

    public static void deleteAccount(Id accountId) {
        // Check Delete permission before delete
        if (!Schema.SObjectType.Account.isDeletable()) {
            throw new AuraHandledException(
                'Insufficient permissions to delete Account records.'
            );
        }
        delete new Account(Id = accountId);
    }
}
```

**`SObjectType.getDescribe()` key methods:**
| Method | Checks |
|---|---|
| `isAccessible()` | User can read this object (view records) |
| `isCreateable()` | User can create new records |
| `isUpdateable()` | User can edit existing records |
| `isDeletable()` | User can delete records |
| `isQueryable()` | Object can be used in SOQL |

---

## Permission Sets

### What Permission Sets Are

A permission set is a collection of settings and permissions that extend a user's functional access without changing their profile. Every user can have multiple permission sets.

### What Permission Sets Can and Cannot Do

**Can do:**
- Grant object-level CRUD (Create, Read, Edit, Delete, View All, Modify All)
- Grant field-level Read access and Edit access
- Grant system permissions (e.g. ViewAllData, ManageUsers, AuthorApex)
- Grant app access and tab visibility
- Grant access to Apex classes and Visualforce pages

**Cannot do:**
- Revoke a permission granted by the user's profile
- Reduce FLS (e.g. cannot remove Edit access from a field the profile grants Edit on)
- Set login hours or login IP ranges (those are profile-only)
- Set page layout assignments (profile-only)

### Creating a Permission Set (Metadata API)

```xml
<!-- permissionsets/MyIntegrationPermSet.permissionset-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>My Integration Permission Set</label>
    <description>Grants API access and Account read for the integration user.</description>
    <hasActivationRequired>false</hasActivationRequired>
    <userLicense>Salesforce Integration</userLicense>
    <objectPermissions>
        <allowCreate>false</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>false</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>Account</object>
        <viewAllRecords>true</viewAllRecords>
    </objectPermissions>
    <fieldPermissions>
        <editable>false</editable>
        <field>Account.AnnualRevenue</field>
        <readable>true</readable>
    </fieldPermissions>
    <systemPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </systemPermissions>
</PermissionSet>
```

### Assigning a Permission Set via Apex

```apex
// Assign a permission set to a user programmatically
PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'MyIntegrationPermSet'];
PermissionSetAssignment psa = new PermissionSetAssignment(
    AssigneeId = targetUserId,
    PermissionSetId = ps.Id
);
insert psa;
```

### Assigning via SFDX CLI

```bash
sf org assign permset --name MyIntegrationPermSet --target-org myOrgAlias
```

---

## Permission Set Groups

A Permission Set Group (PSG) aggregates multiple permission sets into a single assignable unit. Effective permissions are the union of all included permission sets.

### Creating a PSG

**Setup → Permission Set Groups → New**

Or via metadata:
```xml
<!-- permissionsetgroups/MyPSGroup.permissionsetgroup-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSetGroup xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>My PS Group</label>
    <description>Groups standard and custom permissions for the Sales role.</description>
    <permissionSets>
        <permissionSet>StandardSalesPermSet</permissionSet>
        <permissionSet>AccountReadPermSet</permissionSet>
        <permissionSet>OpportunityEditPermSet</permissionSet>
    </permissionSets>
    <mutingPermissionSets>
        <!-- Muting PS requires specific license; rarely used -->
    </mutingPermissionSets>
    <hasActivationRequired>false</hasActivationRequired>
    <status>Updated</status>
</PermissionSetGroup>
```

### PSG Status Field

PSGs have a `Status` field:
- `Updated` — the PSG is ready and includes the latest permissions from all included PSets
- `Outdated` — one or more included PSets have changed; the PSG must be recalculated
- Recalculation happens automatically but can be triggered manually: **Setup → Permission Set Groups → [Group] → Recalculate**

---

## Profiles (Legacy Model)

### Profile Capabilities

Every user has exactly one profile. Profiles control:
- Object CRUD
- Field-level Read/Edit
- System permissions
- Login hours (time-of-day restrictions)
- Login IP ranges
- App visibility
- Tab visibility
- Page layout assignments
- Record type assignments

### Why Profiles Alone Are Insufficient

1. A user can have only one profile. As access needs diversify (the same user needs different permissions for different apps), the org ends up with an explosion of near-duplicate profiles.
2. Profiles must be cloned and managed as separate XML files in version control. Any change affects all users on that profile.
3. The industry best practice is **Minimum Access (Salesforce) profile** assigned to everyone, with all actual permissions granted via permission sets. This model is sometimes called the "profile zero" or "min-access" pattern.

### Minimum Access Pattern

```
Profile: Minimum Access - Salesforce
  → Grants: Login to org, basic UI navigation
  → Grants: Nothing object/field specific

Permission Set: Account Read
Permission Set: Opportunity Edit
Permission Set: Custom App Access
Permission Set: API Enabled
  → All assigned to user individually or via PSG
```

This pattern:
- Makes permissions auditable per feature
- Enables adding/removing access without profile changes
- Simplifies onboarding and offboarding (assign/remove PSets)

---

## Field Encryption vs FLS — Critical Distinction

These are two completely separate mechanisms that are sometimes confused:

| Mechanism | What it does | Who controls it |
|---|---|---|
| **FLS** | Hides field values from users in the UI and (when enforced) in Apex queries | Admins via Profile / Permission Sets |
| **Shield Encryption** | Encrypts field data at rest in the database; the Salesforce platform cannot read plaintext without the tenant key | Encryption Policy + tenant key management |

A field can be:
- FLS-restricted but not encrypted (user cannot see it in UI, but data is stored as plaintext in DB)
- Encrypted but not FLS-restricted (user can see plaintext value, but DB stores ciphertext)
- Both encrypted and FLS-restricted (correct for maximum protection of sensitive fields)
- Neither (standard, visible, unencrypted field)

For PCI-DSS, HIPAA, and GDPR compliance involving sensitive data, both FLS restriction AND Shield encryption should typically be applied together.
