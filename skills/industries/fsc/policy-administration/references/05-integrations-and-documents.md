# FSC Insurance — Integrations and Documents

## Integration Architecture Overview

FSC Insurance policy administration integrates with three categories of external systems:

| System Type | Direction | Primary Mechanism |
|---|---|---|
| Rating Engine | Outbound (Salesforce → Carrier/Rating System) | Synchronous REST callout from Apex or Integration Procedure |
| Policy Administration System (PAS) | Bidirectional | Platform Events (inbound) + REST callout (outbound) |
| Document Generation | Outbound | Named Credential callout or Salesforce DocGen |
| E-Signature / E-Delivery | Outbound | Named Credential callout (DocuSign, Panda, Adobe Sign) |

---

## Rating Engine Integration Pattern

### Synchronous Quote Request (Real-Time Rating)

The most common pattern: the agent submits coverage details, Salesforce calls the rating engine, and the premium is returned synchronously.

**Recommended implementation:** OmniStudio Integration Procedure + HTTP Action element.

```
OmniScript (agent fills coverage details)
  │
  └── Integration Procedure: IP_RatePolicy
        ├── DataRaptor Extract: read InsurancePolicy + InsurancePolicyCoverage
        ├── HTTP Action: POST to callout:AcmeRatingEngine_Prod/quote
        │     Request body: JSON payload mapped from DataRaptor
        │     Response: { "premiumAmount": 450.00, "coverageCode": "AUTO-STD" }
        └── DataRaptor Load: write PremiumAmount back to InsurancePolicyCoverage
```

**Named Credential reference in HTTP Action:** `callout:AcmeRatingEngine_Prod/quote`

**Error handling:** If the rating engine returns a non-2xx status or times out (default Salesforce callout timeout: 10 seconds), catch the error in the Integration Procedure `Error Handling` block. Do not leave `PremiumAmount` null — set it to null explicitly and surface an error message to the agent. Silently leaving `PremiumAmount` as the prior value corrupts the quote.

### Rating Engine Payload Shape

Rating engines typically expect a flat JSON payload. Map FSC fields to the carrier's expected keys via DataRaptor Transform:

```json
{
  "policyEffectiveDate": "2025-09-01",
  "policyType": "Individual",
  "coverageType": "Collision",
  "deductibleAmount": 500,
  "insuredDateOfBirth": "1985-03-14",
  "vehicleVIN": "1HGCM82633A123456",
  "vehicleYear": 2022,
  "garageState": "NY"
}
```

Salesforce FSC field names do not match carrier field names. Always use a DataRaptor or Apex mapping layer — never pass FSC API field names directly to the carrier.

---

## Policy Administration System (PAS) Integration

### Outbound: Policy Issuance to PAS

When `InsurancePolicy.Status` transitions to `Active`, publish a Platform Event to notify the PAS:

```apex
// In a Flow or Apex trigger after-update on InsurancePolicy
FSC_PolicyIssuedEvent__e evt = new FSC_PolicyIssuedEvent__e();
evt.PolicyId__c = policy.Id;
evt.PolicyNumber__c = policy.PolicyName;
evt.EffectiveDate__c = String.valueOf(policy.PolicyEffectiveDate);
evt.ProductCode__c = policy.Product2.ProductCode;
EventBus.publish(evt);
```

The PAS subscribes to `FSC_PolicyIssuedEvent__e` via its own CometD listener or a Salesforce-side Integration Procedure that calls the PAS REST endpoint.

### Inbound: PAS Policy Status Updates

