# Case Lifecycle — Status, Transitions, and Mechanics

## Full Lifecycle: Intake to Closure

```
[Intake]
  Web-to-Case / Email-to-Case / Phone (manual) / Chat / Messaging
        |
        v
[New]
  Case created; assignment rule fires (if configured)
  EntitlementId set; SlaProcess starts; CaseMilestone records created
        |
        v
[Working]
  Agent accepts case from queue
  First response sent; First Response milestone completed
        |
        v
[Pending] (optional)
  Awaiting customer response or third-party action
  SLA clock may pause if EntitlementProcess configured with stop/pause on Pending
        |
        v
[Escalated] (conditional)
  EscalationRule fires based on case age
  Case.IsEscalated = true; re-assigned to senior queue
        |
        v
[Closed]
  Resolution provided; case closed by agent
  IsClosed = true (formula); ClosedDate set
  Remaining open CaseMilestone records marked IsViolated if past TargetDate
```

---

## Status Category vs Status Picklist

Salesforce uses a two-level system for case status:

- **Status Picklist** — the specific value agents see and set (e.g., `New`, `Working`, `Pending`, `Escalated`, `Closed`). These are org-configurable.
- **Status Category** — the platform-level grouping that drives `IsClosed` behavior. Each picklist value must be mapped to one of three categories:

| Status Category | `IsClosed` Value | Typical Picklist Values |
|----------------|------------------|------------------------|
| `New` | false | `New` |
| `Open` | false | `Working`, `Escalated`, `Pending` |
| `Closed` | true | `Closed`, `Resolved`, `Won't Fix` |

**To close a case:** set `Status` to any picklist value mapped to Category = `Closed`.
**To re-open a case:** set `Status` to any picklist value mapped to Category = `Open` or `New`.

**`Case.IsClosed` cannot be written directly via DML.** In Apex, `case.IsClosed = true` is a compile error. Set `case.Status = 'Closed'` instead.

---

## Required-Before-Close Validation Pattern

Without a validation rule, agents can close cases with no resolution documented. Implement this validation rule on Case:

**Rule Name:** `Require_Resolution_Before_Close`

**Error Condition Formula:**
```
AND(
  ISPICKVAL(Status, 'Closed'),
  ISBLANK(Resolution__c)
)
```

**Error Message:** "Resolution is required before closing a case."
**Error Location:** Field — `Resolution__c`

Additional before-close checks to consider:
- `ContactId` is populated (if required for CSAT)
- `Type` is set (for reporting categorization)
- At least one `CaseComment` exists (proof of agent engagement)

For more complex multi-step enforcement, use a Lightning Path with required fields per stage combined with validation rules.

---

## Case Re-Open Pattern

Cases can be re-opened after closure. Two common patterns:

### Pattern 1 — Agent Re-Opens Manually
Agent sets `Status` from `Closed` to `Working`. `IsClosed` becomes `false`. The entitlement process behavior on re-open depends on SlaProcess configuration:
- If the process is configured to **restart** on re-open, new `CaseMilestone` records are created.
- If the process is configured to **not restart**, existing milestones retain their original state. Breached milestones remain breached.

### Pattern 2 — Email-to-Case Customer Reply Re-Open
When a customer replies to a closed case's email thread and the `ThreadIdentifier` is preserved, the inbound `EmailMessage` is linked to the closed case. A Flow can automatically re-open it:

```
Trigger: EmailMessage created, Incoming = true
Condition: Parent Case IsClosed = true
Action: Update Case Status = 'Working'
Optional: Create CaseComment (IsPublished = false) noting auto-re-open
```

---

## `IsClosed` Formula Behavior

| Action | Result |
|--------|--------|
| `case.Status = 'Closed'` (Status Category = Closed) | `IsClosed = true`, `ClosedDate` set to now |
| `case.Status = 'Working'` (Status Category = Open) | `IsClosed = false`, `ClosedDate` cleared |
| `case.IsClosed = true` (direct DML) | **Compile error in Apex** |
| `case.IsClosed = false` (direct DML) | **Compile error in Apex** |
| Case accessed via REST API with `IsClosed = true` in payload | `FIELD_INTEGRITY_EXCEPTION: cannot specify value for formula field` |

---

## Escalation Rule Time Triggers

Escalation rules fire based on elapsed time, not events. The trigger is defined as:

> "Escalate if the case has been open for X hours without [optional: a specific field condition being met]."

### How Elapsed Time Is Calculated

