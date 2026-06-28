# Case Lifecycle — Architecture

## Case Hub-and-Spoke Model

The `Case` object is the central hub for all service work. Every related record links back to a single Case via lookup or master-detail relationship.

```
                          +-----------+
                          |   Case    |
                          +-----------+
                               |
        -----------------------|------------------------
        |         |       |         |        |         |
        v         v       v         v        v         v
  CaseComment  EmailMessage  CaseMilestone  Task/Event
  CaseTeamMember  Attachment/ContentDocumentLink
  LiveChatTranscript  MessagingSession
```

### Direct Child Objects

| Object | Relationship | Cardinality | Notes |
|--------|-------------|-------------|-------|
| `CaseComment` | `ParentId` lookup to Case | Many-per-case | `IsPublished` controls customer visibility |
| `EmailMessage` | `ParentId` lookup to Case | Many-per-case | `Incoming` flag distinguishes inbound vs outbound |
| `CaseMilestone` | `CaseId` lookup to Case | One per MilestoneType per process | Auto-created by SlaProcess; do not manually insert |
| `CaseTeamMember` | `ParentId` lookup to Case | Many-per-case | `TeamRoleId` lookup to `CaseTeamRole` |
| `Task` | `WhatId` lookup to Case | Many-per-case | Standard activity; supports due-date tracking |
| `Event` | `WhatId` lookup to Case | Many-per-case | Calendar entries linked to case |
| `Attachment` / `ContentDocumentLink` | `LinkedEntityId` | Many-per-case | File attachments; ContentDocumentLink preferred in API 41.0+ |
| `LiveChatTranscript` | `CaseId` lookup to Case | One-per-chat | Created when chat is ended and linked to case |
| `MessagingSession` | `CaseId` lookup to Case | Many-per-case | WhatsApp, SMS, In-App messaging sessions |

---

## Entitlement Model Chain

The Entitlement model connects a customer's commercial support agreement to the specific SLA milestones tracked on each case.

```
ServiceContract
      |
      | (ServiceContractId)
      v
Entitlement
      |
      | (SlaProcessId)
      v
SlaProcess (Entitlement Process)
      |
      | (defines MilestoneType order and time triggers)
      v
MilestoneType (e.g., "First Response", "Resolution")
      |
      | (auto-created on Case when EntitlementId set)
      v
CaseMilestone (one per MilestoneType per case)
```

### Entitlement Chain Objects

| Object | Key Fields | Notes |
|--------|-----------|-------|
| `ServiceContract` | `AccountId`, `StartDate`, `EndDate`, `Status` | Commercial contract with the customer |
| `Entitlement` | `AccountId`, `ServiceContractId`, `SlaProcessId`, `BusinessHoursId`, `StartDate`, `EndDate` | Coverage definition; links contract to SLA process |
| `EntitlementContact` | `EntitlementId`, `ContactId` | Contact-level entitlement access; optional |
| `SlaProcess` (Entitlement Process) | `Name`, `IsActive`, `BusinessHoursId`, `SobjectType` | Defines ordered milestones and their time triggers |
| `MilestoneType` | `Name`, `RecurrenceType`, `SlaProcessId` | Individual milestone definition (e.g., First Response) |
| `CaseMilestone` | `CaseId`, `MilestoneTypeId`, `StartDate`, `TargetDate`, `CompletionDate`, `IsViolated`, `IsCompleted` | Runtime instance per case; update `CompletionDate` to complete |

---

## Key Field Reference: `Case`

