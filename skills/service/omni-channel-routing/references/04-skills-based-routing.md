# Skills-Based Routing

## Overview

Skills-based routing extends queue-based routing by matching work items to agents based on declared skill attributes. Instead of routing to any available agent in a queue, the routing engine filters candidates to only agents who possess the required skill at or above a minimum level.

**When to use skills-based routing:**
- Language specialization (e.g. route Spanish-language cases to Spanish-speaking agents)
- Product knowledge (e.g. route Enterprise-tier cases to agents certified for Enterprise products)
- Compliance (e.g. route insurance claims to licensed adjusters)
- Tiered support (e.g. route complex technical issues to Level 2 agents only)

---

## Object Chain for Skills-Based Routing

Skills-based routing requires four distinct object types to be correctly linked. Missing any single link causes silent fallback to queue routing without error.

```
RoutingAttributeDefinition  (defines the skill type and data type)
         │
         ▼
RoutingAttribute            (binds the skill requirement to a RoutingConfiguration)
  └── RoutingConfiguration
  └── RoutingAttributeDefinition
  └── IsRequired / MinimumValue

AgentCapacityOverride       (assigns a skill value to a specific agent)
  └── UserId
  └── RoutingAttributeDefinitionId
  └── Value

AgentWorkSkill              (optional — sets skill requirement on an individual work item)
  └── WorkItemId
  └── RoutingAttributeDefinitionId
  └── RequiredSkillValue
```

---

## RoutingAttributeDefinition: Skill Types

`RoutingAttributeDefinition` defines the name and data type of a skill. The `DataType` determines how skill values are compared during matching.

**Setup path:** Setup → OmniChannel → Routing Attribute Definitions → New

| Field | Notes |
|---|---|
| `MasterLabel` | Display name, e.g. `Language` |
| `DeveloperName` | API name, e.g. `Language`. Unique; used in Apex and SOQL. |
| `DataType` | `Text`, `Numeric`, `Boolean` |

### DataType Behavior

| DataType | Matching Logic | Example Values |
|---|---|---|
| `Text` | Exact string match (case-insensitive) | `Spanish`, `French`, `English` |
| `Numeric` | Agent value must be >= required value | `1` through `10` (skill level) |
| `Boolean` | Agent must have `true` | `true` / `false` |

**Text matching example:** A work item requires `Language = Spanish`. Only agents with `AgentCapacityOverride.Value = Spanish` (case-insensitive) on the `Language` definition receive this work.

**Numeric matching example:** A work item requires `TechnicalLevel = 3`. Agents with `TechnicalLevel >= 3` are eligible; agents with `TechnicalLevel = 2` or `1` are excluded.

**Boolean matching example:** A work item requires `IsLicensed = true`. Only agents with `AgentCapacityOverride.Value = true` on `IsLicensed` receive this work.

---

## RoutingAttribute: Linking Skills to RoutingConfigurations

A `RoutingAttribute` record links a `RoutingAttributeDefinition` to a specific `RoutingConfiguration`. This tells the routing engine: "when routing through this configuration, apply this skill requirement."

**Setup path:** Navigate to a `RoutingConfiguration` record → Related list: Routing Attributes → New

| Field | Notes |
|---|---|
| `RoutingConfigurationId` | The target routing configuration |
| `RoutingAttributeDefinitionId` | The skill to require |
| `IsRequired` | `true` = skill match mandatory; `false` = preferred but fallback allowed |
| `MinimumValue` | For Numeric type only — the minimum agent skill level required |
| `Priority` | Order in which multiple skills are evaluated (lower = evaluated first) |

**IsRequired behavior:**
- `IsRequired = true`: work only routes to agents with the matching skill. If no agents have the skill, work stays in `PendingServiceRouting` indefinitely (unless overflow is configured).
- `IsRequired = false`: the routing engine prefers agents with the skill, but falls back to any available agent in the queue if no skilled agent is available within the configured wait time.

**Multiple skills on one RoutingConfiguration:** You can add multiple `RoutingAttribute` records to a single `RoutingConfiguration`. The work item must satisfy all `IsRequired = true` skill requirements. If a work item has both `Language = Spanish` (required) and `TechnicalLevel >= 3` (preferred), only Spanish-speaking agents with technical level >= 3 are preferred, but a Spanish-speaking agent with level 2 is acceptable.

---

## AgentCapacityOverride: Assigning Skills to Agents

`AgentCapacityOverride` records assign skill values to individual agents. Despite the name suggesting capacity, this object also serves as the agent skill registry in OmniChannel.

**Setup path:** Setup → OmniChannel → Skills → Agent Skills → New

| Field | Notes |
|---|---|
| `UserId` | The agent user record |
| `RoutingAttributeDefinitionId` | Which skill |
| `Value` | The agent's skill value (Text, Numeric, or Boolean as string) |
| `StartDate` | Optional — skill becomes active on this date |
| `EndDate` | Optional — skill expires on this date. Expired skills are not evaluated. |

**Bulk skill assignment:** Use the Data Loader or Bulk API to create `AgentCapacityOverride` records in bulk for large agent teams. Always include `StartDate` to ensure skills activate correctly, especially when loading historical data.

**Time-bounded skills:** Set `EndDate` for certifications that expire (e.g. insurance licenses, compliance certifications). After `EndDate`, the agent no longer receives work requiring that skill — test this in sandbox with a past date before deploying.

**Verification SOQL:**

```soql
SELECT Id, UserId, User.Name, RoutingAttributeDefinition.DeveloperName, Value, StartDate, EndDate
FROM AgentCapacityOverride
WHERE RoutingAttributeDefinition.DeveloperName = 'Language'
  AND (EndDate = null OR EndDate >= TODAY)
ORDER BY User.Name
```

