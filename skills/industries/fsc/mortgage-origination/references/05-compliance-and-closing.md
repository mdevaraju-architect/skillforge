# FSC Mortgage Origination — Compliance and Closing

## Regulatory Overview

Mortgage origination in the United States is heavily regulated. The three primary federal regulations that FSC Mortgage implementations must address are:

| Regulation | Full Name | Key Requirement |
|---|---|---|
| **HMDA** | Home Mortgage Disclosure Act | Annual LAR reporting of loan application data including demographic information |
| **TRID** | TILA-RESPA Integrated Disclosure | Timing rules for Loan Estimate (LE) and Closing Disclosure (CD) delivery |
| **RESPA** | Real Estate Settlement Procedures Act | Prohibits kickbacks and referral fees; Section 8 specifically |

Additional regulations depending on loan type: ECOA (adverse action notice), Fair Housing Act (non-discrimination), CRA (Community Reinvestment Act, for covered institutions), VA and FHA specific regulations for government-insured loans.

---

## HMDA — Data Capture Requirements

### What HMDA Requires

HMDA-covered institutions must file an annual Loan/Application Register (LAR) with the CFPB (or appropriate federal regulator) for every covered mortgage application received during the calendar year, regardless of outcome.

### HMDA Data Points and FSC Field Mapping

The FFIEC publishes the HMDA Filing Instructions Guide (FIG) annually. Below are the key HMDA data points and their FSC source fields:

| HMDA Data Point | FSC Object | FSC Field | Notes |
|---|---|---|---|
| Universal Loan Identifier (ULI) | `ResidentialLoanApplication` | `ULI__c` (custom) | LEI + Loan Number + Check Digit; must be unique and ≤45 chars |
| Application Date | `ResidentialLoanApplication` | `ApplicationDate` | Date of completed application; not inquiry date |
| Loan Type | `ResidentialLoanApplication` | `LoanType` | Conventional, FHA, VA, USDA |
| Loan Purpose | `ResidentialLoanApplication` | `LoanPurpose` | Purchase, Refinance, Cash-Out Refinance, Home Improvement, Other |
| Preapproval | `ResidentialLoanApplication` | `PreapprovalIndicator__c` (custom) | Preapproval requested: Yes/No |
| Construction Method | `LoanApplicationProperty` | `ConstructionMethod` | Site-built or Manufactured |
| Occupancy Type | `ResidentialLoanApplication` | `OccupancyType` | Principal Residence, Second Home, Investment |
| Loan Amount | `ResidentialLoanApplication` | `LoanAmount` | Rounded to nearest $1,000 thousand for LAR |
| Action Taken | `ResidentialLoanApplication` | `ActionTaken` | See picklist values below |
| Action Taken Date | `ResidentialLoanApplication` | `ActionTakenDate` | |
| Street Address (property) | `LoanApplicationProperty` | `Street` | |
| City (property) | `LoanApplicationProperty` | `City` | |
| State (property) | `LoanApplicationProperty` | `StateCode` | |
| ZIP Code (property) | `LoanApplicationProperty` | `PostalCode` | |
| County (property) | `LoanApplicationProperty` | `CountyName` | FIPS county code required for LAR |
| Census Tract | `LoanApplicationProperty` | `CensusTracts` | Must be populated via geocoder; not manual entry |
| Applicant Race | `LoanApplicant` | `Race` | Per URLA Section 5; may have up to 5 race values |
| Applicant Ethnicity | `LoanApplicant` | `Ethnicity` | `HispanicOrLatino`, `NotHispanicOrLatino`, `InformationNotProvided`, `NotApplicable` |
| Applicant Sex | `LoanApplicant` | `Sex` | `Male`, `Female`, `NotProvided`, `NotApplicable` |
| Applicant Age at Application | `LoanApplicant` | Calculated from `DateOfBirth` and `ApplicationDate` | Must be age in years at application date |
| Co-Applicant Race/Ethnicity/Sex/Age | Second `LoanApplicant` | Same fields on co-borrower record | If no co-borrower: report as `'NotApplicable'` |
| Income | Calculated | SUM of `LoanApplicantIncome.MonthlyAmount` × 12 | Annual qualifying income, rounded to nearest $1,000 |
| Rate Spread | `ResidentialLoanApplication` | `RateSpread__c` (custom) | Spread above APOR; required if rate spread ≥ 1.5% for first lien |
| HOEPA Status | `ResidentialLoanApplication` | `HOEPAStatus__c` (custom) | Whether loan is a high-cost mortgage under HOEPA |
| Lien Status | `ResidentialLoanApplication` | `LienStatus__c` (custom) | `'FirstLien'`, `'SecondLien'` |
| Credit Score | `LoanApplicant` | `CreditScore` | Scored model identifier also required (e.g., `'Equifax Beacon 5.0'`) |
| Credit Score Model | `LoanApplicant` | `CreditScoreModel__c` (custom) | Identifies the scoring model used |
| Denial Reason(s) | `ResidentialLoanApplication` | `DenialReason1` through `DenialReason4` | Required when `ActionTaken = 'ApplicationDenied'` |
| Total Loan Costs | `LoanApplicationFinancial` | Sourced from final CD | Reported as total lender/originator charges |
| Total Points and Fees | Calculated | Computed per QM thresholds | Required for HMDA data point; complex calculation |
| AUS Result | `ResidentialLoanApplication` | `UnderwritingRecommendation__c` | DU or LP recommendation |
| Automated Underwriting System | `ResidentialLoanApplication` | `AUSType__c` (custom) | `'FannieMaeDU'`, `'FreddieMacLPA'`, `'Other'`, `'NotApplicable'` |
| Property Value | `LoanApplicationProperty` | `AppraisedValue` (or `PurchasePrice` if no appraisal) | Reported as property value at time of application |
| Combined LTV | Calculated | Computed at closing | Total LTV including all liens |
| Open-End Line of Credit | `ResidentialLoanApplication` | `OpenEndLineOfCreditIndicator__c` (custom) | For HELOCs |
| Business or Commercial Purpose | `ResidentialLoanApplication` | `BusinessPurposeIndicator__c` (custom) | True if primarily for business use |
| Balloon Payment | `ResidentialLoanApplication` | `BalloonPaymentIndicator__c` (custom) | |
| Interest-Only Payment | `ResidentialLoanApplication` | `InterestOnlyIndicator__c` (custom) | |
| Negative Amortization | `ResidentialLoanApplication` | `NegativeAmortizationIndicator__c` (custom) | |
| Manufactured Home Land Property Interest | `LoanApplicationProperty` | Custom | Required for manufactured homes |

