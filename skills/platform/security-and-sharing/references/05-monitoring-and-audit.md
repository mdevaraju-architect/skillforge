# Monitoring, Audit, and Session Policies

## Event Monitoring

### EventLogFile Object

Event Monitoring provides detailed activity logs via the `EventLogFile` standard object. Each row represents a single log file for a specific event type for a specific day (or hour, depending on the event type and org edition).

```soql
-- List available event log files for the last 7 days
SELECT Id, EventType, LogDate, LogFileLength, LogFileContentType
FROM EventLogFile
WHERE LogDate >= LAST_N_DAYS:7
ORDER BY LogDate DESC, EventType ASC
```

**Required permission:** `ViewEventLogFiles` system permission (assign via Permission Set).

**API access:** `EventLogFile` is available via both the REST API and the SOAP API (Tooling API is NOT required but can also be used).

### Log File Retention

| Org Configuration | Retention Period |
|---|---|
| Standard (no add-on) | 24 hours from log generation |
| Event Monitoring add-on | 30 days |

**24-hour window risk:** Without the add-on, log files are permanently deleted after 24 hours. If compliance requires longer retention (SOC2, PCI-DSS, GDPR often require 90 days to 1 year), you must:
1. Purchase the Event Monitoring add-on, OR
2. Automate export within 24 hours via scheduled Apex, external ETL, or Salesforce's Event Log File Browser

### Common EventType Values

| EventType | What it captures |
|---|---|
| `Login` | All login attempts (success and failure), IP, browser, login type |
| `LoginAs` | Admin "Login As User" operations |
| `Logout` | Session termination events |
| `API` | REST and SOAP API calls (method, URI, response time, status) |
| `Apex` | Apex execution events (class, method, CPU time) |
| `ApexCallout` | Outbound HTTP callouts from Apex (URL, method, response time) |
| `ApexUnexpectedException` | Uncaught Apex exceptions |
| `LightningPageView` | Lightning Experience page views |
| `LightningInteraction` | User interactions in Lightning UI (clicks, form submissions) |
| `Report` | Report runs (report name, run duration, row count) |
| `ReportExport` | Report data exports (CSV, Excel) — high sensitivity |
| `Dashboard` | Dashboard views |
| `ListViewExport` | List view data exports |
| `ContentDocumentLink` | File access and sharing events |
| `BulkApi` | Bulk API job operations |
| `BulkApi2` | Bulk API v2 job operations |
| `Search` | SOSL search queries |
| `AuraRequest` | Lightning component server-side calls |
| `VisualforceRequest` | Visualforce page requests |
| `UriEvent` | General URI access events |

### Downloading and Parsing Log Files

`EventLogFile.LogFile` is a binary CSV blob. To access it:

**Via REST API:**
```
GET /services/data/v62.0/sobjects/EventLogFile/{Id}/LogFile
Accept: text/csv
```

**Via Apex (base64 decode):**
```apex
EventLogFile elf = [
    SELECT Id, EventType, LogDate, LogFile
    FROM EventLogFile
    WHERE EventType = 'Login'
    AND LogDate = TODAY
    LIMIT 1
];

// LogFile is a Blob
String csvContent = elf.LogFile.toString();
// Parse CSV — first line is the header row with column names
List<String> lines = csvContent.split('\n');
String headerLine = lines[0];
List<String> columns = headerLine.split(',');
```

**Column names vary by EventType.** Common Login event columns:
- `TIMESTAMP` — ISO 8601 timestamp
- `USER_ID` — Salesforce User ID
- `USER_NAME` — Username
- `LOGIN_STATUS` — `LOGIN_NO_ERROR` or error code
- `SOURCE_IP` — IP address of the login
- `BROWSER_TYPE` — User agent string
- `LOGIN_TYPE` — `Application`, `API`, `Salesforce Mobile`, etc.
- `COUNTRY_ISO`

### Automated Export Pattern (Scheduled Apex)

