---
name: platform-bulk-data-processing
description: >-
  Bulk API 2.0, Database.Batchable, Database.Stateful, Batch Apex, Queueable,
  upsert, external ID, Data Loader, large data volumes, LDV, skinny table,
  governor limits, heap size, CPU time, SOQL rows, DML rows, chunking,
  parallel batch, batch scope, error handling, partial success, allOrNone,
  Database.SaveResult, Database.UpsertResult, async processing, data migration
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: bulk-data-processing
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# platform-bulk-data-processing

Guidance for Salesforce bulk data operations: Bulk API 2.0, Batch Apex (`Database.Batchable`), Queueable-based data pipelines, Data Loader, large data volume (LDV) architecture, governor limits, chunking strategies, partial-success error handling, and upsert with external IDs.

---

## Scope

**Covered by this skill**
- Bulk API 2.0 job lifecycle (create, upload, close, poll, retrieve results)
- `Database.Batchable` / `Database.Stateful` implementation patterns
- Scope sizing and governor limit budgeting for batch jobs
- Upsert operations with external IDs (Bulk API 2.0 and Apex)
- Data Loader CLI/UI configuration and field mapping
- Large Data Volume (LDV) strategies: skinny tables, indexing, archiving to BigObjects
- Parallel batch design and row-lock avoidance
- Partial-success error handling (`allOrNone = false`, `Database.SaveResult`)
- `Database.AllowsCallouts` pattern for batch-driven integrations

**Not covered here — use the indicated skill instead**
- Queueable chains for async logic → `platform-async-patterns`
- SOQL query optimisation and query plan analysis → `platform-performance-and-limits`
- CI/CD deployment pipelines → `platform-devops-and-deployment`

---

## Gotchas

### 1. Bulk API 2.0 has a 150 MB per job limit and a 10,000 batch job per 24-hour rolling window

Each Bulk API 2.0 job processes one object type with one operation (`insert`, `update`, `upsert`, `delete`, `hardDelete`). The uploaded CSV payload for a single job cannot exceed 150 MB. The org-wide limit is 10,000 jobs per 24-hour rolling window, shared across all integrations and users. Exceeding 150 MB requires splitting the dataset into multiple sequential or parallel jobs. Hitting the 10,000 job ceiling returns `REQUEST_LIMIT_EXCEEDED`; integrations must implement throttling or backoff logic and monitor job creation rates via `GET /jobs/ingest`.

### 2. `Database.Batchable` `execute()` scope default is 200 — setting it higher than 2000 causes governor limit failures

The `scope` parameter in `Database.executeBatch(job, scope)` controls how many records are passed to each `execute()` invocation. The default is 200. The platform-enforced maximum is 2,000. In practice, setting scope to 2,000 with DML-heavy logic inside `execute()` frequently exhausts the 12 MB heap limit or exceeds the 60-second CPU time limit for async transactions. For batches performing one or more DML operations per record (e.g., related-record lookups + updates), keep scope at 200 or lower. Only increase scope when `execute()` is read-only or performs a single bulk DML on the entire list.

### 3. `Database.Stateful` is required to accumulate state across batch chunks — without it, instance variables reset between `execute()` calls

Any counter, collection, or map declared as an instance variable on a `Database.Batchable` class is re-initialised to its declaration-time value at the start of every `execute()` chunk unless the class also implements `Database.Stateful`. This is a serialisation behaviour: Salesforce serialises the job object between chunks, and without `Database.Stateful`, no instance state is preserved. The heap consumed by stateful data (e.g., an error list that grows across chunks) counts against each chunk's 12 MB heap limit. For very large error collections, flush and persist to a custom log object in `finish()` rather than accumulating the entire list in memory.

### 4. Bulk API 2.0 upsert requires an external ID field marked as `External ID` in field metadata

The `externalIdFieldName` request body parameter for a Bulk API 2.0 upsert job must reference a field where `isExternalId = true` in the object's field metadata. This flag is set via Setup (field definition) or via the Metadata API (`Field.externalId = true`). Using any other field — even one that is unique and consistently populated — causes the job creation request to fail with `INVALID_FIELD: ExternalId is not supported for [FieldName]`. Standard `Id` is valid for updates but cannot be used as the external ID key for upsert merge logic.

### 5. `allOrNone = false` in `Database.insert/update/upsert` allows partial success — errors do not roll back successful records

When using DML methods with partial-success mode (`Database.insert(records, false)`), Salesforce commits successful records independently of failed ones within the same DML call. The returned `Database.SaveResult[]` (or `Database.UpsertResult[]`) array has one entry per input record; inspect `SaveResult.isSuccess()` and `SaveResult.getErrors()` for each. This is the correct pattern for bulk operations in `execute()`. The default DML statement form (`insert records;`) uses `allOrNone = true`, which rolls back the entire set if any single record fails — unacceptable for large-volume batch work.

