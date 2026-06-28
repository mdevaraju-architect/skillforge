# Products, Quotes, and Pricing Reference

## Overview

This reference covers the product catalog and pricing model in Salesforce Sales Cloud: the `Product2`, `Pricebook2`, and `PricebookEntry` objects; adding `OpportunityLineItem` records to opportunities; standard `Quote` creation and sync; quote PDF generation; CPQ handoff patterns; and revenue scheduling via `OpportunityLineItemSchedule`.

---

## Object Relationships: Product Catalog

```
Product2 (catalog item)
  └── PricebookEntry (Product2 + Pricebook2 + UnitPrice)
        └── OpportunityLineItem (PricebookEntry + Opportunity + Qty + UnitPrice)
              └── OpportunityLineItemSchedule (revenue/qty schedule per line item)

Pricebook2 (Standard or Custom)
  └── PricebookEntry (one per Product2 per Pricebook2)

Quote (linked to Opportunity)
  └── QuoteLineItem (mirrors OpportunityLineItem structure)
```

---

## Product2 — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `Name` | Text(255) | Required. Product name displayed on quotes and line items |
| `ProductCode` | Text(255) | Optional SKU or product code |
| `Description` | TextArea | Product description |
| `Family` | Picklist | Product category (e.g., `Software`, `Hardware`, `Services`, `Support`) |
| `IsActive` | Boolean | Required to be true for the product to be selectable on opportunities |
| `QuantityUnitOfMeasure` | Picklist | Unit label (e.g., `Each`, `License`, `Seat`, `Hour`) |
| `StockKeepingUnit` | Text(180) | Optional internal SKU |

**Important:** A `Product2` must have `IsActive = true` and must have a `PricebookEntry` in the Standard Price Book before it can be added to a custom pricebook or an opportunity.

---

## Pricebook2 — Standard vs. Custom

### Standard Price Book

- Auto-created in every Salesforce org.
- `Pricebook2` where `IsStandard = true`.
- Cannot be deleted or deactivated.
- Every active `Product2` must have a `PricebookEntry` in the Standard Price Book.
- Used directly on opportunities in orgs with a single pricing structure.

### Custom Pricebooks

- Created manually: `Pricebook2` record with `IsActive = true` and a custom `Name`.
- Use cases: regional pricing, partner pricing, industry-specific pricing, currency-specific pricing.
- Each custom pricebook has its own `PricebookEntry` records referencing the same `Product2` records but with different `UnitPrice` values.
- An opportunity can only be linked to one pricebook at a time (`Opportunity.Pricebook2Id`).

### PricebookEntry — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `Pricebook2Id` | Lookup(Pricebook2) | Which pricebook this entry belongs to |
| `Product2Id` | Lookup(Product2) | Which product this entry prices |
| `UnitPrice` | Currency | List price for this product in this pricebook |
| `IsActive` | Boolean | Must be true for the entry to be selectable |
| `UseStandardPrice` | Boolean | If true, inherits price from the Standard Price Book entry |
| `CurrencyIsoCode` | Picklist | Only relevant in multi-currency orgs |

---

## Adding OpportunityLineItems

### Step-by-Step

1. **Set `Opportunity.Pricebook2Id`** — Query the appropriate `Pricebook2` and set its Id on the opportunity. For the Standard Price Book: `SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1`. Do not hardcode Ids.

2. **Query `PricebookEntry` records** — Retrieve the `PricebookEntry.Id` values for the products you want to add, filtering by `Pricebook2Id = [pricebook Id]` and `IsActive = true`.

3. **Insert `OpportunityLineItem` records** — Required fields: `OpportunityId`, `PricebookEntryId`, `Quantity`, `UnitPrice`. Optionally set `Discount` and `ServiceDate`.

4. **Do not set `TotalPrice`** — `TotalPrice` is calculated as `Quantity × UnitPrice × (1 - Discount/100)`. Setting it explicitly alongside `Quantity` and `UnitPrice` will cause a field conflict error.

5. **Verify `Opportunity.Amount`** — After inserting line items, `Opportunity.Amount` becomes read-only and equals the sum of all `OpportunityLineItem.TotalPrice` values.

