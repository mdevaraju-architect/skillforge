# Supervisor Monitoring and Operational Queries

## OmniSupervisor Overview

OmniSupervisor is the real-time monitoring console for OmniChannel routing. It provides supervisors with a live view of:
- Agent presence status and capacity utilization
- Active work items (open `AgentWork` records)
- Queued work items (open `PendingServiceRouting` records)
- Queue depth and wait times

**Access requirements:**
- `OmniChannelSupervisor` permission set (or equivalent profile permission)
- App Launcher → OmniSupervisor

**Tabs:**
- **Agents** — real-time view of each agent's `UserServicePresence` state, capacity used vs available, and active work items
- **Queued Work** — `PendingServiceRouting` records waiting for an agent, sorted by wait time
- **Assigned Work** — `AgentWork` records in `Assigned`, `Opened`, or `Accepted` status
- **Skills** (if skills-based routing enabled) — skill coverage by channel

OmniSupervisor refreshes approximately every 30 seconds. For true real-time data, use the underlying SOQL queries described below.

---

## Core Supervisor SOQL Patterns

### 1. Current Agent Availability

Query active `UserServicePresence` records to see who is online and in what status.

```soql
SELECT
  Id,
  UserId,
  User.Name,
  User.Profile.Name,
  ServicePresenceStatus.MasterLabel,
  ServicePresenceStatus.StatusType,
  ConfiguredCapacity,
  ActiveTime,
  IsCurrentState
FROM UserServicePresence
WHERE IsCurrentState = true
ORDER BY User.Name
```

**Filter for agents able to receive work:**

```soql
SELECT Id, UserId, User.Name, ConfiguredCapacity, ActiveTime
FROM UserServicePresence
WHERE IsCurrentState = true
  AND ServicePresenceStatus.IsAvailable = true
ORDER BY User.Name
```

**Notes:**
- `IsCurrentState = true` returns only the current presence record per agent. Without this filter you get the full presence history (one record per status change)
- `ActiveTime` is in seconds
- `ConfiguredCapacity` reflects the Presence Configuration's total — not the remaining capacity. To compute remaining capacity, join to active `AgentWork` and subtract

### 2. Active Work Items (Open AgentWork)

Always filter by `Status` to avoid returning millions of historical records.

```soql
SELECT
  Id,
  UserId,
  User.Name,
  WorkItemId,
  ServiceChannel.MasterLabel,
  Status,
  CreatedDate,
  AcceptTime,
  HandleTime
FROM AgentWork
WHERE Status NOT IN ('Closed', 'Declined')
ORDER BY CreatedDate ASC
```

**Filter to today only (high-volume orgs):**

```soql
SELECT Id, UserId, User.Name, WorkItemId, Status, CreatedDate
FROM AgentWork
WHERE Status NOT IN ('Closed', 'Declined')
  AND CreatedDate = TODAY
ORDER BY CreatedDate ASC
```

**Count by agent and status (supervisor dashboard metric):**

```soql
SELECT UserId, User.Name, Status, COUNT(Id) WorkCount
FROM AgentWork
WHERE Status NOT IN ('Closed', 'Declined')
  AND CreatedDate = TODAY
GROUP BY UserId, User.Name, Status
ORDER BY User.Name, Status
```

### 3. Queued Work (PendingServiceRouting)

```soql
SELECT
  Id,
  WorkItemId,
  ServiceChannelId,
  ServiceChannel.MasterLabel,
  RoutingConfigurationId,
  RoutingConfiguration.MasterLabel,
  IsReadyForRouting,
  CreatedDate
FROM PendingServiceRouting
WHERE IsReadyForRouting = true
ORDER BY CreatedDate ASC
```

**Time-in-queue calculation (seconds waiting):**

```soql
SELECT
  Id,
  WorkItemId,
  CreatedDate,
  ServiceChannel.MasterLabel
FROM PendingServiceRouting
WHERE IsReadyForRouting = true
  AND CreatedDate < :System.now().addMinutes(-5)  -- waiting more than 5 minutes
ORDER BY CreatedDate ASC
```

**Note:** `PendingServiceRouting` records are deleted by the platform when routing succeeds (when `AgentWork` is created). Querying `IsReadyForRouting = true` returns only currently-waiting items.

### 4. Handle Time and Queue Depth for Reporting

**Average handle time by channel (today):**

```soql
SELECT ServiceChannel.MasterLabel, AVG(HandleTime) AvgHandleTimeSecs, COUNT(Id) ClosedCount
FROM AgentWork
WHERE Status = 'Closed'
  AND CloseTime = TODAY
GROUP BY ServiceChannel.MasterLabel
```

**Daily queue depth and agent utilization (requires SOQL aggregate):**

```soql
SELECT
  DAY_ONLY(CreatedDate) RoutingDate,
  ServiceChannel.MasterLabel,
  COUNT(Id) TotalWorkItems,
  AVG(HandleTime) AvgHandleSecs
FROM AgentWork
WHERE CreatedDate = LAST_N_DAYS:7
GROUP BY DAY_ONLY(CreatedDate), ServiceChannel.MasterLabel
ORDER BY DAY_ONLY(CreatedDate) DESC
```

---

## SLA Breach Correlation

OmniChannel does not manage SLA timers directly (that is the role of Entitlement and Milestone on Case, handled by `service-case-lifecycle`). However, routing data can be correlated with SLA data for breach analysis.

**Query: Cases with routing delay > 10 minutes that later breached SLA**

