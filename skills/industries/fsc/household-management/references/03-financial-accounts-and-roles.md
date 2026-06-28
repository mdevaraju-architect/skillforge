# FSC Household Management — Financial Accounts and Roles

This reference covers `FinancialAccount.PrimaryOwner` assignment, `FinancialAccountRole` records, how FSC aggregates financial accounts to the household, joint and trust account patterns, and SOQL for querying household financial data.

---

## FinancialAccount.PrimaryOwner — When to Use Household vs. Individual

The `PrimaryOwner` lookup on `FinancialAccount` is the field that drives household-level rollup aggregation. Its assignment determines whether a financial account appears in the household's total balance, AUM, and net worth calculations.

### Decision Rules

| Account Type | Ownership Pattern | Set PrimaryOwner To |
|---|---|---|
| Joint checking/savings | Owned by both spouses together | Household Account |
| Joint brokerage | Owned jointly | Household Account |
| Joint mortgage | Held jointly | Household Account |
| Individual IRA / 401k | Individually owned | Individual Account |
| Individual savings | One person's account | Individual Account |
| Trust account | Owned by a trust entity | Trust Account (separate Account record) |
| UTMA/UGMA custodial | Owned by minor | Minor's Individual Account |
| Business account | Owned by a business entity | Business Account |

### Common Mistake

Setting `PrimaryOwner` to an individual Account for all financial accounts — including jointly-owned ones — breaks household-level rollup. Joint accounts where `PrimaryOwner = individual` will appear on the individual's profile but not as household-level jointly-owned assets. Always evaluate ownership at account creation time.

### Apex Example — Creating Joint vs. Individual Accounts

```apex
Id householdId = '001...';      // Household Account Id
Id johnAccountId = '001...';    // John Smith's individual Account Id
Id janeAccountId = '001...';    // Jane Smith's individual Account Id

// Joint checking — PrimaryOwner = Household
FinancialAccount jointChecking = new FinancialAccount(
    Name = 'Smith Joint Checking',
    PrimaryOwner = householdId,
    FinancialAccountType = 'Checking',
    Balance = 55000.00,
    Status = 'Active',
    OpenDate = Date.today()
);

// John's IRA — PrimaryOwner = individual
FinancialAccount johnIRA = new FinancialAccount(
    Name = 'John Smith IRA',
    PrimaryOwner = johnAccountId,
    FinancialAccountType = 'Individual Retirement Account',
    Balance = 312000.00,
    Status = 'Active',
    OpenDate = Date.newInstance(2002, 3, 15)
);

insert new List<FinancialAccount>{ jointChecking, johnIRA };
```

---

## FinancialAccountRole — Field Table

`FinancialAccountRole` models each Contact's specific role in a `FinancialAccount`. It is a separate concern from `FinancialAccount.PrimaryOwner`. PrimaryOwner is the Account-to-Account ownership relationship; `FinancialAccountRole` is the fine-grained Contact-level role detail.

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Financial Account | `FinancialAccount` | Master-Detail (FinancialAccount) | Parent account; required |
| Contact | `Contact` | Lookup (Contact) | The Contact holding this role; use PersonContactId for Person Accounts |
| Role | `Role` | Picklist | See role values below |
| Primary Role | `PrimaryRole` | Boolean | Flag for the primary/main role record on this account |
| Start Date | `StartDate` | Date | Date the role became effective |
| End Date | `EndDate` | Date | Date the role ended (do not delete — set EndDate instead) |
| Name | `Name` | Auto Number | System-generated record name |

### Role Picklist Values

| Role Value | Description | Typical Account Types |
|---|---|---|
| `Primary Owner` | Primary account holder | All account types |
| `Joint Owner` | Secondary joint account holder | Joint checking, savings, brokerage |
| `Beneficiary` | Designated beneficiary | IRA, 401k, life insurance, trust |
| `Power of Attorney` | Holds legal POA over the account | Any account |
| `Trustee` | Trustee managing a trust | Trust accounts |
| `Successor Trustee` | Backup trustee to assume control | Trust accounts |
| `Guardian` | Legal guardian for a minor | UTMA/UGMA, minor-owned accounts |
| `Executor` | Estate executor on the account | Any account (estate planning) |
| `Authorized Signer` | Authorized to transact without ownership | Checking, savings |
| `Custodian` | Custodian on a custodial account | UTMA/UGMA |

### Creating FinancialAccountRole Records — Apex

