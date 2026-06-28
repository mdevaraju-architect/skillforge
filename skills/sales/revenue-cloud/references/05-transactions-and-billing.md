# Revenue Cloud New-Core — Transactions, Billing, and Revenue Recognition

## Transaction Object

`Transaction` is the New-Core Revenue Cloud replacement for both the legacy `Quote` and legacy `Order` objects. A single `Transaction` can represent a quote, an order, an amendment, or a renewal depending on `TransactionType`.

### TransactionType Values

| TransactionType | Use Case |
|---|---|
| `Quote` | Pre-sale pricing presentation; can be converted to Order |
| `Order` | Binding commitment; activates billing and revenue recognition |
| `Amendment` | Mid-term change to an active subscription transaction |
| `Renewal` | New term continuation of an expiring transaction |

### Transaction Status Lifecycle

```
Draft → Calculated → (Approved) → Activated → Cancelled
                         ↑
                 only if approval process
                  configured and triggered
```

- **Draft** — editable; TLIs can be added, changed, or removed
- **Calculated** — pricing has been run; TLIs have net prices
- **Approved** — discount approval obtained (if required)
- **Activated** — immutable; billing schedules and revenue transactions are generated
- **Cancelled** — terminal; no further changes; billing is halted

### Creating a Transaction

```apex
Transaction txn = new Transaction(
    AccountId = accountId,
    TransactionType = 'Quote',
    Pricebook2Id = pricebook2Id,
    EffectiveDate = Date.today(),
    ExpirationDate = Date.today().addDays(90),
    CurrencyIsoCode = 'USD'
);
insert txn;
```

---

## TransactionLineItem (TLI) — Required Fields

Minimum required fields for a valid `TransactionLineItem`:

| Field | Required | Notes |
|---|---|---|
| `TransactionId` | Yes | Parent transaction |
| `Product2Id` | Yes | Product being sold |
| `Quantity` | Yes | Number of units |
| `UnitPrice` | Conditional | Required if no pricing waterfall resolves the price; optional if waterfall provides it |
| `StartDate` | Yes | Line item coverage start |
| `EndDate` | Yes (for subscriptions) | Line item coverage end; derived from `SubscriptionTerm` if not set |
| `BillingFrequency` | Yes (for subscriptions) | `Monthly`, `Quarterly`, `Annual`, `OneTime` |
| `SubscriptionTerm` | Yes (for subscriptions) | Term in months (e.g., `12` = 1 year) |

### Creating a Subscription TLI

```apex
TransactionLineItem tli = new TransactionLineItem(
    TransactionId = txn.Id,
    Product2Id = product2Id,
    Quantity = 25,
    StartDate = Date.today(),
    EndDate = Date.today().addMonths(12),
    BillingFrequency = 'Monthly',
    SubscriptionTerm = 12
    // UnitPrice omitted — will be resolved by pricing waterfall
);
insert tli;
```

### Creating a One-Time TLI

```apex
TransactionLineItem onetimeTli = new TransactionLineItem(
    TransactionId = txn.Id,
    Product2Id = onetimeProductId,
    Quantity = 1,
    UnitPrice = 5000.00,
    BillingFrequency = 'OneTime',
    StartDate = Date.today()
    // SubscriptionTerm omitted — not applicable for one-time
);
insert onetimeTli;
```

---

## Bundle Configuration in TransactionLineItems

Bundle parent-child relationships are established using `ParentTransactionLineItemId`.

### Creating a Bundle Transaction

```apex
// Step 1: Create the bundle parent TLI (container, $0)
TransactionLineItem parentTli = new TransactionLineItem(
    TransactionId = txn.Id,
    Product2Id = bundleParentProductId,
    Quantity = 1,
    UnitPrice = 0.00,    // container bundles are $0; children carry price
    BillingFrequency = 'Annual',
    SubscriptionTerm = 12,
    StartDate = Date.today(),
    EndDate = Date.today().addMonths(12)
);
insert parentTli;

// Step 2: Create child TLIs referencing the parent
List<TransactionLineItem> children = new List<TransactionLineItem>{
    new TransactionLineItem(
        TransactionId = txn.Id,
        Product2Id = corePlatformProductId,
        Quantity = 25,
        BillingFrequency = 'Annual',
        SubscriptionTerm = 12,
        StartDate = Date.today(),
        EndDate = Date.today().addMonths(12),
        ParentTransactionLineItemId = parentTli.Id   // key field
    ),
    new TransactionLineItem(
        TransactionId = txn.Id,
        Product2Id = analyticsAddonProductId,
        Quantity = 25,
        BillingFrequency = 'Annual',
        SubscriptionTerm = 12,
        StartDate = Date.today(),
        EndDate = Date.today().addMonths(12),
        ParentTransactionLineItemId = parentTli.Id
    )
};
insert children;
```

### Querying Bundle Totals

