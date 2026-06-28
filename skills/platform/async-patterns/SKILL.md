---
name: platform-async-patterns
description: >-
  future method, Queueable, System.Queueable, Database.AllowsCallouts,
  Schedulable, CronTrigger, Platform Events, PlatformEvent__e, EventBus,
  Change Data Capture, CDC, ChangeEventHeader, ChangeType, Continuation,
  event replay, event ordering, async governor limits, transaction finalizer,
  Finalizer, queueable chain, pub/sub, event-driven architecture,
  after-insert trigger async, callout from trigger
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: async-patterns
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# platform-async-patterns

Guidance for Salesforce async execution patterns: `@future`, Queueable, Schedulable, Platform Events, Change Data Capture, Continuation, event replay, transaction finalizers, and async governor limits.

---

## Gotchas

### 1. `@future` methods cannot be called from Queueable or Batch Apex — use Queueable instead

`@future` is the oldest async primitive. It cannot be enqueued from within another async context (Queueable, Batch Apex, Scheduled Apex). It has no state, no chaining, and no `Database.AllowsCallouts` equivalent (callouts require `@future(callout=true)`). Prefer Queueable for any new async code; `@future` exists primarily for simple fire-and-forget callouts from triggers.

```apex
// WRONG — calling @future from a Queueable execute() method throws:
// System.AsyncException: Future method cannot be called from a future or batch method
public class MyQueueable implements System.Queueable {
    public void execute(QueueableContext ctx) {
        MyFutureClass.doFutureWork(); // runtime error
    }
}

// RIGHT — enqueue a child Queueable instead
public class MyQueueable implements System.Queueable {
    public void execute(QueueableContext ctx) {
        System.enqueueJob(new AnotherQueueable());
    }
}
```

---

### 2. Queueable depth is limited to 5 levels in synchronous context and unlimited in async — but only 1 child can be enqueued per execute()

`System.enqueueJob()` from within a Queueable's `execute()` method enqueues exactly one child job. You cannot enqueue multiple jobs from a single `execute()` call in production (allowed in unit tests). This means Queueable chains are sequential, not fan-out.

```apex
// WRONG — enqueuing multiple children in production throws:
// System.LimitException: Too many queueable jobs added to the queue: 2
public class FanOutQueueable implements System.Queueable {
    public void execute(QueueableContext ctx) {
        System.enqueueJob(new WorkerA()); // ok
        System.enqueueJob(new WorkerB()); // runtime error in production
    }
}

// RIGHT — use a dispatcher/chain pattern
public class DispatcherQueueable implements System.Queueable {
    private List<Id> workItemIds;
    private Integer index;

    public DispatcherQueueable(List<Id> workItemIds, Integer index) {
        this.workItemIds = workItemIds;
        this.index = index;
    }

    public void execute(QueueableContext ctx) {
        doWork(workItemIds[index]);
        if (index + 1 < workItemIds.size()) {
            System.enqueueJob(new DispatcherQueueable(workItemIds, index + 1));
        }
    }
}
```

---

### 3. Platform Events are published transactionally — `EventBus.publish()` publishes only if the transaction commits

`EventBus.publish(event)` does not fire the event immediately. It is held in a buffer and published only if the enclosing transaction commits successfully. If the transaction rolls back (exception, validation failure), the event is never published. This is the key difference from `Messaging.sendEmail` which also respects transaction commits.

```apex
// EventBus.publish() outcome depends on transaction commit
MyEvent__e evt = new MyEvent__e(Payload__c = 'data');
Database.SaveResult sr = EventBus.publish(evt);

// The event is NOT published yet at this line.
// It publishes when/if this transaction commits.
// If an unhandled exception occurs after this line, the event is discarded.
// If you need guaranteed publish regardless of later DML errors,
// publish from a separate transaction.
```

---

### 4. `ChangeEventHeader.changeType` values are `CREATE`, `UPDATE`, `DELETE`, `UNDELETE` — not insert/update/delete

CDC events use different vocabulary from DML operation names. Apex triggers use `Trigger.isInsert/isUpdate/isDelete/isUndelete`; CDC ChangeEventHeader uses `CREATE/UPDATE/DELETE/UNDELETE`. Filtering CDC events with the wrong string comparison (e.g. `== 'insert'`) produces silent no-ops.

```apex
trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    for (AccountChangeEvent event : Trigger.new) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;

        // WRONG — silent no-op; CDC never uses 'insert'
        if (header.changeType == 'insert') { /* never executes */ }

        // RIGHT — use CDC vocabulary
        if (header.changeType == 'CREATE') {
            handleCreate(event);
        } else if (header.changeType == 'UPDATE') {
            handleUpdate(event);
        } else if (header.changeType == 'DELETE') {
            handleDelete(event);
        } else if (header.changeType == 'UNDELETE') {
            handleUndelete(event);
        }
    }
}
```

