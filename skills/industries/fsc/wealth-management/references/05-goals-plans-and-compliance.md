# FSC Wealth Management — Goals, Plans, and Compliance

## FinancialGoal and FinancialPlan

### Relationship Between the Two Objects

`FinancialPlan` is the overarching plan document. `FinancialGoal` records are individual objectives within that plan.

```
FinancialPlan (one per household, or one per review cycle)
  ├── FinancialGoal: Retirement (TargetDate: 2035, TargetAmount: $2M)
  ├── FinancialGoal: College Education (TargetDate: 2028, TargetAmount: $250K)
  └── FinancialGoal: Emergency Fund (TargetDate: 2025, TargetAmount: $50K)
```

**Critical:** Do NOT model financial goals as Opportunities, Tasks, or Cases. FSC provides `FinancialGoal` for this purpose. Using Opportunity for goals breaks the FSC Household 360 page goals panel and prevents standard goal progress reporting.

---

## FinancialPlan Object

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Plan name, e.g. "Smith Household Financial Plan 2025" |
| `AccountId` | Lookup (Account) | The Household Account this plan belongs to |
| `PlanStatus` | Picklist | `Draft`, `Proposed`, `Accepted`, `InReview`, `Archived` |
| `PlanDate` | Date | Date the plan was created or last formally revised |
| `AcceptedDate` | Date | Date the client formally accepted the plan |
| `AdvisorId` | Lookup (User) | Advisor responsible for the plan |
| `ReviewFrequency` | Picklist | `Annual`, `SemiAnnual`, `Quarterly` |
| `NextReviewDate` | Date | Auto-calculated from `AcceptedDate` + `ReviewFrequency` |
| `Description` | Long Text | Plan narrative summary |

### Plan Status Lifecycle

```
Draft → Proposed → Accepted → InReview → (back to Proposed or Accepted)
                                        ↓
                                     Archived
```

- A plan enters `InReview` status at the start of the annual review workflow.
- A plan is `Archived` when superseded by a new accepted plan.
- Only one plan should be in `Accepted` or `Proposed` status at a time per household. Use a validation rule to enforce this.

---

## FinancialGoal Object

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Goal name, e.g. "Retirement at 65" |
| `FinancialPlanId` | Lookup (FinancialPlan) | Parent financial plan |
| `AccountId` | Lookup (Account) | Household Account (for goals not linked to a plan) |
| `GoalType` | Picklist | See GoalType values below |
| `TargetAmount` | Currency | Total amount needed to achieve the goal |
| `TargetDate` | Date | Target completion date |
| `ActualValue` | Currency | Current funded/saved amount toward the goal |
| `Progress` | Percent | `ActualValue / TargetAmount * 100` (formula or calculated field) |
| `Status` | Picklist | `NotStarted`, `InProgress`, `AtRisk`, `Achieved`, `Abandoned` |
| `Priority` | Picklist | `High`, `Medium`, `Low` |
| `Description` | Text | Narrative about the goal |
| `AnnualContribution__c` | Currency (custom) | Planned annual savings toward this goal |
| `FundedAccounts__c` | Text (custom) | References to linked FinancialAccounts |

### GoalType Picklist Values

| Value | Description |
|---|---|
| `Retirement` | Save for retirement income |
| `Education` | Fund education expenses (529, UTMA) |
| `HomePurchase` | Save for real estate purchase |
| `EmergencyFund` | Build liquid emergency reserve |
| `MajorPurchase` | Large planned purchase (vehicle, business, etc.) |
| `DebtPayoff` | Pay down a liability (mortgage, student loan) |
| `Wealth` | General wealth accumulation |
| `Charitable` | Charitable giving goal |
| `BusinessSuccession` | Business exit / transfer planning |

### Goal Progress Tracking Pattern

