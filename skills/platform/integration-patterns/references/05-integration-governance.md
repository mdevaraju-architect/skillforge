# Integration Governance

## Integration User Setup

### Why Not Use a Named User

Using a named employee's Salesforce account as the integration credential creates operational risk:
- Password reset by the user breaks all integrations immediately and silently.
- MFA enforcement applied to the user (e.g., by org security policy) blocks API access.
- User deactivation (offboarding) cuts off all integrations.
- Freeze action (e.g., security incident) cuts off all integrations.
- User's profile permissions change over time as their role changes, potentially over-permissioning or under-permissioning the integration.

### Integration User Configuration Checklist

1. **Create a dedicated user** for each integration system (not shared between systems).
   - Username convention: `integration-systemname@company.org`
   - User Type: Salesforce (not Partner or Customer Community)

2. **Assign an API-only profile**:
   - Session Security Level: `API Only` — prevents browser UI login; requires API-initiated sessions.
   - No tab visibility for standard apps.
   - Login Hours: 24/7 (API integrations are not constrained to business hours).

3. **Restrict by IP address** (Login IP Ranges on profile):
   - Lock the integration user to the known IP range of the integration server or MuleSoft runtime.
   - Combined with `API Only` session setting, this prevents misuse of the credential.

4. **Disable password expiration**:
   - Profile setting: uncheck `Password Never Expires` enforcement — or set Password Policy to `Never Expires` for API-only profiles.
   - Mandatory password rotation is incompatible with headless integrations. Use IP restriction as the compensating control.

5. **Create a dedicated Permission Set** for the integration:
   - Grant only the objects and fields required (principle of least privilege).
   - Do not use a shared profile for permission assignment — Permission Sets are easier to audit.
   - Example objects/permissions for a read-only sync integration: `Account` (Read), `Contact` (Read), `Custom_Object__c` (Read).

6. **Never store credentials in code or org metadata**:
   - Use Named Credentials (with External Credentials for OAuth flows).
   - For username+password flows, use Named Credentials with `Password Authentication` protocol.
   - For JWT Bearer or Connected App OAuth, configure via External Credential.

### Integration User Monitoring

Query `EventLogFile` for API usage:

```soql
SELECT Id, EventType, LogDate, LogFile
FROM EventLogFile
WHERE EventType = 'API'
AND LogDate = TODAY
```

Key fields in the API event log CSV:
- `USER_ID`: the integration user ID.
- `METHOD_NAME`: Apex method or API resource.
- `STATUS_CODE`: HTTP status of the API call.
- `ROWS_PROCESSED`: records affected.
- `CLIENT_IP`: source IP of the request (verify against allowed IP ranges).

Set up a Salesforce Shield Event Monitoring alert or a scheduled Apex job to alert operations if the integration user logs in from an unexpected IP or authenticates via the UI.

---

## Named Credential Management

### Named Credentials vs External Credentials (API 57.0+)

| Concept | Purpose | Version |
|---------|---------|---------|
| Named Credential (Legacy) | Stores URL + auth inline | Pre-57.0 |
| External Credential | Stores auth protocol + principal | 57.0+ |
| Named Credential (Modern) | Stores URL + reference to External Credential | 57.0+ |

The modern pattern (API 57.0+) is preferred for all new Named Credentials:

```
External Credential
  ├─ Authentication Protocol: OAuth 2.0 Client Credentials
  ├─ Principal Type: Named Principal (org-wide) or Per User
  └─ Principals:
       └─ "SF_Integration" → Client ID: xxx, Client Secret: (encrypted)

Named Credential
  ├─ Label: Payment Gateway
  ├─ URL: https://api.paymentgateway.com
  └─ External Credential: (points to above)
```

### Rotating Credentials

With External Credentials:
1. Update the client secret on the External Credential Principal record (Setup UI or Tooling API).
2. No code changes, no deployments, no Apex class updates.
3. The Named Credential reference in Apex (`callout:PaymentGateway/...`) is unchanged.

With legacy Named Credentials (inline credentials):
1. Update the Password field directly on the Named Credential.
2. No code change required.
3. Never store passwords in Custom Settings, Custom Metadata, or Apex.

### Metadata API Retrieval of Named Credentials

Named Credential definition (retrieve via Metadata API for version control):