### 6. Batch Apex `start()` SOQL is limited to 50 million records — use `QueryLocator` not `Iterable` for large data

`Database.QueryLocator` returned from `start()` streams records to `execute()` in chunks via a server-side cursor, bypassing the normal 50,000-row SOQL governor limit. The effective ceiling with `QueryLocator` is 50 million records. If `start()` returns `Iterable<SObject>`, the entire result set is materialised in memory at once and is subject to the standard 50,000 row governor limit. Never use `Iterable` for batches expected to process more than 50,000 records. Use `Iterable` only when the source data cannot be expressed as a simple SOQL query and the volume is known to be small.

### 7. Bulk API 2.0 processes records in server-side batches of 2,000 — errors in one server batch do not affect others

Bulk API 2.0 manages chunking entirely server-side in batches of up to 2,000 records each. Each server batch is committed independently. A failure in records within one server batch does not roll back records successfully processed in another server batch within the same job. Per-record success and failure are reported in the `successfulResults` and `failedResults` CSV files, respectively. This is different from Batch Apex with `allOrNone = true`, where a single error in an `execute()` call rolls back all records in that chunk.

### 8. `Database.executeBatch` returns an `AsyncApexJob.Id` — calling it inside a batch `execute()` is not allowed

`Database.executeBatch(batchInstance)` returns the `Id` of the resulting `AsyncApexJob` record. It is fully asynchronous; the batch runs after the current transaction closes. Calling `Database.executeBatch` from within a batch `execute()` method throws `System.AsyncException: Database.executeBatch cannot be called from a batch Apex execute or finish method`. To chain batches, call `Database.executeBatch` from the `finish()` method instead. Never expect synchronous completion — use `AsyncApexJob` polling or a `FinishBatch` trigger pattern to react to job completion.

### 9. Skinny tables improve query performance on LDV objects but require Salesforce support to enable

A skinny table is a narrow, internally-managed copy of a subset of frequently queried fields on a large SObject, stored without the standard Salesforce metadata columns. They are most effective on objects with 10 million+ records where full-table scans or wide queries are a bottleneck. Skinny tables cannot be created via Metadata API, Setup UI, or any declarative/programmatic means. A Salesforce Support case (or Customer Success engagement) is required both to create the initial skinny table and to add fields to it after creation. Plan skinny table requests well before go-live as provisioning can take several days.

### 10. `Database.AllowsCallouts` enables HTTP callouts from batch `execute()` — but each `execute()` is limited to 100 callouts

Implementing the `Database.AllowsCallouts` marker interface on a `Database.Batchable` class permits HTTP callouts within `execute()`. Each `execute()` invocation is subject to the 100-callout-per-transaction limit. With the default scope of 200 records, this means at most 1 callout per 2 records per chunk. If the integration requires 1 callout per record, reduce scope to 100 or fewer. Callout timeouts still apply (120 seconds total callout time per transaction). Do not combine `Database.AllowsCallouts` with high scope sizes and record-level callout patterns without budgeting callout headroom carefully.

### 11. Bulk API 2.0 `hardDelete` bypasses the Recycle Bin and is irreversible — it requires the `BulkApiHardDelete` permission

The `hardDelete` operation in Bulk API 2.0 permanently removes records without placing them in the 15-day Recycle Bin. There is no undelete path. The running user must have the `BulkApiHardDelete` system permission assigned (via a Permission Set or Profile). Attempting `hardDelete` without this permission returns `INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY`. In production environments, treat `hardDelete` jobs as irreversible destructive operations requiring explicit change-control approval. Never use `hardDelete` as a default — use `delete` (soft delete, Recycle Bin recoverable) unless hard deletion is explicitly required.

### 12. Parallel batch jobs on the same object compete for row locks — limit concurrent jobs on the same SObject

Salesforce allows up to 5 concurrently running batch jobs per org. When two or more batch jobs simultaneously issue DML against the same SObject (even against different record IDs), they can produce `UNABLE_TO_LOCK_ROW` errors because Salesforce's locking model operates at the database row level and can escalate to page locks under contention. To avoid this, serialise batch jobs that write to the same object: query `AsyncApexJob` for jobs with `Status IN ('Holding','Queued','Preparing','Processing')` and `ApexClass.Name` matching your batch class before enqueuing a new job. Use `finish()` chaining to enforce sequential execution.

### 13. `Database.QueryLocator` cursor is held server-side for up to 10 minutes between chunks — long `execute()` runs can cause cursor timeout