---

### 5. CDC `changedFields` only lists the fields that actually changed — not all fields

`ChangeEventHeader.changedFields` is a `List<String>` of the field API names that were modified in the transaction. All other fields on the CDC event payload have null values. Never assume all fields are populated on an `UPDATE` CDC event — always check `changedFields` before reading a field value.

```apex
trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    for (AccountChangeEvent event : Trigger.new) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;

        if (header.changeType == 'UPDATE') {
            // WRONG — event.Phone is null unless Phone was one of the changed fields
            String phone = event.Phone; // may be null even if the account has a phone

            // RIGHT — check changedFields first
            if (header.changedFields.contains('Phone')) {
                String updatedPhone = event.Phone;
                processPhoneChange(header.recordIds, updatedPhone);
            }
        }
    }
}
```

---

### 6. Platform Events have a 72-hour replay window — `ReplayId = -1` replays all retained events, `ReplayId = -2` subscribes to new events only

`ReplayId = -1` replays up to 72 hours of retained events (can replay millions of events). `ReplayId = -2` subscribes from now (no replay). If an Apex trigger subscribes to a platform event channel, it always processes from the current position (no replay). Replay is only available through the CometD API or event relay.

```javascript
// CometD subscription — replay all retained events (up to 72 hours)
cometd.subscribe(
    '/event/MyEvent__e',
    function(message) { handleMessage(message); },
    { ext: { 'replay': { '/event/MyEvent__e': -1 } } }
);

// CometD subscription — new events only, no replay
cometd.subscribe(
    '/event/MyEvent__e',
    function(message) { handleMessage(message); },
    { ext: { 'replay': { '/event/MyEvent__e': -2 } } }
);
```

```apex
// Apex trigger subscriber — no replay control; always processes from current position
trigger MyEventTrigger on MyEvent__e (after insert) {
    for (MyEvent__e event : Trigger.new) {
        String replayId = event.ReplayId; // available but cannot be controlled
        processEvent(event);
    }
}
```

---

### 7. Schedulable Apex cannot be scheduled more frequently than once per minute — minimum CRON interval is 1 minute

The `CronTrigger` object stores scheduled jobs. You cannot schedule a job to run more frequently than once per minute using `System.schedule`. For sub-minute frequency, use Platform Events + a trigger subscriber. Maximum scheduled Apex jobs per org: 100.

```apex
// WRONG intent — no CRON syntax runs more often than every minute
// '*/30 * * * * ?' is not valid in Salesforce CRON syntax

// RIGHT — minimum interval: every minute
String cronExpr = '0 * * * * ?'; // Runs at second 0 of every minute
System.schedule('My Job', cronExpr, new MySchedulable());

// For sub-minute processing, use Platform Events:
// publisher → EventBus.publish(new MyEvent__e())
// subscriber trigger on MyEvent__e processes immediately on commit
```

---

### 8. `System.enqueueJob` called from a trigger is limited to 1 enqueue per trigger execution in synchronous context

In a trigger running synchronously, only one `System.enqueueJob` call is allowed. Calling it multiple times (e.g. in a loop) throws `System.LimitException: Too many queueable jobs added to the queue: 2`. Collect all context into one Queueable class and enqueue once.

```apex
trigger AccountTrigger on Account (after insert) {
    // WRONG — enqueuing inside a loop throws on the second iteration
    for (Account acc : Trigger.new) {
        System.enqueueJob(new AccountProcessor(acc.Id)); // fails on 2nd record
    }

    // RIGHT — collect all IDs and enqueue one job
    List<Id> accountIds = new List<Id>();
    for (Account acc : Trigger.new) {
        accountIds.add(acc.Id);
    }
    System.enqueueJob(new AccountBulkProcessor(accountIds)); // one enqueue
}
```

---

### 9. Transaction Finalizer (`System.Finalizer`) runs after a Queueable succeeds or fails — it is the only way to handle Queueable failure gracefully

`System.attachFinalizer(finalizer)` in a Queueable's `execute()` method registers a `System.Finalizer` that runs after the Queueable completes, regardless of success or failure. The Finalizer's `execute(FinalizerContext ctx)` receives `ctx.getResult()` (SUCCESS or UNHANDLED_EXCEPTION). Without a Finalizer, a failed Queueable has no built-in retry or alert mechanism.

