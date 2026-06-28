# Routing Models: Queue-Based, Push, Pull, Overflow, and Direct-to-Agent

## Queue-Based Routing Overview

Queue-based routing is the foundational OmniChannel routing model. Work items (Cases, Chats, etc.) are assigned to a Salesforce queue. OmniChannel monitors the queue and routes eligible work to available agents according to the `RoutingConfiguration` attached to that queue.

**Flow:**
1. A work item (e.g. Case) is assigned to a queue (manually, via Flow, or via assignment rule)
2. OmniChannel detects the new queue member
3. The routing engine evaluates agent availability against the `RoutingConfiguration`
4. If an agent is available: `AgentWork` record created with `Status = Assigned`
5. If no agent is available: `PendingServiceRouting` record created; re-evaluated when availability changes

**Key relationship:** One queue → one `RoutingConfiguration`. The routing config controls all routing behavior for work arriving through that queue.

---

## Routing Models: MostAvailable vs LeastActive

### MostAvailable

Routes work to the agent with the **most remaining capacity** (highest unused capacity units).

**Calculation:**
```
Remaining capacity = ConfiguredCapacity - SUM(active AgentWork.CapacityUnits)
```

Agent with the highest `Remaining capacity` receives the next work item.

**Best for:**
- Environments where you want to maximize utilization before distributing widely
- Teams where agent workload should be balanced by capacity weight
- High-volume chat where some agents handle multiple simultaneous conversations

**Risk:** If two agents have identical remaining capacity, the platform breaks ties arbitrarily. This can cause one agent to appear to receive more work in short observation windows.

### LeastActive

Routes work to the agent with the **fewest active work items** (count of `AgentWork` records in `Assigned`, `Opened`, or `Accepted` status).

**Calculation:**
```
Active items = COUNT(AgentWork WHERE Status IN ('Assigned', 'Opened', 'Accepted') AND UserId = agent)
```

Agent with the lowest active item count receives the next work item.

**Best for:**
- Environments where work items have highly variable handle time (e.g. mixed simple/complex cases)
- Teams where capacity unit weighting is not meaningful
- Voice/callback routing where per-call load matters more than unit weight

**Risk:** An agent with 1 heavy work item (e.g. a multi-hour escalation) counts the same as an agent with 1 trivial item. Pair with capacity unit weighting to mitigate.

### ExternalRouting

Delegates routing decisions to an external system. The platform creates a `PendingServiceRouting` record and fires a platform event to the external system. The external system evaluates the work item and calls back to assign it.

**Use cases:**
- AI-driven routing beyond what Unified Routing provides
- Integration with third-party workforce management systems
- Complex SLA-aware routing that cannot be modeled in OmniChannel configurations

