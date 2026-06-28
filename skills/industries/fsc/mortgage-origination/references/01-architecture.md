# FSC Mortgage Origination — Architecture

Salesforce Financial Services Cloud Mortgage Origination is built on a hub-and-spoke object model centered on `ResidentialLoanApplication`, with child objects that map to discrete sections of the Uniform Residential Loan Application (URLA/Fannie Mae Form 1003). The platform layer includes Flows for lifecycle automation, Apex for complex validation and calculation, OmniStudio for intake and processing UIs, and Named Credential–based integrations to external Loan Origination Systems (LOS).

---

## Module Boundary

FSC Mortgage Origination owns the end-to-end process from loan inquiry through funded close. Adjacent modules it interacts with but does not own:

| Adjacent module | Interaction point |
|---|---|
| Salesforce Contact / Account | `LoanApplicant.ContactId` references the borrower's `Contact` record |
| FSC Wealth Management | Borrowers who are also wealth clients; household relationship context |
| Salesforce Files | Loan documents via `ContentDocumentLink` on `ResidentialLoanApplication` and child objects |
| External LOS (Encompass, Point, Byte) | Bi-directional data sync via Named Credentials, Platform Events, or REST APIs |
| Credit Bureaus (Experian, Equifax, TransUnion) | Credit pull callout updating `LoanApplicant.CreditScore` and tri-merge fields |
| E-signature platforms (DocuSign, Salesforce eSign) | Closing document execution |
| MISMO / GSE systems (Fannie Mae, Freddie Mac) | MISMO 3.4 XML export for loan delivery and investor reporting |
| HMDA LAR submission | Annual regulatory filing from `ResidentialLoanApplication` disposition fields |

---

## Core Object Map

```
ResidentialLoanApplication  ←── hub object
  │
  ├── LoanApplicant  (one per borrower / co-borrower)
  │     ├── LoanApplicantAddress        (current, prior, mailing)
  │     ├── LoanApplicantEmployment     (current and prior employers)
  │     ├── LoanApplicantIncome         (one row per income type)
  │     ├── LoanApplicantAsset          (checking, savings, retirement, etc.)
  │     └── LoanApplicantLiability      (mortgage, installment, revolving, etc.)
  │
  ├── LoanApplicationProperty           (subject property / collateral)
  │
  └── LoanApplicationFinancial          (transaction amounts, down payment, proposed payment)
```

All child objects have a required lookup or master-detail to `ResidentialLoanApplication`. The `LoanApplicant` sub-children (`LoanApplicantAddress`, `LoanApplicantEmployment`, etc.) are children of `LoanApplicant`, not direct children of the hub object.

---

## Object Definitions and Key Fields

### ResidentialLoanApplication (hub)

The central record for a single mortgage loan application. One record per application; one application may cover one borrower or a borrower + co-borrower pair.

| Field API Name | Type | Notes |
|---|---|---|
| `Name` | Auto-number | System-generated loan application number |
| `ApplicationDate` | Date | Date application was received; required for HMDA |
| `LoanPurpose` | Picklist | `'Purchase'`, `'Refinance'`, `'ConstructionToPermanent'`, `'HomeEquity'`, `'Other'` |
| `LoanType` | Picklist | `'Conventional'`, `'FHA'`, `'VA'`, `'USDA'`, `'Other'` |
| `LoanAmount` | Currency | Requested loan amount; required |
| `LoanTerm` | Number | Term in months (e.g., 360 for 30-year) |
| `InterestRate` | Percent | Note rate at closing |
| `AmortizationType` | Picklist | `'Fixed'`, `'AdjustableRate'`, `'Other'` |
| `Status` | Picklist | See lifecycle below |
| `RateLockDate` | Date | Date rate was locked |
| `RateLockExpirationDate` | Date | Rate lock expiry; alert within 5 business days |
| `LockPeriodDays` | Number | Lock period in days (e.g., 30, 45, 60) |
| `ClosingDate` | Date | Scheduled or actual closing date |
| `FundingDate` | Date | Date loan proceeds were disbursed |
| `ActionTaken` | Picklist | HMDA disposition (see compliance reference) |
| `ActionTakenDate` | Date | Date of HMDA disposition |
| `DenialReason1` | Picklist | HMDA denial reason codes 1–4 |
| `DenialReason2` | Picklist | Second denial reason (if applicable) |
| `DenialReason3` | Picklist | Third denial reason (if applicable) |
| `DenialReason4` | Picklist | Fourth denial reason (if applicable) |
| `PropertyType` | Picklist | HMDA property type: `'SingleFamilyResidence'`, `'Condominium'`, `'ManufacturedHome'`, `'MultiFamilyResidence'`, `'Other'` |
| `OccupancyType` | Picklist | `'PrimaryResidence'`, `'SecondHome'`, `'InvestmentProperty'` |
| `ChannelType` | Picklist | `'Retail'`, `'Wholesale'`, `'Correspondent'`, `'ConsumerDirect'` |
| `OwnerId` | Lookup(User) | Originating loan officer |
| `LoanOfficerAssistantId` | Lookup(User) | Loan officer assistant (if applicable) |
| `ProcessorId` | Lookup(User) | Assigned processor |
| `UnderwriterId` | Lookup(User) | Assigned underwriter |

