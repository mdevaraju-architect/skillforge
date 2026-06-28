# FSC Wealth Management — Financial Accounts and Holdings

## FinancialAccount Types

Financial account types are driven by the `FinancialAccountType` Custom Metadata Type. The `FinancialAccount.FinancialAccountType` field stores the type value. Core categories:

| Category | Types | Notes |
|---|---|---|
| Investment | `Brokerage`, `ManagedAccount`, `TrustAccount` | Can hold securities, mutual funds, bonds |
| Retirement | `TraditionalIRA`, `RothIRA`, `401k`, `403b`, `SEP_IRA`, `SIMPLE_IRA`, `Rollover_IRA` | Tax-advantaged; no joint ownership |
| Education | `529Plan`, `CoverdellESA` | Beneficiary = the student |
| Banking | `Checking`, `Savings`, `MoneyMarket`, `CD` | Lower AUM weight; balance is cash |
| Insurance / Annuity | `VariableAnnuity`, `FixedAnnuity`, `IndexedAnnuity` | Overlap with insurance; held in wealth module |
| Custodial | `UGMA`, `UTMA` | Minor beneficiary accounts |

### Account Type–Specific Constraints

**Retirement accounts (`TraditionalIRA`, `RothIRA`, `401k`, etc.):**
- Cannot have `FinancialAccountRole.Role = 'JointOwner'` (IRS rule).
- Must have at least one `Beneficiary` FinancialAccountRole.
- `FinancialAccount.AnnualContributionLimit__c` (custom or standard field) should be set to enforce IRS contribution limits.
- Rollover accounts (`Rollover_IRA`) should carry `FinancialAccount.SourceAccountReference__c` (custom) for audit.

**Trust accounts:**
- Must have at least one `Trustee` FinancialAccountRole.
- `FinancialAccount.TrustDate__c` and `FinancialAccount.TrustType__c` fields (custom) are commonly required.
- Trust accounts often have a Business Account as `PrimaryOwnerId` rather than a Contact.

**529 Plans:**
- `PrimaryOwnerId` = the account holder (typically parent).
- `Beneficiary` FinancialAccountRole = the student (child Contact).
- Investment options are limited to plan-approved portfolios.

---

## FinancialAccount Key Fields Reference

| Field API Name | Type | Notes |
|---|---|---|
| `Name` | Text | Display name of account |
| `FinancialAccountType` | Picklist (from FinancialAccountType__mdt) | Account type |
| `PrimaryOwnerId` | Lookup polymorphic | Household Account or Contact |
| `JointOwnerContactId` | Lookup (Contact) | Shortcut field for joint owner |
| `Status` | Picklist | `Active`, `Inactive`, `Closed`, `Pending`, `Frozen` |
| `Balance` | Currency | Current market value of account |
| `CashBalance` | Currency | Uninvested cash within the account |
| `OpenDate` | Date | Account opened date |
| `CloseDate` | Date | Account close date |
| `CustodianId` | Lookup (Account) | Custodian firm account |
| `FinancialAccountNumber` | Text | External account number |
| `HeldAwayIndicator` | Boolean | True = externally custodied |
| `InvestmentObjective` | Picklist | `Growth`, `Income`, `Balanced`, `Preservation`, `Speculation` |
| `RiskTolerance` | Picklist | `Conservative`, `Moderate`, `Aggressive`, `VeryAggressive` |
| `LastReviewDate` | Date | Date of last advisor review |
| `FeeStructure__c` | Picklist (custom) | `AUMBased`, `FlatFee`, `CommissionBased`, `HourlyFee` |
| `PerformanceYTD__c` | Percent (custom) | Year-to-date return; populated by integration |
| `BenchmarkIndex__c` | Text (custom) | Benchmark for performance comparison |

---

## FinancialHolding — Position-Level Detail

`FinancialHolding` (API name: `FinancialHolding`) records one investment position within a `FinancialAccount`.

### Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `FinancialAccountId` | Master-Detail | Parent FinancialAccount — required |
| `Name` | Text | Security name or holding description |
| `HoldingType` | Picklist | `Security`, `MutualFund`, `Bond`, `CD`, `Annuity`, `AlternativeInvestment`, `Cash` |
| `Quantity` | Number | Shares / units held |
| `CurrentPrice` | Currency | Price per unit (from custodian feed) |
| `MarketValue` | Currency | `Quantity × CurrentPrice` |
| `CostBasis` | Currency | Original purchase cost (total, not per unit) |
| `PurchasePrice` | Currency | Price per unit at purchase |
| `PurchaseDate` | Date | Date the position was established |
| `UnrealizedGainLoss` | Currency | `MarketValue − CostBasis` |
| `AssetClass` | Picklist | `Equity`, `FixedIncome`, `Cash`, `Alternative`, `RealEstate` |
| `SecurityId` | Lookup (FinancialSecurity) | Links to FinancialSecurity object (CUSIP, ISIN, ticker) |
| `PercentageOfPortfolio` | Percent | `MarketValue / Account.Balance × 100` |
| `LastPriceUpdateDate` | DateTime | When price was last refreshed from feed |

### HoldingType-Specific Required Fields

| HoldingType | Key additional fields |
|---|---|
| `Security` | `SecurityId` (or `Ticker__c`), `Quantity`, `CurrentPrice` |
| `MutualFund` | `SecurityId` (CUSIP), `Quantity` (units/shares), NAV as `CurrentPrice` |
| `Bond` | `FaceValue__c`, `CouponRate__c`, `MaturityDate__c`, `Quantity` (face value units) |
| `CD` | `MaturityDate__c`, `InterestRate__c`, `PrincipalAmount__c` |
| `Annuity` | `ContractValue__c`, `SurrenderValue__c`, `AnnuitizationDate__c` |
| `AlternativeInvestment` | `InvestmentStrategy__c`, often estimated/appraisal-based value |
| `Cash` | `MarketValue` = cash balance; `Quantity` = 1, `CurrentPrice` = MarketValue |

### FinancialSecurity Object

`FinancialSecurity` (API name: `FinancialSecurity`) is the security master — a catalog of investable securities. It is NOT a holding — it is a reference record.

| Field | Description |
|---|---|
| `Name` | Security name |
| `Ticker` | Exchange ticker symbol |
| `CUSIP__c` | 9-character CUSIP identifier |
| `ISIN__c` | 12-character ISIN identifier |
| `SecurityType` | `Equity`, `MutualFund`, `ETF`, `Bond`, `StructuredProduct` |
| `Exchange` | `NYSE`, `NASDAQ`, `OTC`, etc. |
| `CurrentPrice` | Current market price (from price feed) |

**Pattern:** `FinancialHolding.SecurityId` looks up to `FinancialSecurity`. When a custodian feed delivers positions, match or upsert `FinancialSecurity` records by CUSIP/ISIN first, then create/update `FinancialHolding` records.

---

## FinancialAccountTransaction

`FinancialAccountTransaction` records individual transactions: purchases, sales, dividends, fees, transfers.

### Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `FinancialAccountId` | Lookup (FinancialAccount) | Parent account — always filter by this |
| `TransactionDate` | Date | Date of transaction — always filter by this |
| `TransactionType` | Picklist | `Buy`, `Sell`, `Dividend`, `Interest`, `Withdrawal`, `Deposit`, `Transfer`, `Fee`, `Reinvestment` |
| `Amount` | Currency | Transaction value (positive for buys/deposits, negative for sells/withdrawals) |
| `Quantity` | Number | Shares/units involved |
| `Price` | Currency | Price per unit at transaction time |
| `FinancialHoldingId` | Lookup (FinancialHolding) | Linked holding (for buy/sell/dividend transactions) |
| `Description` | Text | Narrative from custodian |
| `ReferenceNumber` | Text | Custodian transaction reference |

### SOQL Performance Pattern

Always include both `FinancialAccountId` and a `TransactionDate` range:

```soql
SELECT Id, TransactionDate, TransactionType, Amount, Quantity, Price
FROM FinancialAccountTransaction
WHERE FinancialAccountId = :accountId
AND TransactionDate >= :startDate
AND TransactionDate <= :endDate
ORDER BY TransactionDate DESC
LIMIT 200
```

**Never query `FinancialAccountTransaction` without a date filter in any Apex trigger, batch, or Flow.** High-volume accounts contain years of transaction history. A query without a date filter will hit SOQL row limits (50,000 rows in synchronous context) on active accounts.

