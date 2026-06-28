# 02 — SOQL Optimisation

## Selective query rules

A SOQL query is **selective** if Salesforce determines it will return a small enough fraction of the object's total records that using an index is more efficient than a full table scan. Selectivity is evaluated by the Salesforce query optimizer at query time.

### Selectivity thresholds

| Object record count | Selectivity threshold (% of total rows) | Absolute row threshold |
|---|---|---|
| Any | < 10% of total records | — |
| Standard objects | — | < 333,333 rows returned |
| Custom objects | — | < 1,000,000 rows returned |

A query is selective if it meets **either** the percentage threshold or the absolute row threshold, whichever is smaller.

**Example:**
- Object has 500,000 records.
- 10% = 50,000 rows.
- A query that would return 60,000 rows is NOT selective (exceeds 10% even though it's under 333k).
- A query that would return 45,000 rows IS selective.

### When selectivity is not applied

Salesforce may skip the selectivity check and always use an index for:
- Queries with `WHERE Id = :someId` (primary key — always selective)
- Queries on objects with fewer than ~100,000 records (threshold below which full scan is fast enough)

### Non-selective query error

When a query is non-selective against a large object:
```
System.QueryException: Non-selective query against large object type (more than 100000 rows).
Consider an indexed filter or contact salesforce.com about custom indexing.
```

This error is thrown at runtime. The query plan tool in Developer Console shows this before runtime.

---

## Standard indexed fields by object

These fields have standard database indexes maintained by Salesforce. Filtering on them produces selective queries (subject to selectivity thresholds).

| Object | Standard indexed fields |
|---|---|
| All objects | `Id`, `OwnerId`, `CreatedDate`, `LastModifiedDate`, `SystemModstamp`, `Name` (most objects), `RecordTypeId`, `IsDeleted` |
| Account | `Id`, `Name`, `OwnerId`, `CreatedDate`, `LastModifiedDate`, `ParentId` |
| Contact | `Id`, `AccountId`, `OwnerId`, `CreatedDate`, `Email` (unique), `LastModifiedDate` |
| Lead | `Id`, `OwnerId`, `Email` (unique), `CreatedDate`, `IsConverted` |
| Opportunity | `Id`, `AccountId`, `OwnerId`, `CloseDate`, `CreatedDate`, `StageName` (not indexed — common gotcha) |
| Case | `Id`, `AccountId`, `ContactId`, `OwnerId`, `Status` (not indexed — common gotcha), `CreatedDate` |
| Task / Event | `Id`, `WhoId`, `WhatId`, `OwnerId`, `ActivityDate` |
| User | `Id`, `Username` (unique), `Email` (unique), `ProfileId` |

> **Note:** `StageName` on Opportunity and `Status` on Case are NOT indexed despite being common filter fields. Queries filtering only on these fields against large orgs are non-selective.

---

## Custom index setup

### Auto-indexed custom fields

Creating a custom field with either of these attributes automatically creates a database index:
- **External ID** (`ExternalId = true`): creates a standard index; also enables upsert by this field.
- **Unique** (`Unique = true`): creates a unique index; enforces uniqueness constraint.

Both options work for: Text, Number, Email, Phone, URL, Currency, Percent field types.

**These field types do NOT get auto-indexed via External ID or Unique:**
- Date, DateTime
- Checkbox
- Picklist, Multi-Select Picklist
- Long Text Area, Text Area
- Formula (unless the base field is indexed)
- Lookup (the lookup ID field is indexed, but not the related record's fields)

### Requesting a custom index via Salesforce support

For fields that cannot be auto-indexed, request a custom index via a Salesforce support case:

**Required information for the support case:**
1. Org ID (15- or 18-digit)
2. Object API name (e.g. `Opportunity`, `My_Custom_Object__c`)
3. Field API name (e.g. `CloseDate`, `My_Date_Field__c`)
4. A representative SOQL query that needs the index
5. Approximate record count for the object
6. Business justification

**Fields commonly requested as custom indexes:**
- `CreatedDate` / `LastModifiedDate` on custom objects (already indexed on standard objects but may need custom index support on custom objects for specific query patterns)
- Date / DateTime fields used as primary query filters
- Picklist fields used in WHERE clauses on objects with > 1M records

### Composite indexes

A composite index covers multiple fields in a single index structure. It is useful when queries always filter on the same combination of fields.

Example: A query that always filters `WHERE Type__c = :type AND Status__c = :status AND CreatedDate >= :startDate` would benefit from a composite index on `(Type__c, Status__c, CreatedDate)`.

Composite indexes are only available through Salesforce support and are not configurable in Setup. The field order in the index matters: the first field in the index must appear in the WHERE clause for the index to be used.

---

## Query Plan tool

The Query Plan tool is built into the Salesforce Developer Console and is the primary diagnostic for SOQL performance.

### Accessing the Query Plan tool

1. Open Developer Console (Setup → Developer Console, or from App Launcher).
2. Click **Query Editor** tab at the bottom.
3. Enter SOQL in the text area.
4. Click **Query Plan** button (NOT the Execute button).

### Reading Query Plan output

The output table has the following columns:

| Column | Meaning |
|---|---|
| **Cardinality** | Estimated number of rows the query will return |
| **Fields** | Fields used by this query plan option |
| **Lead Count** | Number of leading rows examined for this plan |
| **Cost** | Relative cost of this plan. **< 1 = index used (good). > 1 = full table scan (bad).** |
| **SObject Cardinality** | Total record count for the object |
| **Notes** | Explanation of the plan choice (e.g. "Not Selective Query", "Index: CUSTOM-INDEX-Name") |

**Cost interpretation:**
- Cost = 0.0–0.5: Highly selective; efficient index use.
- Cost = 0.5–1.0: Moderately selective; index used.
- Cost = 1.0: Break-even; optimizer may choose index or scan.
- Cost > 1.0: Full table scan; performance will degrade with record count.

**Multiple plans in output:** The Query Plan tool shows all considered plans. The plan with the lowest cost is what Salesforce will execute. If all plans show cost > 1, there is no good index for this query.

### Query Plan limitations

- Costs are estimates based on statistics; actual execution may differ slightly.
- The tool does not simulate production data volumes unless you are running against a full-copy sandbox.
- Query Plan does not account for sharing rules (row-level security), which add an additional filter at execution time.
- It does not show Flow-generated queries; only the queries you paste into the editor.

---

## Non-selective query error remediation

When you encounter `System.QueryException: Non-selective query against large object type`:

### Remediation options (in order of preference)

1. **Add an indexed field to the WHERE clause** — if a standard indexed field (Id, OwnerId, CreatedDate, etc.) can logically be added to the filter, do so.

2. **Create a custom index on the filtered field** — if the field is a custom field, enable External ID or Unique. If it's a date field or a field type that doesn't support auto-indexing, open a support case.

3. **Narrow the date range in the WHERE clause** — a common pattern for scheduled jobs: instead of querying all unprocessed records, query records created in the last 30 days (`WHERE CreatedDate >= LAST_N_DAYS:30`). `CreatedDate` is indexed.

4. **Use a skinny table** — if the object has > 10M records and the query pattern is stable, request a skinny table via support (see `01-architecture.md`).

5. **Denormalize data** — if a query always needs to filter by a related object's field (e.g. filter Cases by `Account.Industry`), store Industry on the Case via a trigger/Flow denormalization, then index the denormalized Case field.

6. **Move to async processing with chunking** — if the query must scan large data volumes, move it to Batch Apex (`Database.Batchable`) which can process records in chunks using a SOQL cursor.

---

## OFFSET 2000 limit and keyset pagination

### The OFFSET problem

```soql
SELECT Id, Name FROM Account ORDER BY Name LIMIT 200 OFFSET 1800
```

- `OFFSET` works only up to **2,000**. A query with `OFFSET 2001` throws `System.QueryException: OFFSET can be at most 2000`.
- Even below 2,000, `OFFSET` performance degrades with record count because the database must scan and discard the first N rows before returning results.
- For objects with millions of records, `OFFSET 1800` may be slow; `OFFSET 1600` may be fast. The degradation is proportional to the OFFSET value and total record count.

### Keyset pagination pattern

Keyset pagination uses the value of the last record in the previous page as the filter for the next page, eliminating the need for OFFSET entirely.

**Example — paginating by Id (ascending):**

```apex
// First page
List<Account> page1 = [SELECT Id, Name FROM Account ORDER BY Id ASC LIMIT 200];
Id lastId = page1[page1.size() - 1].Id;

// Next page — use last Id as cursor
List<Account> page2 = [SELECT Id, Name FROM Account WHERE Id > :lastId ORDER BY Id ASC LIMIT 200];
lastId = page2[page2.size() - 1].Id;

// Continue until empty result
```

**Example — paginating by Name + Id (stable sort with ties):**

When paginating by a non-unique field like Name, ties (duplicate names) require including Id as a tiebreaker:

```apex
// Last record from previous page
String lastName = lastAccount.Name;
Id lastId = lastAccount.Id;

// Next page
List<Account> nextPage = [
    SELECT Id, Name FROM Account
    WHERE Name > :lastName
       OR (Name = :lastName AND Id > :lastId)
    ORDER BY Name ASC, Id ASC
    LIMIT 200
];
```

**Advantages of keyset over OFFSET:**
- No 2,000-row limit.
- Consistent performance regardless of page number (always uses index).
- Handles inserts/deletes between page fetches more gracefully (OFFSET-based pagination shifts pages when records are inserted).

**Limitations of keyset:**
- Cannot jump to an arbitrary page number (must traverse sequentially).
- Requires a stable sort key that is indexed (Id is ideal; use a unique indexed field).

---

## Aggregate query limits

- Aggregate queries (`SELECT COUNT(), SUM(), AVG(), GROUP BY`) count against the aggregate query limit (300 per transaction, same sync/async).
- They also count against the SOQL query limit (100/200).
- `GROUP BY` on a non-indexed field on a large object can be slow — it requires sorting all matching rows.
- `HAVING` clauses filter after aggregation, not before — a `HAVING COUNT() > 5` still scans all rows before filtering.
- Use `LIMIT` on aggregate queries to bound result sets: `SELECT COUNT(Id) cnt, Status FROM Case GROUP BY Status LIMIT 50`.

---

## Formula field join impact

### Cross-object formula fields and query performance

A formula field that references a parent object via a lookup creates an implicit JOIN at the database layer. This join is evaluated for every query against the child object — even if the formula field is not in the SELECT or WHERE clause.

**Example — performance-degrading formula:**

```
// Formula on Opportunity: references parent Account
Account.Industry  →  TEXT(Account.Industry__c)
```

Every query against Opportunity now implicitly joins to Account. For an Opportunity object with 5M records and an Account object with 500k records, this join adds execution time to every Opportunity query.

**Nested cross-object formulas are worse:**

```
// Formula on Opportunity referencing grandparent
Account.Owner.Manager.Name
```

This creates a 3-level JOIN (Opportunity → Account → User → Manager User). Multi-level joins on large objects cause severe query degradation.

**Remediation:**

1. **Denormalize the value**: create a plain text/number field on the child object (e.g. `Account_Industry__c` on Opportunity), populate it via trigger or Flow when the parent record changes, and use this flat field in queries instead of the formula.
2. **Remove the formula** if the reference is no longer needed.
3. **Limit use of cross-object formulas** to objects with < 500k records where join overhead is tolerable.

### Long-text area fields in WHERE clauses

Long text area fields (`nvarchar(max)` / text area > 255 chars) are NEVER indexed. Queries that filter on a long text area field will always do a full table scan:

```soql
-- This is always a full table scan regardless of record count
SELECT Id FROM Case WHERE Description LIKE '%error code 404%'
```

**Remediation:**
- Extract searchable terms into a separate indexed Text field (max 255 chars).
- Use SOSL (`FIND 'error code 404' IN ALL FIELDS RETURNING Case(Id)`) which uses a full-text index.
- For structured data in long text areas, move to a related object with indexed fields.
