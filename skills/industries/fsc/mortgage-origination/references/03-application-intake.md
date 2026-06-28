# FSC Mortgage Origination — Application Intake (URLA / 1003)

## The URLA / 1003 and Salesforce FSC

The Uniform Residential Loan Application (URLA), also known as Fannie Mae Form 1003, is the standardized mortgage application form required by Fannie Mae, Freddie Mac, FHA, VA, and most lenders. The revised URLA (effective March 2021) reorganized sections and added new demographic data collection requirements. FSC Mortgage's object model maps directly to these sections.

This reference covers how each URLA section maps to FSC objects and fields, and how to implement the intake workflow correctly.

---

## URLA Section → FSC Object Mapping

| URLA Section | Section Title | FSC Object(s) |
|---|---|---|
| Section 1a | Borrower Information | `LoanApplicant` (name, DOB, SSN, citizenship, marital status, contact info) |
| Section 1b | Current Employment / Self-Employment / Income | `LoanApplicantEmployment` + `LoanApplicantIncome` |
| Section 1c | Additional Employment / Other Income | Additional `LoanApplicantEmployment` + `LoanApplicantIncome` rows |
| Section 2a | Account Information for the Borrower | `LoanApplicantAsset` (bank accounts, investment accounts) |
| Section 2b | Other Assets and Credits | `LoanApplicantAsset` (gift funds, net equity, bridge loan proceeds) |
| Section 2c | Liabilities | `LoanApplicantLiability` |
| Section 2d | Other Liabilities and Expenses | Additional `LoanApplicantLiability` rows (alimony, child support) |
| Section 3a | Loan and Property Information | `ResidentialLoanApplication` (loan amount, purpose, type) + `LoanApplicationProperty` |
| Section 3b | Additional Questions About the Property | `LoanApplicationProperty` (mixed use, manufactured home, solar panels, etc.) |
| Section 3c | About This Loan | `LoanApplicationFinancial` |
| Section 3d | Rental Income on Property | `LoanApplicantIncome` where `IncomeType = 'RentalIncome'` |
| Section 4a | Borrower Declarations | `LoanApplicant` (declaration fields — bankruptcy, foreclosure, lawsuit, etc.) |
| Section 4b | Borrower Acknowledgements and Agreements | `LoanApplicant.ApplicationSignedDate` + document capture |
| Section 5 | Demographic Information (Borrower) | `LoanApplicant` (Race, Ethnicity, Sex — HMDA fields) |
| Section 6 | Loan Originator Information | `ResidentialLoanApplication.OwnerId` + User.NMLSId__c |
| Section 7 | Co-Borrower Information | Second `LoanApplicant` (RoleOnLoan = 'CoBorrower') + all Section 1–5 equivalents |

---

## LoanApplicant — Required Fields at Intake

The following fields must be populated before the application can be marked complete and advance to Processing:

| Field | Requirement | Notes |
|---|---|---|
| `ContactId` | Required | Must reference an existing Contact; create Contact first |
| `RoleOnLoan` | Required | `'Borrower'` or `'CoBorrower'` — exactly one Borrower per application |
| `FirstName` / `LastName` | Required | Denormalized from Contact; keep in sync |
| `DateOfBirth` | Required | Used for HMDA age calculation and identity verification |
| `CitizenshipStatus` | Required | Affects loan eligibility (VA loans require Veteran status) |
| `MaritalStatus` | Required per URLA | `'Married'`, `'Separated'`, `'Unmarried'` |
| `CreditScore` | Required before Underwriting | Populated via credit pull integration |
| `ApplicationSignedDate` | Required before Closing | Date borrower signed the 1003 |

**URLA Declaration fields** (Section 4a) — add custom fields on `LoanApplicant` or a related `LoanApplicantDeclaration__c` object:
- `BankruptcyIndicator` (Boolean) — bankruptcy in past 7 years
- `ForeclosureIndicator` (Boolean) — foreclosure or deed-in-lieu in past 7 years
- `LawsuitIndicator` (Boolean) — party to a lawsuit
- `ConveyedTitleIndicator` (Boolean) — conveyed property in lieu of foreclosure
- `FederalDebtIndicator` (Boolean) — delinquent federal debt
- `AlimonyObligationIndicator` (Boolean) — obligation to pay alimony, child support, or separate maintenance

---

## Co-Borrower Handling

Co-borrowers are modeled as a second `LoanApplicant` record on the same `ResidentialLoanApplication`, with `RoleOnLoan = 'CoBorrower'`. All income, asset, liability, employment, and address records for the co-borrower are children of the co-borrower's `LoanApplicant` record — not of the hub object.

**Data model for co-borrower:**

