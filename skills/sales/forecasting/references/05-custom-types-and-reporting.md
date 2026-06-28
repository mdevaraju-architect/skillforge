# 05 — Custom Types and Reporting

## Custom ForecastingType with a Custom Amount Field

### Use Case

Standard Revenue forecasting rolls up `Opportunity.Amount`. If your org uses a custom currency field — for example `WeightedRevenue__c`, `ServiceRevenue__c`, or `ARR__c` — you can create a `ForecastingType` that rolls up that field instead.

### Field Requirements

The custom field must:
- Be on the `Opportunity` object.
- Be of type `Currency` or `Number`.
- Be accessible to the running user (field-level security applies).

### Configuration Steps

1. Create the custom field on `Opportunity` (e.g. `ServiceRevenue__c`, Currency).
2. Setup → Forecast Settings → Forecast Types → New.
3. In the **Forecast Measure** dropdown, select **Custom**.
4. In **Custom Field**, select `ServiceRevenue__c` from the picklist of eligible opportunity fields.
5. Set hierarchy type, period type, and active categories as usual.
6. Save and activate.

### Behind the Scenes

The ForecastingType stores the field reference in `ForecastedAmountFieldApiName`. When the rollup engine processes opportunities, it reads this field instead of `Amount`. If `ServiceRevenue__c` is null on an opportunity, that opportunity contributes $0 to the forecast.

### Recalculation Note

After enabling the custom type, the platform queues a full historical recalculation. This is asynchronous and can take up to 24 hours for large orgs. During recalculation, `ForecastingItem` rows may be incomplete or show $0. Monitor the recalculation status in Setup → Forecast Settings → Forecast Types.

---

## Product Family Forecast Configuration

### How It Works

A Product Family `ForecastingType` generates `ForecastingItem` rows grouped by `Product2.Family`. Instead of one row per user × period × category, there is one row per user × period × category × product family.

The rollup source is `OpportunityLineItem.TotalPrice` (or `UnitPrice × Quantity`), grouped by the `Product2.Family` of the related `Product2` record.

### Configuration

1. Ensure **Products** are enabled (Setup → Products Settings → Enable Products).
2. Populate `Product2.Family` picklist values (Setup → Object Manager → Product2 → Fields → Family).
3. Setup → Forecast Settings → Forecast Types → New.
4. Set **Forecast Type** = Product Family.
5. Select which `Product2.Family` values to display (via `ForecastingDisplayedFamily` records — see below).
6. Save and activate.

### ForecastingDisplayedFamily

`ForecastingDisplayedFamily` controls which product families appear as columns in the Forecasts tab for a given `ForecastingType`. This is a child object of `ForecastingType`.

```soql
SELECT Id, FamilyName, ForecastingTypeId, IsDisplayed
FROM ForecastingDisplayedFamily
WHERE ForecastingTypeId = :productFamilyTypeId
```

To show or hide a product family column, update `IsDisplayed` on the `ForecastingDisplayedFamily` record.

### Key Constraints

| Constraint | Detail |
|---|---|
| Opportunities without OLIs | Excluded entirely — do not appear in product family forecast |
| OLIs with null Product2.Family | Roll into a blank-family row (displayed as blank or "(None)") |
| Multi-family opportunities | Produce one `ForecastingItem` row per family — amounts split by OLI allocation |
| OLI quantity only | Quantity forecast type + product family uses OLI quantity, not revenue |

### Querying Product Family ForecastingItem

```soql
SELECT OwnerId, StartDate, ForecastCategoryName, ProductFamily, OwnerOnlyAmount, ForecastAmount
FROM ForecastingItem
WHERE ForecastingTypeId = :productFamilyTypeId
  AND StartDate = :periodStart
  AND ForecastCategoryName = 'Commit'
ORDER BY OwnerId, ProductFamily
```

Note the `ProductFamily` field on `ForecastingItem` — this is populated only for product family forecast types.

---

## Overlay Split Forecast Type

### Overview

Overlay reps (solution engineers, specialists, overlay sellers) receive partial credit for deals they support but do not own. Overlay splits enable these reps to have their own `ForecastingItem` rows reflecting their credited share.

### Architecture

```
Opportunity (owned by Rep A, Amount = $100K)
    └── OpportunitySplit [Revenue]  Rep A = 100%  → $100K credited to Rep A
    └── OpportunitySplit [Overlay]  Rep B = 50%   → $50K credited to Rep B (overlay)
                                    Rep C = 75%   → $75K credited to Rep C (overlay)
                                    (overlay percents are additive — do not need to sum to 100%)

Revenue ForecastingType:
    Rep A ForecastingItem.OwnerOnlyAmount = $100K

Overlay ForecastingType:
    Rep B ForecastingItem.OwnerOnlyAmount = $50K
    Rep C ForecastingItem.OwnerOnlyAmount = $75K
```

### Setup Recap

1. Enable Opportunity Splits.
2. Create an `OpportunitySplitType` with `IsTotalValidated = false` (overlay).
3. Create a `ForecastingType` linked to the overlay split type.
4. Overlay reps add `OpportunitySplit` records to each opportunity they support.
5. Platform rolls up `SplitAmount` values into overlay `ForecastingItem` rows.

### SOQL for Overlay Split Amounts

```soql
SELECT SplitOwnerId, SplitPercentage, SplitAmount, OpportunityId, Opportunity.Name,
       Opportunity.CloseDate, Opportunity.ForecastCategoryName
FROM OpportunitySplit
WHERE SplitType.DeveloperName = 'Overlay'
  AND Opportunity.CloseDate >= :startDate
  AND Opportunity.CloseDate <= :endDate
ORDER BY SplitOwnerId
```

