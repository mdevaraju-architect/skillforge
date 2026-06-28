# Platform Events, Change Data Capture, and External Objects

## Platform Events as an Integration Bus

Platform Events are the canonical Salesforce pattern for event-driven, decoupled outbound integration. They decouple the Salesforce transaction from the external system and provide at-least-once delivery semantics.

### Architecture Pattern

```
Salesforce Trigger  →  EventBus.publish()  →  Platform Event Channel
                                                       ↓
                                          External System (CometD or Pub/Sub API)
                                                       ↓
                                          External System makes downstream API call
```

This pattern:
- Keeps the Salesforce trigger transaction clean (no callout, no async limit concern).
- Provides a 72-hour replay window — external consumers can reconnect and replay missed events.
- Decouples availability: if the external system is down, events accumulate in the channel.
- Supports fan-out: multiple external subscribers can consume the same event independently.

### Creating a Platform Event

In Setup > Platform Events > New Platform Event:
- API Name: `Account_Sync_Event__e` (suffix `__e` is required for custom events)
- Publish Behavior: `Publish After Commit` (recommended) or `Publish Immediately`
  - `Publish After Commit`: event is published only if the DML transaction commits successfully. Use for events triggered by data changes.
  - `Publish Immediately`: event is published before the transaction commits. Use for audit or notification events where the transaction outcome doesn't matter.

Add custom fields (all are nullable, no required fields enforced):
- `Account_Id__c` (Text, 18)
- `Account_Name__c` (Text, 255)
- `Operation__c` (Text, 20): INSERT / UPDATE / DELETE

### Publishing Platform Events from Apex

```apex
// Publish single event
Account_Sync_Event__e evt = new Account_Sync_Event__e(
    Account_Id__c = accountId,
    Account_Name__c = accountName,
    Operation__c = 'INSERT'
);
Database.SaveResult result = EventBus.publish(evt);
if (!result.isSuccess()) {
    for (Database.Error err : result.getErrors()) {
        System.debug('Publish error: ' + err.getMessage());
    }
}

// Publish list of events (bulk)
List<Account_Sync_Event__e> events = new List<Account_Sync_Event__e>();
for (Account a : accounts) {
    events.add(new Account_Sync_Event__e(
        Account_Id__c = a.Id,
        Account_Name__c = a.Name,
        Operation__c = 'UPDATE'
    ));
}
List<Database.SaveResult> results = EventBus.publish(events);
```

**Publish limits**:
- 150,000 Platform Event publishes per 24-hour rolling window (org limit, shared across all events).
- 2,000 events published per transaction (combined across all event types).

### Subscribing via Platform Event Trigger

A Platform Event trigger runs in a new, separate transaction from the publishing transaction:

```apex
trigger AccountSyncEventTrigger on Account_Sync_Event__e (after insert) {
    // Trigger.new contains the events in this batch (up to 2,000)
    // ReplayId available for checkpointing
    String lastReplayId = '';
    List<Account_Sync_Event__e> events = Trigger.new;
    for (Account_Sync_Event__e evt : events) {
        lastReplayId = (String) evt.ReplayId;
        // Process each event
    }
    // Optionally checkpoint the lastReplayId for replay recovery
    EventBus.TriggerContext.currentContext().setResumeCheckpoint(lastReplayId);
}
```

**Checkpoint pattern**: calling `setResumeCheckpoint(replayId)` causes the trigger to replay from that `replayId` if processing fails, rather than losing events. If not called, events may be skipped on failure.

### Subscribing via CometD (External Consumer)

External systems subscribe to Platform Events using CometD protocol:

```
Channel: /event/Account_Sync_Event__e
Replay from stored events: set replayId to -2 (all stored) or -1 (new only) or a specific replayId
```

```javascript
// CometD subscription (JavaScript example — runs in external system)
cometd.subscribe('/event/Account_Sync_Event__e', function(message) {
    const eventData = message.data.payload;
    const accountId = eventData.Account_Id__c;
    const operation = eventData.Operation__c;
    // call external API or process data
}, { ext: { replay: { '/event/Account_Sync_Event__e': -2 } } });
```

---

## Pub/Sub API (Recommended for New External Consumers)

The Pub/Sub API is the modern replacement for CometD for external event consumers. It uses gRPC bidirectional streaming and Avro binary encoding (via Schema Registry).

**Advantages over CometD**:
- Higher throughput (binary protocol vs. JSON over HTTP long-poll).
- Built-in schema versioning via Avro Schema Registry.
- Standard gRPC client libraries available in all major languages.
- Supports `FetchRequest` with explicit `num_requested` for backpressure control.

