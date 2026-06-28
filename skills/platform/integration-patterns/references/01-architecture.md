# Integration Architecture Reference

## Integration Pattern Taxonomy

Salesforce integrations fall into four structural categories based on data direction and coupling:

### Inbound Integration (External System → Salesforce)

External systems push or query data into Salesforce. Salesforce is the system of record receiving data.

| Pattern | Protocol | Use Case |
|---------|----------|----------|
| REST API | HTTPS/JSON | Create, read, update, delete standard and custom objects |
| SOAP API | HTTPS/XML | Legacy integrations, Metadata API, Tooling API |
| Apex REST (`@RestResource`) | HTTPS/JSON | Custom inbound endpoints with business logic |
| Apex SOAP | HTTPS/XML | Expose custom Apex logic as WSDL-described service |
| Bulk API 2.0 | HTTPS/JSON | Mass data load (use `platform-bulk-data-processing`) |

### Outbound Integration (Salesforce → External System)

Salesforce initiates calls to external systems. The external system is the system of record receiving data.

| Pattern | Mechanism | Use Case |
|---------|-----------|----------|
| Apex HTTP callout | `HttpRequest` / Named Credential | Synchronous request-response to REST APIs |
| Apex SOAP callout | WSDL2Apex stub | Call WSDL-described external web services |
| Platform Events (publish) | `EventBus.publish()` | Fire-and-forget trigger to external CometD/Pub/Sub subscriber |
| Change Data Capture | CDC channel subscription | External system subscribes to Salesforce record changes |
| Outbound Messaging | SOAP | Workflow-rule-triggered XML notification (legacy, use Platform Events for new work) |

### Event-Driven Architecture (EDA)

Both Salesforce and external systems produce and consume events without direct coupling.

| Pattern | Channel | Guarantees |
|---------|---------|-----------|
| Platform Events | `/event/EventName__e` | At-least-once delivery, 72-hour replay window |
| Change Data Capture | `/data/ObjectName__ChangeEvent` | At-least-once delivery, 72-hour replay window |
| Pub/Sub API | gRPC bidirectional stream | At-least-once delivery, schema registry (Avro), recommended for new consumers |

### Virtual Data Integration (No Data Copy)

External data appears within Salesforce without being stored there.

| Pattern | Mechanism | Use Case |
|---------|-----------|----------|
| External Objects (Salesforce Connect) | OData 2.0 / OData 4.0 / Custom Apex Adapter | Real-time read (and write with OData 4.0+) of external records |
| Indirect Lookup | External ID on Salesforce object → External Object | Cross-reference Salesforce records with External Object records |

---

## API Family Comparison

| API | Protocol | Data Format | Auth | Best For |
|-----|----------|-------------|------|----------|
| REST API | HTTPS | JSON (XML optional) | OAuth 2.0 / Session ID | Standard CRUD, integrations, mobile |
| SOAP API | HTTPS | XML (SOAP envelope) | OAuth 2.0 / Session ID | Legacy systems, tooling via WSDL |
| Bulk API 2.0 | HTTPS | CSV / JSON | OAuth 2.0 | Large data volumes (50K+ records) |
| Composite API | HTTPS | JSON | OAuth 2.0 | Chaining up to 25 REST calls in one HTTP request |
| SObject Tree API | HTTPS | JSON | OAuth 2.0 | Create parent-child record trees up to 200 records |
| Batch REST API | HTTPS | JSON | OAuth 2.0 | Up to 25 independent requests, no result chaining |
| Streaming API (CometD) | HTTPS/long-poll | JSON | OAuth 2.0 | Subscribe to Platform Events, CDC from external apps |
| Pub/Sub API | gRPC | Avro binary | OAuth 2.0 | High-throughput event subscription, new consumer pattern |
| Metadata API | HTTPS | XML | OAuth 2.0 | Deploy/retrieve org metadata |
| Tooling API | HTTPS | JSON or XML | OAuth 2.0 | IDE tooling, Apex unit test execution |
| Analytics API | HTTPS | JSON | OAuth 2.0 | CRM Analytics query and dataset management |

