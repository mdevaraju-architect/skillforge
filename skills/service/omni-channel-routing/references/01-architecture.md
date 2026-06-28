# OmniChannel Architecture: Object Model and State Machine

## Object Model Overview

OmniChannel routing is built on a layered graph of Salesforce objects. Understanding how they connect is essential for diagnosing routing failures, configuring new channels, and writing supervisor queries correctly.

```
ServiceChannel
  └── RelatedEntityType (Case, LiveChatTranscript, MessagingSession, etc.)
  └── links to → PresenceStatus (via PresenceStatusChannel junction)

PresenceStatus
  └── linked to ServiceChannels (agents in this status can receive work from those channels)
  └── IsAvailable (true = agent receives work)

ServicePresenceConfig (Presence Configuration)
  └── ConfiguredCapacity (total capacity units for agents in this config)
  └── assigned to → User (via Profile or Permission Set)

Queue
  └── QueueSobject (links queue to SObject type, e.g. Case)
  └── RoutingConfiguration (associated routing config)

RoutingConfiguration
  └── RoutingModel (MostAvailable, LeastActive, ExternalRouting)
  └── Capacity (units consumed per work item)
  └── RoutingPriority (lower = higher priority)
  └── associated with → Queue
  └── RoutingAttribute (skills requirements, linked to RoutingAttributeDefinition)

RoutingAttributeDefinition
  └── DataType (Text, Numeric, Boolean)
  └── DeveloperName

RoutingAttribute
  └── RoutingConfiguration
  └── RoutingAttributeDefinition
  └── IsRequired

AgentCapacityOverride (agent skill assignment)
  └── UserId
  └── RoutingAttributeDefinitionId
  └── Value / SkillLevel

PendingServiceRouting
  └── WorkItemId (the Case, Chat, etc.)
  └── RoutingConfigurationId
  └── IsReadyForRouting

AgentWork
  └── UserId (the agent)
  └── WorkItemId (Case, LiveChatTranscript, etc.)
  └── ServiceChannelId
  └── Status (Assigned, Opened, Accepted, Declined, Closed)
  └── HandleTime (seconds, populated on close)

UserServicePresence
  └── UserId
  └── ServicePresenceStatusId
  └── ConfiguredCapacity
  └── IsCurrentState
  └── ActiveTime
```

## AgentWork Status State Machine

```
                  ┌─────────────────────────────────────────┐
                  │                                         │
  [Work item      │                                         ▼
   enters queue]──► Assigned ──► Opened ──► Accepted ──► Closed
                       │                      │
                       └──────────────────────┤
                                              ▼
                                           Declined ──► [New PendingServiceRouting created]
                                                          └──► Assigned (re-routed)
```

**State descriptions:**

| Status | Meaning | Who/What Sets It |
|---|---|---|
| `Assigned` | Work routed to agent; agent not yet interacted | Platform (routing engine) |
| `Opened` | Agent opened the work item record/tab | Platform (on record open) |
| `Accepted` | Agent explicitly accepted in OmniChannel widget | Agent action |
| `Declined` | Agent declined; triggers re-routing | Agent action or supervisor |
| `Closed` | Work complete | Platform (on work item close) or supervisor |

**Key rules:**
- Transitions must follow the lifecycle. Setting `Status = Accepted` directly without going through `Assigned` is unsupported.
- Setting `Status = Declined` on an `Assigned` or `Opened` record triggers a new `PendingServiceRouting` — the work is not lost.
- Setting `Status = Closed` directly via Apex or supervisor is allowed but should only be done when the underlying work item is also closed.
- `HandleTime` is computed by the platform when `Status` transitions to `Closed`. Do not attempt to set it manually.

## Key Field Reference Tables

### ServiceChannel

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `DeveloperName` | String | **Immutable after creation** |
| `MasterLabel` | String | Display name |
| `RelatedEntityType` | String | SObject API name (e.g. `Case`, `LiveChatTranscript`, `MessagingSession`) |
| `ShouldSkipAdditionalMinutes` | Boolean | Skip minimum interaction time |
| `IsInteractionChannel` | Boolean | True for digital/messaging channels |

