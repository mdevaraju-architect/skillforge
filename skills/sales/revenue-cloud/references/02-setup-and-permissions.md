# Revenue Cloud New-Core — Setup and Permissions

## Required Salesforce Features

New-Core Revenue Cloud requires the `IndustriesRevenue` feature license. This is separate from CPQ (SteelBrick) licensing and from the legacy Order Management feature. Verify feature enablement before attempting any catalog or transaction setup:

```apex
// Check in anonymous Apex whether Revenue Cloud features are active
System.debug(UserInfo.isCurrentUserLicensed('IndustriesRevenue'));
```

From Setup, verify under **Company Information → Feature Licenses** that `IndustriesRevenue` shows as Active and has remaining allocations.

---

## Required Permission Sets

| Permission Set API Name | Who Needs It | Purpose |
|---|---|---|
| `RevenueCloudSales` | Sales reps, account executives | Create and manage transactions (quotes/orders), view products and pricing |
| `RevenueCloudAdmin` | Admins, ops, catalog managers | Full catalog management: create ProductCatalog, ProductCategory, ProductClassification, AttributeDefinition, PriceAdjustmentSchedule |
| `RevenueCloudRevenueRecognition` | Finance, rev rec team | Read and report on `RevenueTransaction`, configure recognition rules |

### Assigning Permission Sets (CLI)

```bash
# Assign RevenueCloudAdmin to a user
sf org assign permset --name RevenueCloudAdmin --on-behalf-of admin@example.com --target-org myorg

# Assign RevenueCloudSales to a sales user
sf org assign permset --name RevenueCloudSales --on-behalf-of rep@example.com --target-org myorg
```

### Assigning Permission Sets (SOQL Verification)

```soql
SELECT AssigneeId, PermissionSet.Name
FROM PermissionSetAssignment
WHERE PermissionSet.Name IN ('RevenueCloudAdmin', 'RevenueCloudSales', 'RevenueCloudRevenueRecognition')
AND Assignee.IsActive = true
```

---

## Org Settings for Revenue Cloud

### Enable Revenue Cloud / Industries Revenue

1. **Setup → Revenue Cloud Settings** — enable the toggle for New-Core Revenue Cloud
2. **Setup → Industries Settings → Revenue** — verify `IndustriesRevenue` is checked
3. **Setup → Product Catalog Settings** — enable Product Catalog Management

These settings are org-wide and irreversible once enabled in production. Always enable in a sandbox first.

### Subscription Management Settings

1. **Setup → Subscription Management** — enable subscription billing
2. Set the **Default Billing Day** (day of month invoices are generated)
3. Configure **Proration Method**: `DailyProration` or `NoneProration`
4. Set **Auto-Renewal** behavior for evergreen subscriptions

### Multi-Currency

If the org uses multi-currency:
1. Enable **Advanced Currency Management** if exchange rates change over time
2. Ensure `PricebookEntry` records exist for each currency × product combination
3. `PriceAdjustmentSchedule` records are currency-agnostic (percentage) or must be duplicated per currency (fixed amount)

---

## Product Configurator Enablement

The product configurator is the UI that allows sales reps to select attribute values when adding products to a transaction.

### Steps to Enable

1. **Setup → Product Configurator Settings** — enable the toggle
2. Ensure the `RevenueCloudSales` permission set includes the `Use Product Configurator` permission
3. Assign the **Revenue Cloud Sales Console** app to sales reps (found in App Manager)
4. Verify `ProductClassification` records are Active on the products you want to configure

### Configurator Rendering Checklist

Before testing the configurator, verify:
- [ ] `ProductCatalog.Status = 'Active'`
- [ ] `ProductCategory.IsActive = true`
- [ ] `ProductCategoryProduct` junction record exists
- [ ] `Product2.IsActive = true` and `Product2.ProductClassificationId` is set
- [ ] `ProductClassification.Status = 'Active'`
- [ ] `AttributeDefinition` records are linked via `ProductClassificationAttribute`
- [ ] For `Picklist`-type attributes: `AttributePicklistValue` records exist
- [ ] `PricebookEntry` exists and `IsActive = true` in the transaction's pricebook

