# Change Data Capture and Streaming Reference

## What Is Change Data Capture

Change Data Capture (CDC) generates a change event every time a Salesforce record is created, updated, deleted, or undeleted. These events are published to a streaming channel and can be consumed by Apex trigger subscribers, CometD clients, or the Pub/Sub API.

CDC is the preferred pattern for:
- Syncing Salesforce data to external systems in near real-time.
- Replicating record changes to data lakes, reporting stores, or integration platforms.
- Triggering downstream workflows from record changes without custom trigger code on every object.

---

## Enabling CDC per Object

CDC must be explicitly enabled for each SObject in Setup → Change Data Capture. Objects not in the Selected Entities list do not produce CDC events.

**Steps:**
1. Navigate to Setup → Integrations → Change Data Capture.
2. In the Available Entities list, select the object(s) and click the arrow to move them to Selected Entities.
3. Save. CDC events begin publishing immediately for new DML operations.

**Supported objects:**
- Standard objects: Account, Contact, Lead, Opportunity, Case, User, and many others.
- Custom objects: All custom SObjects with the `__c` suffix.
- Not supported: Some metadata objects, Setup objects, and objects with `isCustomSetting = true`.

**Performance warning:** Enabling CDC on high-volume objects (Account, Contact) in large orgs generates a CDC event per DML operation on those objects. A bulk import of 1 million Accounts creates 1 million CDC events. Subscriber triggers must be bulkified and efficient. Test volume impact in a full-copy sandbox before enabling in production.

---

## CDC Channel Names

| Object Type | Channel Format | Example |
|---|---|---|
| Standard object | `{ObjectName}ChangeEvent` | `AccountChangeEvent` |
| Custom object | `{ObjectApiName_without__c}__ChangeEvent` | `MyObject__ChangeEvent` |
| All objects (CometD wildcard) | `/data/ChangeEvents` | Receives all CDC events |
| Specific standard (CometD) | `/data/{ObjectName}ChangeEvent` | `/data/AccountChangeEvent` |
| Specific custom (CometD) | `/data/{ObjectApiName}__ChangeEvent` | `/data/MyObject__ChangeEvent` |

---

## `ChangeEventHeader` Fields

Every CDC event includes a `ChangeEventHeader` compound field on the event SObject.

```apex
trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    for (AccountChangeEvent event : Trigger.new) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;

        String entityName     = header.entityName;      // 'Account'
        String changeType     = header.changeType;      // 'CREATE', 'UPDATE', 'DELETE', 'UNDELETE'
        List<String> recordIds = header.recordIds;      // List<String> of affected record IDs
        List<String> changedFields = header.changedFields; // populated for UPDATE only
        String transactionKey = header.transactionKey; // unique key for the originating transaction
        Integer sequenceNumber = header.sequenceNumber; // ordering within the same transactionKey
        String commitUser     = header.commitUser;      // User ID who initiated the DML
        Long commitTimestamp  = header.commitTimestamp; // Epoch milliseconds of the commit
        String commitNumber   = header.commitNumber;    // Transaction commit number (string)
    }
}
```

### `ChangeEventHeader` Field Reference

| Field | Type | Description |
|---|---|---|
| `entityName` | `String` | API name of the SObject that changed (e.g. `Account`) |
| `changeType` | `String` | `CREATE`, `UPDATE`, `DELETE`, or `UNDELETE` |
| `recordIds` | `List<String>` | IDs of affected records (strings, not Id type) |
| `changedFields` | `List<String>` | API names of fields that changed; populated only for `UPDATE` |
| `transactionKey` | `String` | Unique identifier for the originating DML transaction |
| `sequenceNumber` | `Integer` | Ordering within the same `transactionKey` (starts at 1) |
| `commitUser` | `String` | ID of the user who performed the DML |
| `commitTimestamp` | `Long` | Epoch milliseconds (UTC) when the transaction committed |
| `commitNumber` | `String` | Database commit number; monotonically increasing |

---

## `changeType` Values and Behavior

| `changeType` | When Generated | Payload Fields |
|---|---|---|
| `CREATE` | Record was inserted | All fields with values at time of creation |
| `UPDATE` | Record was updated | Only `changedFields` are populated; all other fields are null |
| `DELETE` | Record was deleted (soft delete) | All payload fields are null; use `header.recordIds` |
| `UNDELETE` | Record was undeleted (restored from Recycle Bin) | All fields with values at time of undelete |

### Handling Each Change Type

```apex
trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    List<Id> createdIds  = new List<Id>();
    List<Id> deletedIds  = new List<Id>();
    Map<Id, List<String>> updatedFieldsByRecord = new Map<Id, List<String>>();

    for (AccountChangeEvent event : Trigger.new) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;

        for (String ridStr : header.recordIds) {
            Id rid = Id.valueOf(ridStr);

            if (header.changeType == 'CREATE') {
                createdIds.add(rid);
                // event.Name, event.Phone, etc. are populated

            } else if (header.changeType == 'UPDATE') {
                // ONLY fields in header.changedFields are non-null
                updatedFieldsByRecord.put(rid, header.changedFields);
                if (header.changedFields.contains('Phone')) {
                    // event.Phone has the new value
                    updateExternalSystem(rid, event.Phone);
                }

            } else if (header.changeType == 'DELETE') {
                deletedIds.add(rid);
                // All event payload fields are null — do not read them
                // Use rid to look up any cached data or notify downstream

            } else if (header.changeType == 'UNDELETE') {
                // event fields are populated with current values
                reactivateInExternalSystem(rid);
            }
        }
    }

    if (!createdIds.isEmpty())  { syncCreatedToExternal(createdIds); }
    if (!deletedIds.isEmpty())  { syncDeletedToExternal(deletedIds); }
}
```

