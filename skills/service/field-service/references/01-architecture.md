# FSL Architecture: Object Model and Data Relationships

## Object Hierarchy Overview

```
WorkOrder
├── WorkOrderLineItem (1..*)
│   ├── ServiceAppointment (1..*, via ParentRecordId)
│   │   └── AssignedResource (1..*, junction to ServiceResource)
│   └── SkillRequirement (0..*, links to Skill)
├── ServiceAppointment (1..*, via ParentRecordId)
│   └── AssignedResource (1..*, junction to ServiceResource)
└── SkillRequirement (0..*, links to Skill)

ServiceResource (wraps User via RelatedRecordId)
├── ServiceTerritoryMember (junction to ServiceTerritory)
├── ServiceResourceSkill (junction to Skill)
├── ResourceAbsence (time blocks)
└── AssignedResource (junction to ServiceAppointment)

ServiceTerritory
├── ServiceTerritoryMember (junction to ServiceResource)
└── OperatingHours (via OperatingHoursId)
    └── TimeSlot (child records: day-of-week windows)

ServiceCrew
└── ServiceCrewMember (junction: ServiceCrew + ServiceResource)

SchedulingPolicy
└── Referenced by ServiceTerritory.SchedulingPolicyId

ResourcePreference
└── Links Account/Contact to ServiceResource with preference type

AppointmentTopicTimePolicy
└── Links appointment topics to scheduling time windows
```

---

## Core Object Relationships

### WorkOrder → ServiceAppointment

`ServiceAppointment.ParentRecordId` is a polymorphic lookup field that can point to either a `WorkOrder` or a `WorkOrderLineItem`. When linked to a `WorkOrderLineItem`, the appointment covers only that line item's scope. When linked directly to the `WorkOrder`, it covers the whole job. The relationship is many-to-one in practice (many appointments per work order for multi-visit jobs) but each appointment has exactly one parent.

### ServiceAppointment → AssignedResource → ServiceResource

`AssignedResource` is the junction object between `ServiceAppointment` and `ServiceResource`. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `ServiceAppointmentId` | Lookup(ServiceAppointment) | Required |
| `ServiceResourceId` | Lookup(ServiceResource) | Required |
| `IsRequiredResource` | Boolean | True for the lead technician on a crew job |
| `ServiceTerritoryMemberId` | Lookup(ServiceTerritoryMember) | Auto-populated by scheduler |
| `ActualTravelTime` | Number | Travel time in minutes (populated after check-in) |
| `EstimatedTravelTime` | Number | Travel time estimated at scheduling time |

### ServiceResource → ServiceTerritoryMember → ServiceTerritory

A `ServiceResource` is linked to territories via `ServiceTerritoryMember`. Multiple memberships are allowed. `TerritoryType` values:

| Value | Label | Behavior |
|-------|-------|----------|
| `P` | Primary | Resource appears in territory Gantt; used for home-base travel time |
| `S` | Secondary | Resource can receive appointments from this territory |
| `R` | Relocation | Temporary reassignment; used for field deployments |

Only one `Primary` membership should be active at a time. The scheduler uses the primary territory for travel origin calculation.

### ServiceResource → ServiceResourceSkill → Skill

`ServiceResourceSkill` bridges `ServiceResource` and `Skill`. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `ServiceResourceId` | Lookup(ServiceResource) | Required |
| `SkillId` | Lookup(Skill) | Required |
| `SkillLevel` | Number(18, 0) | Optional; compared against SkillRequirement.SkillLevel |
| `AcquiredSkillCertification` | String | Certification reference |
| `ExpirationDate` | Date | Skill expires on this date; expired skills are not matched |

### SkillRequirement → Skill (on WorkOrder / WorkOrderLineItem)

`SkillRequirement.ParentRecordId` can point to `WorkOrder` or `WorkOrderLineItem`. When the scheduler evaluates candidates, it queries all `SkillRequirement` records for the parent work object and checks each technician's `ServiceResourceSkill` records. If `SkillRequirement.SkillLevel` is set, the technician's `ServiceResourceSkill.SkillLevel` must be greater than or equal to the requirement level (when skill level matching is enabled in the `SchedulingPolicy`).

---

## Key Field Tables

