# Bulk Data Processing — Architecture & Governor Limits

## Bulk API 2.0 Job Lifecycle

```
Client                        Salesforce Bulk API 2.0
  |                                     |
  |-- POST /jobs/ingest --------------->|  state: Open
  |<-- { id: "750...", state: "Open" } -|
  |                                     |
  |-- PUT /jobs/ingest/{id}/batches --->|  Upload CSV payload (≤150 MB)
  |<-- 201 Created -------------------- |
  |                                     |
  |-- PATCH /jobs/ingest/{id}          |
  |   { "state": "UploadComplete" } -->|  state: UploadComplete
  |<-- { state: "UploadComplete" } ----|
  |                                     |
  |                                     |  Platform processes server-side
  |                                     |  batches of 2,000 records each
  |                                     |  state: InProgress
  |                                     |
  |-- GET /jobs/ingest/{id} ----------->|  Poll for completion
  |<-- { state: "JobComplete" } --------|  (or "Failed" / "Aborted")
  |                                     |
  |-- GET /jobs/ingest/{id}/           |
  |   successfulResults -------------->|  Retrieve success CSV
  |<-- CSV (sf__Id, sf__Created, ...) -|
  |                                     |
  |-- GET /jobs/ingest/{id}/           |
  |   failedResults ------------------>|  Retrieve failure CSV
  |<-- CSV (sf__Id, sf__Error, ...) ---|
  |                                     |
  |-- DELETE /jobs/ingest/{id} -------->|  Optional cleanup
  |<-- 204 No Content -----------------|
```

### Job States

| State | Meaning |
|---|---|
| `Open` | Job created; accepting CSV uploads via PUT |
| `UploadComplete` | All CSV uploaded; processing queued |
| `InProgress` | Server is processing server-side batches |
| `JobComplete` | All server-side batches processed; results available |
| `Failed` | Job-level failure (e.g., schema error, permission error) |
| `Aborted` | Explicitly aborted by client via PATCH `state=Aborted` |

### Key REST Endpoints (API v60.0+)

| Operation | Method | Path |
|---|---|---|
| Create job | POST | `/services/data/v60.0/jobs/ingest` |
| Upload CSV | PUT | `/services/data/v60.0/jobs/ingest/{jobId}/batches` |
| Close job (start processing) | PATCH | `/services/data/v60.0/jobs/ingest/{jobId}` |
| Abort job | PATCH | `/services/data/v60.0/jobs/ingest/{jobId}` |
| Poll job status | GET | `/services/data/v60.0/jobs/ingest/{jobId}` |
| List all jobs | GET | `/services/data/v60.0/jobs/ingest` |
| Get successful results | GET | `/services/data/v60.0/jobs/ingest/{jobId}/successfulResults` |
| Get failed results | GET | `/services/data/v60.0/jobs/ingest/{jobId}/failedResults` |
| Get unprocessed records | GET | `/services/data/v60.0/jobs/ingest/{jobId}/unprocessedrecords` |
| Delete job | DELETE | `/services/data/v60.0/jobs/ingest/{jobId}` |

### Job Request Body Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `object` | String | Yes | API name of the SObject (e.g., `Account`) |
| `operation` | String | Yes | `insert`, `update`, `upsert`, `delete`, `hardDelete` |
| `externalIdFieldName` | String | Only for upsert | API name of external ID field |
| `contentType` | String | Yes | `CSV` (only supported type in v2.0) |
| `lineEnding` | String | No | `LF` (default) or `CRLF` |
| `columnDelimiter` | String | No | `COMMA` (default), `TAB`, `PIPE`, `SEMICOLON`, `CARET`, `BACKQUOTE` |
| `concurrencyMode` | String | No | `Parallel` (default) or `Serial` |

---

## Batch Apex Class Structure

