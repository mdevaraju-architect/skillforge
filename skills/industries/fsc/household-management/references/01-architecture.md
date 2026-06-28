# FSC Household Management — Architecture and Object Model

This reference covers the complete FSC Household object model, ASCII diagram, and key field tables for each object in the household data model.

---

## Overview

The FSC Household model aggregates individual Person Accounts into a financial household using the `IndustriesHousehold` Account RecordType as the hub. Financial accounts, goals, plans, and assets are linked to either the household or individual members. The relationship map visualizes the household graph using both `AccountContactRelation` (membership) and `Relationship__c` (interpersonal links).

---

## Full Object Model ASCII Diagram

```
                        ┌─────────────────────────────────┐
                        │       Household Account          │
                        │  RecordType: IndustriesHousehold │
                        │  BillingAddress (household addr) │
                        │  TotalNetWorth__c (FSC rollup)   │
                        │  TotalAssets__c (FSC rollup)     │
                        │  TotalLiabilities__c (FSC rollup)│
                        │  TotalAUM__c (FSC rollup)        │
                        └────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │ AccountContactRelation│                      │
              │ AccountId = Household │                      │
              │ ContactId = Member    │                      │
              │ Roles (multipicklist) │                      │
              │ IsActive              │                      │
              └──────────┬───────────┘                      │
                         │                                  │
         ┌───────────────▼──────────────┐                   │
         │       Person Account         │                   │
         │  RecordType: IndividualAccount│                  │
         │  IsPersonAccount = true       │                  │
         │  PersonContactId → Contact    │                  │
         │  Deceased__c (on Contact)     │                  │
         │  PersonMailingAddress         │                  │
         └───────────────┬──────────────┘                   │
                         │                                  │
         ┌───────────────┴──────────────┐                   │
         │ Relationship__c              │                   │
         │ Contact__c (this person)     │                   │
         │ RelatedContact__c (other)    │                   │
         │ Type (Spouse, Child, etc.)   │                   │
         │ IsActive__c                  │                   │
         └──────────────────────────────┘                   │
                                                            │
         ┌──────────────────────────────────────────────────▼─┐
         │               FinancialAccount                      │
         │  PrimaryOwner → Household Account (joint)           │
         │           OR → Individual Account (personal)        │
         │  Status (Active, Inactive, Closed)                  │
         │  FinancialAccountType                               │
         │  Balance                                            │
         └─────────────────────┬───────────────────────────────┘
                               │
         ┌─────────────────────▼────────────┐
         │         FinancialAccountRole      │
         │  FinancialAccount (lookup)        │
         │  Contact (lookup)                 │
         │  Role (Primary Owner, Joint Owner,│
         │        Beneficiary, POA, Trustee, │
         │        Successor Trustee, etc.)   │
         └───────────────────────────────────┘

         ┌──────────────────────────────────────┐
         │           FinancialGoal              │
         │  AccountId → Household OR Individual │
         │  GoalType, TargetValue, CurrentValue │
         │  TargetDate, Status                  │
         └──────────────────────────────────────┘

         ┌──────────────────────────────────────┐
         │           FinancialPlan              │
         │  AccountId → Household OR Individual │
         │  Status (Draft, Active, Inactive)    │
         │  PlanType, Advisor                   │
         └──────────────────────────────────────┘

         ┌──────────────────────────────────────┐
         │     Assets and Liabilities           │
         │  (FinancialAsset__c /                │
         │   standard FSC asset fields)         │
         │  AccountId → Household OR Individual │
         └──────────────────────────────────────┘

         ┌──────────────────────────────────────┐
         │             Revenue                  │
         │  (FSC Revenue object)                │
         │  AccountId → Household OR Individual │
         └──────────────────────────────────────┘
```

---

## Household Account — Key FSC Rollup Fields

These fields are computed by the FSC Rollup Engine. Do not create custom duplicates.

| Field Label | API Name | Type | Description |
|---|---|---|---|
| Total Net Worth | `TotalNetWorth__c` | Currency | Total Assets minus Total Liabilities across the household |
| Total Assets | `TotalAssets__c` | Currency | Sum of all asset values linked to the household |
| Total Liabilities | `TotalLiabilities__c` | Currency | Sum of all liability balances linked to the household |
| Total AUM | `TotalAUM__c` | Currency | Assets Under Management — investable financial accounts |
| Total Balance | `TotalBalance__c` | Currency | Sum of balances across all FinancialAccounts owned by the household |
| Net Worth | `NetWorth__c` | Currency | Alternate rollup field in some FSC package versions |
| Number of Household Members | `NumberOfHouseholdMembers__c` | Number | Count of active ACR members |
| Primary Member | `PrimaryMember__c` | Lookup (Contact) | FSC-designated primary Contact for the household |
| Household Billing Address | `BillingAddress` | Address | Standard Account billing address — household mailing address |

> **Note:** Exact API names for FSC rollup fields may vary by package version (FSC 3.x vs 4.x vs FSC on Platform). Always verify field API names in your org's Setup > Object Manager before coding against them.

---