---

## AgentWorkSkill: Setting Skill Requirements on Work Items

`AgentWorkSkill` records attach skill requirements to a specific work item. This enables per-item skill requirements rather than applying the same requirement to all work through a configuration.

**When to use:** When skill requirements vary per work item (e.g. each Case has a `Preferred_Language__c` field that determines routing), use `AgentWorkSkill` created via Flow or Apex. When all work through a queue requires the same skill, use `RoutingAttribute` on the `RoutingConfiguration` instead.

**Creating AgentWorkSkill via Flow:**

Trigger: Record-triggered Flow on `Case` — After Save — Created

```
Action: Create Records
Object: AgentWorkSkill
Fields:
  WorkItemId = {!$Record.Id}
  RoutingAttributeDefinitionId = [Id of Language definition]
  RequiredSkillValue = {!$Record.Preferred_Language__c}
```

**Creating AgentWorkSkill via Apex:**

```apex
AgentWorkSkill aws = new AgentWorkSkill();
aws.WorkItemId = caseRecord.Id;
aws.RoutingAttributeDefinitionId = languageDefId;
aws.RequiredSkillValue = caseRecord.Preferred_Language__c;
insert aws;
```

**Timing:** `AgentWorkSkill` records must be created **before** the work item enters the routing queue. If the work item is assigned to a queue before `AgentWorkSkill` is created, the routing engine evaluates skills on routing — which may happen immediately after queue assignment. Use `Before Save` flows or synchronous Apex triggers to ensure skills are set before queue assignment.

---

## Skill Matching Algorithm

When a work item enters routing, the engine:

1. Identifies the `RoutingConfiguration` associated with the target queue
2. Loads all `RoutingAttribute` records for that configuration
3. For required skills: loads all agents in eligible `PresenceStatus` with a matching `AgentCapacityOverride` value
4. For preferred skills: loads all agents, sorts by skill match (matched agents preferred), falls back to unmatched agents if no match within timeout
5. Among skill-matched agents: applies `RoutingModel` (`MostAvailable` or `LeastActive`) to select the specific agent
6. If `AgentWorkSkill` records exist on the work item: overrides/augments the `RoutingAttribute` requirements

**Skill matching precedence:**
- `AgentWorkSkill` on the work item takes precedence over `RoutingAttribute` on the configuration for that specific item
- If both exist for the same `RoutingAttributeDefinition`, `AgentWorkSkill` wins for that skill

---

## Partial Skill Match Behavior

When `IsRequired = false` on a `RoutingAttribute`:

1. Engine first tries to find an agent with the skill match (e.g. `Language = Spanish`)
2. If no skilled agent is available within `SkillsRoutingFallbackTimeoutSeconds` (configurable, default 0 = no wait), falls back to any available agent in the queue
3. If `SkillsRoutingFallbackTimeoutSeconds > 0`, the work waits in `PendingServiceRouting` for up to that duration before falling back

**Fallback configuration in RoutingConfiguration:**

```
Routing Configuration → Routing Model configuration
  Skills Routing Fallback Timeout: 120 (seconds)
```

Setting this to 0 means immediate fallback — skilled agents are preferred only if one is available right now. Setting it to 120 means the work waits up to 2 minutes for a skilled agent before falling back.

---

## Skills Routing vs Queue Routing Combined

Skills-based routing builds on top of queue-based routing — they are not mutually exclusive. The queue determines which `RoutingConfiguration` applies; the routing configuration determines whether skills are evaluated.

**Combined model:**
- Queue A (General Support) → `RoutingConfiguration` with no `RoutingAttribute` records → pure queue-based routing
- Queue B (Specialized Support) → `RoutingConfiguration` with `Language = Spanish (required)` → skills-based routing
- An agent can be a member of both queues; skills determine which items from Queue B they receive

**Routing priority between queues:** `RoutingConfiguration.RoutingPriority` still applies. A high-priority skills-based queue routes ahead of a low-priority general queue.

---

## Testing Skills Routing in Sandbox

Skills routing is notoriously difficult to validate because failures are silent (fallback to queue). Use this validation checklist:

1. **Verify RoutingAttributeDefinition exists:**

   ```soql
   SELECT Id, DeveloperName, DataType FROM RoutingAttributeDefinition
   ```

2. **Verify RoutingAttribute links skill to the right RoutingConfiguration:**

   ```soql
   SELECT Id, RoutingConfiguration.DeveloperName, RoutingAttributeDefinition.DeveloperName,
          IsRequired, MinimumValue
   FROM RoutingAttribute
   WHERE RoutingConfiguration.DeveloperName = 'My_Case_Routing'
   ```

3. **Verify agent has the skill:**

   ```soql
   SELECT Id, User.Name, RoutingAttributeDefinition.DeveloperName, Value, StartDate, EndDate
   FROM AgentCapacityOverride
   WHERE UserId = :testAgentId
   ```

4. **Verify AgentWorkSkill on work item (if used):**

   ```soql
   SELECT Id, WorkItemId, RoutingAttributeDefinition.DeveloperName, RequiredSkillValue
   FROM AgentWorkSkill
   WHERE WorkItemId = :testCaseId
   ```

5. **Confirm routing occurred to correct agent:**

   ```soql
   SELECT Id, UserId, User.Name, WorkItemId, Status, CreatedDate
   FROM AgentWork
   WHERE WorkItemId = :testCaseId
   ORDER BY CreatedDate DESC
   LIMIT 1
   ```

6. **If routing went to wrong agent:** Check `PendingServiceRouting` for the case — if skills fallback occurred, `PendingServiceRouting.IsSkillsBasedRouting` will reflect the evaluation state. Confirm the agent who received work has (or doesn't have) the required skill.
