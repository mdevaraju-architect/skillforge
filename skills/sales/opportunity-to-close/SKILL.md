---
name: sales-opportunity-to-close
description: >-
  Opportunity, OpportunityLineItem, OpportunityContactRole, OpportunityTeamMember,
  OpportunityStage, ForecastCategory, Quote, QuoteLineItem, Product2, Pricebook2,
  PricebookEntry, OpportunityHistory, ActivityTimeline, Task, Event, CampaignMember,
  sales process, pipeline management, close plan, CPQ handoff, deal qualification,
  MEDDICC, win/loss analysis, stage-gating, opportunity splits, partner opportunity
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: sales
  module: opportunity-to-close
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Sales Cloud — Opportunity to Close

This skill covers the full Salesforce Sales Cloud opportunity lifecycle: qualifying and advancing deals through stages, adding products and generating quotes, managing the deal team and contact roles, and performing loss analysis and pipeline hygiene. It applies to standard Sales Cloud orgs and does not cover Revenue Cloud pricing, Collaborative Forecasting internals, or CPQ/SBQQ deep configuration.

---

## Gotchas

The following issues are the most common sources of bugs, data integrity failures, and integration breakage in opportunity management. Each is tied to real field API names and object names.

### 1. `Opportunity.ForecastCategory` is driven by `StageName` mapping, not a standalone field

`ForecastCategory` appears editable in the UI and via API, but on standard orgs its value is overwritten whenever `StageName` changes. The actual mapping lives in the `OpportunityStage` metadata (Setup → Opportunity Stages), where each stage name is assigned one of the five forecast category values. If you write `ForecastCategory` directly via Apex or the API without also updating `StageName`, the value will be reset on the next save that triggers stage evaluation. On orgs with Einstein Forecasting or custom forecast types, the behavior may differ. Always verify the `OpportunityStage` metadata before assuming `ForecastCategory` can be independently controlled.

### 2. `OpportunityLineItem` requires a `PricebookEntryId` — mismatched pricebook causes `FIELD_INTEGRITY_EXCEPTION`

You cannot add `OpportunityLineItem` records to an `Opportunity` without first setting `Opportunity.Pricebook2Id`. The `PricebookEntryId` on each line item must reference a `PricebookEntry` that belongs to the same `Pricebook2` linked on the opportunity. If you attempt to insert an `OpportunityLineItem` with a `PricebookEntryId` from a different pricebook than what is set on `Opportunity.Pricebook2Id`, the DML operation will fail with `FIELD_INTEGRITY_EXCEPTION: field integrity exception: unknown (pricebook entry is in a different pricebook than the opportunity)`. Always set `Opportunity.Pricebook2Id` before inserting line items, and confirm pricebook consistency when migrating data.

### 3. `Opportunity.CloseDate` is required and must not be defaulted to today's date

`CloseDate` is a required field on `Opportunity` and must be provided on insert. Many integration patterns default this field to `Date.today()` as a workaround, which pollutes pipeline reports with stale past-due dates and breaks forecast views that filter on future close dates. Validation rules and pipeline reports depend on `CloseDate` being a realistic, future-oriented date. Set this field deliberately based on the expected close timeline, and enforce a minimum-future-date validation rule in production orgs to prevent junk data.

### 4. `OpportunityContactRole.IsPrimary` must have exactly one `true` value per opportunity

`OpportunityContactRole` is the junction object connecting `Contact` records to `Opportunity` records. The `Contact.AccountId` does not need to match `Opportunity.AccountId` — contacts from partner or customer accounts can all be linked. However, each opportunity should have exactly one `OpportunityContactRole` where `IsPrimary = true`. Salesforce does not enforce uniqueness of `IsPrimary` at the platform level, so duplicate primary contact roles can silently exist. Data quality rules or a before-insert trigger should enforce uniqueness. Reporting on "primary contact" without this check will return unexpected results.

### 5. `Opportunity.Amount` is auto-calculated from `OpportunityLineItem` records when products are used