### ActionTaken Picklist Values (HMDA)

| Value | Meaning |
|---|---|
| `'LoanOriginated'` | Loan was funded |
| `'ApplicationApprovedButNotAccepted'` | Lender approved; applicant withdrew |
| `'ApplicationDenied'` | Lender denied |
| `'ApplicationWithdrawn'` | Applicant withdrew before decision |
| `'FileClosedForIncompleteness'` | Application withdrawn due to incomplete information |
| `'LoanPurchased'` | Loan was purchased (secondary market) |
| `'PreapprovalDenied'` | Preapproval request denied |
| `'PreapprovalApprovedButNotAccepted'` | Preapproval granted; applicant did not proceed |

---

## TRID — Timing Requirements

TRID (TILA-RESPA Integrated Disclosure) mandates specific timing for two key disclosure documents: the Loan Estimate (LE) and the Closing Disclosure (CD).

### Loan Estimate (LE)

- **Trigger:** Complete application received (six pieces of information constitute a complete application: borrower name, SSN, income, property address, estimated property value, loan amount).
- **Deadline:** LE must be **delivered or mailed within 3 business days** of application receipt.
- **Salesforce implementation:**
  - `ApplicationDate` on `ResidentialLoanApplication` is the trigger date.
  - A Record-Triggered Flow on `ResidentialLoanApplication` creation populates `LEDueDate__c` = `ApplicationDate` + 3 business days.
  - Business day calculation must exclude Sundays and federal holidays (implement as a custom Holiday metadata table or Apex utility).
  - Create a Task assigned to the Loan Officer due on `LEDueDate__c`.
  - Set `LEIssuedDate__c` when the LE is sent. Build a validation rule: if `Status` is being changed to `'Processing'` and `LEIssuedDate__c` is null, block transition with error `'Loan Estimate has not been issued. TRID violation risk.'`

