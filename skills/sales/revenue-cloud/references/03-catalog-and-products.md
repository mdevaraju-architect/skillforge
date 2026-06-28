# Revenue Cloud New-Core — Catalog and Products

## ProductCatalog

`ProductCatalog` is the top-level container for the entire product hierarchy. Every product visible to the configurator must trace back to an active catalog.

### Creation

```apex
ProductCatalog cat = new ProductCatalog(
    Name = 'Core Product Catalog',
    Status = 'Draft',
    Description = 'Primary catalog for SaaS and professional services products'
);
insert cat;

// Activate when all categories and products are configured
cat.Status = 'Active';
update cat;
```

### Status Lifecycle

| Status | Behavior |
|---|---|
| `Draft` | Invisible to configurator and transaction UI; safe for setup work |
| `Active` | Visible to configurator; changes to categories take effect immediately |
| `Inactive` | Invisible to configurator; used to retire a catalog without deleting it |

**Critical:** Always build the catalog in `Draft` status and activate only when fully configured. Activating mid-setup can expose incomplete products to the sales UI.

---

## ProductCategory

Categories organize products into a hierarchy for browsing and filtering in the configurator.

### Single-Level Category

```apex
ProductCategory cat = new ProductCategory(
    Name = 'Cloud Infrastructure',
    ProductCatalogId = catalogId,
    IsActive = true,
    Sequence = 10
);
insert cat;
```

### Multi-Level Hierarchy

```apex
ProductCategory parent = new ProductCategory(
    Name = 'Software',
    ProductCatalogId = catalogId,
    IsActive = true,
    Sequence = 1
);
insert parent;

ProductCategory child = new ProductCategory(
    Name = 'SaaS Subscriptions',
    ProductCatalogId = catalogId,
    ParentCategoryId = parent.Id,
    IsActive = true,
    Sequence = 1
);
insert child;
```

Salesforce supports up to 10 levels of category nesting. Deep hierarchies become unwieldy in the configurator UI — limit to 3–4 levels for usability.

---

## ProductCategoryProduct (Junction)

Associates `Product2` to `ProductCategory`. A product can belong to multiple categories.

```apex
ProductCategoryProduct pcp = new ProductCategoryProduct(
    ProductId = product2Id,
    ProductCategoryId = categoryId,
    Sequence = 5  // display order within category
);
insert pcp;
```

### SOQL: Find Products Not in Any Category

```soql
SELECT Id, Name
FROM Product2
WHERE IsActive = true
AND Id NOT IN (
    SELECT ProductId FROM ProductCategoryProduct
    WHERE ProductCategory.ProductCatalog.Status = 'Active'
)
```

Products returned by this query are invisible to the configurator regardless of pricebook or classification setup.

---

## ProductClassification

`ProductClassification` is the attribute schema template. It defines the shape of configurable attributes for all products that reference it.

### Creation

```apex
ProductClassification cls = new ProductClassification(
    Name = 'SaaS_Subscription_v1',
    Status = 'Active',
    Description = 'Standard SaaS subscription with user count, term, and tier'
);
insert cls;
```

### Linking to Product2

```apex
Product2 p = [SELECT Id FROM Product2 WHERE Id = :productId];
p.ProductClassificationId = cls.Id;
update p;
```

### Versioning Strategy

Never edit a live classification. Instead:
1. Create a new `ProductClassification` with an incremented name (`SaaS_Subscription_v2`)
2. Add/remove attributes on the new version
3. Re-point products from the old classification to the new one (update `Product2.ProductClassificationId`)
4. Deactivate the old classification (`Status = 'Inactive'`) once no products reference it

---

## AttributeDefinition

Defines a single configurable attribute — its data type, constraints, and default value.

### Data Types

| DataType | UI Rendering | Constraints |
|---|---|---|
| `Text` | Text input field | None |
| `Number` | Numeric input | `MinValue`, `MaxValue` enforced |
| `Picklist` | Dropdown | Requires `AttributePicklistValue` records |
| `Boolean` | Checkbox / toggle | None |
| `Date` | Date picker | None |

### Creation Examples

```apex
// Number attribute — seat count
AttributeDefinition seatCount = new AttributeDefinition(
    Name = 'Seat Count',
    Code = 'SEAT_COUNT',
    DataType = 'Number',
    IsRequired = true,
    DefaultValue = '1',
    MinValue = 1,
    MaxValue = 10000
);
insert seatCount;

// Picklist attribute — subscription tier
AttributeDefinition tier = new AttributeDefinition(
    Name = 'Subscription Tier',
    Code = 'SUB_TIER',
    DataType = 'Picklist',
    IsRequired = true
);
insert tier;

// Boolean attribute — add-on enabled flag
AttributeDefinition addon = new AttributeDefinition(
    Name = 'Include Premier Support',
    Code = 'PREMIER_SUPPORT',
    DataType = 'Boolean',
    IsRequired = false,
    DefaultValue = 'false'
);
insert addon;
```

---

## AttributePicklistValue

For `Picklist`-type `AttributeDefinition` records, one or more `AttributePicklistValue` records must be created. Without them, the picklist renders empty in the configurator.