```apex
public class EventLogExportBatch implements Database.Batchable<SObject>, Schedulable {

    public void execute(SchedulableContext sc) {
        Database.executeBatch(new EventLogExportBatch(), 1);
    }

    public Database.QueryLocator start(Database.BatchableContext bc) {
        // Get yesterday's log files (run nightly to stay within 24h window)
        return Database.getQueryLocator([
            SELECT Id, EventType, LogDate, LogFile, LogFileLength
            FROM EventLogFile
            WHERE LogDate = YESTERDAY
            AND EventType IN ('Login', 'API', 'ReportExport', 'ListViewExport')
        ]);
    }

    public void execute(Database.BatchableContext bc, List<EventLogFile> scope) {
        for (EventLogFile elf : scope) {
            // Send to external storage — use Named Credential for endpoint
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:AuditLogStorage/ingest');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'text/csv');
            req.setHeader('X-EventType', elf.EventType);
            req.setHeader('X-LogDate', String.valueOf(elf.LogDate));
            req.setBodyAsBlob(elf.LogFile);
            new Http().send(req);
        }
    }

    public void finish(Database.BatchableContext bc) {}
}
```

---

## Login History

### LoginHistory Object

`LoginHistory` stores a record of every login attempt for the last 6 months. Unlike `EventLogFile`, it is always available (no add-on required) and has 6-month retention.

```soql
SELECT Id, UserId, LoginTime, LoginType, Status, SourceIp,
       Platform, Browser, Application, TlsProtocol, CipherSuite,
       AuthenticationServiceId
FROM LoginHistory
WHERE LoginTime >= LAST_N_DAYS:30
AND Status != 'Success'
ORDER BY LoginTime DESC
LIMIT 200
```

**Key fields:**
| Field | Description |
|---|---|
| `UserId` | User ID |
| `LoginTime` | DateTime of the attempt |
| `Status` | `Success`, or error string (e.g. `Failed: Bad username or password`) |
| `SourceIp` | Client IP address |
| `LoginType` | `Application`, `API`, `OAuth`, etc. |
| `Platform` | OS/device (e.g. `Windows`, `iOS`) |
| `Browser` | Browser name |
| `Application` | Application name for OAuth logins |

### Using LoginHistory for Security Investigation

```soql
-- Find failed login attempts from unusual IPs in the last 24 hours
SELECT UserId, User.Username, SourceIp, LoginTime, Status, LoginType
FROM LoginHistory
WHERE LoginTime >= LAST_N_HOURS:24
AND Status != 'Success'
AND LoginType = 'Application'
ORDER BY LoginTime DESC
```

```soql
-- Find all logins for a specific user (post-incident investigation)
SELECT LoginTime, SourceIp, LoginType, Status, Browser, Platform
FROM LoginHistory
WHERE UserId = '005xx000001ABCDEF'
ORDER BY LoginTime DESC
LIMIT 100
```

---

## Setup Audit Trail

### SetupAuditTrail Object

Tracks all configuration changes made in Setup. Retention: 180 days.

```soql
SELECT Id, CreatedDate, CreatedById, CreatedBy.Username,
       Action, Section, Display
FROM SetupAuditTrail
ORDER BY CreatedDate DESC
LIMIT 100
```

**Key fields:**
| Field | Description |
|---|---|
| `Action` | Short action code (e.g. `PermSetAssign`, `ProfileChanged`) |
| `Section` | Setup section where the change was made |
| `Display` | Human-readable description of the change |
| `CreatedById` | User who made the change |
| `DelegateUserId` | If the change was made via "Login As," the original admin user |

### Common Audit Trail Use Cases

```soql
-- Find all permission set assignments in the last 30 days
SELECT CreatedDate, CreatedBy.Username, Display
FROM SetupAuditTrail
WHERE Section = 'PermissionSet'
AND CreatedDate >= LAST_N_DAYS:30
ORDER BY CreatedDate DESC
```

```soql
-- Find all profile changes
SELECT CreatedDate, CreatedBy.Username, Action, Display
FROM SetupAuditTrail
WHERE Section = 'Profile'
ORDER BY CreatedDate DESC
LIMIT 50
```

```soql
-- Find OWD changes
SELECT CreatedDate, CreatedBy.Username, Action, Display
FROM SetupAuditTrail
WHERE Section LIKE '%SharingSettings%'
ORDER BY CreatedDate DESC
```

