# FSC Wealth Management — Architecture

Salesforce Financial Services Cloud Wealth Management is built on a core set of FSC-specific objects layered on top of the standard Salesforce platform. The household Account model is the organizing unit for all wealth relationships.

---

## Module Boundary

FSC Wealth owns the client and household relationship, financial accounts, holdings, goals, plans, and advisor fee tracking. Adjacent modules it interacts with but does not own:

| Adjacent module | Interaction point |
|---|---|
| FSC Insurance Policy (`InsurancePolicy`) | An individual may have both wealth accounts and insurance policies; separate skill |
| FSC Mortgage (`ResidentialLoanApplication`) | Liabilities modeled in `AssetsAndLiabilities`; origination is a separate skill |
| Salesforce Files | Documents attached to FinancialAccount, FinancialPlan via `ContentDocumentLink` |
| Agentforce / Einstein | Advisor copilot, next best action, goal progress alerts |
| OmniStudio (optional) | Some orgs use FlexCards for household dashboards and OmniScripts for onboarding |
| Revenue Cloud (NOT applicable) | Fee tracking uses `Revenue` + `RevenueSchedule`, not Revenue Cloud objects |

---

## Core Object Map

```
Account (RecordType = IndustriesHousehold)   ← Household hub
  │
  ├── AccountContactRelation                 (Household Member roles)
  │     └── Contact (RecordType = IndustriesIndividual / PersonAccount)
  │
  ├── RelationshipGroup                      (multi-household or advisor group)
  │     └── RelationshipGroupMember
  │
  ├── FinancialAccount                       ← Financial account hub
  │     ├── FinancialAccountRole             (Owner, JointOwner, Beneficiary, Trustee, POA)
  │     ├── FinancialHolding                 (Security, MutualFund, Bond, CD, Annuity, Cash)
  │     ├── FinancialAccountTransaction      (buy, sell, dividend, fee, transfer)
  │     └── Revenue                          (advisory fees linked to account)
  │           └── RevenueSchedule            (recurring fee cadence)
  │
  ├── AssetsAndLiabilities                   (external/non-custodied wealth: real estate, debt)
  │
  ├── FinancialPlan                          (overarching financial plan for the household)
  │     └── FinancialGoal                   (individual goals: retirement, education, etc.)
  │
  └── RecordAlert                            (compliance and risk flags on household or accounts)

ActionPlanTemplate → ActionPlan → ActionPlanItem → Task
  (KYC workflows, suitability reviews, annual check-ins)
```

---

## Household Model

### Account RecordTypes (FSC-installed, not custom)

| RecordType DeveloperName | Label | Purpose |
|---|---|---|
| `IndustriesHousehold` | Household | Groups a family or related individuals; has AUM rollup fields |
| `IndustriesIndividual` | Individual | Person client (non-person-account orgs); alternate is PersonAccount |
| `IndustriesBusiness` | Business | Corporate or trust entity |

**Critical:** The `IndustriesHousehold` RecordType is installed by FSC managed package. Do not create a custom RecordType named "Household" — FSC managed components query specifically for `IndustriesHousehold` by developer name. If an org uses Person Accounts, the individual is a PersonAccount with RecordType `PersonAccount` and the Household Account is a separate record.

### Household Membership via AccountContactRelation

```
Household Account (IndustriesHousehold)
  ├── AccountContactRelation.ContactId → Contact A (primary, Roles: 'Household Member')
  ├── AccountContactRelation.ContactId → Contact B (spouse, Roles: 'Household Member')
  └── AccountContactRelation.ContactId → Contact C (dependent, Roles: 'Household Member')
```

Key fields on `AccountContactRelation`:
- `Roles` — multi-select picklist; must include `'Household Member'` for FSC household panels to display the contact
- `IsActive` — must be `true` for active membership
- `IsDirect` — set to `true` for direct (not via group) household relationship
- `StartDate` / `EndDate` — for historical household membership tracking

### Household Rollup Fields (on Account)

FSC installs or activates these fields on Account when `IndustriesHousehold` RecordType is used:

| Field API Name | Type | Description |
|---|---|---|
| `TotalAum__c` | Currency | Sum of all `FinancialAccount.Balance` for household members |
| `TotalAssets__c` | Currency | AUM + `AssetsAndLiabilities` asset values |
| `TotalLiabilities__c` | Currency | Sum of liability-type `AssetsAndLiabilities` records |
| `NetWorth__c` | Currency | `TotalAssets__c` − `TotalLiabilities__c` |
| `NumberOfFinancialAccounts__c` | Number | Count of linked `FinancialAccount` records |

**Rollup is NOT real-time by default.** The standard FSC implementation uses a scheduled Apex job (`FinancialAccountSummaryBatch`) or a roll-up summary trigger to keep these values current. In high-volume orgs, some implementations switch to asynchronous rollup via platform events. Always verify rollup freshness before surfacing AUM to users.

---

## FinancialAccount Object