### OpportunityLineItem — All Required and Key Fields

| Field API Name | Type | Required | Notes |
|---|---|---|---|
| `OpportunityId` | Lookup(Opportunity) | Yes | Parent opportunity |
| `PricebookEntryId` | Lookup(PricebookEntry) | Yes | Must be from the pricebook on the opportunity |
| `Quantity` | Number | Yes | Number of units |
| `UnitPrice` | Currency | Yes | Price per unit (overrides list price) |
| `TotalPrice` | Currency | No | Calculated; do not set directly |
| `ListPrice` | Currency | No | Read-only; from `PricebookEntry.UnitPrice` |
| `Discount` | Percent | No | Percentage discount applied to `UnitPrice` |
| `ServiceDate` | Date | No | Service start date for subscriptions |
| `Description` | TextArea | No | Line item description override |
| `SortOrder` | Integer | No | Display order on quote PDF |
| `Product2Id` | Lookup(Product2) | No | Auto-populated from `PricebookEntry` |
| `Name` | Text | No | Auto-populated from `Product2.Name`; overrideable |

---

## Discount Field Behavior

`OpportunityLineItem.Discount` is a percentage stored as a number (e.g., `10` = 10% discount, not `0.10`). The effective `UnitPrice` after discount is calculated by Salesforce as:

```
EffectiveUnitPrice = ListPrice × (1 - Discount / 100)
```

`TotalPrice = Quantity × EffectiveUnitPrice`

When `Discount` is set, the displayed `UnitPrice` in the UI shows the discounted price. The original list price is preserved in `ListPrice` (read-only).

---

## OpportunityLineItemSchedule — Multi-Year and Recurring Revenue

For deals where revenue is spread across periods (e.g., a 3-year license deal), use `OpportunityLineItemSchedule` to define how revenue or quantity is distributed.

### Enabling Schedules

1. Navigate to **Setup → Products → Revenue and Quantity Schedules**.
2. Enable **Revenue Schedules** and/or **Quantity Schedules** as needed.
3. On each `Product2`, set `CanUseRevenueSchedule = true` and/or `CanUseQuantitySchedule = true`.

### OpportunityLineItemSchedule — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `OpportunityLineItemId` | Lookup(OpportunityLineItem) | Parent line item |
| `Type` | Picklist | `Revenue` or `Quantity` |
| `ScheduleDate` | Date | Date of this schedule installment |
| `Revenue` | Currency | Revenue amount for this period (for Revenue type) |
| `Quantity` | Number | Quantity for this period (for Quantity type) |
| `Description` | Text | Optional notes |

**Note:** When revenue schedules exist on a line item, the `OpportunityLineItem.TotalPrice` still reflects the full deal value; schedules determine how it is recognized over time for reporting purposes. Forecasting rollups in standard Sales Cloud use `Opportunity.CloseDate`, not schedule dates — for schedule-based forecasting, use Revenue Cloud or a custom report.

---

## Standard Quotes

### Enabling Quotes

Quotes must be enabled in **Setup → Quotes Settings** before the `Quote` and `QuoteLineItem` objects are accessible.

### Quote — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `Name` | Text(255) | Required. Quote name |
| `OpportunityId` | Lookup(Opportunity) | Required. Parent opportunity |
| `Pricebook2Id` | Lookup(Pricebook2) | Must match `Opportunity.Pricebook2Id` |
| `Status` | Picklist | `Draft`, `Needs Review`, `In Review`, `Approved`, `Rejected`, `Presented`, `Accepted`, `Denied` |
| `IsSyncing` | Boolean | True if this quote is actively syncing to the opportunity |
| `ExpirationDate` | Date | When the quote expires |
| `BillingName`, `BillingStreet`, etc. | Text/Address | Quote billing address fields |
| `ShippingName`, `ShippingStreet`, etc. | Text/Address | Quote shipping address fields |
| `ContactId` | Lookup(Contact) | Primary contact for the quote |
| `Discount` | Percent | Quote-level discount (applied in addition to line item discounts) |
| `GrandTotal` | Currency | Calculated: sum of all `QuoteLineItem.TotalPrice` minus quote-level discount |
| `TotalPrice` | Currency | Sum of `QuoteLineItem.TotalPrice` before quote discount |
| `Tax` | Currency | Tax amount |
| `ShippingHandling` | Currency | Shipping and handling cost |
| `Description` | TextArea | Quote description |

