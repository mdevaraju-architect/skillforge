---
name: platform-integration-patterns
description: >-
  REST API, Composite API, SObject Tree API, SOAP API, Apex REST, RestResource,
  HttpRequest, HttpResponse, Http callout, named credential, Platform Events,
  Change Data Capture, CDC, outbound integration, inbound integration,
  External Objects, ExternalDataSource, Salesforce Connect, OData, MuleSoft,
  idempotency, retry pattern, integration user, API version, callout timeout,
  callout limit, upsert external ID, composite request, batch request, error handling
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: integration-patterns
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# platform-integration-patterns

Authoritative guidance for Salesforce integration architecture: REST API, Composite API, Apex callouts, Named Credentials, Platform Events, Change Data Capture, External Objects, and integration governance.

---

## Gotchas

### 1. The Composite API processes up to 25 subrequests per call — but a failure in one subrequest with `allOrNone=true` rolls back all committed subrequests

The Composite API (`/services/data/vXX.0/composite`) allows chaining up to 25 REST API calls in one HTTP request. With `allOrNone=true`, a failure in any subrequest rolls back all previously committed subrequests in the same call. With `allOrNone=false`, successful subrequests are committed independently — each is committed as it is processed, and a failure stops processing but does not undo earlier successful subrequests.

Always specify `allOrNone` explicitly in your request body. Default behavior varies by API version, and relying on the default is a common source of unexpected partial commits. When building integrations that must be atomic (e.g., insert Account then Contact as a unit), use `allOrNone=true`. When building integrations where partial success is acceptable and you handle failures per subrequest, use `allOrNone=false` and inspect each subrequest's `httpStatusCode` in the response array.

```json
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST",
      "url": "/services/data/v60.0/sobjects/Account",
      "referenceId": "NewAccount",
      "body": { "Name": "Acme Corp" }
    },
    {
      "method": "POST",
      "url": "/services/data/v60.0/sobjects/Contact",
      "referenceId": "NewContact",
      "body": {
        "LastName": "Smith",
        "AccountId": "@{NewAccount.id}"
      }
    }
  ]
}
```

### 2. Apex HTTP callouts cannot be made from triggers synchronously — use `@future(callout=true)` or Queueable with `Database.AllowsCallouts`

`HttpRequest` in a synchronous trigger context throws `System.CalloutException: Callout from triggers are currently not supported`. This is the most common integration mistake in trigger-heavy orgs. The platform prohibits synchronous callouts in triggers because the trigger executes inside a database transaction, and holding that transaction open while waiting on an external HTTP response creates deadlock risk and unpredictable transaction duration.

Callouts must be moved to one of three async patterns:

- **`@future(callout=true)`**: simplest, no chaining, no return value, 50-call limit per transaction, cannot be called from another `@future`.
- **Queueable implementing `Database.AllowsCallouts`**: supports callouts, can chain Queueables, can pass complex state, preferred for most scenarios.
- **Batch Apex implementing `Database.AllowsCallouts`**: appropriate when the callout volume corresponds to bulk record processing.

```apex
// Trigger: enqueue callout work
trigger AccountTrigger on Account (after insert) {
    Set<Id> ids = Trigger.newMap.keySet();
    System.enqueueJob(new AccountSyncQueueable(ids));
}

// Queueable: perform callout
public class AccountSyncQueueable implements Queueable, Database.AllowsCallouts {
    private Set<Id> accountIds;
    public AccountSyncQueueable(Set<Id> ids) { this.accountIds = ids; }

    public void execute(QueueableContext ctx) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:MyExternalSystem/accounts/sync');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(accountIds));
        Http http = new Http();
        HttpResponse res = http.send(req);
        if (res.getStatusCode() != 200) {
            // log or re-enqueue
        }
    }
}
```

### 3. Named Credentials must be used for all external callout endpoints — hardcoded URLs fail across environments and create credential exposure risk

Named Credentials abstract both the endpoint URL and the authentication scheme. In Apex, reference them as `callout:NamedCredentialName/path`. The `/path` portion is appended to the base URL configured in the Named Credential record.