`FinancialAccount` (API name: `FinancialAccount`) is the central wealth object representing any client account — brokerage, retirement, banking, or held-away.

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Account name / number label |
| `FinancialAccountType` | Picklist | Account type; driven by `FinancialAccountType` custom metadata |
| `PrimaryOwnerId` | Lookup (Account/Contact) | Polymorphic: points to Household Account or individual Contact |
| `JointOwnerContactId` | Lookup (Contact) | Shortcut for joint accounts (mirrors FinancialAccountRole JointOwner) |
| `Status` | Picklist | `Active`, `Inactive`, `Closed`, `Pending` |
| `Balance` | Currency | Current total account value |
| `OpenDate` | Date | Account open date |
| `CloseDate` | Date | Account close date (if closed) |
| `CustodianId` | Lookup (Account) | Custodian firm (as an Account record) |
| `HeldAwayIndicator` | Boolean | `true` = externally custodied, not managed here |
| `InvestmentObjective` | Picklist | `Growth`, `Income`, `Balanced`, `Preservation`, `Speculation` |
| `RiskTolerance` | Picklist | `Conservative`, `Moderate`, `Aggressive` |
| `FinancialAccountNumber` | Text | External account number from custodian |

---

## FinancialHolding Object

`FinancialHolding` (API name: `FinancialHolding`) is a child of `FinancialAccount` representing individual positions.

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `FinancialAccountId` | Master-Detail (FinancialAccount) | Parent account |
| `Name` | Text | Security/fund name |
| `HoldingType` | Picklist | `Security`, `MutualFund`, `Bond`, `CD`, `Annuity`, `AlternativeInvestment`, `Cash` |
| `Quantity` | Number | Number of shares/units |
| `CurrentPrice` | Currency | Price per share/unit |
| `MarketValue` | Currency | `Quantity × CurrentPrice` |
| `CostBasis` | Currency | Original purchase cost |
| `UnrealizedGainLoss` | Currency | `MarketValue − CostBasis` |
| `AssetClass` | Picklist | `Equity`, `FixedIncome`, `Cash`, `Alternative`, `RealEstate` |
| `SecurityId` | Lookup (Financial Security) | Links to `FinancialSecurity` object (CUSIP/ISIN data) |
| `Ticker__c` | Text | Ticker symbol (often custom) |

---

## AssetsAndLiabilities Object

Captures non-custodied, externally held assets and liabilities for net worth calculation.

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Description of asset or liability |
| `Type` | Picklist | `RealEstate`, `PersonalProperty`, `BusinessInterest`, `Mortgage`, `CreditCard`, `StudentLoan`, `OtherAsset`, `OtherLiability` |
| `Amount` | Currency | Current estimated value |
| `PrimaryOwner__c` | Lookup (Contact) | Owner of the asset/liability |
| `AccountId` | Lookup (Account) | Household or individual account |
| `IsLiability` | Boolean | `true` for debts and obligations |
| `AssetFrequency` | Picklist | For income-producing assets: `Monthly`, `Annual` |

**Gotcha:** `AssetsAndLiabilities` rolls into net worth fields on the Household Account but does NOT roll into `TotalAum__c`. AUM is financial account balances only. External real estate adds to `TotalAssets__c` but is tracked separately from investment AUM.

---

## AUM Rollup Pattern

The standard FSC AUM rollup architecture:

```
FinancialAccount.Balance (per account)
    │
    ▼ (trigger or batch job)
Account.TotalAum__c (household-level sum)
    │
    ▼ (optional: for advisor reporting)
User.TotalBookAum__c or custom Territory AUM report
```

### Implementation Options

1. **Roll-Up Summary Field** — Works only if `FinancialAccount.PrimaryOwnerId` is a master-detail to Account. Most FSC orgs use a lookup (polymorphic), so roll-up summaries cannot be used natively. Custom Apex trigger or flow is required.
2. **Scheduled Apex Batch** — `FinancialAccountSummaryBatch` runs nightly (or more frequently for real-time needs). Safe for high-volume orgs.
3. **Platform Event + Trigger** — Real-time: a platform event fires when `FinancialAccount.Balance` changes (e.g., after custodian data sync), and a trigger updates the household Account's AUM field.
4. **Einstein Analytics / CRM Analytics** — AUM dashboards in CRM Analytics bypass the rollup field entirely and aggregate at query time. Preferred for reporting; not a substitute for the field if automation depends on it.

---

## RecordAlert Object

`RecordAlert` surfaces compliance, risk, and action items on Household and FinancialAccount Lightning pages.

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Short alert title |
| `Subject` | Text | Longer description of the alert |
| `Severity` | Picklist | `High`, `Medium`, `Low` |
| `ParentId` | Lookup (polymorphic) | Account, Contact, FinancialAccount |
| `StatusCategory` | Picklist | `New`, `Snoozed`, `Dismissed` |
| `SnoozeUntil` | DateTime | When snoozed, hide until this date |
| `ActionPlanId` | Lookup (ActionPlan) | Optional: links to a related ActionPlan |

---

## Technology Stack

```
Advisor / Client
    │
    ▼
FSC Lightning Pages (Household 360, Financial Account Summary)
    │
FSC Managed Components (Relationship Map, AUM chart, Goals panel)
    │
Salesforce Platform
    ├── FSC Wealth objects (FinancialAccount, FinancialHolding, FinancialGoal, …)
    ├── Flows (onboarding, suitability review, alert creation)
    ├── Apex (AUM rollup batch, fee calculations, complex validations)
    ├── ActionPlanTemplate / ActionPlan (KYC, suitability, annual review checklists)
    ├── RecordAlert (compliance and risk surfacing)
    └── Agentforce (optional: advisor copilot, goal progress summaries)
```
