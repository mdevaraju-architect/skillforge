---
name: sales-revenue-cloud
description: >-
  ProductCatalog, ProductCategory, ProductClassification, AttributeDefinition,
  AttributeCategory, ProductAttribute, PriceAdjustmentSchedule, PriceAdjustmentTier,
  TransactionLineItem, BillingSchedule, RevenueTransaction, OrderSummary,
  Revenue Cloud PCM, product catalog management, pricing waterfall, bundles,
  configurability, subscription billing, amendments, renewals, revenue recognition,
  new-core Revenue Cloud, Industries Revenue, transaction management
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: sales
  module: revenue-cloud
  api-version-min: "62.0"
  salesforce-release-min: "Spring26"
  approval-tier: "draft"
---

# Revenue Cloud (New-Core / PCM) — Skill

This skill covers **Salesforce New-Core Revenue Cloud** — the 2023+ product built on Industries infrastructure.
It does **not** cover legacy CPQ (SBQQ__), legacy Order Management System (OMS), or standard Opportunity line items.

---

## Always True (Gotchas)

### 1. New-Core Revenue Cloud is NOT CPQ (SBQQ__)

`SBQQ__Quote__c`, `SBQQ__QuoteLine__c`, `SBQQ__Subscription__c`, and all related CPQ objects belong to the legacy CPQ product (Salesforce CPQ / Steelbrick). New-Core Revenue Cloud uses `TransactionLineItem`, `ProductCatalog`, and `AttributeDefinition`. The two data models are completely separate and must never be mixed. If a SOQL query or Flow references any `SBQQ__` namespace object, it is operating on CPQ, not new-core Revenue Cloud.

### 2. `Product2` is still the base object, but classification drives configurability

`ProductClassification` is a separate object with a lookup field on `Product2` (`Product2.ProductClassificationId`). It determines which attributes and attribute categories apply to a product. Without a linked `ProductClassification`, a product cannot have configurable attributes — the configurator UI will show no attribute inputs for that product. Classification is required for any product that needs runtime configuration (e.g., subscription term, seat count, add-ons).

### 3. `ProductCatalog` is the container — every product must belong to one

`ProductCategory` records carry a `ProductCatalogId` lookup to `ProductCatalog`. `Product2` records are associated to categories via the junction object `ProductCategoryProduct` (`ProductCategoryProduct.ProductId` + `ProductCategoryProduct.ProductCategoryId`). A product not associated to any category in an active catalog is invisible to the configurator even if it is active and has a valid pricebook entry. Always verify the full chain: Catalog → Category → ProductCategoryProduct → Product2.

### 4. Pricing waterfall order is fixed: List → Pricebook → Adjustment Schedules → Manual Override

The net price is calculated in a defined sequence:
1. `PricebookEntry.UnitPrice` — list price baseline
2. `PriceAdjustmentSchedule` records — volume- or tier-based discounts applied in `Sequence` order
3. Manual override on `TransactionLineItem.UnitPrice` — last and highest priority

Skipping a tier definition in the waterfall, or setting schedules out of sequence, produces an incorrect net price with no visible error. Always verify the `PriceAdjustmentSchedule.Sequence` field and ensure `PriceAdjustmentTier` coverage ranges are contiguous.

### 5. `PriceAdjustmentSchedule.AdjustmentType` picklist values are `PercentageDiscount`, `FixedDiscount`, `FixedPrice`

The adjustment value field (`PriceAdjustmentTier.AdjustmentValue`) interpretation depends on `AdjustmentType`:
- `PercentageDiscount` — value is a percentage (e.g., `10` = 10% off)
- `FixedDiscount` — value is a currency amount subtracted from list price
- `FixedPrice` — value replaces the list price entirely

Using a percentage value (e.g., `10`) when the type is `FixedDiscount` causes silent miscalculation — the system deducts $10 instead of 10%. Always match the value's semantics to the `AdjustmentType`.

### 6. `TransactionLineItem` (TLI) is not `OrderItem`

