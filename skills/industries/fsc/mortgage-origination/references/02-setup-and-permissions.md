# FSC Mortgage Origination — Setup and Permissions

## License and Feature Requirements

FSC Mortgage Origination requires the **Financial Services Cloud** license with the **Mortgage** feature enabled. The `ResidentialLoanApplication` object and its child objects are part of the FSC Mortgage feature set and will not appear in orgs that have FSC without the Mortgage add-on.

Verify in Setup > Installed Packages that the FSC managed package is installed. For orgs using OmniStudio for intake and processing UIs, additionally verify that OmniStudio (formerly Vlocity) is installed — either as a managed package (namespace `omnistudio`) or as the natively-enabled OmniStudio that ships with FSC.

```bash
# Check installed packages via SFDX
sf org display --target-org <alias>
sf package installed list --target-org <alias>
```

Minimum FSC package version for full `ResidentialLoanApplication` support: **FSC v13.0** (aligned with API 60.0 / Summer '25). Prior versions may have the object but lack key fields (rate lock, HMDA demographic fields, TRID date fields).

---

## Required Feature Flags

Enable these in Setup > Financial Services Cloud Settings (or the org's FSC Configuration Setup app):

| Feature | What it enables |
|---|---|
| **Mortgage** | `ResidentialLoanApplication` and all child objects; loan pipeline views; mortgage OmniStudio components |
| **Document Tracking and Approvals** | Milestone-based document checklist patterns for loan conditions |
| **Action Plans** | `ActionPlanTemplate` for URLA document checklists and compliance task generation |
| **Interaction Summaries** | Capturing loan officer call and meeting notes linked to the application |
| **Business Milestones** | Milestone tracking across the loan lifecycle (Application, Processing, Approval, Closing) |

---

## Permission Sets

Never grant FSC Mortgage access via profiles. Stack permission sets using Permission Set Groups.

| Permission Set API Name | Who needs it | What it grants |
|---|---|---|
| `FSCMortgage` | All mortgage users | Core access: `ResidentialLoanApplication`, `LoanApplicant`, all child objects, pipeline views |
| `FSCFinancialServices` | All FSC users | Base FSC objects (Contact financial data, Relationship Groups, Household Account features) |
| `OmniStudioUser` | Users running OmniScripts and FlexCards | OmniStudio runtime |
| `OmniStudioAdmin` | Admins building OmniStudio components | Full OmniStudio metadata access |
| `EinsteinAnalyticsForFSC` | Loan officers, managers, analysts | FSC mortgage pipeline dashboards and Einstein Analytics |
| `DocumentGenerationUser` | Loan officers, processors | Salesforce Document Generation (for LE, CD, closing docs) |

**Recommended Permission Set Groups by persona:**

| Group | Permission Sets |
|---|---|
| `MortgageLoanOfficer` | `FSCFinancialServices` + `FSCMortgage` + `OmniStudioUser` + `EinsteinAnalyticsForFSC` |
| `MortgageProcessor` | `FSCFinancialServices` + `FSCMortgage` + `OmniStudioUser` + `DocumentGenerationUser` |
| `MortgageUnderwriter` | `FSCFinancialServices` + `FSCMortgage` + `OmniStudioUser` |
| `MortgageManager` | All of the above + `EinsteinAnalyticsForFSC` |
| `MortgageAdmin` | All of the above + `OmniStudioAdmin` |

---

## Object and Field Permissions

Key objects requiring explicit CRUD grants (not covered by base FSC license alone):

| Object | Loan Officer | Processor | Underwriter | Manager |
|---|---|---|---|---|
| `ResidentialLoanApplication` | Create, Read, Edit | Read, Edit | Read, Edit | All |
| `LoanApplicant` | Create, Read, Edit | Read, Edit | Read | All |
| `LoanApplicantAddress` | Create, Read, Edit | Read, Edit | Read | All |
| `LoanApplicantEmployment` | Create, Read, Edit | Read, Edit | Read | All |
| `LoanApplicantIncome` | Create, Read, Edit | Read, Edit | Read, Edit | All |
| `LoanApplicantAsset` | Create, Read, Edit | Read, Edit | Read | All |
| `LoanApplicantLiability` | Create, Read, Edit | Read, Edit | Read | All |
| `LoanApplicationProperty` | Create, Read, Edit | Read, Edit | Read, Edit | All |
| `LoanApplicationFinancial` | Create, Read, Edit | Read, Edit | Read, Edit | All |

Field-Level Security (FLS) restrictions to apply explicitly:

| Field | Restriction |
|---|---|
| `LoanApplicant.CreditScore` | Visible to Loan Officer, Underwriter, Manager only — not Processor |
| `LoanApplicant.DateOfBirth` | Visible to all mortgage roles; restrict to read-only for Processor |
| `LoanApplicant.Race`, `LoanApplicant.Ethnicity`, `LoanApplicant.Sex` | HMDA collection — visible only to roles responsible for HMDA reporting; never expose to underwriter to prevent fair lending violations |
| `ResidentialLoanApplication.InterestRate` | Editable only by Loan Officer and Manager; read-only for Processor, Underwriter |
| `LoanApplicantLiability.AccountNumber` | Mask — show last 4 digits only; use a formula display field |

---

## Record Types

FSC Mortgage installs two standard record types on `ResidentialLoanApplication`:

| Record Type Developer Name | Label | Use Case |
|---|---|---|
| `PurchaseApplication` | Purchase Mortgage | New home purchase loans |
| `RefinanceApplication` | Refinance Mortgage | Rate-and-term or cash-out refinance |

Some implementations add a third:
| `ConstructionApplication` | Construction-to-Perm | Single-close construction loans |

Assign default record types per persona in permission sets. Loan Officers should default to `PurchaseApplication`; use record type selection on creation to choose.

---

## Loan Officer and Processor Role Setup

**NMLS ID capture:** Loan Officers must have their NMLS (Nationwide Mortgage Licensing System) ID stored. Add a custom field `NMLSId__c` on the `User` object and surface it on the Loan Officer's profile. This ID is required on TRID disclosures (Loan Estimate and Closing Disclosure). Reference `User.NMLSId__c` in document generation templates.

**Loan pipeline views:** FSC Mortgage installs a `Mortgage Pipeline` list view on `ResidentialLoanApplication` filtered to the current user's owned applications, grouped by `Status`. Supplement with an Einstein Analytics (Tableau CRM) dashboard for manager-level pipeline visibility. Configure the FSC Mortgage Pipeline FlexCard for the homepage.

**Milestone tracking:** Configure `BusinessMilestone` records to track key dates:
- `Application Received`
- `Credit Pull Completed`
- `Appraisal Ordered`
- `Appraisal Received`
- `AUS Submission`
- `Conditional Approval Issued`
- `Clear to Close`
- `Closing Disclosure Issued`
- `Loan Closed`

Each milestone links to the `ResidentialLoanApplication` via a lookup. Populate milestone `CompletedDate` as each stage is reached using a Record-Triggered Flow.

---

## LOS Named Credential Setup

For integration with Encompass, Point, Byte, or other LOS platforms:

1. **Create an External Credential** (Setup > Named Credentials > External Credentials tab) for the LOS authentication scheme (typically OAuth2 or username/password with HTTP header token).
2. **Create a Named Credential** linking to the External Credential. Use the LOS's REST API base URL (e.g., `https://api.elliemae.com/encompass/v3/` for Encompass).
3. **Create a Permission Set** granting the External Credential's principal to mortgage admin users only. Do not expose LOS credentials to all mortgage users.
4. **Reference in Integration Procedures** using the Named Credential label — never hard-code URLs or tokens in Integration Procedures or Apex.

Named Credential naming convention:
- `LOS_Encompass_Prod` — production Encompass
- `LOS_Encompass_Sandbox` — Encompass test environment
- `CreditBureau_Experian_Prod` — Experian credit pull
- `CreditBureau_Equifax_Prod` — Equifax credit pull
- `AUS_DU_Prod` — Fannie Mae Desktop Underwriter

---

## HMDA Reporting Configuration

HMDA (Home Mortgage Disclosure Act) requires annual LAR (Loan/Application Register) filing for covered financial institutions. Configure:

1. **Institution identifier fields:** Add custom fields `HMDAInstitutionLEI__c` (Legal Entity Identifier, 20 characters) and `HMDAInstitutionName__c` to the `Organization` object. These populate the LAR header.

2. **Census tract lookup:** `LoanApplicationProperty.CensusTracts` must be populated from the property address. Integrate with the FFIEC Geocoder API (via Named Credential) or implement a custom address-to-census-tract lookup. Census tract is required on every LAR record.

3. **Universal Loan Identifier (ULI):** Each `ResidentialLoanApplication` requires a ULI for HMDA. Format: `{LEI}{LoanNumber}{CheckDigit}`. Implement ULI generation as an Apex `before insert` trigger or a Flow formula on `ResidentialLoanApplication` creation.

4. **HMDA data collection form:** The HMDA demographic collection (Race, Ethnicity, Sex) must be offered to each applicant. Capture via the intake OmniScript with an explicit "I do not wish to provide this information" option per the URLA instructions. Store on `LoanApplicant` demographic fields. Do not pre-populate from Contact demographics.

5. **LAR export:** Build a scheduled Apex batch or a Data Export integration that collects all `ResidentialLoanApplication` records with `ApplicationDate` in the reporting year and `ActionTaken != null`, then formats them to the FFIEC LAR flat-file format for submission to the Federal Financial Institutions Examination Council.