Goal progress should be refreshed when:
- `FinancialAccount.Balance` changes (via AUM rollup batch or custodian sync)
- A `FinancialAccountTransaction` with `TransactionType = 'Deposit'` or `'Contribution'` is posted
- The advisor manually updates `ActualValue` during an annual review

**Gotcha:** FSC does not automatically update `FinancialGoal.ActualValue` when `FinancialAccount.Balance` changes. You must build this connection via an Apex trigger, scheduled batch, or Flow that maps the relevant account balances to the appropriate goal's `ActualValue`. The mapping logic (which accounts fund which goals) requires a junction or custom field to define the relationship.

---

## ActionPlanTemplate — Advisor Compliance Workflows

`ActionPlanTemplate` defines a reusable checklist of tasks. In FSC Wealth, it is the mechanism for:
- KYC / AML onboarding checklists
- Suitability review workflows
- Annual planning review checklists
- Regulatory refresh cycles (FINRA Rule 4512 customer account record updates)

### Objects in the ActionPlan Family

| Object | Description |
|---|---|
| `ActionPlanTemplate` | The reusable template; defines the task sequence and owners |
| `ActionPlanTemplateItem` | Individual task in the template |
| `ActionPlan` | An instantiation of a template, linked to a specific Account or FinancialAccount |
| `ActionPlanItem` | Individual task instance (created from `ActionPlanTemplateItem`) |
| `Task` | Standard Salesforce Task created automatically for each `ActionPlanItem` |

### Creating an ActionPlan from a Template

```apex
ActionPlan ap = new ActionPlan();
ap.ActionPlanTemplateId = templateId;
ap.TargetId = householdAccountId; // Can be Account, Contact, FinancialAccount
ap.Name = 'KYC Onboarding - Smith Household - ' + Date.today().year();
ap.StartDate = Date.today();
ap.Status = 'InProgress';
insert ap;
// FSC automatically creates ActionPlanItem and Task records from the template
```

### Standard FSC Wealth ActionPlanTemplates

Create these templates in the org:

| Template Name | Trigger | Steps |
|---|---|---|
| `KYC_Onboarding` | New household client | Verify identity documents, collect W-9, risk tolerance questionnaire, source of wealth declaration, suitability form signature |
| `Annual_Review` | Annual (scheduled) | Review risk tolerance, update beneficiaries, review account performance, check suitability drift, update financial plan |
| `Account_Opening` | New FinancialAccount | Collect account agreement, verify suitability for account type, confirm custodian paperwork, review fee disclosure |
| `Suitability_Review` | Major life event, AUM threshold change | Update income/net worth, reassess risk tolerance, document investment objective change |

---

## RecordAlert — Compliance and Risk Flags

`RecordAlert` is the FSC mechanism for surfacing compliance issues, risk flags, and action items to advisors on the Household 360 and Financial Account pages.

### Key Fields

| Field API Name | Type | Description |
|---|---|---|
| `Name` | Text | Short alert title (shown in alert list) |
| `Subject` | Text | Detailed description of the alert |
| `Severity` | Picklist | `High` (red), `Medium` (yellow), `Low` (blue) |
| `ParentId` | Lookup (polymorphic) | Account, Contact, or FinancialAccount |
| `StatusCategory` | Picklist | `New`, `Snoozed`, `Dismissed` |
| `SnoozeUntil` | DateTime | Hide until this datetime (when `StatusCategory = Snoozed`) |
| `ActionPlanId` | Lookup (ActionPlan) | Links to a related compliance workflow |
| `AlertType__c` | Picklist (custom) | `Suitability`, `Compliance`, `Risk`, `ServiceDue`, `DocumentExpiry` |
| `CreatedById` | Lookup (User) | System or advisor who created the alert |

### Common RecordAlert Scenarios