`OrderItem` is the legacy Order Management System object linked to `Order`. New-Core Revenue Cloud uses `TransactionLineItem` linked to a `Transaction` record. Migrating from legacy OMS means mapping `OrderItem` → `TransactionLineItem` (and `Order` → `Transaction`), not reusing `OrderItem`. Any SOQL, Flow, or Apex that reads from `OrderItem` for revenue cloud purposes is reading the wrong object.

### 7. `BillingSchedule` is auto-generated — do not create manually

When a subscription product's `TransactionLineItem` is activated (transaction moves to `Activated` status), the platform automatically generates `BillingSchedule` records based on `TransactionLineItem.BillingFrequency` and `TransactionLineItem.SubscriptionTerm`. Do not create `BillingSchedule` records manually for subscription products — doing so causes duplicate schedules and billing errors. Manual `BillingSchedule` creation is only appropriate for one-time charges where no subscription term exists.

### 8. Bundle parent-child linking uses `TransactionLineItem.ParentTransactionLineItemId`

Bundle component TLIs reference their parent via the `ParentTransactionLineItemId` lookup field on `TransactionLineItem`. When querying bundle totals, sum child TLI amounts (`TransactionLineItem.TotalAmount` where `ParentTransactionLineItemId = [parentId]`) — do not read the parent TLI amount. For container-only bundle parents (header products with $0 price), the parent TLI amount is $0 by design.

### 9. `AttributeDefinition.DataType` controls UI rendering

Valid `DataType` values: `Text`, `Number`, `Picklist`, `Boolean`, `Date`. A `Picklist`-type attribute requires associated `AttributePicklistValue` records (linked via `AttributePicklistValue.AttributeDefinitionId`). Without at least one `AttributePicklistValue`, the picklist renders empty in the product configurator — no options appear and the attribute cannot be set. Always create picklist values immediately after creating a `Picklist`-type `AttributeDefinition`.

### 10. `ProductClassification` is reusable — version it, do not edit in place

One `ProductClassification` record can govern many `Product2` records. Any change to a classification's attribute set (adding/removing `AttributeDefinition` links) retroactively affects all products that reference that classification — including products already on active transactions. Always create a new `ProductClassification` version (e.g., `Enterprise_v2`) rather than editing an existing classification. Archive the old classification by removing product associations before deprecating it.

### 11. `RevenueTransaction` is owned by the RevRec engine — do not create manually

`RevenueTransaction` records are automatically created by the Revenue Recognition engine when a `BillingSchedule` milestone is reached or a recognition event fires. Do not manually create `RevenueTransaction` records. The RevRec engine owns the object lifecycle. Querying `RevenueTransaction` for reporting requires the `RevenueCloudRevenueRecognition` permission set. Attempting to insert `RevenueTransaction` via Apex or Data Loader will either fail or corrupt the recognition state.

### 12. Amendments create a new `Transaction` — original is immutable post-activation

When amending a subscription, create a new `Transaction` record with `Transaction.AmendedTransactionId` pointing to the original transaction's Id. Do not update the original transaction's `TransactionLineItem` records to reflect changes — once a transaction is `Activated`, its TLIs are immutable. The amendment transaction captures deltas (quantity changes, price changes, cancellations). Renewal transactions follow the same pattern: a new `Transaction` with `Transaction.RenewedTransactionId` referencing the expiring transaction.

### 13. `ProductCatalog.Status` must be `Active` for catalog visibility

A `ProductCatalog` in `Draft` or `Inactive` status is completely invisible to the transaction UI, the product configurator, and the CPQ APIs — even if all categories and products are correctly set up. Before debugging "product not visible" issues, always verify `ProductCatalog.Status = 'Active'`. Changing a catalog from `Draft` to `Active` requires no product re-association; the change takes effect immediately.

### 14. `PricebookEntry` is still required in New-Core Revenue Cloud

