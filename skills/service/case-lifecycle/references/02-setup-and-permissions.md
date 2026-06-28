# Case Lifecycle — Setup and Permissions

## Service Cloud Permission Sets

Salesforce ships with standard permission sets for Service Cloud. Assign the appropriate set based on agent role.

| Permission Set | Intended Role | Key Permissions Included |
|----------------|--------------|--------------------------|
| `Service Cloud User` | Front-line support agent | Read/Write on Case, CaseComment, EmailMessage; access to Service Console |
| `Service Cloud Agent` (custom) | Advanced agent | Includes Knowledge, Entitlement read access |
| `Entitlement Management` | Service admin | Create/Edit on ServiceContract, Entitlement, SlaProcess, MilestoneType |
| `Case Management` | Team lead / supervisor | Access to escalation rule config, queue management, case assignment rules |

To check which permission sets are assigned to a user:
```sql
SELECT PermissionSet.Name, AssigneeId
FROM PermissionSetAssignment
WHERE AssigneeId = '<UserId>'
```

---

## Web-to-Case Setup

**Path:** Setup > Service > Web-to-Case

### Configuration Steps

1. Enable Web-to-Case (checkbox).
2. Set the default case origin — this populates `Case.Origin` when the field is not included in the form.
3. Set a default case owner (user or queue) for cases that do not match any assignment rule.
4. **Enable "Assign Cases to Case Assignment Rules"** — this is the critical checkbox that routes Web-to-Case submissions through the active `CaseAssignmentRule`. It is off by default.
5. Enable spam filtering (reCAPTCHA or hidden field) to suppress bot submissions.
6. Generate the HTML form using the Web-to-Case form generator. Copy the generated HTML to your web page.
7. To auto-populate `EntitlementId`, use a before-save Flow triggered on Case creation that performs the entitlement lookup (by `AccountId` + `AssetId` + active status).

### Generated HTML Form Fields

The standard Web-to-Case form includes hidden fields: `orgid` (your org ID) and `retURL` (redirect after submission). Map form `name` attributes exactly to Case field API names. Custom fields use the format `<field_API_name>` (without the `__c` suffix in older form generators — verify in your org).

### Limits

- Web-to-Case submissions are capped at **5,000 per day** per org. Cases submitted above this limit are not created and the customer sees the error page.
- Web-to-Case does not support file attachments natively; use a separate file upload mechanism.

---

## Email-to-Case Setup

**Path:** Setup > Service > Email-to-Case

### On-Demand Email-to-Case vs Salesforce-Hosted

| Mode | How It Works | When to Use |
|------|-------------|-------------|
| **On-Demand** | Customer emails go to your mail server first; a forwarding rule or agent sends them to Salesforce via the Email-to-Case API. | When your org's security policy requires email to stay on your mail server; supports large attachments. |
| **Salesforce-Hosted** | Email sent directly to a Salesforce-provided address (e.g., `support@cs1.salesforce.com`). Salesforce processes it immediately. | Simplest setup; no mail server configuration needed. |

### Routing Address Configuration

Each routing address defines:
- **Email Address** — the address customers email (e.g., `support@yourcompany.com`)
- **Queue** — which queue owns cases created from this address
- **Case Priority** — default priority for cases from this address
- **Case Origin** — default origin value (usually `Email`)
- **Create Task** — whether to create a follow-up Task on the case
- **Send Auto-Response** — whether to send an acknowledgment email

**Assignment rule evaluation is NOT global for Email-to-Case.** The queue set on the routing address is used directly. If you need assignment rule evaluation, trigger a Flow on case creation that calls assignment rule logic or uses a custom queue routing mechanism.

### Email Threading

Salesforce embeds a `ThreadIdentifier` token in the subject (`[ ref:_<token> ]`) and footer of all outbound emails on a case. When a customer replies, the inbound email is matched to the case using this token.

If the token is stripped:
- The inbound email creates a **new case** instead of appending to the existing one.
- Monitor for duplicate cases with the same contact and similar subject.
- Consider using `Case.Subject` matching as a secondary deduplication check via a Flow.

---

## Entitlement Process (SlaProcess) Creation

**Path:** Setup > Service > Entitlement Management > Entitlement Processes

### Steps to Create an Entitlement Process

1. Click **New Entitlement Process**.
2. Set **Name** (e.g., "Standard Support SLA").
3. Set **Salesforce Object** — typically `Case`.
4. Configure **Entry Criteria** — conditions on the Case that must be true for the process to start (e.g., `Case.Origin = 'Email'` or `Case.Priority = 'High'`).
5. Configure **Exit Criteria** — when the process stops (e.g., `Case.Status = 'Closed'`). If no exit criteria, the process runs until all milestones are complete or the case closes.
6. Set **Business Hours** — used to calculate milestone target dates.
7. Activate the process. **Note:** Once activated, the process cannot be edited; clone it to make changes.

