# FSC Household Management — Goals, Plans, and Wealth

This reference covers `FinancialGoal`, `FinancialPlan`, Revenue, Assets and Liabilities, net worth calculation, and SOQL patterns for household wealth data.

---

## FinancialGoal

### What It Is

`FinancialGoal` represents a financial objective (retirement, college fund, home purchase, emergency fund) tied to either a household Account or an individual Account. Goals are tracked with target values, current progress, target dates, and statuses.

### FinancialGoal — Field Table

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Account | `AccountId` | Lookup (Account) | Household Account or individual Account |
| Goal Name | `Name` | Text | Descriptive name (e.g. "John's Retirement at 65") |
| Goal Type | `GoalType` | Picklist | Category of the goal; see picklist values below |
| Target Value | `TargetValue` | Currency | The goal's financial target amount |
| Current Value | `CurrentValue` | Currency | Progress to date; updated as assets grow |
| Target Date | `TargetDate` | Date | When the goal should be achieved |
| Status | `Status` | Picklist | `Not Started`, `In Progress`, `Achieved`, `Missed`, `Inactive` |
| Description | `Description` | Text Area | Free-text notes on the goal |
| Priority | `Priority` | Picklist | Goal priority (varies by FSC version) |
| Type | `Type` | Picklist | Alternative type classification (varies by FSC version) |

### GoalType Picklist Values (Standard)

| Value | Description |
|---|---|
| `Retirement` | Retirement savings target |
| `Education` | College or education funding |
| `Emergency Fund` | Emergency savings buffer |
| `Home Purchase` | Down payment or property purchase |
| `Major Purchase` | Large purchase (car, renovation, etc.) |
| `Legacy / Estate` | Wealth transfer or estate planning |
| `Debt Payoff` | Eliminating a specific debt |
| `Business Investment` | Investing in a business |
| `Travel` | Vacation or travel savings |
| `Other` | Custom goal not covered by standard types |

### Household vs. Individual Goal Linkage

`FinancialGoal.AccountId` can point to the Household Account or an individual member's Account. The linkage determines where the goal is visible:

| Linkage | AccountId | Visible In |
|---|---|---|
| Household goal | Household Account | Household FSC view, household summary |
| Individual goal | Individual Account | Individual FSC profile |