When an `Opportunity` has associated `OpportunityLineItem` records, the `Amount` field becomes read-only and is derived from the sum of `OpportunityLineItem.TotalPrice`. Attempting to write `Opportunity.Amount` directly via Apex or the API when line items exist will throw `FIELD_NOT_WRITEABLE`. To override `Amount` directly, you must first remove all line items (and remove the linked `Pricebook2Id`). In integrations that sync opportunity value from external systems, always check whether line items exist before attempting to write `Amount`.

### 6. `ForecastCategory` picklist values and their required stage configuration

The valid API values for `ForecastCategory` are `Omitted`, `Pipeline`, `BestCase`, `Commit`, and `Closed`. These values are assigned per stage in Setup → Opportunity Stages. When adding a new custom stage, its `ForecastCategory` must be explicitly set. If a new stage is created and the forecast category mapping is left blank or incorrectly set, opportunities in that stage will not roll up correctly into forecast summaries. This silently understates or overstates pipeline. Always audit `OpportunityStage` metadata after adding custom stages.

### 7. `OpportunityTeamMember.TeamMemberRole` must match org-specific picklist values

`TeamMemberRole` on `OpportunityTeamMember` is a restricted picklist whose values are configured in Setup → Opportunity Team Roles. These values are not standardized across orgs — each org defines its own list. Inserting an `OpportunityTeamMember` with a `TeamMemberRole` value not in the org's picklist will throw `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`. When scripting team member creation across orgs (e.g., sandbox refresh, integration), always query the org's `OpportunityTeamMember` describe to get valid role values rather than hardcoding them.

### 8. Standard `Quote` vs. CPQ `SBQQ__Quote__c` are different objects — only one `Quote` can sync at a time

Standard Quotes (the `Quote` object) must be enabled in org Setup and are distinct from Salesforce CPQ quotes (`SBQQ__Quote__c`). Standard Quote sync to `Opportunity.Amount` is controlled by `Quote.IsSyncing = true` — when syncing, changes to `QuoteLineItem` records flow back to `OpportunityLineItem` and update `Opportunity.Amount`. Only one `Quote` per opportunity can have `IsSyncing = true` at a time; setting a second quote to sync automatically unsyncs the first. When implementing CPQ, `SBQQ__Quote__c` is used instead and has its own sync mechanism (`SBQQ__Primary__c`). Mixing standard Quote and CPQ Quote workflows on the same opportunity causes reconciliation conflicts.

### 9. `Opportunity.StageName` transitions are not platform-enforced by default

The Salesforce platform does not prevent a stage jump from `Prospecting` directly to `Closed Won`. Without explicit validation rules, Apex triggers, or Path configuration with entry criteria, reps can bypass all intermediate stages. This breaks stage velocity reporting and makes `OpportunityHistory` records unreliable for funnel analysis. Always implement stage-entry criteria: either a validation rule that checks required fields are populated before the stage can advance, or a Path component with entry criteria per stage. Document the enforcement mechanism so it is not inadvertently bypassed during data loads.

### 10. `Opportunity.CampaignId` is the primary campaign source — multi-touch requires `CampaignInfluence`

`Opportunity.CampaignId` holds a single campaign reference (the primary campaign source). This field is populated by the last `CampaignMember` touch or manually by the rep. It does not represent all campaigns that influenced the deal. For multi-touch attribution, Salesforce uses `CampaignInfluence` records (a separate object linking `Campaign`, `Opportunity`, and `Contact`). Using `CampaignId` alone for attribution analytics will systematically undercount campaign impact. Do not attempt to overload `CampaignId` with a most-recent or most-influential campaign via automation — use `CampaignInfluence` for attribution and leave `CampaignId` as-is.

### 11. `OpportunityHistory` is read-only and auto-generated — never attempt DML on it