## AccountContactRelation — Key Fields

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Account | `AccountId` | Lookup (Account) | The Household Account |
| Contact | `ContactId` | Lookup (Contact) | The member's Person Account Contact (PersonContactId) |
| Roles | `Roles` | Multipicklist | Semicolon-delimited; see values below |
| Is Active | `IsActive` | Boolean | `true` = active member, `false` = former member |
| Start Date | `StartDate` | Date | When the membership began (optional) |
| End Date | `EndDate` | Date | When the membership ended (optional) |
| Is Direct | `IsDirect` | Boolean | System-set; `true` for relationships created via standard UI |

**Roles Multipicklist Standard Values:**

| Value | Meaning |
|---|---|
| `Member` | Standard household member |
| `Head of Household` | Designated primary household member |
| `Decision Maker` | Financial decision maker for the household |
| `Financial Controller` | Controls household finances |
| `Power of Attorney` | Holds POA for household decisions |

> FSC may add additional role values via custom metadata. Check `AccountContactRelation.Roles` field picklist in Setup for the full list in your org.

---

## FinancialAccount — Key Fields

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Name | `Name` | Text | Account name (e.g. "Smith Joint Checking") |
| Primary Owner | `PrimaryOwner` | Lookup (Account) | Household Account for joint; individual Account for personal |
| Account | `AccountId` | Lookup (Account) | Secondary account linkage (varies by FSC version) |
| Financial Account Type | `FinancialAccountType` | Picklist | Checking, Savings, IRA, 401k, Brokerage, etc. |
| Status | `Status` | Picklist | `Active`, `Inactive`, `Closed` |
| Balance | `Balance` | Currency | Current balance |
| Outstanding Balance | `OutstandingBalance` | Currency | For liability/loan accounts |
| Open Date | `OpenDate` | Date | Date account was opened |
| Close Date | `CloseDate` | Date | Date account was closed |
| Institution | `Institution` | Text | Financial institution name |
| Description | `Description` | Text Area | Free-text notes |

**FinancialAccount.FinancialAccountType Standard Picklist Values** (varies by FSC version):

- `Checking`
- `Savings`
- `Money Market`
- `Certificate of Deposit`
- `Individual Retirement Account`
- `401(k)`
- `403(b)`
- `Brokerage`
- `529 Plan`
- `Annuity`
- `Life Insurance`
- `Trust`
- `Mortgage`
- `Line of Credit`
- `Credit Card`
- `Auto Loan`
- `Student Loan`

---

## FinancialAccountRole — Key Fields

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Financial Account | `FinancialAccount` | Master-Detail (FinancialAccount) | Parent financial account |
| Contact | `Contact` | Lookup (Contact) | The person holding this role |
| Role | `Role` | Picklist | See values below |
| Primary Role | `PrimaryRole` | Boolean | Whether this is the primary role record |
| Start Date | `StartDate` | Date | When this role began |
| End Date | `EndDate` | Date | When this role ended |

**FinancialAccountRole.Role Picklist Values:**

| Value | Description |
|---|---|
| `Primary Owner` | Primary account holder |
| `Joint Owner` | Secondary joint account holder |
| `Beneficiary` | Designated beneficiary on the account |
| `Power of Attorney` | Holds legal power of attorney over the account |
| `Trustee` | Trustee managing a trust account |
| `Successor Trustee` | Backup trustee designated to take over |
| `Guardian` | Legal guardian for a minor beneficiary |
| `Executor` | Estate executor named on the account |
| `Authorized Signer` | Authorized to transact on the account without ownership |
| `Custodian` | Custodian on a UTMA/UGMA account |

---

## Object Relationship Summary

| Relationship | Cardinality | Mechanism |
|---|---|---|
| Household Account → Person Account | 1:M | via AccountContactRelation |
| Person Account → Contact | 1:1 | PersonContactId on Person Account |
| Contact → Contact | M:M | Relationship__c junction |
| Household Account → FinancialAccount | 1:M | FinancialAccount.PrimaryOwner |
| Individual Account → FinancialAccount | 1:M | FinancialAccount.PrimaryOwner |
| FinancialAccount → Contact | M:M | FinancialAccountRole junction |
| Household/Individual Account → FinancialGoal | 1:M | FinancialGoal.AccountId |
| Household/Individual Account → FinancialPlan | 1:M | FinancialPlan.AccountId |
| Household/Individual Account → Revenue | 1:M | Revenue.AccountId |

---

## FSC Rollup Engine Notes

The FSC Rollup Engine is a background computation mechanism that aggregates financial data from child objects up to the Household Account. Key behaviors:

- Rollups run asynchronously — there may be a delay between data changes and rollup field updates.
- To manually trigger a recalculation, use FSC Rollup Settings in Setup, or invoke the FSC Rollup API.
- Rollups include only `FinancialAccount` records where `Status = 'Active'` and where the `PrimaryOwner` is either the Household Account directly or an Account that is an active member of the household via ACR.
- Rollup calculations respect `AccountContactRelation.IsActive` — members with `IsActive = false` are excluded from household aggregation.
- Do not create competing custom roll-up summary fields on the Household Account — they produce conflicting values and confuse the FSC UI components.