Without Named Credentials:
- Sandbox and production use different endpoint URLs, requiring custom settings or environment-specific code branches.
- Credentials (tokens, passwords) embedded in code or custom settings violate SOC2 and most data security policies.
- Rotating credentials requires a code deployment rather than a configuration change.

As of API version 57.0, the preferred approach is **External Credentials** (Authentication Protocol, Principal Type) referenced by a Named Credential. This separates the endpoint (Named Credential) from the auth scheme (External Credential) and allows per-user OAuth flows or org-wide credentials without code changes.

```apex
// Correct: Named Credential reference
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:PaymentGateway/v2/transactions');
req.setMethod('GET');

// Wrong: hardcoded URL
// req.setEndpoint('https://api.paymentgateway.com/v2/transactions');
```

### 4. The `@RestResource` URL mapping must start with `/` and uses `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`, `@HttpDelete` annotations — only one method per HTTP verb per class

Apex REST endpoint classes annotated with `@RestResource(urlMapping='/myEndpoint/*')` expose a custom REST API under `/services/apexrest/`. Each HTTP verb can have exactly one handler method per class. Attempting to define two `@HttpGet` methods in the same class causes a compile error.

The `RestContext.request` and `RestContext.response` objects are injected globally. URL parameters captured by the `*` wildcard are extracted via `RestContext.request.requestURI` string parsing. Query parameters are available in `RestContext.request.params` (a `Map<String, String>`).

Return type determines the response body serialization: returning a primitive or Apex object serializes to JSON automatically. Set `RestContext.response.statusCode` to control the HTTP status code explicitly; it defaults to 200.

```apex
@RestResource(urlMapping='/cases/*')
global class CaseRestResource {

    @HttpGet
    global static Case getCaseById() {
        RestRequest req = RestContext.request;
        String caseId = req.requestURI.substringAfterLast('/');
        return [SELECT Id, Subject, Status FROM Case WHERE Id = :caseId LIMIT 1];
    }

    @HttpPost
    global static Id createCase(String subject, String description) {
        Case c = new Case(Subject = subject, Description = description);
        insert c;
        RestContext.response.statusCode = 201;
        return c.Id;
    }

    @HttpPatch
    global static void updateCaseStatus(String status) {
        RestRequest req = RestContext.request;
        String caseId = req.requestURI.substringAfterLast('/');
        Case c = new Case(Id = caseId, Status = status);
        update c;
        RestContext.response.statusCode = 204;
    }
}
```

### 5. Salesforce API version must be specified in the URL — using an old API version with new objects or fields returns `INVALID_FIELD` or omits new fields silently

Every Salesforce API call specifies a version: `/services/data/v60.0/sobjects/Account`. Objects and fields introduced after the specified version are invisible to that call. This fails in two distinct ways:

- **Attempting to access a field introduced after the pinned version**: returns `INVALID_FIELD: No such column 'NewField__c' on entity 'Account'` — at least this is visible.
- **Reading a record where new fields exist but were added after the pinned version**: the field is simply absent from the response with no error — this is the silent failure mode.

Integration clients that are never updated (pinned to v32.0 or v38.0) silently fail to read or write new fields without any error. Establish an API version update cadence in your integration governance process. Salesforce supports the last three major releases; older versions may stop being supported without per-client notification.

### 6. Platform Events are the correct pattern for fire-and-forget outbound integration from triggers — not `@future` callouts

When a trigger needs to notify an external system, the architecturally correct approach is:
1. Publish a Platform Event in the trigger (synchronous, transactional, no callout limit concern).
2. Subscribe with an external system via CometD or Pub/Sub API (gRPC-based, recommended for new consumers).

`@future(callout=true)` from triggers is limited: no return value, no chaining, no retry, 50-call limit per transaction, and failures are invisible unless explicitly caught and logged. Platform Events have 72-hour replay window and at-least-once delivery guarantees to CometD subscribers. They decouple the trigger transaction from the external callout entirely.

