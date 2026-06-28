# FSC Wealth Management — Setup and Permissions

## License Requirements

FSC Wealth Management requires the **Financial Services Cloud** license. Confirm the FSC managed package is installed with `sf org display --target-org <alias>` and inspect installed packages via Tooling API or Setup > Installed Packages.

Key considerations:
- The FSC package installs the `IndustriesHousehold`, `IndustriesIndividual`, and `IndustriesBusiness` Account RecordTypes automatically.
- FSC Wealth objects (`FinancialAccount`, `FinancialHolding`, `FinancialGoal`, etc.) are FSC-specific — they are NOT available in a standard Salesforce org without the FSC license.
- Some orgs have FSC Insurance AND FSC Wealth — both use the same FSC package but different permission sets.

---

## Permission Sets

**Never grant FSC Wealth access via profiles.** Always stack permission sets via permission set groups.

| Permission Set | Who needs it | What it grants |
|---|---|---|
| `FSCFinancialServices` | All FSC Wealth users | Base FSC objects: FinancialAccount, FinancialHolding, FinancialGoal, FinancialPlan, AssetsAndLiabilities, RecordAlert |
| `FSCWealth` | Wealth-specific users (where separately licensed) | Additional wealth management features: FinancialAccountRole management, Revenue/RevenueSchedule |
| `FSCInsurance` | Insurance users only — NOT for wealth | InsurancePolicy, Claim — do not assign to wealth users unless dual-licensed |
| `ActionPlansforFSC` | Advisors running KYC / compliance workflows | ActionPlan, ActionPlanTemplate, ActionPlanItem access |
| `EinsteinAnalyticsForFSC` | Advisors and managers who use AUM/portfolio dashboards | CRM Analytics for FSC datasets |
| `OmniStudioUser` | Users accessing OmniScript-based onboarding (if OmniStudio used) | OmniStudio runtime |
| `OmniStudioAdmin` | Admins building OmniStudio components | OmniStudio metadata |

**Recommended permission set groups:**

| Group | Included sets | Persona |
|---|---|---|
| `WealthAdvisor` | `FSCFinancialServices` + `FSCWealth` + `ActionPlansforFSC` | Financial advisor / relationship manager |
| `WealthManager` | `WealthAdvisor` + `EinsteinAnalyticsForFSC` | Wealth manager / branch manager |
| `WealthAdmin` | `WealthManager` + `OmniStudioAdmin` | System administrator for wealth module |
| `WealthServiceUser` | `FSCFinancialServices` only | Read-only service staff |

---

## FSC Settings Configuration

Enable FSC features via Setup > Financial Services Cloud Settings:

| Setting | Value | Notes |
|---|---|---|
| Enable Household Rollup | `true` | Activates `TotalAum__c`, `NetWorth__c` rollup fields on Account |
| Enable Relationship Groups | `true` | Activates `RelationshipGroup` and `RelationshipGroupMember` objects |
| Enable Financial Accounts | `true` | Required for FinancialAccount, FinancialHolding objects |
| Enable Goals and Plans | `true` | Activates FinancialGoal, FinancialPlan objects |
| Enable Record Alerts | `true` | Activates RecordAlert on Household and FinancialAccount pages |
| Enable Action Plans | `true` | Required for ActionPlanTemplate and KYC workflows |
| Enable Revenue Tracking | `true` | Activates Revenue, RevenueSchedule for fee tracking |

Access FSC Settings at: Setup > Financial Services > Financial Services Settings.

---

## Household Record Type Configuration

### Activating RecordTypes on Account

1. Navigate to Setup > Object Manager > Account > Record Types.
2. Confirm `IndustriesHousehold`, `IndustriesIndividual`, and `IndustriesBusiness` are active.
3. Assign these RecordTypes to the relevant profiles or permission sets via Page Layout Assignment.
4. The `IndustriesHousehold` RecordType must be in the user's profile/permission set for the Household Account creation to work.

**Do not rename the developer names** (`IndustriesHousehold`, `IndustriesIndividual`). FSC managed code and SOQL queries reference these developer names explicitly.

### Person Accounts vs. Individual RecordType

| Model | Description | When to use |
|---|---|---|
| **Person Accounts** enabled | Individual clients are PersonAccounts (Account + Contact merged). Household is a separate Business Account with RecordType `IndustriesHousehold`. | Most FSC Wealth orgs — recommended by Salesforce for wealth implementations |
| **Person Accounts** disabled | Individual clients are Contacts. Household is an Account with RecordType `IndustriesHousehold`. Individual's "account" is `IndustriesIndividual`. | Simpler model; less flexible for account hierarchies |

Confirm which model the org uses before building household membership logic.

---

