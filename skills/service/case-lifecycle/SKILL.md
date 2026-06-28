---
name: service-case-lifecycle
description: >-
  Case, CaseComment, CaseMilestone, CaseTeamMember, Entitlement, EntitlementContact,
  ServiceContract, SlaProcess, MilestoneType, EscalationRule, CaseAssignmentRule,
  EmailMessage, LiveChatTranscript, MessagingSession, case creation, case routing,
  case escalation, SLA, entitlement process, first response time, resolution time,
  case status, case origin, case priority, case merge, case closure, web-to-case,
  email-to-case, omni-channel, Knowledge integration, macro, quick action
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: service
  module: case-lifecycle
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Service Cloud — Case Lifecycle

This skill covers the full lifecycle of a Salesforce Service Cloud case: intake through resolution, SLA enforcement via the Entitlement model, escalation rules, multi-channel intake (Web-to-Case, Email-to-Case, Live Chat, Messaging), and case closure.

---

## Gotchas

### 1. `Case.Status` picklist transitions are not platform-enforced

Standard `Status` values are `New`, `Working`, `Escalated`, `Closed`. Without validation rules, a case can jump from `New` directly to `Closed`, skipping agent work entirely. Always implement a Lightning Path component and a validation rule that enforces required fields before closure — for example, `Resolution__c` must not be blank when `Status = 'Closed'`. The platform does not prevent any valid picklist-to-picklist transition on its own.

### 2. `CaseMilestone` records are auto-created by the Entitlement Process — never manually create them

When an Entitlement Process starts on a case (triggered by setting `Case.EntitlementId`), `CaseMilestone` records are automatically generated from `MilestoneType` definitions in that process. Attempting to insert `CaseMilestone` records manually throws `INSUFFICIENT_ACCESS_OR_READONLY` on managed milestone fields. To mark a milestone complete, update `CaseMilestone.CompletionDate` to a non-null `DateTime` value; do not try to delete or re-create the record.

### 3. `Case.EntitlementId` must be populated for SLA tracking

`CaseMilestone` records are only created when `Case.EntitlementId` is set AND the referenced entitlement has an active `SlaProcess` (Entitlement Process). Without this link, no milestones are generated and SLA compliance cannot be tracked or reported. Auto-populate `EntitlementId` via Web-to-Case settings, a before-save Flow on case creation, or the auto-entitlement lookup feature available under Entitlement settings in Setup.

### 4. `EscalationRule` fires based on case age, not status change

Escalation rules evaluate based on elapsed time from `Case.CreatedDate` (or a custom date/time field) against configured business hours. They do NOT fire on status transitions. A case in `Working` status will still escalate if the configured age threshold is breached. Use `Case.IsEscalated` to track escalation state; this field is set automatically by the rule engine, not by agent action or DML.

### 5. `CaseComment.IsPublished` controls customer visibility

`IsPublished = true` makes the comment visible on customer-facing portals and Experience Cloud sites. `IsPublished = false` keeps it as an internal note. The field defaults to `false`. In bulk DML operations or data loads, never set `IsPublished = true` unless you have confirmed the comment content is safe for customer view. Accidental publication of internal notes is a common support audit finding.

### 6. `EmailMessage` on Case uses `ThreadIdentifier` for email-to-case threading

Inbound emails are matched to existing open cases via the `ThreadIdentifier` — a unique token embedded in the email subject line and footer by Salesforce. If the customer's mail client strips this token (e.g., plain-text replies or aggressive email security filters), the inbound email creates a new case rather than appending to the existing one. `EmailMessage.Incoming = true` for inbound messages; `Incoming = false` for outbound. Monitor `Case.EmailCount` for threading accuracy.

### 7. `Case.Origin` picklist drives routing rules and SLA

Standard values are `Email`, `Phone`, `Web`. Many entitlement processes and assignment rules branch on `Case.Origin`. Setting it correctly at intake is critical. Changing `Origin` after case creation does not retroactively re-apply assignment rules or re-trigger the entitlement process. If origin must be corrected, you may need to manually re-assign the case or re-apply the entitlement.