### LoanApplicant

Represents a single borrower or co-borrower. Each `ResidentialLoanApplication` has at minimum one `LoanApplicant` (the primary borrower). Co-borrowers are additional `LoanApplicant` records on the same application.

| Field API Name | Type | Notes |
|---|---|---|
| `ResidentialLoanApplicationId` | Master-Detail | Parent application |
| `ContactId` | Lookup(Contact) | Required — links to borrower's Contact record |
| `RoleOnLoan` | Picklist | `'Borrower'` or `'CoBorrower'`; exactly one `Borrower` per application |
| `FirstName` | Text | Denormalized from Contact; kept in sync |
| `LastName` | Text | Denormalized from Contact |
| `DateOfBirth` | Date | HMDA age calculation source |
| `MaritalStatus` | Picklist | `'Married'`, `'Separated'`, `'Unmarried'` (per URLA) |
| `CitizenshipStatus` | Picklist | `'USCitizen'`, `'PermanentResidentAlien'`, `'NonPermanentResidentAlien'` |
| `CreditScore` | Number | Tri-merge middle score; populated by credit pull |
| `CreditPullDate` | Date | Date of most recent credit pull |
| `Race` | Picklist | HMDA demographic field |
| `Ethnicity` | Picklist | HMDA demographic field (e.g., `'HispanicOrLatino'`, `'NotHispanicOrLatino'`) |
| `Sex` | Picklist | HMDA demographic field |
| `ApplicationSignedDate` | Date | Date applicant signed the 1003 |
| `DependentCount` | Number | Number of dependents |
| `DependentAges` | Text | Ages of dependents (URLA Section 1b) |

### LoanApplicantAddress

One record per address type per `LoanApplicant`.

| Field API Name | Type | Notes |
|---|---|---|
| `LoanApplicantId` | Master-Detail | Parent `LoanApplicant` |
| `AddressType` | Picklist | `'Current'`, `'Mailing'`, `'Prior'`, `'ForwardingAddress'` |
| `Street` | Text | Street address |
| `City` | Text | City |
| `StateCode` | Picklist | 2-letter state code |
| `PostalCode` | Text | ZIP code |
| `Country` | Text | Country (default `'US'`) |
| `ResidencyType` | Picklist | `'Own'`, `'Rent'`, `'LivingRentFree'` |
| `MonthlyRentAmount` | Currency | If `ResidencyType = 'Rent'` |
| `MoveInDate` | Date | Start of residence at this address |
| `MoveOutDate` | Date | End of residence (for `AddressType = 'Prior'`) |
| `YearsAtAddress` | Number | Calculated or entered |

### LoanApplicantEmployment

One record per employer per `LoanApplicant`. Employment history spanning less than 2 years requires prior employer records.

| Field API Name | Type | Notes |
|---|---|---|
| `LoanApplicantId` | Master-Detail | Parent `LoanApplicant` |
| `EmploymentStatus` | Picklist | `'CurrentEmployer'`, `'PreviousEmployer'`, `'SelfEmployed'`, `'Retired'` |
| `EmployerName` | Text | Employer name |
| `EmployerPhone` | Phone | Employer contact number |
| `PositionTitle` | Text | Job title |
| `StartDate` | Date | Employment start date |
| `EndDate` | Date | Employment end date (null for current) |
| `GrossMonthlyIncome` | Currency | Base gross monthly income at this employer |
| `YearsInProfession` | Number | Total years in this profession/field |
| `SelfEmployedIndicator` | Boolean | True if self-employed (drives document requirements) |
| `OwnershipShare` | Percent | Ownership percentage if self-employed (≥25% triggers SE treatment) |
| `BusinessName` | Text | Business name if self-employed |
| `BusinessPhone` | Phone | Business phone if self-employed |