### WorkOrder Key Fields

| Field API Name | Type | Notes |
|----------------|------|-------|
| `AccountId` | Lookup(Account) | Customer account |
| `ContactId` | Lookup(Contact) | Customer contact |
| `Subject` | String(255) | Job description |
| `Status` | Picklist | New, In Progress, Completed, Cannot Complete, Closed, On Hold, etc. |
| `Priority` | Picklist | Low, Medium, High, Critical |
| `Duration` | Number | Duration in DurationType units |
| `DurationType` | Picklist | Minutes, Hours |
| `WorkTypeId` | Lookup(WorkType) | Template-based default duration and skills |
| `ServiceTerritoryId` | Lookup(ServiceTerritory) | Determines which territory handles this job |
| `Address` | Compound | Job site address used for travel time calculation |
| `StartDate` | DateTime | Requested start (informational; ServiceAppointment drives scheduling) |
| `EndDate` | DateTime | Requested completion |

### ServiceAppointment Key Fields

| Field API Name | Type | Notes |
|----------------|------|-------|
| `ParentRecordId` | Polymorphic Lookup | Points to WorkOrder or WorkOrderLineItem |
| `AccountId` | Lookup(Account) | Auto-populated from parent WorkOrder |
| `ContactId` | Lookup(Contact) | Auto-populated from parent WorkOrder |
| `Status` | Picklist | See state machine below |
| `DurationInMinutes` | Number | Required; drives Gantt block size |
| `EarliestStartPermitted` | DateTime | Scheduling window open |
| `DueDate` | DateTime | SLA deadline for scheduling window close |
| `SchedStartTime` | DateTime | Scheduled start (set by scheduler) |
| `SchedEndTime` | DateTime | Scheduled end (set by scheduler) |
| `ActualStartTime` | DateTime | Mobile worker check-in time |
| `ActualEndTime` | DateTime | Mobile worker check-out time |
| `ArrivalWindowStartTime` | DateTime | Customer-facing arrival window start |
| `ArrivalWindowEndTime` | DateTime | Customer-facing arrival window end |
| `ServiceTerritoryId` | Lookup(ServiceTerritory) | Territory that owns the appointment |
| `AppointmentNumber` | Auto Number | System-generated reference |

### ServiceResource Key Fields

| Field API Name | Type | Notes |
|----------------|------|-------|
| `Name` | String | Display name in dispatcher console |
| `RelatedRecordId` | Lookup(User) | The linked User record |
| `ResourceType` | Picklist | T = Technician, C = Crew |
| `IsActive` | Boolean | False = invisible to scheduler and Gantt |
| `Latitude` | Number | Last known location (updated by mobile app) |
| `Longitude` | Number | Last known location (updated by mobile app) |
| `IsOptimizationCapable` | Boolean | Whether the resource participates in optimization |

---

## ServiceAppointment Status State Machine

```
None
  │
  ▼  (scheduler assigns resource)
Scheduled
  │
  ▼  (dispatcher dispatches to mobile)
Dispatched
  │
  ▼  (mobile worker starts travel)
En Route
  │
  ▼  (mobile worker arrives on site)
On Site
  │
  ├─▶ Completed       (work finished successfully)
  └─▶ Cannot Complete (work could not be completed; follow-up required)
```

**Notes on transitions:**
- `None → Scheduled`: Triggered by scheduler creating `AssignedResource` and setting `SchedStartTime` / `SchedEndTime`.
- `Scheduled → Dispatched`: Dispatcher action or automation; pushes notification to mobile worker.
- `Dispatched → En Route`: Mobile worker taps "Start Travel" in the FSL mobile app; sets `ActualStartTime`.
- `En Route → On Site`: Mobile worker taps "Arrive" in the mobile app.
- `On Site → Completed`: Mobile worker taps "Complete"; sets `ActualEndTime`.
- `On Site → Cannot Complete`: Mobile worker indicates job could not be finished; typically triggers a follow-up `WorkOrder` or `Case`.
- A `Completed` appointment cannot be moved back to earlier states without custom logic.
- A `Scheduled` appointment can be moved back to `None` (unscheduled) by deleting its `AssignedResource` records and resetting status — this is the reschedule path.
