# Reporting, Analytics, and Integrations Reference

## Overview

This reference covers pipeline report best practices, `OpportunityHistory`-based velocity analysis, `CampaignInfluence` for multi-touch attribution, Einstein Activity Capture considerations, external CRM sync patterns, duplicate management with `OpportunityMatchingRule`, and Bulk API 2.0 for opportunity import.

---

## Pipeline Report Best Practices

### Recommended Pipeline Report Filters

A standard pipeline report should include:

| Filter | Recommended Setting |
|---|---|
| `IsClosed` | `equals False` (open deals only) |
| `CloseDate` | `equals THIS_FISCAL_QUARTER` or `THIS_FISCAL_YEAR` (avoid all-time) |
| `ForecastCategory` | Exclude `Omitted` to remove deliberately-excluded records |
| `OwnerId` | Parameterize for manager drill-down |
| `Type` | Add as a grouping field for New Business vs. Existing Business segmentation |

### Key Report Metrics

- **Pipeline by Stage**: Group by `StageName`, sum `Amount`. Reveals bottlenecks.
- **Weighted Pipeline**: Sum `ExpectedRevenue` (`Amount × Probability / 100`). More conservative view.
- **Pipeline by ForecastCategory**: Group by `ForecastCategory`, sum `Amount`. Aligns with forecast views.
- **Pipeline Coverage Ratio**: Total open pipeline `Amount` divided by quota. Typically target 3×–4× coverage.
- **Deals Past CloseDate**: Filter `CloseDate < TODAY` and `IsClosed = false`. Represents stale/overdue pipeline — should be reviewed weekly.

### Avoiding Common Pipeline Report Mistakes

- **Do not filter on `LastModifiedDate`** for "recent activity" — use `LastActivityDate` instead, which reflects Task/Event completion, not field edits.
- **Do not aggregate `Opportunity.Amount` when line items exist** — in reports with `OpportunityLineItem` as the primary or related object, the amounts may double-count if the report rolls up both the parent `Amount` and child `TotalPrice`.
- **Do not include Closed records in pipeline reports** unless you explicitly want closed+open combined. Use separate reports for won, lost, and open.

---

## OpportunityHistory for Stage Velocity Analysis

`OpportunityHistory` enables time-in-stage analysis by calculating the elapsed time between consecutive `StageName` changes.

### SOQL Pattern for Stage Entry Timestamps

```soql
SELECT OpportunityId, StageName, CreatedDate, Amount, Probability, ForecastCategory
FROM OpportunityHistory
WHERE Opportunity.OwnerId IN :repIds
  AND Opportunity.CloseDate >= :fiscalYearStart
  AND Field = 'StageName'
ORDER BY OpportunityId ASC, CreatedDate ASC
```

Process the results in Apex or an analytics tool: for each `OpportunityId`, calculate the difference between consecutive `CreatedDate` values to get time-in-stage.

### Key Metrics Derivable from OpportunityHistory

| Metric | How to Calculate |
|---|---|
| Average time in stage | Mean of `(next_stage_CreatedDate - this_stage_CreatedDate)` per stage |
| Stage conversion rate | Count of opps that entered stage N and also entered stage N+1 |
| Deal slippage count | Count of `CloseDate` field changes where new value > old value |
| Amount change frequency | Count of `Amount` field changes per opportunity |
| Forecast category drift | Transitions from `Commit` back to `BestCase` or `Pipeline` |

### CloseDate Slippage Report

To identify chronically slipping deals:

```soql
SELECT OpportunityId, OldValue, NewValue, CreatedDate
FROM OpportunityFieldHistory
WHERE Field = 'CloseDate'
  AND OldValue < NewValue
ORDER BY OpportunityId, CreatedDate ASC
```

Note: `OpportunityFieldHistory` is the standard Field History tracking object (up to 20 fields tracked per object). `OpportunityHistory` is a separate, dedicated system object that tracks only the 5 key fields. For all other field changes, use `OpportunityFieldHistory`.

---

## CampaignInfluence for Multi-Touch Attribution

### The Problem with `Opportunity.CampaignId` Alone

`Opportunity.CampaignId` stores a single campaign. In multi-touch deals (where a prospect touches a webinar, a trade show, and a nurture email before buying), only one campaign gets credit — typically the most recent touch or whatever the rep manually selected. This understates campaign ROI.