### Adding Milestones to the Process

1. In the Entitlement Process, click **New Milestone**.
2. Select the **Milestone Type** (must be created in Setup > Entitlement Management > Milestone Types first).
3. Set **Time Trigger** — minutes after process start (or minutes after previous milestone completion for chained milestones).
4. Set **Milestone Actions** (optional):
   - **Success Actions** — Fire when `CompletionDate` is set before breach.
   - **Warning Actions** — Fire N minutes before breach (configurable).
   - **Violation Actions** — Fire when `IsViolated = true`.

---

## Milestone Type Configuration

**Path:** Setup > Service > Entitlement Management > Milestone Types

| Field | Description |
|-------|-------------|
| `Name` | Label for the milestone (e.g., "First Response", "Resolution") |
| `Description` | Internal documentation |
| `RecurrenceType` | `No Recurrence` or `Recursively Independent` (resets after each completion) |

Common milestone types used in Service Cloud:
- **First Response** — time from case creation to first agent reply
- **Resolution** — time from case creation to case closure
- **Escalation Acknowledged** — time from escalation to manager acknowledgment

---

## Escalation Rule Setup

**Path:** Setup > Service > Escalation Rules

### Steps

1. Create a new **Escalation Rule** (only one can be active at a time).
2. Add **Escalation Rule Items** (criteria rows):
   - Set sort order (evaluated in ascending order; first match wins).
   - Set criteria (Case fields, formulas).
   - Set **Escalation Time** — hours after case creation (or a date/time field) before escalation fires.
   - Set **Business Hours** — affects elapsed time calculation.
3. For each Escalation Rule Item, add **Escalation Actions**:
   - **Re-assign** case to a user or queue.
   - **Notify** users or managers.
   - Age threshold can be set in hours (up to 1000 hours).

### Behavior Notes

- Escalation rules are evaluated on a scheduled basis (roughly hourly), not in real time on the minute.
- `Case.IsEscalated` is set to `true` by the rule engine; it does not reset automatically when the case is re-assigned.
- To clear `IsEscalated`, use a Flow or Apex to set it back to `false` after an agent acknowledges the escalation.

---

## Case Assignment Rule Setup

**Path:** Setup > Service > Case Assignment Rules

### Steps

1. Create a new **Case Assignment Rule**.
2. Mark it as **Active** (only one rule active at a time).
3. Add **Assignment Rule Items**:
   - Sort order determines evaluation sequence.
   - Set criteria (Case fields, formulas).
   - Set **Assigned To** — User or Queue.
   - Enable **Do Not Reassign Owner** (optional, for cases already owned by a specific user).
   - Set **Email Template** for assignment notification.

### Invoking Assignment Rules in Apex

```apex
Database.DMLOptions dmlOpts = new Database.DMLOptions();
dmlOpts.assignmentRuleHeader.useDefaultRule = true;
insert caseRecord.setOptions(dmlOpts);
```

Without `setOptions`, assignment rules do not fire on Apex DML inserts.

---

## Business Hours Configuration

**Path:** Setup > Company Settings > Business Hours

Define business hours to ensure SLA time calculations exclude nights, weekends, and holidays. Multiple business hours records can exist (e.g., "US East — 9AM-6PM ET", "Global — 24/7").

- Link business hours to `Entitlement.BusinessHoursId` for SLA-aware milestone calculations.
- Link business hours to `EscalationRuleItem` for escalation time calculations.
- The default "Business Hours" record is used if no explicit assignment is made.

---

## Case Queues

**Path:** Setup > Users > Queues (filter by Supported Objects: Case)

Queues are used as intermediate holders for cases before individual agent assignment. Configure:
- **Queue Name** and **Queue Email** (notification address)
- **Queue Members** — users who can accept cases from the queue
- **Supported Objects** — must include `Case`

Queue membership determines who sees the queue list view. Any queue member can take ownership of a case from the queue via the **Accept** action on the case record.

---

## SLA Field Visibility in Page Layouts

To surface SLA tracking information on the Case page layout, add these fields:

**Case layout — SLA fields:**
- `SlaStartDate` — when the entitlement process started
- `SlaExitDate` — when the entitlement process ended
- `SlaViolationDate` — when SLA was breached
- `EntitlementId` — linked entitlement (add as lookup field)
- `IsEscalated` — escalation flag (read-only checkbox)

**CaseMilestone related list** — add to the Case page layout to show milestone status inline:
- Columns: Milestone Type, Start Date, Target Date, Completion Date, Is Violated, Remaining Time

To show milestone warnings in the Service Console, configure the **Milestones** component in the Lightning App Builder for the Case record page.
