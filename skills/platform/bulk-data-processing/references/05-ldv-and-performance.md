# Large Data Volume (LDV) and Performance

## What Counts as Large Data Volume?

Salesforce defines Large Data Volume (LDV) as objects with significant record counts where standard query and processing patterns begin to degrade. Practical thresholds:

| Volume | Classification | Typical Symptoms |
|---|---|---|
| < 1 million records | Standard | No special treatment required |
| 1M – 5M records | Medium-high | Monitor query performance; consider selective indexes |
| 5M – 10M records | High | Custom indexes may be necessary; avoid non-selective queries |
| 10M+ records | LDV | Skinny tables, dedicated index strategy, archiving consideration |
| 100M+ records | Extreme LDV | Requires Salesforce architecture review; BigObjects for history |

LDV issues manifest as: slow SOQL queries (>5 seconds), batch job failures due to cursor timeout, report timeouts, and Bulk API job processing delays.

---

## Skinny Tables

### What They Are

A skinny table is a narrow, Salesforce-internal table that mirrors a subset of frequently queried columns from a large SObject, excluding the standard Salesforce audit columns (`CreatedDate`, `LastModifiedById`, `SystemModstamp`, etc.) and the full object metadata. Queries that can be satisfied entirely from the skinny table avoid scanning the full, wide object table, dramatically improving query performance on LDV objects.

Skinny tables are most effective when:
- The object has 10M+ records.
- A specific set of 3–10 fields is queried repeatedly (e.g., `Status`, `OwnerId`, `External_ID__c`, `RecordTypeId`).
- Batch jobs issue the same SOQL pattern in `start()` repeatedly.
- Reports on the object time out or are slow.

### Limitations

- Skinny tables are not visible via any API, metadata query, or Setup UI.
- They do not support all field types — binary fields (Base64), long text area fields, and encrypted fields cannot be included.
- Adding a new field to an existing skinny table requires a new Salesforce Support case.
- Skinny tables are not available on all Salesforce editions.

### How to Request

1. Open a Salesforce Support case (Premier/Signature Success) or engage Customer Success.
2. Specify: org ID, object API name, list of field API names to include, query patterns that are slow.
3. Salesforce Support provisions the skinny table in a maintenance window (provisioning can take 1–5 business days).
4. After provisioning, Salesforce backfills the skinny table with existing data (backfill may take additional time for very large objects).
5. After backfill, run the target SOQL and confirm improved response time using the EXPLAIN plan (`Database.query` with `EXPLAIN` prefix in Developer Console) or via tooling API.

---

## Index Strategies for LDV

### Standard Indexed Fields

Salesforce automatically indexes these fields on every SObject:
- `Id`
- `Name`
- `OwnerId`
- `CreatedDate`
- `LastModifiedDate`
- `SystemModstamp`
- `RecordTypeId`
- Custom fields marked as External ID (automatically indexed)
- Custom fields marked as Unique (automatically indexed)
- Fields with a `<indexed>true</indexed>` declaration (some standard fields)

### Custom Indexes (Support-Provisioned)

For non-indexed custom fields that appear in WHERE clauses on LDV objects, request a custom index via Salesforce Support. Custom indexes are created server-side and cannot be created via Metadata API or Setup UI.

When to request:
- A field is used in WHERE or ORDER BY on a query that returns or filters > 10M records.
- Query response time exceeds 5 seconds consistently.
- The query selectivity (ratio of returned rows to total rows) is low (< 10% of total rows); highly selective queries benefit most from indexes.

### Query Selectivity

Salesforce uses a query optimizer that evaluates whether to use an index. A query is considered "selective" if it is expected to return less than a certain percentage of total records (roughly < 10% for standard indexes, configurable for custom indexes).

Non-selective queries on LDV objects result in full-table scans. Signs of a non-selective query:
- WHERE clause on unindexed fields.
- `LIKE '%pattern%'` on a text field (leading wildcard prevents index use).
- `WHERE field != null` on a nearly-always-populated field.
- `ORDER BY` on a non-indexed field combined with LIMIT.

---

## Parallel Batch Design

### Org-Level Batch Concurrency

Salesforce allows up to 5 batch jobs in the `Holding`, `Queued`, `Preparing`, or `Processing` states concurrently per org. Beyond 5, additional jobs remain in `Holding` until a slot opens.

### Designing for Parallel Batches on Different Objects

To maximise throughput, run batch jobs on different SObjects in parallel:

```apex
// Safe: parallel batches on different objects
Database.executeBatch(new AccountBatch(), 200);
Database.executeBatch(new ContactBatch(), 200);
Database.executeBatch(new LeadBatch(), 200);
```

Each job touches a different object; no row lock contention.

### Avoiding Parallel Batches on the Same Object

Two batch jobs writing to the same SObject simultaneously risk `UNABLE_TO_LOCK_ROW`. Use a serialisation check:

```apex
public static void launchIfSafe() {
    Integer running = [
        SELECT COUNT() FROM AsyncApexJob
        WHERE ApexClass.Name IN ('AccountUpdateBatch', 'AccountCleanupBatch')
        AND Status IN ('Holding', 'Queued', 'Preparing', 'Processing')
    ];
    if (running == 0) {
        Database.executeBatch(new AccountUpdateBatch(), 200);
    } else {
        System.debug('Batch already running on Account — deferring.');
    }
}
```

