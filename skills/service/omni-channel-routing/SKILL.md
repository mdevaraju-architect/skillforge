---
name: service-omni-channel-routing
description: >-
  ServiceChannel, RoutingConfiguration, AgentWork, PendingServiceRouting,
  PresenceStatus, UserServicePresence, AgentCapacityOverride, RoutingAttribute,
  RoutingAttributeDefinition, QueueSobject, OmniChannel, Unified Routing,
  skills-based routing, queue-based routing, capacity model, agent presence,
  work item routing, direct routing, overflow, OmniSupervisor, AgentWorkSkill,
  routing priority, routing model, push vs pull routing, tab-based capacity
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: service
  module: omni-channel-routing
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Service Cloud OmniChannel Routing

Canonical reference for Salesforce OmniChannel routing: `ServiceChannel`, `RoutingConfiguration`, `AgentWork`, `PendingServiceRouting`, `PresenceStatus`, `UserServicePresence`, skills-based routing, queue-based routing, capacity model, and supervisor monitoring.

---

## Routing Table

| Reference File | Topic |
|---|---|
| [references/01-architecture.md](references/01-architecture.md) | Object model, state machine, key field tables |
| [references/02-setup-and-permissions.md](references/02-setup-and-permissions.md) | Enabling OmniChannel, setup steps, permission sets |
| [references/03-routing-models.md](references/03-routing-models.md) | Queue-based routing, push/pull, overflow, direct-to-agent |
| [references/04-skills-based-routing.md](references/04-skills-based-routing.md) | RoutingAttributeDefinition, skill matching, fallback |
| [references/05-supervisor-and-monitoring.md](references/05-supervisor-and-monitoring.md) | OmniSupervisor, SOQL patterns, bulk reassign |

---

## Critical Gotchas

### 1. `ServiceChannel` defines what SObject type is routed — one channel per object type

`ServiceChannel.RelatedEntityType` maps the channel to `Case`, `LiveChatTranscript`, `MessagingSession`, `Order`, or a custom object. A channel configured for `Case` cannot route `LiveChatTranscript` records — they require separate `ServiceChannel` records. `ServiceChannel.DeveloperName` is immutable after creation; plan naming conventions before going to production. Attempting to change `DeveloperName` post-creation throws a `FIELD_INTEGRITY_EXCEPTION`.

### 2. `RoutingConfiguration.RoutingModel` determines push vs pull

Valid values for `RoutingModel`:
- `MostAvailable` — push to the agent with the most remaining capacity (capacity units free)
- `LeastActive` — push to the agent with the fewest active work items
- `ExternalRouting` — delegate routing to a custom external system via webhook

Push routing (`MostAvailable`, `LeastActive`) sends work to agents without requiring them to pull or accept from a queue — work appears in their OmniChannel widget automatically. Pull routing requires agents to actively accept. Setting the wrong model results in work piling up unaccepted or agents being overloaded.

### 3. `AgentWork.Status` lifecycle is strict: `Assigned → Opened → Accepted → Declined → Closed`

Status transitions:
- `Assigned` — work has been routed to an agent; agent has not yet interacted
- `Opened` — agent opened the work item tab/record
- `Accepted` — agent explicitly accepted the work (OmniChannel widget confirm)
- `Declined` — agent declined; platform re-queues the work via a new `PendingServiceRouting`
- `Closed` — work is complete

Do not set `Status = Closed` programmatically without first ensuring the underlying work item (Case, MessagingSession) is also closed. Orphaned `AgentWork` records with `Status = Closed` but an open underlying record inflate handle time and supervisor metrics. When a work item is closed via its own record (e.g. Case `Status = Closed`), the platform closes the associated `AgentWork` automatically — avoid double-closing.

### 4. Capacity is measured in capacity units, not work item count

