# Revenue Cloud New-Core — Architecture & Object Model

## Overview

New-Core Revenue Cloud is built on the Salesforce Industries infrastructure (formerly Vlocity). It replaces the legacy CPQ (SBQQ__) and legacy Order Management System (OMS) with a unified object model for product catalog management, pricing, transactions, subscription billing, and revenue recognition.

The object model has three major layers:

1. **Catalog layer** — defines what can be sold
2. **Pricing layer** — defines how much it costs
3. **Transaction layer** — records what was sold and triggers billing/revenue recognition

---

## Full Object Model Diagram

```
CATALOG LAYER
─────────────────────────────────────────────────────────────────────────────
ProductCatalog
  │  Status (Active/Draft/Inactive)
  │  Name, Description
  │
  └──► ProductCategory (many per catalog)
         │  ProductCatalogId (lookup → ProductCatalog)
         │  ParentCategoryId (self-lookup, for hierarchy)
         │  Name, IsActive
         │
         └──► ProductCategoryProduct (junction)
                │  ProductCategoryId (lookup → ProductCategory)
                │  ProductId         (lookup → Product2)
                │
                └──► Product2
                       │  ProductClassificationId (lookup → ProductClassification)
                       │  Name, ProductCode, Family, IsActive
                       │  Type (Product/Bundle/Service)
                       │
                       └──► ProductClassification
                              │  Name, Status
                              │
                              └──► ProductClassificationAttribute (junction)
                                     │  ProductClassificationId
                                     │  AttributeDefinitionId
                                     │  AttributeCategoryId
                                     │
                                     ├──► AttributeDefinition
                                     │      DataType (Text/Number/Picklist/Boolean/Date)
                                     │      Name, Code, IsRequired
                                     │      MinValue, MaxValue (for Number)
                                     │      DefaultValue
                                     │
                                     │      └──► AttributePicklistValue (for Picklist type)
                                     │             AttributeDefinitionId
                                     │             Value, Label, Sequence, IsDefault
                                     │
                                     └──► AttributeCategory
                                            Name, Sequence, Description


PRICING LAYER
─────────────────────────────────────────────────────────────────────────────
Pricebook2
  │  Name, IsActive, IsStandard
  │
  └──► PricebookEntry
         │  Pricebook2Id  (lookup → Pricebook2)
         │  Product2Id    (lookup → Product2)
         │  UnitPrice     (list price baseline)
         │  CurrencyIsoCode, IsActive
         │
         └──► PriceAdjustmentSchedule
                │  PricebookEntryId  (lookup → PricebookEntry)
                │  AdjustmentType   (PercentageDiscount/FixedDiscount/FixedPrice)
                │  Name, Sequence   (order of application in waterfall)
                │
                └──► PriceAdjustmentTier
                       PriceAdjustmentScheduleId
                       LowerBound, UpperBound  (quantity/value range)
                       AdjustmentValue         (amount or percentage)
                       TierType                (Volume/Slab)


TRANSACTION LAYER
─────────────────────────────────────────────────────────────────────────────
Transaction
  │  AccountId, Pricebook2Id
  │  TransactionType  (Quote/Order/Amendment/Renewal)
  │  Status           (Draft/Calculated/Approved/Activated/Cancelled)
  │  AmendedTransactionId  (lookup → Transaction, for amendments)
  │  RenewedTransactionId  (lookup → Transaction, for renewals)
  │  EffectiveDate, ExpirationDate
  │
  └──► TransactionLineItem (TLI)
         │  TransactionId               (lookup → Transaction)
         │  Product2Id                  (lookup → Product2)
         │  ParentTransactionLineItemId (self-lookup, for bundle children)
         │  AmendedTransactionLineItemId (lookup → TLI, for amendment deltas)
         │  Quantity, UnitPrice, TotalAmount
         │  BillingFrequency     (Monthly/Quarterly/Annual/OneTime)
         │  SubscriptionTerm     (integer, months)
         │  StartDate, EndDate
         │
         ├──► TransactionLineItemAttribute
         │      TransactionLineItemId
         │      AttributeDefinitionId
         │      Value  (stores runtime attribute value)
         │
         └──► BillingSchedule (auto-generated on activation)
                │  TransactionLineItemId
                │  BillingFrequency, Amount
                │  NextBillingDate, BilledToDate
                │  Status (Pending/Invoiced/Cancelled)
                │
                └──► RevenueTransaction (auto-created by RevRec engine)
                       BillingScheduleId
                       RecognitionDate, Amount
                       RecognitionStatus
                       RevenueRecognitionRuleId
```

