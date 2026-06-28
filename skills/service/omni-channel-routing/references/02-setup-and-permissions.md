# OmniChannel Setup and Permissions

## Step 1: Enable OmniChannel

Navigate to **Setup → OmniChannel Settings** and enable the **OmniChannel** toggle. This is a one-way org-level switch — once enabled it cannot be disabled. Enabling OmniChannel provisions the routing engine and makes `ServiceChannel`, `PresenceStatus`, `RoutingConfiguration`, and related metadata available.

**Org considerations:**
- Enabling OmniChannel in production is immediate — coordinate with release management
- In scratch orgs, enable via `config/project-scratch-def.json` feature flag `OmniChannel` or by Setup toggle post-creation
- Developer Edition orgs support OmniChannel but have agent capacity limits

---

## Step 2: Create ServiceChannels

A `ServiceChannel` defines which SObject type the channel routes. One `ServiceChannel` per SObject type.

**Setup path:** Setup → OmniChannel → Service Channels → New

**Required fields:**

| Field | Guidance |
|---|---|
| `Channel Name` (MasterLabel) | Human-readable, e.g. `Cases` |
| `Developer Name` | **Immutable after save.** Use consistent conventions, e.g. `Case_Channel`. Cannot contain spaces. |
| `Salesforce Object` (RelatedEntityType) | The API name of the SObject to route, e.g. `Case` |

**Common SObject values for RelatedEntityType:**

| SObject | Notes |
|---|---|
| `Case` | Standard case routing |
| `LiveChatTranscript` | Live Agent / Live Chat |
| `MessagingSession` | Messaging for In-App and Web, SMS |
| `VoiceCall` | Omni-Channel Voice (telephony) |
| Custom object API name | e.g. `My_Object__c` |

**Post-creation:** The `ServiceChannel` record has a `DeveloperName` field that is read-only in the UI after creation. Any SOQL or Apex referencing the channel should use `ServiceChannel.DeveloperName` or the record `Id`.

---

## Step 3: Create Presence Statuses

A `PresenceStatus` defines a named availability state for agents. Agents select a presence status from the OmniChannel widget; routing only flows to agents in statuses linked to the relevant `ServiceChannel`.

**Setup path:** Setup → OmniChannel → Presence Statuses → New

**Fields:**

| Field | Values | Notes |
|---|---|---|
| `Status Name` | e.g. `Available - Cases` | Display label |
| `Developer Name` | e.g. `Available_Cases` | Must be unique |
| `Status Options` | `Online`, `Busy` | `Online` = agents can receive work; `Busy` = agents cannot |
| `Service Channels` | Multi-select | **Link at least one channel here** — omitting this means agents in this status receive no work |

**Common patterns:**
- Create a single `Available` status linked to all channels (generalist agents)
- Create channel-specific statuses (e.g. `Available - Cases`, `Available - Chat`) for specialist agents
- Create `Break`, `Training`, `Away` statuses with **no channels** linked — agents in these statuses are present but receive no work

---

## Step 4: Create Presence Configurations (ServicePresenceConfig)

A Presence Configuration sets the total capacity units for agents assigned to it. This is the ceiling: no more work routes to an agent once their capacity is exhausted.

**Setup path:** Setup → OmniChannel → Presence Configurations → New

**Fields:**

| Field | Notes |
|---|---|
| `Name` | Display label, e.g. `Standard Agent Config` |
| `Configured Capacity` | Total capacity units, e.g. `10`. An agent with capacity 10 can handle five work items each costing 2 units. |
| `Assign to Profiles/Permission Sets` | Controls which agents use this configuration |

**Capacity planning guidance:**
- Start with total capacity = (max concurrent work items) × (average capacity units per channel)
- Use a higher capacity config for senior agents, lower for trainees
- Use `AgentCapacityOverride` for per-agent exceptions rather than creating many configurations

---

## Step 5: Set Up Queues and QueueSobject

Queues are the holding pool for work items. OmniChannel pulls work from queues and routes to agents. Each queue must be linked to the SObject it handles via `QueueSobject`.

**Setup path:** Setup → Queues → New

**Required:**
- `Label` and `Queue Name`
- `Supported Objects`: add the SObject type (e.g. `Case`) — this creates the `QueueSobject` record automatically
- `Queue Members`: add agents, public groups, or roles who are members (used for manual assignment; OmniChannel routing ignores queue membership — it routes to agents by presence and capacity)

**Verification query:**

```soql
SELECT Id, QueueId, SobjectType
FROM QueueSobject
WHERE QueueId = '<queue-id>'
```