---

## `changedFields` Sparse Behavior on UPDATE

For `UPDATE` CDC events, only the fields that were changed in the originating DML are populated in the event payload. All other fields are null — even if the record has values for those fields in the database.

```apex
// Account record in database: Name='ACME', Phone='415-555-1234', Website='acme.com'
// DML: account.Phone = '415-555-9999'; update account;
// CDC event generated:
//   header.changeType = 'UPDATE'
//   header.changedFields = ['Phone', 'SystemModstamp', 'LastModifiedDate', 'LastModifiedById']
//   event.Name    = null  (not changed — not populated)
//   event.Phone   = '415-555-9999'  (changed — populated)
//   event.Website = null  (not changed — not populated)

trigger AccountCDCTrigger on AccountChangeEvent (after insert) {
    for (AccountChangeEvent event : Trigger.new) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;
        if (header.changeType == 'UPDATE') {
            // NEVER read a field without checking changedFields first
            if (header.changedFields.contains('Phone')) {
                String newPhone = event.Phone; // safe — this field changed
            }
            // DO NOT assume event.Name has the current account name — it is null
        }
    }
}
```

**Note:** System fields `SystemModstamp`, `LastModifiedDate`, `LastModifiedById` always appear in `changedFields` for any UPDATE event. Filter them out if your logic only cares about business fields:

```apex
Set<String> systemFields = new Set<String>{
    'SystemModstamp', 'LastModifiedDate', 'LastModifiedById'
};
List<String> businessChanges = new List<String>();
for (String field : header.changedFields) {
    if (!systemFields.contains(field)) {
        businessChanges.add(field);
    }
}
if (businessChanges.isEmpty()) {
    return; // Only system fields changed — no business action needed
}
```

---

## Standard vs Custom Object CDC Channels

```apex
// Standard object: Account → channel is AccountChangeEvent
trigger AccountCDCTrigger on AccountChangeEvent (after insert) { ... }

// Standard object: Contact → channel is ContactChangeEvent
trigger ContactCDCTrigger on ContactChangeEvent (after insert) { ... }

// Custom object: MyObject__c → channel is MyObject__ChangeEvent
trigger MyObjectCDCTrigger on MyObject__ChangeEvent (after insert) { ... }

// Note: custom object channel uses __ChangeEvent (not __c__ChangeEvent)
// The __c is replaced with __ in the channel name
```

---

## CometD Subscription for External Consumers

External consumers (Node.js, Java, Python, etc.) connect to Salesforce Streaming API via CometD.

```javascript
// Node.js example using jsforce
const jsforce = require('jsforce');

const conn = new jsforce.Connection({ loginUrl: 'https://login.salesforce.com' });
await conn.login(username, password);

const client = conn.streaming.createClient();

// Subscribe to Account CDC events with replay
const subscription = client.subscribe('/data/AccountChangeEvent', (message) => {
    const header = message.payload.ChangeEventHeader;
    console.log('changeType:', header.changeType);
    console.log('recordIds:', header.recordIds);
    console.log('changedFields:', header.changedFields);

    if (header.changeType === 'UPDATE') {
        // Process only changed fields
        header.changedFields.forEach(field => {
            console.log(`  ${field}: ${message.payload[field]}`);
        });
    }
});

// Unsubscribe when done
// subscription.cancel();
```

### CometD Replay for CDC

CDC events are retained for **3 days** (72 hours for standard Platform Events; **72 hours** for CDC events as well — but confirm this in current release notes as it has been extended in some orgs).

```javascript
// Subscribe with replay from beginning of retention window
const subscription = client.subscribe(
    '/data/AccountChangeEvent',
    handleMessage,
    { replayId: -1 } // all retained events
);

// Subscribe to new events only
const subscription = client.subscribe(
    '/data/AccountChangeEvent',
    handleMessage,
    { replayId: -2 } // no replay
);
```

---

## Event Retention for CDC

| Event Type | Retention Period |
|---|---|
| Platform Events (Standard Volume) | 72 hours |
| Platform Events (High-Volume) | 72 hours |
| CDC Events | 3 days (72 hours) |

All CDC events older than the retention window cannot be replayed. Design external consumers to checkpoint their `ReplayId` after each successful batch of events to avoid re-processing or losing events on reconnection.

---

## CDC Unit Testing in Apex

```apex
@isTest
static void testCDCTrigger() {
    // Create test data — the CDC trigger fires in test context
    Test.startTest();

    Account acc = new Account(Name = 'CDC Test Account', Phone = '415-555-0000');
    insert acc;

    // Deliver CDC events synchronously in test
    Test.getEventBus().deliver();

    acc.Phone = '415-555-9999';
    update acc;

    Test.getEventBus().deliver();

    Test.stopTest();

    // Assert side effects from the CDC subscriber trigger
    // e.g. check that an integration log was created
    List<IntegrationLog__c> logs = [
        SELECT Id, ChangeType__c, RecordId__c
        FROM IntegrationLog__c
        WHERE RecordId__c = :acc.Id
        ORDER BY CreatedDate ASC
    ];
    System.assertEquals(2, logs.size());
    System.assertEquals('CREATE', logs[0].ChangeType__c);
    System.assertEquals('UPDATE', logs[1].ChangeType__c);
}
```
