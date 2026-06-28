---
name: sales-forecasting
description: >-
  ForecastingItem, ForecastingOwnerAdjustment, ForecastingManagerAdjustment,
  ForecastingSubmission, ForecastingQuota, ForecastingType, ForecastingDisplayedFamily,
  CollaborativeForecasting, forecast hierarchy, role hierarchy, territory forecast,
  overlay splits, product family forecast, custom forecast type, opportunity override,
  forecast category, BestCase, Commit, Pipeline, quota attainment, forecast period,
  monthly quarterly forecast, manager adjustment, cumulative forecast rollup
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: sales
  module: forecasting
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# sales-forecasting

Salesforce Collaborative Forecasting skill covering ForecastingType configuration, ForecastingItem rollup mechanics, owner and manager adjustments, quota management, overlay splits, product family forecasts, territory-based forecasts, and SOQL reporting patterns.

---

## Gotchas

### 1. `ForecastingItem` is read-only — never try to insert or update it

The platform auto-generates `ForecastingItem` records from `Opportunity` data based on `ForecastingType` configuration. Attempts to DML `ForecastingItem` throw `INSUFFICIENT_ACCESS_OR_READONLY`. Use the Forecasting API or standard UI to work with forecast data. If you need to influence `ForecastingItem` values, do so by modifying the underlying `Opportunity` fields (`Amount`, `CloseDate`, `ForecastCategoryName`) or by creating `ForecastingOwnerAdjustment` / `ForecastingManagerAdjustment` records.

### 2. `ForecastingType` determines what rolls up — one type per forecast measure

You can have multiple active `ForecastingType` records (e.g. Revenue, Quantity, Product Family, Overlay). Each type generates its own `ForecastingItem` tree. Enabling a new type is NOT retroactive — historical opportunities are not re-rolled until data refresh. When querying `ForecastingItem`, always filter by `ForecastingTypeId` to avoid mixing amounts across incompatible measures.

### 3. Forecast hierarchy defaults to Role Hierarchy — Territory Forecasting is a separate setting

`ForecastingType.ForecastingHierarchyType` can be `RoleTerritory2` (territory-based) or `Role` (role-based). Mixing territory forecasts and role forecasts in the same org requires separate `ForecastingType` records. Territory forecasting requires Enterprise Territory Management to be enabled. A user must be assigned to a `Territory2` record to appear in a territory forecast hierarchy.

### 4. `ForecastingOwnerAdjustment` and `ForecastingManagerAdjustment` are different objects

Owner adjustments are made by the opportunity owner on their own forecast; manager adjustments are made by managers on their direct reports' forecasts. Both are separate objects with separate DML if you build integrations. `ForecastingOwnerAdjustment.IsAmount` controls whether the adjustment is an absolute value or a delta. Never confuse the two — a manager cannot create a `ForecastingOwnerAdjustment` on behalf of a report; they must use `ForecastingManagerAdjustment`.

### 5. `ForecastingQuota` is not linked to `ForecastingItem` by a lookup — it is matched by `StartDate`, `ForecastingType`, and `QuotaOwnerId`

Quota attainment is a calculated value (quota vs actual), not a stored field on `ForecastingItem`. Report quota attainment by joining `ForecastingQuota` to `ForecastingItem` on `StartDate`, `ForecastingTypeId`, and owner ID fields in custom reports or SOQL. There is no `ForecastingItemId` field on `ForecastingQuota`.

### 6. Overlay splits require `OpportunitySplit` object to be enabled

`OpportunitySplit` (with `SplitType` = Overlay) allows credit allocation to overlay reps. The `OpportunitySplit.SplitPercentage` must sum to 100 for revenue splits; overlay splits are additive and do not need to sum to 100. Enable in Setup → Opportunity Splits. An overlay `ForecastingType` must then be configured to roll up the overlay split amounts. Without both setup steps, overlay reps will not see any forecast data.

### 7. `ForecastingSubmission` locks a snapshot — it is not a real-time sync