`OpportunityHistory` is a child object of `Opportunity` that automatically records a new row whenever `StageName`, `Amount`, `Probability`, `ForecastCategory`, or `CloseDate` is changed. It stores the previous value, the new value, and a `CreatedDate` timestamp. This object is entirely system-managed: you cannot insert, update, or delete `OpportunityHistory` records via Apex or the API. Attempts to do so will throw a `DML_OPERATION_NOT_ALLOWED` error. `OpportunityHistory` is the canonical audit trail for stage progression and deal value changes; use it for velocity analysis and audit reports rather than building custom history tracking.

### 12. `Opportunity.Probability` is auto-set from the stage's default probability and will be overwritten

Each `OpportunityStage` has a default `Probability` percentage. When `StageName` changes, Salesforce automatically sets `Opportunity.Probability` to the stage's default value, overwriting any manual edit. If your process requires deal-specific probability overrides (e.g., a rep's subjective confidence score), add a custom field such as `OverrideProbability__c` and use that in reports and forecasting logic. Editing the standard `Probability` field is safe only if you also disable the automatic probability update in org settings (Setup → Forecast Settings → Allow overriding of probability), and even then this behavior is not consistent across all Salesforce releases.

### 13. `OpportunityLineItem.TotalPrice` is calculated — do not set it directly alongside `Quantity` and `UnitPrice`

`OpportunityLineItem.TotalPrice` equals `Quantity × UnitPrice`, adjusted by the `Discount` percentage field. If `Quantity` and `UnitPrice` are both present on an insert or update, `TotalPrice` is computed by the platform and cannot be set directly — attempting to do so will throw a field conflict error. The `Discount` field is a percentage value (e.g., `10` for 10%) that reduces `UnitPrice`. For multi-year or subscription deals, use `OpportunityLineItemSchedule` to spread revenue across periods. When importing line items via Bulk API, always provide `Quantity` and `UnitPrice` and omit `TotalPrice`.

### 14. `Opportunity.Type` must be set for accurate pipeline segmentation and forecast type mapping

The `Type` field on `Opportunity` has standard picklist values including `Existing Business` and `New Business`. Many orgs leave this field blank, which breaks forecast category breakdowns by opportunity type in Einstein Analytics and custom forecast dashboards. Segment reporting by `Type` requires that the field is populated on every deal. Implement a required-field validation rule or a default value formula on `Type` to enforce population at opportunity creation. For orgs using Einstein Forecasting, the `Type` field feeds into forecast type segmentation; blank values aggregate into an "undefined" bucket that skews pipeline views.

---

## Routing Table

Use the following table to match the user's intent to the most relevant reference file.

| Intent Category | Description | Reference File |
|---|---|---|
| **Object model and field reference** | User asks about Opportunity fields, related objects, API names, picklist values, or the data model | `references/01-architecture.md` |
| **Setup, permissions, and configuration** | User asks about enabling features, configuring stages, permission sets, sharing rules, or Path setup | `references/02-setup-and-permissions.md` |
| **Stage management and deal lifecycle** | User asks about advancing stages, close plans, win/loss capture, stage-entry criteria, or OpportunityHistory | `references/03-opportunity-lifecycle.md` |
| **Products, pricing, and quotes** | User asks about adding products, pricebooks, OpportunityLineItems, Quote sync, or CPQ handoff | `references/04-products-quotes-and-pricing.md` |
| **Reporting, analytics, and integrations** | User asks about pipeline reports, forecast rollups, CampaignInfluence, Bulk API imports, or external CRM sync | `references/05-reporting-and-integrations.md` |

---

## Workflows

### Workflow 1: Qualify and Stage a New Opportunity Through to Closed Won

**Goal:** Create a fully-qualified Opportunity record and advance it through stages to Closed Won with all required fields populated at each gate.

**Steps:**

1. **Create the Opportunity** — Set `AccountId`, `Name`, `CloseDate` (future date), `StageName` = `Prospecting`, `Type` (`New Business` or `Existing Business`), and `OwnerId`. Set `CampaignId` if there is a known campaign source.

