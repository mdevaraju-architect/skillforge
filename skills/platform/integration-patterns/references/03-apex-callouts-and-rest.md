# Apex Callouts and Apex REST

## `HttpRequest` Fields and Methods

`HttpRequest` represents an outbound HTTP request in Apex. Construct one, configure it, then send it via `Http.send()`.

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:MyNamedCred/api/v1/resource');
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setHeader('Accept', 'application/json');
req.setHeader('X-Correlation-Id', correlationId);
req.setBody('{"key":"value"}');
req.setBodyAsBlob(blobData);        // alternative for binary payloads
req.setCompressed(true);            // gzip the request body
```

**Methods**:

| Method | Description |
|--------|-------------|
| `setEndpoint(String)` | Full URL or `callout:NamedCredName/path` |
| `setMethod(String)` | `'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'`, `'HEAD'` |
| `setHeader(String name, String value)` | Set a single HTTP header |
| `setBody(String)` | String request body (UTF-8) |
| `setBodyAsBlob(Blob)` | Binary request body |
| `setCompressed(Boolean)` | If `true`, sends `Content-Encoding: gzip` and compresses body |

**What does NOT exist on `HttpRequest`**:
- `setTimeout(Integer)` — there is no configurable timeout method. The platform enforces a fixed 10-second response timeout per callout.

---

## `Http.send()` and `HttpResponse` Fields

```apex
Http http = new Http();
HttpResponse res = http.send(req);

Integer statusCode = res.getStatusCode();       // e.g., 200, 201, 400
String statusMessage = res.getStatus();         // e.g., 'OK', 'Created', 'Bad Request'
String body = res.getBody();                    // response body as String
Blob bodyBlob = res.getBodyAsBlob();            // response body as Blob (binary)
String headerValue = res.getHeader('Content-Type'); // single header value
```

**Key behaviors**:
- `Http.send()` is synchronous — execution blocks until the response arrives or the 10-second timeout fires.
- If the endpoint is unreachable or times out, `System.CalloutException` is thrown.
- `getBody()` returns `null` for `204 No Content` responses — do not attempt to parse it.
- Do not call `getBody()` after `getBodyAsBlob()` on the same response — unpredictable behavior.

---

## Named Credential Callout Syntax

Named Credentials are configured in Setup > Named Credentials. They store the endpoint URL and authentication scheme.

In Apex, reference a Named Credential with `callout:` prefix:

```apex
req.setEndpoint('callout:PaymentGateway/v2/charge');
```

The Named Credential `PaymentGateway` has a base URL (e.g., `https://api.payments.example.com`). The `/v2/charge` portion is appended at callout time. The final URL becomes `https://api.payments.example.com/v2/charge`.

**External Credentials (API 57.0+)**

The modern pattern separates endpoint from authentication:
- **External Credential**: defines authentication protocol (OAuth 2.0 Client Credentials, JWT Bearer, Named Principal, Per User, etc.).
- **Named Credential**: references an External Credential and defines the base URL.
- **Principal**: the credential store entry (client ID + secret, or username + password).

```apex
// Same callout syntax regardless of underlying auth scheme
req.setEndpoint('callout:NewStyleNamedCred/api/resource');
```

**Passing additional headers alongside Named Credential auth**:

Named Credentials automatically inject the `Authorization` header. You can add additional custom headers:

```apex
req.setEndpoint('callout:MyService/data');
req.setHeader('X-Tenant-Id', tenantId);   // additional headers are allowed
```

Do not manually set `Authorization` when using Named Credentials — the platform sets it from the credential store. Setting it manually overrides the Named Credential auth.

---

## Callout from Trigger Workaround Patterns

Direct callouts from triggers are prohibited. Use these patterns instead:

### Pattern 1: Queueable with `Database.AllowsCallouts` (Recommended)

```apex
trigger OpportunityTrigger on Opportunity (after insert, after update) {
    if (Trigger.isInsert || Trigger.isUpdate) {
        List<Id> ids = new List<Id>(Trigger.newMap.keySet());
        // Check Limits before enqueuing
        if (Limits.getQueueableJobs() < Limits.getLimitQueueableJobs()) {
            System.enqueueJob(new OpportunitySyncQueueable(ids));
        }
    }
}

public class OpportunitySyncQueueable implements Queueable, Database.AllowsCallouts {
    private List<Id> oppIds;

    public OpportunitySyncQueueable(List<Id> ids) {
        this.oppIds = ids;
    }

    public void execute(QueueableContext ctx) {
        List<Opportunity> opps = [
            SELECT Id, Name, Amount, StageName, AccountId
            FROM Opportunity
            WHERE Id IN :oppIds
        ];
        String payload = JSON.serialize(opps);
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:CRMSync/opportunities');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(payload);
        try {
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
                // Log failure — insert an Integration_Error__c record
                logError('OpportunitySyncQueueable', res.getStatusCode(), res.getBody());
            }
        } catch (System.CalloutException e) {
            logError('OpportunitySyncQueueable', 0, e.getMessage());
        }
    }

    private static void logError(String context, Integer statusCode, String message) {
        Integration_Error__c err = new Integration_Error__c(
            Context__c = context,
            Status_Code__c = statusCode,
            Message__c = message.left(32768)
        );
        insert err;
    }
}
```