```apex
// Trigger: publish event (no callout, no future limit)
trigger AccountTrigger on Account (after insert, after update) {
    List<Account_Sync_Event__e> events = new List<Account_Sync_Event__e>();
    for (Account a : Trigger.new) {
        events.add(new Account_Sync_Event__e(
            Account_Id__c = a.Id,
            Account_Name__c = a.Name,
            Operation__c = Trigger.isInsert ? 'INSERT' : 'UPDATE'
        ));
    }
    List<Database.SaveResult> results = EventBus.publish(events);
    // inspect results for publish errors if needed
}
```

The external system subscribes to `/event/Account_Sync_Event__e` via CometD or Pub/Sub API and makes the downstream API call outside the Salesforce transaction.

### 7. External Objects via Salesforce Connect are read-only in standard OData 2.0 adapter — write-back requires OData 4.0 or custom adapter

`ExternalDataSource` with OData 2.0 protocol creates External Objects that are queryable via SOQL and appear in standard list views, related lists, and reports — but are read-only. Attempting to insert, update, or delete records on an OData 2.0 External Object returns `EXTERNAL_OBJECT_UNSUPPORTED_EXCEPTION`.

OData 4.0 adapter (available in Enterprise Edition and above) supports write operations. Custom Apex adapters (implementing `DataSource.Provider` and `DataSource.Connection`) support full CRUD and custom query translation.

Do not design a bidirectional sync architecture using standard OData 2.0 External Objects for writes. If write-back to the external system is required from Salesforce, use an Apex callout pattern instead of External Objects.

### 8. `Http.send()` has a 10-second response timeout that is not configurable in Apex

Every `Http.send(request)` call has a fixed 10-second timeout. There is no `setTimeout()` method on `HttpRequest` in standard Apex. If the external service does not respond within 10 seconds, `System.CalloutException: Read timed out` is thrown.

Architecture requiring longer timeouts must use one of:
- **Continuation API**: available only in Aura/LWC server-side controllers; allows up to 60 seconds for a single long-poll response.
- **Async pattern**: Salesforce calls the external system to initiate processing, external system calls back via `@RestResource` when complete (webhook/callback pattern).
- **Platform Event + external poller**: Salesforce fires an event, external system processes and calls back.

```apex
// The 10s timeout is platform-enforced — this does NOT work:
// req.setTimeout(30000); // No such method

// Correct: design for the 10s limit
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:FastService/ping');
req.setMethod('POST');
req.setBody(payload);
try {
    HttpResponse res = new Http().send(req);
} catch (System.CalloutException e) {
    if (e.getMessage().contains('Read timed out')) {
        // handle timeout: log, retry via Queueable, fire event
    }
}
```

### 9. SObject Tree API can create up to 200 records with parent-child relationships in one call — but all records must share the same root object type

`/services/data/vXX.0/composite/tree/Account` creates an Account with up to 200 related records (Contacts, Opportunities nested under the Account) in one call using the `records` array with `attributes.type` and nested `records` collections. All records in the tree hang off one root SObject type — you cannot have two different top-level SObject types in a single tree call.

This is more efficient than separate Composite subrequests for parent-child insertion because it uses a single HTTP call and a single transaction, and the API handles the reference resolution automatically without `referenceId` syntax.

```json
{
  "records": [
    {
      "attributes": { "type": "Account", "referenceId": "Acme" },
      "Name": "Acme Corp",
      "Contacts": {
        "records": [
          {
            "attributes": { "type": "Contact", "referenceId": "AcmeContact1" },
            "LastName": "Smith",
            "Email": "smith@acme.com"
          }
        ]
      }
    }
  ]
}
```

### 10. Integration users should have a dedicated profile with API-only access and no UI login — never use a named user's credentials for integration

Using a named user's credentials for integration means that user's password change, MFA enforcement, deactivation, or Freeze action breaks all integrations silently — often at the worst possible time (the user leaves the company, is locked out, or resets their password).

Integration users should be configured with:
- **`API Only` session security level** on their profile (prevents UI login, all sessions must be API-initiated).
- **No access to standard tabs** (only the SObjects required for the integration).
- **No password expiration** if the user is IP-restricted (combine with Login IP Ranges on the profile).
- **Dedicated Permission Set** granting only the exact object/field permissions the integration requires.
- **EventLogFile monitoring** for anomalous API usage patterns.

