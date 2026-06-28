# Revenue Cloud New-Core — Pricing

## Pricing Waterfall Overview

The Revenue Cloud pricing engine resolves a net price for each `TransactionLineItem` using a fixed waterfall sequence. Understanding the waterfall is essential for diagnosing incorrect prices.

```
PRICING WATERFALL (applied in order)
─────────────────────────────────────────────────────────────────
Step 1: List Price
        Source: PricebookEntry.UnitPrice
        The baseline price for the product in the transaction's pricebook.
        If no PricebookEntry exists → price resolves to $0 (no error thrown).

Step 2: Price Adjustment Schedules
        Source: PriceAdjustmentSchedule records linked to the PricebookEntry,
                applied in ascending PriceAdjustmentSchedule.Sequence order.
        Each schedule applies a PercentageDiscount, FixedDiscount, or FixedPrice
        adjustment based on the quantity/value tier matched by PriceAdjustmentTier.
        Multiple schedules stack: the output of schedule N is the input to schedule N+1.

Step 3: Manual Override
        Source: TransactionLineItem.UnitPrice set explicitly by the user or API
        Overrides all waterfall calculations for that line item.
        Triggers discount approval if the override exceeds the approval threshold.

Final: Net Price
        Stored in TransactionLineItem.TotalAmount = UnitPrice × Quantity
─────────────────────────────────────────────────────────────────
```

---

## PriceAdjustmentSchedule

A `PriceAdjustmentSchedule` is a discount rule attached to a `PricebookEntry`. Multiple schedules can exist per pricebook entry and are applied in `Sequence` order.

### AdjustmentType Values

| AdjustmentType | Behavior | AdjustmentValue interpretation |
|---|---|---|
| `PercentageDiscount` | Multiplies price by `(1 - value/100)` | Integer or decimal percentage (e.g., `15` = 15% off) |
| `FixedDiscount` | Subtracts a flat amount from price | Currency amount (e.g., `50` = $50 off) |
| `FixedPrice` | Replaces price with a fixed value | Currency amount (e.g., `299` = price is $299 regardless of list) |

### Critical Gotcha: Type-Value Mismatch

Setting `AdjustmentValue = 10` with `AdjustmentType = 'FixedDiscount'` deducts $10. Setting the same value with `AdjustmentType = 'PercentageDiscount'` deducts 10%. These look identical in the data but produce completely different net prices. Always document the intent alongside the type.

### Creation

```apex
PriceAdjustmentSchedule schedule = new PriceAdjustmentSchedule(
    Name = 'Volume Discount - Standard',
    PricebookEntryId = pbeId,
    AdjustmentType = 'PercentageDiscount',
    Sequence = 10  // lower sequence = applied first
);
insert schedule;
```

---

## PriceAdjustmentTier

`PriceAdjustmentTier` records define the quantity or value ranges within a `PriceAdjustmentSchedule`. The platform matches a TLI's quantity to the appropriate tier and applies that tier's `AdjustmentValue`.

### Tier Fields

| Field | Description |
|---|---|
| `LowerBound` | Minimum quantity (inclusive) for this tier |
| `UpperBound` | Maximum quantity (inclusive); `null` = unlimited |
| `AdjustmentValue` | Discount amount or percentage |
| `TierType` | `Volume` or `Slab` |

### TierType Behavior

- **Volume** — the adjustment applies to all units in the line item when the quantity falls in this tier
- **Slab** — the adjustment applies only to units within the slab range; units in lower slabs use lower-slab rates

Volume pricing is simpler and more common. Slab pricing resembles graduated tax brackets.

### Contiguous Ranges Requirement

Tiers must cover contiguous ranges with no gaps. A gap between tiers (e.g., tiers cover 1–10 and 20–∞ but not 11–19) causes the pricing engine to return the list price unchanged for quantities in the uncovered range.

```apex
List<PriceAdjustmentTier> tiers = new List<PriceAdjustmentTier>{
    new PriceAdjustmentTier(
        PriceAdjustmentScheduleId = schedule.Id,
        LowerBound = 1,
        UpperBound = 9,
        AdjustmentValue = 0,    // no discount for 1-9 units
        TierType = 'Volume'
    ),
    new PriceAdjustmentTier(
        PriceAdjustmentScheduleId = schedule.Id,
        LowerBound = 10,
        UpperBound = 49,
        AdjustmentValue = 10,   // 10% off for 10-49 units
        TierType = 'Volume'
    ),
    new PriceAdjustmentTier(
        PriceAdjustmentScheduleId = schedule.Id,
        LowerBound = 50,
        UpperBound = null,      // null = unlimited (50+)
        AdjustmentValue = 20,   // 20% off for 50+ units
        TierType = 'Volume'
    )
};
insert tiers;
```

---

## Volume Discount Patterns

### Pattern 1: Simple Volume Discount (PercentageDiscount)

Use when discount percentage increases with quantity. Example: 0% for 1–9, 10% for 10–49, 20% for 50+.

See tier creation example above.

### Pattern 2: Fixed-Price Tiers

Use when selling at specific prices per quantity break rather than calculating off list. Example: $500/seat for 1–10, $450/seat for 11–50, $400/seat for 51+.

```apex
PriceAdjustmentSchedule fps = new PriceAdjustmentSchedule(
    Name = 'Per-Seat Fixed Price Tiers',
    PricebookEntryId = pbeId,
    AdjustmentType = 'FixedPrice',
    Sequence = 10
);
insert fps;

// Then create tiers with AdjustmentValue = per-unit fixed price
```

