# Platform Events Reference

## Platform Event Object Definition

Platform Events are SObjects with the `__e` suffix. They are defined in Setup → Platform Events.

### Standard Volume vs High-Volume

| Attribute | Standard Volume | High-Volume |
|---|---|---|
| **Delivery volume** | Lower (suitable for inter-org or admin workflows) | Millions per 24 hours (configurable) |
| **Retention** | 72 hours | 72 hours |
| **Ordering guarantee** | No guaranteed order | Ordered within a partition |
| **Use case** | Workflow, process automation, moderate volume | High-throughput integrations, CDC-like patterns |

High-volume is recommended for most application integrations. Select it when defining the Platform Event object in Setup.

### Example Object Definition (metadata API)

```xml
<!-- MyEvent__e.object (Platform Event) -->
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>My Event</label>
    <pluralLabel>My Events</pluralLabel>
    <deploymentStatus>Deployed</deploymentStatus>
    <eventType>HighVolume</eventType>  <!-- or StandardVolume -->
    <fields>
        <fullName>Payload__c</fullName>
        <label>Payload</label>
        <type>LongTextArea</type>
        <length>131072</length>
        <visibleLines>3</visibleLines>
    </fields>
    <fields>
        <fullName>CorrelationId__c</fullName>
        <label>Correlation Id</label>
        <type>Text</type>
        <length>255</length>
    </fields>
</CustomObject>
```

---

## Publishing Platform Events

### `EventBus.publish()` — Single Event

```apex
MyEvent__e evt = new MyEvent__e(
    Payload__c       = '{"action":"created","id":"' + record.Id + '"}',
    CorrelationId__c = correlationId
);
Database.SaveResult sr = EventBus.publish(evt);

if (!sr.isSuccess()) {
    for (Database.Error err : sr.getErrors()) {
        System.debug('Publish error: ' + err.getStatusCode() + ' - ' + err.getMessage());
    }
}
```

### `EventBus.publish()` — Bulk

```apex
List<MyEvent__e> events = new List<MyEvent__e>();
for (Account acc : accounts) {
    events.add(new MyEvent__e(Payload__c = acc.Id));
}
List<Database.SaveResult> results = EventBus.publish(events);

for (Integer i = 0; i < results.size(); i++) {
    if (!results[i].isSuccess()) {
        System.debug('Event ' + i + ' failed: ' + results[i].getErrors());
    }
}
```

### Transactional Publish Semantics

`EventBus.publish()` does **not** publish the event immediately. The platform holds the event in a transactional buffer. The event is released to subscribers **only if** the enclosing transaction commits successfully.

```apex
try {
    MyEvent__e evt = new MyEvent__e(Payload__c = 'data');
    EventBus.publish(evt); // buffered — not published yet

    Account acc = new Account(Name = 'Test');
    insert acc; // if this fails, the event is also discarded

    // Transaction commits here — event is now published
} catch (Exception e) {
    // Transaction rolled back — event was never published
}
```

**Contrast with `Messaging.sendEmail`:** Email sends are also held until transaction commit; they are not sent on rollback. Both behave the same way.

### Publishing Outside a Transaction (immediate publish)

To publish an event regardless of other DML in the current transaction, use a new savepoint and rollback:

```apex
// Publish in a sub-transaction that commits independently
Savepoint sp = Database.setSavepoint();
try {
    EventBus.publish(new MyEvent__e(Payload__c = 'alert'));
    // This sub-context commits the event
} catch (Exception e) {
    Database.rollback(sp);
}
// The outer transaction can still fail; the event has already been published
```

Note: This pattern is advanced and rarely needed. Most use cases benefit from the transactional guarantee.

---

## Replay ID and Event Retention

| ReplayId Value | Behavior |
|---|---|
| `-1` | Replay all events retained in the 72-hour window (can be millions) |
| `-2` | Subscribe from now; no replay of prior events |
| Specific positive integer | Replay all events after that specific `ReplayId` |

### 72-Hour Retention Window

- Platform Events are retained for 72 hours from publication time.
- Events published more than 72 hours ago cannot be replayed.
- Apex trigger subscribers always consume from the current position — they cannot specify a `ReplayId`.
- Only CometD (JavaScript / external) clients and the Event Relay feature can specify a `ReplayId`.