Always create `FinancialAccountRole` records for every participating Contact, even if `PrimaryOwner` is already set correctly. The FSC Financial Account view and relationship map use `FinancialAccountRole` for Contact-level rendering.

```apex
// Assumes: jointChecking.Id and personAccountContactIds are known
List<FinancialAccountRole> roles = new List<FinancialAccountRole>{
    new FinancialAccountRole(
        FinancialAccount = jointChecking.Id,
        Contact = johnContactId,         // PersonContactId of John's Person Account
        Role = 'Primary Owner',
        PrimaryRole = true,
        StartDate = Date.today()
    ),
    new FinancialAccountRole(
        FinancialAccount = jointChecking.Id,
        Contact = janeContactId,         // PersonContactId of Jane's Person Account
        Role = 'Joint Owner',
        PrimaryRole = false,
        StartDate = Date.today()
    )
};
insert roles;
```

### Ending a Role Without Deleting

When a Contact's role on an account ends (e.g. beneficiary change, POA revoked), set `EndDate` rather than deleting the record:

```apex
FinancialAccountRole far = [
    SELECT Id, EndDate
    FROM FinancialAccountRole
    WHERE FinancialAccount = :accountId
    AND Contact = :contactId
    AND Role = 'Power of Attorney'
    LIMIT 1
];
far.EndDate = Date.today();
update far;

// Then create the new role record if the role is being transferred
FinancialAccountRole newFar = new FinancialAccountRole(
    FinancialAccount = accountId,
    Contact = newPOAContactId,
    Role = 'Power of Attorney',
    StartDate = Date.today()
);
insert newFar;
```

---

## FSC Rollup Mechanics

### How the Rollup Works

The FSC Rollup Engine aggregates `FinancialAccount` records to the Household Account in two ways:

1. **Direct household ownership:** `FinancialAccount.PrimaryOwner = HouseholdAccountId` — the financial account is directly owned by the household.
2. **Member-level ownership:** `FinancialAccount.PrimaryOwner = IndividualAccountId` where the individual is an active member of the household (i.e. has an ACR with `IsActive = true` linking to the Household).

Both paths aggregate balances and values to the household-level rollup fields (`TotalAssets__c`, `TotalAUM__c`, `TotalNetWorth__c`, etc.).

### What the Rollup Does NOT Do

- `FinancialAccountRole` records alone do not trigger household rollup. A Contact can be a `Beneficiary` or `Power of Attorney` on an account owned by a completely unrelated entity — that account does not roll up to the Contact's household.
- Financial accounts with `Status = 'Closed'` or `Status = 'Inactive'` are excluded from the rollup.
- Members with `AccountContactRelation.IsActive = false` are excluded from contributing their individual-owned accounts to the household rollup.

### Rollup Timing

Rollups run asynchronously via the FSC Rollup Engine. After inserting or updating `FinancialAccount` records:
- Allow a short delay for the rollup to process.
- Do not assert rollup field values immediately after DML in synchronous tests — use `@future` or a test helper that invokes the rollup directly.
- In production, large rollup queues may take minutes to process.

### Manually Triggering Recalculation

If rollup values are stale (e.g. after a bulk data load), navigate to:
**Setup > Financial Services Cloud > Rollup Settings > Recalculate Rollups**

Or invoke via Apex if the FSC package exposes a rollup invocation API (varies by version).

---

## Joint Account Patterns

### Two-Person Joint Account

Most common pattern: spouses or domestic partners sharing a joint checking or brokerage account.

```
FinancialAccount
  PrimaryOwner = Household Account
  Name = "Smith Joint Checking"

FinancialAccountRole (John) → Role = 'Primary Owner'
FinancialAccountRole (Jane) → Role = 'Joint Owner'
```

### Three-Party Joint Account (Business Partner)

```
FinancialAccount
  PrimaryOwner = Household Account (or Business Account depending on ownership)
  Name = "Smith-Jones Business Account"

FinancialAccountRole (John) → Role = 'Primary Owner'
FinancialAccountRole (Jane) → Role = 'Joint Owner'
FinancialAccountRole (Business Partner) → Role = 'Authorized Signer'
```

### IRA with Named Beneficiary

```
FinancialAccount
  PrimaryOwner = John's Individual Account
  Name = "John Smith Traditional IRA"
  FinancialAccountType = 'Individual Retirement Account'

FinancialAccountRole (John) → Role = 'Primary Owner'
FinancialAccountRole (Jane) → Role = 'Beneficiary'
FinancialAccountRole (Child) → Role = 'Beneficiary'  (contingent)
```

