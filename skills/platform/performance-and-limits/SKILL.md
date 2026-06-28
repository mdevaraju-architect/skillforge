---
name: platform-performance-and-limits
description: >-
  governor limits, SOQL optimisation, selective query, query plan, indexes,
  custom index, composite index, skinny table, SOQL in loop anti-pattern,
  trigger bulkification, System.Limits, CPU time limit, heap size limit,
  DML limit, SOQL row limit, Apex profiling, debug log, execution log,
  SOQL OFFSET anti-pattern, keyset pagination, LWC performance, wire adapter,
  lazy loading, LWC server action, report performance, formula field impact,
  non-selective query, large data volume
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "internal"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: performance-and-limits
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Platform Performance and Limits — Skill

## Always true (gotchas)

1. **SOQL in a loop is the most common governor limit violation — always collect IDs then query outside the loop** — executing `[SELECT ... FROM SObject WHERE Id = :record.LookupId__c]` inside a `for` loop queries once per iteration. With 200 records in a trigger batch, this executes 200 queries, hitting the 100 SOQL per transaction limit. The fix: collect all lookup IDs into a `Set<Id>` before the loop, query once with `WHERE Id IN :idSet`, then build a Map for lookup inside the loop.

2. **A SOQL query is non-selective if the filter does not use a standard or custom index and the object has more than ~100,000 records** — Salesforce uses "selective" query heuristics: a query against an unindexed field on a large object does a full table scan. Full table scans on 1M+ record objects trigger the non-selective query error (`System.QueryException: Non-selective query against large object type`). Always filter on Id, indexed fields, or add a custom index (via Salesforce support for standard objects, or via `ExternalId=true` / `Unique=true` for custom fields).

3. **`System.Limits.getCpuTime()` returns milliseconds of CPU used in the current transaction — async transactions have a 60,000ms limit, synchronous 10,000ms** — use `System.Limits.getCpuTime()` at key points in Apex to instrument how much CPU has been consumed. Apex has no built-in profiler. Calling `System.debug(System.Limits.getCpuTime())` before and after a suspect code block measures its cost. Heavy string manipulation, nested loops, and JSON (de)serialization are the most common CPU consumers.

4. **`System.Limits.getHeapSize()` returns bytes — the limit is 6 MB synchronous, 12 MB asynchronous** — heap is consumed by all in-memory Apex variables. Large collections of SObjects (e.g. holding 10,000 Accounts with 50 fields each in a List) can quickly consume 6 MB. The fix: use Maps (Id-keyed) instead of Lists where lookup is needed, clear collections when no longer needed, and process records in chunks rather than loading everything at once. JSON serialization doubles memory usage temporarily.

5. **`OFFSET` in SOQL is limited to 2,000 and is slow on large objects — use keyset pagination instead** — `SELECT Id FROM Account LIMIT 200 OFFSET 1800` works only up to `OFFSET 2000`. Beyond that, the query fails. Even below 2000, OFFSET forces the database to scan and skip rows, which is slow on large objects. Keyset pagination (`WHERE Id > :lastId ORDER BY Id LIMIT 200`) avoids the offset scan and has no upper bound.

6. **Formula fields that reference parent objects (cross-object formulas) create implicit joins — they prevent selective queries on the child object** — a formula field on Opportunity that references `Account.Industry` forces a join on every Opportunity query, even if Account.Industry is not in the SELECT or WHERE clause. Formula fields that reference multiple levels of parent (`Account.Owner.Manager.Name`) create multi-level joins that degrade performance on large objects. Replace with a denormalized field populated by trigger/Flow if performance is critical.

7. **The Query Plan tool in Developer Console shows the table scan cost and index usage — use it before deploying any query on a >100k-record object** — Query Plan (Developer Console → Query Editor → Query Plan button) shows: the table scan cost, whether an index is used, and estimated row count. A cost > 1 means a full table scan; cost < 1 means index use. This is the primary diagnostic for non-selective query performance issues.

8. **`WITH USER_MODE` in SOQL has a performance overhead because it evaluates FLS/CRUD on every field — avoid in tight loops** — `WITH USER_MODE` enforces FLS and object security at the database layer. It adds per-query overhead due to permission evaluation. In performance-critical code paths (e.g. trigger on high-volume object), use `System.runAs()` in tests but avoid `WITH USER_MODE` in production hot paths where FLS has already been checked upstream. Only apply where required by security policy.

9. **Trigger bulkification: every trigger must handle a `List<SObject>` of up to 200 records — code that only handles `Trigger.new[0]` will fail at scale** — non-bulkified triggers process only the first record when multiple records are saved in a single DML operation. The handler must iterate `Trigger.new` (a List) and avoid assumptions about list size. Common anti-patterns: `Trigger.new[0]`, `Trigger.new.size() == 1` checks, or nested DML per record.

