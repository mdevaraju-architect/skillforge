# Queueable and @future Reference

## `@future` Methods

### Syntax

```apex
public class MyFutureClass {
    @future
    public static void doWork(List<Id> recordIds) {
        // Executes asynchronously in a separate transaction
        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id IN :recordIds];
        // Process accounts...
    }

    @future(callout=true)
    public static void doCallout(String endpoint, String payload) {
        Http h = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('POST');
        req.setBody(payload);
        HttpResponse res = h.send(req);
        // Handle response...
    }
}
```

### Constraints

| Constraint | Detail |
|---|---|
| **Method signature** | Must be `public static void`. No return value. |
| **Parameter types** | Primitives, primitive collections (`List<String>`, `Set<Id>`), and `Map<Id, String>` patterns. SObjects and SObject collections are **not** allowed as parameters. |
| **Callouts** | Only allowed with `@future(callout=true)`. Without this annotation, `Http.send()` throws `System.CalloutException`. |
| **Calling context** | Cannot be called from another `@future` method, Queueable, Batch Apex, or Scheduled Apex. |
| **Chaining** | Not supported. |
| **State** | No state beyond the parameters passed in. |
| **Max calls per transaction** | 50 `@future` method invocations per synchronous transaction. |
| **Error handling** | No built-in callback on failure. Failures logged to `AsyncApexJob` but not surfaced to caller. |

### When to Use `@future`

- Fire-and-forget callouts from a trigger where you cannot use Queueable (legacy code).
- Mixed DML operations (e.g. insert a Setup object from a non-Setup context).
- Situations where the simple parameter restriction is not a problem.

**Prefer Queueable for all new async code.** `@future` cannot be called from any async context, cannot chain, and has no error handling.

---

## Queueable Interface

### Interface Definition

```apex
// Minimal Queueable
public class MyQueueable implements System.Queueable {
    public void execute(QueueableContext ctx) {
        // Main work here
    }
}

// Queueable with callouts
public class MyCalloutQueueable implements System.Queueable, Database.AllowsCallouts {
    public void execute(QueueableContext ctx) {
        Http h = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://api.example.com/data');
        req.setMethod('GET');
        req.setTimeout(10000);
        HttpResponse res = h.send(req);
    }
}
```

### `QueueableContext` Fields

```apex
public void execute(QueueableContext ctx) {
    Id jobId = ctx.getJobId(); // The AsyncApexJob Id for this execution
    // Use for logging, correlation, or passing to Finalizer
}
```

### `System.enqueueJob` Return Value

`System.enqueueJob(queueable)` returns the `Id` of the newly created `AsyncApexJob` record. This ID can be stored for monitoring.

```apex
Id jobId = System.enqueueJob(new MyQueueable(recordIds));
// Store jobId in a custom object or log for later monitoring
insert new AsyncLog__c(JobId__c = jobId, Status__c = 'Enqueued');
```

### `Database.AllowsCallouts`

Implementing `Database.AllowsCallouts` on a Queueable class marks it as eligible for HTTP callouts. Without it, any `Http.send()` call in `execute()` throws `System.CalloutException: Callout not allowed from synchronous Apex code`. The interface has no methods to implement — it is a marker interface.

```apex
// WRONG — callout without Database.AllowsCallouts
public class BadQueueable implements System.Queueable {
    public void execute(QueueableContext ctx) {
        Http h = new Http();
        h.send(new HttpRequest()); // CalloutException at runtime
    }
}

// RIGHT
public class GoodQueueable implements System.Queueable, Database.AllowsCallouts {
    public void execute(QueueableContext ctx) {
        Http h = new Http();
        h.send(new HttpRequest()); // allowed
    }
}
```

---

## Queueable Chaining

Enqueue exactly one child job from within `execute()` to create a sequential chain.

```apex
public class ChainedQueueable implements System.Queueable {
    private List<Id> recordIds;
    private Integer chunkIndex;
    private static final Integer CHUNK_SIZE = 200;

    public ChainedQueueable(List<Id> recordIds, Integer chunkIndex) {
        this.recordIds = recordIds;
        this.chunkIndex = chunkIndex;
    }

    public void execute(QueueableContext ctx) {
        // Process current chunk
        Integer start = chunkIndex * CHUNK_SIZE;
        Integer stop  = Math.min(start + CHUNK_SIZE, recordIds.size());
        List<Id> chunk = new List<Id>();
        for (Integer i = start; i < stop; i++) {
            chunk.add(recordIds[i]);
        }
        processChunk(chunk);

        // Chain to next chunk if more work remains
        if (stop < recordIds.size()) {
            System.enqueueJob(new ChainedQueueable(recordIds, chunkIndex + 1));
        }
    }

    private void processChunk(List<Id> chunk) {
        // Business logic here
    }
}

// Enqueue from trigger or service class
System.enqueueJob(new ChainedQueueable(allRecordIds, 0));
```

**Depth limits:**
- Enqueued from synchronous context (trigger, VF controller, etc.): maximum chain depth of 5 before the system stops allowing further children.
- Enqueued from within an async context (i.e. the initial Queueable was enqueued from async code): chain depth is unlimited.

---

## Transaction Finalizer

The `System.Finalizer` interface provides a guaranteed post-execution callback for a Queueable, whether it succeeded or failed. It is the only built-in mechanism for Queueable error recovery.

### Interface

