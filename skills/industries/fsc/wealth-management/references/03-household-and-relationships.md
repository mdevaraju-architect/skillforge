# FSC Wealth Management — Household and Relationships

## Overview

The household model is the foundational organizing unit for FSC Wealth Management. All financial accounts, goals, plans, and alerts are anchored to a Household Account. Understanding the relationship between the Household Account, individual Contacts, AccountContactRelation, RelationshipGroup, and FinancialAccountRole is essential before building any FSC Wealth feature.

---

## Household Account Model

### Account RecordType: IndustriesHousehold

A Household Account is a standard Salesforce Account record with RecordType `IndustriesHousehold`. It represents the family or related-individuals unit — not an individual person.

Key fields on the Household Account:

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Household name, e.g. "Smith Family Household" |
| `OwnerId` | Lookup (User) | Primary relationship manager |
| `TotalAum__c` | Currency | Rolled-up AUM from all member FinancialAccounts |
| `TotalAssets__c` | Currency | AUM + non-custodied AssetsAndLiabilities (asset types) |
| `TotalLiabilities__c` | Currency | Sum of liability AssetsAndLiabilities records |
| `NetWorth__c` | Currency | TotalAssets__c − TotalLiabilities__c |
| `NumberOfFinancialAccounts__c` | Number | Count of linked FinancialAccount records |
| `PrimaryContactId` | Lookup (Contact) | Primary household member; drives salutation in communications |
| `AnnualRevenue` | Currency | Not used for wealth AUM — do not conflate with TotalAum__c |

**Gotcha:** `Account.AnnualRevenue` is a standard Salesforce field visible on the page layout. It is NOT the AUM rollup for FSC Wealth. Use `TotalAum__c` for AUM. Confusing these two is a common mistake in reporting and integrations.

---

## Individual Client Model

### Person Accounts (recommended for FSC Wealth)

When Person Accounts are enabled:
- Each individual client is a PersonAccount (a merged Account + Contact record).
- The PersonAccount's RecordType is typically `PersonAccount` (the standard Person Account RecordType).
- The Household Account is a separate Business Account with RecordType `IndustriesHousehold`.
- `AccountContactRelation` links the PersonAccount's Contact (auto-created by Salesforce) to the Household Account.

### Contacts Without Person Accounts

When Person Accounts are NOT enabled:
- Individual clients are Contacts linked to a Household Account via `Contact.AccountId`.
- The `Contact.AccountId` should point to the Household Account.
- An optional `IndustriesIndividual` Account RecordType exists for individual-level account data, but the Contact is the primary record for the individual.

---

## AccountContactRelation — Household Membership

`AccountContactRelation` is the standard Salesforce object that links Contacts to Accounts in a many-to-many relationship. In FSC Wealth, it defines household membership.

### Required Fields for Household Membership

| Field | Value | Notes |
|---|---|---|
| `AccountId` | Household Account ID | The `IndustriesHousehold` account |
| `ContactId` | Individual Contact ID | The household member's Contact |
| `Roles` | `'Household Member'` | Must contain this value for FSC panels to display the member |
| `IsActive` | `true` | Inactive relationships are hidden from FSC household views |
| `IsDirect` | `true` | Direct relationship (as opposed to via a group) |
| `StartDate` | Date | Membership start date for historical tracking |

### Common Household Roles (multi-select picklist `Roles`)

| Role Value | Description |
|---|---|
| `Household Member` | Any member of the household |
| `Primary Member` | Primary contact for the household |
| `Spouse` | Spousal relationship |
| `Dependent` | Minor child or other dependent |
| `PowerOfAttorney` | Has POA over a household member |

**Gotcha:** The `Roles` field is a multi-select picklist (semicolon-separated in Apex, comma-separated in SOQL `INCLUDES` queries). Always use `INCLUDES` in SOQL — `WHERE Roles INCLUDES ('Household Member')` — never `= 'Household Member'` which returns no results for multi-select fields.

```soql
SELECT Id, ContactId, Contact.Name, Roles, IsActive
FROM AccountContactRelation
WHERE AccountId = :householdAccountId
AND Roles INCLUDES ('Household Member')
AND IsActive = true
```

---

## FinancialAccountRole — Account-Level Roles

`FinancialAccountRole` links a Contact to a `FinancialAccount` with a specific legal or beneficial role. It is separate from household membership.

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `FinancialAccountId` | Master-Detail (FinancialAccount) | The account this role is on |
| `RelatedContactId` | Lookup (Contact) | The person holding this role |
| `Role` | Picklist | See role table below |
| `IsPrimaryOwner` | Boolean | `true` for the primary account owner |
| `StartDate` | Date | When this role began |
| `EndDate` | Date | When this role ended (for historical tracking) |

### Valid Role Values