```apex
public class MyQueueable implements System.Queueable {
    private Id recordId;

    public MyQueueable(Id recordId) {
        this.recordId = recordId;
    }

    public void execute(QueueableContext ctx) {
        // Attach finalizer BEFORE doing work so it catches any exception
        System.attachFinalizer(new MyFinalizer(recordId));
        processRecord(recordId); // if this throws, Finalizer still runs
    }
}

public class MyFinalizer implements System.Finalizer {
    private Id recordId;

    public MyFinalizer(Id recordId) {
        this.recordId = recordId;
    }

    public void execute(FinalizerContext ctx) {
        if (ctx.getResult() == ParentJobResult.UNHANDLED_EXCEPTION) {
            // Log, alert, or re-enqueue with retry logic
            System.debug('Queueable failed: ' + ctx.getException().getMessage());
            // System.enqueueJob(new RetryQueueable(recordId));
        }
    }
}
```

---

### 10. `Continuation` is only available in Visualforce and LWC server-side controllers — not in triggers or Batch Apex

`Continuation` allows a long-running HTTP callout (up to 120 seconds) without blocking the UI thread. It is only valid in `@AuraEnabled` methods and Visualforce controller methods. Using `Continuation` in a trigger, Batch Apex, or Queueable throws a compile-time or runtime error. Standard callouts in those contexts are limited to 10 seconds per callout.

```apex
// RIGHT — Continuation in an @AuraEnabled method (LWC server-side)
public class MyController {
    @AuraEnabled(continuation=true)
    public static Object startRequest(String endpoint) {
        Continuation cont = new Continuation(120); // max wait: 120 seconds
        cont.continuationMethod = 'processResponse';
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('GET');
        cont.addHttpRequest(req);
        return cont;
    }

    @AuraEnabled
    public static Object processResponse() {
        HttpResponse res = Continuation.getResponse('myLabel');
        return res.getBody();
    }
}

// WRONG — Continuation in a trigger causes a compile-time error
trigger AccountTrigger on Account (after insert) {
    Continuation c = new Continuation(30); // does not compile
}
```

---

### 11. Platform Event delivery order is guaranteed within a partition but not across partitions

Standard volume Platform Events are not guaranteed to be delivered in publication order. High-volume Platform Events have ordering guarantees within a partition (default: all events in the same channel go to the same partition). If order matters, include a sequence number or timestamp in the event payload.

```apex
// Include ordering metadata in the event payload when delivery order matters
MyOrderedEvent__e evt = new MyOrderedEvent__e(
    Payload__c        = 'data',
    SequenceNumber__c = getNextSequence(), // application-managed sequence
    EventTimestamp__c = System.now()
);
EventBus.publish(evt);

// Subscriber detects and handles out-of-order delivery
trigger MyOrderedEventTrigger on MyOrderedEvent__e (after insert) {
    for (MyOrderedEvent__e event : Trigger.new) {
        if (event.SequenceNumber__c != getExpectedSequence()) {
            // Buffer event, request replay, or alert monitoring
        }
    }
}
```

---

### 12. `Database.AllowsCallouts` on Queueable allows HTTP callouts — but the 10-second callout timeout still applies per callout

Implementing `Database.AllowsCallouts` on a Queueable class allows `Http.send()` calls in `execute()`. Each callout still has a 10-second response timeout (not configurable). The total callout time per Queueable transaction is 120 seconds (sum of all callouts). A single slow external service can exhaust this quickly.

```apex
public class CalloutQueueable implements System.Queueable, Database.AllowsCallouts {
    public void execute(QueueableContext ctx) {
        Http h = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://api.example.com/data');
        req.setMethod('GET');
        req.setTimeout(10000); // 10,000 ms — this is the per-callout maximum
        HttpResponse res = h.send(req);
        // Total callout time across all Http.send() calls in execute():
        // capped at 120 seconds cumulative
    }
}
```

---

### 13. Scheduled Apex `CronTrigger.State` must be checked before re-scheduling — re-scheduling an ACTIVE job creates a duplicate

`System.schedule()` always creates a new `CronTrigger` record; it does not replace an existing one. Before calling `System.schedule()`, query `CronTrigger WHERE CronJobDetail.Name = :jobName AND State NOT IN ('DELETED', 'COMPLETE')` and abort existing jobs first with `System.abortJob(cronTriggerId)`.

```apex
public static void safeSchedule(String jobName, String cronExpr, Schedulable job) {
    // Abort any existing active jobs with this name to prevent duplicates
    for (CronTrigger ct : [
        SELECT Id
        FROM CronTrigger
        WHERE CronJobDetail.Name = :jobName
          AND State NOT IN ('DELETED', 'COMPLETE')
    ]) {
        System.abortJob(ct.Id);
    }
    // Now safe to create a new scheduled job
    System.schedule(jobName, cronExpr, job);
}
```

---

