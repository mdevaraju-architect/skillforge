# Case Lifecycle — Entitlements and SLA

## The Full Entitlement Chain

Every SLA milestone on a case traces back through this object chain:

```
ServiceContract
  └── Entitlement (ServiceContractId)
        └── SlaProcess / Entitlement Process (SlaProcessId on Entitlement)
              └── MilestoneType (defined within the SlaProcess)
                    └── CaseMilestone (auto-created on Case when EntitlementId set)
```

Understanding each layer prevents the most common SLA configuration mistakes.

---

## ServiceContract

`ServiceContract` represents the commercial agreement between your org and a customer. It is the top of the hierarchy.

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `AccountId` | Lookup(Account) | Customer account |
| `Name` | Text | Contract name/number |
| `StartDate` | Date | Contract effective date |
| `EndDate` | Date | Contract expiry date |
| `Status` | Picklist | `Draft`, `Activated`, `Expired` |
| `TotalPrice` | Currency | Commercial value (for billing integration) |
| `Pricebook2Id` | Lookup(Pricebook2) | If line items (ContractLineItem) are used |

A `ServiceContract` can have multiple `Entitlement` children — one per product, support tier, or channel. Always verify `Status = 'Activated'` before relying on entitlement lookups; entitlements under expired contracts do not apply SLA processes to new cases.

---

## Entitlement

`Entitlement` defines the specific coverage terms that apply to a case. It is the object that links a case to an SLA process.

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `AccountId` | Lookup(Account) | Must match the case's AccountId for auto-lookup |
| `AssetId` | Lookup(Asset) | Optional: for product-specific entitlements |
| `ServiceContractId` | Lookup(ServiceContract) | Parent contract |
| `SlaProcessId` | Lookup(SlaProcess) | The Entitlement Process to apply |
| `BusinessHoursId` | Lookup(BusinessHours) | Affects milestone time calculations |
| `StartDate` / `EndDate` | Date | Coverage window |
| `Status` | Formula | `Active` (within dates), `Expired` (past EndDate), `Inactive` |
| `Type` | Picklist | `Web`, `Phone`, `Email`, `All` (org-configurable) |
| `CasesPerEntitlement` | Number | For case-count entitlements (optional) |
| `RemainingCases` | Number | Decrements automatically when `Case.EntitlementId` is set |

**Auto-entitlement lookup:** Enable in Setup > Entitlement Settings. When enabled, Salesforce automatically sets `Case.EntitlementId` on new cases by matching:
1. `Entitlement.AccountId` = `Case.AccountId`
2. `Entitlement.AssetId` = `Case.AssetId` (if applicable)
3. `Entitlement.Status` = `Active`
4. `Entitlement.Type` matches `Case.Origin` (if configured)

If multiple active entitlements match, Salesforce picks the most recently updated one. For deterministic selection, use a before-save Flow with explicit entitlement query logic.

---

## EntitlementContact

`EntitlementContact` grants specific contacts the ability to use an entitlement. When enabled, only contacts listed on the entitlement can create cases under it.

**Use case:** A ServiceContract covers only designated support contacts at a customer, not all employees.

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `EntitlementId` | Master-Detail(Entitlement) | Parent entitlement |
| `ContactId` | Lookup(Contact) | Authorized contact |

To enforce contact-level entitlement access, enable "Restrict entitlement access to named contacts" in Setup > Entitlement Settings. When enabled, `Case.ContactId` must match an `EntitlementContact.ContactId` for the entitlement to be applied.

---

## SlaProcess (Entitlement Process) Configuration

The `SlaProcess` object defines the ordered sequence of milestones and their time triggers. It is configured in Setup > Entitlement Management > Entitlement Processes.

### SlaProcess Key Configuration

| Setting | Description |
|---------|-------------|
| Name | Internal label for the process |
| Salesforce Object | Typically `Case` |
| Entry Criteria | Case conditions that trigger process start |
| Exit Criteria | Case conditions that stop the process |
| Business Hours | Default hours; can be overridden by Entitlement.BusinessHoursId |
| Active | Must be checked for the process to apply to new cases |

### Milestone Order and Time Triggers

Milestones within an SlaProcess are evaluated in order. Each milestone has:
- **Time Trigger Type:** `Minutes` after process start, or `Minutes` after previous milestone completion.
- **Business Hours:** Inherited from the SlaProcess or overridden per milestone.
- **Recurrence:** Whether the milestone repeats (for `Recursively Independent` type).

**Example SlaProcess milestone sequence:**

| Order | Milestone Type | Time Trigger | Business Hours |
|-------|---------------|-------------|----------------|
| 1 | First Response | 60 min after process start | Yes (business hours only) |
| 2 | Resolution | 480 min after process start | Yes |
| 3 | Follow-Up Confirmation | 30 min after Resolution completion | No (calendar time) |

### Process Start and Stop

The SlaProcess starts when `Case.EntitlementId` is set and the entry criteria are met. If `Case.EntitlementId` is set before the entry criteria are true, the process starts when the criteria become true (via a case update).