- If business hours are configured on the rule item, Salesforce calculates elapsed time in **business hours** (excluding non-business periods).
- If no business hours are set, elapsed time uses **calendar hours** (24/7).
- The reference field is typically `Case.CreatedDate` but can be a custom date/time field (e.g., `LastStatusChangeDate__c`).

### Escalation Actions Available

| Action | Description |
|--------|-------------|
| Re-assign to User/Queue | Changes `Case.OwnerId` |
| Notify User | Sends email to specified users |
| Notify Case Owner | Sends email to current `OwnerId` |
| Notify Case Team Members | Emails members with specific `CaseTeamRole` |

### Case Age Calculation with Business Hours Example

Business hours: Monday–Friday, 9AM–6PM (9 hours/day).
Case created: Monday 8AM.
Escalation threshold: 4 business hours.
Escalation fires: Monday at approximately 1PM (4 hours after 9AM open).

The platform checks the condition during its periodic escalation rule evaluation cycle (approximately every hour).

---

## Priority Levels and SLA Correlation

Standard `Case.Priority` values and their typical SLA correlations:

| Priority | First Response SLA | Resolution SLA | Typical Milestone Time Triggers |
|----------|-------------------|---------------|--------------------------------|
| `High` | 1 business hour | 4 business hours | First Response: 60 min, Resolution: 240 min |
| `Medium` | 4 business hours | 1 business day | First Response: 240 min, Resolution: 480 min |
| `Low` | 1 business day | 3 business days | First Response: 480 min, Resolution: 2880 min |

These are illustrative. Actual values are defined in your `SlaProcess` (Entitlement Process) milestone time triggers and vary by contract. Use separate entitlement processes for each priority tier if SLA terms differ significantly by priority.

---

## Case Merge Mechanics

### Merge Process

1. Navigate to the master case record.
2. Click **Merge Cases** (available in Classic and Lightning via related list or quick action).
3. Select up to **2 additional cases** to merge (3 total including master).
4. Choose which field values to retain from which case.
5. Confirm merge.

### What Happens After Merge

| Record Type | Behavior |
|-------------|----------|
| `CaseComment` | Moved to master case |
| `EmailMessage` | Moved to master case |
| `Attachment` / `ContentDocumentLink` | Moved to master case |
| `Task` / `Event` | Moved to master case |
| `CaseMilestone` | Remain on their original cases; milestones on child cases are not moved |
| `CaseTeamMember` | Remain on original cases; not merged |
| Child case records | `MasterRecordId` set; records become read-only |

### Irreversibility

- Once merged, child cases cannot be un-merged via UI or API.
- `MasterRecordId` on child cases is read-only after set.
- If `CaseMilestone` SLA data on the child case is important, export it before merging.
- In shared UAT/sandbox environments, test merge behavior against copies of cases, never originals.

### API Behavior for Merged Cases

Querying a merged (child) case returns it with `MasterRecordId` populated. The standard `Case` SOQL does not filter out merged cases automatically. Add `WHERE MasterRecordId = null` to queries to exclude merged child cases from case counts and reports:

```sql
SELECT Id, CaseNumber, Status, Subject
FROM Case
WHERE MasterRecordId = null
AND IsClosed = false
```

---

## Status Transitions — Common Validation Scenarios

| Scenario | Recommended Enforcement |
|----------|------------------------|
| New → Closed (skip Working) | Validation rule requiring `Status != 'Closed'` unless prior `Status = 'Working'` exists; or use Lightning Path required fields |
| Closed → New (skip Working) | Discouraged; re-open should go to `Working` via validation rule |
| Working → Pending without update | Require `PendingReason__c` field populated when Status = Pending |
| Escalated → Closed without resolution | Require `Resolution__c` populated (covered by close validation) |
| Any → Closed without Contact | Validation: `ISBLANK(ContactId) AND ISPICKVAL(Status, 'Closed')` if CSAT required |

---

## Case Sharing and Visibility

Cases follow the standard Salesforce sharing model:

- **OWD (Organization-Wide Default)** for Case is typically `Public Read/Write` or `Private` depending on org requirements.
- Case queues: all queue members have read/write access to cases owned by that queue.
- Manual sharing: `CaseShare` records can grant additional access.
- Case Team: `CaseTeamMember` grants role-based access (read-only or read/write depending on `CaseTeamRole.AccessLevel`).
- **Portal users** see cases where `Case.ContactId` matches their contact or where the case is explicitly shared with their portal role.