### 14. CDC must be enabled per-object in Setup — enabling CDC on a high-volume object can generate millions of events that overwhelm subscribers

CDC is enabled via Setup → Change Data Capture, per SObject. Enabling it on Account or Contact in a large org generates a CDC event for every DML on those objects. Subscribers (Apex triggers on the `AccountChangeEvent` channel) must be able to handle the full event volume. Test in sandbox before enabling on LDV objects in production.

```apex
// After enabling CDC on Account via Setup, the Apex trigger subscriber fires
// for EVERY Account DML operation in the org — ensure logic is bulkified.
trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    List<Id> recordIds = new List<Id>();
    for (AccountChangeEvent event : Trigger.new) {
        // ChangeEventHeader.recordIds is a List<String>, not List<Id>
        for (String rid : event.ChangeEventHeader.recordIds) {
            recordIds.add(Id.valueOf(rid));
        }
    }
    processBulk(recordIds); // bulkified — no per-event SOQL
}
```

---

## Routing Table

| Reference File | Topics Covered |
|---|---|
| `references/01-architecture.md` | Async execution model, comparison table (`@future` vs Queueable vs Schedulable vs Batch vs Platform Event), async governor limits, `CronTrigger` fields |
| `references/02-queueable-and-future.md` | `@future` syntax and constraints, Queueable interface, chaining, `Database.AllowsCallouts`, Transaction Finalizer, fan-out workaround, unit test patterns |
| `references/03-platform-events.md` | `PlatformEvent__e` definition, `EventBus.publish()`, transactional semantics, replay IDs, 72-hour retention, subscriber trigger, `RetryableException`, dead-letter queue |
| `references/04-cdc-and-streaming.md` | CDC enablement, `ChangeEventHeader` fields, changedFields sparse behavior, `CREATE/UPDATE/DELETE/UNDELETE`, CDC channels, CometD, 3-day event retention |
| `references/05-schedulable-and-continuation.md` | `Schedulable` interface, `System.schedule()`, `CronTrigger` query and abort, max 100 jobs, CRON format, `Continuation` usage, callout timeout comparison |

---

## Workflows

### Workflow 1: Replace a `@future` callout with a Queueable chain with a Finalizer

1. Create a class implementing `System.Queueable, Database.AllowsCallouts`.
2. In `execute(QueueableContext ctx)`, call `System.attachFinalizer(new MyFinalizer(...))` before doing any work.
3. Move the HTTP callout logic from the `@future` method into `execute()`.
4. Implement `System.Finalizer` with `execute(FinalizerContext ctx)` to handle `UNHANDLED_EXCEPTION` (log, alert, or retry by enqueuing a new job).
5. Replace all `MyFutureClass.doWork(recordId)` call sites with `System.enqueueJob(new MyQueueable(recordId))`.
6. Remove the `@future` method.

See: `references/02-queueable-and-future.md`

### Workflow 2: Publish and subscribe to a Platform Event with error handling

1. Create a Platform Event object `MyEvent__e` with the required fields in Setup → Platform Events.
2. In the publisher code, call `EventBus.publish(event)` inside a transaction that commits successfully. Check the returned `Database.SaveResult` for publish-time errors.
3. Create an Apex trigger: `trigger MyEventTrigger on MyEvent__e (after insert)`.
4. In the subscriber trigger, wrap processing logic in try/catch. Throw `EventBus.RetryableException` to request redelivery; any other unhandled exception discards the event.
5. Unit-test using `Test.getEventBus().deliver()` to force synchronous delivery in tests.

See: `references/03-platform-events.md`

### Workflow 3: Set up CDC on an object and process ChangeEventHeader in a trigger subscriber

1. In Setup → Change Data Capture, move the target object to the Selected Entities list.
2. Create an Apex trigger on the CDC channel: `trigger AccountCDCTrigger on AccountChangeEvent (after insert)`.
3. In the trigger body, iterate `Trigger.new` and access `event.ChangeEventHeader`.
4. Branch on `header.changeType` using the values `CREATE`, `UPDATE`, `DELETE`, `UNDELETE`.
5. For `UPDATE` events, check `header.changedFields.contains('FieldApiName__c')` before reading any field value.
6. For `DELETE` and `UNDELETE` events, read record IDs from `header.recordIds`; payload fields are null.

See: `references/04-cdc-and-streaming.md`

---

## Out of Scope

- **Bulk data processing with Batch Apex** — use `platform-bulk-data-processing`
- **Flow async actions (Autolaunched Flow)** — not covered by this skill
- **Pub/Sub API (external CDC consumer)** — covers Apex subscribers only; Pub/Sub API for external consumers is out of scope
- **Apex REST callouts configuration** — use `platform-integration-patterns`