### LoanApplicantIncome

One record per income type per `LoanApplicant`. Multiple income types for one applicant = multiple rows.

| Field API Name | Type | Notes |
|---|---|---|
| `LoanApplicantId` | Master-Detail | Parent `LoanApplicant` |
| `IncomeType` | Picklist | `'Base'`, `'Bonus'`, `'Commission'`, `'OvertimeIncome'`, `'OtherIncome'`, `'SocialSecurity'`, `'Pension'`, `'ChildSupport'`, `'Alimony'`, `'RentalIncome'` |
| `MonthlyAmount` | Currency | Monthly income amount for this type |
| `AnnualAmount` | Currency | Annual equivalent (formula: `MonthlyAmount * 12`) |
| `IncludeInQualifyingIncome` | Boolean | Whether to include in DTI numerator; toggled by underwriter |

### LoanApplicantAsset

One record per asset account per `LoanApplicant`.

| Field API Name | Type | Notes |
|---|---|---|
| `LoanApplicantId` | Master-Detail | Parent `LoanApplicant` |
| `AssetType` | Picklist | `'Checking'`, `'Savings'`, `'Retirement'`, `'Stock'`, `'GiftFunds'`, `'NetEquityOnSoldProperty'`, `'ProceedsFromSaleOfRealEstate'`, `'TrustFunds'`, `'BridgeLoanProceeds'`, `'Other'` |
| `CashOrMarketValue` | Currency | Current value |
| `DepositoryName` | Text | Institution name (bank, brokerage, etc.) |
| `AccountNumber` | Text | Last 4 digits (mask full number) |
| `UseForDownPayment` | Boolean | Whether this asset funds the down payment |

### LoanApplicantLiability

One record per debt per `LoanApplicant`.

| Field API Name | Type | Notes |
|---|---|---|
| `LoanApplicantId` | Master-Detail | Parent `LoanApplicant` |
| `LiabilityType` | Picklist | `'Mortgage'`, `'HomeEquityLoan'`, `'Installment'`, `'Revolving'`, `'LeasePayment'`, `'ChildSupport'`, `'Alimony'`, `'OtherLiability'` |
| `AccountNumber` | Text | Account identifier |
| `HolderName` | Text | Creditor name |
| `UnpaidBalance` | Currency | Current outstanding balance |
| `MonthlyPaymentAmount` | Currency | Monthly payment; used in DTI back-ratio calculation |
| `ExcludeFromLiabilities` | Boolean | Mark true if debt is being paid off at closing; removes from DTI |
| `MortgageType` | Picklist | For `LiabilityType = 'Mortgage'`: `'Conventional'`, `'FHA'`, `'VA'`, `'USDA'` |

### LoanApplicationProperty

One record per application. Represents the subject property — the collateral.

| Field API Name | Type | Notes |
|---|---|---|
| `ResidentialLoanApplicationId` | Master-Detail | Parent application |
| `PropertyType` | Picklist | `'SingleFamilyResidence'`, `'Condominium'`, `'CoOperative'`, `'TwoToFourUnitProperty'`, `'ManufacturedHome'`, `'MultiFamilyResidence'`, `'CommercialNonResidential'`, `'Other'` |
| `PropertyUsage` | Picklist | `'PrimaryResidence'`, `'SecondHome'`, `'InvestmentProperty'` |
| `Street` | Text | Property street address |
| `City` | Text | Property city |
| `StateCode` | Picklist | 2-letter state code (determines applicable state laws) |
| `PostalCode` | Text | ZIP code |
| `CountyName` | Text | County (required for HMDA census tract lookup) |
| `CensusTracts` | Text | HMDA census tract — required on LAR |
| `PurchasePrice` | Currency | Contract purchase price |
| `AppraisedValue` | Currency | Appraised value (populated after appraisal) |
| `AppraisalDate` | Date | Date appraisal was completed |
| `AppraisalCompanyName` | Text | Appraiser or AMC name |
| `NumberOfUnits` | Number | Number of units in multi-unit properties |
| `ConstructionMethod` | Picklist | `'SiteBuilt'`, `'ManufacturedHome'` |
| `AttachmentType` | Picklist | `'Attached'`, `'Detached'`, `'SemiDetached'` (for condo/townhome) |
| `LotSizeSquareFeet` | Number | Lot size |
| `YearBuilt` | Number | Year property was constructed |
| `FloodZoneIndicator` | Boolean | True if in FEMA flood zone (drives flood insurance requirement) |