### Closing Disclosure (CD)

- **Trigger:** `ResidentialLoanApplication.Status` transitions to `'ClearToClose'` or closing date is set.
- **Deadline:** CD must be **received by the borrower at least 3 business days before consummation** (closing/signing date).
- **Salesforce implementation:**
  - `CDIssuedDate__c` — date CD was issued.
  - `CDRequiredByDate__c` — formula: `ClosingDate - 3 business days`.
  - Validation rule: `CDIssuedDate__c > CDRequiredByDate__c` → error: `'Closing Disclosure must be issued at least 3 business days before closing. Closing must be rescheduled.'`
  - If any CD term changes after issuance (APR increases by more than 0.125%, loan product changes, prepayment penalty added), a revised CD must be issued and the 3-business-day waiting period restarts. Implement `CDRevisedDate__c` and `NewClosingDateAfterRevision__c`.

### TRID Tolerance Categories

TRID distinguishes between fees that can change (zero tolerance, 10% tolerance, no tolerance). Implement tolerance tracking as a comparison between LE fees and CD fees. While full LE/CD tolerance calculation is typically handled in the LOS, FSC Mortgage should track `LEIssuedDate__c`, `CDIssuedDate__c`, `CDRevisedDate__c`, and flag discrepancies.

---

## RESPA Section 8 — Anti-Kickback Compliance

RESPA Section 8 prohibits giving or receiving anything of value in exchange for referrals of settlement service business. This applies to relationships with appraisers, title companies, attorneys, and insurance providers.

Implementation considerations in Salesforce FSC:
- Do not create automated referral incentive tracking tied to `LoanApplicationProperty.TitleCompany__c` or `LoanApplicationProperty.AppraisalCompanyName` fields that could be construed as a referral fee arrangement.
- If the lender has Affiliated Business Arrangements (ABAs), capture `ABADisclosureDate__c` on `ResidentialLoanApplication` and attach the signed disclosure via `ContentDocumentLink`.
- Build a validation rule that requires `ABADisclosureDate__c` to be populated before `ClosingDate` if the title company or appraiser is an affiliated entity (flag via a custom `IsAffiliated__c` boolean on the vendor record).

---

## Closing Disclosure Data Model

The Closing Disclosure consolidates all final loan terms and settlement charges. In FSC Mortgage, track CD fields on `ResidentialLoanApplication` and `LoanApplicationFinancial`:

| CD Section | Data | Where stored in FSC |
|---|---|---|
| Loan Terms (Page 1) | Final loan amount, interest rate, monthly P&I, prepayment penalty, balloon payment | `ResidentialLoanApplication` standard fields + indicator custom fields |
| Projected Payments | PITIA breakdown | `LoanApplicationFinancial.ProposedMonthlyPayment` components |
| Closing Cost Details (Page 2) | Itemized fees: origination, appraisal, title, recording, prepaids, escrow | Custom `ClosingCostLineItem__c` child object recommended; or stored as JSON in `ClosingCostsDetail__c` long text |
| Cash to Close (Page 3) | Down payment, credits, total cash needed | `LoanApplicationFinancial.DownPaymentAmount`, `ClosingCostsAmount`, credits |
| Loan Disclosures (Page 4) | Assumption, demand feature, late payment, escrow | Custom indicator fields on `ResidentialLoanApplication` |
| Contact Information (Page 5) | Lender, loan officer, settlement agent, real estate agents | `User` record (loan officer) + custom vendor fields |

---

## E-Signature Pattern for Closing Documents

Standard integration: DocuSign for Salesforce (AppExchange) or Salesforce native e-signature capabilities.

Pattern:
1. Processor generates closing document package: note, deed of trust/mortgage, CD, disclosure forms.
2. Documents are created as `ContentVersion` records linked to `ResidentialLoanApplication` via `ContentDocumentLink`.
3. DocuSign envelope is created from the `ResidentialLoanApplication` record page via a Flow or button. Envelope is sent to all `LoanApplicant` records' `Contact.Email` addresses.
4. DocuSign callback (webhook) updates `ResidentialLoanApplication.ESignStatus__c` (custom: `'Sent'`, `'Delivered'`, `'Completed'`, `'Declined'`, `'Voided'`).
5. On `ESignStatus__c = 'Completed'`: advance `Status = 'Closing'`; update `LoanApplicant.ApplicationSignedDate`.
6. Executed documents are returned as `ContentVersion` records tagged with `ContentDocument.Description = 'Executed Closing Package'`.

