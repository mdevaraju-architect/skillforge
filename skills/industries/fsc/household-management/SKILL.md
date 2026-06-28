---
name: industries-fsc-household-management
description: >-
  Account (IndustriesHousehold), Person Account, AccountContactRelation,
  FinancialAccount, FinancialAccountRole, FinancialGoal, FinancialPlan,
  Revenue, Assets and Liabilities, Relationship__c, household group model,
  household membership, primary group member, rollup summaries, relationship map,
  household address, multi-member household, deceased flag, household merge,
  FinancialAccount.PrimaryOwner, joint ownership, beneficiary, power of attorney,
  FSC household view, group financial profile
compliance:
  regulations: ["FINRA", "SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: industries/fsc
  module: household-management
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# FSC Household Management Skill

This skill covers the FSC Household/Group model — the aggregation of individuals into a financial household. It includes household account setup, membership management, financial account linkage, goals and plans, assets and liabilities, relationship tracking, and the household relationship map visualization.

---

## Routing Table

| Intent | Reference File |
|--------|---------------|
| Household setup, membership, ACR — creating households, adding/removing members, IndustriesHousehold RecordType, Person Accounts, ACR Roles, IsActive | [02-household-setup.md](references/02-household-setup.md) |
| Financial accounts linked to household — PrimaryOwner, FinancialAccountRole, joint accounts, trust accounts, rollup mechanics, SOQL | [03-financial-accounts-and-roles.md](references/03-financial-accounts-and-roles.md) |
| Goals, plans, assets, liabilities — FinancialGoal, FinancialPlan lifecycle, Revenue, Assets and Liabilities, Net Worth rollup | [04-goals-plans-and-wealth.md](references/04-goals-plans-and-wealth.md) |
| Relationship map, Contact relationships — Relationship__c, reciprocal pairs, FSC auto-reciprocal, difference from ACR, visualization | [05-relationships-and-visualization.md](references/05-relationships-and-visualization.md) |
| Architecture, full object model, field reference, ASCII diagram, FSC rollup fields | [01-architecture.md](references/01-architecture.md) |

---

## NOT Covered by This Skill

The following are explicitly out of scope. Use the named skill instead:

- **InsurancePolicy and claims lifecycle** — use `industries-fsc-claims-process`
- **Producer distribution hierarchy** — use `industries-fsc-producer-hierarchy`
- **Mortgage origination and URLA (ResidentialLoanApplication)** — use `industries-fsc-mortgage-origination`
- **Investment holdings and portfolio management** — use `industries-fsc-wealth-management`
- **FSC advisor assignment and book of business** — not covered here

---

## Gotchas

### 1. `Account.RecordType` must be `IndustriesHousehold` for FSC household features to activate

Using a generic Account RecordType does not enable the FSC Household view, rollup summaries, or relationship map. The RecordType `DeveloperName` is `IndustriesHousehold`. Households created with a generic RecordType appear as plain accounts and cannot be upgraded without a data migration. Always query or assign the RecordType by its DeveloperName:

```apex
RecordType rt = [
    SELECT Id FROM RecordType
    WHERE SObjectType = 'Account' AND DeveloperName = 'IndustriesHousehold'
    LIMIT 1
];
```

If your org has FSC installed but the `IndustriesHousehold` RecordType is not visible, check that the FSC permission set or profile has the RecordType assigned and that the FSC managed package is fully configured.

### 2. Person Accounts must be enabled for full FSC household functionality

FSC's individual member model is built on Person Accounts (`IsPersonAccount = true`). Standard Contacts linked to business accounts do not support the FSC individual profile view, and FSC components such as the Financial Services Summary and Relationship Map rely on the Person Account model. Enabling Person Accounts in an existing org is an irreversible one-way operation — plan the RecordType strategy (e.g. `Individual` or `IndividualAccount` DeveloperName) before enabling. Once enabled, `Contact` and `Account` RecordTypes change permanently. Test in a sandbox before enabling in production.

### 3. Household membership uses `AccountContactRelation` — not a direct lookup on Account or Contact

Members join a household by creating an `AccountContactRelation` (ACR) record where `AccountId` is the Household Account and `ContactId` is the individual member's Person Account Contact. The `Roles` field (multipicklist) defines the member's role in the household — standard values include `Member` and `Head of Household`. Do not link members via a custom lookup field on the Household Account or Contact; the ACR is the canonical FSC membership model, and the FSC Household view, rollup engine, and relationship map all read from ACR records.

### 4. `FinancialAccount.PrimaryOwner` should point to the Household Account when the account is household-owned

For jointly owned financial accounts (e.g. joint checking, joint brokerage), `PrimaryOwner` should be the Household Account, not an individual member's Account. For individually owned accounts (e.g. individual IRA, personal savings), `PrimaryOwner` is the individual's Account. Do not default `PrimaryOwner` to an individual member for all financial accounts — this breaks household-level rollup summaries. The FSC rollup engine aggregates `FinancialAccount` records to the household based on the `PrimaryOwner` chain.

### 5. `FinancialAccountRole` models each Contact's role in a `FinancialAccount` — it is separate from `FinancialAccount.PrimaryOwner`

`FinancialAccountRole` records capture fine-grained Contact-level roles: `Primary Owner`, `Joint Owner`, `Beneficiary`, `Power of Attorney`, `Trustee`, `Successor Trustee`, `Guardian`, `Executor`. The `PrimaryOwner` lookup on `FinancialAccount` is an Account-to-Account relationship used for rollup aggregation. `FinancialAccountRole` is the Contact-level detail table used by the FSC Financial Account view and relationship map. Always create `FinancialAccountRole` records for each participating Contact — the FSC rollup and relationship map depend on them even when `PrimaryOwner` is already set correctly.

### 6. FSC provides pre-built rollup summaries on the Household Account — do not create duplicate custom roll-ups

FSC computes `Total Assets`, `Total Liabilities`, `Total Net Worth`, `Total AUM`, and similar rollups on the Household Account via background calculation jobs (the FSC Rollup Engine). Creating custom formula or roll-up summary fields that duplicate these can produce conflicting values and cause confusion. Query the standard FSC rollup fields directly — for example `Account.TotalNetWorth__c`, `Account.TotalAssets__c`, `Account.TotalLiabilities__c` (exact API names may vary by FSC package version; verify in your org's field list). If a rollup is stale, trigger a recalculation rather than building a shadow calculation.

### 7. `Relationship__c` (FSC Contact Relationship junction) is separate from `AccountContactRelation`

`Relationship__c` models interpersonal relationships between two Contacts (e.g. Spouse, Child, Business Partner). `AccountContactRelation` models a Contact's membership in a group or household Account. They serve entirely different purposes: ACR answers "is this person a member of this household?"; `Relationship__c` answers "what is the personal relationship between these two people?" The FSC relationship map visualization uses both objects to construct the full graph — ACR defines who is in the household, `Relationship__c` defines how they are connected to each other. Do not try to express interpersonal relationships purely through ACR Roles.

### 8. `Contact.Deceased__c` must be set to `true` for deceased household members — do not delete the Contact

Deleting a deceased Contact cascades deletes into `FinancialAccountRole`, `AccountContactRelation`, `Relationship__c`, and `FinancialGoal` records, permanently destroying the household's historical data and breaking compliance audit trails. Setting `Contact.Deceased__c = true` (the standard FSC field on the Person Account's Contact) hides the member from active FSC views while preserving all related records. After setting the flag, also set `AccountContactRelation.IsActive = false` to remove the member from the active household view and exclude them from live rollup calculations.

### 9. Household address is on the Household Account's `BillingAddress` — individual addresses are on Person Account

The FSC Household view displays the Household Account's `BillingAddress` as the household mailing address. Individual member mailing addresses are stored on the Person Account as `PersonMailingAddress` (or `PersonMailingStreet`, `PersonMailingCity`, etc.). If a single member moves, update only their Person Account's address. Only update the Household Account's `BillingAddress` if the entire household has relocated. Never automatically sync a member's new address to the Household Account — this is a common data quality error that corrupts the household-level address.

### 10. `FinancialGoal` can be linked to either the Household Account or an individual Account — they roll up differently

`FinancialGoal.AccountId` can point to the Household Account or an individual member's Account. Goals linked to the household roll up to the household's financial profile and are visible in the Household view. Goals linked to an individual appear only on that person's profile. Linking all goals to the household collapses individual-level goal tracking. The right linkage depends on the goal type: retirement goals typically belong to the individual; home purchase, college funding, or legacy goals may belong to the household. Establish a naming and linkage convention before going live.

### 11. `FinancialAccount` rollup to the Household requires the `FinancialAccount.PrimaryOwner` chain — not `FinancialAccountRole.AccountId`

The FSC household rollup for Total AUM, Total Assets, and Total Liabilities aggregates `FinancialAccount` records where `PrimaryOwner` equals the Household Account directly, or where `PrimaryOwner` is an Account that is a member of the household (via ACR). `FinancialAccountRole` records alone do not trigger the rollup — a Contact can have a `Beneficiary` or `Power of Attorney` role on an account owned by an unrelated party, and that account will not roll up to the household. Always verify that `FinancialAccount.PrimaryOwner` is set correctly before investigating why a financial account is missing from the household summary.

### 12. `AccountContactRelation.IsActive` must be `true` for the member to appear in the FSC household view

Setting `IsActive = false` on an ACR effectively removes the member from the household view without deleting the record. This is the correct pattern for members who leave a household (divorce, adult child moving out) — set `IsActive = false`, do not delete the ACR. The FSC rollup engine excludes members with `IsActive = false` from household summaries. Deleting the ACR destroys the historical record of the person's household membership, which may be required for FINRA and SOC 2 audit compliance.

### 13. `FinancialAccount` rollup to the Household requires the `FinancialAccount.PrimaryOwner` chain — not `FinancialAccountRole.AccountId`

The FSC household rollup (Total AUM, Total Assets) aggregates `FinancialAccount` records where `PrimaryOwner` equals the Household Account or where `PrimaryOwner` is a member of the household. `FinancialAccountRole` records alone do not trigger the rollup. If a financial account's `PrimaryOwner` is an unrelated account, it will not roll up to the household even if a household member has a `FinancialAccountRole` on it. Always audit `PrimaryOwner` assignments when troubleshooting missing rollup balances.

### 14. `FinancialPlan` is linked to a household or individual Account via `FinancialPlan.AccountId` — manage lifecycle with `Status`

One household typically has one active `FinancialPlan` at a time. Creating multiple `FinancialPlan` records for the same household without setting `Status = Inactive` on the prior plan produces duplicate plan views and confuses advisors. Use `FinancialPlan.Status` (picklist values: `Draft`, `Active`, `Inactive`) to manage the plan lifecycle. Transition the prior plan to `Inactive` before activating a new one. Do not delete old financial plans — they are required for compliance history and FINRA audit trails.

---

## Workflows

### Workflow 1: Create a New Household and Add Members

This workflow creates a Household Account with the `IndustriesHousehold` RecordType, creates or identifies Person Account members, and links them via `AccountContactRelation`.

**Step 1 — Create the Household Account:**

```apex
// Query the IndustriesHousehold RecordType
RecordType householdRT = [
    SELECT Id FROM RecordType
    WHERE SObjectType = 'Account'
    AND DeveloperName = 'IndustriesHousehold'
    LIMIT 1
];

Account household = new Account(
    Name = 'Smith Household',
    RecordTypeId = householdRT.Id,
    BillingStreet = '123 Main St',
    BillingCity = 'San Francisco',
    BillingState = 'CA',
    BillingPostalCode = '94105',
    BillingCountry = 'US'
);
insert household;
```

**Step 2 — Create or identify Person Account members:**

```apex
// Query the Individual Person Account RecordType (DeveloperName varies by org config)
RecordType individualRT = [
    SELECT Id FROM RecordType
    WHERE SObjectType = 'Account'
    AND DeveloperName = 'IndividualAccount'
    LIMIT 1
];

// Create the primary member (Head of Household)
Account primaryMember = new Account(
    FirstName = 'John',
    LastName = 'Smith',
    RecordTypeId = individualRT.Id,
    PersonEmail = 'john.smith@example.com',
    PersonBirthdate = Date.newInstance(1965, 4, 12)
);
insert primaryMember;

// Create a secondary member
Account secondaryMember = new Account(
    FirstName = 'Jane',
    LastName = 'Smith',
    RecordTypeId = individualRT.Id,
    PersonEmail = 'jane.smith@example.com',
    PersonBirthdate = Date.newInstance(1968, 9, 3)
);
insert secondaryMember;
```

**Step 3 — Link members to the household via AccountContactRelation:**

```apex
// For Person Accounts, the ContactId is the implicit Contact created by the Person Account
// Query back the PersonContactId
Account pa1 = [SELECT Id, PersonContactId FROM Account WHERE Id = :primaryMember.Id];
Account pa2 = [SELECT Id, PersonContactId FROM Account WHERE Id = :secondaryMember.Id];

List<AccountContactRelation> memberships = new List<AccountContactRelation>{
    new AccountContactRelation(
        AccountId = household.Id,
        ContactId = pa1.PersonContactId,
        Roles = 'Head of Household;Member',
        IsActive = true
    ),
    new AccountContactRelation(
        AccountId = household.Id,
        ContactId = pa2.PersonContactId,
        Roles = 'Member',
        IsActive = true
    )
};
insert memberships;
```

**Key points:**
- Household `RecordTypeId` must resolve to `IndustriesHousehold`.
- Use `PersonContactId` (not `Id`) on a Person Account when creating ACR.
- `Roles` is a semicolon-delimited multipicklist string.
- Set `IsActive = true` on creation; set to `false` (never delete) when a member leaves.

---

### Workflow 2: Link Financial Accounts to a Household with Correct Ownership and Roles

This workflow sets `FinancialAccount.PrimaryOwner` correctly for household vs. individually owned accounts, and creates `FinancialAccountRole` records for each participating Contact.

**Step 1 — Create a jointly owned financial account (PrimaryOwner = Household):**

```apex
FinancialAccount jointChecking = new FinancialAccount(
    Name = 'Smith Joint Checking',
    PrimaryOwner = household.Id,          // Household Account — joint ownership
    FinancialAccountType = 'Checking',    // or the appropriate Type picklist value
    Balance = 45000.00,
    Status = 'Active'
);
insert jointChecking;
```

**Step 2 — Create FinancialAccountRole records for each member:**

```apex
List<FinancialAccountRole> roles = new List<FinancialAccountRole>{
    new FinancialAccountRole(
        FinancialAccount = jointChecking.Id,
        Contact = pa1.PersonContactId,    // John Smith
        Role = 'Primary Owner'
    ),
    new FinancialAccountRole(
        FinancialAccount = jointChecking.Id,
        Contact = pa2.PersonContactId,    // Jane Smith
        Role = 'Joint Owner'
    )
};
insert roles;
```

**Step 3 — Create an individually owned financial account (PrimaryOwner = individual):**

```apex
FinancialAccount johnIRA = new FinancialAccount(
    Name = 'John Smith IRA',
    PrimaryOwner = primaryMember.Id,      // Individual Account — not the household
    FinancialAccountType = 'Individual Retirement Account',
    Balance = 285000.00,
    Status = 'Active'
);
insert johnIRA;

// Add FinancialAccountRole for John as primary owner, Jane as beneficiary
List<FinancialAccountRole> iraRoles = new List<FinancialAccountRole>{
    new FinancialAccountRole(
        FinancialAccount = johnIRA.Id,
        Contact = pa1.PersonContactId,
        Role = 'Primary Owner'
    ),
    new FinancialAccountRole(
        FinancialAccount = johnIRA.Id,
        Contact = pa2.PersonContactId,
        Role = 'Beneficiary'
    )
};
insert iraRoles;
```

**Key points:**
- `PrimaryOwner` on `FinancialAccount` is the field that drives household-level rollup.
- `FinancialAccountRole` is the fine-grained Contact-level detail — always create it even when `PrimaryOwner` is set.
- Joint accounts → `PrimaryOwner = Household Account`. Individual accounts → `PrimaryOwner = individual Account`.
- Check that `FinancialAccount.Status = 'Active'` for the account to be included in rollup.

---

### Workflow 3: Handle a Household Life Event — Member Deceased

When a household member dies, the correct FSC pattern is to set `Contact.Deceased__c = true` and deactivate the ACR. Do not delete the Contact, ACR, or any related financial records.

**Step 1 — Set the Deceased flag on the Person Account's Contact:**

```apex
// Retrieve the Contact underlying the deceased Person Account
Account deceased = [SELECT Id, PersonContactId FROM Account WHERE Id = :primaryMember.Id];

Contact deceasedContact = new Contact(
    Id = deceased.PersonContactId,
    Deceased__c = true
);
update deceasedContact;
```

**Step 2 — Deactivate the household ACR without deleting it:**

```apex
AccountContactRelation acr = [
    SELECT Id, IsActive
    FROM AccountContactRelation
    WHERE AccountId = :household.Id
    AND ContactId = :deceased.PersonContactId
    LIMIT 1
];
acr.IsActive = false;
update acr;
```

**Step 3 — Update FinancialAccountRole records as appropriate:**

Depending on business rules, update roles on financial accounts where the deceased was a Primary Owner. Transfer Primary Owner designation or update roles as needed:

```apex
// Example: find all FinancialAccountRole records for the deceased Contact
List<FinancialAccountRole> deceasedRoles = [
    SELECT Id, Role, FinancialAccount
    FROM FinancialAccountRole
    WHERE Contact = :deceased.PersonContactId
];

// Review and update roles per estate/business rules
// e.g., update Executor role, transfer Primary Owner if required
// Do NOT delete FinancialAccountRole records — preserve for compliance history
```

**Step 4 — Update Relationship__c records to IsActive = false for active relationships:**

```apex
List<Relationship__c> activeRelationships = [
    SELECT Id, IsActive__c
    FROM Relationship__c
    WHERE (Contact__c = :deceased.PersonContactId
        OR RelatedContact__c = :deceased.PersonContactId)
    AND IsActive__c = true
];
for (Relationship__c rel : activeRelationships) {
    rel.IsActive__c = false;
}
update activeRelationships;
```

**Key points:**
- Never delete a deceased Contact — cascading deletes destroy compliance history.
- `Contact.Deceased__c = true` removes the member from active FSC views.
- `AccountContactRelation.IsActive = false` removes the member from the household rollup.
- Preserve all `FinancialAccountRole` and `Relationship__c` records; only deactivate, never delete.
- Coordinate with compliance/legal for estate transfers on `FinancialAccount` ownership.