Never share integration user credentials between multiple integrations. One integration user per integration system allows independent credential rotation and access revocation.

### 11. Idempotency keys (external ID upsert) are the correct pattern for retry-safe integration — POST + retry without external ID creates duplicates

Retryable integrations should always use upsert with an external ID field as the idempotency key. The upsert endpoint:

`PATCH /services/data/vXX.0/sobjects/Account/ExternalId__c/EXT-001`

If a record with `ExternalId__c = 'EXT-001'` exists, it is updated. If not, it is inserted. Re-sending the same payload on network timeout updates rather than inserting a duplicate.

Plain `POST` (insert) with retry creates duplicates on network timeout because the original request may have succeeded but the HTTP response was not received by the client.

```apex
// Idempotent upsert: safe to retry
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:SalesforceTarget/services/data/v60.0/sobjects/Account/External_Id__c/' + externalId);
req.setMethod('PATCH');
req.setHeader('Content-Type', 'application/json');
req.setBody('{"Name":"Acme Corp","Industry":"Technology"}');
HttpResponse res = new Http().send(req);
// 200 = updated, 201 = inserted — both are success
if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
    // success — safe to retry this exact call
}
```

### 12. SOAP API responses are XML — parsing them in Apex requires `DOM.Document` or generated WSDL stubs

SOAP API is still used for some Salesforce features (Metadata API, Tooling API, legacy SFDC integrations). Parsing SOAP XML in Apex requires either `DOM.Document.getElementsByTagName()` or using the WSDL2Apex tool to generate Apex stub classes from the WSDL.

Attempting to parse SOAP XML as JSON (`JSON.deserialize(res.getBody(), ...)`) fails silently or throws an exception because the response is XML, not JSON.

For new integrations, always prefer REST API over SOAP API. REST returns JSON (or XML if requested), has simpler authentication, and is easier to parse in Apex. SOAP API is legacy — use it only when the target system provides only a WSDL-described service.

```apex
// DOM parsing for SOAP response
Dom.Document doc = new Dom.Document();
doc.load(res.getBody());
Dom.XmlNode root = doc.getRootElement();
Dom.XmlNode body = root.getChildElement('Body', 'http://schemas.xmlsoap.org/soap/envelope/');
// navigate to desired elements
```

### 13. Composite API `referenceId` allows results of earlier subrequests to be used as input to later ones — uses `@{referenceId.field}` syntax

In a Composite request, the `referenceId` property on each subrequest defines a named handle for that subrequest's response. Later subrequests reference earlier results using `@{ReferenceId.field}` syntax in URL path segments or request body fields. This enables insert-then-relate patterns in one HTTP call:

```json
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST",
      "url": "/services/data/v60.0/sobjects/Account",
      "referenceId": "NewAccount",
      "body": { "Name": "Acme Corp", "Industry": "Technology" }
    },
    {
      "method": "POST",
      "url": "/services/data/v60.0/sobjects/Contact",
      "referenceId": "NewContact",
      "body": {
        "LastName": "Smith",
        "FirstName": "John",
        "AccountId": "@{NewAccount.id}"
      }
    },
    {
      "method": "GET",
      "url": "/services/data/v60.0/sobjects/Contact/@{NewContact.id}",
      "referenceId": "ReadNewContact"
    }
  ]
}
```

`referenceId` values must be unique within the request. The `@{...}` substitution works in URL path segments and request body field values. It does not work in header values or in `allOrNone`/`compositeRequest` structural fields.

### 14. Outbound integration callout limits: 100 callouts per transaction, 120 seconds total callout time

A single Apex transaction (synchronous or asynchronous) is limited to:
- **100 HTTP callout calls** (`Limits.getCallouts()` / `Limits.getLimitCallouts()`).
- **120 seconds total cumulative callout time** across all callouts in the transaction.

Bulk operations that call an external API per record quickly exhaust these limits. A batch job processing 200 records that makes one callout per record will fail at record 101 with `System.LimitException: Too many callouts: 101`.

Always batch external calls: collect IDs/payloads across all records in the transaction, then make one or a few batch API calls to the external system. Design external APIs to accept arrays of records rather than single records for Salesforce-initiated integrations.

