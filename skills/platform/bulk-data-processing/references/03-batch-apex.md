# Batch Apex — Implementation Reference

## The Database.Batchable Interface

A Batch Apex class must implement three methods:

```apex
global interface Database.Batchable<T> {
    Database.QueryLocator start(Database.BatchableContext bc);
    // OR: Iterable<T> start(Database.BatchableContext bc);

    void execute(Database.BatchableContext bc, List<T> scope);

    void finish(Database.BatchableContext bc);
}
```

### Database.BatchableContext

Available in all three methods. Key methods:

| Method | Returns | Description |
|---|---|---|
| `bc.getJobId()` | `Id` | The `AsyncApexJob.Id` for this batch execution |

Use `bc.getJobId()` in `finish()` to query `AsyncApexJob` for final status and record counts.

---

## QueryLocator vs Iterable

### Database.QueryLocator (recommended for large data)

```apex
public Database.QueryLocator start(Database.BatchableContext bc) {
    // Server-side cursor — bypasses the 50,000 SOQL row governor in start().
    // Maximum: 50,000,000 records.
    return Database.getQueryLocator(
        'SELECT Id, Name, AccountId FROM Contact WHERE IsActive__c = true'
    );
}
```

- Uses a server-side cursor; records are streamed to `execute()` without being materialised in memory all at once.
- The 50,000-row SOQL governor does not apply to the QueryLocator query in `start()`.
- The cursor is held server-side for up to 10 minutes between `execute()` calls.
- Supports ORDER BY, WHERE, and most SOQL clauses. Does not support aggregate functions (COUNT, SUM) or GROUP BY in the top-level query.

### Iterable<SObject> (only for small, non-SOQL sources)

```apex
public Iterable<SObject> start(Database.BatchableContext bc) {
    // Materialises the full result set in memory at start() time.
    // Subject to the 50,000 SOQL row governor.
    // Use only when the source cannot be a simple SOQL query AND volume < 50,000.
    return [SELECT Id FROM Account WHERE CreatedDate = TODAY];
}
```

Use `Iterable` only when:
- The source records come from a non-SOQL source (e.g., a pre-built List).
- The record count is known and confirmed to be under 50,000.
- Never use for any production batch expected to grow beyond 50,000 records.

---

## Database.Stateful

Without `Database.Stateful`, every `execute()` call receives a freshly deserialised instance of the batch class with all instance variables at their initial (declaration-time) values.

```apex
// WITHOUT Database.Stateful — errorCount always 0 at start of each execute()
public class BadBatch implements Database.Batchable<SObject> {
    private Integer errorCount = 0; // RESETS every execute() call

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        errorCount++; // This is always 1 at the end; never accumulates
    }
}

// WITH Database.Stateful — errorCount persists across all execute() calls
public class GoodBatch implements Database.Batchable<SObject>, Database.Stateful {
    private Integer errorCount = 0; // Persists via serialisation between chunks

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        errorCount++; // Correctly accumulates
    }
}
```

### Heap Implications of Database.Stateful

The stateful instance is serialised between chunks and the serialised bytes count against each chunk's 12 MB heap limit. If you accumulate a growing `List<String>` of error messages across millions of records, the list itself may grow large enough to contribute to heap exhaustion.

Mitigation strategies:
- Flush and insert error log records in batches within `execute()` rather than accumulating in memory.
- Store only IDs and error codes, not full error messages, in the accumulator.
- Use a custom `BatchErrorLog__c` object: insert error log records in `execute()` and query them in `finish()`.

---

## Scope Sizing

The `scope` parameter in `Database.executeBatch(job, scope)` defaults to 200. Maximum is 2,000.

```apex
// Default scope (200 records per execute())
Id jobId = Database.executeBatch(new MyBatch());

// Explicit scope
Id jobId = Database.executeBatch(new MyBatch(), 200);

// Higher scope — only safe for read-only or single-bulk-DML batches
Id jobId = Database.executeBatch(new MyBatch(), 2000);
```

### Scope Sizing Decision Table

| execute() DML Pattern | Recommended Scope |
|---|---|
| No DML (read-only analysis, aggregate) | 2,000 |
| Single `Database.update(list, false)` on scope records | 200 |
| Single DML + SOQL lookup per record (1 SOQL per record) | 200 |
| Two DML statements (parent + child update) | 100 |
| One HTTP callout per record (`Database.AllowsCallouts`) | 100 |
| Complex multi-DML + callout pattern | 50 |
| Known heap-heavy records (attachments, rich text fields) | 50–100 |

The 10,000 DML-row-per-transaction limit means: even with scope 200 and one DML call, you use 200 of 10,000 rows. If `execute()` contains multiple DML calls each operating on the full scope list, multiply: scope 200 × 3 DML calls = 600 rows. Still fine. The risk is CPU time and heap, not row count, for most batches.

