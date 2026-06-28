# Async Architecture — Execution Model and Governor Limits

## Async Execution Model

A synchronous Salesforce transaction executes inline, within the same thread and governor context as the calling request (a Visualforce page load, LWC wire adapter call, REST API invocation, or trigger). When that transaction calls an async primitive, the platform enqueues work to run in a separate future transaction with its own governor limits.

```
Synchronous Transaction
│
├─ DML / SOQL
├─ Trigger fires
│    └─ System.enqueueJob(new MyQueueable())  ──► Async Queue
│    └─ EventBus.publish(new MyEvent__e())     ──► Platform Event Buffer (held until commit)
│    └─ System.schedule(...)                  ──► CronTrigger (scheduled job store)
│    └─ @future call                          ──► Async Queue (future method)
│
└─ Transaction COMMITS
      │
      ├─ Platform Event released to subscribers
      └─ Queueable/Future/Scheduled jobs eligible to start
           │
           └─ Each async job runs in its own transaction with fresh governor limits
```

Key points:
- **Each async job gets a completely fresh set of governor limits** — heap, CPU, SOQL queries, and DML statements reset to zero when a Queueable or `@future` method begins executing.
- **Async jobs are not guaranteed to start immediately** — the platform schedules them based on capacity. Under load, there can be minutes of delay.
- **Platform Events are held in a transactional buffer** — they are released to subscribers only after the publishing transaction successfully commits.
- **`@future` and Queueable jobs are added to the flex queue** — the flex queue can hold up to 2,000 jobs per org. If the flex queue is full, `System.enqueueJob` throws `System.LimitException`.

---

## Async Primitive Comparison Table

| Dimension | `@future` | Queueable | Schedulable | Batch Apex | Platform Event |
|---|---|---|---|---|---|
| **Callouts** | Yes, with `@future(callout=true)` | Yes, with `Database.AllowsCallouts` | No | Yes, with `Database.AllowsCallouts` | N/A (not a job) |
| **Chaining** | No | Yes (1 child per `execute()`) | No | No | Via trigger subscriber |
| **State / parameters** | Primitives and Collections only (no SObject params) | Any serializable object via constructor | `SchedulableContext` only; use member variables | `Database.BatchableContext`; full class state | Event payload fields |
| **Replay** | No | No | No | No | Yes (CometD, 72-hour window) |
| **Delivery ordering** | Guaranteed sequential per enqueue | Sequential chain | At scheduled time (±1 min) | Sequential | Partition-local ordering only |
| **Governor context** | Fresh limits | Fresh limits | Fresh limits | Fresh limits per batch chunk | Trigger context (subscriber) |
| **Can be called from trigger** | Yes (1 call per trigger exec) | Yes (1 enqueue per trigger exec) | No (use trigger → Queueable → schedule) | No | Yes (via `EventBus.publish`) |
| **Can be called from async** | No | Yes (1 child per `execute()`) | Yes | Yes | Yes |
| **Error handling** | None (no callback) | Transaction Finalizer | None | `finish()` method | `RetryableException` / dead-letter |
| **Max concurrent jobs** | 50 future method calls per transaction | Flex queue: 2,000 jobs | 100 scheduled jobs per org | 5 concurrent batch jobs | Event volume limits apply |
| **Minimum Apex API** | API 10.0 | API 28.0 | API 19.0 | API 18.0 | API 40.0 |

---

## Async Governor Limits

These limits apply to each individual async transaction (Queueable `execute()`, `@future` method body, Schedulable `execute()`, Batch `execute()` chunk). They are the same as synchronous limits unless noted.

