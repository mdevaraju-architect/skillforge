# 03 — Apex Profiling: CPU, Heap, and Debug Logs

## System.Limits methods reference

All methods return the current consumption in the active transaction. Pair each with its `getLimit*()` equivalent to compute the remaining budget.

```apex
// Pattern: log current usage vs total budget
System.debug(LoggingLevel.INFO,
    'SOQL: ' + System.Limits.getQueries() + '/' + System.Limits.getLimitQueries()
    + ' | DML: ' + System.Limits.getDMLStatements() + '/' + System.Limits.getLimitDMLStatements()
    + ' | CPU: ' + System.Limits.getCpuTime() + '/' + System.Limits.getLimitCpuTime()
    + ' | Heap: ' + System.Limits.getHeapSize() + '/' + System.Limits.getLimitHeapSize()
);
```

### Full method listing

| Method | Description | Sync limit | Async limit |
|---|---|---|---|
| `getCpuTime()` | CPU milliseconds consumed so far | 10,000 | 60,000 |
| `getLimitCpuTime()` | Maximum CPU ms for this context | 10,000 | 60,000 |
| `getHeapSize()` | Heap bytes currently allocated | 6,291,456 | 12,582,912 |
| `getLimitHeapSize()` | Maximum heap bytes | 6,291,456 | 12,582,912 |
| `getQueries()` | SOQL queries issued | 100 | 200 |
| `getLimitQueries()` | Maximum SOQL queries | 100 | 200 |
| `getQueryRows()` | Total rows returned by SOQL | 50,000 | 50,000 |
| `getLimitQueryRows()` | Maximum SOQL rows | 50,000 | 50,000 |
| `getDMLStatements()` | DML statements executed | 150 | 150 |
| `getLimitDMLStatements()` | Maximum DML statements | 150 | 150 |
| `getDMLRows()` | Total rows processed by DML | 10,000 | 10,000 |
| `getLimitDMLRows()` | Maximum DML rows | 10,000 | 10,000 |
| `getCallouts()` | HTTP/web service callouts made | 100 | 100 |
| `getLimitCallouts()` | Maximum callouts | 100 | 100 |
| `getSoslQueries()` | SOSL queries issued | 20 | 20 |
| `getLimitSoslQueries()` | Maximum SOSL queries | 20 | 20 |
| `getAggregateQueries()` | Aggregate SOQL queries | 300 | 300 |
| `getLimitAggregateQueries()` | Maximum aggregate SOQL queries | 300 | 300 |
| `getFutureCalls()` | `@future` calls enqueued | 50 | 0 |
| `getLimitFutureCalls()` | Maximum `@future` calls | 50 | 0 |
| `getQueueableJobs()` | Queueable jobs enqueued | 50 | 1 |
| `getLimitQueueableJobs()` | Maximum queueable jobs | 50 | 1 |
| `getEmailInvocations()` | `Messaging.sendEmail()` calls | 10 | 10 |
| `getLimitEmailInvocations()` | Maximum email invocations | 10 | 10 |

---

## CPU profiling with System.Limits.getCpuTime()

Since Apex has no built-in profiler (no sampling profiler, no flame graph), manual instrumentation with `getCpuTime()` is the standard approach.

### Basic instrumentation pattern

```apex
public class MyService {
    public void process(List<SObject> records) {
        Integer cpuStart = System.Limits.getCpuTime();

        // Section 1: data preparation
        Integer cpuSection1Start = System.Limits.getCpuTime();
        Map<Id, SObject> recordMap = buildMap(records);
        System.debug('[CPU] buildMap: ' + (System.Limits.getCpuTime() - cpuSection1Start) + 'ms');

        // Section 2: business logic
        Integer cpuSection2Start = System.Limits.getCpuTime();
        applyBusinessRules(recordMap);
        System.debug('[CPU] applyBusinessRules: ' + (System.Limits.getCpuTime() - cpuSection2Start) + 'ms');

        System.debug('[CPU] Total: ' + (System.Limits.getCpuTime() - cpuStart) + 'ms');
    }
}
```

### Common CPU consumers and fixes

**1. String concatenation in loops**

```apex
// BAD — creates a new String object each iteration (O(n²) memory/CPU)
String result = '';
for (SObject obj : records) {
    result += obj.get('Name') + ', ';
}

// GOOD — O(n) with join
List<String> parts = new List<String>();
for (SObject obj : records) {
    parts.add((String) obj.get('Name'));
}
String result = String.join(parts, ', ');
```

**2. JSON serialization/deserialization**

`JSON.serialize()` and `JSON.deserialize()` are CPU-intensive and also create intermediate String heap objects. For large collections (> 500 records):
- Avoid round-tripping through JSON for type conversion.
- Use typed collections (`List<MyClass>`) rather than `Map<String, Object>` deserialization.
- If JSON is unavoidable, do it once, outside loops, not per-record.