```apex
// Wrong: one callout per record
for (Account a : accounts) {
    callExternalSystem(a.Id); // throws LimitException after 100
}

// Correct: batch all records into one or a few calls
List<Map<String, Object>> payloads = new List<Map<String, Object>>();
for (Account a : accounts) {
    payloads.add(new Map<String, Object>{ 'id' => a.Id, 'name' => a.Name });
}
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:ExternalSystem/accounts/batch');
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setBody(JSON.serialize(payloads));
HttpResponse res = new Http().send(req); // one callout for all records
```

---

## Routing Table

| Reference | Topics Covered |
|-----------|---------------|
| [01-architecture.md](references/01-architecture.md) | Integration pattern taxonomy, API family comparison, callout limits, architecture decision tree |
| [02-rest-and-composite.md](references/02-rest-and-composite.md) | REST CRUD, Composite API, SObject Tree, Batch REST, response codes, error structure |
| [03-apex-callouts-and-rest.md](references/03-apex-callouts-and-rest.md) | HttpRequest/Response, Named Credentials, @RestResource, SOAP stubs, error handling |
| [04-platform-events-and-cdc-integration.md](references/04-platform-events-and-cdc-integration.md) | Platform Events, Pub/Sub API, CDC, External Objects, OData, event semantics |
| [05-integration-governance.md](references/05-integration-governance.md) | Integration users, Named Credential management, API lifecycle, idempotency, rate limits, monitoring |

---

## Workflows

### Workflow 1: Build a trigger-to-external-system integration using Platform Events

Build a decoupled outbound integration where an Account trigger publishes a Platform Event and a Queueable subscriber makes the external callout.

**Step 1**: Create a Platform Event (`Account_Sync_Event__e`) with fields:
- `Account_Id__c` (Text, External ID)
- `Account_Name__c` (Text)
- `Operation__c` (Text: INSERT/UPDATE/DELETE)

**Step 2**: Publish events from the trigger:

```apex
trigger AccountTrigger on Account (after insert, after update) {
    List<Account_Sync_Event__e> events = new List<Account_Sync_Event__e>();
    for (Account a : Trigger.new) {
        events.add(new Account_Sync_Event__e(
            Account_Id__c = a.Id,
            Account_Name__c = a.Name,
            Operation__c = Trigger.isInsert ? 'INSERT' : 'UPDATE'
        ));
    }
    EventBus.publish(events);
}
```

**Step 3**: Create a Trigger on the Platform Event that enqueues the callout Queueable:

```apex
trigger AccountSyncEventTrigger on Account_Sync_Event__e (after insert) {
    List<Account_Sync_Event__e> events = Trigger.new;
    System.enqueueJob(new AccountSyncCalloutQueueable(events));
}
```

**Step 4**: Implement the Queueable:

```apex
public class AccountSyncCalloutQueueable implements Queueable, Database.AllowsCallouts {
    private List<Account_Sync_Event__e> events;

    public AccountSyncCalloutQueueable(List<Account_Sync_Event__e> events) {
        this.events = events;
    }

    public void execute(QueueableContext ctx) {
        List<Map<String, Object>> payloads = new List<Map<String, Object>>();
        for (Account_Sync_Event__e evt : events) {
            payloads.add(new Map<String, Object>{
                'accountId' => evt.Account_Id__c,
                'name'      => evt.Account_Name__c,
                'operation' => evt.Operation__c
            });
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ExternalCRM/accounts/sync');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payloads));
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            System.debug('Sync failed: ' + res.getStatusCode() + ' ' + res.getBody());
        }
    }
}
```

### Workflow 2: Implement an idempotent upsert via REST API with external ID

Use an external system identifier as the idempotency key to make retries safe.

**Step 1**: Create an External ID field on the target object:
- Object: `Account`
- Field: `External_CRM_Id__c` (Text, External ID, Unique)

**Step 2**: Perform upsert from the external system:

```http
PATCH /services/data/v60.0/sobjects/Account/External_CRM_Id__c/CRM-000123
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "Name": "Acme Corp",
  "Industry": "Technology",
  "BillingCity": "San Francisco"
}
```