### CampaignInfluence Object

`CampaignInfluence` links a `Campaign`, `Opportunity`, and `Contact` with an influence percentage. It enables reporting on how many campaigns contributed to each closed deal and what percentage of revenue each campaign influenced.

### Enabling Campaign Influence

1. Navigate to **Setup → Campaign Influence**.
2. Enable **Campaign Influence**.
3. Configure an **Attribution Model** (Customizable Campaign Influence):
   - **First Touch**: 100% credit to the first campaign.
   - **Last Touch**: 100% credit to the last campaign.
   - **Even Distribution**: Equal credit split across all campaigns.
   - **Custom**: User-defined weights per touch position.
4. Configure auto-association settings: which `CampaignMember` statuses qualify for influence (e.g., only `Responded` status).

### CampaignInfluence — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `CampaignId` | Lookup(Campaign) | The influencing campaign |
| `OpportunityId` | Lookup(Opportunity) | The influenced opportunity |
| `ContactId` | Lookup(Contact) | The contact who was a member of the campaign |
| `Influence` | Percent | Attribution percentage for this campaign-opportunity pair |
| `LastModifiedDate` | DateTime | When this influence record was last updated |
| `ModelId` | Lookup(CampaignInfluenceModel) | Which attribution model generated this record |

### Reporting on Campaign ROI

Create an `Opportunity` report type joined to `CampaignInfluence`. Group by `Campaign.Name`, sum `Opportunity.Amount × (Influence/100)` to get influenced revenue per campaign. Compare to campaign cost to calculate ROI.

**Do not use `Opportunity.CampaignId` for ROI reporting** — it only reflects one campaign per deal and systematically understates campaign-sourced revenue.

---

## Einstein Activity Capture Considerations

Einstein Activity Capture (EAC) automatically logs emails and calendar events between reps and contacts/leads, eliminating manual task logging.

### Key Behavioral Differences from Manual Activity Logging

- EAC-captured activities are **not stored as `Task` or `Event` records in Salesforce** by default — they are stored in the Einstein Activity Capture data store and displayed in the Activity Timeline component.
- **SOQL queries on `Task` and `Event` will not return EAC-captured activities** unless the org has configured **Activity 360 Reporting** or EAC has been configured to write to standard `Task`/`Event` objects.
- `LastActivityDate` on `Opportunity` is **only updated by standard `Task` and `Event` records**, not by EAC-captured activities in the Einstein data store. This is a significant gap in pipeline hygiene reports that filter on `LastActivityDate`.
- For orgs using EAC, stage-activity requirement validation rules (e.g., "must have a logged task before advancing stage") need to account for whether EAC activities count.

### Recommendation

If using EAC, either:
1. Configure EAC to sync captured activities back to standard `Task`/`Event` objects (requires additional setup), OR
2. Build pipeline reports using the Activity Timeline API rather than SOQL on `Task`/`Event`.

---

## External CRM Sync Patterns

When syncing opportunities between Salesforce and an external CRM (e.g., HubSpot, Microsoft Dynamics, Zendesk Sell), follow these patterns to avoid data integrity issues.

### Field Mapping Considerations

| Salesforce Field | Risk During Sync |
|---|---|
| `Opportunity.ForecastCategory` | Do not overwrite — let Salesforce derive from `StageName` |
| `Opportunity.Amount` | Do not write if line items exist — check `HasOpportunityLineItem` first |
| `Opportunity.Probability` | Do not overwrite unless the org has `Allow Overriding Probability` enabled |
| `Opportunity.StageName` | Map external stage names to Salesforce stage names exactly — case-sensitive picklist matching |
| `Opportunity.OwnerId` | Sync requires user lookup by external Id or email; never hardcode User Ids |
| `Opportunity.Pricebook2Id` | Do not sync from external systems — Pricebook Ids differ across orgs and sandboxes |

### Upsert Key Pattern

Use a custom external Id field (e.g., `External_CRM_Id__c`) as the upsert key for integration syncs. This allows the integration to upsert `Opportunity` records without querying Salesforce Ids.

```
Opportunity.External_CRM_Id__c (Text, External ID, Unique)
```

In the integration, use `PATCH /services/data/vXX.0/sobjects/Opportunity/External_CRM_Id__c/{value}` for upserts.