**Connection pattern**:

```
External System → gRPC → pubsub.salesforce.com:7443
  FetchRequest(topic_name='/event/Account_Sync_Event__e', replay_preset=LATEST)
  ← FetchResponse (Avro-encoded events)
  PublishRequest (to publish events from external system into Salesforce)
```

**When to use Pub/Sub API vs CometD**:
- New integrations: always use Pub/Sub API.
- Existing CometD integrations: migrate when throughput or reliability issues arise.
- Browser-based UI subscriptions in LWC/Aura: use `empApi` (LWC wire adapter) — that is a UI concern covered by the frontend skill.

---

## Change Data Capture (CDC) for Outbound Sync

CDC publishes change events for Salesforce records to a channel. External systems subscribe to the channel and receive all inserts, updates, deletes, and undeletes for the configured objects.

### Enabling CDC

Setup > Integrations > Change Data Capture → move objects to Selected Entities.

Standard channel for Account CDC:
```
/data/AccountChangeEvent
```

Custom object CDC channel:
```
/data/MyCustomObject__ChangeEvent
```

### CDC Change Event Structure

```json
{
  "schema": "...",
  "payload": {
    "ChangeEventHeader": {
      "entityName": "Account",
      "recordIds": ["001xx000003GYn1AAG"],
      "changeType": "UPDATE",
      "changeOrigin": "com/salesforce/api/rest/60.0",
      "transactionKey": "0002abc-...",
      "sequenceNumber": 1,
      "commitTimestamp": 1718000000000,
      "commitNumber": 12345678901234,
      "commitUser": "005xx000001SBqXAAW",
      "changedFields": ["Name", "Industry"]
    },
    "Name": "Acme Corp Updated",
    "Industry": "Finance"
  }
}
```

**Key `ChangeEventHeader` fields**:

| Field | Description |
|-------|-------------|
| `changeType` | `CREATE`, `UPDATE`, `DELETE`, `UNDELETE` |
| `recordIds` | Array of IDs — multiple IDs can appear in one event for bulk DML |
| `changedFields` | Fields changed in this event (UPDATE only) — others are null in payload |
| `transactionKey` | UUID for the DML transaction — use for deduplication |
| `sequenceNumber` | Position within a multi-record transaction |
| `commitTimestamp` | Unix epoch milliseconds of the DML commit |

**Handling partial field sets**:

On UPDATE events, only changed fields are present in the payload. Fields not in `changedFields` are `null` in the payload but were not set to null — they were unchanged. Consumers must not overwrite target records with null values for fields absent from the payload.

```python
# External Python consumer — correct null handling
changed_fields = header['changedFields']
update_payload = {
    field: event['payload'][field]
    for field in changed_fields
    if field in event['payload'] and event['payload'][field] is not None
}
# Only update fields that are in changedFields
external_system.patch(record_id, update_payload)
```

### CDC vs Platform Events: When to Use Each

| Criterion | Platform Events | Change Data Capture |
|-----------|----------------|---------------------|
| Trigger | Custom business event (defined by developer) | Record DML (automatic) |
| Payload | Custom fields defined by developer | Salesforce record fields |
| Object coverage | All objects (any event type) | Objects you explicitly enable in Setup |
| Changed fields only | Not applicable (custom payload) | Yes — UPDATE events only include changed fields |
| Delete events | Manual (trigger publishes Delete event) | Automatic |
| Undelete events | Manual | Automatic |
| Gap fill/replay | 72-hour replay window | 72-hour replay window |
| Use for | Custom workflow triggers, notifications, EDA | Full outbound data sync to external systems |

### CDC vs REST Polling

| Criterion | CDC Subscription | REST Polling (SOQL query) |
|-----------|-----------------|--------------------------|
| Latency | Near-real-time (sub-second) | Depends on poll interval |
| API request consumption | Low (subscription is persistent) | High (one API call per poll) |
| Missed change detection | Gaps possible if replay window exceeded | Possible if poll interval too long |
| Payload completeness | Changed fields only (UPDATE) | Full record on each query |
| Setup complexity | Requires CometD or Pub/Sub API client | Simple HTTP GET |

Use CDC for production integrations that need low latency. Use REST polling for low-volume scenarios, development/testing, or when CDC setup is not feasible.

---

## External Objects and Salesforce Connect

External Objects represent data in external systems as virtual Salesforce records. They appear in SOQL queries, related lists, and reports but the data is fetched in real time from the external system — not stored in Salesforce.