When a forecast is submitted (`ForecastingSubmission` created), it captures a point-in-time snapshot. Subsequent opportunity changes do not update the submitted forecast; only adjustments after submission reflect new data. `ForecastingSubmission` records are queryable via SOQL and contain `SubmittedDate`, `SubmittedById`, and `ForecastingTypeId`. Do not mistake a submitted forecast for a live forecast when building dashboards — query `ForecastingItem` directly for live data.

### 8. Product Family forecast type uses `Product2.Family` picklist

Enabling a Product Family `ForecastingType` rolls up `OpportunityLineItem` amounts grouped by `Product2.Family`. Opportunities without products (no `OpportunityLineItem` records) do not appear in product family forecasts at all — they are silently excluded. Opportunities with `OpportunityLineItem` records across multiple families split across multiple `ForecastingItem` rows, one per family. Ensure all products have a `Family` value populated or they will fall into a blank-family bucket.

### 9. Custom forecast types can use custom currency or number fields on `Opportunity`

`ForecastingType` can be configured to roll up a custom `Amount__c` or `WeightedAmount__c` field rather than the standard `Amount`. This requires the custom field to be present on `Opportunity` and configured in the ForecastingType's `ForecastedAmountFieldApiName`. The field must be a `Currency` or `Number` type. Rollup recalculation happens asynchronously after the ForecastingType is saved — allow up to 24 hours for historical data to propagate.

### 10. Forecast period configuration (Monthly vs Quarterly) affects `ForecastingItem.StartDate` granularity

Period configuration is set per `ForecastingType`. Switching a live forecast type from Monthly to Quarterly deletes monthly `ForecastingItem` records and regenerates quarterly ones. This operation is not reversible without data loss. Any existing `ForecastingOwnerAdjustment` and `ForecastingManagerAdjustment` records tied to monthly periods are also deleted when the period granularity changes. Always communicate this destructive consequence before reconfiguring period settings.

### 11. `ForecastingItem.ForecastAmount` vs `ForecastingItem.AdjustedAmount` vs `ForecastingItem.OwnerOnlyAmount`

- `ForecastAmount`: includes all adjustments and full rollup from subordinates in the hierarchy. This is what the manager sees for their total forecast.
- `OwnerOnlyAmount`: only the direct-owner's own opportunities, no subordinate rollup. Use this for individual rep analysis.
- `AdjustedAmount`: reflects manager adjustments applied on top of the rolled-up amount.

**Never aggregate `ForecastAmount` across the hierarchy** — you will double-count because parent rows already include all children. When summing across reps, use `OwnerOnlyAmount` filtered to leaf nodes in the hierarchy.

### 12. Cumulative forecast view sums across periods — standard view does not

`ForecastingDisplayedFamily` and the cumulative toggle change how the UI displays data but do not change underlying `ForecastingItem` values. Reporting on cumulative forecast requires summing across multiple `ForecastingItem.StartDate` values in SOQL — there is no single field storing a YTD or QTD cumulative amount. In reports, use a summary formula or a custom report type with a date range filter to replicate cumulative behavior.

---

## Reference Files

| File | Contents |
|------|----------|
| [01-architecture.md](references/01-architecture.md) | Object model diagram, key field tables for ForecastingItem and ForecastingType, relationship map |
| [02-setup-and-permissions.md](references/02-setup-and-permissions.md) | Enabling Collaborative Forecasting, ForecastingType setup, period config, hierarchy settings, permission sets, quota upload, OpportunitySplit enablement |
| [03-forecast-hierarchy-and-rollup.md](references/03-forecast-hierarchy-and-rollup.md) | Role hierarchy rollup mechanics, territory forecast setup, ForecastingItem generation from Opportunity, rollup chain, adjustment chain, submission snapshot, recalculation triggers |
| [04-adjustments-and-quotas.md](references/04-adjustments-and-quotas.md) | ForecastingOwnerAdjustment fields, ForecastingManagerAdjustment fields, override vs adjustment, quota CSV format, quota attainment SOQL, period vs YTD quota, custom report types |
| [05-custom-types-and-reporting.md](references/05-custom-types-and-reporting.md) | Custom ForecastingType with custom Amount field, product family forecast, overlay split type, multi-currency, SOQL patterns, API access, known reporting limitations |