---

## Key Field Reference Tables

### ProductCatalog

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Catalog display name |
| `Status` | Picklist | `Active`, `Draft`, `Inactive` — must be `Active` for configurator visibility |
| `Description` | TextArea | Optional description |
| `IsDeleted` | Boolean | Soft delete flag |

### ProductCategory

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Category display name |
| `ProductCatalogId` | Lookup(ProductCatalog) | Parent catalog — required |
| `ParentCategoryId` | Lookup(ProductCategory) | Parent category for hierarchy — nullable |
| `IsActive` | Boolean | Must be true for category to display |
| `Sequence` | Number | Display sort order |

### ProductCategoryProduct (Junction)

| Field API Name | Type | Description |
|---|---|---|
| `ProductId` | Lookup(Product2) | Associated product |
| `ProductCategoryId` | Lookup(ProductCategory) | Associated category |
| `Sequence` | Number | Display sort order within category |

### Product2 (Revenue Cloud relevant fields)

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Product display name |
| `ProductCode` | Text | Unique code |
| `Family` | Picklist | Product family grouping |
| `IsActive` | Boolean | Must be `true` for sale |
| `ProductClassificationId` | Lookup(ProductClassification) | Drives attribute configurability |
| `Type` | Picklist | `Product`, `Bundle`, `Service` |
| `SubscriptionType` | Picklist | `Renewable`, `Evergreen`, `OneTime` |

### ProductClassification

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Classification name (version it: `SaaS_v1`, `SaaS_v2`) |
| `Status` | Picklist | `Active`, `Inactive` |
| `Description` | TextArea | Purpose of this classification |

### AttributeDefinition

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Attribute display name |
| `Code` | Text | API-style unique code |
| `DataType` | Picklist | `Text`, `Number`, `Picklist`, `Boolean`, `Date` |
| `IsRequired` | Boolean | Whether configurator enforces a value |
| `DefaultValue` | Text | Pre-filled value in configurator |
| `MinValue` | Number | Minimum (for Number type) |
| `MaxValue` | Number | Maximum (for Number type) |

### AttributePicklistValue

| Field API Name | Type | Description |
|---|---|---|
| `AttributeDefinitionId` | Lookup(AttributeDefinition) | Parent attribute |
| `Value` | Text | Stored value |
| `Label` | Text | Displayed label in configurator |
| `Sequence` | Number | Display sort order |
| `IsDefault` | Boolean | Pre-selected in configurator |

### Pricebook2 / PricebookEntry

| Field API Name | Type | Description |
|---|---|---|
| `Pricebook2.IsStandard` | Boolean | True only for the Standard Pricebook |
| `PricebookEntry.UnitPrice` | Currency | List price — waterfall baseline |
| `PricebookEntry.Product2Id` | Lookup(Product2) | Associated product |
| `PricebookEntry.Pricebook2Id` | Lookup(Pricebook2) | Associated pricebook |
| `PricebookEntry.IsActive` | Boolean | Must be `true` |

### PriceAdjustmentSchedule

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `Name` | Text | Schedule name |
| `PricebookEntryId` | Lookup(PricebookEntry) | Associated pricebook entry |
| `AdjustmentType` | Picklist | `PercentageDiscount`, `FixedDiscount`, `FixedPrice` |
| `Sequence` | Number | Application order in waterfall |