```soql
-- Get bundle subtotal (sum of children — NOT the parent TLI)
SELECT SUM(TotalAmount)
FROM TransactionLineItem
WHERE ParentTransactionLineItemId = '[parentTliId]'
```

---

## Setting Attribute Values on TLIs

When products have configurable attributes, set `TransactionLineItemAttribute` records after creating the TLI.

```apex
// Set the "Seat Count" attribute on a TLI
TransactionLineItemAttribute seatAttr = new TransactionLineItemAttribute(
    TransactionLineItemId = tli.Id,
    AttributeDefinitionId = seatCountAttrDefId,
    Value = '25'
);

// Set the "Subscription Tier" attribute
TransactionLineItemAttribute tierAttr = new TransactionLineItemAttribute(
    TransactionLineItemId = tli.Id,
    AttributeDefinitionId = subTierAttrDefId,
    Value = 'professional'
);

insert new List<TransactionLineItemAttribute>{ seatAttr, tierAttr };
```

---

## Transaction Activation and BillingSchedule Auto-Generation

When a `Transaction` is activated (status moved to `Activated`), the platform automatically generates `BillingSchedule` records for subscription TLIs.

```apex
Transaction txn = [SELECT Id, Status FROM Transaction WHERE Id = :txnId];
txn.Status = 'Activated';
update txn;
// Platform now auto-creates BillingSchedule records for all subscription TLIs
```

### BillingSchedule Generation Rules

| TLI.BillingFrequency | TLI.SubscriptionTerm | BillingSchedules Created |
|---|---|---|
| `Monthly` | 12 | 12 records (one per month) |
| `Quarterly` | 12 | 4 records (one per quarter) |
| `Annual` | 12 | 1 record |
| `Annual` | 24 | 2 records |
| `OneTime` | any/null | 1 record (immediate billing) |

### Do Not Create BillingSchedules Manually

The platform owns `BillingSchedule` creation for subscription lines. Manual inserts cause duplicate schedules and billing errors. If you need to add a one-time charge not covered by subscription logic, create a separate TLI with `BillingFrequency = 'OneTime'` and let the platform generate the single billing schedule.

### Verifying Generated BillingSchedules

```soql
SELECT
    Id,
    TransactionLineItemId,
    BillingFrequency,
    Amount,
    NextBillingDate,
    BilledToDate,
    Status
FROM BillingSchedule
WHERE TransactionLineItemId IN (
    SELECT Id FROM TransactionLineItem WHERE TransactionId = '[txnId]'
)
ORDER BY NextBillingDate ASC
```

---

## Amendment Pattern

### Rules for Amendments

1. The original transaction is **immutable** once Activated — its TLIs cannot be updated
2. Create a new `Transaction` with `TransactionType = 'Amendment'`
3. Set `AmendedTransactionId` to reference the original transaction
4. Amendment TLIs reference original TLIs via `AmendedTransactionLineItemId` for changes; net-new additions do not need this reference
5. The amendment transaction covers the remaining term from the amendment effective date

### Amendment: Add Seats Mid-Term

```apex
// Original transaction was activated on 2026-01-01, expires 2026-12-31
// Amendment effective 2026-07-01: add 10 seats for remaining 6 months

Transaction amendment = new Transaction(
    AccountId = originalTxn.AccountId,
    TransactionType = 'Amendment',
    AmendedTransactionId = originalTxn.Id,
    Pricebook2Id = originalTxn.Pricebook2Id,
    EffectiveDate = Date.newInstance(2026, 7, 1),
    ExpirationDate = Date.newInstance(2026, 12, 31)  // same end date as original
);
insert amendment;

// Add delta TLI: +10 seats (not replacing original — just the increment)
TransactionLineItem deltaLine = new TransactionLineItem(
    TransactionId = amendment.Id,
    Product2Id = originalTliProductId,
    Quantity = 10,                                        // delta quantity only
    BillingFrequency = 'Monthly',
    SubscriptionTerm = 6,                                 // remaining term
    StartDate = Date.newInstance(2026, 7, 1),
    EndDate = Date.newInstance(2026, 12, 31),
    AmendedTransactionLineItemId = originalTli.Id         // references what's being changed
);
insert deltaLine;

// Activate the amendment
amendment.Status = 'Activated';
update amendment;
// New BillingSchedule records created for 6 remaining months on the +10 seats
```

---

## Renewal Pattern

### Rules for Renewals

1. Create a new `Transaction` with `TransactionType = 'Renewal'`
2. Set `RenewedTransactionId` to the expiring transaction
3. Set `EffectiveDate` to the day after the expiring transaction's `ExpirationDate`
4. Clone TLIs from the original (same products, updated dates, any pricing changes applied)

