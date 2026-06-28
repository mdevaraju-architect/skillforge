# 04 — Adjustments and Quotas

## ForecastingOwnerAdjustment

### Purpose

`ForecastingOwnerAdjustment` allows an opportunity owner (a sales rep) to adjust their own forecast number for a given period and category. This is useful when a rep knows their pipeline is lighter or heavier than what the rolled-up `ForecastingItem` shows.

An owner adjustment says: "I know my deals sum to $X, but I'm forecasting $Y for this period."

### Fields

| Field API Name | Type | Required | Description |
|---|---|---|---|
| `ForecastingItemId` | Lookup(ForecastingItem) | Yes | The specific ForecastingItem row being adjusted (must be this user's own row) |
| `OwnerId` | Lookup(User) | Yes | Must be the same user as the ForecastingItem owner |
| `AdjustedAmount` | Currency | Yes | The adjusted forecast value |
| `OldAmount` | Currency | Read-only | Platform-populated; the amount before adjustment |
| `IsAmount` | Boolean | Yes | `true` = `AdjustedAmount` is an absolute override; `false` = delta |
| `ForecastCategoryName` | Picklist | Yes | The category column being adjusted (e.g. `Commit`, `BestCase`) |
| `ForecastingTypeId` | Lookup(ForecastingType) | Yes | Which forecast type |
| `PeriodId` | Lookup | Yes | The forecast period |
| `CurrencyIsoCode` | Picklist | Conditional | Required in multi-currency orgs |

### When to Use

- Rep believes their `Commit` amount should be $80K even though rolled-up opportunities total $95K (one deal is unlikely to close this period).
- Rep has verbal commitments not yet in Salesforce that they want to reflect.

### Creating via Apex

```apex
ForecastingOwnerAdjustment adj = new ForecastingOwnerAdjustment();
adj.ForecastingItemId = forecastItemId;       // the rep's own ForecastingItem row
adj.OwnerId = repUserId;
adj.AdjustedAmount = 80000;
adj.IsAmount = true;                          // absolute override
adj.ForecastCategoryName = 'Commit';
adj.ForecastingTypeId = forecastingTypeId;
adj.PeriodId = periodId;
insert adj;
```

### Constraints

- Only the owner of the `ForecastingItem` can create a `ForecastingOwnerAdjustment` on that row.
- A manager cannot create a `ForecastingOwnerAdjustment` on behalf of a rep; they must use `ForecastingManagerAdjustment`.
- Only one `ForecastingOwnerAdjustment` per user × period × category × type combination is allowed.
- Deleting the adjustment reverts to the underlying rollup amount.

---

## ForecastingManagerAdjustment

### Purpose

`ForecastingManagerAdjustment` allows a manager to override the forecast amount they see for a direct report. The manager's own aggregate (`ForecastAmount`) reflects the adjusted view of all their reports.

A manager adjustment says: "My rep forecasts $Y, but I'm committing $Z to my VP."

### Fields

| Field API Name | Type | Required | Description |
|---|---|---|---|
| `ForecastingItemId` | Lookup(ForecastingItem) | Yes | The direct report's ForecastingItem row being adjusted |
| `OwnerId` | Lookup(User) | Yes | The manager making the adjustment |
| `AdjustedAmount` | Currency | Yes | The manager's override value |
| `OldAmount` | Currency | Read-only | Platform-populated; the amount before manager adjustment |
| `IsAmount` | Boolean | Yes | `true` = absolute override; `false` = delta |
| `ForecastCategoryName` | Picklist | Yes | The category column being adjusted |
| `ForecastingTypeId` | Lookup(ForecastingType) | Yes | Which forecast type |
| `PeriodId` | Lookup | Yes | The forecast period |
| `CurrencyIsoCode` | Picklist | Conditional | Required in multi-currency orgs |

### When to Use

- Manager wants to reduce a rep's BestCase because they know one deal will slip.
- Manager wants to increase a rep's Commit because they have inside knowledge a deal will close.
- Manager has agreed to a number with their VP and wants to lock in their team's forecast.

### Creating via Apex

```apex
ForecastingManagerAdjustment adj = new ForecastingManagerAdjustment();
adj.ForecastingItemId = repForecastItemId;    // the rep's ForecastingItem row
adj.OwnerId = managerUserId;                  // the manager creating the adjustment
adj.AdjustedAmount = 75000;
adj.IsAmount = true;                          // absolute override
adj.ForecastCategoryName = 'Commit';
adj.ForecastingTypeId = forecastingTypeId;
adj.PeriodId = periodId;
insert adj;
```

### Constraints

- `OwnerId` must be a manager (a user with `IsForecastManager = true`) who has the `ForecastingItemId`'s owner as a direct or indirect report.
- Only one `ForecastingManagerAdjustment` per manager × report × period × category × type combination.
- A manager can only adjust rows of users who roll up under them — not peer managers' reports.

---

## Override vs Adjustment — Key Distinction

| Term | Object | Who | On What |
|---|---|---|---|
| Owner adjustment | `ForecastingOwnerAdjustment` | The rep, on their own row | Rep adjusts their own forecast |
| Manager adjustment | `ForecastingManagerAdjustment` | The manager, on a direct report's row | Manager overrides how a rep's number appears |
| Opportunity Override | `OpportunityOverride` (UI concept) | Rep, via "Include/Exclude" on Opportunity in forecast UI | Includes or excludes a specific deal from a category |

`OpportunityOverride` is a UI-level concept that effectively moves an opportunity between forecast categories within the Forecasts tab, but the underlying `Opportunity.ForecastCategoryName` is not changed. This is different from editing the opportunity's `ForecastCategoryName` field directly.

---

## ForecastingQuota — Upload CSV Format

### Minimal CSV (Single Currency Org)

```csv
QuotaOwnerId,StartDate,QuotaAmount,ForecastingTypeId
005XXXXXXXXXXXX001,2026-07-01,150000,0DbXXXXXXXXXXXX001
005XXXXXXXXXXXX002,2026-07-01,200000,0DbXXXXXXXXXXXX001
005XXXXXXXXXXXX001,2026-08-01,150000,0DbXXXXXXXXXXXX001
005XXXXXXXXXXXX002,2026-08-01,200000,0DbXXXXXXXXXXXX001
```

### Multi-Currency CSV

```csv
QuotaOwnerId,StartDate,QuotaAmount,ForecastingTypeId,CurrencyIsoCode
005XXXXXXXXXXXX001,2026-07-01,150000,0DbXXXXXXXXXXXX001,USD
005XXXXXXXXXXXX003,2026-07-01,130000,0DbXXXXXXXXXXXX001,EUR
```

### Product Family Quota CSV

When using a Product Family `ForecastingType`, include a `ProductFamily` column:

```csv
QuotaOwnerId,StartDate,QuotaAmount,ForecastingTypeId,ProductFamily
005XXXXXXXXXXXX001,2026-07-01,80000,0DbXXXXXXXXXXXX002,Hardware
005XXXXXXXXXXXX001,2026-07-01,70000,0DbXXXXXXXXXXXX002,Software
```

### StartDate Alignment

`ForecastingQuota.StartDate` must exactly match the `ForecastingItem.StartDate` for the period. Find valid period start dates:

```soql
SELECT DISTINCT StartDate
FROM ForecastingItem
WHERE ForecastingTypeId = '0DbXXXXXXXXXXXX001'
ORDER BY StartDate ASC
```

---

## Quota Attainment Calculation

There is no native `AttainmentPercent` field stored on any object. Calculate it:

```
Attainment % = (ClosedAmount / QuotaAmount) × 100
```

Where `ClosedAmount` = `ForecastingItem.OwnerOnlyAmount` filtered to `ForecastCategoryName = 'Closed'`.

### SOQL-Based Attainment (Two-Query Approach)

Salesforce SOQL does not support JOIN syntax. Use two separate queries and join in Apex or external code:

```apex
// Query 1: Get closed amounts by user and period
Map<String, Decimal> closedByKey = new Map<String, Decimal>();
for (ForecastingItem fi : [
    SELECT OwnerId, StartDate, OwnerOnlyAmount
    FROM ForecastingItem
    WHERE ForecastingTypeId = :forecastingTypeId
      AND ForecastCategoryName = 'Closed'
      AND StartDate >= :startDate
      AND StartDate <= :endDate
]) {
    closedByKey.put(fi.OwnerId + '_' + String.valueOf(fi.StartDate), fi.OwnerOnlyAmount);
}

// Query 2: Get quotas and compute attainment
List<Map<String, Object>> results = new List<Map<String, Object>>();
for (ForecastingQuota fq : [
    SELECT QuotaOwnerId, StartDate, QuotaAmount, Owner.Name
    FROM ForecastingQuota
    WHERE ForecastingTypeId = :forecastingTypeId
      AND StartDate >= :startDate
      AND StartDate <= :endDate
]) {
    String key = fq.QuotaOwnerId + '_' + String.valueOf(fq.StartDate);
    Decimal closed = closedByKey.containsKey(key) ? closedByKey.get(key) : 0;
    Decimal attainment = (fq.QuotaAmount != null && fq.QuotaAmount > 0)
        ? (closed / fq.QuotaAmount * 100).setScale(1)
        : 0;
    results.add(new Map<String, Object>{
        'ownerName'    => fq.Owner.Name,
        'period'       => String.valueOf(fq.StartDate),
        'quota'        => fq.QuotaAmount,
        'closed'       => closed,
        'attainmentPct'=> attainment
    });
}
```

---

## Period Quota vs Year-to-Date Quota

There is no native YTD quota field. Calculate YTD quota by summing `ForecastingQuota.QuotaAmount` across all periods in the fiscal year for a user:

```soql
SELECT QuotaOwnerId, SUM(QuotaAmount) totalYTDQuota
FROM ForecastingQuota
WHERE ForecastingTypeId = :forecastingTypeId
  AND StartDate >= :fiscalYearStart
  AND StartDate <= :today
GROUP BY QuotaOwnerId
```

Similarly, YTD attainment = SUM of `OwnerOnlyAmount` from `ForecastingItem` where `ForecastCategoryName = 'Closed'` across all periods in the fiscal year.

---

## Reporting on Quota Attainment via Custom Report Types

The standard `ForecastingItem` report type does not include `ForecastingQuota` fields. Options:

### Option 1: Custom Report Type with Formula Fields

1. Setup → Report Types → New Custom Report Type.
2. Primary Object: `Forecasts` (uses `ForecastingItem` under the hood).
3. Add formula fields to calculate attainment inline — note that `ForecastingQuota` cannot be directly joined in a standard report type relationship.
4. Limitation: quota data must be surfaced via a separate report and manually cross-referenced, or via a formula field on a User or custom object that stores the quota value.

### Option 2: Joined Report

1. Create a report on `Forecasting Items` (primary block) with columns: `Owner Name`, `Period`, `Forecast Category`, `Owner Only Amount`.
2. Add a second block: `Forecasting Quotas` with columns: `Quota Owner`, `Start Date`, `Quota Amount`.
3. Use the joined report's cross-block groupings to align on Owner and Period.
4. Add a summary formula: `PARENTGROUPVAL(ForecastingItem.OwnerOnlyAmount, GROUP_ROWS) / PARENTGROUPVAL(ForecastingQuota.QuotaAmount, GROUP_ROWS) * 100`.

### Option 3: Apex Controller + LWC Dashboard

For accurate quota attainment reporting at scale, the recommended approach is:
- An Apex controller that performs the two-query join described above.
- An LWC or Visualforce page rendering the results as a table or chart.
- Schedule a batch job to pre-aggregate data into a custom object (`ForecastAttainmentSummary__c`) for reporting performance.

### Option 4: External BI Tool

Export `ForecastingItem` and `ForecastingQuota` data to an external BI tool (Tableau, Salesforce CRM Analytics) and perform the join there. CRM Analytics (formerly Einstein Analytics) natively supports joining these datasets and building attainment dashboards.
