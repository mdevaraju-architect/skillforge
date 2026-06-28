# 03 — Forecast Hierarchy and Rollup Mechanics

## How `ForecastingItem` Is Generated from `Opportunity`

The platform automatically creates and updates `ForecastingItem` records whenever an `Opportunity` changes in a way that affects forecast data. The mapping is:

| Opportunity Field | Maps To | Notes |
|---|---|---|
| `CloseDate` | `ForecastingItem.StartDate` | Bucketed into the period (month or quarter) containing `CloseDate` |
| `ForecastCategoryName` | `ForecastingItem.ForecastCategoryName` | Directly mapped: Pipeline, BestCase, Commit, Closed, Omitted |
| `Amount` (or custom field) | `ForecastingItem.OwnerOnlyAmount` | For the owner's leaf-node row only; parent rows accumulate children |
| `OwnerId` | `ForecastingItem.OwnerId` | Determines which user's row the opportunity rolls into |
| `IsWon` / `IsClosed` | `ForecastCategoryName = 'Closed'` | Won opportunities automatically move to Closed category |

**Excluded Opportunities:**
- `IsDeleted = true` — deleted opportunities are excluded.
- `ForecastCategoryName = 'Omitted'` — explicitly omitted opportunities contribute $0 to all amounts.
- For product family types: opportunities without `OpportunityLineItem` records are excluded entirely.

### ForecastCategoryName Values and Stage Mapping

`Opportunity.ForecastCategoryName` is a separate picklist from `StageName`. The stage-to-forecast-category mapping is configured per stage:

| Default ForecastCategoryName | Meaning |
|---|---|
| `Pipeline` | Early-stage, low-confidence deals |
| `BestCase` | Mid-stage, possible deals |
| `Commit` | High-confidence deals expected to close |
| `Closed` | Won deals (set automatically by `IsWon = true`) |
| `Omitted` | Excluded from all forecast amounts |

Admins can add custom forecast categories in Setup → Forecast Categories.

---

## Role Hierarchy Rollup Mechanics

### Rollup Chain

The rollup chain follows the `UserRole` hierarchy. For each active `ForecastingType` and each period/category combination:

```
Rep A (OwnerId=A, OwnerOnlyAmount=$100K)
Rep B (OwnerId=B, OwnerOnlyAmount=$150K)
  → both report to Manager M

Manager M row:
  OwnerOnlyAmount = Manager M's own direct opportunities
  ForecastAmount  = OwnerOnlyAmount(M) + ForecastAmount(A) + ForecastAmount(B)
               = 0 + $100K + $150K = $250K  (if M has no direct deals)

VP V row:
  ForecastAmount  = OwnerOnlyAmount(V) + ForecastAmount(M)
               = 0 + $250K = $250K
```

### Double-Count Prevention

**Never SUM `ForecastAmount` across multiple rows.** Parent rows already include all children. To aggregate correctly:
- Use `OwnerOnlyAmount` and filter to leaf-node users (users who have no reports in the hierarchy).
- Or query only a single user's row and use `ForecastAmount` to get their full-team total.

### Role Hierarchy Requirements