### Partition-Based Parallelism

For maximum throughput on a single object, partition the dataset and run batches on non-overlapping record sets:

```apex
// Batch 1: Records A–M (by Name prefix)
// Batch 2: Records N–Z
// Use WHERE Name >= 'A' AND Name < 'N' for batch 1
// Both batches touch different rows — minimal lock contention
```

This pattern is effective for pure-insert batch jobs or update jobs where records are disjoint. For updates to shared related records (e.g., updating a parent Account from multiple Contact batches), serialise instead.

---

## Archiving Patterns with BigObjects

### What are BigObjects?

BigObjects are a Salesforce storage tier designed for immutable, high-volume historical data (billions of records). They do not count against standard storage limits and are optimised for append and indexed-key lookup, not ad hoc SOQL queries.

BigObjects are appropriate for:
- Transaction history (e.g., every PolicyPremiumPayment ever made).
- Audit logs (every field change to a contract record for 7 years).
- Deactivated records that must be retained for compliance but not actively queried.

### BigObject Limitations

- No triggers, workflow rules, or process builder/flow on BigObjects.
- No UPDATE or DELETE — records are immutable once inserted.
- SOQL on BigObjects is limited to indexed fields in the WHERE clause (must match the index definition).
- Not visible in standard reports or list views without custom Lightning components.
- DML is async-only — use `System.enqueueJob` or Batch Apex to insert BigObject records.

### Archiving Pattern

```apex
// In a Batch Apex class, archive old Opportunity records to a BigObject
public void execute(Database.BatchableContext bc, List<SObject> scope) {
    List<Opportunity_Archive__b> archives = new List<Opportunity_Archive__b>();
    List<Id> toDelete = new List<Id>();

    for (SObject s : scope) {
        Opportunity opp = (Opportunity) s;
        archives.add(new Opportunity_Archive__b(
            Original_Id__c = opp.Id,
            Account_Id__c = opp.AccountId,
            Close_Date__c = opp.CloseDate,
            Amount__c = opp.Amount,
            Stage__c = opp.StageName,
            Archived_Date__c = Date.today()
        ));
        toDelete.add(opp.Id);
    }

    // Insert BigObject records (async; inserted after transaction commits)
    Database.insertImmediate(archives);

    // Soft-delete source records after archiving
    Database.delete(
        [SELECT Id FROM Opportunity WHERE Id IN :toDelete],
        false
    );
}
```

---

## Anti-Patterns to Avoid on LDV Objects

### SELECT * (All Fields)

Retrieving all fields on a 50M-record object loads enormous amounts of data per record, rapidly exhausting heap. Always specify only the fields needed:

```apex
// Bad — loads all fields
SELECT FIELDS(ALL) FROM Account LIMIT 200

// Good — loads only required fields
SELECT Id, Name, External_ID__c FROM Account WHERE Segment__c = 'Enterprise'
```

### OFFSET for Pagination

SOQL `OFFSET` performs a full table scan to skip rows — on LDV objects, high OFFSET values are extremely slow:

```apex
// Bad — full scan to skip 1,000,000 rows
SELECT Id FROM Account ORDER BY Name LIMIT 200 OFFSET 1000000
```

Use **keyset pagination** instead:

```apex
// Good — uses index on Name to start from last-seen value
SELECT Id, Name FROM Account WHERE Name > :lastSeenName ORDER BY Name LIMIT 200
```

Or for ID-based pagination (more reliable than Name for uniqueness):

```apex
SELECT Id FROM Account WHERE Id > :lastSeenId ORDER BY Id LIMIT 200
```

### Aggregate Queries on LDV Without Indexed GROUP BY

```apex
// Potentially very slow on 50M+ records if Status is not indexed
SELECT Status, COUNT(Id) FROM Case GROUP BY Status

// Better: ensure Status is indexed or use a summary SObject updated via triggers
```

### Non-Selective COUNT() Queries

```apex
// Full table scan on every call
Integer total = [SELECT COUNT() FROM Account];

// Better: use a counter stored on a metadata record or summary object
// and incremented by a trigger, or query with a selective WHERE clause
```

---

## Summary Checklist for LDV Design

- [ ] All batch SOQL WHERE clauses filter on indexed fields.
- [ ] `Database.QueryLocator` used in `start()` — not `Iterable`.
- [ ] Scope size set conservatively (200 default, lower for heavy execute() logic).
- [ ] No `OFFSET` pagination in batch SOQL — use keyset pagination.
- [ ] No `SELECT *` / `FIELDS(ALL)` on LDV objects.
- [ ] Parallel batches on same object checked for concurrency conflicts.
- [ ] Skinny table request submitted for objects with 10M+ records and repeated slow queries.
- [ ] Historical records older than the retention period archived to BigObjects.
- [ ] Custom indexes requested for non-indexed fields in critical WHERE clauses.
- [ ] Batch error results persisted to a custom log object, not accumulated in heap.