### 8. `ServiceContract` is the parent of `Entitlement` — one contract, many entitlements

`Entitlement.ServiceContractId` is the lookup to `ServiceContract`. A `ServiceContract` defines the commercial support agreement terms (start date, end date, contract number). `Entitlement` records define specific coverage lines — business hours, response time SLAs, supported channels, per-product entitlements. A single customer may have one `ServiceContract` with separate `Entitlement` records for each product or support tier. Do not conflate the two when querying or reporting on SLA compliance.

### 9. `Case.IsClosed` is a formula field — set `Status = 'Closed'` to close a case, not `IsClosed = true`

`Case.IsClosed` cannot be written directly via DML; it is a system-managed formula derived from whether the current `Status` value maps to the `Closed` Status Category in the picklist setup. To close a case, set `Status` to a value whose Status Category is `Closed`. To re-open a case, set `Status` to a value whose Status Category is `Open`. Attempting `case.IsClosed = true` in Apex causes a compile error.

### 10. `CaseAssignmentRule` requires child `AssignmentRuleItem` records

The `CaseAssignmentRule` object is the rule container; the actual routing criteria live on child `AssignmentRuleItem` records (one per criterion row). A `CaseAssignmentRule` with zero `AssignmentRuleItem` children assigns cases to the default queue or owner configured on the rule header. When an assignment rule "isn't working," always verify the `AssignmentRuleItem` count via SOQL: `SELECT Id FROM AssignmentRuleItem WHERE AssignmentRuleId = '<ruleId>'`.

### 11. `CaseTeamMember` roles are org-specific — never hardcode role names as strings

Team member roles (e.g., `Customer Contact`, `Internal Agent`, `Technical Specialist`) are configured per org in Setup under Case Team Roles. Insert `CaseTeamMember` records using `TeamRoleId` (a lookup to `CaseTeamRole`), not a string role name. Query `CaseTeamRole` at runtime: `SELECT Id, Name FROM CaseTeamRole WHERE Name = 'Internal Agent'`. Hardcoding role names causes failures after org migrations or role renames.

### 12. Web-to-Case and Email-to-Case bypass assignment rules by default

Both channels can create cases without running the active case assignment rule unless explicitly configured. For Web-to-Case: enable "Assign Cases to Case Assignment Rules" in Setup > Service > Web-to-Case. For Email-to-Case: each routing address is configured separately, and queue assignment is set per routing address — there is no single global toggle. Validate your intake channels in a sandbox after any assignment rule change.

### 13. `Case.AccountId` and `Case.ContactId` are not required by default

Many orgs create anonymous cases from web form submissions without a linked Account or Contact. If your org's process requires an Account, enforce it via a validation rule (e.g., `ISBLANK(AccountId)` on non-web origins) rather than setting the field as required at the field level — field-level required blocks programmatic case creation in automation and integrations where the account is not yet known.

### 14. Merging cases (`Case.MasterRecordId`) is irreversible — child cases become read-only

When cases are merged, the non-master cases receive a non-null `MasterRecordId` and become locked (read-only via the standard UI and API). `CaseComment`, `EmailMessage`, `Attachment`, and `ContentDocumentLink` records from merged child cases are re-parented to the master case. The merge cannot be undone through the standard UI or Salesforce API — there is no "unmerge" operation. Validate merge candidates carefully before execution, especially in shared QA and UAT environments.

---

## Reference Files