**Linkage guidelines:**
- **Retirement goal** → individual Account (`AccountId = personAccountId`) — this is one person's target
- **Home purchase goal** → household Account — the whole household is buying a home
- **College fund goal** → individual Account (the child's Account) or household depending on structure
- **Emergency fund goal** → household Account — covers all members
- **Legacy/estate goal** → household Account

Mixing all goals on the household collapses individual-level goal tracking. Establish a convention per goal type and document it.

### Creating a FinancialGoal — Apex

```apex
// Retirement goal — individual
FinancialGoal retirementGoal = new FinancialGoal(
    AccountId = johnAccountId,
    Name = 'John\'s Retirement at 65',
    GoalType = 'Retirement',
    TargetValue = 2500000.00,
    CurrentValue = 785000.00,
    TargetDate = Date.newInstance(2030, 4, 12),
    Status = 'In Progress'
);

// Home purchase goal — household
FinancialGoal homeGoal = new FinancialGoal(
    AccountId = householdId,
    Name = 'Lake House Purchase',
    GoalType = 'Home Purchase',
    TargetValue = 125000.00,    // Down payment target
    CurrentValue = 48000.00,
    TargetDate = Date.newInstance(2027, 6, 1),
    Status = 'In Progress'
);

insert new List<FinancialGoal>{ retirementGoal, homeGoal };
```

### Goal Progress Tracking

Update `CurrentValue` as the client's progress changes (e.g. after portfolio rebalancing, new contributions):

```apex
FinancialGoal goal = [
    SELECT Id, CurrentValue, TargetValue
    FROM FinancialGoal
    WHERE Id = :goalId
];
goal.CurrentValue = 820000.00;
if (goal.CurrentValue >= goal.TargetValue) {
    goal.Status = 'Achieved';
}
update goal;
```

---

## FinancialPlan

### What It Is

`FinancialPlan` represents a comprehensive financial plan document associated with a household or individual. It typically references a `FinancialPlan` record tied to the household Account with an active status. One household should have at most one active plan at a time.

### FinancialPlan — Field Table

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Account | `AccountId` | Lookup (Account) | Household or individual Account |
| Name | `Name` | Text | Plan name (e.g. "Smith Family 2025 Plan") |
| Status | `Status` | Picklist | `Draft`, `Active`, `Inactive` |
| Plan Type | `PlanType` | Picklist | Type of plan (Comprehensive, Retirement, College, etc.) |
| Description | `Description` | Text Area | Plan overview notes |
| Advisor | `OwnerId` | Lookup (User) | Assigned advisor or plan owner |
| Plan Date | `PlanDate` | Date | Date the plan was created or last reviewed |

### Plan Lifecycle — Draft → Active → Inactive

```
Draft ──────► Active ──────► Inactive
              (only one       (archived;
               active          do not delete)
               per household)
```

**Creating a new plan when one already exists:**

```apex
// Step 1: Find and deactivate the current active plan
List<FinancialPlan> activePlans = [
    SELECT Id, Status
    FROM FinancialPlan
    WHERE AccountId = :householdId
    AND Status = 'Active'
];
for (FinancialPlan fp : activePlans) {
    fp.Status = 'Inactive';
}
if (!activePlans.isEmpty()) update activePlans;

// Step 2: Create the new plan in Draft
FinancialPlan newPlan = new FinancialPlan(
    AccountId = householdId,
    Name = 'Smith Household 2026 Financial Plan',
    Status = 'Draft',
    PlanType = 'Comprehensive',
    PlanDate = Date.today()
);
insert newPlan;

// Step 3: Activate when ready
newPlan.Status = 'Active';
update newPlan;
```

**Why not delete old plans?**
FINRA requires advisors to maintain records of financial recommendations and plans. Deleting a `FinancialPlan` destroys the audit trail of what was recommended and when.

### One Active Plan Rule

Enforce via validation rule on `FinancialPlan`:

```
Error condition formula:
AND(
  Status = 'Active',
  ISCHANGED(Status),
  VLOOKUP($ObjectType.FinancialPlan.Fields.Status, $ObjectType.FinancialPlan.Fields.AccountId, AccountId) = 'Active'
)
```

Or enforce via an Apex trigger `before insert/before update` that checks for existing active plans.

---

## Revenue

### What It Is

The FSC `Revenue` object (API name may be `Revenue` or vary by FSC version) captures revenue data associated with an Account — typically advisor-generated revenue, fee income, or commission income linked to a household or client.

### Revenue — Key Fields

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Account | `AccountId` | Lookup (Account) | Household or individual Account |
| Amount | `Amount` | Currency | Revenue amount |
| Revenue Type | `RevenueType` | Picklist | Fee, Commission, Advisory, etc. |
| Date | `RevenueDate` | Date | When the revenue was recognized |
| Financial Account | `FinancialAccountId` | Lookup (FinancialAccount) | Source financial account (optional) |

> Note: The FSC `Revenue` object may be named differently depending on your FSC package version. Verify the API name in your org's Setup > Object Manager.

---

## Assets and Liabilities

### Overview

FSC models assets and liabilities in two ways depending on the package version:

1. **Via FinancialAccount** — asset accounts (brokerage, savings, real estate) and liability accounts (mortgage, credit card, auto loan) are both modeled as `FinancialAccount` records with different `FinancialAccountType` values. `Balance` on asset accounts is positive; `OutstandingBalance` on liability accounts represents what is owed.

2. **Via custom FSC objects** — some FSC versions include `FinancialAsset__c` (or equivalent) and `FinancialLiability__c` objects for non-account assets (real estate holdings, personal property, jewelry) and liabilities (informal debts). Verify which objects are present in your org.

### FinancialAccount as Asset — Key Patterns

| FinancialAccountType | Category | Balance Field |
|---|---|---|
| `Checking`, `Savings`, `Money Market` | Liquid Assets | `Balance` |
| `Brokerage`, `Individual Retirement Account`, `401(k)` | Investment Assets | `Balance` |
| `529 Plan`, `Annuity` | Long-Term Assets | `Balance` |
| `Mortgage`, `Home Equity Line of Credit` | Liabilities | `OutstandingBalance` |
| `Auto Loan`, `Student Loan`, `Credit Card` | Liabilities | `OutstandingBalance` |

### Custom Asset and Liability Fields (if present in FSC version)

Some FSC packages include a `FinancialAsset__c` object:

| Field Label | API Name | Type | Notes |
|---|---|---|---|
| Account | `AccountId__c` | Lookup (Account) | Linked Account (household or individual) |
| Asset Type | `AssetType__c` | Picklist | Real Estate, Vehicle, Art, Jewelry, Business Interest, Other |
| Description | `Description__c` | Text Area | Asset description |
| Value | `Value__c` | Currency | Current estimated value |
| Purchase Date | `PurchaseDate__c` | Date | When the asset was acquired |
| Purchase Price | `PurchasePrice__c` | Currency | Original cost |

> Always verify object and field API names in your specific org. FSC managed package objects and fields may differ between FSC versions (FSC 3.x, FSC 4.x, FSC on Platform/Core).

---

## Total Net Worth Calculation

FSC computes Total Net Worth on the Household Account via the rollup engine using the formula:

```
Total Net Worth = Total Assets - Total Liabilities
```

Where:
- **Total Assets** = sum of `Balance` on active FinancialAccounts where account type is an asset type, owned by the household or its members
- **Total Liabilities** = sum of `OutstandingBalance` on active FinancialAccounts where account type is a liability type, owned by the household or its members

The FSC rollup fields on the Household Account:

| Rollup Field | API Name | What It Includes |
|---|---|---|
| Total Net Worth | `TotalNetWorth__c` | Assets minus liabilities |
| Total Assets | `TotalAssets__c` | All asset-type financial account balances |
| Total Liabilities | `TotalLiabilities__c` | All liability-type outstanding balances |
| Total AUM | `TotalAUM__c` | Investable assets (brokerage, retirement accounts) |

Do not build custom formula fields that recalculate these — use the FSC rollup values directly.

---

## SOQL — Household Goals and Plan Queries

### All Active Goals for a Household (household-level and member-level)

```apex
// Step 1: Get active member Account IDs
List<AccountContactRelation> acrs = [
    SELECT Contact.AccountId
    FROM AccountContactRelation
    WHERE AccountId = :householdId
    AND IsActive = true
];
Set<Id> accountIds = new Set<Id>{ householdId };
for (AccountContactRelation acr : acrs) {
    accountIds.add(acr.Contact.AccountId);
}

// Step 2: Query goals for all those accounts
List<FinancialGoal> allGoals = [
    SELECT Id, Name, GoalType, TargetValue, CurrentValue,
           TargetDate, Status, AccountId, Account.Name
    FROM FinancialGoal
    WHERE AccountId IN :accountIds
    AND Status != 'Inactive'
    ORDER BY TargetDate ASC
];
```

### Household-Level Goals Only

```soql
SELECT Id, Name, GoalType, TargetValue, CurrentValue, TargetDate, Status
FROM FinancialGoal
WHERE AccountId = :householdId
ORDER BY TargetDate ASC
```

### Active Financial Plan for a Household

```soql
SELECT Id, Name, Status, PlanType, PlanDate, OwnerId
FROM FinancialPlan
WHERE AccountId = :householdId
AND Status = 'Active'
LIMIT 1
```

### All Plans for a Household (Including Historical)

```soql
SELECT Id, Name, Status, PlanType, PlanDate, CreatedDate
FROM FinancialPlan
WHERE AccountId = :householdId
ORDER BY CreatedDate DESC
```

### Goal Progress Summary

```soql
SELECT GoalType,
       SUM(TargetValue) totalTarget,
       SUM(CurrentValue) totalCurrent,
       COUNT(Id) goalCount
FROM FinancialGoal
WHERE AccountId = :householdId
AND Status = 'In Progress'
GROUP BY GoalType
```
