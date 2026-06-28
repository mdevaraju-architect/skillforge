# 01 — Architecture: Governor Limits and Apex Execution Model

## Governor limits reference

Salesforce enforces per-transaction limits. The transaction boundary is one HTTP request, one trigger execution chain, one Queueable job, one Batch execute() call, etc.

### Per-transaction limits: synchronous vs asynchronous

| Resource | Synchronous limit | Asynchronous limit | Notes |
|---|---|---|---|
| SOQL queries | 100 | 200 | Counts each `[SELECT ...]` or `Database.query()` call |
| SOQL query rows returned | 50,000 | 50,000 | Total across all queries in transaction |
| SOQL aggregate queries | 300 | 300 | GROUP BY, COUNT(), SUM() etc. |
| DML statements | 150 | 150 | Each `insert`, `update`, `delete`, `upsert`, `merge`, `undelete` |
| DML rows processed | 10,000 | 10,000 | Total records across all DML calls |
| Apex CPU time | 10,000 ms | 60,000 ms | Measured by `System.Limits.getCpuTime()` |
| Heap size | 6 MB | 12 MB | Measured by `System.Limits.getHeapSize()` |
| Callouts (HTTP/web services) | 100 | 100 | Cannot mix callouts and DML in same transaction |
| Future method calls (`@future`) | 50 | 0 (not allowed inside async) | Per transaction |
| Queueable jobs enqueued | 50 | 1 (one child from a queueable) | `System.enqueueJob()` calls |
| Email invocations | 10 | 10 | `Messaging.sendEmail()` calls |
| Push notification calls | 10 | 10 | |
| SOSL queries | 20 | 20 | `[FIND ...]` |
| Describe calls | 100 | 100 | Schema.describe operations |
| Recordtype describe calls | 100 | 100 | |
| Custom settings describe calls | 100 | 100 | |
| Flows and processes | 50 | 50 | Per-transaction autolaunched flow starts |
| Publish Platform Events (synchronous) | 150 | 150 | `EventBus.publish()` |

> **Async context includes:** `@future`, `Queueable`, `Database.Batchable` (each `execute()` call), `Schedulable execute()`, Platform Event trigger.

### Org-wide (daily) limits

| Resource | Default limit | Notes |
|---|---|---|
| Email sent via Apex | 5,000/day/org | `Messaging.sendEmail()` |
| Async Apex executions | 250,000/day or licenses × 200, whichever is greater | Queueable, Future, Batch jobs |
| Batch Apex jobs in queue | 5 active/concurrent | Jobs in Holding, Queued, Preparing, Processing state |
| Scheduled Apex jobs | 100 scheduled at once | |

---

## System.Limits methods

All methods are in the `System.Limits` class. Each has a paired `getLimit*()` method returning the maximum allowed value.

| Method | Returns | Paired limit method |
|---|---|---|
| `System.Limits.getQueries()` | Number of SOQL queries issued | `getLimitQueries()` → 100 or 200 |
| `System.Limits.getQueryRows()` | Total SOQL rows returned | `getLimitQueryRows()` → 50,000 |
| `System.Limits.getDMLStatements()` | Number of DML statements | `getLimitDMLStatements()` → 150 |
| `System.Limits.getDMLRows()` | Total DML rows processed | `getLimitDMLRows()` → 10,000 |
| `System.Limits.getCpuTime()` | CPU milliseconds consumed | `getLimitCpuTime()` → 10,000 or 60,000 |
| `System.Limits.getHeapSize()` | Heap bytes used | `getLimitHeapSize()` → 6,291,456 or 12,582,912 |
| `System.Limits.getCallouts()` | Number of callouts made | `getLimitCallouts()` → 100 |
| `System.Limits.getEmailInvocations()` | Email send calls | `getLimitEmailInvocations()` → 10 |
| `System.Limits.getFutureCalls()` | `@future` method calls enqueued | `getLimitFutureCalls()` → 50 |
| `System.Limits.getQueueableJobs()` | Queueable jobs enqueued | `getLimitQueueableJobs()` → 50 |
| `System.Limits.getSoslQueries()` | SOSL queries issued | `getLimitSoslQueries()` → 20 |
| `System.Limits.getAggregateQueries()` | Aggregate SOQL queries | `getLimitAggregateQueries()` → 300 |