---

## Catalog Setup Sequence

Follow this sequence to avoid foreign key failures:

```
1. Create ProductCatalog (Status = Draft initially)
2. Create ProductCategory (linked to catalog)
3. Create ProductClassification
4. Create AttributeCategory records
5. Create AttributeDefinition records
6. Create AttributePicklistValue records (for Picklist-type attributes)
7. Create ProductClassificationAttribute junctions (links AttributeDefinition to Classification)
8. Create Product2 records with ProductClassificationId set
9. Create ProductCategoryProduct junctions (links Product2 to Category)
10. Activate ProductCatalog (Status → Active)
```

Attempting to set `ProductClassificationId` on `Product2` before the `ProductClassification` exists causes a foreign key error. Activating the catalog before products are categorized is harmless but may cause transient "no products found" results during testing.

---

## Pricebook Setup

1. **Identify or create a Pricebook2**
   - The `Standard Pricebook` (`IsStandard = true`) always exists; it cannot be deleted
   - Create custom pricebooks for segments (e.g., `Enterprise Pricebook`, `Partner Pricebook`)

2. **Create PricebookEntry for each Product2**
   - One entry per product per pricebook per currency
   - `UnitPrice` is the list price baseline — set even if pricing is driven by adjustment schedules

3. **Mark the transaction's Pricebook**
   - Set `Transaction.Pricebook2Id` when creating a transaction
   - All TLIs inherit the transaction's pricebook for price resolution

```soql
-- Check for products missing a PricebookEntry in the standard pricebook
SELECT Id, Name
FROM Product2
WHERE IsActive = true
AND Id NOT IN (
    SELECT Product2Id FROM PricebookEntry
    WHERE Pricebook2.IsStandard = true AND IsActive = true
)
```

---

## Approval Process Setup for Discounts

Revenue Cloud integrates with Salesforce Approval Processes to gate discount levels.

### Recommended Setup

1. **Create an Approval Process on `Transaction`**
   - Trigger criteria: `Transaction.MaxDiscountPercent > [threshold]`
   - Route to a manager or finance queue for approval
   - On approval: set `Transaction.Status = 'Approved'`
   - On rejection: set `Transaction.Status = 'Draft'` and notify rep

2. **Use Discount Thresholds on PriceAdjustmentSchedule**
   - Set `MaxDiscountPercent` on the schedule to flag transactions needing approval
   - Approval gates prevent activation until `Status = 'Approved'`

3. **Multi-level approvals for large deals**
   - Configure chained approval steps in the Approval Process for tiered authority levels (e.g., manager up to 20%, VP up to 40%)

---

## Scratch Org Feature Configuration

For scratch org development, add these features to `project-scratch-def.json`:

```json
{
  "orgName": "Revenue Cloud Dev",
  "edition": "Enterprise",
  "features": [
    "IndustriesRevenue",
    "SubscriptionManagement",
    "ProductCatalog"
  ],
  "settings": {
    "revenueSettings": {
      "enableRevenueCloud": true
    }
  }
}
```

Note: `IndustriesRevenue` requires an Enterprise or Unlimited edition scratch org. Developer edition scratch orgs do not support this feature.

---

## Deployment Checklist

When deploying Revenue Cloud metadata to a new org:

- [ ] Verify `IndustriesRevenue` feature license is active in target org
- [ ] Deploy permission sets before assigning them
- [ ] Deploy `ProductCatalog` and `ProductClassification` metadata before `Product2` records
- [ ] Deploy `AttributeDefinition` before `AttributePicklistValue`
- [ ] Deploy `PriceAdjustmentSchedule` before `PriceAdjustmentTier`
- [ ] Run post-deploy validation: create a test transaction end-to-end in a sandbox before promoting to production