10. **Debug logs truncate at 20 MB — a performance test that generates large debug output loses the tail, which is typically where the problem is** — `Database.debug(LoggingLevel.ERROR, ...)` reduces log noise. In performance investigations, set log levels to `APEX_CODE: FINEST, APEX_PROFILING: INFO, DB: FINEST` and nothing else. Enabling `SYSTEM: FINEST` generates enormous log output that causes truncation before the slow query appears. Use `System.Limits` instrumentation instead of relying on debug log timing.

11. **Indexed fields on custom objects: `ExternalId=true` or `Unique=true` auto-creates a standard index — but only on text/number fields; date fields need a custom index via support** — for custom objects, marking a field as External ID or Unique automatically creates an index that Salesforce can use for selective queries. Date/DateTime fields do NOT get auto-indexed this way — a custom index must be requested via Salesforce support. Standard object fields (like `Account.CreatedDate`) have standard indexes but the selectivity threshold still applies.

12. **LWC `wire` adapters are cached — calling `refreshApex()` is required to invalidate the cache after a DML operation** — LWC wire adapters (`@wire(getRecords)`) cache the server response. After a DML operation (insert/update/delete from an Apex `@AuraEnabled` method), the wire cache is stale. Call `refreshApex(this.wiredResult)` (where `wiredResult` is the `{data, error}` object from the `@wire` decorator) to force a fresh server call. Failing to refresh causes the UI to show stale data until page reload.

13. **Report run time is dominated by the number of joined objects, formula fields, and cross-filters — each cross-filter adds a subquery** — Salesforce reports that are slow usually have: many joined report types (3+ object joins), cross-filters ("with related Contacts" = subquery), complex formulas in summary fields, or > 2,000 rows without row limits. Enable row limits (Filters → Row Limit) and remove unnecessary cross-filters. For complex analytics, move to CRM Analytics or a reporting database.

14. **`Database.query(queryString)` (dynamic SOQL) bypasses compile-time checks and is harder to analyse for selectivity — use it sparingly and always bind variables** — dynamic SOQL (`Database.query('SELECT Id FROM ' + objectName + ' WHERE ...')`) allows runtime-constructed queries. It bypasses compile-time field validation and is vulnerable to SOQL injection if user input is concatenated directly. Always use `String.escapeSingleQuotes()` or bind variables (`:variable` inside the string) for dynamic WHERE clauses. Avoid dynamic SOQL when the query structure is known at compile time.

---

## Routing table

| Topic | Reference file |
|---|---|
| Governor limits overview, sync vs async limits table, execution order | `references/01-architecture.md` |
| SOQL selectivity, indexes, Query Plan tool, OFFSET/keyset, formula joins | `references/02-soql-optimisation.md` |
| System.Limits methods, CPU/heap profiling, debug log levels, collection patterns | `references/03-apex-profiling.md` |
| Trigger bulkification, SOQL/DML in loop, handler pattern, recursion guard | `references/04-trigger-bulkification.md` |
| LWC wire cache, refreshApex, @AuraEnabled cacheable, report performance | `references/05-lwc-and-report-performance.md` |

---

## Workflows

### Workflow 1: Diagnose and fix a non-selective SOQL query causing trigger timeouts

**Trigger:** A trigger is throwing `System.QueryException: Non-selective query against large object type` or timing out on a large object.

**Steps:**

1. Open Developer Console. Navigate to the Query Editor tab. Paste the suspect SOQL. Click **Query Plan** (not Execute). Examine the output table.
   - If cost > 1.0, the query is doing a full table scan.
   - If the "Notes" column says "Not Selective", no index is being used.
2. Identify which WHERE clause fields are filtered. Check whether those fields are indexed:
   - Standard indexed fields: `Id`, `Name`, `OwnerId`, `CreatedDate`, `LastModifiedDate`, `RecordTypeId`, `ExternalId` fields, `Unique` fields.
   - Custom fields: only if `ExternalId=true` or `Unique=true`.
3. If the query filters on an unindexed field:
   - For a **custom field**: edit the field definition in Setup, enable "External ID" or "Unique" if semantics allow. This auto-creates an index.
   - For a **date field**: open a Salesforce support case requesting a custom index. Provide the object API name, field API name, and a sample query.
   - For a **standard object field** (e.g. `Account.Phone`): request a custom index via support.