```xml
<NamedCredential>
    <label>Payment Gateway</label>
    <fullName>PaymentGateway</fullName>
    <endpoint>https://api.paymentgateway.com</endpoint>
    <principalType>NamedUser</principalType>
    <protocol>PasswordAuthentication</protocol>
    <!-- Password is not included in retrieved metadata — must be set post-deployment -->
</NamedCredential>
```

**Important**: Named Credential passwords and secrets are never included in Metadata API retrieve responses. Post-deployment, the credential must be manually configured in the target org's Setup UI or via the Tooling API `ExternalCredential` object.

---

## API Version Lifecycle

### Salesforce API Support Policy

Salesforce supports the current release plus the two prior major releases. As of Summer '25 (API 60.0):
- Supported: v60.0, v59.0, v58.0 (approximately).
- Deprecated: versions below the three-release window. Deprecated versions continue to work but receive no new features.
- Retired: versions officially removed. Calls to retired versions return `UNSUPPORTED_API_VERSION` error.

### Checking Available Versions

```http
GET https://{MyDomain}.my.salesforce.com/services/data/
```

Returns:

```json
[
  { "label": "Summer '25", "url": "/services/data/v60.0", "version": "60.0" },
  { "label": "Spring '25", "url": "/services/data/v59.0", "version": "59.0" }
]
```

### Version Update Governance Process

1. **Maintain an API version inventory**: document which version each integration uses.
2. **Test against the new version** in a sandbox before each Salesforce major release (3x per year).
3. **Update integration clients** to the latest supported version once validated in sandbox.
4. **Automate version checks**: query `/services/data/` in a scheduled job and alert if the integration's configured version is no longer in the supported list.

### Silent Failures from Outdated API Versions

The most insidious version-pinning failure is silent omission of new fields:

- Field `Insurance_Policy_Number__c` added in v60.0.
- Integration client pinned to v55.0.
- `GET /services/data/v55.0/sobjects/Account/001xx...` returns the record without `Insurance_Policy_Number__c` — no error.
- Integration stores `null` for the field in the target system.
- Data quality issue discovered months later.

**Prevention**: set up field-level integration tests that verify expected fields are present in API responses after each release.

---

## Idempotency Patterns

### Pattern 1: External ID Upsert (Recommended)

The canonical idempotency pattern for inbound integrations. Every record in the source system has a stable, unique identifier. Use it as a Salesforce External ID field.

```
Source System ID → Salesforce External ID field
PATCH /services/data/v60.0/sobjects/Account/Source_System_Id__c/SS-000123
```

Properties:
- Re-sending the same request with the same external ID always results in the same record state.
- Safe to retry on timeout without duplicates.
- Supports `allOrNone` in Composite API.
- Works with Bulk API 2.0 Upsert job type.

### Pattern 2: Request Correlation ID + Deduplication Check

When the source system does not have a stable identifier per record, generate a correlation ID on the source side and store it on the Salesforce record:

```apex
@HttpPost
global static CaseResponse createCase(CaseRequest req) {
    // Deduplication check
    if (String.isNotBlank(req.correlationId)) {
        List<Case> existing = [
            SELECT Id FROM Case WHERE Correlation_Id__c = :req.correlationId LIMIT 1
        ];
        if (!existing.isEmpty()) {
            return new CaseResponse(true, existing[0].Id); // idempotent return
        }
    }
    Case c = new Case(Subject = req.subject, Correlation_Id__c = req.correlationId);
    insert c;
    return new CaseResponse(true, c.Id);
}
```

Add a Unique constraint on `Correlation_Id__c` to prevent race conditions. If two concurrent identical requests both pass the deduplication check before either commits, the unique constraint on the second insert will throw a `DmlException` with `DUPLICATE_VALUE`. Catch this and return the already-created record.

### Pattern 3: Idempotency in Event Publishing

Platform Events are fire-and-forget. If a trigger publishes the same event twice (e.g., due to trigger re-execution), the subscriber receives two events.

Mitigation:
- Include a deterministic event ID field: `Event_Id__c = MD5(recordId + operation + timestamp truncated to minute)`.
- The consumer deduplicates on this field before processing.

---

## Rate Limiting and API Request Limits

### Org-Level API Request Limits

Salesforce limits the total number of API calls per 24-hour rolling window per org. This limit is based on org edition and user licenses.