**Implementation:** Register a platform event subscriber on `RoutingRequest__e` (or the org's external routing event). The subscriber calls the `OmniRouterService.assignWorkToAgent()` method to complete the assignment.

---

## Push vs Pull Routing Mechanics

### Push Routing

`MostAvailable` and `LeastActive` are push models. The routing engine assigns work to agents **without agent consent** — the work item appears in the agent's OmniChannel widget automatically.

**Agent experience:** Work item appears in the widget tray as an incoming notification with an accept/decline button (for channels with `pushTimeout` configured) or auto-accepts immediately (for channels configured without a push timeout). The `AgentWork` record transitions `Assigned → Opened` when the agent opens the record.

**Key config:** `RoutingConfiguration.PushTimeout` (seconds before auto-decline if agent does not respond). If `PushTimeout` is 0 or unset, work is assigned without a timeout — the agent must manually close it. Configuring a sensible timeout (e.g. 30s) prevents work from sticking to unavailable agents.

### Pull Routing

In pull routing (supported via some external routing configurations and the `LeastActive` model in certain UI configurations), agents actively pull work from a queue by clicking in the OmniChannel widget or a custom UI.

**Key difference:** Pull routing requires the agent to initiate acceptance; push sends work unsolicited. For most OmniChannel configurations with `MostAvailable` or `LeastActive`, routing is push.

---

## Capacity Calculation Deep Dive

Capacity prevents agents from being overloaded. The routing engine never assigns work that would exceed an agent's `ConfiguredCapacity`.

**Example:**

| Agent | ConfiguredCapacity | Active Work Items | Units per Item | Total Used | Available |
|---|---|---|---|---|---|
| Agent A | 10 | 2 × Case (2 units) | 2 | 4 | 6 |
| Agent B | 10 | 1 × Chat (5 units) | 5 | 5 | 5 |
| Agent C | 10 | 0 | — | 0 | 10 |

With `MostAvailable`, next work item routes to Agent C (most available = 10 units free). With `LeastActive`, next item also routes to Agent C (0 active items).

**Multi-channel agents:** An agent handling both Cases and Chats has capacity consumed by both. A Case at 2 units and a Chat at 5 units = 7 units used. If the agent's `ConfiguredCapacity = 10`, they have 3 units remaining — enough for another Case (2 units) but not another Chat (5 units).

**AgentCapacityOverride for per-agent limits:** To give a specific agent a lower effective capacity (e.g. a trainee who should handle max 1 case at a time), use `AgentCapacityOverride` on the `ServicePresenceConfig` for that agent rather than a global capacity reduction.

---

## Work Item Priority vs Routing Configuration Priority

There are two distinct priority dimensions:

### RoutingConfiguration.RoutingPriority

Sets the **order in which work from different routing configurations is processed** when an agent becomes available. Lower number = higher priority. If an agent can handle one more work item and there are items waiting in both a `Priority 1` queue and a `Priority 2` queue, the `Priority 1` item routes first.

### Work Item Priority (custom)

Work items can have their own priority field (e.g. `Case.Priority = High`). OmniChannel does not natively sort work within a single routing configuration by the work item's own priority field — within a given routing configuration, work is processed in FIFO order by `PendingServiceRouting.CreatedDate`. To achieve priority-based routing within a single queue, use separate queues with separate routing configurations at different `RoutingPriority` levels.

---

## Overflow Routing

Overflow routing handles work items when no agents are available and the queue depth exceeds acceptable limits.

**RoutingConfiguration.OverflowAction values:**

| Value | Behavior |
|---|---|
| `None` | Work waits in `PendingServiceRouting` indefinitely |
| `AssignToQueue` | Work is moved to a fallback queue (e.g. email-to-case queue for async handling) |
| `DeclineWithMessage` | Work item is declined; used for chat/messaging to display a message to the customer |

**RoutingConfiguration.OverflowAssignee:** When `OverflowAction = AssignToQueue`, this field specifies the target queue ID.

**Overflow triggers:** Configure `RoutingConfiguration.OverflowMaxWaitTime` (seconds) to trigger overflow after a defined wait. Without a wait time, work queues indefinitely.

---

## Direct-to-Agent Routing

Direct-to-agent routing bypasses the queue and routes a specific work item to a named agent. This is used for VIP customer handling, agent-requested callbacks, or supervisor-initiated transfers.

**Apex approach using OmniRouterService:**

```apex
// Route a specific Case directly to a specific agent
OmniRouterService.RouteWorkRequest request = new OmniRouterService.RouteWorkRequest();
request.workItemId = caseId;
request.routingContextId = routingConfigId;
request.targetUserId = agentUserId;
OmniRouterService.routeWork(new List<OmniRouterService.RouteWorkRequest>{ request });
```

**Notes:**
- Direct routing still checks agent capacity — the agent must have sufficient capacity units available
- If the agent is at capacity, the request fails silently and a `PendingServiceRouting` may be created
- Direct routing does not create a `QueueSobject` relationship — the work item does not pass through a queue
- Use direct routing sparingly; over-use bypasses the fairness model

---

## AgentWork Status Transitions and Decline Behavior

### Decline and Re-routing

When an agent declines work (`AgentWork.Status = Declined`), the routing engine:
1. Closes the original `AgentWork` record with `Status = Declined`
2. Creates a new `PendingServiceRouting` record for the work item
3. The new `PendingServiceRouting` is processed immediately if another agent is available

**Decline count:** The platform tracks decline count on `PendingServiceRouting`. After a configurable number of declines, `OverflowAction` may trigger. Review `PendingServiceRouting.NumberOfDeclines` in supervisor queries to identify problematic work items.

### Auto-decline on Push Timeout

If `RoutingConfiguration.PushTimeout` is set (e.g. 30 seconds) and the agent does not respond, the platform auto-declines and re-routes. The agent's presence status is not changed — they remain available to receive the next item.

### Supervisor-initiated Reassignment

Supervisors can reassign work from OmniSupervisor or via Apex:

```apex
AgentWork aw = [SELECT Id, Status FROM AgentWork WHERE Id = :agentWorkId];
aw.Status = 'Declined';
update aw;
// Platform creates new PendingServiceRouting automatically
```

---

## SLA Correlation with Routing Priority

OmniChannel does not natively enforce SLA timers — that is the role of `Entitlement` and `Milestone` objects on the Case. However, routing priority can be aligned with SLA urgency:

**Pattern: SLA-aware queue routing**
1. Create a Flow or Apex trigger that runs when a Case SLA milestone is approaching breach
2. Move the Case from a standard queue to a high-priority queue (lower `RoutingPriority` number)
3. The routing engine picks up the moved Case and routes it ahead of lower-priority items

**Pattern: Escalation routing**
1. Monitor `CaseMilestone` (handled by `service-case-lifecycle`, not this skill) for breach
2. On breach, reassign to an escalation queue with `RoutingPriority = 1`
3. Use `PendingServiceRouting.CreatedDate` to track time-in-queue for reporting