| Scenario | Severity | Triggered by |
|---|---|---|
| Suitability mismatch (account risk > client risk tolerance) | `High` | Custodian sync or manual review |
| KYC documents expired (>3 years since last refresh) | `High` | Scheduled batch checking `Contact.LastKYCDate__c` |
| Beneficiary missing on retirement account | `High` | FinancialAccount trigger (no Beneficiary role) |
| PEP (Politically Exposed Person) flag | `High` | Compliance screening integration |
| AML watchlist match | `High` | Compliance screening integration |
| Account not reviewed in >12 months | `Medium` | Batch job checking `FinancialAccount.LastReviewDate` |
| Financial plan not accepted (status = Draft for >60 days) | `Medium` | Scheduled Flow |
| Goal progress at risk (<70% funded with <2 years to target) | `Medium` | Goal progress batch |
| Fee schedule not set on active account | `Low` | Account creation trigger |

### Dismissing RecordAlerts for Audit Trail

When dismissing an alert, always capture the reason:
```apex
RecordAlert alert = [SELECT Id, StatusCategory FROM RecordAlert WHERE Id = :alertId];
alert.StatusCategory = 'Dismissed';
// Log dismissal reason — FSC does not have a native dismissal reason field
// Create a custom Note or use a custom field: DismissalReason__c
alert.DismissalReason__c = 'Annual review completed. Beneficiary updated.';
alert.DismissedDate__c = DateTime.now();
update alert;
```

For FINRA compliance, every dismissed `High` severity alert must have an audit record. Do not dismiss without logging the reason.

---

## Suitability Assessment in FSC

Suitability is the assessment of whether an investment is appropriate for a specific client given their financial situation, risk tolerance, and investment objectives. FINRA Rule 2111 requires this.

### Suitability Data Points (stored on Contact or FinancialAccount)

| Field | Object | API Name (example) |
|---|---|---|
| Annual Income | Contact | `AnnualIncome__c` |
| Net Worth | Contact | `NetWorth__c` (or derived from Household `NetWorth__c`) |
| Liquid Net Worth | Contact | `LiquidNetWorth__c` |
| Tax Bracket | Contact | `TaxBracket__c` |
| Investment Experience | Contact | `InvestmentExperience__c` (picklist: `None`, `Limited`, `Moderate`, `Extensive`) |
| Risk Tolerance | FinancialAccount | `RiskTolerance` |
| Investment Objective | FinancialAccount | `InvestmentObjective` |
| Time Horizon | FinancialAccount | `TimeHorizon__c` |
| Suitability Last Assessed | Contact | `SuitabilityLastAssessedDate__c` |
| Suitability Approved By | Contact | `SuitabilityApprovedById__c` |

### Suitability Mismatch Rule

FSC does not enforce suitability natively. Implement via:
1. Validation rule on `FinancialAccount` that prevents `InvestmentObjective = 'Speculation'` when `Contact.RiskTolerance = 'Conservative'`.
2. RecordAlert trigger that fires when `FinancialHolding.AssetClass` distribution deviates from the mandate.
3. ActionPlanTemplate `Suitability_Review` created on a schedule or triggered by a life event.

---

## KYC Data Model in FSC

KYC (Know Your Customer) data is stored across Contact, Account, and custom objects.

### Core KYC Fields

| Field | Object | Notes |
|---|---|---|
| `TaxId__c` or `TaxIdentifier__c` | Contact | SSN/EIN — encrypt at rest; restrict FLS |
| `DateOfBirth` | Contact | Standard field |
| `MailingAddress` | Contact | Standard field — must match government ID |
| `CitizenshipStatus__c` | Contact | `USCitizen`, `PermanentResident`, `NonResident` |
| `IsPEP__c` | Contact | Politically Exposed Person flag — boolean |
| `IsWatchlistMatch__c` | Contact | AML watchlist match — boolean |
| `SourceOfWealth__c` | Contact | Narrative; required for high-net-worth onboarding |
| `LastKYCRefreshDate__c` | Contact | Date of last KYC document collection |
| `KYCStatus__c` | Contact | `Pending`, `InProgress`, `Approved`, `Expired` |
| `GovernmentIdType__c` | Contact | `Passport`, `DriversLicense`, `StateId` |
| `GovernmentIdNumber__c` | Contact | Encrypted; restrict FLS strictly |
| `GovernmentIdExpiry__c` | Contact | Flag expiry via RecordAlert |

