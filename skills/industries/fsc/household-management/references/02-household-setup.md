# FSC Household Management — Household Setup and Membership

This reference covers creating Household Accounts, enabling Person Accounts, managing household membership via AccountContactRelation, and common patterns for address management and complex household scenarios.

---

## IndustriesHousehold RecordType

### What It Is

The `IndustriesHousehold` RecordType on the `Account` object activates the full FSC Household view, FSC rollup engine, and relationship map visualization. Without this RecordType, an Account is treated as a plain Salesforce Account and FSC household components do not render.

### Querying the RecordType

Always look up the RecordType by `DeveloperName` — do not hardcode the RecordTypeId, which differs between orgs:

```soql
SELECT Id, DeveloperName, Name
FROM RecordType
WHERE SObjectType = 'Account'
AND DeveloperName = 'IndustriesHousehold'
LIMIT 1
```

`DeveloperName` = `IndustriesHousehold` (this is stable across FSC installs).
`Name` (label) may be customized per org (e.g. "Household", "Financial Household", "FSC Household").

### Page Layout Assignment

After creating a Household Account RecordType, assign the FSC-provided Household page layout in:
**Setup > Object Manager > Account > Page Layouts > Record Type Assignments**

The FSC managed package includes a `Household Account Layout` that surfaces FSC-specific components (Household Members, Relationship Map, Financial Account Summary). Use this layout or clone it for customizations — do not use the standard Account layout for households, as it omits FSC components.

### Creating a Household Account — Apex

```apex
RecordType rt = [
    SELECT Id FROM RecordType
    WHERE SObjectType = 'Account'
    AND DeveloperName = 'IndustriesHousehold'
    LIMIT 1
];

Account household = new Account(
    Name = 'Johnson Household',
    RecordTypeId = rt.Id,
    BillingStreet = '456 Oak Avenue',
    BillingCity = 'Chicago',
    BillingState = 'IL',
    BillingPostalCode = '60601',
    BillingCountry = 'US'
);
insert household;
```

### Household Naming Conventions

FSC does not enforce a naming convention, but the following patterns are widely used:

| Pattern | Example | Notes |
|---|---|---|
| `[LastName] Household` | `Smith Household` | Most common; simple and searchable |
| `[LastName] Family` | `Johnson Family` | Used in some FSC implementations |
| `[LastName], [FirstName] + [Spouse]` | `Smith, John & Jane` | More specific; good for common last names |
| `[Trust Name]` | `Smith Family Trust` | For trust-as-household scenarios |

Pick one convention and enforce it via validation rule or flow — inconsistent naming causes duplicate household creation.

---

## Person Accounts

### Enabling Person Accounts

Person Accounts must be enabled for full FSC household functionality. The FSC individual member model is built on Person Accounts (`IsPersonAccount = true`). Standard Contacts linked to Business Accounts do not support the FSC individual profile view.

**Enabling Person Accounts is a one-way, irreversible operation.** There is no undo. Before enabling:

1. Plan your Person Account RecordType strategy (e.g. `IndividualAccount`, `Individual`).
2. Test in a sandbox first — enabling changes the Contact and Account object behavior permanently.
3. Notify all developers and admins — after enabling, every Contact record requires an Account parent.
4. Plan for existing Contacts — Contacts without an Account will need to be converted or associated.

To enable: **Setup > Accounts > Person Accounts > Enable Person Accounts**

### Person Account RecordType

FSC installations typically ship with a `IndividualAccount` RecordType (DeveloperName may vary — check your org). Query it:

```soql
SELECT Id, DeveloperName
FROM RecordType
WHERE SObjectType = 'Account'
AND IsPersonType = true
LIMIT 10
```

`IsPersonType = true` filters to Person Account RecordTypes only.

### Key Person Account Fields

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| First Name | `FirstName` | Text | Person Account first name |
| Last Name | `LastName` | Text | Person Account last name |
| Person Email | `PersonEmail` | Email | Primary email |
| Person Phone | `PersonMobilePhone` | Phone | Mobile phone |
| Person Birthdate | `PersonBirthdate` | Date | Date of birth |
| Is Person Account | `IsPersonAccount` | Boolean | System field; true for Person Accounts |
| Person Contact Id | `PersonContactId` | Lookup (Contact) | The underlying Contact record Id |
| Deceased | `Deceased__c` | Boolean | FSC field on the underlying Contact; set via Contact, not Account |
| Person Mailing Street | `PersonMailingStreet` | Text | Individual mailing address |
| Person Mailing City | `PersonMailingCity` | Text | Individual mailing city |

> When creating `AccountContactRelation` records for Person Account members, use `PersonContactId` (not the Account `Id`) as the `ContactId` on the ACR.

---

## AccountContactRelation — Household Membership

### How Membership Works

Household membership is modeled through `AccountContactRelation` (ACR) records:

- `AccountId` = Household Account Id
- `ContactId` = Person Account's PersonContactId
- `Roles` = multipicklist of roles within the household
- `IsActive` = `true` for current members, `false` for former members

The ACR is the canonical membership model. Do not use custom lookup fields on Account or Contact to model membership.

### Creating Membership — Apex

```apex
// Get PersonContactId for each member
Account pa = [SELECT Id, PersonContactId FROM Account WHERE Id = :personAccountId];

AccountContactRelation acr = new AccountContactRelation(
    AccountId = householdId,
    ContactId = pa.PersonContactId,
    Roles = 'Member',
    IsActive = true
);
insert acr;
```

### Roles Multipicklist

The `Roles` field is a semicolon-delimited multipicklist. To assign multiple roles:

```apex
acr.Roles = 'Head of Household;Member';
```

To check if a contact has a specific role in SOQL (use LIKE for multipicklist):