```apex
public class ExampleBatch
        implements Database.Batchable<SObject>, Database.Stateful {

    // Instance variables persist across chunks ONLY because of Database.Stateful.
    // Without Database.Stateful, these reset to their initial values each execute().
    private List<String> errors = new List<String>();
    private Integer processedCount = 0;

    // start(): Called once. Returns the full dataset cursor.
    // Database.QueryLocator bypasses the 50,000-row SOQL governor.
    // Use Iterable<SObject> only for non-SOQL sources with < 50,000 records.
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator(
            'SELECT Id, Name FROM Account WHERE RecordType.DeveloperName = \'Customer\''
        );
    }

    // execute(): Called once per chunk. Scope = records for this chunk.
    // Default scope size: 200. Maximum: 2,000.
    // allOrNone = false allows partial success within the chunk.
    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        List<Account> toUpdate = new List<Account>();
        for (SObject s : scope) {
            Account a = (Account) s;
            a.Description = 'Processed by batch';
            toUpdate.add(a);
        }

        Database.SaveResult[] results = Database.update(toUpdate, false);
        for (Integer i = 0; i < results.size(); i++) {
            processedCount++;
            if (!results[i].isSuccess()) {
                Database.Error err = results[i].getErrors()[0];
                errors.add(toUpdate[i].Id + ' | ' + err.getStatusCode() + ': ' + err.getMessage());
            }
        }
    }

    // finish(): Called once after all chunks complete.
    // Use to persist errors, send notifications, or chain the next batch.
    // Calling Database.executeBatch() here is the ONLY valid way to chain batches.
    public void finish(Database.BatchableContext bc) {
        AsyncApexJob job = [
            SELECT Status, NumberOfErrors, TotalJobItems, JobItemsProcessed
            FROM AsyncApexJob WHERE Id = :bc.getJobId()
        ];

        if (!errors.isEmpty()) {
            // Persist errors to a custom log object or send email notification
        }

        // Chain next batch (only valid in finish(), NOT in execute()):
        // Database.executeBatch(new CleanupBatch(), 200);
    }
}
```

---

## Governor Limits Reference Table

### Apex Transaction Limits

| Limit | Synchronous | Asynchronous (Batch / Queueable / Future) |
|---|---|---|
| Heap size | 6 MB | 12 MB |
| CPU time | 10 seconds | 60 seconds |
| SOQL queries | 100 | 200 |
| SOQL rows returned | 50,000 | 50,000 (per execute(); QueryLocator bypasses this in start()) |
| DML statements | 150 | 150 |
| DML rows | 10,000 | 10,000 |
| HTTP callouts | 100 | 100 (per execute(), requires Database.AllowsCallouts) |
| Callout timeout (total) | 120 seconds | 120 seconds per execute() |
| `Database.executeBatch` calls | 1 per transaction | Not callable from execute(); 1 from finish() |
| Concurrent batch jobs per org | — | 5 (total; Holding+Queued+Preparing+Processing) |
| Max batch scope | — | 2,000 (recommended: 200) |
| QueryLocator max rows | — | 50,000,000 |

### Bulk API 2.0 Limits

| Limit | Value |
|---|---|
| Max CSV payload per job | 150 MB |
| Max jobs per org per 24-hour rolling window | 10,000 |
| Server-side batch size (internal) | 2,000 records |
| Result file retention after job completion | 7 days |
| Max concurrent jobs being processed | Org-dependent (typically 10–15 parallel) |
| `hardDelete` permission required | `BulkApiHardDelete` system permission |
| Supported content type | CSV only |

### Batch Apex Scope Sizing Guide

| DML Complexity per Record | Recommended Scope |
|---|---|
| No DML (read-only / aggregate) | 2,000 |
| 1 DML statement, simple fields | 200 (default) |
| 1 DML statement + related record lookup | 200 |
| 2+ DML statements or complex lookups | 100 |
| HTTP callout per record (AllowsCallouts) | 100 (100 callout limit per execute()) |
| Heavy computation + DML | 50 |

---

## Bulk API 1.0 vs 2.0 Summary

| Feature | Bulk API 1.0 | Bulk API 2.0 |
|---|---|---|
| Chunking | Client manages batches | Server manages batches automatically |
| Result retrieval | Per-batch result files | Job-level successfulResults / failedResults |
| Content type | CSV, XML, ZIP | CSV only |
| SOAP requirement | None (REST-based) | None (REST-based) |
| Monitoring | Per-batch polling | Job-level polling |
| Recommended for new integrations | No | Yes |
| Data Loader default (v45+) | Uses 2.0 when available | Native |
