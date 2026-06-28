# REST API, Composite API, and Related Patterns

## Standard REST API Operations

Base URL for all REST API calls (replace `XX.0` with current version, minimum `60.0`):

```
https://{MyDomain}.my.salesforce.com/services/data/vXX.0/
```

Required headers for all calls:

```http
Authorization: Bearer {oauth_access_token}
Content-Type: application/json
Accept: application/json
Accept-Encoding: gzip
```

`Accept-Encoding: gzip` is strongly recommended. Salesforce compresses large responses. For queries returning many records, this can reduce payload size by 60–80%.

---

### CRUD on `/sobjects/`

**Create (INSERT)**

```http
POST /services/data/v60.0/sobjects/Account
Content-Type: application/json

{
  "Name": "Acme Corp",
  "Industry": "Technology",
  "BillingCity": "San Francisco"
}
```

Response: `201 Created`
```json
{ "id": "001xx000003GYn1AAG", "success": true, "errors": [] }
```

**Read (SELECT by ID)**

```http
GET /services/data/v60.0/sobjects/Account/001xx000003GYn1AAG
```

Response: `200 OK` — full record JSON.

To limit fields returned:

```http
GET /services/data/v60.0/sobjects/Account/001xx000003GYn1AAG?fields=Id,Name,Industry
```

**Update (partial update)**

```http
PATCH /services/data/v60.0/sobjects/Account/001xx000003GYn1AAG
Content-Type: application/json

{
  "Industry": "Finance"
}
```

Response: `204 No Content` (no body). Only fields included in the body are updated.

**Delete**

```http
DELETE /services/data/v60.0/sobjects/Account/001xx000003GYn1AAG
```

Response: `204 No Content`.

**Upsert by External ID**

```http
PATCH /services/data/v60.0/sobjects/Account/External_CRM_Id__c/CRM-000123
Content-Type: application/json

{
  "Name": "Acme Corp",
  "Industry": "Technology"
}
```

Response:
- `201 Created` — record inserted (includes `id` in response body).
- `204 No Content` — record updated.

This is the canonical idempotent write pattern. Always use upsert over POST when the external system has a stable identifier.

---

### SOQL Query via `/query/`

```http
GET /services/data/v60.0/query/?q=SELECT+Id,Name,Industry+FROM+Account+WHERE+Industry='Technology'+LIMIT+10
```

Response:
```json
{
  "totalSize": 3,
  "done": true,
  "records": [
    { "attributes": { "type": "Account", "url": "..." }, "Id": "001...", "Name": "...", "Industry": "Technology" }
  ]
}
```

When `done` is `false`, paginate using `nextRecordsUrl`:

```http
GET /services/data/v60.0/query/01gxx000003GYn1-2000
```

Use `/queryAll/` instead of `/query/` to include soft-deleted records in results.

---

### SOSL Search via `/search/`

```http
GET /services/data/v60.0/search/?q=FIND+{Acme}+IN+ALL+FIELDS+RETURNING+Account(Id,Name),Contact(Id,Name)
```

Returns records from multiple objects in a single call, ranked by relevance. Use for cross-object text search rather than SOQL with multiple queries.

---

### SObject Describe

```http
GET /services/data/v60.0/sobjects/Account/describe
```

Returns all field metadata, picklist values, relationship names, and CRUD permissions for the calling user. Use this to dynamically discover field names and types at integration build time, rather than hardcoding field lists.

---

## Composite API

**Endpoint**: `POST /services/data/v60.0/composite`

The Composite API chains up to 25 REST API subrequests into a single HTTP call. Benefits:
- Reduces network round-trips (one TCP connection, one TLS handshake, one OAuth token check).
- Supports atomic rollback with `allOrNone=true`.
- Supports result passing between subrequests via `referenceId`.

### Request Structure

```json
{
  "allOrNone": true,
  "collateSubrequests": false,
  "compositeRequest": [
    {
      "method": "HTTP_VERB",
      "url": "/services/data/v60.0/...",
      "referenceId": "UniqueHandleForThisSubrequest",
      "httpHeaders": { "If-Match": "optional_etag" },
      "body": { ... }
    }
  ]
}
```

**Fields**:
- `allOrNone` (Boolean, required): `true` = atomic rollback on any failure; `false` = commit each subrequest independently.
- `collateSubrequests` (Boolean, optional): when `true`, subrequests against the same object type are batched internally for performance. Does not change response structure.
- `compositeRequest` (Array): up to 25 subrequest objects.
- `referenceId` (String, required per subrequest): unique identifier used in `@{referenceId.field}` substitutions.
- `method`: GET, POST, PATCH, PUT, DELETE.
- `url`: the relative REST API URL including version. Must start with `/services/data/`.

### Response Structure

```json
{
  "compositeResponse": [
    {
      "body": { ... },
      "httpHeaders": { "Location": "/services/data/v60.0/sobjects/Account/001..." },
      "httpStatusCode": 201,
      "referenceId": "NewAccount"
    },
    {
      "body": { ... },
      "httpStatusCode": 201,
      "referenceId": "NewContact"
    }
  ]
}
```

Each subrequest's result appears in `compositeResponse` in order. Check `httpStatusCode` per entry when `allOrNone=false`.

### `referenceId` Substitution

Reference the `id` or any field from a previous subrequest's response body:

```json
"AccountId": "@{NewAccount.id}"
```

Reference the URL from an `httpHeaders.Location` value:

```json
"url": "/services/data/v60.0/sobjects/Account/@{NewAccount.id}"
```