```apex
public interface System.Finalizer {
    void execute(FinalizerContext ctx);
}
```

### `FinalizerContext` Methods

| Method | Return Type | Description |
|---|---|---|
| `getAsyncApexJobId()` | `Id` | The `AsyncApexJob.Id` of the parent Queueable |
| `getResult()` | `ParentJobResult` | `SUCCESS` or `UNHANDLED_EXCEPTION` |
| `getException()` | `Exception` | The exception that caused failure; null if result is `SUCCESS` |

### `ParentJobResult` Values

- `ParentJobResult.SUCCESS`
- `ParentJobResult.UNHANDLED_EXCEPTION`

### Full Pattern

```apex
public class RobustQueueable implements System.Queueable, Database.AllowsCallouts {
    private Id orderId;
    private Integer retryCount;
    private static final Integer MAX_RETRIES = 3;

    public RobustQueueable(Id orderId, Integer retryCount) {
        this.orderId  = orderId;
        this.retryCount = retryCount;
    }

    public void execute(QueueableContext ctx) {
        // Attach before any work — Finalizer registration must come before
        // any code that might throw
        System.attachFinalizer(new OrderFinalizer(orderId, retryCount, ctx.getJobId()));

        // Do work
        processOrder(orderId);
    }

    private void processOrder(Id orderId) {
        // callout, DML, etc.
    }
}

public class OrderFinalizer implements System.Finalizer {
    private Id orderId;
    private Integer retryCount;
    private Id parentJobId;

    public OrderFinalizer(Id orderId, Integer retryCount, Id parentJobId) {
        this.orderId    = orderId;
        this.retryCount = retryCount;
        this.parentJobId = parentJobId;
    }

    public void execute(FinalizerContext ctx) {
        if (ctx.getResult() == ParentJobResult.SUCCESS) {
            // Optionally log success
            return;
        }

        // UNHANDLED_EXCEPTION path
        Exception e = ctx.getException();
        System.debug('Job ' + parentJobId + ' failed: ' + e.getMessage());

        if (retryCount < RobustQueueable.MAX_RETRIES) {
            // Re-enqueue with incremented retry count
            System.enqueueJob(new RobustQueueable(orderId, retryCount + 1));
        } else {
            // Max retries exceeded — log to custom object, send notification
            insert new ErrorLog__c(
                JobId__c    = parentJobId,
                RecordId__c = orderId,
                Message__c  = e.getMessage(),
                StackTrace__c = e.getStackTraceString()
            );
        }
    }
}
```

**Important**: `System.attachFinalizer()` can only be called once per Queueable execution. Calling it multiple times throws `System.FinalizeException`. It must be called inside `execute()`, not in the constructor.

---

## Fan-Out Workaround

Since only one child can be enqueued per `execute()` call in production, true fan-out requires a dispatcher pattern:

```apex
// Dispatcher: collects work items and enqueues a child for the first item,
// passing the remainder to that child, which in turn enqueues the next, etc.
// This is effectively a chain, not true parallel fan-out.

// For genuine parallelism, use Platform Events:
// Enqueue one Queueable that publishes N Platform Events.
// N trigger subscribers process the events in parallel (up to event delivery concurrency).

public class FanOutViaEvents implements System.Queueable {
    private List<Id> workItemIds;

    public FanOutViaEvents(List<Id> workItemIds) {
        this.workItemIds = workItemIds;
    }

    public void execute(QueueableContext ctx) {
        List<WorkItem__e> events = new List<WorkItem__e>();
        for (Id wid : workItemIds) {
            events.add(new WorkItem__e(RecordId__c = wid));
        }
        List<Database.SaveResult> results = EventBus.publish(events);
        // Each published event fires the WorkItem__e trigger subscriber
        // concurrently (subject to platform concurrency limits)
    }
}
```

---

## Unit Testing Queueables

```apex
@isTest
static void testQueueable() {
    // Set up test data
    Account acc = new Account(Name = 'Test');
    insert acc;

    Test.startTest();
    System.enqueueJob(new MyQueueable(new List<Id>{ acc.Id }));
    // Test.stopTest() flushes the async queue and runs the Queueable synchronously
    Test.stopTest();

    // Assert expected outcomes
    Account updated = [SELECT Name FROM Account WHERE Id = :acc.Id];
    System.assertEquals('Processed', updated.Name);
}

@isTest
static void testFinalizer() {
    Test.startTest();
    // In test context, multiple enqueueJob calls are allowed
    // Finalizer runs synchronously at Test.stopTest()
    System.enqueueJob(new RobustQueueable(someId, 0));
    Test.stopTest();

    // Check that the Finalizer's actions (e.g. retry enqueue, error log) occurred
    List<ErrorLog__c> errors = [SELECT Id FROM ErrorLog__c];
    System.assertEquals(0, errors.size()); // assuming success scenario
}
```

### AsyncApexJob Monitoring in Tests

```apex
// After Test.stopTest(), the AsyncApexJob record reflects the final state
List<AsyncApexJob> jobs = [
    SELECT Id, Status, NumberOfErrors, ExtendedStatus
    FROM AsyncApexJob
    WHERE JobType = 'Queueable'
    ORDER BY CreatedDate DESC
    LIMIT 1
];
System.assertEquals('Completed', jobs[0].Status);
System.assertEquals(0, jobs[0].NumberOfErrors);
```
