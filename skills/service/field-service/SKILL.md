---
name: service-field-service
description: >-
  WorkOrder, WorkOrderLineItem, ServiceAppointment, AssignedResource, ServiceResource,
  ServiceTerritory, ServiceTerritoryMember, ResourceAbsence, ResourcePreference,
  SkillRequirement, Skill, ServiceCrewMember, ServiceCrew, OperatingHours, TimeSlot,
  SchedulingPolicy, AppointmentTopicTimePolicy, FSL, Field Service Lightning,
  dispatcher console, Gantt, appointment booking, workforce scheduling, mobile worker,
  service territory, travel time, appointment status, shift management, crew management
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: service
  module: field-service
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Salesforce Field Service (FSL) Skill

Salesforce Field Service Lightning (FSL) manages the full lifecycle of field work: creating jobs (WorkOrder), scheduling visits (ServiceAppointment), assigning technicians (AssignedResource, ServiceResource), managing territories (ServiceTerritory, ServiceTerritoryMember), tracking skills (Skill, SkillRequirement, ServiceResourceSkill), and dispatching from the Gantt console. This skill covers the key objects, relationships, gotchas, and workflows needed to build, extend, and troubleshoot FSL implementations.

## Reference Files

| File | Contents |
|------|----------|
| [references/01-architecture.md](references/01-architecture.md) | Object model, relationship diagram, key field tables, status state machine |
| [references/02-setup-and-permissions.md](references/02-setup-and-permissions.md) | Package installation, permission sets, ServiceResource/Territory setup, OperatingHours, SchedulingPolicy |
| [references/03-work-order-and-appointments.md](references/03-work-order-and-appointments.md) | WorkOrder fields, WorkOrderLineItem, ServiceAppointment creation, time windows, status lifecycle |
| [references/04-resources-and-territories.md](references/04-resources-and-territories.md) | ServiceResource, ServiceTerritoryMember, ResourceAbsence, ServiceResourceSkill, crew management, ResourcePreference |
| [references/05-scheduling-and-dispatcher.md](references/05-scheduling-and-dispatcher.md) | Dispatcher console, Gantt, scheduling actions, SchedulingPolicy, optimization, appointment booking API |

---

## Gotchas

### 1. `ServiceResource` is not a User — it is a separate object that wraps a User

`ServiceResource.RelatedRecordId` points to the User record. A User must have a corresponding `ServiceResource` record to appear in the dispatcher console or receive appointments. Creating a User without a `ServiceResource` (or with `ServiceResource.IsActive = false`) means the user is invisible to scheduling. The `ServiceResource.ResourceType` field must be set to `T` (Technician) or `C` (Crew); do not leave it null. When deactivating a worker, set `ServiceResource.IsActive = false` rather than deactivating the User, to preserve the historical appointment record.

### 2. `ServiceAppointment` is the schedulable unit — not `WorkOrder`

`WorkOrder` is the job to be done; `ServiceAppointment` is when and who will do it. One `WorkOrder` can have multiple `ServiceAppointment` records (e.g. initial visit + follow-up). `ServiceAppointment.ParentRecordId` links back to the `WorkOrder` or `WorkOrderLineItem`. The optimizer, Gantt, and dispatcher console all operate on `ServiceAppointment` — not `WorkOrder`. When integrations close a `WorkOrder` without touching `ServiceAppointment`, the Gantt continues to show open blocks and capacity analytics are wrong.

### 3. `AssignedResource` is the junction between `ServiceAppointment` and `ServiceResource`

One `ServiceAppointment` can have multiple `AssignedResource` records (for crew-based jobs). `AssignedResource.ServiceResourceId` is required; `AssignedResource.ServiceAppointmentId` is required. Do not put resource assignment directly on `ServiceAppointment` fields — use `AssignedResource`. The first `AssignedResource` inserted for an appointment is typically marked `AssignedResource.IsRequiredResource = true` (the lead technician). Deleting all `AssignedResource` records for a `Scheduled` appointment does not automatically revert the appointment to `None` status — update `ServiceAppointment.Status` explicitly.