### Pattern 2: `@future(callout=true)` (Simple Cases)

```apex
trigger LeadTrigger on Lead (after insert) {
    Set<Id> ids = Trigger.newMap.keySet();
    LeadCalloutService.notifyExternalSystem(ids);
}

public class LeadCalloutService {
    @future(callout=true)
    public static void notifyExternalSystem(Set<Id> leadIds) {
        // callout logic here
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:LeadService/inbound');
        req.setMethod('POST');
        req.setBody(JSON.serialize(leadIds));
        new Http().send(req);
    }
}
```

**Limitations of `@future`**:
- Cannot be called from a Queueable, another `@future`, or Batch `finish`.
- No return value — fire-and-forget only.
- 50-call limit per transaction.
- Cannot pass sObjects as parameters — only primitives and collections of primitives.
- Use Queueable for anything beyond a simple notification.

### Pattern 3: Platform Events (Best for Decoupled Architecture)

When the trigger does not need to wait for the external system's response and the integration can tolerate async delivery:

```apex
trigger ContactTrigger on Contact (after insert) {
    List<Contact_Created_Event__e> events = new List<Contact_Created_Event__e>();
    for (Contact c : Trigger.new) {
        events.add(new Contact_Created_Event__e(
            Contact_Id__c = c.Id,
            Email__c = c.Email,
            Account_Id__c = c.AccountId
        ));
    }
    EventBus.publish(events);
    // External system subscribes to /event/Contact_Created_Event__e via CometD or Pub/Sub API
}
```

---

## `@RestResource` Annotation

### Class-Level Annotation

```apex
@RestResource(urlMapping='/v1/resource/*')
global class MyRestEndpoint {
    // ...
}
```

- `urlMapping` must start with `/`.
- `*` is a wildcard that matches any path segment. Access via `RestContext.request.requestURI`.
- The full endpoint URL is `/services/apexrest/{urlMapping}`.
- The class must be `global` (not `public`).

### HTTP Verb Annotations

Each annotation must appear on exactly one `global static` method per class:

```apex
@HttpGet
global static MyResponseType getResource() { ... }

@HttpPost
global static MyResponseType createResource(MyRequestType request) { ... }

@HttpPut
global static void replaceResource(MyRequestType request) { ... }

@HttpPatch
global static void updateResource(MyRequestType request) { ... }

@HttpDelete
global static void deleteResource() { ... }
```

**Method signature rules**:
- Must be `global static`.
- Parameters are deserialized from the JSON request body automatically if typed. Use a wrapper class for complex bodies.
- Return value is serialized to JSON automatically. Return `void` and write to `RestContext.response` directly for full control.

### `RestContext.request` Methods

```apex
RestRequest req = RestContext.request;

String uri = req.requestURI;               // full URI including path after /apexrest/
String method = req.httpMethod;            // 'GET', 'POST', etc.
String body = req.requestBody.toString();  // raw request body as String
Blob bodyBlob = req.requestBody;           // raw request body as Blob
Map<String, String> params = req.params;   // query parameters (?key=value)
Map<String, String> headers = req.headers; // request headers
```

**Extracting path parameters from wildcard URL**:

```apex
// urlMapping = '/cases/*'
// Request: GET /services/apexrest/v1/cases/500xx000003GYn1
String caseId = req.requestURI.substringAfterLast('/');
```

### `RestContext.response` Methods

```apex
RestResponse res = RestContext.response;

res.statusCode = 201;                            // set HTTP status code (default: 200)
res.addHeader('Location', '/services/apexrest/v1/cases/' + c.Id);
res.responseBody = Blob.valueOf(JSON.serialize(responseObject));
```

### Error Response Pattern

```apex
@HttpPost
global static CaseResponse createCase(CaseRequest req) {
    if (req == null || String.isBlank(req.subject)) {
        RestContext.response.statusCode = 400;
        return new CaseResponse(false, null, 'MISSING_REQUIRED_FIELD', 'subject is required');
    }
    try {
        Case c = new Case(Subject = req.subject);
        insert c;
        RestContext.response.statusCode = 201;
        return new CaseResponse(true, c.Id, null, null);
    } catch (DmlException e) {
        RestContext.response.statusCode = 422;
        return new CaseResponse(false, null, 'DML_ERROR', e.getDmlMessage(0));
    } catch (Exception e) {
        RestContext.response.statusCode = 500;
        return new CaseResponse(false, null, 'INTERNAL_ERROR', e.getMessage());
    }
}
```