```
ResidentialLoanApplication
  ├── LoanApplicant (RoleOnLoan = 'Borrower', ContactId = Contact A)
  │     ├── LoanApplicantIncome (IncomeType = 'Base', MonthlyAmount = 5000)
  │     ├── LoanApplicantAsset (AssetType = 'Checking', CashOrMarketValue = 15000)
  │     ├── LoanApplicantLiability (LiabilityType = 'Revolving', MonthlyPaymentAmount = 200)
  │     ├── LoanApplicantAddress (AddressType = 'Current')
  │     └── LoanApplicantEmployment (EmploymentStatus = 'CurrentEmployer')
  │
  └── LoanApplicant (RoleOnLoan = 'CoBorrower', ContactId = Contact B)
        ├── LoanApplicantIncome (IncomeType = 'Base', MonthlyAmount = 3500)
        ├── LoanApplicantAsset (AssetType = 'Savings', CashOrMarketValue = 8000)
        ├── LoanApplicantLiability (LiabilityType = 'Installment', MonthlyPaymentAmount = 350)
        ├── LoanApplicantAddress (AddressType = 'Current')
        └── LoanApplicantEmployment (EmploymentStatus = 'CurrentEmployer')
```

**DTI with co-borrower:** Sum `MonthlyAmount` across ALL `LoanApplicantIncome` records for ALL `LoanApplicant` records on the application (both borrower and co-borrower) to get combined gross monthly income. Sum all `MonthlyPaymentAmount` across all `LoanApplicantLiability` records where `ExcludeFromLiabilities = false` for both applicants. This is the combined qualifying income and combined monthly debt.

---

## LoanApplicantIncome — Income Types and Underwriting Treatment

| IncomeType | History Required | Notes |
|---|---|---|
| `'Base'` | Current employment | W-2 income; most straightforward |
| `'Bonus'` | 2-year average required | Cannot use if received less than 2 years; average of 2 prior years' W-2 bonus lines |
| `'Commission'` | 2-year average required | Same as bonus; 25%+ commission earners typically treated as self-employed |
| `'OvertimeIncome'` | 2-year average required | Only countable if employer confirms likely to continue |
| `'SocialSecurity'` | Award letter | Can gross up 25% for non-taxable SS income under conventional guidelines |
| `'Pension'` | Award letter or 1099-R | Verify for continuance (lifetime pension vs. term) |
| `'ChildSupport'` | 3-year continuance required | Must have 3 years remaining; requires divorce decree or court order |
| `'Alimony'` | 3-year continuance required | Same as child support |
| `'RentalIncome'` | Schedule E or lease | For subject property rental: use 75% of gross rent (vacancy factor); for other rental properties: use Schedule E net income |
| `'OtherIncome'` | Varies | Document source; confirm non-recurring vs. recurring |

---

## LoanApplicantAsset — Asset Types and Down Payment Sourcing

| AssetType | Seasoning Requirement | Notes |
|---|---|---|
| `'Checking'` | 60-day bank statement | Standard liquid asset |
| `'Savings'` | 60-day bank statement | Standard liquid asset |
| `'Retirement'` | 60-day statement | 60% of vested balance is usable (conventional) — deduct 40% for early withdrawal penalty/taxes |
| `'Stock'` | 60-day statement | 70% of stock value for down payment (to account for market fluctuation) |
| `'GiftFunds'` | Gift letter required | Donor must not expect repayment; gift letter with relationship documentation required; FHA allows 100% gift; conventional requires borrower funds for primary |
| `'NetEquityOnSoldProperty'` | HUD-1 or settlement statement | Proceeds from current home sale; require evidence of sale |
| `'ProceedsFromSaleOfRealEstate'` | Settlement statement | Evidenced sale of other real estate |
| `'TrustFunds'` | Trust document | Copy of trust agreement required |
| `'BridgeLoanProceeds'` | Bridge loan agreement | Temporary financing; payoff must be factored into DTI |

**UseForDownPayment flag:** Set `LoanApplicantAsset.UseForDownPayment = true` on assets that will fund the down payment. The sum of `CashOrMarketValue` where `UseForDownPayment = true` should equal or exceed `LoanApplicationFinancial.DownPaymentAmount`. Build a validation rule to alert the processor if down payment asset coverage is insufficient.

---

## LoanApplicantLiability — Liability Types and Exclusions

| LiabilityType | DTI Treatment | Notes |
|---|---|---|
| `'Mortgage'` | Include | Existing mortgage(s) on other properties; departing residence mortgage may be excluded if listing agreement exists |
| `'HomeEquityLoan'` | Include | HELOC in draw period = full limit; repayment period = actual payment |
| `'Installment'` | Include; omit if <10 months remain | Auto loans, student loans, personal loans; if 10 or fewer months remain, may be omitted |
| `'Revolving'` | Use minimum payment or 1-5% of balance | Credit cards; use statement minimum payment; some guidelines use 5% of balance if no statement |
| `'LeasePayment'` | Include | Auto or equipment leases |
| `'ChildSupport'` | Include | Court-ordered; required amount from decree |
| `'Alimony'` | Include | Court-ordered; deducted from income (some guidelines) vs. added to liabilities |
| `'OtherLiability'` | Case by case | Document and confirm with underwriter |