2. **Add OpportunityContactRoles** — Insert `OpportunityContactRole` records linking relevant `Contact` Ids to the opportunity. Set `Role` (e.g., `Decision Maker`, `Economic Buyer`, `Champion`) and ensure exactly one record has `IsPrimary = true`. Verify that contact roles cover at least the economic buyer and technical evaluator for MEDDICC compliance.

3. **Add OpportunityTeamMembers** — Insert `OpportunityTeamMember` records for overlay reps, SEs, or partners. Use `TeamMemberRole` values that exist in the org's picklist. Set `OpportunityAccessLevel` to `Edit` or `Read` as appropriate.

4. **Qualify the opportunity** — Before advancing `StageName` to `Qualification`, confirm qualification criteria fields are populated. Common examples: `LeadSource`, `Description`, a custom `MEDDICC_Score__c` or `Qualification_Notes__c`. Apply a validation rule that blocks stage advance if these fields are blank.

5. **Advance through intermediate stages** — For each subsequent stage (`Needs Analysis`, `Value Proposition`, `Id. Decision Makers`, `Perception Analysis`, `Proposal/Price Quote`, `Negotiation/Review`), verify stage-entry criteria: required fields populated, mandatory activities logged as `Task` or `Event` records with `WhatId` = the opportunity Id.

6. **Generate a quote** — See Workflow 2. Sync the approved `Quote` to the opportunity so `Opportunity.Amount` reflects the final negotiated value.

7. **Close Won** — Set `StageName` = `Closed Won`. Populate `CloseDate` to the actual close date. Complete win capture: fill in custom win-reason fields (e.g., `Win_Reason__c`, `Competitor__c`). The `ForecastCategory` will auto-set to `Closed`.

8. **Post-close hygiene** — Confirm `OpportunityHistory` has recorded all stage transitions. Log a closed `Task` as the final close activity. Trigger any post-close automation (e.g., onboarding flow, renewal opportunity creation).

---

### Workflow 2: Add Products and Generate a Quote

**Goal:** Link products to an Opportunity via OpportunityLineItems and generate a synced Quote for customer delivery.

**Steps:**

1. **Set the Pricebook** — Update `Opportunity.Pricebook2Id` to the Id of the applicable `Pricebook2`. If the org uses only the Standard Pricebook, query `Pricebook2` where `IsStandard = true` to get its Id. Do not hardcode Pricebook Ids — they differ across orgs and sandboxes.

2. **Identify PricebookEntries** — Query `PricebookEntry` where `Pricebook2Id` = the selected pricebook and `Product2Id` = the products being added. Confirm `IsActive = true` on both the `PricebookEntry` and the `Product2` record.

3. **Insert OpportunityLineItems** — For each product, insert an `OpportunityLineItem` with `OpportunityId`, `PricebookEntryId`, `Quantity`, and `UnitPrice`. Do not set `TotalPrice`. Optionally set `Discount` (percentage) and `ServiceDate`. After insert, `Opportunity.Amount` becomes read-only and auto-calculated.

4. **Optionally add schedules** — For multi-year or recurring revenue deals, insert `OpportunityLineItemSchedule` records per line item to distribute revenue across periods. Set `Type` (`Revenue` or `Quantity`), `ScheduleDate`, and `Revenue` or `Quantity` per schedule row.

5. **Create a Quote** — Insert a `Quote` record with `OpportunityId`, `Name`, `ExpirationDate`, and `Pricebook2Id` matching the opportunity. The `Quote` object must be enabled in org Setup.

6. **Add QuoteLineItems** — Insert `QuoteLineItem` records mirroring the `OpportunityLineItem` structure (same `PricebookEntryId`, `Quantity`, `UnitPrice`). Alternatively, use the standard UI flow which auto-populates `QuoteLineItem` from `OpportunityLineItem`.