---

## Workflows

### Workflow 1: Enable and Configure a New ForecastingType

**Goal:** Activate a new forecast measure (e.g. a custom Revenue Type rolling up `CustomRevenue__c`) without disrupting existing active forecast types.

**Steps:**

1. **Prerequisites check**
   - Confirm Collaborative Forecasting is enabled: Setup → Forecast Settings → "Enable Forecasts" checked.
   - Confirm the custom field `CustomRevenue__c` exists on `Opportunity` and is Currency type.
   - Confirm users who will see the forecast are assigned the `ForecastingUser` permission set or equivalent.

2. **Create the ForecastingType**
   - Setup → Forecast Settings → Forecast Types → New.
   - Set `ForecastingHierarchyType`: `Role` (role hierarchy) or `RoleTerritory2` (territory hierarchy).
   - Set `ForecastedAmountFieldApiName` to `CustomRevenue__c`.
   - Set period granularity (Monthly or Quarterly). **This cannot be changed later without data loss.**
   - Set forecast categories to expose (Pipeline, BestCase, Commit, Closed, or custom).
   - Save and activate.

3. **Wait for rollup recalculation**
   - Initial rollup is asynchronous. Monitor Setup → Forecast Settings → Forecast Types for "Recalculating" status.
   - Allow up to 24 hours for all `ForecastingItem` records to be generated for historical opportunities.

4. **Validate in the Forecasting tab**
   - Log in as a forecast user. Navigate to the Forecasts tab.
   - Select the new ForecastingType from the type selector.
   - Confirm amounts appear for open opportunities with `CustomRevenue__c` populated.

5. **Assign quotas**
   - Upload a quota CSV with `StartDate`, `QuotaAmount`, `QuotaOwnerId`, and `ForecastingTypeId`.
   - See [04-adjustments-and-quotas.md](references/04-adjustments-and-quotas.md) for the exact CSV format.

6. **Communicate to the sales team**
   - Notify managers that they must re-enter any manager adjustments — no adjustments exist yet for the new type.
   - Confirm that the new type appears in their Forecasts tab.

---

### Workflow 2: Manager Submits and Adjusts a Forecast

**Goal:** A sales manager reviews their team's forecast for a period, makes adjustments on individual reps, then submits a snapshot.

**Steps:**

1. **Manager opens the Forecasts tab**
   - Navigate to Forecasts → select the active `ForecastingType` (e.g. Revenue) → select the period (e.g. Q3 FY2026).
   - The manager sees their own `ForecastingItem` row and one row per direct report.

2. **Review individual rep amounts**
   - For each direct report, the manager sees:
     - `ForecastAmount`: rep's total including their own subordinates.
     - `OwnerOnlyAmount`: the rep's own direct deals.
   - Click into a rep's row to see underlying opportunities contributing to each forecast category.

3. **Make a manager adjustment**
   - Click the pencil icon next to a rep's Commit or BestCase amount.
   - Enter the adjusted amount. This creates a `ForecastingManagerAdjustment` record with fields `AdjustedAmount`, `OldAmount`, `ForecastingItemId`, `IsAmount` (true = absolute, false = delta), and `PeriodId`.
   - Adjustments do not alter the underlying `ForecastingItem.ForecastAmount`; they are layered on top.

4. **Submit the forecast**
   - Click "Submit" on the Forecasts tab. This creates a `ForecastingSubmission` record.
   - The submission is a point-in-time snapshot. Subsequent opportunity changes will NOT update this submission.
   - Query the submission:
     ```soql
     SELECT Id, SubmittedDate, SubmittedById, ForecastingTypeId
     FROM ForecastingSubmission
     WHERE SubmittedById = :userId
     ORDER BY SubmittedDate DESC
     ```