| Role | Description | When required |
|---|---|---|
| `Owner` | Primary account owner | Always — every FinancialAccount must have an Owner role |
| `JointOwner` | Joint account holder | For joint brokerage or bank accounts |
| `Beneficiary` | Designated beneficiary | Required for IRA, 401k, annuity, life insurance accounts |
| `Trustee` | Trust account trustee | Required for Trust account types |
| `PowerOfAttorney` | Has trading authority via POA | When POA documentation is on file |
| `Custodian` | Custodian (for minor accounts, e.g., UGMA/UTMA) | For custodial accounts; custodian manages until beneficiary reaches majority |
| `Successor` | Successor trustee or successor owner | For trust continuity planning |
| `AuthorizedTrader` | Third party with trading authority | For discretionary account management |

**Gotcha:** `FinancialAccountRole.Role` is a picklist, and its available values depend on the `FinancialAccount.FinancialAccountType`. Retirement accounts (`TraditionalIRA`, `RothIRA`, `401k`) will trigger a validation error if you attempt to add a `JointOwner` — IRS rules prohibit joint ownership of retirement accounts. FSC does not always enforce this automatically; add a validation rule.

### Required Role by Account Type

| Account Type | Required Roles |
|---|---|
| Brokerage | `Owner` (min 1) |
| Joint Brokerage | `Owner` + `JointOwner` |
| TraditionalIRA / RothIRA | `Owner` + `Beneficiary` (1 primary, optional contingent) |
| 401k | `Owner` + `Beneficiary` |
| 529Plan | `Owner` (account holder) + `Beneficiary` (beneficiary student) |
| Trust | `Owner` (grantor) + `Trustee` (at least 1) |
| UGMA / UTMA | `Custodian` + `Beneficiary` |

---

## RelationshipGroup

`RelationshipGroup` is an FSC object for grouping multiple related Accounts (often multiple households or a household + business entity) under a single advisory relationship.

### Key Fields on RelationshipGroup

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Group name |
| `PrimaryGroupMemberId` | Lookup (Account) | The primary account of the group |
| `OwnerId` | Lookup (User) | Relationship manager for the group |
| `TotalGroupAum__c` | Currency | Rolled-up AUM across all group member accounts |

### RelationshipGroupMember

| Field API Name | Type | Description |
|---|---|---|
| `RelationshipGroupId` | Lookup (RelationshipGroup) | Parent group |
| `MemberId` | Lookup (Account) | Member account (Household or Individual) |
| `Role` | Picklist | `Primary`, `Secondary`, `Spouse`, `Business`, `Other` |
| `IsActive` | Boolean | Active membership flag |

### When to Use RelationshipGroup vs. Household

| Scenario | Use |
|---|---|
| Married couple — shared finances | Single Household Account with two AccountContactRelation members |
| Married couple — separate finances but same advisor | Two Household Accounts + one RelationshipGroup linking both |
| Business owner + personal household | Business Account + Household Account + RelationshipGroup |
| Multi-generational family with separate households | Multiple Household Accounts + RelationshipGroup |

---

## AUM Calculation Across the Household

### Standard AUM Rollup Logic

AUM (`TotalAum__c` on the Household Account) = Sum of `FinancialAccount.Balance` for all accounts where:
- `FinancialAccount.PrimaryOwnerId` = Household Account ID, OR
- `FinancialAccount.PrimaryOwnerId` is a Contact that is a household member (via `AccountContactRelation`)

**Gotcha:** Held-away accounts (`FinancialAccount.HeldAwayIndicator = true`) may be excluded from managed AUM in some implementations. Confirm whether held-away AUM is included in the org's definition of `TotalAum__c` before writing rollup logic. The field label may say "AUM" but include or exclude held-away based on the implementation decision.

### AUM by Household Member

To calculate AUM per individual household member (for member-level reporting):

```soql
SELECT PrimaryOwnerId, SUM(Balance)
FROM FinancialAccount
WHERE PrimaryOwnerId IN (
    SELECT ContactId FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND Roles INCLUDES ('Household Member')
    AND IsActive = true
)
GROUP BY PrimaryOwnerId
```

### RelationshipGroup AUM

`RelationshipGroup.TotalGroupAum__c` sums the `TotalAum__c` from each member Household Account. This is a second-level rollup (household rollup → group rollup) and is also not real-time. Confirm the rollup batch schedule covers both levels.

---

## Household 360 Lightning Page

The FSC-managed **Household 360** Lightning page requires:
1. Household Account RecordType = `IndustriesHousehold`
2. FSC managed components assigned to the page (Financial Account Summary component, Relationship Map, Goals tile, Record Alert tile)
3. FSC Wealth permission set assigned to viewing user
4. AUM rollup fields populated (may appear as $0 if batch has not run)

If the FSC managed components do not appear on the Household 360 page:
- Verify the page is using the FSC-managed `IndustriesHousehold` page layout (not a cloned/custom layout that lost the managed components)
- Verify the viewing user has `FSCFinancialServices` or `FSCWealth` permission set
- Verify `IndustriesHousehold` RecordType is assigned to the user's profile or permission set
