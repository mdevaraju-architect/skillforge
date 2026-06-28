# 02 — Setup and Permissions: Salesforce Collaborative Forecasting

## Enabling Collaborative Forecasting

Collaborative Forecasting is a feature that must be explicitly enabled per org.

**Steps:**
1. Setup → search "Forecast Settings" → open **Forecast Settings**.
2. Check **Enable Forecasts**.
3. Select the **default ForecastingType** that appears when users open the Forecasts tab.
4. Optionally enable **Show Quotas** to display quota and attainment columns in the Forecasts tab.
5. Save.

**Prerequisites:**
- Org Edition must be Enterprise, Unlimited, Performance, or Developer.
- The Forecasts tab must be added to the user's app navigation.

---

## ForecastingType Setup

### Revenue Forecast Type (Standard)

The default Revenue forecast type rolls up `Opportunity.Amount`.

1. Setup → Forecast Settings → **Forecast Types** → New (or edit the default).
2. **Forecast Type**: Revenue.
3. **Forecast Hierarchy**: Role Hierarchy (default) or Territory Hierarchy (requires Enterprise Territory Management).
4. **Period Type**: Monthly or Quarterly. **Cannot be changed after activation without data loss.**
5. **Forecast Categories**: Select which categories to display (Pipeline, BestCase, Commit, Closed, Omitted). Custom categories can be added via the Forecast Category API.
6. **Cumulative Forecast View**: Enable if users want a running total across periods.
7. Save and set **Active** = true.

### Quantity Forecast Type

Same setup as Revenue but set **Forecast Type** = Quantity. This rolls up `Opportunity.Quantity` (the `Quantity` field on the opportunity header, not on line items). Requires the `Quantity` field to be populated on Opportunities.

### Product Family Forecast Type

1. Enable **Products** and ensure `Product2.Family` picklist values are configured.
2. Create a new ForecastingType with **Forecast Type** = Product Family.
3. After activation, the platform generates one `ForecastingItem` row per user × period × category × `Product2.Family` value.
4. **Gotcha:** Opportunities without `OpportunityLineItem` records are excluded entirely. Opportunities with line items across multiple families produce one row per family.

### Custom Forecast Type (Custom Amount Field)

1. Create the custom field on `Opportunity` (e.g. `CustomRevenue__c`, Currency type).
2. Create a new ForecastingType.
3. Set **ForecastedAmountFieldApiName** = `CustomRevenue__c`.
4. The platform rolls up this field instead of standard `Amount`.
5. Only Currency and Number fields are supported as the rollup field.

### Overlay Split Forecast Type

1. Enable Opportunity Splits first (see below).
2. Create an `OpportunitySplitType` record with `IsTotalValidated` = false (overlay splits are additive, not summing to 100%).
3. Create a new ForecastingType and link it to the overlay `OpportunitySplitType`.
4. After activation, overlay reps see their credited split amounts rolled up in the Forecasts tab.

---

## Forecast Period Configuration

| Setting | Description |
|---|---|
| Monthly | `ForecastingItem.StartDate` = first day of each month (e.g. `2026-07-01`) |
| Quarterly | `ForecastingItem.StartDate` = first day of each fiscal quarter |
| Fiscal Year Settings | Quarterly period buckets follow Setup → Fiscal Year configuration if custom fiscal years are enabled |

**Changing Period Type is Destructive:**
- Switching from Monthly → Quarterly deletes all monthly `ForecastingItem` records.
- All `ForecastingOwnerAdjustment` and `ForecastingManagerAdjustment` records for monthly periods are also deleted.
- The new quarterly records are regenerated from scratch.
- This operation cannot be undone. Back up adjustment data before any period type change.

---

## Role Hierarchy vs Territory Hierarchy

### Role Hierarchy (Default)

- `ForecastingType.ForecastingHierarchyType` = `Role`.
- Rollup follows the standard User Role hierarchy (Setup → Roles).
- A user must have a Role assigned to appear in the forecast hierarchy.
- Users without a Role are excluded from the forecast rollup.
- The `IsForecastManager` flag on `User` must be true for a user to see their reports' data in the Forecasts tab.

### Territory Hierarchy (Enterprise Territory Management)

- `ForecastingType.ForecastingHierarchyType` = `RoleTerritory2`.
- Requires **Enterprise Territory Management** to be enabled (Setup → Territory Management Settings).
- Rollup follows the `Territory2` hierarchy.
- Users must be assigned to `Territory2` records (via `UserTerritory2Association`) to appear.
- Territory forecasts are independent of role hierarchy — a user can be in both types of forecast if separate `ForecastingType` records exist for each hierarchy type.

### Setting `IsForecastManager`

For a user to see direct reports' forecasts and make manager adjustments:
- Setup → Users → Edit the user record → Check **Allow Forecasting** (this sets `IsForecastManager` = true via the standard User setup page).
- Or set `User.IsForecastManager` = true via Apex/Data Loader.
- Users without this flag see only their own forecast row in the Forecasts tab.

