# Bulk API 2.0 — Complete Walkthrough

## Overview

Bulk API 2.0 is a REST API for asynchronous, large-volume data operations against Salesforce objects. It supports `insert`, `update`, `upsert`, `delete`, and `hardDelete` operations. Unlike Bulk API 1.0, chunking is managed entirely server-side — the client uploads one CSV per job and Salesforce splits it into internal batches of 2,000 records.

Base path: `https://{instance}.salesforce.com/services/data/v{version}/jobs/ingest`

All requests require:
```
Authorization: Bearer {sessionId}
Content-Type: application/json   (for create/close/abort)
Content-Type: text/csv           (for CSV upload)
```

---

## Step 1: Create a Job

### Request

```http
POST /services/data/v60.0/jobs/ingest
Authorization: Bearer {sessionId}
Content-Type: application/json

{
  "object": "Account",
  "operation": "upsert",
  "externalIdFieldName": "External_ID__c",
  "contentType": "CSV",
  "lineEnding": "LF",
  "columnDelimiter": "COMMA",
  "concurrencyMode": "Parallel"
}
```

### Operation Values

| Value | Description |
|---|---|
| `insert` | Create new records; fails if Id provided |
| `update` | Update existing records by Id |
| `upsert` | Insert or update by external ID field |
| `delete` | Soft-delete records (Recycle Bin recoverable, 15 days) |
| `hardDelete` | Permanently delete records; requires `BulkApiHardDelete` permission |

### Concurrency Modes

| Mode | Behaviour |
|---|---|
| `Parallel` (default) | Multiple server batches processed concurrently; faster but may cause row locks |
| `Serial` | Server batches processed one at a time; slower but avoids trigger/lock conflicts |

Use `Serial` when triggers on the target object are not bulkified or when `UNABLE_TO_LOCK_ROW` errors occur in parallel mode.

### Response

```json
{
  "id": "7503X000006TGwZQAW",
  "operation": "upsert",
  "object": "Account",
  "createdById": "0053X000007DeWxQAK",
  "createdDate": "2025-06-01T10:00:00.000+0000",
  "systemModstamp": "2025-06-01T10:00:00.000+0000",
  "state": "Open",
  "externalIdFieldName": "External_ID__c",
  "concurrencyMode": "Parallel",
  "contentType": "CSV",
  "apiVersion": 60.0,
  "lineEnding": "LF",
  "columnDelimiter": "COMMA"
}
```

Save the `id` value — it is used in all subsequent calls for this job.

---

## Step 2: Upload CSV Data

### CSV Format Requirements

- First row must be the column header row with field API names.
- All subsequent rows are data rows.
- Field API names must match the object's field API names exactly (case-insensitive, but exact spelling).
- For `upsert`, include the external ID field column.
- For `update` and `delete`, include the `Id` column.
- Enclose values containing commas, newlines, or double-quotes in double-quotes.
- Escape literal double-quotes inside values by doubling them (`""`).
- Empty string values in a cell clear the field; omit the column entirely to leave the field unchanged.
- Boolean fields: use `true` or `false` (case-insensitive).
- Date fields: ISO 8601 format — `YYYY-MM-DD`.
- DateTime fields: ISO 8601 with time zone — `YYYY-MM-DDTHH:MM:SS.000Z`.

### Example CSV (upsert on Account)

```csv
External_ID__c,Name,BillingCity,BillingState,Phone,Industry
ACC-001,Acme Corporation,San Francisco,CA,4155550100,Technology
ACC-002,Globex Corp,Springfield,IL,2175550199,Manufacturing
ACC-003,Initech LLC,Austin,TX,5125550177,Finance
```

### Request

```http
PUT /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW/batches
Authorization: Bearer {sessionId}
Content-Type: text/csv

External_ID__c,Name,BillingCity,BillingState,Phone,Industry
ACC-001,Acme Corporation,San Francisco,CA,4155550100,Technology
ACC-002,Globex Corp,Springfield,IL,2175550199,Manufacturing
```

### Response

HTTP `201 Created` with an empty body on success.

### Payload Size

- Maximum 150 MB per PUT request.
- For datasets larger than 150 MB, create multiple jobs (one job per ≤150 MB chunk) and run them sequentially or in parallel.
- Monitor total job count against the 10,000-job/24-hour rolling window limit.

---

## Step 3: Close the Job (Begin Processing)

### Request

```http
PATCH /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW
Authorization: Bearer {sessionId}
Content-Type: application/json

{
  "state": "UploadComplete"
}
```

### Response

```json
{
  "id": "7503X000006TGwZQAW",
  "state": "UploadComplete",
  ...
}
```

The job state transitions from `Open` → `UploadComplete` → `InProgress` as Salesforce queues and begins processing. Do not upload additional data after sending `UploadComplete`.

### Abort a Job (Optional)

To cancel a job before or during processing:

```http
PATCH /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW
Authorization: Bearer {sessionId}
Content-Type: application/json

{
  "state": "Aborted"
}
```

Aborted jobs do not process any remaining unprocessed records. Records already committed by server batches that completed before the abort are not rolled back.

---

## Step 4: Poll for Job Completion

### Request

```http
GET /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW
Authorization: Bearer {sessionId}
```

### Response