---

## allOrNone = false Pattern with SaveResult Error Collection

Always use `Database.insert/update/upsert` with `allOrNone = false` in Batch Apex `execute()`. The default DML statement (`insert records;`) uses `allOrNone = true` and rolls back the entire chunk if any record fails.

```apex
public void execute(Database.BatchableContext bc, List<SObject> scope) {
    List<Account> toUpdate = new List<Account>();
    for (SObject s : scope) {
        Account a = (Account) s;
        a.Description = 'Processed';
        toUpdate.add(a);
    }

    // allOrNone = false: successful records are committed; failed ones are not
    Database.SaveResult[] results = Database.update(toUpdate, false);

    for (Integer i = 0; i < results.size(); i++) {
        if (!results[i].isSuccess()) {
            // results[i].getErrors() returns List<Database.Error>
            Database.Error err = results[i].getErrors()[0];
            String msg = toUpdate[i].Id
                + ' | ' + err.getStatusCode()
                + ': ' + err.getMessage()
                + ' (' + String.join(err.getFields(), ', ') + ')';
            errors.add(msg); // 'errors' is a Database.Stateful instance variable
        }
    }
}
```

### UpsertResult Pattern

```apex
Database.UpsertResult[] results = Database.upsert(toUpsert, Account.External_ID__c, false);
for (Integer i = 0; i < results.size(); i++) {
    if (!results[i].isSuccess()) {
        Database.Error err = results[i].getErrors()[0];
        errors.add(String.valueOf(i) + ': ' + err.getMessage());
    } else {
        if (results[i].isCreated()) {
            createdCount++;
        } else {
            updatedCount++;
        }
    }
}
```

### DeleteResult Pattern

```apex
Database.DeleteResult[] results = Database.delete(toDelete, false);
for (Database.DeleteResult dr : results) {
    if (!dr.isSuccess()) {
        errors.add(dr.getId() + ': ' + dr.getErrors()[0].getMessage());
    }
}
```

---

## Database.AllowsCallouts

To make HTTP callouts from `execute()`, implement the `Database.AllowsCallouts` marker interface:

```apex
public class CalloutBatch
        implements Database.Batchable<SObject>, Database.AllowsCallouts {

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator('SELECT Id, External_Key__c FROM Account WHERE Synced__c = false');
    }

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        // 100 callout limit per execute() transaction applies here.
        // With scope 100, can make 1 callout per record.
        for (SObject s : scope) {
            Account a = (Account) s;
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:MyNamedCred/api/accounts/' + a.External_Key__c);
            req.setMethod('GET');
            HttpResponse res = new Http().send(req);
            // process response...
        }
    }

    public void finish(Database.BatchableContext bc) {}
}
```

Key constraints:
- Each `execute()` invocation has a callout limit of 100.
- Each `execute()` has a total callout time limit of 120 seconds.
- Reduce scope size proportionally to callouts per record (e.g., scope = 50 if each record requires 2 callouts).

---

## Batch Chaining in finish()

Chain the next batch from `finish()` — this is the **only** valid place to call `Database.executeBatch` within a batch class. Calling it from `execute()` throws `System.AsyncException`.

```apex
public void finish(Database.BatchableContext bc) {
    AsyncApexJob job = [
        SELECT Status, NumberOfErrors, TotalJobItems, JobItemsProcessed, ExtendedStatus
        FROM AsyncApexJob WHERE Id = :bc.getJobId()
    ];

    // Log completion
    System.debug('Batch complete. Items: ' + job.TotalJobItems
        + ', Errors: ' + job.NumberOfErrors
        + ', Status: ' + job.Status);

    // Persist error log if errors exist
    if (!errors.isEmpty()) {
        List<Batch_Error_Log__c> logs = new List<Batch_Error_Log__c>();
        for (String errMsg : errors) {
            logs.add(new Batch_Error_Log__c(
                Batch_Class__c = 'ExampleBatch',
                Error_Message__c = errMsg,
                Run_Date__c = Date.today()
            ));
        }
        insert logs;
    }

    // Chain next batch — only if current batch succeeded
    if (job.NumberOfErrors == 0) {
        Database.executeBatch(new NextProcessingBatch(), 200);
    }
}
```

---

## AsyncApexJob Monitoring

Query job status before enqueueing to avoid parallel job conflicts:

```apex
// Check for running jobs of the same batch class
List<AsyncApexJob> running = [
    SELECT Id, Status, NumberOfErrors, TotalJobItems, JobItemsProcessed
    FROM AsyncApexJob
    WHERE ApexClass.Name = 'MyBatch'
    AND Status IN ('Holding', 'Queued', 'Preparing', 'Processing')
];

if (running.isEmpty()) {
    Database.executeBatch(new MyBatch(), 200);
} else {
    System.debug('Job already running: ' + running[0].Id);
}
```

Query full job detail after completion:

```apex
AsyncApexJob job = [
    SELECT Id, Status, NumberOfErrors, TotalJobItems, JobItemsProcessed,
           ExtendedStatus, CreatedDate, CompletedDate, ApexClass.Name
    FROM AsyncApexJob WHERE Id = :jobId
];
```

`ExtendedStatus` is a 255-character string containing the first unhandled exception or governor limit message that caused the batch to fail.

---

## Common Failures and Remediation

### System.LimitException: Apex heap size too large

**Cause**: Records in scope (or accumulated state) exceed 12 MB per `execute()` call.

**Remediation**:
1. Reduce scope size (try 50 or 100).
2. If using `Database.Stateful`, flush accumulator data to a custom object or clear the list periodically rather than holding all data until `finish()`.
3. Avoid storing entire SObject records in instance variables; store only IDs or key fields.
4. Use `Database.getQueryLocator` with a selective WHERE clause to reduce fields returned (avoid `SELECT *`).

### System.LimitException: Maximum CPU time exceeded

**Cause**: `execute()` logic runs longer than 60 seconds of CPU time.

**Remediation**:
1. Eliminate SOQL inside loops — use Maps keyed by ID with a single pre-query.
2. Move heavy computation to a Queueable job and enqueue from `execute()` (one Queueable per `execute()` call is permitted).
3. Reduce scope size to process fewer records per `execute()` invocation.
4. Profile using Developer Console or Apex log EXECUTION_UNIT_FINISHED events.

### UNABLE_TO_LOCK_ROW

**Cause**: Concurrent batch jobs or other transactions updating the same SObject records simultaneously.

**Remediation**:
1. Check for other running jobs with the `AsyncApexJob` query above.
2. Chain batches in `finish()` instead of launching them concurrently.
3. Switch the Bulk API 2.0 job to `Serial` concurrency mode.
4. Schedule bulk jobs during off-peak hours using Scheduled Apex.

### Cursor Timeout

**Cause**: Server-side QueryLocator cursor expires if more than 10 minutes elapse between the end of one `execute()` and the start of the next (extremely rare with normal CPU usage).

**Remediation**:
1. Ensure `execute()` completes well within the 60-second CPU time limit.
2. Avoid synchronous HTTP callouts that can block for long periods.
3. Reduce scope size so each chunk completes faster.

### Database.executeBatch called from execute()

**Cause**: Attempting to launch another batch from within `execute()`.

**Remediation**: Move the `Database.executeBatch` call to `finish()`. This is the only supported chaining point.

---

## Unit Testing Batch Apex

```apex
@isTest
private class ExampleBatchTest {

    @TestSetup
    static void setup() {
        // Insert 201+ records to force multi-chunk execution
        List<Account> accounts = new List<Account>();
        for (Integer i = 0; i < 250; i++) {
            accounts.add(new Account(Name = 'Test Account ' + i));
        }
        insert accounts;
    }

    @isTest
    static void testBatchSuccess() {
        Test.startTest();
        // Execute with scope 200 — will run 2 execute() chunks for 250 records
        Id jobId = Database.executeBatch(new ExampleBatch(), 200);
        Test.stopTest(); // Forces synchronous execution

        AsyncApexJob job = [
            SELECT Status, NumberOfErrors
            FROM AsyncApexJob WHERE Id = :jobId
        ];
        System.assertEquals('Completed', job.Status, 'Batch should complete successfully');
        System.assertEquals(0, job.NumberOfErrors, 'No errors expected');
    }

    @isTest
    static void testErrorCollection() {
        // Insert a record that will fail business logic
        Account badAccount = new Account(Name = 'FORCE_FAIL');
        insert badAccount;

        Test.startTest();
        Id jobId = Database.executeBatch(new ExampleBatch(), 200);
        Test.stopTest();

        List<Batch_Error_Log__c> logs = [SELECT Id FROM Batch_Error_Log__c];
        System.assert(!logs.isEmpty(), 'Error logs should be created for failed records');
    }
}
```

Key testing rules:
- `Test.startTest()` / `Test.stopTest()` forces synchronous batch execution in tests.
- Insert at least `scope + 1` records to verify multi-chunk `Database.Stateful` behaviour.
- Assert both `AsyncApexJob.Status` and side-effects (log records, field updates).
- Mock HTTP callouts using `Test.setMock(HttpCalloutMock.class, ...)` when testing `Database.AllowsCallouts` batches.