The server-side cursor maintained for a `Database.QueryLocator` batch is held between `execute()` invocations. If an `execute()` call runs longer than 10 minutes (the async CPU limit is 60 seconds, so this is rare but possible with callout timeouts stacking), the cursor for the next chunk may expire, causing the batch to fail mid-run with a cursor-not-found error. Mitigate by keeping `execute()` logic lean, using small scope sizes when processing is complex, and avoiding patterns that block execution (e.g., long synchronous callouts in loops).

### 14. Bulk API 2.0 job results must be retrieved within 7 days — after that, results are permanently unavailable

After a Bulk API 2.0 job reaches `JobComplete` or `Failed` state, the `successfulResults` and `failedResults` CSV files are accessible via `GET /jobs/ingest/{jobId}/successfulResults` and `/failedResults` for 7 days from job completion. After 7 days, or if the job is explicitly deleted via `DELETE /jobs/ingest/{jobId}`, the result files are permanently removed with no recovery option. Integration pipelines that audit record-level outcomes must retrieve and persist result files within the 7-day window. Do not rely on the Bulk API results endpoint as a long-term audit store.

---

## Routing Table

| Scenario | Reference |
|---|---|
| Bulk API 2.0 job lifecycle, REST endpoints, job object fields, governor limits table | [01-architecture.md](references/01-architecture.md) |
| Bulk API 2.0 complete walkthrough: create, upload CSV, close, poll, retrieve results, error parsing | [02-bulk-api-2.md](references/02-bulk-api-2.md) |
| Batch Apex implementation: Batchable interface, QueryLocator, Stateful, scope sizing, error collection, chaining | [03-batch-apex.md](references/03-batch-apex.md) |
| Data Loader CLI/UI, field mapping, external ID setup, Bulk API 1.0 vs 2.0, Import Wizard limits | [04-data-loader-and-tools.md](references/04-data-loader-and-tools.md) |
| LDV thresholds, skinny tables, custom indexes, parallel batch design, archiving to BigObjects | [05-ldv-and-performance.md](references/05-ldv-and-performance.md) |

---

## Workflows

### Workflow 1: Run a Bulk API 2.0 upsert job

1. **Verify prerequisites** — confirm the external ID field exists on the target object and has `isExternalId = true` in field metadata (Setup > Object Manager > [Object] > Fields & Relationships > [Field] > External ID checkbox). Without this, job creation fails with `INVALID_FIELD`.
2. **Authenticate** — obtain a session token via `POST /services/oauth2/token` (connected app OAuth flow) or use an existing session token. All Bulk API 2.0 calls use the header `Authorization: Bearer {sessionId}`.
3. **Create the job** — `POST /services/data/vXX.0/jobs/ingest` with JSON body:
   ```json
   {
     "object": "Account",
     "operation": "upsert",
     "externalIdFieldName": "External_ID__c",
     "contentType": "CSV",
     "lineEnding": "LF"
   }
   ```
   Note the `id` field in the response — this is the job ID used in all subsequent calls.
4. **Upload the CSV** — `PUT /services/data/vXX.0/jobs/ingest/{jobId}/batches` with header `Content-Type: text/csv`. The CSV first row must be the field API names header. Keep payload under 150 MB per request; split into multiple jobs if the dataset is larger.
5. **Close the job** — `PATCH /services/data/vXX.0/jobs/ingest/{jobId}` with body `{"state":"UploadComplete"}`. This signals processing should begin. The job transitions from `Open` to `UploadComplete`, then `InProgress`.
6. **Poll until complete** — `GET /services/data/vXX.0/jobs/ingest/{jobId}` on an interval (e.g., every 5–10 seconds with exponential backoff). Check the `state` field: `InProgress` → keep polling; `JobComplete` → proceed to results; `Failed` or `Aborted` → inspect `errorMessage` and the failed results file.
7. **Retrieve results** — `GET /services/data/vXX.0/jobs/ingest/{jobId}/successfulResults` and `GET /services/data/vXX.0/jobs/ingest/{jobId}/failedResults`. Parse the returned CSV. For failed records, inspect the `sf__Error` column for Salesforce error codes and messages. Persist results within 7 days.
8. **Cleanup** — optionally `DELETE /services/data/vXX.0/jobs/ingest/{jobId}` after results have been retrieved and persisted. Results become immediately unavailable after deletion.

See [02-bulk-api-2.md](references/02-bulk-api-2.md) for full request/response examples and CSV format requirements.

---

### Workflow 2: Implement a Batch Apex class for large-volume DML with error collection

1. **Define the class** — implement `Database.Batchable<SObject>` and `Database.Stateful`. Declare an instance variable for error accumulation:
   ```apex
   public class MyBatch implements Database.Batchable<SObject>, Database.Stateful {
       private List<String> errors = new List<String>();
   ```
