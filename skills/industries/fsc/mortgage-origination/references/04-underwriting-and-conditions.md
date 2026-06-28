# FSC Mortgage Origination — Underwriting and Conditions Management

## Underwriting Overview

Underwriting is the credit risk evaluation stage that determines whether a loan is approved, conditionally approved, or denied. In FSC Mortgage, underwriting is represented by the `Status = 'Underwriting'` stage on `ResidentialLoanApplication`, and encompasses DTI/LTV analysis, automated underwriting system (AUS) submission, appraisal review, title review, conditions issuance, and rate lock management.

FSC provides no native underwriting decision engine — underwriting logic is implemented via Flows, Apex, and integration with Fannie Mae Desktop Underwriter (DU) or Freddie Mac Loan Product Advisor (LPA) via Named Credential callouts.

---

## Underwriting Decision Criteria

The three primary underwriting criteria (the "three Cs"):

| Criterion | Source fields in FSC |
|---|---|
| **Credit** | `LoanApplicant.CreditScore` (middle FICO); tradeline history from credit report document |
| **Capacity (DTI)** | Calculated from `LoanApplicantIncome.MonthlyAmount` (all applicants) and `LoanApplicantLiability.MonthlyPaymentAmount` (all applicants) + `LoanApplicationFinancial.ProposedMonthlyPayment` |
| **Collateral (LTV)** | `ResidentialLoanApplication.LoanAmount` / MIN(`LoanApplicationProperty.PurchasePrice`, `LoanApplicationProperty.AppraisedValue`) |

Build a computed underwriting summary on `ResidentialLoanApplication` using formula fields or a Flow summary record:
- `FrontEndDTI__c` — housing ratio
- `BackEndDTI__c` — total debt ratio
- `LTV__c` — loan-to-value
- `UnderwritingRecommendation__c` — custom field for DU/LP finding: `'Approve/Eligible'`, `'Approve/Ineligible'`, `'Refer'`, `'Refer with Caution'`, `'Out of Scope'`

---

## Automated Underwriting System (AUS) Integration

### Desktop Underwriter (Fannie Mae) and Loan Product Advisor (Freddie Mac)

AUS submission packages the full 1003 data and sends it to DU or LPA via MISMO 3.4 XML. The AUS returns a risk classification and eligibility findings.

Integration pattern:
1. Processor or underwriter triggers AUS submission from `ResidentialLoanApplication`.
2. An Apex class or Integration Procedure serializes the application data to MISMO 3.4 XML (see `references/05-compliance-and-closing.md` for MISMO pattern).
3. Callout to Fannie Mae DUCS API or Freddie Mac LPA API via Named Credential (`AUS_DU_Prod` or `AUS_LPA_Prod`).
4. Response is parsed: recommendation (`Approve/Eligible`, `Refer`, etc.), required conditions, and risk flags.
5. Update `ResidentialLoanApplication.UnderwritingRecommendation__c` with the AUS finding.
6. Persist the AUS report as a `ContentDocument` linked to `ResidentialLoanApplication`.
7. Auto-generate `LoanCondition__c` records from AUS conditions (see Conditions section below).

**Important:** AUS submissions are date-stamped. If the borrower's income, assets, or liabilities change after submission, the file must be resubmitted to AUS before closing. Track AUS submission date in `AUSSubmissionDate__c` on `ResidentialLoanApplication`.

---

## Conditions Management

FSC Mortgage does not ship a native Conditions object. Implement conditions as a custom object `LoanCondition__c` with the following schema:

| Field | Type | Notes |
|---|---|---|
| `ResidentialLoanApplicationId__c` | Lookup | Parent application |
| `ConditionType__c` | Picklist | `'Prior to Docs'`, `'Prior to Funding'`, `'Post Funding'`, `'Compliance'`, `'Suspense'` |
| `ConditionCategory__c` | Picklist | `'Income'`, `'Asset'`, `'Credit'`, `'Property'`, `'Title'`, `'Insurance'`, `'Compliance'`, `'Other'` |
| `ConditionDescription__c` | Long Text | Detailed condition text |
| `ConditionStatus__c` | Picklist | `'Open'`, `'Received'`, `'Reviewed'`, `'Satisfied'`, `'Waived'`, `'Rejected'` |
| `AssignedToId__c` | Lookup(User) | Loan officer or processor responsible |
| `DueDate__c` | Date | Date by which condition must be cleared |
| `SatisfiedDate__c` | Date | Date condition was cleared |
| `WaivedBy__c` | Lookup(User) | Who waived the condition (for audit) |
| `WaivedReason__c` | Text | Reason for waiver |
| `SourceSystem__c` | Picklist | `'Manual'`, `'DU'`, `'LPA'`, `'Underwriter'` |