## Financial Account Type Custom Metadata

Financial account types are configured via the **`FinancialAccountType`** Custom Metadata Type (not a picklist). Each record defines:

| Field | Example values |
|---|---|
| `DeveloperName` | `Brokerage`, `TraditionalIRA`, `RothIRA`, `401k`, `529Plan`, `Checking`, `Savings`, `Trust`, `SEP_IRA`, `Annuity` |
| `Label` | Human-readable label shown on the page |
| `Category` | `Investment`, `Retirement`, `Banking`, `Insurance` |
| `IsRetirementAccount` | `true`/`false` — triggers beneficiary requirements |
| `IsTaxAdvantaged` | `true`/`false` — used for suitability and tax reporting |
| `CustodianRequired` | `true`/`false` — for custodian data integration |

To add a new account type, create a new `FinancialAccountType__mdt` record in Setup > Custom Metadata Types, or deploy via metadata API. Do not add it as a picklist value — FSC reads from the metadata type.

---

## Fee Schedule Setup (Revenue and RevenueSchedule)

Fee schedules are configured at the `FinancialAccount` level using `Revenue` and `RevenueSchedule` records.

### Revenue Record

Create one `Revenue` record per fee type per account:

| Field | Value |
|---|---|
| `FinancialAccountId` | The account being billed |
| `RevenueType` | `AdvisoryFee`, `TrailCommission`, `TransactionFee`, `ManagementFee` |
| `Amount` | Annual fee amount (or one-time fee amount) |
| `FeePercentage` | For AUM-based fees: percentage (e.g., `0.0125` for 1.25%) |
| `Status` | `Active`, `Inactive` |

### RevenueSchedule Record

Create a `RevenueSchedule` record to define recurring billing:

| Field | Value |
|---|---|
| `RevenueId` | Parent Revenue record |
| `ScheduledDate` | Next billing date |
| `ScheduledRevenueAmount` | Amount for this billing period |
| `Frequency` | `Monthly`, `Quarterly`, `Annual` |
| `Status` | `Scheduled`, `Invoiced`, `Paid` |

**Gotcha:** `RevenueSchedule` records are not automatically generated by the system. You must create them via Apex or a scheduled Flow. The FSC managed package does not include a fee billing engine — you build the billing logic against these objects.

---

## Advisor Hierarchy Configuration

FSC Wealth supports an advisor hierarchy for AUM and relationship reporting.

### Hierarchy Types

1. **User Hierarchy (standard)** — Uses `User.ManagerId` for up-hierarchy AUM aggregation.
2. **Territory-Based** — Uses Salesforce Territory Management; accounts assigned to territories, AUM rolled up by territory.
3. **Custom Hierarchy** — Some FSC orgs model branches, teams, and regions using custom objects linked to Users.

### Setting the Primary Advisor

- `FinancialAccount.OwnerId` — defaults to the creating user; should be explicitly set to the relationship manager.
- `Account.OwnerId` (Household Account) — the primary advisor for the household.
- `RelationshipGroup.PrimaryGroupMemberId` — the advisor responsible for the group.

For FINRA supervision compliance, the supervisor (`User.ManagerId`) must be traceable from every client account. Confirm the User hierarchy is maintained correctly and that orphaned accounts (no `OwnerId` or `OwnerId` = inactive user) are flagged via `RecordAlert`.

---

## Field-Level Security Checklist

Fields that require explicit FLS grants beyond the base permission set:

| Field | Object | Restrict to |
|---|---|---|
| `Balance` | `FinancialAccount` | Advisors and above (clients should see via portal, not full Salesforce access) |
| `FinancialAccountNumber` | `FinancialAccount` | Advisors + compliance; mask last 4 for service staff |
| `TaxIdNumber__c` (or `TaxIdentifier__c`) | `Contact` / custom | Compliance and operations only |
| `FeePercentage` | `Revenue` | Advisors + managers; not visible to service staff |
| `CostBasis` | `FinancialHolding` | Advisors + tax reporting staff |
| `UnrealizedGainLoss` | `FinancialHolding` | Advisors and clients (mask from service staff) |
| `RiskTolerance` | `FinancialAccount` | Advisors and compliance |

---

## Org Setup Validation

Run `scripts/check-wealth-config.sh` to validate:
- FSC license is active
- Required permission sets and groups are deployed
- `IndustriesHousehold`, `IndustriesIndividual` RecordTypes are active on Account
- FSC Wealth settings are enabled (household rollup, relationship groups, goals/plans)
- `FinancialAccountType__mdt` records exist for all expected account types
- AUM rollup mechanism (batch job or flow) is scheduled and running
- Advisor hierarchy (`User.ManagerId`) is populated for all active advisors