4. Re-run Query Plan after the index is created to confirm cost < 1.0.
5. If an index cannot be added, refactor the query to include an indexed field in the WHERE clause (e.g. add `AND OwnerId != null` if the field is always populated — but note that IS NULL / IS NOT NULL on indexed fields is not selective; prefer an equality filter).
6. For `System.QueryException: Non-selective query` in production: add the indexed filter immediately as a hotfix; long-term, consider skinny tables for frequently queried subsets of fields on large objects (requires Salesforce support).

**Success criterion:** Query Plan shows cost < 1.0 and a named index in the output. The trigger executes without exception.

---

### Workflow 2: Profile Apex CPU usage with System.Limits instrumentation and reduce heap allocation

**Trigger:** An Apex transaction is hitting or approaching the 10,000ms CPU time limit or the 6 MB heap limit.

**Steps:**

1. Add CPU checkpoints at the entry point of each major code section:
   ```apex
   Integer cpuBefore = System.Limits.getCpuTime();
   // ... code section ...
   System.debug('CPU ms consumed by section: ' + (System.Limits.getCpuTime() - cpuBefore));
   ```
2. Add heap checkpoints at the same boundaries:
   ```apex
   System.debug('Heap bytes used: ' + System.Limits.getHeapSize() + ' / ' + System.Limits.getLimitHeapSize());
   ```
3. Run the transaction in a sandbox with a representative data set. Examine the debug log for the largest CPU / heap deltas.
4. **For CPU hotspots:**
   - Replace `String +=` concatenation in loops with `List<String>` + `String.join()`.
   - Replace `JSON.serialize()` / `JSON.deserialize()` of large objects with field-by-field mapping.
   - Replace nested `for` loops over Lists with `Map` lookups (O(1) vs O(n²)).
   - Move Schema.describe calls outside loops — `Schema.SObjectType.Account.fields.getMap()` is expensive; cache the result in a static variable.
5. **For heap hotspots:**
   - Query only the fields you need (`SELECT Id, Name` not `SELECT *` equivalent — avoid querying all fields).
   - After processing a large collection, null it out: `myList = null;` to allow GC.
   - Replace `List<SObject>` with `Map<Id, SObject>` only when lookup is needed; a Map has slightly higher overhead per entry but eliminates linear search.
   - In Batch Apex, reduce the scope size to process fewer records per execute() call.
6. Verify: rerun the transaction and confirm `System.Limits.getCpuTime()` stays below 8,000ms (leaving 2,000ms safety margin) and `System.Limits.getHeapSize()` stays below 5,000,000 bytes.

**Success criterion:** No `System.LimitException` thrown; CPU and heap remain within safe margins with a representative 200-record trigger batch.

---

### Workflow 3: Fix a SOQL-in-loop pattern in a trigger handler

**Trigger:** Code review or production `System.LimitException: Too many SOQL queries: 101` reveals SOQL inside a for loop.

**Steps:**

1. Locate the anti-pattern. A typical example in a trigger handler:
   ```apex
   for (Opportunity opp : Trigger.new) {
       Account acc = [SELECT Id, Name FROM Account WHERE Id = :opp.AccountId]; // SOQL in loop
       opp.AccountName__c = acc.Name;
   }
   ```
2. Refactor to the bulkification pattern:
   ```apex
   // Step 1: Collect all lookup IDs
   Set<Id> accountIds = new Set<Id>();
   for (Opportunity opp : Trigger.new) {
       if (opp.AccountId != null) {
           accountIds.add(opp.AccountId);
       }
   }

   // Step 2: Single query outside the loop
   Map<Id, Account> accountMap = new Map<Id, Account>(
       [SELECT Id, Name FROM Account WHERE Id IN :accountIds]
   );

   // Step 3: Process records using the map
   for (Opportunity opp : Trigger.new) {
       if (opp.AccountId != null && accountMap.containsKey(opp.AccountId)) {
           opp.AccountName__c = accountMap.get(opp.AccountId).Name;
       }
   }
   ```
3. Check for DML-in-loop at the same time — a `update` or `insert` inside a loop must be refactored similarly: collect modified records into a `List<SObject>`, then call `update myList` once after the loop.
4. Verify the fix handles null lookup IDs gracefully (null check before adding to Set).
5. Write a test that inserts 200 records in a single DML to confirm the trigger handles a full batch without hitting the SOQL limit.

**Success criterion:** `[SELECT COUNT() FROM SOQL_Queries]` (via `System.Limits.getQueries()`) stays at 1 regardless of Trigger.new size. Test with 200-record batch passes without `LimitException`.

---

## Out of scope

- **Bulk API throughput and Batch Apex scope tuning** — use `platform-bulk-data-processing`
- **CDN and Experience Cloud page load performance** — separate skill
- **Database.Batchable scope size tuning** — use `platform-bulk-data-processing`