**Condition state machine:** Implement a Flow that validates transitions: `Open → Received` (document uploaded), `Received → Reviewed` (underwriter reviewed), `Reviewed → Satisfied` or `Reviewed → Rejected`, `Open/Received/Reviewed → Waived` (manager can waive). Do not allow jumping directly from `Open → Satisfied` without document attachment.

**Approval types:**
- `Status = 'ConditionalApproval'`: Open `LoanCondition__c` records exist; loan is approved subject to clearing conditions.
- `Status = 'ClearToClose'`: All `LoanCondition__c` records have `ConditionStatus__c IN ('Satisfied', 'Waived')` and `ConditionType__c = 'Prior to Docs'` are cleared. Implement this as a validation rule that prevents advancing to `ClearToClose` if any `Prior to Docs` conditions remain open.

---

## Appraisal Management

Appraisals are ordered after the Conditional Approval is issued (or earlier if required by the lender's workflow). Track appraisal data on `LoanApplicationProperty`:

| Field | Where stored |
|---|---|
| Appraisal order date | `LoanApplicationProperty.AppraisalOrderDate__c` (custom) or custom `Appraisal__c` child object |
| Appraisal company / AMC | `LoanApplicationProperty.AppraisalCompanyName` |
| Appraiser name | Custom field |
| Appraisal received date | `LoanApplicationProperty.AppraisalDate` |
| Appraised value | `LoanApplicationProperty.AppraisedValue` |
| Appraisal type | Custom field — `'FullAppraisal'`, `'ExteriorOnly'`, `'DesktopAppraisal'`, `'AVM'` |
| Appraisal report | `ContentDocumentLink` on `LoanApplicationProperty` |

**LTV recalculation trigger:** Create a Record-Triggered Flow on `LoanApplicationProperty` that fires when `AppraisedValue` is updated and recalculates `LTV__c` on the parent `ResidentialLoanApplication`. If the new LTV changes the loan tier (e.g., crosses 80%, 90%, 95%, 97%), create a `LoanCondition__c` for the underwriter to review.

**Appraisal review conditions:** Common appraisal conditions to auto-generate if appraised value is below purchase price:
- If `AppraisedValue < PurchasePrice`: create condition `'Revised purchase agreement or new down payment required; LTV recalculated'`
- If `AppraisedValue / LoanAmount < 0.80` (LTV > 80%): create PMI condition

---

## Title Management

Title insurance and title search are tracked in custom fields on `ResidentialLoanApplication` or a custom `TitleOrder__c` child object:

| Field | Notes |
|---|---|
| `TitleOrderDate__c` | Date title search was ordered |
| `TitleCompany__c` | Title company name |
| `TitleReceivedDate__c` | Date preliminary title report was received |
| `TitleClearDate__c` | Date title was cleared of all exceptions |
| `TitleExceptions__c` | Long text — open title exceptions requiring resolution |
| `LendersTitle__c` | Boolean — confirms lender's title policy will be issued |
| `OwnersTitle__c` | Boolean — whether borrower is purchasing owner's title policy |

Typical title conditions: open liens, judgment searches, vesting issues, easement disclosures. These are usually entered as `LoanCondition__c` records with `ConditionCategory__c = 'Title'`.

---

## Rate Lock Tracking

Rate lock is tracked on `ResidentialLoanApplication` using standard and custom fields:

| Field | API Name | Type | Notes |
|---|---|---|---|
| Rate lock date | `RateLockDate` | Date | Date rate was locked with the investor |
| Rate lock expiration | `RateLockExpirationDate` | Date | Must be on or after `ClosingDate` |
| Lock period | `LockPeriodDays` | Number | Typical values: 15, 30, 45, 60, 90 |
| Interest rate | `InterestRate` | Percent | Locked note rate |
| Lock status | `RateLockStatus__c` | Picklist (custom) | `'Floating'`, `'Locked'`, `'Extended'`, `'Expired'`, `'Relocked'` |
| Lock extension date | `RateLockExtensionDate__c` | Date (custom) | Date lock was extended |
| Extension cost | `RateLockExtensionCost__c` | Currency (custom) | Cost in basis points × loan amount for extension |

**Rate lock expiration alert:** Create a Scheduled Flow that runs daily, queries `ResidentialLoanApplication` where `RateLockExpirationDate <= TODAY() + 5` and `Status NOT IN ('Closed', 'Denied', 'Withdrawn')`, and creates a high-priority Task assigned to the Loan Officer.

**Rate lock history:** Standard FSC does not track lock history. If the investor requires lock extension/renegotiation tracking, create a custom child object `RateLockHistory__c` with fields: `LockDate`, `ExpirationDate`, `LockPeriodDays`, `InterestRate`, `LockType` (`'Initial'`, `'Extension'`, `'Relock'`), `Cost`.

---

## Milestone Tracking Pattern

Use `BusinessMilestone` records (standard FSC object) to track key dates across the loan lifecycle. Each milestone has:
- `Name` — milestone label
- `CompletedDate` — date milestone was achieved
- `TargetDate` — SLA date
- `RelatedRecordId` — lookup to `ResidentialLoanApplication`

Standard milestones to configure:
1. `Application Received` — `ApplicationDate` on `ResidentialLoanApplication`
2. `Disclosure Sent` — LE issued date (TRID)
3. `Credit Pulled` — `LoanApplicant.CreditPullDate`
4. `Appraisal Ordered` — `LoanApplicationProperty.AppraisalOrderDate__c`
5. `Appraisal Received` — `LoanApplicationProperty.AppraisalDate`
6. `AUS Submitted` — `AUSSubmissionDate__c`
7. `Conditional Approval` — date `Status` changed to `'ConditionalApproval'`
8. `Clear to Close` — date `Status` changed to `'ClearToClose'`
9. `Closing Disclosure Issued` — CD issued date (TRID)
10. `Loan Funded` — `FundingDate`

Populate milestones via Record-Triggered Flows on status transitions or date field updates.

---

## LOS Integration Patterns

### Overview

The integration between Salesforce FSC Mortgage and an external LOS (Encompass, Point, Byte) is not provided natively. Design and build the integration as a bi-directional sync with conflict resolution.

### Outbound (Salesforce → LOS): Push on status change

Trigger: Record-Triggered Flow on `ResidentialLoanApplication` fires when `Status` changes to `'Processing'`, `'Underwriting'`, `'ConditionalApproval'`, `'ClearToClose'`, or `'Closing'`.

Flow calls an Apex `@future(callout=true)` method (or an invocable Apex method if using Platform Events for async) that:
1. Queries the full application data: `ResidentialLoanApplication` + all child objects.
2. Serializes to LOS-specific JSON or MISMO 3.4 XML payload.
3. Posts to LOS REST API endpoint via Named Credential.
4. On success: updates `LOS_LastSyncDate__c` and `LOS_LoanNumber__c` on `ResidentialLoanApplication`.
5. On failure: creates a `Task` for the integration admin; sets `LOS_SyncStatus__c = 'Failed'`.

### Inbound (LOS → Salesforce): Status and data updates from LOS

Two patterns:

**Pattern A — Webhook (preferred):** LOS calls a Salesforce connected app endpoint (Site or Experience Cloud endpoint) with loan status updates. Salesforce REST handler upserts `ResidentialLoanApplication` using `LOS_LoanNumber__c` as the external ID.

**Pattern B — Scheduled polling:** A scheduled Apex batch or Integration Procedure calls LOS GET endpoint every 15 minutes (or nightly for batch updates), compares `LastModifiedDate` in LOS against `LOS_LastSyncDate__c`, and upserts changed records.

### Conflict resolution

Both Salesforce and the LOS can modify loan records simultaneously. Resolution rule: **LOS wins for status fields; Salesforce wins for borrower contact information.**

Implement via:
```apex
// Conflict resolution in inbound handler
if (incoming.getLastModifiedInLOS() > rla.LOS_LastSyncDate__c) {
    rla.Status = incoming.getLoanStatus();          // LOS wins on status
    rla.LOS_LastSyncDate__c = incoming.getLastModifiedInLOS();
    // Do NOT overwrite LoanApplicant contact data from LOS
}
```

### Encompass-specific

- Encompass uses the Encompass Developer Connect API (REST) with OAuth2 bearer tokens.
- Named Credential: `LOS_Encompass_Prod` with `https://api.elliemae.com/encompass/v3/` as the base URL.
- Key endpoint for loan creation: `POST /loans`; for updates: `PATCH /loans/{loanId}`.
- `loanId` in Encompass maps to `LOS_LoanNumber__c` in Salesforce.
- Encompass webhook events (loan status change, document received) can POST to a Salesforce site endpoint.

### Platform Events for async LOS sync

Use Platform Events to decouple LOS callouts from record saves:

1. Define Platform Event `LOS_SyncRequest__e` with fields: `ApplicationId__c`, `SyncDirection__c` (`'Outbound'`, `'Inbound'`), `Payload__c` (Long Text for JSON body).
2. Record-Triggered Flow publishes `LOS_SyncRequest__e` on status changes.
3. Platform Event Triggered Flow (or Apex subscriber) handles the event asynchronously — performs the callout without risking the DML transaction timeout.