New-core pricing uses `PriceAdjustmentSchedule` for waterfall discounts, but the base list price still requires a `PricebookEntry` linked to `Pricebook2` via `PricebookEntry.Pricebook2Id`. A `Product2` without a `PricebookEntry` in the active pricebook returns a $0 price in the configurator — no error is thrown. Always create a `PricebookEntry` (with a non-zero `UnitPrice`) for every product intended for sale, even if the actual selling price is driven entirely by `PriceAdjustmentSchedule` logic.

---

## Routing Table

| User Intent | Reference File |
|---|---|
| Object model, data model diagram, key fields, relationships | [01-architecture.md](references/01-architecture.md) |
| Permissions, features, org setup, configurator enablement | [02-setup-and-permissions.md](references/02-setup-and-permissions.md) |
| Product catalog, categories, classifications, attributes, bundles | [03-catalog-and-products.md](references/03-catalog-and-products.md) |
| Pricing waterfall, adjustment schedules, tiers, discounts, multi-currency | [04-pricing.md](references/04-pricing.md) |
| Transactions, billing schedules, amendments, renewals, revenue recognition | [05-transactions-and-billing.md](references/05-transactions-and-billing.md) |

---

## Workflows

### Workflow 1: Set Up a New Product with Attributes and Pricing

**Goal:** Make a new product available in the product configurator with configurable attributes and tiered pricing.

**Steps:**

1. **Ensure a ProductCatalog exists and is Active**
   - Check `SELECT Id, Name, Status FROM ProductCatalog WHERE Status = 'Active'`
   - If none, create a `ProductCatalog` record and set `Status = 'Active'`

2. **Create or identify a ProductCategory**
   - Create `ProductCategory` with `ProductCatalogId` pointing to the active catalog
   - Set `ParentCategoryId` if building a hierarchy

3. **Create the Product2 record**
   - Set `IsActive = true`, `Name`, `ProductCode`, `Family`
   - Leave `ProductClassificationId` blank for now

4. **Create a ProductClassification**
   - Create `ProductClassification` record with a descriptive `Name` (e.g., `SaaS_Subscription_v1`)
   - This is the reusable template for attribute shape

5. **Create AttributeDefinition records**
   - One record per configurable attribute (e.g., `SubscriptionTerm`, `UserCount`)
   - Set `DataType` appropriately (`Number`, `Picklist`, `Boolean`, etc.)
   - For `Picklist` type: create `AttributePicklistValue` records linked via `AttributeDefinitionId`

6. **Create AttributeCategory records and link AttributeDefinitions**
   - `AttributeCategory` groups attributes for display
   - Link `AttributeDefinition` records to the classification via `ProductClassificationAttribute` junction

7. **Link ProductClassification to Product2**
   - Set `Product2.ProductClassificationId = [classificationId]`

8. **Associate Product2 to the ProductCategory**
   - Create `ProductCategoryProduct` with `ProductId` and `ProductCategoryId`

9. **Create PricebookEntry**
   - Create `PricebookEntry` with `Product2Id`, `Pricebook2Id` (standard or custom pricebook), and `UnitPrice` (list price)
   - Set `IsActive = true`

10. **Create PriceAdjustmentSchedule and PriceAdjustmentTiers (if tiered pricing needed)**
    - Create `PriceAdjustmentSchedule` with `AdjustmentType` (`PercentageDiscount`, `FixedDiscount`, or `FixedPrice`)
    - Create `PriceAdjustmentTier` records with contiguous `LowerBound`/`UpperBound` ranges and `AdjustmentValue`

11. **Verify in configurator**
    - Navigate to a new transaction, add the product, confirm attributes render and price calculates correctly

---

### Workflow 2: Create a Transaction (Quote/Order) with Bundle Products

**Goal:** Create a transaction containing a bundle parent product with component child products.

**Steps:**

1. **Create the Transaction record**
   - Set `TransactionType` = `Quote` or `Order`
   - Set `Pricebook2Id` to the active pricebook
   - Set `AccountId`, `EffectiveDate`, `ExpirationDate` as required