```soql
SELECT
  aw.WorkItemId,
  aw.CreatedDate,
  aw.AcceptTime,
  aw.UserId
FROM AgentWork aw
WHERE aw.ServiceChannel.RelatedEntityType = 'Case'
  AND aw.Status = 'Closed'
  AND aw.AcceptTime != null
  AND aw.CreatedDate = TODAY
```

Then in Apex or a second query, join to `CaseMilestone` records using the `WorkItemId` (= `CaseId`) to identify cases where routing delay contributed to SLA breach.

---

## Supervisor Alert Patterns

### Alert: Work stuck in PendingServiceRouting for > N minutes

Use a scheduled Apex class or Flow to query `PendingServiceRouting` with a `CreatedDate` threshold and alert supervisors:

```apex
List<PendingServiceRouting> stuckWork = [
    SELECT Id, WorkItemId, ServiceChannelId, CreatedDate
    FROM PendingServiceRouting
    WHERE IsReadyForRouting = true
      AND CreatedDate < :System.now().addMinutes(-10)
];
if (!stuckWork.isEmpty()) {
    // Send a Chatter post or custom notification to supervisor
    // (use CustomNotificationType + Messaging.CustomNotification)
}
```

### Alert: Agent at capacity across all active sessions

```soql
SELECT usp.UserId, usp.User.Name, usp.ConfiguredCapacity,
       SUM(aw_capacity.CapacityUnits) UsedCapacity
FROM UserServicePresence usp
-- Note: SOQL does not support multi-object joins like SQL.
-- Implement this as a two-query Apex pattern:
-- 1. Query UserServicePresence for active agents
-- 2. For each agent, query AgentWork SUM of capacity units
-- Then filter for UsedCapacity >= ConfiguredCapacity
```

Implement this as an Apex batch or a Report + Dashboard with a Cross-Filter for active `AgentWork`.

### Alert: High decline rate on a specific work item

```soql
SELECT WorkItemId, COUNT(Id) DeclineCount
FROM AgentWork
WHERE Status = 'Declined'
  AND CreatedDate = TODAY
GROUP BY WorkItemId
HAVING COUNT(Id) >= 3
ORDER BY COUNT(Id) DESC
```

Work items declined 3+ times likely indicate: no agents with required skills, work item in an unsupported state, or a data quality issue with the work item itself.

---

## Bulk Reassign Pattern

Supervisors may need to bulk-reassign work when an agent is suddenly unavailable (unexpected absence, system crash).

### Step 1: Identify agent's active work

```soql
SELECT Id, WorkItemId, Status, ServiceChannelId
FROM AgentWork
WHERE UserId = :offlineAgentId
  AND Status IN ('Assigned', 'Opened', 'Accepted')
```

### Step 2: Decline all active work (triggers re-routing)

```apex
List<AgentWork> agentWorkItems = [
    SELECT Id, Status FROM AgentWork
    WHERE UserId = :offlineAgentId
      AND Status IN ('Assigned', 'Opened', 'Accepted')
];
for (AgentWork aw : agentWorkItems) {
    aw.Status = 'Declined';
}
update agentWorkItems;
```

Setting `Status = Declined` on each record causes the routing engine to create new `PendingServiceRouting` records for each work item, which are then routed to available agents. This is the correct re-routing mechanism — do not delete `AgentWork` records or attempt to update `UserId` directly.

### Step 3: Force-close agent presence

If the agent's `UserServicePresence` record shows them as still `Online` (e.g. browser crashed without logout), a supervisor can update their presence via the OmniSupervisor UI or via Apex:

```apex
// Find agent's current presence record
UserServicePresence usp = [
    SELECT Id FROM UserServicePresence
    WHERE UserId = :offlineAgentId
      AND IsCurrentState = true
    LIMIT 1
];
// Note: You cannot update IsCurrentState directly.
// Use the OmniChannel REST API to change presence status:
// POST /services/data/v60.0/presence/agent/status
// with body: { "statusId": "<offline-status-id>" }
```

---

## OmniSupervisor Permissions and Data Access

OmniSupervisor respects Salesforce sharing rules and profiles for the underlying work item records (Cases, Chats). However, `AgentWork` and `UserServicePresence` are accessible to users with the `OmniChannelSupervisor` feature permission regardless of the work item's sharing model.

**Consequence:** A supervisor who does not have access to a specific Case record can still see the `AgentWork` associated with it in OmniSupervisor. The work item link will show the Id but clicking it may throw an insufficient privileges error. This is expected behavior — ensure supervisors also have appropriate Case access if full drill-down is required.

---

## Common Monitoring Mistakes

| Mistake | Impact | Correct Approach |
|---|---|---|
| Querying `AgentWork` without `Status` or date filter | Returns millions of rows; governor limit failure | Always filter `Status NOT IN ('Closed', 'Declined')` and `CreatedDate = TODAY` |
| Querying `UserServicePresence` without `IsCurrentState = true` | Returns all historical presence change records | Add `WHERE IsCurrentState = true` |
| Deleting `PendingServiceRouting` to "clear" stuck items | Work item abandoned silently; customer left waiting | Decline the associated `AgentWork` or re-route via supervisor console |
| Inserting `AgentWork` manually to "test" routing | Bypasses capacity checks; ghost items in supervisor view | Use `OmniRouterService` or Create a proper test Case and route via queue |
| Not filtering by `ServiceChannelId` in multi-channel orgs | Aggregates metrics across all channels | Add `ServiceChannelId = :targetChannelId` to isolate metrics per channel |