---

## Custodian Integration Patterns

Most FSC Wealth implementations connect to a custodian (Schwab, Fidelity, Pershing, BNY Mellon Pershing, LPL, Apex Clearing) to synchronize account balances, holdings, and transactions.

### Integration Architecture

```
Custodian Data Feed (SFTP/API)
    │
    ▼
Middleware / MuleSoft / Heroku
    │
    ▼
Salesforce Bulk API 2.0 or REST API
    │
    ├── Upsert FinancialSecurity (by CUSIP/ISIN)
    ├── Upsert FinancialAccount (by FinancialAccountNumber)
    ├── Upsert FinancialHolding (by FinancialAccountId + SecurityId)
    └── Insert FinancialAccountTransaction (never upsert — append only)
```

### Upsert Keys

| Object | External ID / Upsert Key |
|---|---|
| `FinancialSecurity` | `CUSIP__c` or `ISIN__c` |
| `FinancialAccount` | `FinancialAccountNumber` (external account number) |
| `FinancialHolding` | Composite: `FinancialAccountId` + `SecurityId` (via external ID or match logic) |
| `FinancialAccountTransaction` | `ReferenceNumber` (custodian transaction ID) — use as external ID to prevent duplicates |

**Gotcha:** `FinancialAccountTransaction` must use an external ID (e.g., `CustodianTransactionId__c`) to prevent duplicate inserts during re-delivery of transaction feeds. Always define an External ID field on this object before the first integration load.

### Post-Sync Steps

After a custodian data sync:
1. Recalculate `FinancialAccount.Balance` = sum of `FinancialHolding.MarketValue` for the account.
2. Update `FinancialHolding.PercentageOfPortfolio` for each holding.
3. Trigger household AUM rollup (batch or platform event).
4. Check for suitability drift: compare `FinancialHolding.AssetClass` distribution against `FinancialAccount.InvestmentObjective` thresholds. Create `RecordAlert` if drift exceeds threshold.

---

## Account Performance Calculation

FSC does not include a native performance engine. Performance is typically calculated externally (custodian system, Orion, Tamarac, Black Diamond) and written back to Salesforce.

| Field | Object | Description |
|---|---|---|
| `PerformanceYTD__c` | `FinancialAccount` | Year-to-date return percentage |
| `Performance1Year__c` | `FinancialAccount` | 1-year trailing return |
| `Performance3Year__c` | `FinancialAccount` | 3-year annualized return |
| `BenchmarkReturn__c` | `FinancialAccount` | Benchmark return for the same period |
| `Alpha__c` | `FinancialAccount` | Return above benchmark |

These are typically custom fields populated by an integration job. They do not auto-calculate from `FinancialAccountTransaction` records in standard FSC.

---

## Rebalancing Workflow

Rebalancing (realigning a portfolio to its target asset allocation) is an advisor-initiated workflow:

1. **Identify drift:** Compare current `FinancialHolding.PercentageOfPortfolio` by `AssetClass` against the target allocation defined in the investment mandate (stored as custom metadata or on the FinancialAccount).
2. **Flag for review:** Create a `RecordAlert` with `Severity = 'Medium'` or `'High'` on the `FinancialAccount` when any asset class deviates beyond the tolerance band (e.g., ±5%).
3. **Advisor review:** Advisor opens the account, reviews the drift, and approves rebalancing.
4. **Generate rebalancing orders:** Create a custom `RebalancingOrder__c` object (or use a third-party OMS integration) for each required trade.
5. **Submit orders to custodian:** Via Integration Procedure or MuleSoft flow to the custodian's order management API.
6. **Update holdings post-trade:** After trade confirmation, custodian feed updates `FinancialHolding` quantities and market values.
7. **Record `FinancialAccountTransaction`** entries for each executed trade.
8. **Dismiss the drift `RecordAlert`** after rebalancing is confirmed.

**Gotcha:** Salesforce FSC does not include a native Order Management System (OMS). Rebalancing execution must be handled via a third-party OMS (Orion, Tamarac, AdvisorEngine) integrated via API. FSC Wealth tracks the result but does not execute trades.