### 4. `ServiceTerritoryMember` is how a `ServiceResource` belongs to a territory — not a direct lookup

`ServiceTerritoryMember.ServiceResourceId` + `ServiceTerritoryMember.ServiceTerritoryId` is the junction. A resource can belong to multiple territories with different `TerritoryType` values: `P` = Primary, `S` = Secondary, `R` = Relocation. Resources without a Primary (`P`) territory assignment do not appear in their territory's Gantt. `ServiceTerritoryMember.EffectiveStartDate` and `EffectiveEndDate` control active membership windows — a resource with an expired membership is treated as if they do not belong to the territory.

### 5. `SkillRequirement` on `WorkOrder`/`WorkOrderLineItem` links to `Skill` — not to the user directly

`SkillRequirement.SkillId` references a `Skill` record (the skill definition). `ServiceResourceSkill` (a separate object) links a `Skill` to a `ServiceResource`. The scheduling engine matches `SkillRequirement` on the work order to `ServiceResourceSkill` on the resource. Missing either record means skill matching fails silently — the optimizer simply ignores skill requirements if no `SkillRequirement` records exist, and assigns any available resource. `ServiceResourceSkill.SkillLevel` can be compared against `SkillRequirement.SkillLevel` when the scheduling policy has skill level matching enabled.

### 6. `ServiceAppointment.Status` lifecycle: `None → Scheduled → Dispatched → En Route → On Site → Completed → Cannot Complete`

Transitions should follow this order. Setting `Status = Completed` without going through `En Route → On Site` breaks travel time calculations and is a common data quality issue in integrations that close appointments in bulk. The `SchedStartTime` and `SchedEndTime` fields are populated by the scheduling engine when the appointment is scheduled; `ActualStartTime` and `ActualEndTime` are populated by mobile workers checking in/out. Never overwrite `ActualStartTime`/`ActualEndTime` from an integration unless you are also correcting travel time records.

### 7. `OperatingHours` must be linked to `ServiceTerritory` for scheduling window enforcement

`ServiceTerritory.OperatingHoursId` points to the `OperatingHours` record. Without this link, the scheduling engine has no time window constraint and may schedule appointments outside of business hours. `OperatingHours.TimeZone` must match the territory's timezone — a mismatch causes appointments to be scheduled at the wrong local time (shifts appear correct in UTC but are offset by the timezone delta). `TimeSlot` child records on `OperatingHours` define the actual day-of-week windows.

### 8. `ResourceAbsence` blocks a resource from being scheduled during a time window

`ResourceAbsence.ResourceId`, `Start`, `End`, and `AbsenceType` are required. The scheduling engine respects `ResourceAbsence` records — it will not schedule appointments that overlap. Do not model absences as `ServiceAppointment` records (a common workaround) — it produces misleading Gantt views and breaks capacity analytics. `AbsenceType` is a picklist: values include `Vacation`, `Training`, `Medical`, and org-specific custom values. `ResourceAbsence` records are visible on the Gantt as blocked time blocks but are not included in appointment count or utilization metrics.

### 9. `SchedulingPolicy` governs the optimizer's behavior — the default policy may not fit your use case

`SchedulingPolicy` includes settings for travel time optimization, skill matching weight, SLA priority weight, customer preferred window weight, and whether to minimize travel time vs. maximize utilization. The default policy shipped with FSL package installation optimizes for travel time, which may not align with SLA-heavy service contracts. Changing a `SchedulingPolicy` affects all future scheduling operations that reference it. Test policy changes in a sandbox before applying to production. The `SchedulingPolicy` is referenced in `ServiceTerritory.SchedulingPolicyId` as the territory default and can be overridden per scheduling operation.

### 10. `ServiceAppointment.DurationInMinutes` is required and drives Gantt block size