Response codes:
- `201 Created` with `{"id":"001...","success":true}` — record was inserted.
- `204 No Content` — record was updated (no body returned).

**Step 3**: Implement retry logic that always uses PATCH, never POST:

```apex
public static void upsertAccountToSalesforce(String externalId, Map<String, Object> fields) {
    Integer maxRetries = 3;
    Integer attempt = 0;
    Boolean success = false;

    while (attempt < maxRetries && !success) {
        attempt++;
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint(
                'callout:SalesforceTarget/services/data/v60.0/sobjects/Account/External_CRM_Id__c/'
                + externalId
            );
            req.setMethod('PATCH');
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(fields));
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201 || res.getStatusCode() == 204) {
                success = true;
            }
        } catch (System.CalloutException e) {
            if (attempt == maxRetries) throw e;
        }
    }
}
```

### Workflow 3: Create an Apex REST endpoint with input validation and error response

Create a REST endpoint that accepts case creation requests from an external system with proper validation and structured error responses.

```apex
@RestResource(urlMapping='/v1/cases/*')
global class CaseIntegrationEndpoint {

    public class CaseRequest {
        public String subject;
        public String description;
        public String priority;
        public String externalReferenceId;
    }

    public class ApiResponse {
        public Boolean success;
        public String caseId;
        public String externalReferenceId;
        public String errorCode;
        public String errorMessage;
    }

    @HttpPost
    global static ApiResponse createCase(CaseRequest caseRequest) {
        ApiResponse response = new ApiResponse();

        // Input validation
        if (caseRequest == null) {
            RestContext.response.statusCode = 400;
            response.success = false;
            response.errorCode = 'MISSING_REQUEST_BODY';
            response.errorMessage = 'Request body is required.';
            return response;
        }
        if (String.isBlank(caseRequest.subject)) {
            RestContext.response.statusCode = 400;
            response.success = false;
            response.errorCode = 'MISSING_REQUIRED_FIELD';
            response.errorMessage = 'Field "subject" is required.';
            return response;
        }
        if (!new Set<String>{'Low','Medium','High'}.contains(caseRequest.priority)) {
            RestContext.response.statusCode = 400;
            response.success = false;
            response.errorCode = 'INVALID_FIELD_VALUE';
            response.errorMessage = 'Field "priority" must be Low, Medium, or High.';
            return response;
        }

        // Idempotency: check for existing case by external reference ID
        if (String.isNotBlank(caseRequest.externalReferenceId)) {
            List<Case> existing = [
                SELECT Id FROM Case
                WHERE External_Reference_Id__c = :caseRequest.externalReferenceId
                LIMIT 1
            ];
            if (!existing.isEmpty()) {
                RestContext.response.statusCode = 200;
                response.success = true;
                response.caseId = existing[0].Id;
                response.externalReferenceId = caseRequest.externalReferenceId;
                return response; // idempotent — return existing record
            }
        }

        try {
            Case c = new Case(
                Subject = caseRequest.subject,
                Description = caseRequest.description,
                Priority = caseRequest.priority,
                External_Reference_Id__c = caseRequest.externalReferenceId
            );
            insert c;
            RestContext.response.statusCode = 201;
            response.success = true;
            response.caseId = c.Id;
            response.externalReferenceId = caseRequest.externalReferenceId;
        } catch (DmlException e) {
            RestContext.response.statusCode = 422;
            response.success = false;
            response.errorCode = 'DML_ERROR';
            response.errorMessage = e.getDmlMessage(0);
        }

        return response;
    }
}
```

---

## Boundaries

This skill does NOT cover:

- **MuleSoft Anypoint platform configuration** (Mule runtime, DataWeave, Anypoint Studio, Anypoint Exchange) — those are MuleSoft-side concerns outside Salesforce Platform configuration.
- **Streaming API UI subscriptions** (EMP Connector, LWC `empApi` wire adapter) — those are frontend/LWC concerns.
- **OAuth flow and connected app setup** — use `platform-security-and-sharing`.
- **Bulk API for data migration** — use `platform-bulk-data-processing`.