7. **Sync the Quote** — Set `Quote.IsSyncing = true` on the approved quote. This syncs `QuoteLineItem` changes back to `OpportunityLineItem` and updates `Opportunity.Amount`. Only one quote can sync at a time. Unsyncing a quote (`IsSyncing = false`) freezes the opportunity value at the last synced state.

8. **Generate the Quote PDF** — Use the `QuoteDocument` object or the standard PDF generation action to create a PDF. Attach via `ContentDocumentLink` or email via `QuoteEmailTemplate`.

9. **CPQ handoff** — If the org uses Salesforce CPQ (`SBQQ__Quote__c`), do not use the standard `Quote` object. Instead, create `SBQQ__Quote__c` with `SBQQ__Opportunity2__c` = the opportunity Id. Set `SBQQ__Primary__c = true` on the approved CPQ quote to sync pricing back to the opportunity.

---

### Workflow 3: Opportunity Loss Analysis and Pipeline Hygiene

**Goal:** Capture loss reasons on Closed Lost opportunities and identify stale or at-risk pipeline records for remediation.

**Steps:**

1. **Capture loss reason at close** — When `StageName` is set to `Closed Lost`, a validation rule or required-on-close flow should enforce population of `CloseDate` (set to actual loss date) and custom fields such as `Loss_Reason__c` (picklist: `Price`, `Competition`, `No Decision`, `Timing`, `Product Gap`, `Relationship`) and `Competitor__c`. These fields feed win/loss analysis dashboards.

2. **Query OpportunityHistory for stage velocity** — Run a SOQL query against `OpportunityHistory` grouping by `StageName` and calculating average days between stage transitions using `CreatedDate` differences. This reveals where deals stall most frequently. Example fields: `OpportunityId`, `StageName`, `Amount`, `Probability`, `ForecastCategory`, `CloseDate`, `CreatedDate`.

3. **Identify stale pipeline** — Query `Opportunity` where `IsClosed = false` and `CloseDate < TODAY` (past-due close dates) or `LastActivityDate < LAST_N_DAYS:30` (no recent activity). Flag these for rep follow-up. Stale pipeline inflates forecast numbers and must be rescheduled or closed lost.

4. **Identify stage-stuck deals** — Use `OpportunityHistory` to find opportunities that have been in the same stage for more than a configurable threshold (e.g., 30 days for Qualification, 60 days for Proposal). Alert the opportunity owner via a scheduled flow or report subscription.

5. **Remove duplicate opportunities** — Use `OpportunityMatchingRule` and `OpportunityDuplicateRule` to surface duplicates. Review matched pairs before merging. Salesforce allows merging up to 3 `Opportunity` records; the master record retains its `Id` and the merged records are deleted (child records are reparented).

6. **Archive or close no-decision deals** — For opportunities where the prospect has gone dark, use a standardised `StageName` = `Closed Lost` with `Loss_Reason__c` = `No Decision`. Do not leave open opportunities with past close dates indefinitely. Run a quarterly pipeline scrub report and have reps confirm or close each record.

7. **Rebuild attribution data** — After pipeline hygiene, re-run CampaignInfluence calculations if your org uses automatic campaign influence models. Check that `Opportunity.CampaignId` is populated on all newly-closed deals that originated from a campaign.

---

## Not Covered by This Skill

The following topics are out of scope and handled by dedicated skills:

- **Revenue Cloud pricing engine** — complex pricing, waterfall discounting, pricing procedures: use `sales-revenue-cloud`
- **Collaborative Forecasting object model** — ForecastingQuota, ForecastingItem, AdjustmentForecastingItem: use `sales-forecasting`
- **Territory assignment** — Territory2, UserTerritory2Association, account territory rules: use `sales-territory-management`
- **Service Cloud Cases** — Case, CaseComment, Entitlement, WorkOrder: these are Service Cloud objects outside this skill's domain
- **CPQ/SBQQ deep configuration** — SBQQ product rules, price rules, configuration attributes, bundle setup: out of scope for this skill