If `DurationInMinutes = 0` or null, the appointment appears as a zero-width block on the Gantt and the travel time calculation fails. Always derive duration from `WorkOrder.Duration` (converted to minutes) or set it explicitly on the `ServiceAppointment`. `WorkOrderLineItem` can have its own `Duration` that differs from the parent `WorkOrder` — when a `ServiceAppointment` is linked to a `WorkOrderLineItem` via `ParentRecordId`, the appointment duration should reflect the line item duration, not the parent work order total. The `DurationInMinutes` field is not automatically kept in sync with `WorkOrder.Duration` changes after the appointment is created.

### 11. The FSL dispatcher console requires the `Field Service Dispatcher` permission set

The Gantt, optimization console, and scheduling actions are gated behind the `Field Service Dispatcher` permission set (managed package permission set). Mobile workers need the `Field Service Agent` permission set (or `Field Service Mobile` in some package versions). Admins need `Field Service Admin`. The standard Service Cloud permission sets (`Service Cloud User`) do not grant access to FSL objects and the dispatcher console — they must be stacked with FSL-specific permission sets. License assignment alone (Field Service license) is not sufficient without the matching permission set assignment.

### 12. `ResourcePreference` records express customer preference for specific technicians — the optimizer respects but does not guarantee them

`ResourcePreference.ServiceResourceId` + `ResourcePreference.AccountId` (or `ContactId`) + `PreferenceType` (`Preferred`, `Excluded`, `Required`) configures preferences. `Required` preference causes scheduling failure if the preferred resource is unavailable during the appointment window — the appointment becomes unschedulable and will surface as an error in the dispatcher console. `Excluded` prevents the named resource from being assigned regardless of availability. Test `Required` preferences carefully in sandbox before deploying; they are the most common cause of mysteriously unschedulable appointments in production.

---

## Workflows

### Workflow 1: Set up a new service territory and resource

**Goal:** Add a new geographic service territory, create operating hours, link them, create a technician `ServiceResource` from an existing User, and assign the resource to the territory.

**Steps:**