**Usage pattern for safety checks:**

```apex
if (System.Limits.getQueries() >= System.Limits.getLimitQueries() - 5) {
    // approaching SOQL limit — log and bail out gracefully
    throw new ApplicationException('Approaching SOQL query limit. Current: '
        + System.Limits.getQueries());
}
```

---

## Apex execution order (single record save)

Understanding execution order is critical when diagnosing unexpected limit consumption. A single record save triggers all of the following in sequence, each consuming from the same governor limit pool:

1. Load original record from database
2. Load new field values from request
3. Execute system validation (required fields, field format)
4. **Before triggers execute** (`before insert`, `before update`)
5. Run system and user-defined validation rules
6. Duplicate rules execute
7. Save record to database (but no commit yet)
8. **After triggers execute** (`after insert`, `after update`)
9. Assignment rules (Leads, Cases)
10. Auto-response rules (Cases, Leads)
11. Workflow rules execute; field updates re-run before/after triggers once
12. Processes (Process Builder) execute
13. Escalation rules
14. **Entitlement rules**
15. **Roll-up summary fields** recalculate (can trigger parent object triggers)
16. Criteria-based sharing rules recalculate
17. **Flows** (Record-Triggered Flows) execute — Before-save flows run in step 4 equivalent; After-save flows run here
18. Commit to database

> **Important:** Steps 9–18 share the same governor limit pool as the triggers. A trigger that consumes 80 SOQL queries and then invokes a Flow that makes 30 more SOQL queries will hit the 100-query limit at step 17, even if the trigger code itself is within limits.

### Flow and trigger combined limit consumption

Record-Triggered Flows consume SOQL queries, DML, CPU, and heap from the **same transaction** as the triggering Apex code. A trigger handler that calls 80 SOQL queries and a Flow that calls 30 will together exceed the 100-query limit.

Diagnostic approach:
1. Check the debug log for `FLOW_START_INTERVIEW_BEGIN` and subsequent `SOQL_EXECUTE_BEGIN` entries to count Flow-generated queries.
2. Deactivate Flows one at a time to isolate which one is consuming limits.
3. Where possible, merge Flow logic into the trigger handler to avoid duplicate queries.

---

## Asynchronous execution contexts and their limit differences

| Context | CPU limit | Heap limit | Max SOQL | Notes |
|---|---|---|---|---|
| Synchronous Apex (trigger, controller) | 10,000 ms | 6 MB | 100 | Standard limits |
| `@future` method | 60,000 ms | 12 MB | 200 | Runs asynchronously; cannot accept SObject parameters |
| `Queueable` | 60,000 ms | 12 MB | 200 | Supports SObject parameters; chainable |
| `Database.Batchable.execute()` | 60,000 ms | 12 MB | 200 | Each execute() is independent transaction |
| `Schedulable.execute()` | 60,000 ms | 12 MB | 200 | Runs at scheduled time |
| Platform Event trigger | 60,000 ms | 12 MB | 200 | Async by definition |

**When to offload to async:**
- Processing requires more CPU or heap than synchronous limits allow.
- Operations do not need to complete within the HTTP request lifecycle.
- Callouts are needed from a trigger (callouts are not allowed in synchronous trigger context — use `@future(callout=true)` or Queueable with HTTP).

---

## Skinny tables

A skinny table is a Salesforce-managed database optimization available on large objects (typically > 10 million records). It is a separate, narrow database table containing a subset of the most frequently queried fields, maintained in sync with the main table.

**When to request a skinny table:**
- Full table scans are unavoidable (no suitable index field exists).
- The object has > 10 million records.
- The query always filters on the same small set of fields.
- Performance improvement via indexes alone is insufficient.

**How to request:**
- Open a Salesforce support case.
- Provide: object API name, list of fields to include in the skinny table, sample SOQL queries that need optimization.
- Salesforce creates and maintains the skinny table; no code changes are required.

**Limitations:**
- Skinny tables are read-only from Salesforce's perspective (auto-maintained).
- Cannot include long-text area fields.
- Count toward storage but are managed by Salesforce infrastructure.
- Not visible in Schema Builder or Field Explorer.