`RoutingConfiguration.Capacity` sets how many **capacity units** this channel consumes per work item assigned. `UserServicePresence.ConfiguredCapacity` (set via the agent's `ServicePresenceConfig`) sets the agent's total capacity in units. An agent with `ConfiguredCapacity = 10` who has two work items each consuming 5 capacity units is at 100% — no additional work routes to them regardless of presence status. Misconfigured capacity units (e.g. every channel set to 1 unit but agents have capacity 10) causes agents to receive 10 simultaneous work items.

### 5. `PresenceStatus` controls whether an agent receives work — not just their online/offline state

Agents can be authenticated and active in Salesforce while in a `PresenceStatus` that is not linked to any `ServiceChannel` (for example, a custom `Break` or `Training` status). Work only routes to agents in a `PresenceStatus` that has at least one `ServiceChannel` configured under `Presence Status Channels`. Creating a new `PresenceStatus` without linking it to channels means agents using that status will never receive routed work — this is a common misconfiguration when adding new channels.

### 6. Skills-based routing requires `RoutingAttributeDefinition` → `RoutingAttribute` → `AgentCapacityOverride` or `AgentWorkSkill`

Skills-based routing is a multi-object setup:
1. `RoutingAttributeDefinition` — defines the skill type (e.g. `Language`, `ProductKnowledge`) and its data type (`Text`, `Numeric`, `Boolean`)
2. `RoutingAttribute` — links the `RoutingAttributeDefinition` to a specific `RoutingConfiguration`, optionally with a minimum threshold
3. `AgentCapacityOverride` (or `AgentWorkSkill`) — assigns the skill and level to an agent user

Missing any link in this chain silently falls back to queue-based routing without error. There is no validation error at save time — the routing engine simply ignores skill requirements it cannot satisfy and routes by queue availability. Always verify the full chain in a sandbox before deploying.

### 7. `PendingServiceRouting` records are created when work cannot be immediately routed

When no agent is available (all at capacity or no agents in a matching presence status), the platform creates a `PendingServiceRouting` record to queue the work item. It is automatically re-evaluated and processed when an agent becomes available or changes to an eligible presence status. Do not delete `PendingServiceRouting` records manually — this silently abandons the work item. The customer's chat or case remains open but no agent is ever assigned. Use `AgentWork.Status = Declined` or re-route via the supervisor console instead.

### 8. Queue-based routing uses `QueueSobject` to link queues to object types — not `ServiceChannel` directly

For OmniChannel to pull work from a Salesforce queue, the queue must have `QueueSobject` records linking it to the correct SObject type (e.g. `Case`). A queue that lacks a `QueueSobject` for `Case` will not receive Case work items routed via OmniChannel even if the `RoutingConfiguration` references that queue. This is a separate step from creating the queue — verify `QueueSobject` records exist after queue creation with:

```soql
SELECT Id, QueueId, SobjectType FROM QueueSobject WHERE QueueId = '<your-queue-id>'
```

### 9. `UserServicePresence.ConfiguredCapacity` is set at setup — not per-shift

The configured capacity is fixed in the `ServicePresenceConfig` (Setup → Presence Configurations). It does not change per day, per shift, or per agent login session. To give specific agents a different capacity limit (e.g. senior agents handling fewer items, or specialized queues with reduced load), use `AgentCapacityOverride` records scoped to that agent and channel combination. Attempting to update `UserServicePresence.ConfiguredCapacity` directly via Apex or Data Loader has no effect on routing behavior.

### 10. OmniSupervisor data uses `AgentWork` and `UserServicePresence` — always include a `Status` or `CreatedDate` filter

Supervisor dashboards query near-real-time state. Without filters, SOQL over `AgentWork` returns the full historical record set, which in mature orgs can contain millions of rows. Always filter for active work:

```soql
SELECT Id, UserId, Status, WorkItemId, CreatedDate
FROM AgentWork
WHERE Status NOT IN ('Closed', 'Declined')
  AND CreatedDate = TODAY
```

Unfiltered queries against `AgentWork` are the most common cause of governor limit failures in orgs with high chat/messaging volume.

### 11. Unified Routing requires the Messaging for In-App and Web or Digital Engagement add-on

Unified Routing is the next-generation routing engine that handles all channels (voice, messaging, cases) with AI-based classification and skill matching. It uses `RoutingConfiguration.IsUsingExternalSystem = false` under the hood but is configured through a separate setup path (Setup → Routing → Unified Routing). Classic OmniChannel (queue + push model) continues to work alongside Unified Routing, and both share `AgentWork` and `PresenceStatus` objects. However, Unified Routing requires the **Messaging for In-App and Web** or **Digital Engagement** add-on license — enabling it without the add-on leaves configuration screens visible but work items will not route.

### 12. `AgentWork` is created by the platform — do not insert it manually to simulate routing

Creating `AgentWork` records via Apex DML, Data Loader, or Bulk API bypasses the routing engine's capacity and availability checks. The result is ghost work items: the supervisor sees the work as assigned, but no routing logic was applied, capacity is not correctly debited, and the agent's OmniChannel widget may not reflect the work. For programmatic routing use the `OmniRouterService` Apex class or the `assignWorkToAgent` Connect API endpoint. For testing, use sandbox routing configurations with test agents rather than injecting `AgentWork` directly.

---

## Workflows

### Workflow 1: Set Up a New OmniChannel Channel for Case Routing (Queue-Based)

This workflow covers the end-to-end steps to route `Case` records via OmniChannel using a standard queue with push routing.

**Prerequisites:** OmniChannel must be enabled (Setup → OmniChannel Settings → Enable OmniChannel).

**Steps:**

1. **Create a ServiceChannel for Case**
   - Setup → OmniChannel → Service Channels → New
   - `Related Entity Type`: `Case`
   - `Developer Name`: `Case` (immutable after save — choose carefully)
   - `Enable AI-based Capacity`: optional, required for Unified Routing

2. **Create a PresenceStatus and link the channel**
   - Setup → OmniChannel → Presence Statuses → New
   - Add `Service Channels`: select the `Case` channel created above
   - Status type: `Online` (ensures agents in this status receive work)

3. **Create a ServicePresenceConfig (Presence Configuration)**
   - Setup → OmniChannel → Presence Configurations → New
   - `Configured Capacity`: total capacity units for agents assigned this config (e.g. `10`)
   - Assign agents via Profile or Permission Set

4. **Create or identify a Case queue**
   - Setup → Queues → New (or use an existing queue)
   - Ensure `Supported Objects` includes `Case`
   - Verify `QueueSobject` for Case exists (see Gotcha 8)

5. **Create a RoutingConfiguration**
   - Setup → OmniChannel → Routing Configurations → New
   - `Routing Model`: `MostAvailable` (push to most available agent)
   - `Units of Capacity`: e.g. `2` (this Case channel consumes 2 of the agent's 10 units per work item)
   - `Routing Priority`: lower number = higher priority (e.g. `1`)

6. **Associate the RoutingConfiguration with the queue**
   - On the Queue record (Setup → Queues), set `Routing Configuration` to the new config

7. **Assign PresenceStatus to agents**
   - Via Permission Set or Profile → Service Presence Statuses → assign the new status

8. **Test**
   - Log in as a test agent, open the OmniChannel utility bar, set status to the new presence status
   - Create a Case and assign it to the queue
   - Verify `AgentWork` record is created with `Status = Assigned`

---

### Workflow 2: Configure Skills-Based Routing

This workflow adds skill requirements to an existing routing configuration so that Cases requiring a specific language are routed only to agents with that skill.

**Prerequisites:** A working queue-based routing configuration exists (see Workflow 1).

**Steps:**

1. **Create a RoutingAttributeDefinition**
   - Setup → OmniChannel → Routing Attribute Definitions → New
   - `Developer Name`: `Language`
   - `Data Type`: `Text`

2. **Create RoutingAttribute on the RoutingConfiguration**
   - Navigate to the RoutingConfiguration record
   - Related list: Routing Attributes → New
   - `Routing Attribute Definition`: `Language`
   - `Is Required`: `true` (if false, skill match is preferred but not required)

3. **Assign skills to agents via AgentCapacityOverride**
   - Setup → OmniChannel → Skills → Agent Skills → New
   - `Agent`: target user
   - `Routing Attribute Definition`: `Language`
   - `Value`: e.g. `Spanish`
   - `Start Date` / `End Date`: optional for time-bounded skill assignments

4. **Set skill requirements on work items (AgentWorkSkill)**
   - Use a Flow or Apex trigger on `Case` before/on insert to create an `AgentWorkSkill` record
   - `Work Item Id`: the Case Id
   - `Routing Attribute Definition Id`: the `Language` definition Id
   - `Required Skill Value`: `Spanish`

5. **Validate in sandbox**
   - Create a Case with the skill requirement, verify routing only goes to agents with `Language = Spanish`
   - Check `PendingServiceRouting` if no match — do not delete it; add a matching agent or adjust the skill requirement instead

6. **Configure fallback behavior**
   - On the `RoutingAttribute` record, set `Is Required = false` to allow fallback to any available agent if no skill match is found after the configured timeout
   - Set `Overflow Action` on the `RoutingConfiguration` to define behavior when the queue is empty

---

### Workflow 3: Monitor and Troubleshoot Routing via OmniSupervisor

This workflow covers using OmniSupervisor and SOQL to diagnose routing problems.

**Steps:**

1. **Open OmniSupervisor**
   - App Launcher → OmniSupervisor (requires `OmniChannelSupervisor` permission set or equivalent profile permission)
   - Agents tab shows current `UserServicePresence` state per agent
   - Queued Work tab shows `PendingServiceRouting` records

2. **Check for stuck work items (PendingServiceRouting)**

   ```soql
   SELECT Id, WorkItemId, RoutingConfigurationId, CreatedDate, IsReadyForRouting
   FROM PendingServiceRouting
   WHERE IsReadyForRouting = true
   ORDER BY CreatedDate ASC
   ```

   Work items stuck in `PendingServiceRouting` longer than expected indicate: no agents in eligible presence status, all agents at capacity, or a skills mismatch with no fallback configured.

3. **Check agent availability**

   ```soql
   SELECT Id, UserId, ServicePresenceStatus.MasterLabel, ConfiguredCapacity, ActiveTime
   FROM UserServicePresence
   WHERE IsCurrentState = true
     AND ServicePresenceStatus.IsAvailable = true
   ```

4. **Check active AgentWork**

   ```soql
   SELECT Id, UserId, WorkItemId, Status, CreatedDate, HandleTime
   FROM AgentWork
   WHERE Status NOT IN ('Closed', 'Declined')
     AND CreatedDate = TODAY
   ORDER BY CreatedDate ASC
   ```

5. **Bulk reassign declined or stuck work**

   When an agent is unexpectedly offline and their work is stuck in `Assigned`:

   ```apex
   List<AgentWork> stuckWork = [
       SELECT Id, Status FROM AgentWork
       WHERE UserId = :agentId
         AND Status = 'Assigned'
   ];
   for (AgentWork aw : stuckWork) {
       aw.Status = 'Declined';
   }
   update stuckWork;
   ```

   Setting `Status = Declined` triggers the routing engine to re-queue via a new `PendingServiceRouting` record.

6. **Investigate supervisor metric anomalies**
   - Elevated handle time: check for `AgentWork` with `Status = Opened` where the underlying Case is closed (orphaned records — close them via status update)
   - Queue depth not clearing: verify agents are in a presence status linked to the channel (see Gotcha 5)
   - Zero routing despite available agents: verify `QueueSobject` exists for the SObject type (see Gotcha 8) and `RoutingConfiguration` is associated with the queue

---

## Not Covered by This Skill

The following topics are outside this skill's boundary:

- **Voice/CTI telephony integration** — PSTN, Amazon Connect, and partner CTI setup require telephony-specific configuration outside OmniChannel metadata
- **Digital Engagement chat widget UI** — the front-end Embedded Service deployment, branding, and pre-chat forms are a separate configuration domain
- **Case object lifecycle** — Case status transitions, escalation rules, and milestone tracking: use `service-case-lifecycle`
- **Field Service scheduling** — work order routing and technician scheduling: use `service-field-service`