1. **Create `OperatingHours`** — set `Name`, `TimeZone` (must match the territory's local timezone, e.g. `America/Chicago`). Add child `TimeSlot` records for each working day (e.g. Monday–Friday, 08:00–17:00 local).

2. **Create `ServiceTerritory`** — set `Name`, `IsActive = true`, `OperatingHoursId` (link to the `OperatingHours` created above). Optionally set `Address` to anchor the territory's home base for travel time calculation.

3. **Assign a `SchedulingPolicy`** — set `ServiceTerritory.SchedulingPolicyId` to an existing policy or use the org default. If a custom policy is needed, create it in FSL Settings → Scheduling Policies before this step.

4. **Create `ServiceResource`** — query the User's Id, then insert a `ServiceResource` record with `RelatedRecordId = <UserId>`, `ResourceType = T` (Technician), `IsActive = true`, `Name` = technician's display name.

5. **Assign required FSL permission sets to the User** — assign `Field Service Agent` (and optionally `Field Service Mobile`) to the User record so they can access the mobile app.

6. **Create `ServiceTerritoryMember`** — insert with `ServiceResourceId`, `ServiceTerritoryId`, `TerritoryType = P` (Primary), `EffectiveStartDate = today`. The resource now appears in the territory's Gantt.

7. **Add skills** — create or look up the relevant `Skill` records. Insert `ServiceResourceSkill` records linking the `ServiceResource` to each `Skill`, with `SkillLevel` and optional `AcquiredSkillCertification` / `ExpirationDate`.

**Verification:** Open the dispatcher console, navigate to the territory, confirm the technician appears in the resource list and Gantt for today's date.

---

### Workflow 2: Create a WorkOrder and schedule a ServiceAppointment

**Goal:** Create a work order for a customer, add a skill requirement, create a service appointment with a time window, and schedule it to an available technician.

**Steps:**

1. **Create `WorkOrder`** — required fields: `AccountId`, `ContactId` (optional but recommended), `Subject`, `Status` (e.g. `New`), `Priority` (e.g. `Medium`), `Duration` (e.g. `60` minutes), `DurationType` (e.g. `Minutes`). Link a `WorkType` if your org uses work type templates.

2. **Add `SkillRequirement`** (if skills-based scheduling is active) — insert `SkillRequirement` with `ParentRecordId = <WorkOrderId>`, `SkillId = <SkillId>`, and optionally `SkillLevel`.

3. **Create `ServiceAppointment`** — required fields: `ParentRecordId = <WorkOrderId>`, `DurationInMinutes = 60` (must match or derive from `WorkOrder.Duration`), `EarliestStartPermitted` (the earliest the customer can be visited), `DueDate` (the SLA deadline). Set `Status = None` initially.

4. **Book or schedule the appointment** — options:
   - **Manual (dispatcher console):** Drag the appointment from the service list onto a technician's Gantt slot.
   - **Candidate API:** Use the `appointmentBookingSlots` Apex API (or REST equivalent) to retrieve available time slots for customer self-scheduling.
   - **Auto-schedule (optimizer):** Run the schedule optimization action from the dispatcher console for the territory.

5. **Confirm `AssignedResource` creation** — after scheduling, query `AssignedResource` where `ServiceAppointmentId = <appointmentId>`. Confirm `ServiceResourceId` is populated.

6. **Dispatch the appointment** — update `ServiceAppointment.Status = Dispatched` to notify the mobile worker. The FSL mobile app shows dispatched appointments in the worker's queue.

**Verification:** Open the dispatcher console Gantt, confirm the appointment block appears at the correct time on the correct technician's row.

---

### Workflow 3: Dispatcher manages the Gantt and handles an appointment reschedule

**Goal:** A dispatcher needs to reschedule an existing `Dispatched` appointment because the technician called in sick. Use `ResourceAbsence` to block the technician and reassign the appointment.

**Steps:**

1. **Create `ResourceAbsence`** — insert with `ResourceId = <ServiceResourceId>`, `AbsenceType = Medical` (or appropriate type), `Start = today 00:00`, `End = today 23:59`. The Gantt immediately shows the blocked time for this technician.

2. **Find the affected appointment** — in the dispatcher console, filter the service list for today's appointments with `Status = Dispatched` assigned to the sick technician. Alternatively, SOQL: `SELECT Id, Status, SchedStartTime FROM ServiceAppointment WHERE SchedStartTime = TODAY AND Status = 'Dispatched'`.

3. **Unschedule the appointment** — update `ServiceAppointment.Status = None` and delete the existing `AssignedResource` record(s) for the appointment. This returns the appointment to the unscheduled service list.

4. **Reassign via dispatcher console** — drag the appointment from the unscheduled list onto a different technician's available Gantt slot, or use the **Schedule** action button on the appointment record. A new `AssignedResource` record is created automatically.

5. **Update `Status` to `Scheduled` → `Dispatched`** — once the new technician is confirmed, set `ServiceAppointment.Status = Dispatched` to push the updated appointment to the new technician's mobile app.

6. **Notify the customer** — trigger any notification flow or email alert associated with the appointment reschedule (typically a Process Builder / Flow on `ServiceAppointment` status change).

**Verification:** Confirm the Gantt shows the appointment on the new technician's row, the original technician's row shows the `ResourceAbsence` block, and the mobile worker's app queue is updated.

---

## Not Covered by This Skill

The following topics are explicitly out of scope:

- **FSL optimization engine deep configuration** — scheduling policy weight tuning, travel time algorithm selection (straight-line vs. road-network), optimization window and horizon configuration, and bulk optimization API
- **Mobile App customization** — custom quick actions on the FSL mobile app, offline sync configuration, mobile app branding, and push notification setup
- **IoT-triggered work orders** — Asset management, IoT event-to-WorkOrder automation, and Connected Field Service integration
- **Preventive maintenance plans** — `MaintenancePlan`, `MaintenanceAsset`, and auto-generation of work orders on a recurring schedule