---

## Trust Account Patterns

Trust accounts involve a trust entity (modeled as a separate Account) as the `PrimaryOwner`. Household members serve as Trustee, Successor Trustee, and Beneficiary via `FinancialAccountRole`.

```apex
// Trust Account — PrimaryOwner = Trust Account (business Account for the trust entity)
FinancialAccount trustAccount = new FinancialAccount(
    Name = 'Smith Family Revocable Trust',
    PrimaryOwner = trustEntityAccountId,   // Separate Trust entity Account
    FinancialAccountType = 'Trust',
    Balance = 1250000.00,
    Status = 'Active'
);
insert trustAccount;

// Roles
List<FinancialAccountRole> trustRoles = new List<FinancialAccountRole>{
    new FinancialAccountRole(
        FinancialAccount = trustAccount.Id,
        Contact = johnContactId,
        Role = 'Trustee'
    ),
    new FinancialAccountRole(
        FinancialAccount = trustAccount.Id,
        Contact = janeContactId,
        Role = 'Successor Trustee'
    ),
    new FinancialAccountRole(
        FinancialAccount = trustAccount.Id,
        Contact = childContactId,
        Role = 'Beneficiary'
    )
};
insert trustRoles;
```

Note: The trust entity's Account may itself be linked to the household via `Relationship__c` records connecting the household members to the trust. The trust's financial account will only roll up to the household if the trust entity's Account is a recognized member or if the trust account's `PrimaryOwner` is the household itself.

---

## FinancialAccount.Status and Rollup Inclusion

| Status Value | Included in Household Rollup | Notes |
|---|---|---|
| `Active` | Yes | Included in all FSC rollup calculations |
| `Inactive` | No | Excluded from rollup but visible in account list |
| `Closed` | No | Excluded from rollup; historical record preserved |

When a client closes an account, set `Status = 'Closed'` and set `CloseDate`. Do not delete `FinancialAccount` records — preserve for compliance and FINRA audit history.

---

## SOQL — Querying Financial Accounts for a Household

### All FinancialAccounts Directly Owned by the Household

```soql
SELECT Id, Name, FinancialAccountType, Balance, Status, PrimaryOwner.Name
FROM FinancialAccount
WHERE PrimaryOwner = :householdId
AND Status = 'Active'
ORDER BY Balance DESC
```

### All FinancialAccounts Owned by Members of the Household (Individual Ownership)

```soql
-- Step 1: Get active member Account IDs
SELECT AccountContactRelation.AccountId, Contact.AccountId
FROM AccountContactRelation
WHERE AccountId = :householdId
AND IsActive = true

-- Step 2: Query FinancialAccounts owned by those individual Accounts
SELECT Id, Name, FinancialAccountType, Balance, PrimaryOwner.Name
FROM FinancialAccount
WHERE PrimaryOwner IN :memberAccountIds
AND Status = 'Active'
```

Combined into Apex:

```apex
// Get active member Account IDs
List<AccountContactRelation> acrs = [
    SELECT Contact.AccountId
    FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND IsActive = true
];

Set<Id> memberAccountIds = new Set<Id>{ householdId };
for (AccountContactRelation acr : acrs) {
    memberAccountIds.add(acr.Contact.AccountId);
}

// Query all financial accounts for the household and members
List<FinancialAccount> allAccounts = [
    SELECT Id, Name, FinancialAccountType, Balance, Status,
           PrimaryOwner.Name, PrimaryOwner.Id
    FROM FinancialAccount
    WHERE PrimaryOwner IN :memberAccountIds
    AND Status = 'Active'
    ORDER BY Balance DESC
];
```

### All FinancialAccountRole Records for a Contact

```soql
SELECT Id, Role, FinancialAccount.Name, FinancialAccount.Balance,
       FinancialAccount.Status, StartDate, EndDate
FROM FinancialAccountRole
WHERE Contact = :contactId
ORDER BY StartDate DESC
```

### All Contacts with Roles on a Specific FinancialAccount

```soql
SELECT Id, Role, Contact.Name, Contact.Email, PrimaryRole, StartDate, EndDate
FROM FinancialAccountRole
WHERE FinancialAccount = :financialAccountId
ORDER BY Role
```
