# Documents and Attachments

## The Right Way: ContentDocument + ClaimDocument

FSC Claims uses Salesforce Files (ContentDocument / ContentVersion) for all document storage. Never use the deprecated `Attachment` object.

```
ContentDocument  (file master — stored once)
  └── ContentVersion  (version of the file)
        └── ContentDocumentLink  (link to a Salesforce record)
                                   └── LinkedEntityId = ClaimId (or ClaimCoverageId, ClaimCaseId)
```

`ClaimDocument` is an FSC metadata wrapper that enriches the file link with claims-specific context.

## `ClaimDocument` Object

| Field | API Name | Notes |
|---|---|---|
| Claim | `ClaimId` | Parent claim |
| Document Type | `DocumentType` | See picklist below |
| Content Document | `ContentDocumentId` | Link to the actual file |
| Status | `Status` | `Pending`, `Received`, `Reviewed`, `Accepted`, `Rejected` |
| Received Date | `ReceivedDate` | When document was submitted |
| Required | `IsRequired` | Boolean; flags mandatory documents |
| Notes | `ReviewNotes` | Adjuster review comments |

## Document Types

Standard `DocumentType` picklist values:

| Type | Used for |
|---|---|
| `PoliceReport` | Auto accident, theft |
| `FireReport` | Property fire loss |
| `MedicalReport` | Bodily injury, disability |
| `DeathCertificate` | Life claims |
| `RepairEstimate` | Property, auto damage |
| `AppraisalReport` | High-value property |
| `PhotoEvidence` | Damage photos |
| `SignedStatement` | Claimant or witness statement |
| `ProofOfOwnership` | Contents, vehicle |
| `ProofOfLoss` | Formal sworn statement |
| `InsuranceCard` | Auto third-party verification |
| `BankDetails` | EFT payment setup |
| `SignedRelease` | Medical, legal release |
| `ContractorInvoice` | Post-repair payment |
| `EOB` | Explanation of Benefits (health-adjacent) |

## Required Documents by Claim Type

| Loss Type | Required documents |
|---|---|
| Auto Collision | Police Report (if third-party), Photos, Repair Estimate |
| Auto Total Loss | Police Report, Photos, Proof of Ownership (title), EFT/mailing details |
| Property Dwelling | Fire/Police Report, Photos, Contractor Estimate |
| Property Contents | Proof of Ownership, Photos, Itemized Inventory |
| Life | Death Certificate, Proof of Insured's Identity, Beneficiary ID |
| Disability | Medical Report, Employer Statement, Proof of Income |
| Liability | Signed Claimant Statement, Photos, Medical/Repair bills |

Implement required document checks in OmniScript step 4 (before adjudication) and in a Flow validation before `Status → 'Pending Payment'`.

## Uploading Documents via OmniScript

In OmniStudio OmniScript, use the **File component** to capture uploads:
1. File component creates `ContentVersion` → `ContentDocument`.
2. On OmniScript save, a DataRaptor Turbo Action creates:
   - `ContentDocumentLink` with `LinkedEntityId = ClaimId`
   - `ClaimDocument` record with `ContentDocumentId` and correct `DocumentType`

Do not use the generic Files upload widget — use a custom OmniScript action so `ClaimDocument` is always created alongside the file link.

## E-Signature

For signed statements, proof of loss, and settlement releases, integrate a DocuSign / Salesforce DocGen flow:
1. OmniScript triggers Integration Procedure → external e-signature API.
2. On signature completion, webhook or scheduled job:
   - Creates `ContentVersion` with signed PDF
   - Creates `ContentDocumentLink` (LinkedEntityId = ClaimId)
   - Creates `ClaimDocument(DocumentType = 'SignedRelease', Status = 'Accepted')`
   - Creates `ClaimAction(DocumentReceived)` for audit trail

## Document Completeness Check (Flow Pattern)

Before transitioning `Claim.Status → 'Pending Payment'`, validate required documents:

```
Flow (Before Save, Record-Triggered on Claim):
  IF NewStatus = 'Pending Payment':
    Query ClaimDocument WHERE ClaimId = :ClaimId AND IsRequired = true AND Status != 'Accepted'
    IF count > 0:
      AddError('Required documents are missing or not yet accepted: [list]')
```

## Storage and Visibility

- Files stored in Salesforce Files respect standard sharing rules.
- Claimants on portal: share `ContentDocumentLink` to Experience Cloud site record page.
- External adjusters (guest users): use Salesforce Customer/Partner Community with explicit file sharing.
- Large files (>10MB, video evidence): consider external storage with `ExternalDataUserAuth` + Salesforce Files Connect.