---

## Post-Close Data Retention

Federal and state laws mandate retention of mortgage records. Implement retention tagging via a custom field `RetentionCategory__c` on `ContentDocument` records:

| Retention Category | Period | Trigger |
|---|---|---|
| `'ClosedLoan'` | 7 years minimum (federal); some states require longer | `Status = 'Closed'` |
| `'DeniedApplication'` | 25 months (ECOA/HMDA) | `ActionTaken = 'ApplicationDenied'` |
| `'WithdrawnApplication'` | 25 months | `ActionTaken = 'ApplicationWithdrawn'` |
| `'HMDARecord'` | 3 years (HMDA) | Annual LAR file and supporting records |

Use a scheduled Apex batch that runs annually to flag `ContentDocument` records as `EligibleForArchival = true` when their retention period has elapsed. Do not auto-delete — require a human approval step before permanent deletion.

---

## MISMO XML Export Pattern

MISMO (Mortgage Industry Standards Maintenance Organization) XML format (current version: 3.4) is the standard interchange format for delivering loan data to investors (Fannie Mae, Freddie Mac), for AUS submissions, and for LOS handoffs.

### Export Architecture

Apex class `MISMOExportService` pattern:

```apex
public class MISMOExportService {

    public static String exportToMISMO34(Id rlaId) {
        // 1. Query full application graph
        ResidentialLoanApplication rla = [
            SELECT Id, LoanAmount, LoanPurpose, LoanType, ApplicationDate,
                   InterestRate, AmortizationType, LoanTerm, OccupancyType,
                   // ... all standard fields ...
                   (SELECT Id, RoleOnLoan, FirstName, LastName, DateOfBirth,
                           CreditScore, Race, Ethnicity, Sex
                    FROM LoanApplicants__r),
                   (SELECT Id, AddressType, Street, City, StateCode, PostalCode
                    FROM LoanApplicantAddresses__r),
                   // ... all child relationships ...
            FROM ResidentialLoanApplication WHERE Id = :rlaId
        ];

        // 2. Build MISMO XML DOM
        Dom.Document doc = new Dom.Document();
        Dom.XmlNode root = doc.createRootElement('MESSAGE', 'http://www.mismo.org/residential/2009/schemas', 'MISMO');
        // ... serialize each section to corresponding MISMO element ...

        // 3. Return serialized XML string
        return doc.toXmlString();
    }
}
```

Key MISMO 3.4 element mappings:

| MISMO Element | FSC Source |
|---|---|
| `BORROWER` | `LoanApplicant` (RoleOnLoan = Borrower) |
| `CO_BORROWER` | `LoanApplicant` (RoleOnLoan = CoBorrower) |
| `RESIDENCE` | `LoanApplicantAddress` |
| `EMPLOYER` | `LoanApplicantEmployment` |
| `INCOME` | `LoanApplicantIncome` |
| `ASSET` | `LoanApplicantAsset` |
| `LIABILITY` | `LoanApplicantLiability` |
| `PROPERTY` | `LoanApplicationProperty` |
| `LOAN` | `ResidentialLoanApplication` (financial terms) |
| `CLOSING_COST` | `LoanApplicationFinancial` + `ClosingCostLineItem__c` |
| `HMDA_INFORMATION` | HMDA fields on `ResidentialLoanApplication` and `LoanApplicant` |

Store the generated MISMO XML as a `ContentDocument` linked to `ResidentialLoanApplication` with `ContentDocument.Title = 'MISMO_3.4_Export_' + ApplicationNumber + '_' + TODAY()`. Retain per the `'ClosedLoan'` retention category.

### Triggering MISMO Export

- **Manual:** Button on `ResidentialLoanApplication` record page invokes an LWC that calls `MISMOExportService`.
- **Automatic on status change:** Record-Triggered Flow fires when `Status = 'Closing'` and invokes `MISMOExportService` via an Invocable Apex action.
- **LOS delivery:** Integration Procedure takes the MISMO XML string and POSTs to the LOS or GSE endpoint via Named Credential.