```javascript
// CometD — replay from 72-hour window start
cometd.subscribe('/event/MyEvent__e', handleMessage,
    { ext: { 'replay': { '/event/MyEvent__e': -1 } } });

// CometD — new events only
cometd.subscribe('/event/MyEvent__e', handleMessage,
    { ext: { 'replay': { '/event/MyEvent__e': -2 } } });

// CometD — replay from a known position
cometd.subscribe('/event/MyEvent__e', handleMessage,
    { ext: { 'replay': { '/event/MyEvent__e': 8765432 } } });
```

---

## Apex Trigger Subscriber

Platform Event subscribers in Apex are standard triggers with `after insert` only.

```apex
trigger MyEventTrigger on MyEvent__e (after insert) {
    for (MyEvent__e event : Trigger.new) {
        // event.ReplayId is available (read-only)
        // event.CreatedDate is the publication time
        // event.CreatedById is the publishing user

        String payload = event.Payload__c;
        String correlationId = event.CorrelationId__c;

        try {
            processEvent(payload, correlationId);
        } catch (EventBus.RetryableException e) {
            // Re-throw to request redelivery
            // Platform will retry delivery (up to platform-defined retry limit)
            throw e;
        } catch (Exception e) {
            // Any other exception — event is discarded (not retried)
            // Log the error before discarding
            logError(correlationId, e);
        }
    }
}
```

### `EventBus.RetryableException`

Throw `EventBus.RetryableException` from a subscriber trigger to tell the platform to redeliver the event. The platform will retry after a delay.

```apex
trigger MyEventTrigger on MyEvent__e (after insert) {
    for (MyEvent__e event : Trigger.new) {
        try {
            processEvent(event);
        } catch (System.DmlException dmlEx) {
            // Transient DML error — request retry
            throw new EventBus.RetryableException(
                'Transient failure, retrying: ' + dmlEx.getMessage()
            );
        } catch (Exception e) {
            // Permanent failure — log and discard
            System.debug(LoggingLevel.ERROR, 'Discarding event: ' + e.getMessage());
        }
    }
}
```

**Dead-letter queue behavior:** Events that exhaust retries or are discarded via non-retryable exceptions do not automatically go to a dead-letter queue in standard Platform Events. Implement your own dead-letter pattern by catching exceptions, logging event payloads, and marking them for manual reprocessing.

### Ordered vs Unordered Delivery

- Standard Volume Platform Events: no ordering guarantee.
- High-Volume Platform Events: ordered within a partition. The default partition places all events for a channel on one partition, providing channel-level ordering.
- If subscriber logic must process events in order, include a sequence number in the payload and implement ordering logic in the subscriber.

---

## Event Relay

Event Relay (available Summer '23+) forwards Salesforce Platform Events to Amazon EventBridge without code. Configure it in Setup → Event Relay Configurations. This allows external consumers to receive events with replay support without managing CometD connections.

Key points:
- Event Relay is a Setup-only feature; no Apex code required.
- It supports both standard and high-volume Platform Events.
- Replayed events via Event Relay use the same `ReplayId` as the original events.

---

## Governor Limits Specific to Platform Events

| Limit | Value |
|---|---|
| Max published events per transaction | 150 (Standard Volume), unlimited batching via `EventBus.publish(List)` |
| Event retention | 72 hours |
| Max fields per Platform Event | 100 |
| Max Platform Event definitions per org | 50 (Standard) / licensed add-ons for High-Volume |
| Subscriber trigger governor limits | Standard trigger limits (200 SOQL, 150 DML, 12 MB heap) |

---

## Unit Testing Platform Events

```apex
@isTest
static void testEventPublishAndSubscribe() {
    // Publish an event in test context
    MyEvent__e evt = new MyEvent__e(Payload__c = 'test-payload');
    Test.startTest();
    Database.SaveResult sr = EventBus.publish(evt);
    System.assert(sr.isSuccess(), 'Event publish failed: ' + sr.getErrors());

    // Deliver all pending platform events synchronously in test context
    // This triggers the subscriber trigger
    Test.getEventBus().deliver();
    Test.stopTest();

    // Assert side effects caused by the subscriber trigger
    List<ProcessedEvent__c> processed = [SELECT Id FROM ProcessedEvent__c];
    System.assertEquals(1, processed.size(), 'Expected 1 processed event record');
}
```

`Test.getEventBus().deliver()` must be called between `Test.startTest()` and `Test.stopTest()` to flush pending events synchronously. Without it, the subscriber trigger does not fire during the test.