The process stops (exits) when:
- Exit criteria are met (e.g., `Status = 'Closed'`).
- `Case.EntitlementId` is cleared.
- The `Entitlement` record expires.

When the process exits, `Case.SlaExitDate` is populated.

---

## MilestoneType

`MilestoneType` defines the named checkpoints used across one or more SlaProcesses.

**Key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `Name` | Text | Label (e.g., "First Response", "Resolution") |
| `Description` | Long Text | Internal documentation |
| `RecurrenceType` | Picklist | `No Recurrence` or `Recursively Independent` |

`Recursively Independent` milestones restart after each completion. Useful for milestones like "Periodic Update" (every 24 hours, agent must update the customer). `No Recurrence` milestones complete once.

---

## CaseMilestone — The Runtime SLA Record

`CaseMilestone` records are the live SLA tracking records on each case. They are auto-created when an SlaProcess starts and must never be manually inserted.

### Completing a Milestone

Set `CaseMilestone.CompletionDate` to mark the milestone as completed:

```apex
CaseMilestone cm = [
  SELECT Id, CompletionDate
  FROM CaseMilestone
  WHERE CaseId = :caseId
  AND MilestoneType.Name = 'First Response'
  AND IsCompleted = false
  LIMIT 1
];
if (cm != null) {
  cm.CompletionDate = System.now();
  update cm;
}
```

**Do not attempt to delete or re-insert `CaseMilestone` records.** The platform manages their lifecycle.

### CaseMilestone Fields

| Field | Writable | Notes |
|-------|----------|-------|
| `CompletionDate` | Yes | Set to complete the milestone |
| `StartDate` | No | System-set when milestone starts |
| `TargetDate` | No | System-calculated deadline |
| `IsCompleted` | No | Derived from CompletionDate != null |
| `IsViolated` | No | Derived: true if TargetDate < now and CompletionDate is null |
| `RemainingTimeInMins` | No | Minutes until TargetDate |
| `ElapsedTimeInMins` | No | Minutes since StartDate |

---

## Breach Detection

A milestone is breached when `CaseMilestone.IsViolated = true`. This happens when:
- `TargetDate` passes without `CompletionDate` being set.
- `IsViolated` is set by the platform; it cannot be reset once true (even if `CompletionDate` is later set — it records that the breach occurred).

### Breach Notifications

Configure **Violation Actions** on the milestone within the SlaProcess:
- Email alert to case owner, queue, or specific users
- Field update on the Case (e.g., set `Priority = 'High'`)
- Outbound message or Flow trigger (via Process Builder / Flow escalation actions)

### SLA Reporting

Standard reports and dashboards for SLA tracking:

| Report | Key Metrics |
|--------|------------|
| Case Milestones — By Type | Completion rate, violation rate, average completion time |
| Case Milestones — Violated | All breached milestones; filter by date, case origin, priority |
| Cases with Active Milestones | Open cases with upcoming milestone deadlines |
| Entitlement Usage | `RemainingCases` vs `CasesPerEntitlement` for count-based entitlements |

**SOQL for breached milestones:**
```sql
SELECT Id, CaseId, MilestoneType.Name, TargetDate, IsViolated, RemainingTimeInMins
FROM CaseMilestone
WHERE IsViolated = true
AND Case.IsClosed = false
ORDER BY TargetDate ASC
```

**SOQL for approaching milestones (within 30 minutes):**
```sql
SELECT Id, CaseId, MilestoneType.Name, TargetDate, RemainingTimeInMins
FROM CaseMilestone
WHERE IsCompleted = false
AND IsViolated = false
AND RemainingTimeInMins <= 30
AND Case.IsClosed = false
ORDER BY RemainingTimeInMins ASC
```

---

## Auto-Entitlement Lookup via Flow

When the built-in auto-entitlement lookup is insufficient (e.g., you need to match on custom criteria), use a before-save Record-Triggered Flow on Case:

**Trigger:** Record Created, Before Save
**Object:** Case
**Entry Condition:** `EntitlementId IS NULL AND AccountId IS NOT NULL`

**Flow Logic:**
1. Get Records — query `Entitlement` where `AccountId = {!$Record.AccountId}` AND `Status = 'Active'` AND `StartDate <= TODAY` AND `EndDate >= TODAY`.
2. If match found: assign `EntitlementId` = first result's `Id`.
3. If no match: leave `EntitlementId` null (do not throw error; some cases are legitimately non-entitled).

---

## Count-Based Entitlements

For entitlements that allow a fixed number of cases per contract period:
- `Entitlement.CasesPerEntitlement` — total cases allowed.
- `Entitlement.RemainingCases` — auto-decrements when `Case.EntitlementId` is set to this entitlement.
- When `RemainingCases = 0`, the entitlement still links to the case but no new SLA milestones are created (configurable).

**Monitoring count-based entitlements:**
```sql
SELECT Id, Name, CasesPerEntitlement, RemainingCases, Account.Name
FROM Entitlement
WHERE CasesPerEntitlement > 0
AND RemainingCases <= 5
AND Status = 'Active'
```