```json
{
  "id": "7503X000006TGwZQAW",
  "operation": "upsert",
  "object": "Account",
  "state": "JobComplete",
  "numberRecordsProcessed": 1500,
  "numberRecordsFailed": 12,
  "totalProcessingTime": 4821,
  "apiActiveProcessingTime": 3200,
  "apexProcessingTime": 0,
  "errorMessage": null
}
```

### Polling Strategy

- Poll every 5–10 seconds initially.
- Use exponential backoff for large jobs (up to 60-second intervals).
- Terminal states: `JobComplete`, `Failed`, `Aborted`.
- Non-terminal states: `Open`, `UploadComplete`, `InProgress`.

### Job-Level Error

If `state` is `Failed` and `errorMessage` is non-null, the entire job failed before processing began (e.g., invalid object name, missing external ID field declaration, permission denied). No records were processed. Correct the error and create a new job.

---

## Step 5: Retrieve Results

Results are available for **7 days** after job completion. After 7 days or after explicit job deletion, they are permanently unavailable.

### Successful Results

```http
GET /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW/successfulResults
Authorization: Bearer {sessionId}
```

Response CSV columns:

| Column | Description |
|---|---|
| `sf__Id` | Salesforce record Id of the inserted/updated record |
| `sf__Created` | `true` if the record was created (insert/upsert); `false` if updated |
| Plus all input columns | Values as submitted in the upload CSV |

### Failed Results

```http
GET /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW/failedResults
Authorization: Bearer {sessionId}
```

Response CSV columns:

| Column | Description |
|---|---|
| `sf__Id` | Salesforce record Id (if known; empty for insert failures) |
| `sf__Error` | Error code and message (e.g., `REQUIRED_FIELD_MISSING:Name:Name`) |
| Plus all input columns | Values as submitted in the upload CSV |

### Unprocessed Records

```http
GET /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW/unprocessedrecords
Authorization: Bearer {sessionId}
```

Returns records that were uploaded but not processed (e.g., due to job abort). Re-submit these in a new job.

### Error Code Parsing

The `sf__Error` column uses the format: `ERROR_CODE:field_name:message`. Examples:

| sf__Error value | Meaning |
|---|---|
| `REQUIRED_FIELD_MISSING:Name:Name` | `Name` field is required and was empty |
| `FIELD_INTEGRITY_EXCEPTION:OwnerId:User` | Invalid OwnerId reference |
| `DUPLICATE_VALUE:external_id:duplicate value found` | Duplicate external ID in org |
| `INVALID_FIELD:Industry:Industry` | Invalid picklist value for `Industry` |
| `STRING_TOO_LONG:Description:max length exceeded` | Value too long for `Description` field |

---

## External ID Upsert Setup

### Field Metadata Requirement

The field used as `externalIdFieldName` must have `isExternalId = true`. To verify:

```http
GET /services/data/v60.0/sobjects/Account/describe
```

Find the field in the `fields` array and check `"externalId": true`. If it is `false`, the upsert job creation will fail.

### Setting External ID via Metadata API

In a custom field's `.field-meta.xml`:
```xml
<CustomField>
    <fullName>External_ID__c</fullName>
    <externalId>true</externalId>
    <label>External ID</label>
    <length>50</length>
    <type>Text</type>
    <unique>true</unique>
</CustomField>
```

Both `<externalId>true</externalId>` and `<unique>true</unique>` are required for reliable upsert key behaviour. Without `unique`, duplicate external ID values in the org cause `DUPLICATE_VALUE` errors.

### Standard Object External ID Fields

Some standard objects have built-in external ID fields:
- `Account`: none by default; create a custom field
- `Contact`: none by default; create a custom field
- `Lead`: none by default; create a custom field
- `User`: none by default; create a custom field
- `ExternalDataUserAuth`: `ExternalDataSourceId` + `UserId` combination

---

## Serial vs Parallel Concurrency Mode

### When to Use Parallel (default)

- Target object's triggers are fully bulkified (no SOQL/DML inside loops).
- No concurrent batch jobs or other integrations writing to the same object.
- Maximum throughput is required.

### When to Use Serial

- Triggers on the target object are not bulkified and cause `UNABLE_TO_LOCK_ROW` errors.
- The object has complex before/after trigger logic that produces `System.LimitException` under parallel load.
- You are debugging a job and need predictable, sequential processing to isolate failures.
- Upstream process ordering is required (e.g., parent records must be committed before child records in a single job, though it is usually better to use separate jobs in the correct sequence).

---

## Job Deletion

```http
DELETE /services/data/v60.0/jobs/ingest/7503X000006TGwZQAW
Authorization: Bearer {sessionId}
```

Returns `204 No Content`. After deletion:
- All result files (`successfulResults`, `failedResults`, `unprocessedrecords`) are immediately and permanently unavailable.
- The job no longer appears in `GET /jobs/ingest` list responses.
- Always retrieve and persist result files **before** deleting a job.

---

## Listing Jobs

```http
GET /services/data/v60.0/jobs/ingest?isPkChunkingEnabled=false&jobType=V2Ingest
Authorization: Bearer {sessionId}
```

Returns a paginated list of jobs with `nextRecordsUrl` for pagination. Useful for monitoring total job count against the 10,000/24-hour limit and for auditing job status across integrations.