If this returns no rows for `Case`, the queue will not receive Case routing from OmniChannel even if the `RoutingConfiguration` references it.

---

## Step 6: Create Routing Configurations

A `RoutingConfiguration` defines the routing model, capacity cost, and priority for work routed through a channel.

**Setup path:** Setup → OmniChannel → Routing Configurations → New

**Fields:**

| Field | Options / Notes |
|---|---|
| `Routing Configuration Name` | Display label |
| `Developer Name` | Unique name |
| `Routing Model` | `MostAvailable`, `LeastActive`, `ExternalRouting` |
| `Units of Capacity` | Capacity units consumed per work item (e.g. `2`) |
| `Routing Priority` | Integer; lower = higher priority. Work items with lower numbers route first. |
| `Overflow Assignee` | Queue or user to receive work when no agents available and overflow is triggered |

**Associating with a queue:**
- Navigate to Setup → Queues → open the queue record
- Set `Routing Configuration` field to the new config
- One queue maps to one routing configuration; one routing configuration can be referenced by multiple queues

---

## Step 7: Assign Presence Statuses to Users

Agents must be granted access to presence statuses before they can select them in the OmniChannel widget.

**Via Profile:**
- Setup → Profiles → [profile] → Service Presence Statuses → add statuses

**Via Permission Set (preferred):**
- Setup → Permission Sets → [perm set] → Service Presence Statuses → add statuses
- Assign the permission set to agents

---

## Step 8: Permission Sets for OmniChannel Roles

| Permission Set / Feature | Who Needs It | Notes |
|---|---|---|
| `OmniChannelAgent` (built-in perm) | All routing agents | Included in Service Cloud User profile. Grants access to OmniChannel utility bar widget. |
| `OmniChannelSupervisor` | Supervisors | Required to access OmniSupervisor app and see real-time queue/agent data. |
| `View Setup and Configuration` | Admins | Required to create/modify ServiceChannels and RoutingConfigurations in Setup. |
| Presence Status assignment | Agents | Granted per profile or permission set as described above. |

---

## Enabling Unified Routing

Unified Routing is the next-generation routing engine. It replaces classic queue-based routing for supported channels and adds AI-based classification.

**Prerequisites:**
- OmniChannel enabled (Step 1 above)
- **Messaging for In-App and Web** or **Digital Engagement** add-on license
- Summer '22 or later (API v55.0+)

**Enablement path:**
1. Setup → Routing → Unified Routing → Enable Unified Routing
2. For each channel to migrate: open the `ServiceChannel`, set `Is Enabled for Unified Routing = true`
3. Create `RoutingConfiguration` records through the Unified Routing setup UI — these support additional fields not available in classic routing (e.g. AI-based skill inference)
4. Classic OmniChannel routing configs continue to work for channels not migrated to Unified Routing

**Note:** Enabling Unified Routing for a channel mid-flight (while active chats or cases are queued) can cause in-flight `PendingServiceRouting` records to stall. Perform migrations during maintenance windows or off-peak hours.

---

## Scratch Org Setup via Metadata

For source-driven development, OmniChannel entities can be deployed as metadata:

```
force-app/main/default/
  serviceChannels/
    Case.serviceChannel-meta.xml
  presenceStatuses/
    Available_Cases.presenceStatus-meta.xml
  routingConfigurations/
    Case_Routing.routingConfiguration-meta.xml
  presenceUserConfigs/
    Standard_Agent.presenceUserConfig-meta.xml
```

**Deployment order:** `ServiceChannel` must be deployed before `PresenceStatus` (which references channels) and before `RoutingConfiguration`. Queue association (`Routing Configuration` field on Queue) can only be set after both queue and routing config exist.

---

## Common Setup Errors

| Error | Cause | Fix |
|---|---|---|
| "No agents available" — all agents idle | Presence status not linked to ServiceChannel | Edit PresenceStatus, add the ServiceChannel to `Service Channels` |
| Work routes but no widget notification | Agent's profile missing OmniChannel permission | Add `OmniChannelAgent` permission or Service Cloud User profile |
| `FIELD_INTEGRITY_EXCEPTION` on ServiceChannel save | Attempting to update `DeveloperName` | Create a new ServiceChannel; you cannot rename after creation |
| `QueueSobject` missing | Queue created without adding the SObject | Re-open Queue in Setup, add the SObject under Supported Objects |
| Unified Routing UI missing | Add-on license not provisioned | Contact Salesforce to confirm Digital Engagement or MIAW add-on |