### RoutingConfiguration

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `DeveloperName` | String | Unique name |
| `MasterLabel` | String | Display name |
| `RoutingModel` | Picklist | `MostAvailable`, `LeastActive`, `ExternalRouting` |
| `Capacity` | Integer | Capacity units consumed per work item |
| `RoutingPriority` | Integer | Lower number = higher priority |
| `OverflowAction` | Picklist | What to do when queue is empty/all agents busy |
| `IsUsingExternalSystem` | Boolean | True for external routing |

### AgentWork

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `UserId` | ID | Agent user |
| `WorkItemId` | ID | The routed record (Case, Chat, etc.) |
| `ServiceChannelId` | ID | Which channel |
| `RoutingConfigurationId` | ID | Which routing config was used |
| `Status` | Picklist | `Assigned`, `Opened`, `Accepted`, `Declined`, `Closed` |
| `HandleTime` | Integer | Seconds (set on close) |
| `AcceptTime` | DateTime | When agent accepted |
| `CloseTime` | DateTime | When work closed |
| `CreatedDate` | DateTime | When routing occurred |

### PendingServiceRouting

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `WorkItemId` | ID | The queued record |
| `RoutingConfigurationId` | ID | Target routing config |
| `IsReadyForRouting` | Boolean | True = ready to be assigned to an agent |
| `CreatedDate` | DateTime | When queuing started |
| `ServiceChannelId` | ID | Associated channel |

### UserServicePresence

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `UserId` | ID | Agent user |
| `ServicePresenceStatusId` | ID | Current presence status |
| `IsCurrentState` | Boolean | True = active/current record |
| `ConfiguredCapacity` | Integer | Total capacity units for this agent |
| `ActiveTime` | Integer | Seconds agent has been in this status |

### PresenceStatus

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `DeveloperName` | String | Unique name |
| `MasterLabel` | String | Display name |
| `StatusType` | Picklist | `Online`, `Busy`, `Offline` |
| `IsAvailable` | Boolean | True = agents receive work in this status |

### RoutingAttributeDefinition

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `DeveloperName` | String | e.g. `Language`, `ProductKnowledge` |
| `DataType` | Picklist | `Text`, `Numeric`, `Boolean` |
| `MasterLabel` | String | Display name |

### RoutingAttribute

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `RoutingConfigurationId` | ID | Target routing config |
| `RoutingAttributeDefinitionId` | ID | Which skill |
| `IsRequired` | Boolean | True = only agents with this skill receive work |
| `MinimumValue` | String | Minimum skill level threshold (Numeric type) |

### AgentCapacityOverride

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `UserId` | ID | Agent |
| `RoutingAttributeDefinitionId` | ID | Which skill |
| `Value` | String | Skill value (e.g. `Spanish`, `5`, `true`) |
| `StartDate` | Date | Optional — skill active from |
| `EndDate` | Date | Optional — skill active until |

### QueueSobject

| Field | Type | Notes |
|---|---|---|
| `Id` | ID | Standard |
| `QueueId` | ID | The queue |
| `SobjectType` | String | e.g. `Case`, `Lead` |

## Routing Engine Decision Flow

```
Work item enters queue
        │
        ▼
Is any agent in an eligible PresenceStatus
(status linked to this ServiceChannel, IsAvailable = true)?
        │
   No ──┴── Yes
   │              │
   ▼              ▼
Create         Are any agents below ConfiguredCapacity?
PendingService     │
Routing        No ──┴── Yes
(wait)         │              │
               ▼              ▼
           Create         Skills-based? → Match skill → Assign
           PendingService     │                           └── Create AgentWork (Assigned)
           Routing        No match
           (wait)          └──► Is skill required?
                               Yes → PendingServiceRouting
                               No  → Route to any available agent
```