**Student loan treatment (Fannie Mae):** Even if deferred, use 1% of the outstanding balance as the monthly payment if no payment is required. Populate in `MonthlyPaymentAmount` — do not leave at zero.

---

## DTI Calculation Pattern

DTI has two ratios:

**Front-end ratio (Housing ratio):**
```
Front-End DTI = ProposedMonthlyPayment / TotalGrossMonthlyIncome
```
- `ProposedMonthlyPayment` = `LoanApplicationFinancial.ProposedMonthlyPayment` (full PITIA)
- `TotalGrossMonthlyIncome` = SUM of `LoanApplicantIncome.MonthlyAmount` where `IncludeInQualifyingIncome = true` across all applicants

**Back-end ratio (Total debt ratio):**
```
Back-End DTI = (ProposedMonthlyPayment + TotalMonthlyLiabilities) / TotalGrossMonthlyIncome
```
- `TotalMonthlyLiabilities` = SUM of `LoanApplicantLiability.MonthlyPaymentAmount` where `ExcludeFromLiabilities = false` across all applicants

Implement DTI as formula fields or a Flow/Apex computation that fires when any child income or liability record changes. Store calculated DTI in custom fields `FrontEndDTI__c` and `BackEndDTI__c` on `ResidentialLoanApplication`. Standard conventional limits: 28% front-end, 36-45% back-end (higher with DU/LP approval and compensating factors).

---

## LTV Calculation Pattern

```
LTV = LoanAmount / MIN(PurchasePrice, AppraisedValue)
```

- `LoanAmount` from `ResidentialLoanApplication.LoanAmount`
- `PurchasePrice` from `LoanApplicationProperty.PurchasePrice` (for purchase transactions)
- `AppraisedValue` from `LoanApplicationProperty.AppraisedValue` (populated post-appraisal)

Until the appraisal is complete, use `PurchasePrice` as the denominator. Store calculated LTV in a custom field `LTV__c` on `ResidentialLoanApplication`. Trigger recalculation whenever `LoanAmount` or `LoanApplicationProperty.AppraisedValue` changes. PMI threshold: conventional loans with LTV > 80% require PMI. FHA requires MIP at all LTVs.

---

## Credit Pull Integration Pattern

Credit pulls are performed via a callout to a credit bureau or tri-merge provider (e.g., Credco, CBC Innovis, Factual Data). Standard pattern:

1. Loan Officer or Processor clicks "Pull Credit" on the `LoanApplicant` record.
2. An LWC button or OmniScript action triggers an Apex callout (or Integration Procedure) using the `CreditBureau_<Provider>_Prod` Named Credential.
3. Request payload: borrower `FirstName`, `LastName`, `DateOfBirth`, SSN (retrieved from a Salesforce Shield Platform Encryption field or an external vault), `LoanApplicantAddress.Street/City/StateCode/PostalCode`.
4. Response: FICO scores from each bureau, tradeline details, public records.
5. Update `LoanApplicant.CreditScore` with the middle score (if tri-merge: sort three scores, take middle). Populate `CreditPullDate = TODAY()`.
6. Store the full credit report as a `ContentDocument` linked to `LoanApplicant` via `ContentDocumentLink`.
7. If `CreditScore < 620` (conventional minimum), create a `RecordAlert` on `LoanApplicant` flagging ineligibility.

**Hard pull vs. soft pull:** Initial application inquiry is a hard pull. Rate shopping within 45 days (FICO scoring window) counts as one inquiry. Do not pull credit more than once without explicit borrower consent.

---

## LoanApplicationProperty — Key Intake Fields

At application intake, capture at minimum:
- `PropertyType` — determines eligible loan products and appraisal type
- `PropertyUsage` — primary, second home, or investment; drives pricing adjustments
- `PurchasePrice` — required for purchase transactions; sets initial LTV
- `Street`, `City`, `StateCode`, `PostalCode` — required for HMDA census tract lookup
- `CountyName` — required for HMDA; also determines applicable recording fees and taxes
- `NumberOfUnits` — 2-4 unit properties have different qualifying guidelines (rental income offset)
- `FloodZoneIndicator` — if in a FEMA Special Flood Hazard Area (SFHA), flood insurance is required; integrate with FEMA flood zone determination service

Do NOT populate `AppraisedValue` at intake — it is blank until the appraisal is received. Any pre-populated appraisal value will be overwritten and may cause LTV calculation errors if not handled with a recalculation trigger.