### OData 2.0 Adapter (Standard, Read-Only)

```
ExternalDataSource (Type: Salesforce Connect: OData 2.0)
  └─ ExternalObject (e.g., Orders__x)
        └─ Fields mapped from OData entity properties
        └─ Indirect Lookup relationship to Account
```

**Capabilities**:
- SOQL: `SELECT Id, Name, Total__c FROM Orders__x WHERE AccountId__c = '001xx...'` — supported.
- Aggregate queries: limited; depends on whether the OData endpoint supports `$count` and `$filter`.
- Write operations (INSERT, UPDATE, DELETE): not supported — throws `EXTERNAL_OBJECT_UNSUPPORTED_EXCEPTION`.

**`ExternalDataSource` metadata**:

```xml
<ExternalDataSource>
    <label>Orders System</label>
    <name>Orders_System</name>
    <protocol>OData</protocol>
    <type>OData</type>
    <endpoint>https://orders.example.com/odata/v2</endpoint>
    <authProvider><!-- Named Principal or OAuth --></authProvider>
</ExternalDataSource>
```

### OData 4.0 Adapter (Write Support)

`ExternalDataSource` with `type=OData4` enables INSERT, UPDATE, and DELETE on External Objects, provided the OData 4.0 service supports those operations.

Available in: Enterprise Edition and above, with Salesforce Connect add-on license.

### Custom Apex Adapter

Implement `DataSource.Provider` and `DataSource.Connection` for full control over query translation, write operations, and any protocol.

```apex
global class OrdersDataSourceProvider extends DataSource.Provider {
    override global List<DataSource.AuthenticationCapability> getAuthenticationCapabilities() {
        return new List<DataSource.AuthenticationCapability>{
            DataSource.AuthenticationCapability.ANONYMOUS
        };
    }
    override global List<DataSource.Capability> getCapabilities() {
        return new List<DataSource.Capability>{
            DataSource.Capability.ROW_QUERY,
            DataSource.Capability.ROW_CREATE,
            DataSource.Capability.ROW_UPDATE,
            DataSource.Capability.ROW_DELETE
        };
    }
    override global DataSource.Connection getConnection(DataSource.ConnectionParams params) {
        return new OrdersDataSourceConnection(params);
    }
}
```

### Indirect Lookup Relationship

An Indirect Lookup creates a relationship from an External Object to a Salesforce standard or custom object via an External ID field. Unlike a direct lookup (which uses the Salesforce record ID), an Indirect Lookup uses a custom External ID field on the Salesforce object as the join key.

```
Account (Salesforce)         Orders__x (External Object)
  External_Order_Id__c  ←──  AccountRef__c (Indirect Lookup)
  (ExternalId: true)
```

SOQL with Indirect Lookup:
```soql
SELECT Id, Name, (SELECT OrderNumber__c, Total__c FROM Orders__r)
FROM Account
WHERE Name = 'Acme Corp'
```

The nested query on `Orders__r` triggers a real-time OData call to the external system.

---

## Event Ordering and Delivery Semantics

### At-Least-Once Delivery

Both Platform Events and CDC guarantee **at-least-once** delivery — an event may be delivered more than once. External consumers must handle duplicate events. Use the `transactionKey` (CDC) or a custom `CorrelationId__c` field (Platform Events) as the deduplication key.

```python
# External consumer deduplication
processed_events = set()  # or a persistent store
def handle_event(event):
    event_key = event['header']['transactionKey'] + ':' + str(event['header']['sequenceNumber'])
    if event_key in processed_events:
        return  # duplicate — skip
    processed_events.add(event_key)
    process(event)
```

### Event Ordering

Within a single CDC transaction, events are ordered by `sequenceNumber`. Across transactions, events are ordered by `commitTimestamp` and `commitNumber`. Events from different transactions may arrive out of order if consumers have multiple connections. Use `commitTimestamp` for ordering guarantees, not arrival time.

### Replay Window

- Default retention: **72 hours** (3 days).
- Replay ID: a monotonically increasing opaque cursor. Consumers store their last processed replay ID and resume from it after reconnection.
- Subscribe with `replayId = -2` to replay all events in the 72-hour window from the beginning.
- Subscribe with `replayId = -1` to receive only new events from subscription time.

### High-Volume Platform Events

For events with volumes > 100,000 per hour, configure High-Volume Platform Events:
- Pub/Sub API is mandatory (CometD is limited in throughput).
- Increase subscriber throughput with the `PubSubPointer` API to checkpoint progress.
- Monitor `EventBusSubscriber` to track consumer lag.