| Resource | Limit | Notes |
|---|---|---|
| **Heap size** | 12 MB | Same as synchronous. For Batch Apex with `Database.Stateful`, the stateful data counts against the next chunk's heap. |
| **CPU time** | 60,000 ms (60 seconds) | Same as synchronous. Long-running loops or complex SOQL aggregations commonly hit this in Batch Apex. |
| **SOQL queries** | 200 per transaction | Includes queries in called methods, triggers, and validation rules fired by DML within the async job. |
| **SOQL rows returned** | 50,000 rows | Across all queries in the transaction. |
| **DML statements** | 150 per transaction | Each `insert`, `update`, `delete`, `upsert`, `merge`, `undelete` counts as 1. |
| **DML rows** | 10,000 per transaction | Total rows processed across all DML. |
| **HTTP callouts** | 100 per transaction | Requires `Database.AllowsCallouts`; each `Http.send()` counts as 1. |
| **Callout time (total)** | 120,000 ms (120 seconds) | Sum of all HTTP callout durations in the transaction. |
| **Callout timeout (per call)** | 10,000 ms (10 seconds) | Per individual `Http.send()` call; not configurable. |
| **`System.enqueueJob` calls** | 1 per `execute()` in production | From within a Queueable's execute(). Unlimited in test context (Test.stopTest()). |
| **Future method calls** | 50 per transaction | From synchronous context. Cannot be called from async context. |
| **Email invocations** | 10 per transaction | `Messaging.sendEmail()` |

---

## `CronTrigger` Object Reference

`CronTrigger` is the SObject that stores Scheduled Apex jobs. Query it to inspect, manage, or abort scheduled jobs.

```apex
List<CronTrigger> jobs = [
    SELECT Id,
           CronJobDetail.Name,       // Job name passed to System.schedule()
           CronJobDetail.JobType,    // '7' = Scheduled Apex
           CronExpression,           // CRON expression string
           State,                    // WAITING, PAUSED, COMPLETE, ERROR, DELETED, BLOCKED
           NextFireTime,             // Next scheduled execution (DateTime)
           PreviousFireTime,         // Last execution time (DateTime, null if never run)
           StartTime,                // When the job was scheduled (DateTime)
           EndTime,                  // Expiry time (DateTime, null = no expiry)
           TimesTriggered            // Number of times the job has fired (Integer)
    FROM CronTrigger
    WHERE CronJobDetail.JobType = '7'
      AND State NOT IN ('DELETED', 'COMPLETE')
    ORDER BY NextFireTime ASC
];
```

### `CronTrigger.State` values

| State | Meaning |
|---|---|
| `WAITING` | Job is active and waiting for its next fire time |
| `PAUSED` | Job is paused (via System.abortJob or Setup) |
| `COMPLETE` | Job has executed and will not fire again (single-fire completed) |
| `ERROR` | Job threw an unhandled exception on its last execution |
| `DELETED` | Job was aborted via System.abortJob() |
| `BLOCKED` | Job is blocked (org-level limit reached) |

### CRON Expression Format

Salesforce uses a 6-field CRON expression: `Seconds Minutes Hours Day-of-month Month Day-of-week`

```
Field         Allowed values      Wildcards
Seconds       0–59                , - * /
Minutes       0–59                , - * /
Hours         0–23                , - * /
Day-of-month  1–31                , - * ? / L W
Month         1–12 or JAN–DEC     , - * /
Day-of-week   1–7 or SUN–SAT      , - * ? / L #
```

Common patterns:
```
'0 0 * * * ?'      — Every hour at minute 0
'0 0 8 * * ?'      — Every day at 8:00 AM
'0 0 8 ? * MON'    — Every Monday at 8:00 AM
'0 * * * * ?'      — Every minute (minimum frequency)
'0 0 0 1 * ?'      — First day of every month at midnight
```

Note: The year field (7th field) is optional and rarely used. Do not include it unless targeting a specific year.

---

## Flex Queue Monitoring

```apex
// Check current flex queue depth (AsyncApexJob)
List<AggregateResult> queueDepth = [
    SELECT Status, COUNT(Id) jobCount
    FROM AsyncApexJob
    WHERE JobType IN ('Queueable', 'Future')
      AND Status IN ('Queued', 'Holding')
    GROUP BY Status
];

// Find all Queueable jobs for a specific class
List<AsyncApexJob> jobs = [
    SELECT Id, Status, JobItemsProcessed, TotalJobItems,
           NumberOfErrors, CreatedDate, CompletedDate, ExtendedStatus
    FROM AsyncApexJob
    WHERE ApexClass.Name = 'MyQueueable'
    ORDER BY CreatedDate DESC
    LIMIT 20
];
```

`AsyncApexJob.Status` values: `Queued`, `Holding`, `Preparing`, `Processing`, `Completed`, `Failed`, `Aborted`.