### Pattern 3: Stacked Schedules

Use when multiple discount rules apply (e.g., a volume discount + a negotiated customer-specific discount):

```apex
// Schedule 1: Volume discount (Sequence 10)
// Schedule 2: Customer loyalty discount (Sequence 20)
// Result: list → volume adjusted → loyalty adjusted
```

Stacking is powerful but requires careful testing. The output of each schedule becomes the input to the next.

---

## Fixed-Price Overrides

A manual override on `TransactionLineItem.UnitPrice` bypasses the entire adjustment schedule waterfall for that line. Use when a negotiated price is known and no schedule logic applies.

### Override via API

```apex
TransactionLineItem tli = [SELECT Id FROM TransactionLineItem WHERE Id = :tliId];
tli.UnitPrice = 750.00;  // overrides all schedule logic
update tli;
```

### Discount Approval on Override

If an approval process is configured on `Transaction`, overriding to a price below the approval threshold triggers the approval workflow. The transaction cannot move to `Activated` until approved.

---

## Multi-Currency Considerations

### PricebookEntry per Currency

In multi-currency orgs, create one `PricebookEntry` per product per currency per pricebook:

```soql
SELECT Id, Product2Id, CurrencyIsoCode, UnitPrice
FROM PricebookEntry
WHERE Pricebook2.IsStandard = true
AND Product2Id = '[productId]'
```

### Adjustment Schedules and Currency

- `PercentageDiscount` schedules are currency-agnostic — one schedule applies to all currencies
- `FixedDiscount` and `FixedPrice` schedules store amounts in the org's default currency. For multi-currency orgs, create separate `PriceAdjustmentSchedule` records per currency if fixed amounts differ

### Currency on Transaction

`Transaction.CurrencyIsoCode` determines which `PricebookEntry` records are eligible. All `TransactionLineItem` records on a transaction inherit the transaction's currency.

---

## Pricebook Selection in Transactions

When creating a `Transaction`, set `Pricebook2Id` explicitly:

```apex
Transaction txn = new Transaction(
    AccountId = accountId,
    TransactionType = 'Quote',
    Pricebook2Id = pricebook2Id,   // required — do not omit
    EffectiveDate = Date.today(),
    ExpirationDate = Date.today().addDays(30)
);
insert txn;
```

If `Pricebook2Id` is omitted and the org has a single active pricebook, the platform may default to it — but this behavior is not guaranteed. Always set it explicitly.

### Changing Pricebook Mid-Transaction

Changing `Transaction.Pricebook2Id` after `TransactionLineItem` records have been created invalidates existing `PricebookEntry` references on those TLIs and forces a reprice. This is safe in `Draft` status but should be avoided after pricing review has begun.

---

## Discount Approval Thresholds

Configure approval thresholds to prevent reps from applying excessive discounts without manager sign-off.

### Threshold on PriceAdjustmentSchedule

```apex
PriceAdjustmentSchedule schedule = new PriceAdjustmentSchedule(
    // ...
    MaxDiscountPercent = 25.0  // triggers approval above 25%
);
```

### Approval Workflow Integration

1. When a `Transaction` has a TLI whose effective discount exceeds `MaxDiscountPercent`, the transaction's approval status flag is set
2. An Approval Process on `Transaction` evaluates the flag and routes to the appropriate approver
3. Transaction activation is blocked until `Transaction.Status = 'Approved'`

---

## Net Price Calculation Order — Walkthrough

**Setup:**
- `PricebookEntry.UnitPrice = $1,000`
- Schedule 1 (Sequence 10): `PercentageDiscount`, 15% for qty ≥ 10
- Schedule 2 (Sequence 20): `FixedDiscount`, $50 flat
- `TransactionLineItem.Quantity = 15`
- No manual override

**Calculation:**
```
List Price:         $1,000.00
After Schedule 1:  $1,000.00 × (1 - 0.15) = $850.00
After Schedule 2:  $850.00 - $50.00        = $800.00
Net Unit Price:    $800.00
TotalAmount:       $800.00 × 15            = $12,000.00
```

**If manual override `UnitPrice = $900` is set:**
```
Waterfall skipped: $900.00
TotalAmount:       $900.00 × 15 = $13,500.00
```

---

## SOQL Patterns for Pricing Diagnostics

### List all adjustment schedules for a product

```soql
SELECT
    PriceAdjustmentSchedule.Name,
    PriceAdjustmentSchedule.AdjustmentType,
    PriceAdjustmentSchedule.Sequence,
    PriceAdjustmentTier.LowerBound,
    PriceAdjustmentTier.UpperBound,
    PriceAdjustmentTier.AdjustmentValue,
    PriceAdjustmentTier.TierType
FROM PriceAdjustmentTier
WHERE PriceAdjustmentSchedule.PricebookEntry.Product2Id = '[productId]'
ORDER BY PriceAdjustmentSchedule.Sequence, PriceAdjustmentTier.LowerBound
```

### Identify PricebookEntries with $0 UnitPrice

```soql
SELECT Id, Product2.Name, Pricebook2.Name, UnitPrice
FROM PricebookEntry
WHERE UnitPrice = 0
AND IsActive = true
```

### Check effective price on a TLI

```soql
SELECT
    Id,
    Product2.Name,
    Quantity,
    UnitPrice,
    TotalAmount,
    ParentTransactionLineItemId
FROM TransactionLineItem
WHERE TransactionId = '[transactionId]'
ORDER BY ParentTransactionLineItemId NULLS FIRST, Product2.Name
```