| Edition | Approximate Limit (varies by license count) |
|---------|---------------------------------------------|
| Developer Edition | 15,000 calls/24h |
| Professional Edition | 100,000+ calls/24h (base) |
| Enterprise Edition | 1,000,000+ calls/24h (varies) |
| Unlimited Edition | 5,000,000+ calls/24h (varies) |

Check current org limit via REST API:

```http
GET /services/data/v60.0/limits
```

Response includes `DailyApiRequests`:
```json
{
  "DailyApiRequests": {
    "Max": 1000000,
    "Remaining": 987654
  }
}
```

### Conserving API Requests

- Use Composite API (1 call for up to 25 operations) instead of 25 individual calls.
- Use Bulk API 2.0 for large data volumes (much lower API call overhead per record).
- Subscribe to Platform Events or CDC instead of polling SOQL queries repeatedly.
- Cache query results in Platform Cache or Custom Metadata when the data changes infrequently.
- Implement If-Modified-Since / ETag patterns for read-heavy integrations.

### Handling 503 and 429 Responses

- `429 Too Many Requests`: rate limit exceeded. Retry after the interval specified in `Retry-After` header.
- `503 Service Unavailable`: Salesforce is in maintenance or overloaded. Retry with exponential backoff.

Recommended backoff sequence: 30s, 120s, 300s. After 3 attempts, move the message to a dead-letter queue or alert operations.

---

## Error Handling Taxonomy

| Error Category | HTTP Status | Retry? | Action |
|---------------|-------------|--------|--------|
| Network timeout | None (CalloutException) | Yes, with backoff | Log, re-enqueue Queueable |
| DNS failure | None (CalloutException) | No (immediate) | Alert ops, check Named Credential URL |
| Auth error (token expired) | 401 | Yes, after token refresh | Refresh OAuth token, retry once |
| Auth error (insufficient permission) | 403 | No | Alert integration team, check integration user permissions |
| Validation error (Salesforce business rule) | 400 / 422 | No | Log with payload, alert source system |
| Rate limit (Salesforce) | 429 | Yes, after Retry-After | Backoff per Retry-After header |
| Server error (Salesforce) | 500 | Yes, limited | Backoff, max 3 retries |
| Service unavailable | 503 | Yes, with backoff | Check Salesforce Trust status |
| Record locked | 409 | Yes, short delay | Retry after 5-30 seconds |
| External ID ambiguous | 300 | No | Fix duplicate External IDs in Salesforce |
| Record not found | 404 | No | Log as data gap, notify source system |

---

## Monitoring and Observability

### EventLogFile API

EventLogFile records are available 24 hours after the event (standard plan) or near-real-time (Shield Event Monitoring).

Key event types for integration monitoring:

| EventType | What It Captures |
|-----------|-----------------|
| `API` | All REST and SOAP API calls, including endpoint, status code, user |
| `Apex` | Apex execution logs, including callout details |
| `ApexCallout` | Outbound HTTP callout details (Shield Event Monitoring only) |
| `PlatformEventUsage` | Platform Event publish/subscribe metrics |
| `Login` | All login events including integration user logins |

```apex
// Query EventLogFile for API calls by integration user
List<EventLogFile> logs = [
    SELECT Id, EventType, LogDate, LogFile
    FROM EventLogFile
    WHERE EventType = 'API'
    AND LogDate = LAST_N_DAYS:1
];
// Download LogFile (CSV) and parse for STATUS_CODE != 200
```

### Integration Health Dashboard Metrics

Build a monitoring dashboard (in CRM Analytics or an external tool) tracking:
- API call volume per integration user per hour.
- Error rate (4xx and 5xx responses) per integration endpoint.
- Callout response time distribution (from ApexCallout event logs).
- Platform Event lag (`EventBusSubscriber.LastModifiedDate` delta from event timestamp).
- CDC replay gap (consumer's last processed `replayId` vs channel head).

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|---------|
| API error rate | > 1% of calls | > 5% of calls |
| DailyApiRequests remaining | < 20% | < 5% |
| Callout response time p99 | > 5s | > 9s (near timeout) |
| Platform Event consumer lag | > 100 events | > 1,000 events |
| Integration user login from unexpected IP | Any occurrence | Any occurrence |