When the PAS issues, endorses, or cancels a policy externally (e.g., direct policy issuance at an independent agent's office), it sends status updates back to Salesforce.

**Pattern — Platform Event inbound:**
1. PAS posts to Salesforce Connected App REST endpoint or publishes to a Platform Event via the Streaming API.
2. A Salesforce Flow (Platform Event-Triggered) or Apex subscriber receives `FSC_PASPolicyUpdateEvent__e`.
3. The handler upserts `InsurancePolicy` and `InsurancePolicyCoverage` fields, and creates a `PolicyTransaction` audit record.
4. The handler must be idempotent: check `PolicyTransaction` for a prior record with the same `TransactionType` + `TransactionEffectiveDate` before creating a duplicate.

**Pattern — Outbound Messaging (legacy orgs):**
If the org was built before Platform Events were widely available, Outbound Messaging via SOAP workflow may be in use. Do not migrate to Platform Events mid-project without testing the full integration chain.

### PAS Sync Field Mapping

| Salesforce Field | PAS Field (example) | Notes |
|---|---|---|
| `InsurancePolicy.PolicyName` | `policyNumber` | External policy number from PAS; should match |
| `InsurancePolicy.Status` | `policyStatus` | PAS status values differ; map via a custom metadata type `FSCPASStatusMapping__mdt` |
| `InsurancePolicyCoverage.PremiumAmount` | `coveragePremium` | PAS may return multiple lines; sum or match by `CoverageType` |
| `InsurancePolicyCoverage.CoverageAmount` | `limitAmount` | |
| `PolicyTransaction.TransactionType` | `transactionCode` | Map PAS codes to FSC picklist values |

---

## InsurancePolicyDocument

### Object Purpose

`InsurancePolicyDocument` is a **metadata wrapper** object. It classifies the type, subtype, and delivery status of a policy document. The actual file bytes are stored in `ContentVersion` (Salesforce Files) and linked via `ContentDocumentLink`.

### Required Fields

| Field | Type | Notes |
|---|---|---|
| `InsurancePolicyId` | Lookup(InsurancePolicy) | Required |
| `DocumentType` | Picklist | `PolicyDeclarations`, `Endorsement`, `CancellationNotice`, `ReinstatementNotice`, `IDCard`, `BillingStatement`, `Correspondence`, `LossRunReport` |
| `DocumentSubType` | Picklist | Optional; carrier-specific sub-classification |
| `IsDeliveredElectronically` | Checkbox | `true` if e-delivered; `false` if mailed |
| `DocumentDate` | Date | Date on the document (not necessarily `CreatedDate`) |

### Attaching Files to InsurancePolicyDocument

The two-step pattern:

```apex
// Step 1: Create or find ContentVersion (the file)
ContentVersion cv = new ContentVersion();
cv.Title = 'Policy Declarations - POL-00042';
cv.PathOnClient = 'POL-00042-declarations.pdf';
cv.VersionData = pdfBlobFromGenerator;
cv.FirstPublishLocationId = policyId; // links ContentDocument to the policy
insert cv;

// Step 2: Create InsurancePolicyDocument metadata wrapper
InsurancePolicyDocument ipd = new InsurancePolicyDocument();
ipd.InsurancePolicyId = policyId;
ipd.DocumentType = 'PolicyDeclarations';
ipd.IsDeliveredElectronically = false;
ipd.DocumentDate = Date.today();
insert ipd;

// Step 3: Link the ContentDocument to the InsurancePolicyDocument
// Query for the ContentDocumentId just created
ContentVersion cv2 = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
ContentDocumentLink cdl = new ContentDocumentLink();
cdl.LinkedEntityId = ipd.Id;  // link to the InsurancePolicyDocument, not the policy directly
cdl.ContentDocumentId = cv2.ContentDocumentId;
cdl.ShareType = 'V';
insert cdl;
```

**Do not use the `Attachment` object.** Attachments are deprecated and are not displayed in FSC Lightning pages or OmniStudio FlexCards. ContentVersion + ContentDocumentLink is the only supported pattern.

---

## E-Delivery and E-Signature

### E-Delivery Pattern

When `IsDeliveredElectronically = true` on `InsurancePolicyDocument`, trigger an e-delivery:

1. Generate the document (Salesforce DocGen, Conga, or custom PDF via Visualforce/LWC).
2. Create the `ContentVersion` + `InsurancePolicyDocument` records.
3. Publish `FSC_PolicyDocumentReadyEvent__e` Platform Event.
4. An Integration Procedure or Flow subscribes and calls the e-delivery service (e.g., carrier's document delivery API via Named Credential).
5. On delivery confirmation, update `InsurancePolicyDocument.DeliveredDate__c` (custom field) and set a `IsDeliveryConfirmed__c` checkbox.

### E-Signature (DocuSign or Adobe Sign)

1. The policy documents requiring signature (application, coverage acknowledgment) are sent to the insured's email via the e-signature provider API.
2. On completion callback (webhook to Salesforce via Connected App):
   - Update `ContentVersion.DocumentStatus = 'Completed'` (custom field).
   - Create `InsurancePolicyDocument` record with `DocumentType = 'SignedApplication'`.
   - Transition `InsurancePolicy.Status` to the next lifecycle state (e.g., `InReview` or `Active`).
3. Named Credential for DocuSign: `callout:DocuSign_Prod`. Rotate OAuth tokens per DocuSign's expiry rules.

---

## Named Credential Patterns Summary

| Credential Name | Target | Auth Method | Used In |
|---|---|---|---|
| `AcmeRatingEngine_Prod` | Carrier rating API | OAuth 2.0 JWT or Basic | IP_RatePolicy Integration Procedure |
| `AcmeRatingEngine_Dev` | Carrier rating API (dev/uat) | OAuth 2.0 JWT or Basic | Dev/UAT only |
| `AcmePAS_Prod` | Policy admin system | OAuth 2.0 or Basic | Policy issuance, endorsement, cancel outbound calls |
| `DocuSign_Prod` | DocuSign API | OAuth 2.0 Authorization Code | E-signature send/status |
| `DocGen_Prod` | Document generation service | API Key (stored as External Credential) | PDF generation |

### External Credential vs. Named Credential (Summer '25+)

In Summer '25 and later, Salesforce recommends using **External Credentials** to store the authentication credentials and **Named Credentials** for the endpoint URL. The `Named Credential` alone can no longer store OAuth tokens directly in strict-mode orgs. Existing implementations using the legacy Named Credential with embedded OAuth will continue to work until deprecated; migrate before the deprecation window.

---

## Platform Events Used in Policy Admin

| Event API Name | Direction | Purpose |
|---|---|---|
| `FSC_PolicyIssuedEvent__e` | Salesforce → PAS | Policy activated; PAS notified |
| `FSC_PolicyEndorsedEvent__e` | Salesforce → PAS | Mid-term change applied |
| `FSC_PolicyCancelledEvent__e` | Salesforce → PAS | Policy cancelled or lapse |
| `FSC_PolicyLapsedEvent__e` | PAS/Billing → Salesforce | Premium payment missed; trigger lapse in Salesforce |
| `FSC_PASPolicyUpdateEvent__e` | PAS → Salesforce | PAS-side policy change synced back to Salesforce |
| `FSC_PolicyDocumentReadyEvent__e` | Salesforce → Delivery Service | Document ready for e-delivery |

Keep Platform Event payloads minimal — store only Id fields and key scalar values. Do not embed full policy JSON in a Platform Event payload; that causes event size limit (512 KB) failures on complex policies with many coverages.