### QuoteLineItem — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `QuoteId` | Lookup(Quote) | Required. Parent quote |
| `PricebookEntryId` | Lookup(PricebookEntry) | Required |
| `Quantity` | Number | Required |
| `UnitPrice` | Currency | Required |
| `Discount` | Percent | Optional line-item discount |
| `TotalPrice` | Currency | Calculated |

### Quote Sync Behavior

- Set `Quote.IsSyncing = true` to begin syncing. The quote's `QuoteLineItem` records will be reflected back to `OpportunityLineItem`, and `Opportunity.Amount` will update accordingly.
- Only **one** `Quote` per opportunity can have `IsSyncing = true`. Setting a new quote to syncing automatically sets the previous syncing quote to `IsSyncing = false`.
- Unsyncing a quote (`IsSyncing = false`) leaves `OpportunityLineItem` and `Opportunity.Amount` at their last synced state — they do not revert.
- When a quote is syncing, `Opportunity.Amount` and `OpportunityLineItem` records can only be modified by editing the `QuoteLineItem` records.

### Quote PDF Generation

1. Create a **Quote Template** in Setup → Quote Templates. Templates use a drag-and-drop editor and support custom fields, product tables, terms and conditions, and branding.
2. On the `Quote` record, use the **Create PDF** button to generate a `QuoteDocument` record with the rendered PDF attached as a `ContentDocument`.
3. Use the **Email Quote** action to send the PDF to the `Quote.ContactId` using a selected email template.

---

## CPQ Handoff Pattern

Salesforce CPQ (formerly Steelbrick; managed package namespace `SBQQ`) introduces a separate quote object `SBQQ__Quote__c` that replaces the standard `Quote` for complex product configuration, bundle pricing, and approval workflows.

### When to Use Standard Quote vs. CPQ

| Scenario | Use Standard Quote | Use CPQ (`SBQQ__Quote__c`) |
|---|---|---|
| Simple flat product list, no bundles | Yes | No |
| Volume-based pricing tiers | No | Yes |
| Product bundles with configuration rules | No | Yes |
| Multi-dimensional quoting (seat × term) | No | Yes |
| Complex approval workflows with thresholds | Sometimes | Yes |
| Subscription amendments and renewals | No | Yes |

### CPQ Quote Sync to Opportunity

- `SBQQ__Quote__c.SBQQ__Primary__c = true` marks the CPQ quote as the primary quote.
- When `SBQQ__Primary__c = true`, CPQ syncs `SBQQ__Quote__c.SBQQ__NetAmount__c` back to `Opportunity.Amount` automatically via CPQ's background sync process.
- Do not mix standard `Quote` and `SBQQ__Quote__c` on the same opportunity — the sync mechanisms conflict.
- The handoff from standard Opportunity to CPQ quoting: create the `SBQQ__Quote__c` record with `SBQQ__Opportunity2__c` = the opportunity Id; CPQ handles the rest.

### Key CPQ Objects (Reference Only)

| Object API Name | Purpose |
|---|---|
| `SBQQ__Quote__c` | CPQ quote (replaces standard `Quote`) |
| `SBQQ__QuoteLine__c` | CPQ quote line (replaces standard `QuoteLineItem`) |
| `SBQQ__Product__c` | CPQ product configuration (extends `Product2`) |
| `SBQQ__ProductOption__c` | Bundle component options |
| `SBQQ__PriceRule__c` | Automated pricing rules |
| `SBQQ__DiscountSchedule__c` | Volume discount tiers |
| `SBQQ__Subscription__c` | Post-close subscription record |

Full CPQ configuration is out of scope for this skill. Use the `cpq-configuration` skill for deep CPQ work.