Substitution syntax: `@{referenceId.fieldPath}` where `fieldPath` uses dot notation for nested JSON fields (e.g., `@{NewAccount.errors[0].message}`).

### Composite API Limits

| Limit | Value |
|-------|-------|
| Subrequests per Composite call | 25 |
| Query rows returned across all subrequests | 2,000 |
| `allOrNone` rollback scope | All subrequests in the call |
| Supported operations | GET, POST, PATCH, PUT, DELETE |

Composite API subrequests count against the org's API request limits.

---

## SObject Tree API

**Endpoint**: `POST /services/data/v60.0/composite/tree/{SObjectType}`

Creates one or more root records of the same SObject type, each with nested child records in a single HTTP call.

### Limits

| Limit | Value |
|-------|-------|
| Total records per call (root + all children) | 200 |
| Root record SObject types per call | 1 (must be same type) |
| Nesting depth | Up to 5 levels |
| Child relationship types | Any child relationship defined on the object |

### Request Structure

```json
{
  "records": [
    {
      "attributes": {
        "type": "Account",
        "referenceId": "Acme"
      },
      "Name": "Acme Corp",
      "Industry": "Technology",
      "Contacts": {
        "records": [
          {
            "attributes": {
              "type": "Contact",
              "referenceId": "AcmeContact1"
            },
            "LastName": "Smith",
            "FirstName": "John",
            "Email": "jsmith@acme.com",
            "Cases": {
              "records": [
                {
                  "attributes": {
                    "type": "Case",
                    "referenceId": "AcmeCase1"
                  },
                  "Subject": "Initial onboarding issue"
                }
              ]
            }
          }
        ]
      }
    }
  ]
}
```

### Response Structure

```json
{
  "hasErrors": false,
  "results": [
    { "referenceId": "Acme",        "id": "001xx000003GYn1AAG" },
    { "referenceId": "AcmeContact1","id": "003xx000003GYn2AAG" },
    { "referenceId": "AcmeCase1",   "id": "500xx000003GYn3AAG" }
  ]
}
```

On partial failure (one record invalid), `hasErrors` is `true` and the entire call rolls back — there is no partial success mode.

---

## Batch REST API

**Endpoint**: `POST /services/data/v60.0/composite/batch`

Executes up to 25 independent REST API subrequests in a single HTTP call. Unlike Composite API:
- No result chaining (`referenceId` values are for response identification only, not for `@{...}` substitutions).
- No `allOrNone` — all subrequests are attempted regardless of failures.
- Responses include `hasErrors` boolean and per-result `statusCode`.

```json
{
  "batchRequests": [
    {
      "method": "PATCH",
      "url": "v60.0/sobjects/Account/001xx000003GYn1",
      "richInput": { "Name": "Updated Name" }
    },
    {
      "method": "GET",
      "url": "v60.0/sobjects/Contact/003xx000003GYn2?fields=Id,Name,Email"
    }
  ],
  "haltOnError": false
}
```

Set `haltOnError: true` to stop processing on the first error (similar to `allOrNone` but without rollback of already-processed subrequests).

---

## Response Codes

| Code | Meaning | When Returned |
|------|---------|---------------|
| 200 OK | Success with body | GET, PATCH upsert-updated, query |
| 201 Created | Resource created | POST insert, PATCH upsert-inserted |
| 204 No Content | Success without body | PATCH update, DELETE |
| 300 Multiple Choices | Ambiguous external ID | Upsert where external ID matches multiple records |
| 400 Bad Request | Malformed request | Invalid JSON, missing required field |
| 401 Unauthorized | Auth failure | Expired token, invalid session |
| 403 Forbidden | Insufficient permissions | Object/field access denied |
| 404 Not Found | Resource missing | Record ID does not exist |
| 405 Method Not Allowed | Wrong HTTP verb | POST on a read-only endpoint |
| 409 Conflict | Lock contention | Record locked by another transaction |
| 412 Precondition Failed | ETag mismatch | `If-Match` header used, record changed since fetch |
| 415 Unsupported Media Type | Wrong Content-Type | Sending XML to a JSON-only endpoint |
| 500 Internal Server Error | Salesforce platform error | Rare; check `errorCode` in response body |
| 503 Service Unavailable | Maintenance/overload | Retry with backoff |

---

## Error Response Structure

Salesforce REST API returns errors as a JSON array:

```json
[
  {
    "errorCode": "REQUIRED_FIELD_MISSING",
    "message": "Required fields are missing: [Name]",
    "fields": ["Name"]
  }
]
```

For Composite API subrequest errors, the error array appears in the subrequest's `body`:

```json
{
  "compositeResponse": [
    {
      "body": [
        {
          "errorCode": "INVALID_FIELD",
          "message": "No such column 'BadField__c' on entity 'Account'",
          "fields": ["BadField__c"]
        }
      ],
      "httpStatusCode": 400,
      "referenceId": "FailedSubrequest"
    }
  ]
}
```

Always check `httpStatusCode` per subrequest when `allOrNone=false`. Do not assume the outer HTTP response code (which will be `200`) indicates all subrequests succeeded.

---

## API Version Best Practices

- Always use a version `>= 60.0` for new integrations.
- Specify the version in the URL path, not as a query parameter.
- Update integration clients to a newer API version at least once per Salesforce major release (3x per year).
- To discover available versions in an org: `GET /services/data/` — returns array of `{ "version": "60.0", "url": "/services/data/v60.0", "label": "Summer '24" }`.
- Salesforce publishes deprecated version removal notices in release notes. Subscribe to the Salesforce Trust API deprecation channel for advance notice.