### KYC Refresh Requirements

FINRA Rule 4512 requires updating customer account records for material changes. Trigger a KYC refresh (via `KYC_Onboarding` or `Suitability_Review` ActionPlanTemplate) when:
- 3 years have passed since last refresh (`LastKYCRefreshDate__c`)
- Client reports a major life event (marriage, divorce, retirement, death of spouse)
- Significant change in net worth or income
- AML or PEP screening returns a new flag

---

## Revenue and RevenueSchedule — Fee Tracking

### Revenue Object

`Revenue` (API name: `Revenue`) tracks advisory and transaction fees at the FinancialAccount level.

| Field API Name | Type | Description |
|---|---|---|
| `FinancialAccountId` | Lookup (FinancialAccount) | Account being billed |
| `RevenueType` | Picklist | `AdvisoryFee`, `TrailCommission`, `TransactionFee`, `ManagementFee`, `ReferralFee` |
| `Amount` | Currency | Annual or one-time fee amount |
| `FeePercentage` | Percent | For AUM-based fees (e.g., 1.00% of AUM annually) |
| `EffectiveDate` | Date | When this fee schedule began |
| `ExpirationDate` | Date | When this fee schedule ends |
| `Status` | Picklist | `Active`, `Inactive`, `Pending` |
| `FeeCalculationBasis` | Picklist | `AUMBased`, `FlatFee`, `Tiered`, `Negotiated` |
| `BillingFrequency` | Picklist | `Monthly`, `Quarterly`, `Annual` |

### RevenueSchedule Object

`RevenueSchedule` defines the recurring billing cadence and tracks individual billing events.

| Field API Name | Type | Description |
|---|---|---|
| `RevenueId` | Lookup (Revenue) | Parent Revenue record |
| `ScheduledDate` | Date | Date this billing is due |
| `ScheduledRevenueAmount` | Currency | Amount to bill in this period |
| `ActualRevenueAmount` | Currency | Actual amount billed/collected |
| `Frequency` | Picklist | `Monthly`, `Quarterly`, `Annual` |
| `Status` | Picklist | `Scheduled`, `Invoiced`, `Paid`, `Waived`, `Failed` |

### AUM-Based Fee Calculation Pattern

For a 1.00% annual advisory fee billed quarterly:

```apex
Decimal annualFeeRate = 0.0100; // 1.00% AUM fee
Decimal balance = financialAccount.Balance;
Decimal annualFee = balance * annualFeeRate;
Decimal quarterlyFee = annualFee / 4;

RevenueSchedule rs = new RevenueSchedule();
rs.RevenueId = revenueId;
rs.ScheduledDate = Date.today().toStartOfMonth().addMonths(3).toStartOfMonth();
rs.ScheduledRevenueAmount = quarterlyFee;
rs.Frequency = 'Quarterly';
rs.Status = 'Scheduled';
insert rs;
```

**Gotcha:** `Revenue.FeePercentage` stores the rate but does NOT auto-calculate the fee amount. You must write the billing calculation logic in Apex or a scheduled Flow that reads the current account balance, applies the rate, and creates `RevenueSchedule` records. FSC provides the data model; it does not provide a billing engine.

### Fee Disclosure (FINRA Requirement)

FINRA Rule 2010 requires written fee disclosure before account opening. Store the signed fee disclosure document:
- As a `ContentDocumentLink` linked to the `FinancialAccount`
- With `ContentVersion.Title` = "Fee Disclosure Agreement - [AccountNumber] - [Date]"
- Reference the `Revenue` record ID in a custom field `FeeDisclosureRevenueId__c` on the document for traceability.