2. **Add the bundle parent TransactionLineItem**
   - Create `TransactionLineItem` with `TransactionId`, `Product2Id` (the bundle parent product), `Quantity = 1`
   - Set `UnitPrice = 0` if the parent is a container-only bundle (price lives on children)
   - Note the `Id` of this TLI — children will reference it

3. **Add bundle component TransactionLineItems**
   - For each component product, create a `TransactionLineItem`
   - Set `ParentTransactionLineItemId = [bundleParentTLI.Id]`
   - Set `Quantity`, `UnitPrice` (or let pricing waterfall calculate)

4. **Set attribute values on TLIs (if products are configurable)**
   - Create `TransactionLineItemAttribute` records linking TLI to `AttributeDefinition` with the chosen value

5. **Review pricing**
   - Query `SELECT Id, Product2Id, UnitPrice, TotalAmount, ParentTransactionLineItemId FROM TransactionLineItem WHERE TransactionId = '[txnId]'`
   - Verify child TLI amounts sum correctly; parent TLI is $0 for container bundles

6. **Activate the Transaction**
   - Update `Transaction.Status = 'Activated'`
   - Platform auto-generates `BillingSchedule` records for any subscription-type TLIs

7. **Verify BillingSchedule generation**
   - Query `SELECT Id, BillingFrequency, NextBillingDate, Amount FROM BillingSchedule WHERE TransactionLineItemId IN [tliIds]`

---

### Workflow 3: Subscription Amendment and Renewal

**Goal:** Amend an active subscription transaction (e.g., add seats) and later renew it.

**Amendment Steps:**

1. **Identify the original activated Transaction**
   - `SELECT Id, Status, EffectiveDate, ExpirationDate FROM Transaction WHERE Id = '[originalId]' AND Status = 'Activated'`

2. **Create a new amendment Transaction**
   - Create `Transaction` with `TransactionType = 'Amendment'`
   - Set `AmendedTransactionId = [originalTransaction.Id]`
   - Set `EffectiveDate` to the amendment effective date (mid-term date)
   - Set `Pricebook2Id` to match the original

3. **Create amendment TransactionLineItems**
   - Add TLIs representing the delta only (e.g., +5 seats)
   - Reference original TLI via `AmendedTransactionLineItemId` if amending an existing line
   - For net-new additions, create standard TLIs without `AmendedTransactionLineItemId`

4. **Do NOT modify original TLIs**
   - Original transaction TLIs are immutable once activated. Any attempt to update them will fail or produce undefined behavior

5. **Activate the amendment Transaction**
   - Update `Transaction.Status = 'Activated'`
   - New `BillingSchedule` records are created for amended lines covering the remaining term

**Renewal Steps:**

1. **Identify expiring Transaction**
   - Query transactions where `ExpirationDate` is approaching

2. **Create renewal Transaction**
   - Create `Transaction` with `TransactionType = 'Renewal'`
   - Set `RenewedTransactionId = [expiringTransaction.Id]`
   - Set `EffectiveDate = [expiringTransaction.ExpirationDate + 1 day]`
   - Clone TLIs from the original (same products, quantities, and pricing unless changes requested)

3. **Negotiate and activate**
   - Apply any renewal pricing adjustments via new `PriceAdjustmentSchedule` or TLI-level overrides
   - Activate when confirmed — new `BillingSchedule` records cover the renewal term

---

## Not Covered by This Skill

- **Legacy CPQ (SBQQ__)** — separate product with a completely different object model; use the `sales-cpq` skill
- **Order Management System legacy** (`OrderSummary`, `OrderItem`, legacy `Order` fulfillment) — use the `sales-oms` skill
- **Standard Opportunity products / `OpportunityLineItem`** — use the `sales-opportunity-to-close` skill
- **Revenue Recognition accounting rules** — configuration of recognition templates, rules, and schedules is the domain of the finance/audit team
- **Billing connector configuration** — connector-level setup between Revenue Cloud and billing systems is out of scope