- Every user in the forecast must have a `UserRole` assigned (`User.UserRoleId` must not be null).
- The `UserRole` hierarchy must be properly configured (each role's `ParentRoleId` chain must lead to a root role).
- Users without a role are excluded from rollup silently — they have no `ForecastingItem` rows.
- `User.IsForecastManager` must be true for a user to see their reports' rows and make manager adjustments.

---

## Territory Forecast Setup and Rollup

### Prerequisites

- Enterprise Territory Management must be enabled (Setup → Territory Management Settings → Enable Enterprise Territory Management).
- A `Territory2Model` must be in Active state.
- `Territory2` hierarchy must be built with parent-child relationships.
- Users must be assigned to `Territory2` records via `UserTerritory2Association`.
- Accounts and Opportunities must be assigned to territories via `ObjectTerritory2Association`.

### How Territory Rollup Works

For a `ForecastingType` with `ForecastingHierarchyType = RoleTerritory2`:

1. An opportunity is assigned to a `Territory2` via `ObjectTerritory2Association`.
2. The opportunity's `Amount` (or custom field) rolls up into the `ForecastingItem` for the assigned territory.
3. Territory hierarchy rollup follows the `Territory2.ParentTerritory2Id` chain upward, similar to role hierarchy rollup.
4. Users assigned to a territory see that territory's forecast in their Forecasts tab.

### Territory vs Role Hierarchy in the Same Org

An org can have both role-based and territory-based `ForecastingType` records simultaneously:
- Role-based type: `ForecastingHierarchyType = Role` — rolls up via `UserRole` chain.
- Territory-based type: `ForecastingHierarchyType = RoleTerritory2` — rolls up via `Territory2` chain.

Users may appear in both hierarchies if they have both a `UserRole` and a `UserTerritory2Association`.

---

## Adjustment Chain

Adjustments layer on top of the rollup without modifying underlying `ForecastingItem.ForecastAmount`.

### Owner Adjustment Flow

```
Rep A's OwnerOnlyAmount (Commit) = $100K   [from Opportunities]
Rep A creates ForecastingOwnerAdjustment: AdjustedAmount = $90K, IsAmount = true
→ Rep A's OwnerAdjustedAmount = $90K       [manager sees this adjusted value]
→ ForecastingItem.ForecastAmount for A still starts from rollup but OwnerAdjustedAmount reflects it
```

### Manager Adjustment Flow

```
Manager M sees Rep A's row with OwnerAdjustedAmount = $90K
Manager M creates ForecastingManagerAdjustment: AdjustedAmount = $85K, IsAmount = true
→ Manager M's view shows Rep A as $85K
→ ForecastingItem for Manager M aggregates using Manager's adjusted view of Rep A
```

### Adjustment Persistence

- Adjustments are stored as separate records (`ForecastingOwnerAdjustment`, `ForecastingManagerAdjustment`).
- If the underlying opportunity changes after an adjustment is made, the adjustment remains — it does not auto-update.
- Adjustments can be deleted to revert to the underlying rollup amount.
- **Period type changes (Monthly ↔ Quarterly) delete all existing adjustment records for the affected type.**

---

## `ForecastingSubmission` Snapshot Behavior

### What Gets Captured

When a manager clicks "Submit" in the Forecasts tab:
- A `ForecastingSubmission` record is created.
- The record captures: `ForecastAmount`, `AdjustedAmount`, `SubmittedDate`, `SubmittedById`, `ForecastingTypeId`, `PeriodId`.
- This is a point-in-time snapshot — it does not update when opportunities or adjustments change afterward.

### What Does NOT Get Captured

- Individual opportunity details are not stored in `ForecastingSubmission` — only aggregated totals.
- The submission does not lock or prevent further changes to the live forecast.
- After submission, new `ForecastingManagerAdjustment` records can still be created and will affect live data but not the existing submission.

### Querying Submissions

```soql
SELECT Id, SubmittedDate, SubmittedById, ForecastingTypeId, PeriodId, ForecastAmount, AdjustedAmount
FROM ForecastingSubmission
WHERE SubmittedById = :userId
  AND ForecastingTypeId = :forecastingTypeId
ORDER BY SubmittedDate DESC
LIMIT 10
```

Use `SubmittedDate` to find the most recent snapshot vs. the live `ForecastingItem` data.

---

## Recalculation Triggers

`ForecastingItem` records are recalculated asynchronously when:

| Trigger | Recalculation Scope |
|---|---|
| Opportunity `Amount` changes | Affected user's row and all parent rows for the period |
| Opportunity `CloseDate` changes | Old period row decremented, new period row incremented |
| Opportunity `ForecastCategoryName` changes | Old category row decremented, new category row incremented |
| Opportunity `OwnerId` changes | Old owner's row decremented, new owner's row incremented, parent chains updated |
| Opportunity created or deleted | Full recalc for affected user and period |
| New `ForecastingType` activated | Full historical recalc for all opportunities — can take up to 24 hours |
| Period type changed (Monthly ↔ Quarterly) | All existing records deleted, full regeneration |
| User's `UserRoleId` changed | Affected user's rows moved to new position in hierarchy |
| `UserTerritory2Association` added/removed | Territory forecast rows updated for affected territory chain |

### Recalculation Latency

Recalculation is typically near-real-time for individual opportunity changes (seconds to minutes). However:
- Bulk changes (mass updates via Data Loader) queue recalculations and can take hours.
- New `ForecastingType` activation processes all historical records and can take up to 24 hours.
- Monitor recalculation status in Setup → Forecast Settings → Forecast Types (status column shows "Recalculating" when in progress).

---

## Forecast Hierarchy Position of a User

To find where a user sits in the forecast hierarchy:

```soql
-- Find a user's role and their manager's role
SELECT Id, Name, UserRoleId, UserRole.Name, UserRole.ParentRoleId, UserRole.ParentRole.Name,
       IsForecastManager
FROM User
WHERE Id = :userId
```

```soql
-- Find all users in a manager's rollup hierarchy (direct reports only)
SELECT Id, Name, UserRoleId, UserRole.Name
FROM User
WHERE UserRole.ParentRoleId = :managerRoleId
  AND IsForecastManager = true
  AND IsActive = true
```

For territory hierarchy, query `UserTerritory2Association`:

```soql
SELECT UserId, Territory2Id, Territory2.Name, Territory2.ParentTerritory2Id
FROM UserTerritory2Association
WHERE UserId = :userId
```
