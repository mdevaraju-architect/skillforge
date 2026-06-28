---
name: industries-fsc-mortgage-origination
description: >-
  MortgageApplication, ResidentialLoanApplication, LoanApplicant,
  LoanApplicantAddress, LoanApplicantAsset, LoanApplicantEmployment,
  LoanApplicantIncome, LoanApplicantLiability, LoanApplicationProperty,
  LoanApplicationFinancial, FSC Mortgage, mortgage origination, URLA,
  1003 application, underwriting, appraisal, title, closing, HMDA,
  RESPA, TRID, loan officer, loan processor, underwriter, LOS integration,
  Encompass, Point, Byte, credit pull, DTI, LTV, FICO, rate lock,
  conditional approval, clear to close, MISMO
compliance:
  regulations: ["HMDA", "RESPA", "SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "restricted"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: industries/fsc
  module: mortgage-origination
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# FSC Mortgage Origination — Skill

You are helping with the **Mortgage Origination** module of **Salesforce Financial Services Cloud (FSC)**. FSC Mortgage uses `ResidentialLoanApplication` as the hub object, with a constellation of child objects that map directly to URLA/1003 sections, plus Flows, Apex, OmniStudio, and Named Credential integrations to external Loan Origination Systems (LOS) such as Encompass, Point, and Byte.

This file is your routing layer. It contains the gotchas you must always remember and a map of when to load which reference. **Do not answer detailed mortgage questions from this file alone — load the right reference first.**

---

## Always true — read first

> These facts are commonly missed. Apply them before writing a single line of code or SOQL.

1. **`ResidentialLoanApplication` is the hub object — not `MortgageApplication`.** The primary FSC Mortgage hub object API name is `ResidentialLoanApplication`. The term `MortgageApplication` appears in UI labels but the underlying object is `ResidentialLoanApplication`. All child objects (`LoanApplicant`, `LoanApplicationProperty`, `LoanApplicationFinancial`, etc.) have a master-detail or lookup back to `ResidentialLoanApplication`. Creating any child record before the parent `ResidentialLoanApplication` exists will fail.

2. **`LoanApplicant` ≠ `LoanApplicationProperty` — they model completely different things.** `LoanApplicant` represents a borrower or co-borrower (a person). `LoanApplicationProperty` represents the collateral property being financed. Agents frequently confuse these. A single `ResidentialLoanApplication` can have multiple `LoanApplicant` records (primary borrower + co-borrower) and one `LoanApplicationProperty`. Do not put property data on `LoanApplicant` or borrower data on `LoanApplicationProperty`.

3. **The `LoanApplicant.RoleOnLoan` picklist controls co-borrower handling.** Valid values are `'Borrower'` and `'CoBorrower'`. There must be exactly one `LoanApplicant` with `RoleOnLoan = 'Borrower'` per application. Inserting a second `Borrower` role record triggers a duplicate-role validation. Co-borrower income and assets are tracked via their own `LoanApplicantIncome`, `LoanApplicantAsset`, `LoanApplicantLiability`, `LoanApplicantEmployment`, and `LoanApplicantAddress` child records linked to their `LoanApplicant` row — not to the hub object.

4. **`LoanApplicantAddress` has an `AddressType` picklist — all required address types must be present.** The standard URLA Section 1a requires current address and mailing address. `AddressType` picklist values include `'Current'`, `'Mailing'`, `'Prior'`, and `'ForwardingAddress'`. An address of type `'Current'` is required on the primary `LoanApplicant` before the application can advance to Processing. Missing this fails URLA completeness validation.

5. **DTI is not a stored field on `ResidentialLoanApplication` — it is calculated.** There is no `DTI__c` or `DebtToIncomeRatio` standard field on `ResidentialLoanApplication` in the FSC managed schema. DTI is derived by summing `LoanApplicantIncome.MonthlyAmount` across all `IncomeType` values and dividing total monthly liabilities (from `LoanApplicantLiability.MonthlyPaymentAmount`) plus the proposed PITIA (from `LoanApplicationFinancial.ProposedMonthlyPayment`) by gross monthly income. Implement DTI as a formula field or calculate in a Flow/Apex triggered from child record changes.

6. **HMDA fields live on `ResidentialLoanApplication` but many are not auto-populated.** HMDA LAR-required fields such as `ApplicationDate`, `LoanPurpose`, `LoanType`, `PropertyType`, `OccupancyType`, `LoanAmount`, `ActionTaken`, `ActionTakenDate`, `DenialReason`, `RaceEthnicity` (via `LoanApplicant` demographic fields), `Sex`, and `AgeAtApplicationDate` must be explicitly captured. They are not derived from other fields. Missing any HMDA field at time of application disposition triggers a HMDA violation. Load `references/05-compliance-and-closing.md` before any HMDA work.

7. **LTV is not stored — it is calculated from `LoanApplicationProperty` appraisal or purchase price.** Loan-to-Value is `ResidentialLoanApplication.LoanAmount` divided by the lesser of `LoanApplicationProperty.PurchasePrice` or `LoanApplicationProperty.AppraisedValue`. Both fields are on `LoanApplicationProperty`. Appraisal value is populated after the appraisal stage; until then, LTV is estimated using `PurchasePrice`. Never hard-code LTV as a stored number without a re-calculation trigger when the appraisal value updates.

8. **Rate lock expiration is tracked via `ResidentialLoanApplication.RateLockExpirationDate` — there is no separate Rate Lock object in standard FSC.** The fields `RateLockDate` (when the rate was locked) and `RateLockExpirationDate` (expiry) are standard fields on `ResidentialLoanApplication`. If the org requires rate lock history (multiple locks, extensions), implement a custom child object `RateLockHistory__c` — this is not provided out-of-box. Alert when `RateLockExpirationDate` is within 5 business days using a scheduled Flow.

9. **LOS integration (Encompass, Point, Byte) is not bidirectional by default — design for conflict resolution.** FSC Mortgage does not have a native real-time sync connector to any LOS. The standard integration pattern is: (a) push `ResidentialLoanApplication` data to LOS via an outbound Platform Event or REST callout using a Named Credential, and (b) receive LOS status updates via an inbound REST endpoint (a connected Salesforce Site or Experience Cloud endpoint) or via a scheduled polling Integration Procedure. Because both systems can update the same loan record simultaneously, build a `LastModifiedInLOS__c` timestamp field and a conflict-resolution Flow that wins-by-latest or wins-by-LOS for status fields.

10. **`LoanApplicationFinancial` holds proposed payment and purchase transaction amounts — it is NOT the same as `LoanApplicantAsset`.** `LoanApplicationFinancial` captures the financial terms of the transaction: `LoanAmount`, `PurchasePrice`, `DownPaymentAmount`, `DownPaymentSource`, `ProposedMonthlyPayment`, `ClosingCostsAmount`. `LoanApplicantAsset` captures borrower-owned assets used to verify reserves and down payment sources. Confusing these two objects is a common modeling error that breaks both underwriting validation and TRID disclosures.

11. **TRID requires a Loan Estimate within 3 business days of application — Salesforce does not enforce this automatically.** TRID (TILA-RESPA Integrated Disclosure) mandates that a Loan Estimate (LE) be issued within 3 business days of a complete application (`ResidentialLoanApplication.Status = 'Application'`). FSC does not have a built-in TRID clock. Implement a Record-Triggered Flow on `ResidentialLoanApplication` that fires when `Status` changes to `'Application'`, calculates 3 business days using a custom business-day function, sets a `LEDueDate__c` field, and creates a follow-up task for the loan officer. Failing to track this creates regulatory exposure.

12. **`LoanApplicantEmployment.EmploymentStatus` drives which income verification documents are required.** Values include `'CurrentEmployer'`, `'PreviousEmployer'`, `'SelfEmployed'`, and `'Retired'`. Self-employed borrowers require 2 years of tax returns (captured via document links); salaried employees require W-2 and pay stubs. Build a document checklist driven by `EmploymentStatus` — do not use a single static document list for all borrower types. The checklist is typically implemented as an `ActionPlanTemplate` or a custom `DocumentChecklist__c` object.

13. **`ResidentialLoanApplication.Status` lifecycle is not automatically enforced — validation rules and Flows must guard transitions.** The standard status picklist values are `'Application'`, `'Processing'`, `'Underwriting'`, `'Approved'`, `'ConditionalApproval'`, `'ClearToClose'`, `'Closing'`, `'Closed'`, `'Denied'`, and `'Withdrawn'`. There are no platform-enforced transition guards. Without explicit validation rules, a record can jump from `'Application'` directly to `'Closed'`, bypassing underwriting. Implement an `InvalidStatusTransition` validation rule using a matrix approach or a before-update Flow to guard all transitions.

14. **`LoanApplicantIncome.IncomeType` picklist includes `'Base'`, `'Bonus'`, `'Commission'`, `'OvertimeIncome'`, `'OtherIncome'`, `'SocialSecurity'`, `'Pension'`, `'ChildSupport'`, `'Alimony'`, and `'RentalIncome'` — each has different underwriting treatment.** Not all income types are eligible for qualifying income under GSE (Fannie/Freddie) guidelines. For example, `'Bonus'` and `'Commission'` typically require a 2-year history. `'ChildSupport'` and `'Alimony'` require 3 years continuance. Build underwriting eligibility rules per `IncomeType` — do not treat all income as equivalent in DTI calculations.

---

## When to load a reference

Load a reference file on demand when the user's task falls in that area. Do not load all references at once.

| If the user asks about… | Load |
|---|---|
| Object model overview, ResidentialLoanApplication hub, status lifecycle, child object relationships, data flow | `references/01-architecture.md` |
| Permission sets, required features, org setup, loan officer/processor roles, pipeline views, LOS Named Credential, HMDA config | `references/02-setup-and-permissions.md` |
| URLA/1003 section mapping, LoanApplicant fields, income types, asset types, liability types, co-borrower, credit pull, DTI, LTV | `references/03-application-intake.md` |
| Underwriting, conditions management, conditional approval, appraisal, title, rate lock, milestones, LOS integration patterns | `references/04-underwriting-and-conditions.md` |
| HMDA LAR fields, TRID (LE/CD timing), RESPA Section 8, closing disclosure, post-close retention, e-sign, MISMO XML export | `references/05-compliance-and-closing.md` |

When the user's question spans multiple areas, load multiple references — but only the ones needed.

---

## Standard workflows

### Workflow 1: New mortgage application intake (1003/URLA)

1. **Identify the borrower.** Look up or create a `Contact` (or PersonAccount) record for the primary borrower. FSC Mortgage links `LoanApplicant.ContactId` to the borrower's `Contact` record. Do not create a standalone `LoanApplicant` without a linked `Contact` — it will break relationship-group visibility and credit pull integrations.
2. **Create the `ResidentialLoanApplication` hub record.** Required fields at creation: `ApplicationDate`, `LoanPurpose` (picklist: `'Purchase'`, `'Refinance'`, `'ConstructionToPermanent'`, `'HomeEquity'`, `'Other'`), `LoanType` (picklist: `'Conventional'`, `'FHA'`, `'VA'`, `'USDA'`, `'Other'`), `LoanAmount`, `Status = 'Application'`. Assign `OwnerId` to the originating loan officer. Load `references/03-application-intake.md`.
3. **Create the primary `LoanApplicant` record.** Link to `ResidentialLoanApplicationId` and `ContactId`. Set `RoleOnLoan = 'Borrower'`. Capture SSN reference (if stored securely), date of birth, citizenship status, and marital status per URLA Section 4.
4. **If co-borrower: create a second `LoanApplicant`** with `RoleOnLoan = 'CoBorrower'` linked to a separate `Contact`. All co-borrower income, assets, liabilities, and addresses are entered as child records of the co-borrower `LoanApplicant`, not the primary.
5. **Create `LoanApplicantAddress` records.** At minimum: `AddressType = 'Current'` for both borrower and co-borrower (if applicable). If at current address less than 2 years, add `AddressType = 'Prior'`.
6. **Create `LoanApplicantEmployment` records.** One per employer. If employed less than 2 years at current job, create prior employment records. Set `EmploymentStatus`, `EmployerName`, `StartDate`, `EndDate` (if prior), `GrossMonthlyIncome`.
7. **Create `LoanApplicantIncome` records.** One row per income type per applicant. Set `IncomeType`, `MonthlyAmount`. Sum these for gross monthly income used in DTI.
8. **Create `LoanApplicantAsset` records.** Set `AssetType` (`'Checking'`, `'Savings'`, `'Retirement'`, `'Stock'`, `'GiftFunds'`, `'RealEstate'`, `'Other'`), `CashOrMarketValue`, `DepositoryName`.
9. **Create `LoanApplicantLiability` records.** Set `LiabilityType` (`'Mortgage'`, `'Installment'`, `'Revolving'`, `'LeasePayment'`, `'ChildSupport'`, `'Alimony'`, `'Other'`), `MonthlyPaymentAmount`, `UnpaidBalance`, `ExcludeFromLiabilities` (boolean for debts being paid off at closing).
10. **Create `LoanApplicationProperty` record.** Set `PropertyType`, `PropertyUsage`, `PurchasePrice`, `StreetAddress`, `City`, `StateCode`, `PostalCode`. Load `references/03-application-intake.md`.
11. **Create `LoanApplicationFinancial` record.** Set `LoanAmount`, `PurchasePrice`, `DownPaymentAmount`, `DownPaymentSource`, `ProposedMonthlyPayment`.
12. **Trigger credit pull.** Integration Procedure calls credit bureau via Named Credential, populates `LoanApplicant.CreditScore` (or custom `FICO__c` field). Set `LoanApplicant.CreditPullDate`. Load `references/04-underwriting-and-conditions.md`.
13. **Advance `Status` to `'Processing'`** once all required 1003 sections are complete. This triggers the TRID Loan Estimate issuance clock. Load `references/05-compliance-and-closing.md`.

### Workflow 2: Underwriting and conditions management

1. **Advance `Status` to `'Underwriting'`** once the file is complete and the processor has verified the initial document package.
2. **Underwriter reviews DTI, LTV, credit, and reserves.** DTI = total monthly liabilities / gross monthly income. LTV = `LoanAmount` / lesser of `PurchasePrice` or `AppraisedValue`. These are calculated, not stored — verify source field population. Load `references/04-underwriting-and-conditions.md`.
3. **Order the appraisal.** Create an `AssessmentTask` (or custom `Appraisal__c` record per org convention) linked to `LoanApplicationProperty`. Set `AppraisalOrderDate`, `AppraisalCompletedDate`, `AppraisedValue`. Update `LoanApplicationProperty.AppraisedValue` when received. Recalculate LTV.
4. **Order title.** Record title order date and title company via custom fields (`TitleOrderDate__c`, `TitleCompany__c`) on `ResidentialLoanApplication` or a related `Title__c` child object.
5. **Issue Conditional Approval.** Set `Status = 'ConditionalApproval'`. Create conditions as custom `LoanCondition__c` records (standard FSC does not provide a conditions object — implement per org). Each condition has `ConditionType`, `Description`, `AssignedTo`, `DueDate`, `Status` (`'Open'`, `'Satisfied'`, `'Waived'`).
6. **Clear conditions.** As each condition is satisfied, update `LoanCondition__c.Status = 'Satisfied'` and attach supporting documents via `ContentDocumentLink`. When all conditions are satisfied, advance to `Status = 'ClearToClose'`.
7. **Set rate lock.** Populate `ResidentialLoanApplication.RateLockDate`, `RateLockExpirationDate`, `InterestRate`, `LockPeriodDays`. Alert if expiration is within 5 business days.
8. **Schedule closing.** Set `ClosingDate` on `ResidentialLoanApplication`. Trigger Closing Disclosure (CD) issuance at least 3 business days before closing per TRID. Load `references/05-compliance-and-closing.md`.

### Workflow 3: Closing and post-close

1. **Issue Closing Disclosure.** Must be delivered at least 3 business days before `ClosingDate`. Set `CDIssuedDate__c` on `ResidentialLoanApplication`. Enforce that `ClosingDate` is not within 3 business days of `CDIssuedDate__c`. Load `references/05-compliance-and-closing.md`.
2. **Advance `Status = 'Closing'`** on the day of closing.
3. **Capture final loan terms.** Update `LoanAmount`, `InterestRate`, `LoanTerm`, `MonthlyPayment` with final closing figures — these may differ from initial estimates.
4. **Execute e-sign for closing docs.** Use an e-signature integration (DocuSign or Salesforce native signing) via `ContentDocumentLink` on `ResidentialLoanApplication`. Load `references/05-compliance-and-closing.md` for the document package pattern.
5. **Record funding.** Set `FundingDate__c` on `ResidentialLoanApplication`. This is the date the loan proceeds are disbursed.
6. **Advance `Status = 'Closed'`** after funding and note recording confirmation.
7. **HMDA disposition.** Update `ActionTaken` (picklist: `'LoanOriginated'`, `'ApplicationApproved'`, `'ApplicationDenied'`, `'ApplicationWithdrawn'`, `'ClosedForIncompleteness'`, `'LoanPurchased'`, `'PreapprovalDenied'`, `'PreapprovalApproved'`) and `ActionTakenDate`. Verify all HMDA LAR fields are populated before the annual reporting deadline. Load `references/05-compliance-and-closing.md`.
8. **Export MISMO XML for LOS handoff or investor delivery.** Trigger MISMO 3.4 export via an Apex class or Integration Procedure that serializes `ResidentialLoanApplication` + all child objects to the standard MISMO XML schema. Load `references/05-compliance-and-closing.md`.
9. **Post-close data retention.** Apply retention policy: loan documents must be retained per applicable state and federal requirements (generally 7 years for closed loans, 25 months for denied applications under ECOA). Tag `ContentDocument` records with `RetentionCategory__c` for archival flows.

---

## NOT covered by this skill

This skill covers FSC Mortgage Origination only. Do not use it for:

- **FSC Insurance Claims** (`Claim`, `ClaimParticipant`, `ClaimReserve`, `ClaimPayment`, FNOL, adjudication) — use `industries-fsc-claims-process`.
- **FSC Insurance Policy Administration** (`InsurancePolicy`, `InsurancePolicyCoverage`, `InsurancePolicyParticipant`) — use `industries-fsc-policy-administration`.
- **FSC Wealth Management** (`FinancialAccount`, `FinancialHolding`, `FinancialGoal`, AUM rollup, advisor households) — use `industries-fsc-wealth-management`.
- **Health Cloud** (`CarePlan`, `ClinicalEncounterCode`, `CareProgram`, care plans) — entirely separate product.
- **Revenue Cloud / CPQ** (`SBQQ__`, `ProductCatalog`, `PriceBook`, `QuoteLineItem`) — unrelated to mortgage origination.
- **Mortgage Servicing** (payment processing, escrow management, loss mitigation after loan closes) — post-origination servicing is out of scope and typically handled by a separate servicing system.

If the user asks about any of these areas, say so explicitly and stop rather than improvising an answer.