**UI access:** **Setup → Security → View Setup Audit Trail** — download the last 180 days as a CSV file. Only the last 20 entries are shown in the UI; use SOQL or download for full history.

---

## Field Audit Trail

Field Audit Trail (add-on required) extends field history tracking beyond the standard 18-month limit and supports configuring up to 60 tracked fields per object (vs the standard 20).

- Retention: Up to 18 months configurable
- Fields tracked: Configured in **Setup → Field Audit Trail Policy**
- Queried via: `[Object]History` objects or the `FieldHistoryArchive` object
- Required for: FINRA 17a-4, HIPAA audit requirements, SOX compliance

Standard field history (no add-on) is tracked in `[Object]History` objects (e.g. `AccountHistory`, `OpportunityFieldHistory`) with a limit of 18 months and 20 fields.

---

## Transaction Security Policies

Transaction Security Policies evaluate events in real time and can take automated action (block, require MFA, notify).

**Setup:** **Setup → Security → Transaction Security Policies → New**

Available event types:
- `LoginEvent` — triggered on user login
- `ApiEvent` — triggered on API call
- `ConnectedApplication` — triggered on Connected App access
- `ReportEvent` — triggered on report run or export
- `ListViewEvent` — triggered on list view access
- `CredentialStuffingEvent` — triggered on credential stuffing detection

**Actions available:**
- Block the event
- Require multi-factor authentication
- Notify administrators (email)
- Freeze the user

**Example policy (Apex condition class):**
```apex
public class BlockExportFromUnknownIP implements TxnSecurity.EventCondition {
    public Boolean evaluate(SObject event) {
        ReportEvent re = (ReportEvent) event;
        // Block report exports from outside known IP ranges
        if (re.Operation == 'reportExported') {
            String sourceIp = re.SourceIp;
            return !isTrustedIp(sourceIp); // true = block
        }
        return false;
    }

    private Boolean isTrustedIp(String ip) {
        // Check against allowed IP ranges
        List<TrustedIpRange__mdt> ranges = [
            SELECT StartIp__c, EndIp__c FROM TrustedIpRange__mdt
        ];
        // IP range comparison logic
        return false; // simplified
    }
}
```

---

## Session Policies and High Assurance

### Session Settings

**Setup → Session Settings** — org-level session policy:
- **Session Timeout:** Idle session timeout (15 minutes to 24 hours)
- **Force logout on session timeout:** Immediately invalidates session vs. redirect to login
- **Require HttpOnly attribute:** Prevents JavaScript access to session cookie (XSS mitigation)
- **Lock sessions to the IP address from which they originated:** Prevents session hijacking (may break mobile/proxy users)
- **Enable caching and autocomplete on login page:** Disable for high-security orgs

### High Assurance Session Level

Salesforce sessions have a security level:
- **Standard** — authenticated via username/password
- **High Assurance** — authenticated via MFA (Authenticator app, hardware key, SMS OTP)

**Using High Assurance to gate sensitive access:**

1. **Setup → Session Settings → Session Security Levels** — ensure High Assurance level includes MFA methods
2. On a Permission Set: set **Session Activation Required** to **High Assurance**
   - Users with this permission set must be in a High Assurance session to benefit from the permissions it grants
3. For Connected Apps: **Setup → Connected App → Manage → Edit Policies → High Assurance session required**

**Impact on integration users:** If a service account user's profile or permission set requires High Assurance and the integration uses OAuth Client Credentials (no user interaction), it cannot satisfy the MFA requirement. Solution: assign those service accounts a dedicated profile with no High Assurance requirement, or use a named principal with explicit IP restriction exemption rather than MFA.

### Salesforce Identity Verification

When a user logs in from an unrecognized device or IP, Salesforce triggers identity verification (email OTP, SMS OTP, Authenticator app). This is separate from High Assurance:
- Identity verification is a one-time device trust step
- High Assurance is a per-session step (each new session requires MFA)

Configure identity verification thresholds in **Setup → Identity Verification → Settings**.