### LoanApplicationFinancial

One record per application. Captures the financial terms of the purchase or refinance transaction.

| Field API Name | Type | Notes |
|---|---|---|
| `ResidentialLoanApplicationId` | Master-Detail | Parent application |
| `LoanAmount` | Currency | Mirror of hub `LoanAmount`; kept in sync |
| `PurchasePrice` | Currency | Contract purchase price for purchases |
| `AppraiedValue` | Currency | Mirror of `LoanApplicationProperty.AppraisedValue` |
| `DownPaymentAmount` | Currency | Borrower down payment amount |
| `DownPaymentSource` | Picklist | `'CheckingOrSavings'`, `'DepositOnSalesContract'`, `'GiftFunds'`, `'NetEquityFromSoldProperty'`, `'TrustFunds'`, `'BridgeLoan'`, `'Other'` |
| `ClosingCostsAmount` | Currency | Estimated total closing costs |
| `PrepaidItemsAmount` | Currency | Prepaids (insurance, taxes, per diem interest) |
| `ProposedMonthlyPayment` | Currency | Proposed PITIA (principal, interest, taxes, insurance, association dues) |
| `ProposedPrincipalAndInterest` | Currency | P&I portion of proposed payment |
| `ProposedMonthlyPropertyTax` | Currency | Monthly tax escrow component |
| `ProposedMonthlyInsurance` | Currency | Monthly hazard insurance escrow |
| `ProposedMonthlyMI` | Currency | Monthly mortgage insurance premium (PMI/MIP) |
| `ProposedMonthlyHOA` | Currency | Monthly HOA or condo association dues |

---

## Status Lifecycle

```
Application
    │
    ▼
Processing
    │
    ▼
Underwriting ──► ConditionalApproval ──► ClearToClose
                                               │
                                               ▼
                                            Closing ──► Closed
                                                          ▲
Underwriting ──────────────────────────────────► Denied
Application / Processing / Underwriting ───────► Withdrawn
```

Key automation events on status transitions:

| Transition | Automation trigger |
|---|---|
| `Application` creation | TRID LE issuance clock starts (3 business days); Loan Officer assigned task |
| `→ Processing` | Document checklist generated; processor assigned |
| `→ Underwriting` | Underwriter assigned; DU/LP submission queued |
| `→ ConditionalApproval` | Conditions list created; borrower notification sent |
| `→ ClearToClose` | CD issuance clock starts (3 business days); closing scheduled |
| `→ Closing` | Final document package assembled; e-sign envelope sent |
| `→ Closed` | HMDA `ActionTaken = 'LoanOriginated'`; retention tags applied |
| `→ Denied` | HMDA `ActionTaken = 'ApplicationDenied'`; adverse action notice sent |
| `→ Withdrawn` | HMDA `ActionTaken = 'ApplicationWithdrawn'`; retention clock started |

---

## Technology Stack

```
Borrower / Loan Officer / Processor / Underwriter
    │
    ▼
OmniStudio FlexCards (loan pipeline views, application summary panels)
    │
OmniStudio OmniScripts (1003/URLA intake wizard, conditions update, closing checklist)
    │
OmniStudio Integration Procedures + DataMappers
    │              │
    │         External systems:
    │         - LOS (Encompass, Point, Byte) via Named Credentials
    │         - Credit Bureaus (tri-merge pull)
    │         - AUS (Fannie Mae Desktop Underwriter, Freddie Mac Loan Product Advisor)
    │         - Appraisal Management Companies (AMCs)
    │         - Title and Flood vendors
    │         - E-signature platforms
    │         - MISMO / GSE delivery endpoints
    │
Salesforce Platform
    ├── FSC Mortgage objects (ResidentialLoanApplication + children)
    ├── Flows (status transitions, TRID clock, condition management, notifications)
    ├── Apex (DTI/LTV calculation, validation, MISMO XML serialization)
    └── Salesforce Files (ContentDocument for loan documents)
```