---

## Callout Limits Summary

These limits apply per Apex transaction (synchronous trigger, `@future`, Queueable, Batch execute method):

| Limit | Value | Governor API |
|-------|-------|-------------|
| Total HTTP callouts per transaction | 100 | `Limits.getCallouts()` / `Limits.getLimitCallouts()` |
| Total cumulative callout time per transaction | 120 seconds | N/A (platform-enforced, no Limits method) |
| Response timeout per individual callout | 10 seconds | Platform-enforced; not configurable in standard Apex |
| `@future(callout=true)` calls per transaction | 50 | `Limits.getFutureCalls()` / `Limits.getLimitFutureCalls()` |
| Queueable jobs enqueued per transaction | 50 | `Limits.getQueueableJobs()` |

**Key implications**:
- One callout per record in a batch of 101+ records will throw `System.LimitException: Too many callouts`.
- Combine multiple record payloads into a single batched callout to the external system.
- If cumulative callout time approaches 120 seconds (e.g., 11 callouts each taking ~10s), the transaction is killed.

---

## Integration Architecture Decision Tree

Use this decision tree to select the correct pattern before writing code.

### Step 1: What is the data direction?

```
External → Salesforce (inbound)?  →  Go to Step 2
Salesforce → External (outbound)? →  Go to Step 3
Bidirectional?                    →  Decompose into separate inbound and outbound patterns
```

### Step 2: Inbound — Does the external system need custom logic on arrival?

```
No custom logic, standard CRUD?
    └─ Use: REST API (standard /sobjects/ endpoints)
    └─ For parent-child creation: SObject Tree API
    └─ For atomic chained operations: Composite API

Custom validation, transformation, or routing logic?
    └─ Use: Apex REST (@RestResource) — custom endpoint with business logic

Legacy system with WSDL contract?
    └─ Use: Apex SOAP (generate WSDL from Apex class)

High volume (50K+ records)?
    └─ Use: Bulk API 2.0 (see platform-bulk-data-processing)
```

### Step 3: Outbound — Is the call synchronous (Salesforce waits for response)?

```
Yes, synchronous request-response:
    └─ Is it from a trigger? → NO: use Http callout directly in Apex
                             → YES: NEVER callout from trigger directly
                                    Use Queueable + Database.AllowsCallouts
                                    OR use @future(callout=true) for simple cases

No, fire-and-forget (Salesforce does not need response):
    └─ Is it triggered by a record change? → Use Platform Events (trigger publishes,
                                             external CometD/Pub/Sub subscribes)
    └─ Does the external system need full record change history? → Use CDC

Does the callout require > 10 seconds response time?
    └─ Use async callback pattern:
       - Salesforce initiates (callout with job ID or correlation ID)
       - External system processes asynchronously
       - External system calls back via @RestResource when done
```

### Step 4: Virtual data — Should Salesforce store the data at all?

```
External data should appear in Salesforce views/reports but stay in external system?
    └─ Read-only access needed?   → Salesforce Connect + OData 2.0 External Objects
    └─ Read-write access needed?  → Salesforce Connect + OData 4.0
                                   OR Custom Apex Adapter (DataSource.Provider)
    └─ Cross-reference needed?    → Indirect Lookup relationship from External Object to
                                    Salesforce object via External ID field
```

### Step 5: Error handling — Is retry safety required?

```
Can the same call be safely retried without side effects?
    └─ Yes: use idempotent upsert (PATCH with external ID) for inbound
    └─ No: implement deduplication logic on receipt (check External Reference ID before insert)

Does the outbound call need retry on failure?
    └─ Re-enqueue Queueable with exponential backoff
    └─ Implement maximum retry counter stored on a custom object or Platform Cache
    └─ Use Platform Events with dead-letter processing for undeliverable events
```
