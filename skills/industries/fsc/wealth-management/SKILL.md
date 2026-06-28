---
name: industries-fsc-wealth-management
description: >-
  FinancialAccount, FinancialAccountTransaction, FinancialAccountRole,
  FinancialHolding, AssetsAndLiabilities, FinancialGoal, FinancialPlan,
  Revenue, RevenueSchedule, RecordAlert, ActionPlanTemplate, FSC Wealth,
  AUM, household, relationship group, client household, portfolio,
  securities, bonds, mutual funds, fee schedule, financial advisor,
  relationship manager, financial account type, custodian, brokerage,
  retirement account, IRA, 401k, rollover, suitability, KYC, net worth
compliance:
  regulations: ["FINRA", "SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "restricted"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: industries/fsc
  module: wealth-management
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# FSC Wealth Management — Skill

You are helping with the **Wealth Management** module of **Salesforce Financial Services Cloud (FSC)**. FSC Wealth uses a combination of core FSC objects (`FinancialAccount`, `FinancialHolding`, `FinancialGoal`, `FinancialPlan`, and the household Account model), Flows, Apex, and optionally Agentforce for advisor copilot scenarios.

This file is your routing layer. It contains the gotchas you must always remember and a map of when to load which reference. **Do not answer detailed wealth questions from this file alone — load the right reference first.**

---

## Always true — read first

> These facts are commonly missed. Apply them before writing a single line of code or SOQL.

1. **`FinancialAccount` is NOT a standard Salesforce Account.** It is a distinct FSC object (API name `FinancialAccount`) representing a brokerage, retirement, or banking account. Its lookup to the owning person or household is `FinancialAccount.PrimaryOwnerId` (a polymorphic lookup to Account or Contact depending on org configuration). Never conflate it with the standard `Account` object.

2. **Household AUM is a rollup — it does not auto-total in real time.** `FinancialAccount.TotalValue__c` (or the standard `Balance` field) rolls up to the household `Account` via a custom or standard rollup field (`TotalAum__c` on Account in many implementations). This rollup is driven by a scheduled Apex job or a roll-up summary field — never assume `Account.TotalAum__c` is current unless a sync has run recently. Always confirm rollup cadence in the org before relying on it for reporting.

3. **`FinancialAccountRole` roles are a restricted picklist — not all values apply to all account types.** Valid roles include `Owner`, `JointOwner`, `Beneficiary`, `PowerOfAttorney`, `Trustee`, `Custodian`, and `Successor`. Retirement accounts (IRA, 401k) require a `Beneficiary` role; joint accounts require `JointOwner`. Inserting an unsupported role combination triggers a validation error unique to FSC — it is not a generic picklist error.

4. **`FinancialHolding` requires a parent `FinancialAccount` — it cannot exist standalone.** `FinancialHolding.FinancialAccountId` is a required master-detail field. The `FinancialHolding.HoldingType` picklist (`Security`, `MutualFund`, `Bond`, `CD`, `Annuity`, `AlternativeInvestment`, `Cash`) determines which child fields are relevant. A `Security` holding without `FinancialHolding.Ticker__c` or `SecurityId` is incomplete for performance calculations.

5. **The Household Account RecordType is `IndustriesHousehold` — NOT a custom record type you create.** FSC installs this RecordType automatically on the Account object. Its developer name is `IndustriesHousehold`. Individual clients are assigned RecordType `IndustriesIndividual`. Confusing the two breaks household rollup fields and the relationship group model. Never create a custom "Household" RecordType and expect FSC managed components to recognize it.

6. **`AccountContactRelation` — not a custom junction — links individuals to households.** Household membership is modeled via the standard `AccountContactRelation` object with `Roles` containing `'Household Member'`. The Contact's primary household is set via `Contact.AccountId` pointing to the Household Account. FSC relationship group membership is separate and uses `RelationshipGroup` + `RelationshipGroupMember` objects.

7. **`FinancialGoal` and `FinancialPlan` are separate objects with a many-to-one relationship.** A `FinancialPlan` (the overarching plan document) can have many `FinancialGoal` records linked via `FinancialGoal.FinancialPlanId`. Do not model goals as Tasks or Opportunities. The `FinancialGoal.GoalType` picklist includes `Retirement`, `Education`, `HomePurchase`, `EmergencyFund`, `MajorPurchase`, `DebtPayoff`, and `Wealth`. Each type has corresponding expected fields (`FinancialGoal.TargetAmount`, `FinancialGoal.TargetDate`, `FinancialGoal.ActualValue`).

8. **`RecordAlert` is FSC's compliance and risk flag object — not a standard notification.** `RecordAlert` (API name `RecordAlert`) records are surfaced to advisors via the FSC ActionPlanTemplate and Lightning pages. Key fields: `RecordAlert.Name`, `RecordAlert.Severity` (picklist: `High`, `Medium`, `Low`), `RecordAlert.Subject`, `RecordAlert.ParentId` (the Account, FinancialAccount, or Contact being alerted on), `RecordAlert.StatusCategory` (`New`, `Snoozed`, `Dismissed`). Do not substitute `Task` or `FeedItem` for compliance alerts.

9. **`AssetsAndLiabilities` is an FSC object for non-custodied wealth — it is NOT `FinancialAccount`.** `AssetsAndLiabilities` (API name `AssetsAndLiabilities`) captures external holdings like real estate (`Type = 'RealEstate'`), vehicles (`Type = 'PersonalProperty'`), business interests, mortgages, and credit card debt. It rolls into net worth calculations alongside `FinancialAccount.Balance`. Confusing it with `FinancialAccount` is a frequent modeling mistake.

10. **`Revenue` and `RevenueSchedule` track advisory fees — they are FSC-specific, not standard Salesforce Revenue.** `Revenue` (API name `Revenue`) records link to a `FinancialAccount` and capture advisory fees, trail commissions, and transaction fees. `RevenueSchedule` records define recurring fee cadences. These are distinct from the Salesforce Revenue Cloud objects (`ProductCatalog`, `PriceBook`). Fee schedule logic must flow through `Revenue` + `RevenueSchedule`, not Opportunity line items.

11. **`FinancialAccountTransaction` records are high-volume — never query without a date filter.** A single brokerage `FinancialAccount` can have hundreds of thousands of `FinancialAccountTransaction` rows. Always filter by `FinancialAccountTransaction.TransactionDate` in SOQL. Missing this filter in a trigger or batch causes heap or SOQL row limit exceptions. Index on `FinancialAccountId` + `TransactionDate` is the standard compound index to exploit.

12. **`ActionPlanTemplate` drives advisor onboarding and compliance workflows — not ad-hoc Tasks.** FSC Wealth uses `ActionPlanTemplate` to codify suitability reviews, KYC refresh cycles, and annual planning checklists. An `ActionPlan` record is created from the template and linked to the relevant Account or FinancialAccount. The individual steps become `ActionPlanItem` records, which each create a `Task`. Never build these as manual task lists — use the template to ensure auditability for FINRA compliance.

---

## When to load a reference

Load a reference file on demand when the user's task falls in that area. Do not load all references at once.

| If the user asks about… | Load |
|---|---|
| Object model overview, AUM rollup, FinancialAccount vs AssetsAndLiabilities, household architecture, relationship group | `references/01-architecture.md` |
| Permission sets, FSC settings, record types, household configuration, financial account type metadata, fee schedule setup, advisor hierarchy | `references/02-setup-and-permissions.md` |
| Household onboarding, AccountContactRelation, household membership, relationship groups, AUM rollup across household, household rollup fields | `references/03-household-and-relationships.md` |
| FinancialAccount types, FinancialHolding, FinancialAccountTransaction, custodian integration, account performance, fee application, rebalancing | `references/04-financial-accounts-and-holdings.md` |
| FinancialGoal, FinancialPlan, ActionPlanTemplate, RecordAlert, suitability, KYC, Revenue, RevenueSchedule, FINRA compliance patterns | `references/05-goals-plans-and-compliance.md` |

---

## Standard workflows

### Workflow 1: Onboarding a new household and client

1. **Create the Household Account.** Use RecordType `IndustriesHousehold`. Populate `Account.Name` as household name (e.g., "Smith Family Household"), `Account.Phone`, and `Account.BillingAddress`. Do not assign `Account.OwnerId` to a queue — assign directly to the relationship manager (User). Load `references/03-household-and-relationships.md`.
2. **Create or match the individual Contact(s).** Each household member is a Contact. The primary member's `Contact.AccountId` points to the Household Account. Use the `IndustriesIndividual` Account RecordType for the corresponding person Account if the org uses person accounts.
3. **Create `AccountContactRelation` records.** Link each Contact to the Household Account with `Roles` containing `'Household Member'`. Set `AccountContactRelation.IsActive = true`. The first member's contact is typically also the primary contact on the Household Account.
4. **Run KYC / suitability data capture.** Use an `ActionPlanTemplate` for KYC onboarding to create a structured `ActionPlan` with required task steps (identity verification, risk tolerance assessment, source of wealth). Load `references/05-goals-plans-and-compliance.md`.
5. **Create a `RelationshipGroup` and add members.** If the household spans multiple accounts or the advisor manages multiple related households, create a `RelationshipGroup` record linked to the household Account. Add `RelationshipGroupMember` records for each participant. Load `references/03-household-and-relationships.md`.
6. **Verify AUM rollup fields.** After `FinancialAccount` records are created (Workflow 2), confirm that household `Account.TotalAum__c` (or the org-specific rollup field) reflects the sum of all member `FinancialAccount.Balance` values. Load `references/01-architecture.md` for rollup pattern.
7. **Create initial `RecordAlert` if compliance flags exist** (e.g., PEP status, restricted securities holding). Load `references/05-goals-plans-and-compliance.md`.

### Workflow 2: Opening a new financial account

1. **Determine account type.** Confirm the `FinancialAccount.FinancialAccountType` from the `FinancialAccountType` custom metadata record — common values: `Brokerage`, `TraditionalIRA`, `RothIRA`, `401k`, `529Plan`, `Checking`, `Savings`, `Trust`. The type determines required roles, custodian routing, and fee schedule. Load `references/04-financial-accounts-and-holdings.md`.
2. **Create the `FinancialAccount` record.** Required fields: `FinancialAccount.Name`, `FinancialAccount.FinancialAccountType`, `FinancialAccount.PrimaryOwnerId` (pointing to the household Account or the individual), `FinancialAccount.Status` (set to `'Active'`), `FinancialAccount.CustodianId` (if applicable). Set `FinancialAccount.HeldAwayIndicator` to `true` for externally custodied accounts.
3. **Create `FinancialAccountRole` records.** At minimum, create an `Owner` role. For joint accounts, add `JointOwner`. For retirement accounts, add at least one `Beneficiary`. For trust accounts, add `Trustee`. Each role links a Contact to the account via `FinancialAccountRole.RelatedContactId`. Load `references/03-household-and-relationships.md`.
4. **Create initial `FinancialHolding` records.** For each position in the account, create a `FinancialHolding` row with `HoldingType`, `Quantity`, `CurrentPrice`, `MarketValue`, and `SecurityId` (if applicable). For cash, use `HoldingType = 'Cash'`. Load `references/04-financial-accounts-and-holdings.md`.
5. **Assign fee schedule.** Create a `Revenue` record linking the `FinancialAccount` to the applicable advisory fee. If recurring, create a `RevenueSchedule`. Load `references/05-goals-plans-and-compliance.md`.
6. **Trigger AUM rollup refresh.** Either invoke the batch job or refresh via the rollup mechanism. Verify `Account.TotalAum__c` reflects the new account balance.
7. **Create a suitability `RecordAlert` if the account's investment mandate mismatches the client's risk profile.** Load `references/05-goals-plans-and-compliance.md`.

### Workflow 3: Generating a financial plan / goals review

1. **Create or retrieve the `FinancialPlan` record.** One plan per household is the standard model. `FinancialPlan.AccountId` points to the Household Account. Populate `FinancialPlan.PlanStatus` (`Draft`, `Proposed`, `Accepted`, `Archived`), `FinancialPlan.PlanDate`, and `FinancialPlan.AdvisorId`. Load `references/05-goals-plans-and-compliance.md`.
2. **Create `FinancialGoal` records for each objective.** Each goal links to the `FinancialPlan` via `FinancialGoal.FinancialPlanId`. Set `FinancialGoal.GoalType`, `FinancialGoal.TargetAmount`, `FinancialGoal.TargetDate`, and `FinancialGoal.ActualValue` (current funded amount). Compute `FinancialGoal.Progress` as `ActualValue / TargetAmount * 100`.
3. **Link `FinancialAccount` records to relevant goals.** Use the `FinancialAccountGoal` junction object (if enabled in the org) or a custom lookup to associate accounts to goals for funding tracking.
4. **Run an `ActionPlanTemplate` for the annual review.** The template generates `ActionPlanItem` tasks: update risk tolerance, review beneficiaries, review asset allocation, check suitability, review fee schedules. Load `references/05-goals-plans-and-compliance.md`.
5. **Check `RecordAlert` records on the household and its accounts.** Dismiss or action any `High` severity alerts before the plan is accepted. Document dismissal reasons for FINRA audit trail.
6. **Update `FinancialPlan.PlanStatus` to `'Proposed'`** after review, then `'Accepted'` once the client signs off. Capture `FinancialPlan.AcceptedDate`.
7. **Update `FinancialGoal.ActualValue`** after any account rebalancing. If `Progress < 70%` and `TargetDate` is within 2 years, create a `RecordAlert` with `Severity = 'High'` to flag to the advisor.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/describe-wealth-objects.sh` | Describe all key FSC Wealth objects and write schemas to `wealth-describe/` |
| `scripts/query-household.sh` | Given a household Account ID, print household members, accounts, holdings, goals, and alerts |
| `scripts/check-wealth-config.sh` | Validate FSC Wealth setup: permission sets, record types, household rollup fields, fee schedule metadata |
| `scripts/seed-test-household.sh` | Create a minimal test household with one client, one brokerage account, one holding, and one goal |

---

## NOT covered by this skill

This skill covers FSC Wealth Management only. Do not use it for:

- **FSC Insurance Claims** (`Claim`, `ClaimParticipant`, `ClaimReserve`, `ClaimPayment`, FNOL, adjudication) — use `industries-fsc-claims-process`.
- **FSC Insurance Policy Administration** (`InsurancePolicy`, `InsurancePolicyCoverage`, `InsurancePolicyParticipant`) — use `industries-fsc-policy-administration`.
- **FSC Mortgage Origination** (`MortgageApplication`, `ResidentialLoanApplication`, `LoanApplicant`) — use `industries-fsc-mortgage-origination`.
- **Health Cloud** (`CarePlan`, `ClinicalEncounterCode`, `CareProgram`) — entirely separate product.
- **Revenue Cloud / CPQ** (`SBQQ__`, `ProductCatalog`, `PriceBook`, `QuoteLineItem`) — unrelated to advisory fee modeling.

If the user crosses into any of these areas, say so and stop rather than improvising an answer.