| Field API Name | Type | Notes |
|----------------|------|-------|
| `CaseNumber` | Auto Number | System-generated; read-only |
| `Subject` | Text(255) | Required for meaningful routing |
| `Description` | Long Text Area | Full problem description |
| `Status` | Picklist | `New`, `Working`, `Escalated`, `Pending`, `Closed` (org-configurable) |
| `Priority` | Picklist | `High`, `Medium`, `Low` |
| `Origin` | Picklist | `Email`, `Phone`, `Web` (drives routing and SLA) |
| `Type` | Picklist | `Question`, `Problem`, `Feature Request` (org-configurable) |
| `AccountId` | Lookup(Account) | Not required by default |
| `ContactId` | Lookup(Contact) | Not required by default |
| `EntitlementId` | Lookup(Entitlement) | Required for SLA/milestone tracking |
| `BusinessHoursId` | Lookup(BusinessHours) | Inherited from Entitlement if not set directly |
| `OwnerId` | Lookup(User/Queue) | Set by assignment rule or manually |
| `IsEscalated` | Checkbox | Set by EscalationRule engine; read-only in standard UI |
| `IsClosed` | Formula(Boolean) | Derived from Status category; not directly writable |
| `ClosedDate` | DateTime | Set automatically when IsClosed becomes true |
| `MasterRecordId` | Lookup(Case) | Non-null on merged (locked) child cases |
| `SlaStartDate` | DateTime | When the SLA clock started |
| `SlaExitDate` | DateTime | When the SLA process exited |
| `SlaViolationDate` | DateTime | When SLA was breached (if applicable) |

---

## Key Field Reference: `CaseMilestone`

| Field API Name | Type | Notes |
|----------------|------|-------|
| `CaseId` | Lookup(Case) | Parent case |
| `MilestoneTypeId` | Lookup(MilestoneType) | Which milestone this is (e.g., First Response) |
| `StartDate` | DateTime | When the milestone clock started |
| `TargetDate` | DateTime | Deadline based on SlaProcess time trigger |
| `CompletionDate` | DateTime | Set this to mark the milestone complete (writeable) |
| `IsViolated` | Checkbox | True if TargetDate passed without CompletionDate; read-only |
| `IsCompleted` | Checkbox | True when CompletionDate is set; read-only |
| `RemainingTimeInMins` | Number | Minutes remaining before breach; useful for dashboards |
| `ElapsedTimeInMins` | Number | Minutes since milestone started |
| `TimeRemainingInMins` | Formula | Deprecated alias; use `RemainingTimeInMins` |

---

## Key Field Reference: `Entitlement`

| Field API Name | Type | Notes |
|----------------|------|-------|
| `Name` | Text(255) | Entitlement label |
| `AccountId` | Lookup(Account) | Customer account |
| `AssetId` | Lookup(Asset) | Optional: product/asset this entitlement covers |
| `ServiceContractId` | Lookup(ServiceContract) | Parent commercial contract |
| `SlaProcessId` | Lookup(SlaProcess) | The entitlement process defining milestones |
| `BusinessHoursId` | Lookup(BusinessHours) | Business hours for SLA calculation |
| `StartDate` | Date | Entitlement coverage start |
| `EndDate` | Date | Entitlement coverage end |
| `Status` | Formula(Picklist) | `Active`, `Expired`, `Inactive` — derived from dates |
| `Type` | Picklist | `Web`, `Phone`, `Email` (org-configurable) |
| `RemainingCases` | Number | For case-count entitlements; decrements per case |
| `CasesPerEntitlement` | Number | Total cases allowed (for count-based entitlements) |

---

## EscalationRule Model

```
EscalationRule (container, one active rule per org)
      |
      | (RuleId)
      v
EscalationRuleItem (one per criterion row)
      |
      | (triggers)
      v
EscalationAction (re-assign, notify, set IsEscalated)
```

`EscalationRule` evaluates on a scheduled basis (not event-driven). The platform re-evaluates open cases against active escalation rules approximately every hour. Business hours affect elapsed time calculations.

---

## CaseAssignmentRule Model

```
CaseAssignmentRule (container, one active rule per org)
      |
      | (AssignmentRuleId)
      v
AssignmentRuleItem (one per criterion row, ordered by SortOrder)
      |
      | (criteria match)
      v
Assigns Case.OwnerId to Queue or User
Sends assignment notification email
```

Only one `CaseAssignmentRule` can be active at a time per org. Assignment rules are evaluated synchronously at case creation if the `AssignmentRuleHeader` is included in the DML call (Apex) or enabled in the channel settings (Web-to-Case, Email-to-Case).