```soql
SELECT Id, Roles FROM AccountContactRelation
WHERE AccountId = :householdId
AND Roles INCLUDES ('Head of Household')
AND IsActive = true
```

### Primary Group Member / Head of Household

FSC uses the ACR `Roles` field to identify the primary household member. The standard approach is to assign the `Head of Household` role value on the ACR for the primary member. Some FSC versions also expose a `PrimaryMember__c` lookup on the Household Account — if present, update this field to point to the primary member's Contact for the FSC summary components to display the primary member prominently.

Only one member should hold the `Head of Household` role at any time. Enforce this with a validation rule or before-insert/update trigger on ACR.

### Adding a Member to an Existing Household

```apex
Account newMember = [SELECT Id, PersonContactId FROM Account WHERE Id = :newMemberId];

// Check if an ACR already exists (e.g. member previously removed with IsActive = false)
List<AccountContactRelation> existing = [
    SELECT Id, IsActive
    FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND ContactId = :newMember.PersonContactId
    LIMIT 1
];

if (!existing.isEmpty()) {
    // Reactivate the existing ACR rather than inserting a duplicate
    existing[0].IsActive = true;
    existing[0].Roles = 'Member';
    update existing[0];
} else {
    // Create a new ACR
    AccountContactRelation acr = new AccountContactRelation(
        AccountId = householdId,
        ContactId = newMember.PersonContactId,
        Roles = 'Member',
        IsActive = true
    );
    insert acr;
}
```

### Removing a Member — Set IsActive = false, Never Delete

When a member leaves the household (divorce, adult child moving out, death), set `IsActive = false` on the ACR. Do not delete the ACR.

```apex
AccountContactRelation acr = [
    SELECT Id FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND ContactId = :departingContactId
    LIMIT 1
];
acr.IsActive = false;
update acr;
```

**Why not delete?**
- FINRA and SOC 2 compliance require a historical record of household membership.
- The ACR history supports audit queries ("who was in this household on [date]?").
- Restoring a deleted ACR is not possible without a data load.

---

## Household Address Management

### Household Address vs. Individual Address

| Location | Field | Purpose |
|---|---|---|
| Household Account | `BillingAddress` (BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry) | The household's shared mailing address |
| Person Account | `PersonMailingAddress` (PersonMailingStreet, PersonMailingCity, etc.) | The individual member's personal mailing address |

### Rules for Address Updates

1. **If one member moves but the rest stay** — update only the Person Account's `PersonMailingAddress`. Do not change the Household Account's `BillingAddress`.
2. **If the entire household moves** — update the Household Account's `BillingAddress` AND each member's `PersonMailingAddress`.
3. **Never auto-sync individual address to household** — a common mistake is to write a trigger that copies a Person Account's new address to the Household Account on update. This corrupts the household address when one member moves out or changes address.

---

## Complex Household Scenarios

### Blended Families

A blended family (stepchildren from prior marriages, shared and individual accounts) is modeled as one Household Account with all members linked via ACR. Use the `Roles` field on ACR to differentiate roles where needed. Track interpersonal family relationships (stepparent, stepchild) via `Relationship__c`. Financial accounts belonging to prior household relationships may have `PrimaryOwner` pointing to the individual's Account rather than the blended household.

### Trusts as Household Members

A trust is typically a separate Account (business account or a custom RecordType). To include trust relationships in the household view:

1. Create a business Account for the trust (e.g. "Smith Family Trust").
2. Create `Relationship__c` records linking household member Contacts to the trust Contact (if modeled as a Contact).
3. Create `FinancialAccount` records with `PrimaryOwner = trust Account` for trust-owned financial accounts.
4. Create `FinancialAccountRole` records with `Role = 'Trustee'` and `Role = 'Beneficiary'` linking household Contacts to trust accounts.

### Minors

Minor children are modeled as Person Accounts with ACR membership. Key considerations:
- Minor's `FinancialAccountRole` records often have `Role = 'Beneficiary'` or `Role = 'Custodian'` (for UTMA/UGMA accounts).
- A parent or guardian Contact may hold `Role = 'Guardian'` or `Role = 'Custodian'` on the minor's financial accounts.
- Do not delete the Person Account when the minor turns 18 — update their roles and create/update ACR roles as appropriate.

### Deceased Members

See Workflow 3 in SKILL.md. Key pattern:
- Set `Contact.Deceased__c = true`
- Set `AccountContactRelation.IsActive = false`
- Do not delete any records
- Update `FinancialAccountRole` records as required by estate process
- Set `Relationship__c.IsActive__c = false` on active relationships

### Member Moving to a New Household

1. Set `AccountContactRelation.IsActive = false` on the old household's ACR.
2. Create a new ACR linking the member to the new Household Account.
3. Update or transfer `FinancialAccount.PrimaryOwner` as appropriate (financial accounts that were jointly owned by the old household may need to be re-evaluated).
4. Update `Relationship__c` records if relationships have changed.

---

## Household Merge

There is no built-in "Merge Households" feature in FSC. The standard Salesforce Account merge handles two duplicate accounts at the Account level but does not re-parent child objects. A household merge requires:

1. Identify the surviving Household Account.
2. Re-parent all `AccountContactRelation` records from the merged household to the surviving household.
3. Re-parent all `FinancialAccount` records where `PrimaryOwner` = merged household to the surviving household.
4. Re-parent all `FinancialGoal`, `FinancialPlan`, `Revenue`, and asset/liability records.
5. Re-parent or consolidate `Relationship__c` records as needed.
6. Delete or merge the now-empty household Account.

This is typically done via Apex batch class or Data Loader with careful ordering to avoid re-parent failures.