---

## Multi-Currency Forecasting

### Behavior

In multi-currency orgs, `ForecastingItem.ForecastAmount` is stored in the org's corporate currency. The conversion from each opportunity's currency uses the exchange rate active at the time the rollup runs (not the opportunity's close date rate, unless dated exchange rates are enabled).

### Advanced Currency Management (ACM)

If Advanced Currency Management (dated exchange rates) is enabled:
- Exchange rates are sourced from the dated rate table based on the opportunity's `CloseDate`.
- `ForecastingItem` amounts reflect the rate applicable at the opportunity's close date.
- Changing an opportunity's `CloseDate` can alter forecast amounts because it moves to a different exchange rate.

### Quota Currency Alignment

`ForecastingQuota.CurrencyIsoCode` should match the quota owner's currency setting. If the owner's currency differs from corporate currency, set `CurrencyIsoCode` on `ForecastingQuota` records explicitly. Quota attainment calculations must account for currency conversion when comparing `ForecastingQuota.QuotaAmount` to `ForecastingItem.OwnerOnlyAmount` (which is always stored in corporate currency).

---

## SOQL Patterns for Forecast Reporting

### Pattern 1: All Active Reps' Commit Amounts for Current Quarter

```soql
SELECT OwnerId, Owner.Name, ForecastCategoryName, OwnerOnlyAmount, ForecastAmount
FROM ForecastingItem
WHERE ForecastingTypeId = :revenueTypeId
  AND StartDate = :quarterStart          -- first day of the quarter, e.g. 2026-07-01
  AND ForecastCategoryName IN ('Commit', 'BestCase', 'Closed')
  AND PeriodType = 'Quarter'
ORDER BY Owner.Name, ForecastCategoryName
```

### Pattern 2: Manager's Full Team Rollup — One Row Per Direct Report

```soql
SELECT OwnerId, Owner.Name, ForecastCategoryName, OwnerOnlyAmount
FROM ForecastingItem
WHERE ForecastingTypeId = :revenueTypeId
  AND StartDate = :quarterStart
  AND OwnerId IN (
      SELECT Id FROM User
      WHERE UserRole.ParentRoleId = :managerRoleId
        AND IsActive = true
  )
  AND ForecastCategoryName = 'Commit'
```

### Pattern 3: Quarterly Trend — All Periods in FY2026

```soql
SELECT OwnerId, StartDate, ForecastCategoryName, OwnerOnlyAmount
FROM ForecastingItem
WHERE ForecastingTypeId = :revenueTypeId
  AND StartDate >= 2026-02-01             -- FY2026 Q1 start
  AND StartDate <= 2027-01-31             -- FY2026 Q4 end
  AND ForecastCategoryName = 'Closed'
  AND PeriodType = 'Quarter'
ORDER BY OwnerId, StartDate
```

### Pattern 4: Cumulative Forecast (YTD Sum)

There is no single field for YTD. Sum across periods in SOQL:

```soql
SELECT OwnerId, SUM(OwnerOnlyAmount) ytdClosed
FROM ForecastingItem
WHERE ForecastingTypeId = :revenueTypeId
  AND ForecastCategoryName = 'Closed'
  AND StartDate >= :fiscalYearStart
  AND StartDate <= :currentPeriodStart
GROUP BY OwnerId
```

### Pattern 5: Recent Submissions for a Manager

```soql
SELECT Id, SubmittedDate, SubmittedById, ForecastingTypeId, ForecastAmount, AdjustedAmount
FROM ForecastingSubmission
WHERE SubmittedById = :managerId
  AND ForecastingTypeId = :revenueTypeId
ORDER BY SubmittedDate DESC
LIMIT 5
```

---

## API Access Patterns

### SOQL Directly on `ForecastingItem`

Available in API v29.0+. Use for reporting, dashboards, and custom analytics. `ForecastingItem` is readable but not writable via DML.

### Forecasting REST API

Salesforce provides a REST API endpoint for forecasting operations:

```
GET /services/data/vXX.0/forecasts/{forecastingTypeId}/opportunityforecasts/{periodId}/{ownerId}
```

This API returns a more complete forecast record including related opportunity detail that is harder to reconstruct from SOQL alone. Use the REST API when you need the full opportunity-level breakdown behind a forecast row.

### Forecasting Connect API (Chatter/API Composite)

For creating adjustments programmatically, use the standard DML on `ForecastingOwnerAdjustment` and `ForecastingManagerAdjustment` as shown in [04-adjustments-and-quotas.md](04-adjustments-and-quotas.md).

---

## Known Reporting Limitations

| Limitation | Workaround |
|---|---|
| `ForecastingItem` cannot be used as the primary object in a standard report type | Use the built-in Forecasting reports or build a custom report type with Forecasts as primary |
| `ForecastingItem` cannot be joined to `ForecastingQuota` in a standard report | Use joined report, formula fields on related objects, or Apex + LWC |
| No native YTD or cumulative field on `ForecastingItem` | Sum across `StartDate` ranges in SOQL |
| `ForecastAmount` double-counts when summed across hierarchy | Use `OwnerOnlyAmount` filtered to leaf nodes |
| `ForecastingSubmission` snapshot does not include opportunity detail | Query `ForecastingItem` live for current data; use submission only for historical snapshots |
| Product family forecast excludes opportunities without line items — no warning in UI | Build a separate Opportunities report filtered to `OpportunityLineItems: 0` to identify excluded deals |
| Territory forecast requires ETM to be enabled — cannot coexist with Classic Territory Management | Migrate to ETM before enabling territory forecasting |
| Changing period type (Monthly ↔ Quarterly) deletes all adjustments | Export adjustment data before any period type change |