```apex
Transaction renewal = new Transaction(
    AccountId = expiringTxn.AccountId,
    TransactionType = 'Renewal',
    RenewedTransactionId = expiringTxn.Id,
    Pricebook2Id = expiringTxn.Pricebook2Id,
    EffectiveDate = expiringTxn.ExpirationDate.addDays(1),
    ExpirationDate = expiringTxn.ExpirationDate.addYears(1)
);
insert renewal;

// Clone TLIs with updated dates (and any pricing changes)
List<TransactionLineItem> renewalLines = new List<TransactionLineItem>();
for (TransactionLineItem origTli : [
    SELECT Product2Id, Quantity, BillingFrequency, SubscriptionTerm
    FROM TransactionLineItem
    WHERE TransactionId = :expiringTxn.Id
    AND ParentTransactionLineItemId = null
]) {
    renewalLines.add(new TransactionLineItem(
        TransactionId = renewal.Id,
        Product2Id = origTli.Product2Id,
        Quantity = origTli.Quantity,
        BillingFrequency = origTli.BillingFrequency,
        SubscriptionTerm = origTli.SubscriptionTerm,
        StartDate = renewal.EffectiveDate,
        EndDate = renewal.ExpirationDate
    ));
}
insert renewalLines;
```

---

## RevenueTransaction and Revenue Recognition

### How RevenueTransaction Records Are Created

The Revenue Recognition engine creates `RevenueTransaction` records automatically when:
1. A `BillingSchedule` milestone date is reached (scheduled recognition)
2. A recognition event fires based on a `RevenueRecognitionRule` (event-based recognition)

**Do not manually insert `RevenueTransaction` records.** The RevRec engine owns this object. Manual inserts corrupt recognition state and cannot be reconciled without support intervention.

### Viewing RevenueTransactions

Requires the `RevenueCloudRevenueRecognition` permission set.

```soql
SELECT
    Id,
    BillingScheduleId,
    BillingSchedule.TransactionLineItem.Product2.Name,
    RecognitionDate,
    Amount,
    RecognitionStatus,
    RevenueRecognitionRuleId
FROM RevenueTransaction
WHERE BillingSchedule.TransactionLineItemId IN (
    SELECT Id FROM TransactionLineItem WHERE TransactionId = '[txnId]'
)
ORDER BY RecognitionDate ASC
```

### Recognition Statuses

| RecognitionStatus | Meaning |
|---|---|
| `Pending` | Scheduled for future recognition |
| `Recognized` | Revenue has been recognized; posted to general ledger |
| `Reversed` | Recognition was reversed (e.g., due to a cancellation or amendment) |

---

## SOQL Patterns for Transaction Reporting

### Active subscriptions with their next billing date

```soql
SELECT
    TransactionLineItem.Transaction.Account.Name,
    TransactionLineItem.Product2.Name,
    TransactionLineItem.Quantity,
    TransactionLineItem.TotalAmount,
    BillingFrequency,
    NextBillingDate,
    Amount,
    Status
FROM BillingSchedule
WHERE Status = 'Pending'
AND NextBillingDate >= TODAY
ORDER BY NextBillingDate ASC
```

### Subscriptions expiring in the next 90 days

```soql
SELECT
    Id,
    Account.Name,
    ExpirationDate,
    TransactionType,
    Status
FROM Transaction
WHERE ExpirationDate >= TODAY
AND ExpirationDate <= NEXT_90_DAYS
AND Status = 'Activated'
AND TransactionType IN ('Quote', 'Order')
ORDER BY ExpirationDate ASC
```

### Amendment history for a transaction

```soql
SELECT
    Id,
    TransactionType,
    EffectiveDate,
    Status,
    AmendedTransactionId
FROM Transaction
WHERE AmendedTransactionId = '[originalTxnId]'
ORDER BY EffectiveDate ASC
```

### Revenue recognized by month (requires RevenueCloudRevenueRecognition permset)

```soql
SELECT
    CALENDAR_MONTH(RecognitionDate) month,
    CALENDAR_YEAR(RecognitionDate) year,
    SUM(Amount) totalRecognized
FROM RevenueTransaction
WHERE RecognitionStatus = 'Recognized'
AND RecognitionDate = THIS_YEAR
GROUP BY CALENDAR_YEAR(RecognitionDate), CALENDAR_MONTH(RecognitionDate)
ORDER BY CALENDAR_YEAR(RecognitionDate), CALENDAR_MONTH(RecognitionDate)
```

### Bundle structure with totals

```soql
SELECT
    Id,
    Product2.Name,
    Quantity,
    UnitPrice,
    TotalAmount,
    ParentTransactionLineItemId,
    (
        SELECT Id, Product2.Name, Quantity, UnitPrice, TotalAmount
        FROM ChildTransactionLineItems  -- child relationship name
    )
FROM TransactionLineItem
WHERE TransactionId = '[txnId]'
AND ParentTransactionLineItemId = null  -- top-level lines only
```