5. **Post-submission corrections**
   - If an opportunity closes after submission, the live `ForecastingItem` updates but the submission snapshot does not.
   - The manager can create new `ForecastingManagerAdjustment` records after submission to correct the live forecast.
   - A new submission can be created at any time to capture the latest snapshot.

---

### Workflow 3: Quota Upload and Attainment Reporting

**Goal:** Upload monthly or quarterly quotas for all forecast users, then build a SOQL-based attainment report.

**Steps:**

1. **Prepare the quota CSV**
   - Required columns: `QuotaOwnerId` (User ID), `StartDate` (first day of the period, e.g. `2026-07-01`), `QuotaAmount` (numeric), `ForecastingTypeId`.
   - Optional: `CurrencyIsoCode` (required if multi-currency is enabled).
   - One row per user per period per ForecastingType.

2. **Upload via Data Loader or Data Import Wizard**
   - Object: `ForecastingQuota`.
   - Map CSV columns to fields. `QuotaOwnerId` maps to the `QuotaOwnerId` lookup field.
   - Run the import. Use upsert with `Id` as the external key when updating existing quotas.

3. **Verify quota upload**
   ```soql
   SELECT QuotaOwnerId, StartDate, QuotaAmount, ForecastingTypeId
   FROM ForecastingQuota
   WHERE StartDate = 2026-07-01
   ```
   Confirm row counts match the number of forecast users for that period.

4. **Build attainment in Apex (SOQL join pattern)**
   ```apex
   // Step 1: query closed ForecastingItem amounts by owner and period
   Map<String, Decimal> closedAmountByKey = new Map<String, Decimal>();
   for (ForecastingItem fi : [
       SELECT OwnerId, StartDate, OwnerOnlyAmount
       FROM ForecastingItem
       WHERE ForecastingTypeId = :forecastingTypeId
         AND StartDate >= :periodStart
         AND ForecastCategoryName = 'Closed'
   ]) {
       String key = fi.OwnerId + '_' + String.valueOf(fi.StartDate);
       closedAmountByKey.put(key, fi.OwnerOnlyAmount);
   }

   // Step 2: query quotas and calculate attainment
   for (ForecastingQuota fq : [
       SELECT QuotaOwnerId, StartDate, QuotaAmount
       FROM ForecastingQuota
       WHERE ForecastingTypeId = :forecastingTypeId
         AND StartDate >= :periodStart
   ]) {
       String key = fq.QuotaOwnerId + '_' + String.valueOf(fq.StartDate);
       Decimal closed = closedAmountByKey.get(key) != null ? closedAmountByKey.get(key) : 0;
       Decimal attainment = fq.QuotaAmount > 0 ? (closed / fq.QuotaAmount * 100) : 0;
       // use attainment value in your reporting output
   }
   ```

5. **Build the custom report type (UI)**
   - Setup → Report Types → New Custom Report Type.
   - Primary object: `ForecastingItem`.
   - Expose `OwnerOnlyAmount`, `ForecastCategoryName`, `StartDate`, `OwnerId` fields.
   - Use a joined report or summary formula to surface quota data alongside actuals.
   - See [05-custom-types-and-reporting.md](references/05-custom-types-and-reporting.md) for the recommended pattern.

---

## Not Covered by This Skill

The following topics are out of scope. Use the indicated skill instead:

- **Territory Management setup** (creating Territory2 models, assigning users and accounts to territories): use `sales-territory-management`
- **Opportunity lifecycle and stage management** (stage progression, close date, forecast category field on Opportunity): use `sales-opportunity-to-close`
- **Einstein Forecasting AI** (AI-generated forecast predictions, prediction factors): this is a separate product feature not covered here
- **Revenue Cloud forecasting** (contract-based revenue recognition, revenue schedules): this is a separate product not covered here