```apex
List<AttributePicklistValue> values = new List<AttributePicklistValue>{
    new AttributePicklistValue(
        AttributeDefinitionId = tier.Id,
        Value = 'starter',
        Label = 'Starter',
        Sequence = 1,
        IsDefault = false
    ),
    new AttributePicklistValue(
        AttributeDefinitionId = tier.Id,
        Value = 'professional',
        Label = 'Professional',
        Sequence = 2,
        IsDefault = true
    ),
    new AttributePicklistValue(
        AttributeDefinitionId = tier.Id,
        Value = 'enterprise',
        Label = 'Enterprise',
        Sequence = 3,
        IsDefault = false
    )
};
insert values;
```

---

## AttributeCategory

Groups related attributes together for display in the configurator. Purely organizational — does not affect pricing or validation.

```apex
AttributeCategory ac = new AttributeCategory(
    Name = 'Subscription Details',
    Sequence = 1,
    Description = 'Core subscription configuration options'
);
insert ac;
```

---

## ProductClassificationAttribute (Junction)

Links `AttributeDefinition` (and optionally `AttributeCategory`) to a `ProductClassification`. This is the many-to-many join that makes attributes appear for products using a given classification.

```apex
ProductClassificationAttribute pca = new ProductClassificationAttribute(
    ProductClassificationId = cls.Id,
    AttributeDefinitionId = seatCount.Id,
    AttributeCategoryId = ac.Id,
    Sequence = 1
);
insert pca;
```

### SOQL: Retrieve All Attributes for a Classification

```soql
SELECT
    AttributeDefinition.Name,
    AttributeDefinition.DataType,
    AttributeDefinition.IsRequired,
    AttributeCategory.Name,
    Sequence
FROM ProductClassificationAttribute
WHERE ProductClassificationId = '[classificationId]'
ORDER BY Sequence ASC
```

---

## Product Bundle Structure

Bundles in Revenue Cloud are standard `Product2` records with `Type = 'Bundle'`. Bundle structure at the transaction level uses `ParentTransactionLineItemId` on `TransactionLineItem`, not a separate bundle object.

### Bundle Product Setup

```apex
// Bundle parent (container)
Product2 bundleParent = new Product2(
    Name = 'Enterprise Suite',
    ProductCode = 'ENT-SUITE',
    Type = 'Bundle',
    IsActive = true,
    ProductClassificationId = bundleClassificationId
);
insert bundleParent;

// Bundle components (add independently to catalog)
Product2 component1 = new Product2(
    Name = 'Core Platform',
    ProductCode = 'CORE-PLAT',
    IsActive = true,
    ProductClassificationId = coreClassificationId
);
Product2 component2 = new Product2(
    Name = 'Analytics Add-on',
    ProductCode = 'ANALYTICS',
    IsActive = true,
    ProductClassificationId = analyticsClassificationId
);
insert new List<Product2>{ component1, component2 };
```

### Bundle Relationship at Transaction Time

Bundle parent-child relationships are defined at the `TransactionLineItem` level (not at the product catalog level). The catalog only needs all component products to be associated to a category. See [05-transactions-and-billing.md](05-transactions-and-billing.md) for TLI bundle setup.

---

## Product Lifecycle

Products move through lifecycle states controlled by `Product2.IsActive` and metadata activation.

| State | IsActive | In Catalog | Visible in Configurator | Notes |
|---|---|---|---|---|
| **Draft** | false | Optional | No | Under construction |
| **Active** | true | Yes | Yes | Available for sale |
| **Deprecated** | false | Yes | No | Existing TLIs still valid; no new quotes |
| **Retired** | false | No (PCP deleted) | No | Remove ProductCategoryProduct to retire |

### Deprecating a Product

1. Set `Product2.IsActive = false` — hides from configurator
2. Leave `ProductCategoryProduct` in place — historical transactions remain valid
3. Do not delete `PricebookEntry` — existing activated transactions reference it

### Retiring a Product Completely

1. Confirm no open (non-Activated) transactions reference the product
2. Delete `ProductCategoryProduct` junction records
3. Set `Product2.IsActive = false`
4. Archive or deactivate `PricebookEntry`

```soql
-- Check for open transactions referencing a product before retiring
SELECT COUNT()
FROM TransactionLineItem
WHERE Product2Id = '[productId]'
AND Transaction.Status NOT IN ('Activated', 'Cancelled')
```

---

## SOQL Patterns for Catalog Debugging

### Full catalog chain for a product

```soql
SELECT
    Product2.Name,
    Product2.IsActive,
    Product2.ProductClassification.Name,
    Product2.ProductClassification.Status,
    ProductCategory.Name,
    ProductCategory.IsActive,
    ProductCategory.ProductCatalog.Name,
    ProductCategory.ProductCatalog.Status
FROM ProductCategoryProduct
WHERE Product2Id = '[productId]'
```

### All active products in a catalog

```soql
SELECT Product2.Id, Product2.Name, ProductCategory.Name
FROM ProductCategoryProduct
WHERE ProductCategory.ProductCatalog.Status = 'Active'
AND Product2.IsActive = true
ORDER BY ProductCategory.Name, Product2.Name
```

### Products with missing AttributePicklistValues

```soql
SELECT AttributeDefinition.Name, AttributeDefinition.Code
FROM ProductClassificationAttribute
WHERE AttributeDefinition.DataType = 'Picklist'
AND AttributeDefinition.Id NOT IN (
    SELECT AttributeDefinitionId FROM AttributePicklistValue
)
```
