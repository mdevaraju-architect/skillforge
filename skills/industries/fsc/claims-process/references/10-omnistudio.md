# OmniStudio for FSC Claims

## Component Map

| Component | Role in Claims |
|---|---|
| **FlexCard** | Claim summary panels, policy quick-view, adjuster dashboard tiles |
| **OmniScript** | FNOL intake wizard, adjudication workflow, payment confirmation, dispute filing |
| **Integration Procedure** | External calls: policy lookup, ISO ClaimSearch, payment processor, e-signature |
| **DataRaptor Extract** | SOQL-based reads from FSC Claims objects |
| **DataRaptor Transform** | JSON shape normalization, field mapping, merge logic |
| **DataRaptor Turbo Action** | High-performance single-object DML (create/update ClaimDocument, ClaimAction, etc.) |

## Key FlexCards

### Claim Summary FlexCard
Displays: `Claim` header + `ClaimParticipant` list + `ClaimCoverage` lines + outstanding `AssessmentTask` count.

DataRaptor Extract query:
```sql
SELECT Id, ClaimNumber, Status, DateOfLoss, LossType, LossAmount,
       InsurancePolicy.Name, InsurancePolicy.Status,
       (SELECT Id, Role, ParticipantId FROM ClaimParticipants),
       (SELECT Id, CoverageType, ClaimCoverageId FROM ClaimCoverages)
FROM Claim
WHERE Id = :recordId
```

Child cards (nested FlexCards):
- `ClaimCoverage_FC` — coverage lines with reserve and payment totals
- `ClaimTimeline_FC` — `ClaimAction` records in chronological order
- `ClaimDocuments_FC` — required vs received document checklist

### Policy Quick-View FlexCard
Displays: `InsurancePolicy` key fields + `InsurancePolicyCoverage` summary.
Embedded on Claim record page; uses `Claim.InsurancePolicyId` as input.

## Key OmniScripts

### FNOL Intake OmniScript (`FNOL_Intake_OS`)
Steps:
1. `PolicySearch` — Integration Procedure call → `PolicyLookup_IP`
2. `LossDetails` — form: DateOfLoss, LossType, LossDescription, LossLocation
3. `ClaimantVerification` — Contact lookup or creation
4. `CoverageSelection` — display coverages; user selects applicable ones
5. `ReviewAndSubmit` — confirm; on submit: DataRaptor Turbo creates Claim, ClaimParticipant, ClaimCoverage

### Adjudication OmniScript (`Adjudication_OS`)
Steps:
1. `ClaimSummary` — FlexCard embed
2. `PolicyVerification` — Integration Procedure call → `PolicyValidation_IP`
3. `DamageReview` — update ClaimItem subtype fields (form)
4. `Assessment` — display AssessmentIndicator scores; order inspection via AssessmentTask creation
5. `Decision` — ActionType picker + ActionNotes; optional reserve adjustment
6. `ConfirmAndSubmit` — creates ClaimAction; triggers status Flow

### Dispute Filing OmniScript (`DisputeFiling_OS`)
Steps:
1. `ClaimContext` — read-only Claim/ClaimAction history
2. `DisputeDetails` — DisputeReason, supporting description
3. `SupportingDocuments` — file upload → ClaimDocument
4. `Submit` — creates ClaimCase, ClaimAction(Reopen)

## Key Integration Procedures

### `PolicyLookup_IP`
```
Input: { PolicyNumber, InsuredName }
Steps:
  1. DataRaptor Extract: InsurancePolicy WHERE Name = :PolicyNumber AND Status = 'Active'
  2. DataRaptor Extract: InsurancePolicyCoverage WHERE InsurancePolicyId = :PolicyId
  3. DataRaptor Extract: InsurancePolicyParticipant WHERE InsurancePolicyId = :PolicyId
  4. DataRaptor Transform: merge { policyFound, policy{}, coverages[], participants[] }
Output: { policyFound: bool, policy: {}, coverages: [], participants: [] }
```

### `ISOClaimSearch_IP`
```
Input: { VIN or PropertyAddress, ClaimantSSN, ClaimantDOB }
Steps:
  1. DataRaptor Transform: build ISO request payload
  2. HTTP Action: POST to ISO_ClaimSearch (Named Credential)
  3. DataRaptor Transform: parse ISO response
  4. Conditional: if hitFound → create AssessmentIndicator(ISOHit, Fail)
Output: { hitFound: bool, priorClaims: [] }
```

### `ProcessPayment_IP`
```
Input: { ClaimPaymentId }
Steps:
  1. DataRaptor Extract: ClaimPayment + Payee (Contact/Account bank details)
  2. DataRaptor Transform: build payment processor API request
  3. HTTP Action: POST to PaymentProcessor (Named Credential)
  4. Conditional:
     SUCCESS → DataRaptor Turbo: update ClaimPayment.PaymentStatus = 'Issued', PaymentReference = txnId
     FAILURE → DataRaptor Turbo: update ClaimPayment.PaymentStatus = 'Failed'
             → DataRaptor Turbo: create ClaimAction(PaymentFailed)
Output: { success: bool, transactionId: string, errorMessage: string }
```

## OmniStudio Development Guidelines for Claims

1. **Never use DataRaptor Turbo for complex multi-object transactions** — use Apex (invocable method) when you need atomic DML across more than 2 objects.
2. **Always pass `ClaimId` as context** through every OmniScript step so child components always have parent context available.
3. **Use `sfdcOmniContext` sparingly** — overusing global context variables causes performance issues on complex claim pages.
4. **Integration Procedures must handle null responses from external systems** — ISO and payment processors timeout; always include error handling steps.
5. **Version your OmniStudio components** before changes to production claims workflows — name convention: `ComponentName_v2`.
6. **Test OmniScripts with all permission sets** that will use them — DataRaptor queries use the running user's FLS; if a coverage field is hidden, it returns null silently.