---

## Apex SOAP (WSDL2Apex)

### Generating a WSDL Stub

1. Obtain the WSDL file from the external SOAP service.
2. In Setup > Apex Classes > Generate from WSDL.
3. Salesforce generates Apex stub classes (typically one class per WSDL service + one for complex types).
4. Deploy the generated classes.

Generated stubs include typed request/response objects:

```apex
ExternalSoapService.ServiceSoap svc = new ExternalSoapService.ServiceSoap();
svc.endpoint_x = 'callout:ExternalSoapService';  // override endpoint to use Named Credential
ExternalSoapService.GetOrderResponse_element resp = svc.GetOrder('ORD-001');
String status = resp.GetOrderResult.Status;
```

### Apex SOAP Callout Constraints

- The generated stub class makes an HTTP callout internally — all callout limits apply.
- Cannot be used in synchronous triggers for the same reason as `HttpRequest`.
- `timeout_x` property on the stub class sets a timeout hint, but the platform still enforces the 10-second hard limit.

---

## Error Handling Patterns

### Catch and Classify

```apex
try {
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
        // Success
        handleSuccess(res.getBody());
    } else if (res.getStatusCode() == 401 || res.getStatusCode() == 403) {
        // Auth error — do not retry; alert operations
        throw new IntegrationException('AUTH_ERROR', res.getStatusCode(), res.getBody());
    } else if (res.getStatusCode() == 429 || res.getStatusCode() == 503) {
        // Rate limited or service unavailable — retry with backoff
        scheduleRetry(req, 1);
    } else if (res.getStatusCode() >= 400 && res.getStatusCode() < 500) {
        // Client error — do not retry; log and alert
        throw new IntegrationException('CLIENT_ERROR', res.getStatusCode(), res.getBody());
    } else if (res.getStatusCode() >= 500) {
        // Server error — retry
        scheduleRetry(req, 1);
    }

} catch (System.CalloutException e) {
    if (e.getMessage().contains('Read timed out')) {
        // Network timeout — retry with backoff
        scheduleRetry(req, 1);
    } else if (e.getMessage().contains('Unknown host')) {
        // DNS failure — alert, do not retry immediately
        throw new IntegrationException('DNS_ERROR', 0, e.getMessage());
    } else {
        throw e;
    }
}
```

### Retry with Exponential Backoff via Queueable

```apex
public class RetryableCalloutQueueable implements Queueable, Database.AllowsCallouts {
    private String endpoint;
    private String method;
    private String body;
    private Integer attempt;
    private static final Integer MAX_ATTEMPTS = 3;
    private static final Integer[] BACKOFF_SECONDS = new Integer[]{ 0, 30, 120 };

    public RetryableCalloutQueueable(String endpoint, String method, String body, Integer attempt) {
        this.endpoint = endpoint;
        this.method = method;
        this.body = body;
        this.attempt = attempt;
    }

    public void execute(QueueableContext ctx) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod(method);
        req.setHeader('Content-Type', 'application/json');
        req.setBody(body);

        try {
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() >= 200 && res.getStatusCode() < 300) {
                return; // success
            }
            if (attempt < MAX_ATTEMPTS && (res.getStatusCode() >= 500 || res.getStatusCode() == 429)) {
                // Retry with delay — use scheduled Apex or re-enqueue
                System.enqueueJob(new RetryableCalloutQueueable(endpoint, method, body, attempt + 1));
            } else {
                logPermanentFailure(endpoint, res.getStatusCode(), res.getBody());
            }
        } catch (System.CalloutException e) {
            if (attempt < MAX_ATTEMPTS) {
                System.enqueueJob(new RetryableCalloutQueueable(endpoint, method, body, attempt + 1));
            } else {
                logPermanentFailure(endpoint, 0, e.getMessage());
            }
        }
    }

    private static void logPermanentFailure(String endpoint, Integer code, String msg) {
        Integration_Error__c err = new Integration_Error__c(
            Endpoint__c = endpoint,
            Status_Code__c = code,
            Message__c = msg.left(32768),
            Permanent__c = true
        );
        insert err;
    }
}
```

### Checking Callout Limits Before Sending

```apex
if (Limits.getCallouts() >= Limits.getLimitCallouts()) {
    throw new IntegrationException('CALLOUT_LIMIT_REACHED',
        'Cannot make callout: limit of ' + Limits.getLimitCallouts() + ' reached');
}
HttpResponse res = new Http().send(req);
```