2. **Implement `start()`** — return a `Database.QueryLocator` using a SOQL query filtered to the target record set. Avoid `Iterable` for sets larger than 50,000 records:
   ```apex
   public Database.QueryLocator start(Database.BatchableContext bc) {
       return Database.getQueryLocator('SELECT Id, Name FROM Account WHERE NeedsUpdate__c = true');
   }
   ```
3. **Implement `execute()`** — build the list of records to modify, call `Database.insert(records, false)` (or `update`/`upsert` with `false`), then iterate `Database.SaveResult[]` to collect errors:
   ```apex
   public void execute(Database.BatchableContext bc, List<SObject> scope) {
       List<Account> toUpdate = new List<Account>();
       for (SObject s : scope) {
           Account a = (Account) s;
           a.Description = 'Processed';
           toUpdate.add(a);
       }
       Database.SaveResult[] results = Database.update(toUpdate, false);
       for (Integer i = 0; i < results.size(); i++) {
           if (!results[i].isSuccess()) {
               errors.add(toUpdate[i].Id + ': ' + results[i].getErrors()[0].getMessage());
           }
       }
   }
   ```
4. **Implement `finish()`** — persist accumulated errors (e.g., insert custom log records, send an email). Chain the next batch if required:
   ```apex
   public void finish(Database.BatchableContext bc) {
       if (!errors.isEmpty()) {
           // insert error log records or send Messaging.SingleEmailMessage
       }
       // Chain next batch if needed:
       // Database.executeBatch(new NextBatch(), 200);
   }
   ```
5. **Set scope size** — call `Database.executeBatch(new MyBatch(), 200)`. Adjust downward (100 or 50) if `execute()` performs multiple DML operations or complex in-memory processing. Never exceed 2,000.
6. **Test** — use `Test.startTest()` / `Test.stopTest()` to force synchronous batch execution. Insert a dataset of at least 201 records to verify multi-chunk error accumulation works correctly with `Database.Stateful`.

See [03-batch-apex.md](references/03-batch-apex.md) for annotated examples and scope sizing guidance.

---

### Workflow 3: Diagnose and resolve a bulk job failure

1. **Identify the failure type** — for Bulk API 2.0, check the job's `state` field and `errorMessage` via `GET /jobs/ingest/{jobId}`. For Batch Apex, run:
   ```soql
   SELECT Status, NumberOfErrors, ExtendedStatus, TotalJobItems, JobItemsProcessed
   FROM AsyncApexJob WHERE Id = '7073X...'
   ```
   The `ExtendedStatus` field contains the top-level failure reason.
2. **Governor limit hit** — if `ExtendedStatus` contains `Apex heap size too large`, reduce scope size or move data aggregation out of `execute()`. If it says `Maximum CPU time exceeded`, profile `execute()` for expensive loops or SOQL inside loops. Reference the limits table in [01-architecture.md](references/01-architecture.md).
3. **Row lock errors** — if `ExtendedStatus` or `SaveResult` errors contain `UNABLE_TO_LOCK_ROW`, query `AsyncApexJob` for other concurrently running jobs on the same SObject:
   ```soql
   SELECT Id, ApexClass.Name, Status FROM AsyncApexJob
   WHERE Status IN ('Holding','Queued','Preparing','Processing')
   AND ApexClass.Name = 'MyBatch'
   ```
   Serialise jobs using a `finish()`-chain pattern or schedule them in off-peak windows.
4. **Partial success analysis (Bulk API 2.0)** — retrieve the `failedResults` CSV from `GET /jobs/ingest/{jobId}/failedResults`. The `sf__Error` column contains error codes (e.g., `REQUIRED_FIELD_MISSING`, `FIELD_INTEGRITY_EXCEPTION`). Correlate `sf__Id` against source data. Fix source data or business logic and re-submit only the failed records in a new job.
5. **Partial success analysis (Batch Apex)** — examine the error list accumulated via `Database.SaveResult` in `Database.Stateful`. If errors were not collected because `allOrNone = true` was used, refactor to `Database.insert(records, false)` with result iteration. Re-process only failed records by storing their IDs in a custom log object and running a follow-up batch that queries `WHERE Id IN :failedIds`.
6. **Cursor timeout** — if a batch fails mid-run with a cursor or query-related error, reduce scope size and ensure `execute()` completes well under the 60-second async CPU limit per chunk. Split complex processing into a two-batch pipeline: the first batch stages/enriches data into a scratch object; the second performs the final DML against the staged records.

See [03-batch-apex.md](references/03-batch-apex.md) and [02-bulk-api-2.md](references/02-bulk-api-2.md) for detailed failure patterns and remediation examples.