```apex
// BAD — JSON round-trip per record
for (SObject obj : records) {
    Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(obj.get('Payload__c'));
    processData(data);
}

// GOOD — batch deserialize if structure is uniform, or use typed parsing
for (SObject obj : records) {
    MyPayload payload = (MyPayload) JSON.deserialize((String) obj.get('Payload__c'), MyPayload.class);
    processPayload(payload);
}
```

**3. Nested loops with linear search**

```apex
// BAD — O(n²): for each record, linear scan through another list
for (Account acc : accounts) {
    for (Contact con : allContacts) {
        if (con.AccountId == acc.Id) {
            // process
        }
    }
}

// GOOD — O(n): build a Map once, then O(1) lookup
Map<Id, List<Contact>> contactsByAccount = new Map<Id, List<Contact>>();
for (Contact con : allContacts) {
    if (!contactsByAccount.containsKey(con.AccountId)) {
        contactsByAccount.put(con.AccountId, new List<Contact>());
    }
    contactsByAccount.get(con.AccountId).add(con);
}
for (Account acc : accounts) {
    List<Contact> contacts = contactsByAccount.get(acc.Id);
    if (contacts != null) {
        // process
    }
}
```

**4. Schema.describe calls in loops**

`Schema.SObjectType.Account.fields.getMap()` and `Schema.describeSObjects()` are expensive. Called inside a loop (e.g. once per record), they accumulate significant CPU and count against the 100 describe call limit.

```apex
// BAD — describe call per record
for (SObject obj : records) {
    Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Account.fields.getMap();
    // use fieldMap
}

// GOOD — cache in static variable
private static Map<String, Schema.SObjectField> ACCOUNT_FIELD_MAP {
    get {
        if (ACCOUNT_FIELD_MAP == null) {
            ACCOUNT_FIELD_MAP = Schema.SObjectType.Account.fields.getMap();
        }
        return ACCOUNT_FIELD_MAP;
    }
    set;
}
```

**5. Regex operations**

`Pattern.compile()` and `Matcher` operations on large strings or within loops are CPU-intensive. Compile the Pattern once outside the loop:

```apex
// BAD
for (String s : inputs) {
    Pattern p = Pattern.compile('\\d{4}-\\d{2}-\\d{2}');
    Matcher m = p.matcher(s);
}

// GOOD
Pattern datePattern = Pattern.compile('\\d{4}-\\d{2}-\\d{2}');
for (String s : inputs) {
    Matcher m = datePattern.matcher(s);
}
```

---

## Heap profiling with System.Limits.getHeapSize()

The heap limit is 6,291,456 bytes (6 MB) synchronous and 12,582,912 bytes (12 MB) asynchronous. The heap error is:

```
System.LimitException: Apex heap size too large: XXXXXXX
```

### Heap estimation

Approximate heap costs for common Apex objects:

| Object type | Approximate heap size |
|---|---|
| Empty `new List<SObject>()` | ~24 bytes |
| SObject with 10 fields populated | ~800–1,200 bytes |
| SObject with 50 fields populated | ~3,000–5,000 bytes |
| List of 1,000 Accounts (10 fields each) | ~1–1.5 MB |
| String of 10,000 characters | ~20,000 bytes |
| Map entry (Id → SObject) | SObject size + ~120 bytes overhead |
| Serialized JSON of 1,000 Accounts | ~2–3x the in-memory SObject size |

> **Rule of thumb:** querying 1,000 records with 50 fields each uses approximately 3–5 MB of heap, leaving very little margin in a 6 MB synchronous context.

### Heap reduction patterns

**1. Query only needed fields**

```apex
// BAD — conceptually equivalent to SELECT * in other databases
List<Account> accounts = [SELECT FIELDS(ALL) FROM Account LIMIT 1000]; // consumes all field heap

// GOOD — query only what you need
List<Account> accounts = [SELECT Id, Name, OwnerId FROM Account LIMIT 1000];
```

**2. Null out large collections after use**

```apex
List<Account> accounts = [SELECT Id, Name FROM Account WHERE ...]; // potentially large
Map<Id, Account> accountMap = new Map<Id, Account>(accounts);

// Done with the list — free it
accounts = null;

// ... continue using accountMap only
```

**3. Process in chunks instead of loading everything**

If total record count exceeds what fits in heap, process in batches rather than loading all records at once:

```apex
// BAD — loads all 50,000 records at once
List<Account> allAccounts = [SELECT Id, Name FROM Account WHERE ...]; // may hit heap limit

// GOOD — use Batch Apex (Database.Batchable) to process in chunks
// Each execute() call processes 200 records in an independent transaction
public class AccountBatchProcessor implements Database.Batchable<SObject> {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id, Name FROM Account WHERE ...]);
    }
    public void execute(Database.BatchableContext bc, List<Account> scope) {
        // scope is 200 records by default; each execute() has its own heap limit
        processAccounts(scope);
    }
    public void finish(Database.BatchableContext bc) {}
}
```

**4. Avoid redundant data copies**

When building a Map from a query result, avoid holding both the List and the Map simultaneously if the List is not otherwise needed:

```apex
// GOOD — construct Map directly from query; no intermediate List variable retained
Map<Id, Account> accountMap = new Map<Id, Account>(
    [SELECT Id, Name FROM Account WHERE Id IN :idSet]
);
```

**5. JSON serialization doubles memory temporarily**

During `JSON.serialize(largeCollection)`, Apex holds both the original object and the serialized String in memory simultaneously. For a collection that is already 3 MB in-memory, serialization may temporarily require 6+ MB, hitting the heap limit mid-operation.

Mitigation: serialize smaller chunks, or avoid JSON where direct SObject manipulation is possible.

---

## Debug log levels and their output volume

Debug logs are the primary tool for diagnosing Apex behavior but generate large volumes of output that cause **truncation at 20 MB**. Truncation removes the end of the log — which is often where the slow query or limit violation occurs.

### Log level categories

| Category | Controls |
|---|---|
| `APEX_CODE` | Apex method entry/exit, variable assignments, user debug statements |
| `APEX_PROFILING` | Cumulative profiling data at transaction end |
| `CALLOUT` | HTTP request/response headers and body |
| `DB` | SOQL and DML executed, rows returned/affected |
| `NBA` | Next Best Action decisions |
| `SYSTEM` | System method calls (String, Math, etc.) |
| `VALIDATION` | Validation rule evaluation |
| `VISUALFORCE` | Visualforce page rendering steps |
| `WAVE` | CRM Analytics queries |
| `WORKFLOW` | Workflow rule and field update evaluation |

### Recommended level combinations for performance investigation

**Minimal — for finding the slow SOQL query:**
```
APEX_CODE: ERROR
APEX_PROFILING: INFO
DB: FINEST
SYSTEM: NONE
WORKFLOW: NONE
VALIDATION: NONE
```
This captures all SOQL/DML execution with bind variables and row counts, while minimizing log volume from Apex method tracing.

**CPU profiling — adding Apex method trace:**
```
APEX_CODE: FINEST
APEX_PROFILING: FINEST
DB: INFO
SYSTEM: NONE
```
`APEX_PROFILING: FINEST` adds a cumulative profiling section at the end of the log showing which method calls consumed the most CPU. This section is at the END of the log — if the log truncates, you lose it. Use minimal DB logging to stay under 20 MB.

**NOT recommended for performance investigation:**
```
SYSTEM: FINEST  // generates enormous output for every String operation, Math call, etc.
APEX_CODE: FINEST + DB: FINEST  // often exceeds 20 MB for any non-trivial transaction
```

### Debug log truncation at 20 MB

When a debug log reaches 20 MB, Salesforce stops writing and appends:
```
*** Log exceeded maximum size; some data may be missing ***
```

The truncation removes the **tail** of the log. Since performance problems (the slow SOQL, the limit exception, the final profiling summary) typically occur near the end of a transaction, truncation often hides the most important diagnostic information.

**Strategies to avoid truncation:**

1. **Use `System.Limits` instrumentation** instead of debug log timing — `getCpuTime()` and `getHeapSize()` calls write compact single-line output.

2. **Set log level to ERROR** for all categories except the one you are investigating. `APEX_CODE: ERROR` produces no output for normal execution.

3. **Use `LoggingLevel.ERROR`** in your `System.debug()` calls so they survive even when APEX_CODE is set to ERROR or WARN:
   ```apex
   System.debug(LoggingLevel.ERROR, '[PERF] CPU: ' + System.Limits.getCpuTime());
   ```

4. **Reduce test data volume** — run the investigation against a smaller dataset (e.g. 10 records instead of 200) to get a complete log, then extrapolate.

5. **Use Apex Replay Debugger** in VS Code — can step through an existing debug log without re-executing the transaction.

### Reading the APEX_PROFILING summary

When `APEX_PROFILING` is set to INFO or FINEST, the log ends with a profiling table:

```
CUMULATIVE PROFILING INFORMATION
No profiling information for SOQL operations
Code units executed: 1
...
Number of SOQL queries: 15
Number of query rows: 3421
Number of DML statements: 3
...
Maximum heap size: 2,847,103
```

This summary is written once at transaction end. If the log truncates before the transaction ends, this section is absent — which is why minimizing log volume to preserve the tail is important.