| # | File | Contents |
|---|------|----------|
| 01 | [references/01-architecture.md](references/01-architecture.md) | Case object hub-and-spoke model, Entitlement chain, key field tables |
| 02 | [references/02-setup-and-permissions.md](references/02-setup-and-permissions.md) | Permission sets, Web-to-Case, Email-to-Case, entitlement process, milestone types, escalation/assignment rules |
| 03 | [references/03-case-lifecycle.md](references/03-case-lifecycle.md) | Full status lifecycle, Status Category, validation patterns, re-open, merge mechanics |
| 04 | [references/04-entitlements-and-sla.md](references/04-entitlements-and-sla.md) | ServiceContract → Entitlement → SlaProcess → MilestoneType → CaseMilestone chain, breach detection, reporting |
| 05 | [references/05-channels-and-integrations.md](references/05-channels-and-integrations.md) | Web-to-Case, Email-to-Case, EmailMessage threading, LiveChatTranscript, MessagingSession, Knowledge, macros |

---

## Workflows

### Workflow 1 — Case Intake Through First Response

```
Channel (Web Form / Email / Phone)
        |
        v
Case Created
  - Case.Origin set (Email / Web / Phone)
  - Case.Status = 'New'
  - Case.Priority set (High / Medium / Low)
        |
        v
Assignment Rule Evaluation
  - CaseAssignmentRule + AssignmentRuleItem criteria evaluated
  - Case.OwnerId set to Queue or Agent
  - Case owner notification email sent
        |
        v
Entitlement Lookup (Flow / Setup auto-lookup)
  - Case.EntitlementId populated
  - EntitlementProcess starts
  - CaseMilestone records auto-created (e.g., First Response, Resolution)
        |
        v
Agent Picks Up Case
  - Case.Status = 'Working'
  - First response sent (EmailMessage, CaseComment with IsPublished=true)
        |
        v
First Response Milestone Completed
  - CaseMilestone.CompletionDate updated (manually or via Flow)
  - SLA clock on First Response stops
```

### Workflow 2 — Escalation and Resolution with Entitlement Milestones

```
Case Age Threshold Approached (EscalationRule time trigger)
        |
        v
EscalationRule Fires
  - Case.IsEscalated = true (set by rule engine)
  - Case.Status optionally set to 'Escalated'
  - Re-assignment to escalation queue / senior agent
  - Escalation notification sent
        |
        v
Agent Works Toward Resolution
  - CaseComment records added (IsPublished = false for internal notes)
  - CaseTeamMember records added (TeamRoleId from CaseTeamRole)
  - Knowledge article linked (ContentDocumentLink or case feed attachment)
        |
        v
Resolution Identified
  - Resolution__c (custom field) populated
  - CaseMilestone (Resolution Time) CompletionDate updated
  - Resolution communicated to customer (EmailMessage outbound)
        |
        v
Milestone Breach Check
  - If CaseMilestone.IsViolated = true, SLA breach recorded
  - Breach triggers escalation notification (separate EscalationRule or alert)
```

### Workflow 3 — Case Closure and CSAT Capture

```
Agent Sets Status = 'Closed'
        |
        v
Validation Rule Check
  - Resolution__c not blank
  - Case.ContactId populated (if required by org process)
  - Fails validation -> agent must complete required fields
        |
        v
Case Closed
  - Case.IsClosed = true (formula, auto-set)
  - Case.ClosedDate = system timestamp
  - Remaining open CaseMilestone records marked IsViolated if past due
        |
        v
CSAT Survey Triggered
  - Flow or Process triggers outbound survey email
  - EmailMessage (Outgoing) created with survey link
  - Case.CSAT__c (custom) updated when survey response received
        |
        v
Case Re-Open Path (if needed)
  - Customer replies -> Email-to-Case creates new case (or re-opens via Flow)
  - Agent sets Status = 'Working' (IsClosed resets to false)
  - Entitlement process resumes or restarts depending on SlaProcess config
```

---

## Not Covered by This Skill

- **OmniChannel routing engine** — agent availability, routing configurations, skills-based routing. Use `service-omni-channel-routing`.
- **Knowledge Management** — article creation, publishing lifecycle, data categories, search configuration. Use `service-knowledge-management`.
- **Field Service** — work orders, service appointments, territories, service resources. Use `service-field-service`.
- **Chat and Messaging UI configuration** — Embedded Service setup, Messaging for In-App and Web deployment, bot configuration.