### PriceAdjustmentTier

| Field API Name | Type | Description |
|---|---|---|
| `PriceAdjustmentScheduleId` | Lookup(PriceAdjustmentSchedule) | Parent schedule |
| `LowerBound` | Number | Tier range lower bound (quantity or value) |
| `UpperBound` | Number | Tier range upper bound (null = unlimited) |
| `AdjustmentValue` | Number | Discount amount or percentage |
| `TierType` | Picklist | `Volume` (apply to all units) or `Slab` (apply only to units in tier) |

### Transaction

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `AccountId` | Lookup(Account) | Customer account |
| `Pricebook2Id` | Lookup(Pricebook2) | Active pricebook for this transaction |
| `TransactionType` | Picklist | `Quote`, `Order`, `Amendment`, `Renewal` |
| `Status` | Picklist | `Draft`, `Calculated`, `Approved`, `Activated`, `Cancelled` |
| `AmendedTransactionId` | Lookup(Transaction) | Original transaction being amended |
| `RenewedTransactionId` | Lookup(Transaction) | Transaction being renewed |
| `EffectiveDate` | Date | Start date of coverage |
| `ExpirationDate` | Date | End date of coverage |

### TransactionLineItem (TLI)

| Field API Name | Type | Description |
|---|---|---|
| `Id` | ID | Record identifier |
| `TransactionId` | Lookup(Transaction) | Parent transaction |
| `Product2Id` | Lookup(Product2) | Product on this line |
| `ParentTransactionLineItemId` | Lookup(TransactionLineItem) | Bundle parent — null for top-level |
| `AmendedTransactionLineItemId` | Lookup(TransactionLineItem) | Original TLI being amended |
| `Quantity` | Number | Quantity of units |
| `UnitPrice` | Currency | Per-unit price (override or calculated) |
| `TotalAmount` | Currency | Quantity × UnitPrice (or net after adjustments) |
| `BillingFrequency` | Picklist | `Monthly`, `Quarterly`, `Annual`, `OneTime` |
| `SubscriptionTerm` | Number | Term length in months |
| `StartDate` | Date | Line start date |
| `EndDate` | Date | Line end date |

### BillingSchedule

| Field API Name | Type | Description |
|---|---|---|
| `TransactionLineItemId` | Lookup(TransactionLineItem) | Source TLI |
| `BillingFrequency` | Picklist | Inherited from TLI |
| `Amount` | Currency | Invoice amount for this period |
| `NextBillingDate` | Date | When next invoice fires |
| `BilledToDate` | Date | Covered through date |
| `Status` | Picklist | `Pending`, `Invoiced`, `Cancelled` |

### RevenueTransaction

| Field API Name | Type | Description |
|---|---|---|
| `BillingScheduleId` | Lookup(BillingSchedule) | Source billing event |
| `RecognitionDate` | Date | Date revenue is recognized |
| `Amount` | Currency | Recognized revenue amount |
| `RecognitionStatus` | Picklist | `Pending`, `Recognized`, `Reversed` |
| `RevenueRecognitionRuleId` | Lookup(RevenueRecognitionRule) | Applied recognition rule |

---

## Object Relationship Summary

```
ProductCatalog ──(1:N)──► ProductCategory ──(1:N)──► ProductCategoryProduct ──(N:1)──► Product2
                                                                                            │
                                                                                            ▼
                                                                               ProductClassification
                                                                                            │
                                                                               ProductClassificationAttribute
                                                                                       │           │
                                                                               AttributeDefinition  AttributeCategory
                                                                                       │
                                                                               AttributePicklistValue

Pricebook2 ──(1:N)──► PricebookEntry ──(1:N)──► PriceAdjustmentSchedule ──(1:N)──► PriceAdjustmentTier

Transaction ──(1:N)──► TransactionLineItem ──(1:N)──► TransactionLineItemAttribute
                              │
                              └──(1:N)──► BillingSchedule ──(1:N)──► RevenueTransaction
```