---

## Permission Sets and Profiles

### Required for All Forecast Users

Assign one of the following to all users who should see and interact with forecasts:

| Permission | API Name | Purpose |
|---|---|---|
| View Forecasts | `ViewAllForecasts` | Read access to all forecast data in the hierarchy |
| Override Forecasts | `OverrideForecasts` | Ability to make owner adjustments |
| Manage Forecasts | `ManageForecasts` | Full admin access including setup |

In a standard configuration:
- **Reps**: need `ViewAllForecasts` + `OverrideForecasts`.
- **Managers**: need `ViewAllForecasts` + `OverrideForecasts` + `IsForecastManager` flag.
- **Forecast Admins**: need `ManageForecasts`.

### Profile-based vs Permission Set

These permissions can be granted via Profile or Permission Set. Use Permission Sets for flexible role-based assignment. Check with your org's security model before modifying profiles in production.

---

## Quota Upload Process

Quotas are stored on the `ForecastingQuota` object and must be loaded manually (there is no automatic quota generation from targets).

### CSV Format

```csv
QuotaOwnerId,StartDate,QuotaAmount,ForecastingTypeId
005XXXXXXXXXXXX001,2026-07-01,150000,0DbXXXXXXXXXXXX001
005XXXXXXXXXXXX002,2026-07-01,200000,0DbXXXXXXXXXXXX001
005XXXXXXXXXXXX003,2026-07-01,175000,0DbXXXXXXXXXXXX001
```

- `QuotaOwnerId`: 15- or 18-character User ID.
- `StartDate`: First day of the period. Must exactly match `ForecastingItem.StartDate` values (e.g. `2026-07-01` for July, `2026-07-01` for Q3 if fiscal Q3 starts in July).
- `QuotaAmount`: Numeric value. Use the org's default currency unless `CurrencyIsoCode` is specified.
- `ForecastingTypeId`: 15- or 18-character ID of the `ForecastingType` record.

### Multi-Currency Quota CSV

Add `CurrencyIsoCode` column when Advanced Currency Management is enabled:

```csv
QuotaOwnerId,StartDate,QuotaAmount,ForecastingTypeId,CurrencyIsoCode
005XXXXXXXXXXXX001,2026-07-01,150000,0DbXXXXXXXXXXXX001,USD
```

### Upload Steps

1. Retrieve `ForecastingTypeId` values:
   ```soql
   SELECT Id, MasterLabel, DeveloperName FROM ForecastingType WHERE IsActive = true
   ```
2. Prepare the CSV with one row per user per period per type.
3. Use **Data Loader** (Upsert on `Id` for updates; Insert for new records) or the **Data Import Wizard** (Forecasting Quota object).
4. Verify after upload:
   ```soql
   SELECT QuotaOwnerId, StartDate, QuotaAmount
   FROM ForecastingQuota
   WHERE ForecastingTypeId = '0DbXXXXXXXXXXXX001'
     AND StartDate = 2026-07-01
   ```

---

## OpportunitySplit Enablement

Opportunity Splits must be enabled for overlay forecasting to function.

**Enable Opportunity Splits:**
1. Setup → search "Opportunity Splits" → open **Opportunity Splits**.
2. Click **Set Up Opportunity Splits**.
3. Confirm the `OpportunitySplit` object is enabled.

**Configure Split Types:**
- **Revenue Split** (`IsTotalValidated` = true): Split percentages must sum to 100%. Used to distribute revenue credit across multiple reps. Creates a `ForecastingType` that rolls up each rep's credited share.
- **Overlay Split** (`IsTotalValidated` = false): Split percentages are additive (can total more or less than 100%). Used for overlay/support reps who receive recognition credit without reducing the primary owner's forecast.

**Create a Split Type:**
1. Setup → Opportunity Split Types → New.
2. Set `MasterLabel`, `DeveloperName`.
3. Set `IsTotalValidated`: true for revenue splits, false for overlay splits.
4. Save and activate.

**Assign Splits to Opportunities:**
- Once enabled, Opportunity records show a "Splits" related list.
- Add `OpportunitySplit` records: set `SplitOwnerId`, `SplitPercentage`, `SplitTypeId`.
- Revenue split percentages must total 100% before saving (platform enforces this when `IsTotalValidated` = true).

**Wire to ForecastingType:**
- Create or edit a `ForecastingType` and set it to use the overlay `OpportunitySplitType`.
- The platform then rolls up `SplitAmount` values for overlay reps into their `ForecastingItem` records.

---

## Adding the Forecasts Tab to App Navigation

Users must have the Forecasts tab in their app to access the Forecasting UI.

1. Setup → App Manager → Edit the relevant Lightning App.
2. Navigation Items → Add "Forecasts" tab.
3. Save and publish.

Alternatively, users can find it via the App Launcher by searching "Forecasts".