### Preventing ForecastCategory Corruption

In external sync flows, **never include `ForecastCategory` in the upsert payload**. Always sync `StageName` and let Salesforce derive `ForecastCategory` from the stage configuration. Including `ForecastCategory` in the sync payload may temporarily set an incorrect value that then gets overwritten on save, causing audit trail noise in `OpportunityHistory`.

---

## Duplicate Management with OpportunityMatchingRule

### Enabling Duplicate Management

1. Navigate to **Setup → Duplicate Management**.
2. Configure an `OpportunityMatchingRule` — define which fields constitute a potential duplicate (e.g., `Name` contains similar text, `AccountId` matches, `CloseDate` is within 90 days).
3. Create an `OpportunityDuplicateRule` that references the matching rule and defines the action: `Alert` (warn the user), `Block` (prevent save), or `Report` (log to a duplicate report without blocking).

### Merging Opportunities

Salesforce allows merging up to 3 `Opportunity` records into one master record. During a merge:
- The master record retains its `Id` and all field values selected by the user.
- Child records (`OpportunityLineItem`, `OpportunityContactRole`, `OpportunityTeamMember`, `Task`, `Event`, `OpportunityHistory`) from the non-master records are reparented to the master.
- The non-master records are soft-deleted (move to the Recycle Bin).
- Merge is done via the UI or the `merge` DML statement in Apex.

**Caution:** `OpportunityHistory` records from merged opportunities are reparented but the `CreatedDate` timestamps reflect the original records' change history. This can create confusing stage history timelines on the merged master record.

---

## Bulk API 2.0 for Opportunity Import

### When to Use Bulk API 2.0

Use Bulk API 2.0 for imports of 2,000+ `Opportunity` records (e.g., historical migration from a legacy CRM, mass pipeline import).

### Required Fields for Opportunity Import

| Field | Required | Notes |
|---|---|---|
| `Name` | Yes | Opportunity name |
| `CloseDate` | Yes | Must be a valid date; format `YYYY-MM-DD` |
| `StageName` | Yes | Must exactly match a picklist value in the org |
| `AccountId` or `Account.External_Id__c` | Yes (usually) | Use external Id reference if mapping by external Id |
| `OwnerId` or `Owner.Username` | Recommended | Defaults to the running user if omitted |
| `Type` | Recommended | `New Business` or `Existing Business` |

### Fields to Omit in Bulk Import

| Field | Reason to Omit |
|---|---|
| `ForecastCategory` | Derived from `StageName`; including it causes noise |
| `Probability` | Auto-set from stage; including overrides may cause issues |
| `Amount` | Only set this if NOT also importing `OpportunityLineItem` records |
| `TotalOpportunityQuantity` | Calculated; cannot be set directly |
| `ExpectedRevenue` | Calculated |
| `IsClosed`, `IsWon` | Read-only formulas |

### Upsert Key for Import

Use a custom external Id field on `Opportunity` (e.g., `Legacy_CRM_Id__c`) as the upsert key. This allows re-running the import without creating duplicates. The field must be configured as:
- **Type**: Text(255)
- **External ID**: Yes
- **Unique**: Yes

### Bulk API 2.0 Import Steps

1. Create a Bulk API 2.0 job: `POST /services/data/vXX.0/jobs/ingest` with `object: "Opportunity"`, `operation: "upsert"`, `externalIdFieldName: "Legacy_CRM_Id__c"`.
2. Upload CSV batches: `PUT /services/data/vXX.0/jobs/ingest/{jobId}/batches`.
3. Close the job: `PATCH /services/data/vXX.0/jobs/ingest/{jobId}` with `state: "UploadComplete"`.
4. Poll for job completion: `GET /services/data/vXX.0/jobs/ingest/{jobId}`.
5. Retrieve success and failure results to identify any failed records.

### Post-Import Validation

After bulk import:
- Run a SOQL query to confirm record counts by `StageName` match expectations.
- Check that `ForecastCategory` values on imported records match the expected stage-to-forecast mapping.
- Verify that `CloseDate` values are not in the past (unless intentional for historical data).
- Confirm `OwnerId` assignments by querying `SELECT OwnerId, COUNT(Id) FROM Opportunity GROUP BY OwnerId` and comparing to expected rep assignments.
