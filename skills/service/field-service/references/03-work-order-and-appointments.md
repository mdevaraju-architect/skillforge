# Work Orders and Service Appointments

## WorkOrder

`WorkOrder` is the core object representing a job to be performed at a customer location. It defines what work needs to be done, for whom, and with what expected effort. The actual scheduling of that work is handled by `ServiceAppointment`.

### Creating a WorkOrder

Required and commonly used fields:

| Field | Required | Notes |
|-------|----------|-------|
| `AccountId` | Yes (strongly recommended) | Customer account |
| `ContactId` | No | Customer contact; auto-populates on ServiceAppointment |
| `Subject` | Yes | Brief description of the job |
| `Status` | Yes (has default) | Default: `New`; picklist values are customizable |
| `Priority` | No | Low / Medium / High / Critical |
| `Duration` | No | Numeric duration (used to set DurationInMinutes on ServiceAppointment) |
| `DurationType` | No | `Minutes` or `Hours`; required when Duration is set |
| `WorkTypeId` | No | Links to a WorkType template that defaults duration, skills, required resources |
| `ServiceTerritoryId` | No | Determines which territory's resources are considered |
| `Street`, `City`, `State`, `PostalCode`, `Country` | No | Job site address; used for travel time calculation |
| `StartDate` | No | Informational requested start |
| `EndDate` | No | Informational deadline |
| `Description` | No | Long-form job notes visible to mobile workers |

```apex
WorkOrder wo = new WorkOrder();
wo.AccountId = '001XXXXXXXXXXXXXXX';
wo.ContactId = '003XXXXXXXXXXXXXXX';
wo.Subject = 'HVAC Annual Maintenance';
wo.Status = 'New';
wo.Priority = 'Medium';
wo.Duration = 90;
wo.DurationType = 'Minutes';
wo.ServiceTerritoryId = '0HhXXXXXXXXXXXXXXX';
wo.Street = '456 Oak Ave';
wo.City = 'Chicago';
wo.State = 'IL';
wo.PostalCode = '60614';
wo.Country = 'US';
insert wo;
```

### WorkType

`WorkType` is a template that pre-populates duration, skills, and estimated cost on a `WorkOrder` when selected. Using `WorkType` ensures consistency across recurring job types and allows skills to be automatically added via `WorkTypeSkill` records. When `WorkOrder.WorkTypeId` is set, `WorkType` fields are copied to the work order — they can be overridden per work order if needed.

---

## WorkOrderLineItem

`WorkOrderLineItem` represents a specific task or step within a `WorkOrder`. Use `WorkOrderLineItem` when:

- A single job involves distinct phases (e.g. inspection + repair + test)
- Each phase has a different skill requirement
- Each phase needs its own `ServiceAppointment` (e.g. scheduled on different days)

Key fields:

| Field | Notes |
|-------|-------|
| `WorkOrderId` | Parent WorkOrder — required |
| `Subject` | Description of this line item |
| `Duration` / `DurationType` | Duration for this specific task |
| `Status` | Independent from parent WorkOrder status |
| `LineItemNumber` | Auto-generated sequence number |

A `ServiceAppointment` linked to a `WorkOrderLineItem` (via `ParentRecordId`) represents the appointment for that specific task. The line item's `Duration` should drive the appointment's `DurationInMinutes`, not the parent `WorkOrder.Duration`.

---

## SkillRequirement

Add `SkillRequirement` records to specify what capabilities a technician must have to handle the job.

```apex
SkillRequirement sr = new SkillRequirement();
sr.ParentRecordId = wo.Id; // or WorkOrderLineItem Id
sr.SkillId = '0eTXXXXXXXXXXXXXXX'; // Id of Skill record
sr.SkillLevel = 3; // Optional; minimum level required
insert sr;
```

If `SkillLevel` is null on the `SkillRequirement`, the scheduler only checks for skill presence (any level). If the `SchedulingPolicy` has skill level matching disabled, `SkillLevel` on the requirement is ignored entirely.

---

## ServiceAppointment

`ServiceAppointment` is the schedulable, dispatchable unit. It records when the appointment is booked, who is assigned, and tracks the field technician's real-time status.

### Required Fields

| Field | Required | Notes |
|-------|----------|-------|
| `ParentRecordId` | Yes | WorkOrder or WorkOrderLineItem |
| `DurationInMinutes` | Yes (effectively) | Zero or null breaks Gantt rendering |
| `EarliestStartPermitted` | Yes (for scheduling window) | Window open for scheduler |
| `DueDate` | Yes (for SLA) | Deadline; used by scheduler for SLA optimization |
| `ServiceTerritoryId` | Recommended | If not set, appointment appears in no territory's Gantt |
| `Status` | Yes (has default) | Default: `None` |

### Setting the Time Window

The scheduling engine only schedules appointments within `[EarliestStartPermitted, DueDate]`. If the current time is past `EarliestStartPermitted` but before `DueDate`, the appointment is eligible for immediate scheduling. If `DueDate` has passed, the appointment appears as overdue in the dispatcher console.

```apex
ServiceAppointment sa = new ServiceAppointment();
sa.ParentRecordId = wo.Id;
sa.DurationInMinutes = 90; // Matches WorkOrder.Duration
sa.EarliestStartPermitted = Datetime.now();
sa.DueDate = Datetime.now().addDays(3); // 3-day SLA window
sa.ServiceTerritoryId = '0HhXXXXXXXXXXXXXXX';
sa.Status = 'None';
// Customer arrival window (shown to customer)
sa.ArrivalWindowStartTime = Datetime.now().addHours(2);
sa.ArrivalWindowEndTime = Datetime.now().addHours(4);
insert sa;
```

### Appointment Status Lifecycle

| Status | Meaning | Who/What Triggers |
|--------|---------|-------------------|
| `None` | Not yet scheduled | Initial state on creation |
| `Scheduled` | Resource assigned, time booked | Scheduler (manual drag or optimizer) |
| `Dispatched` | Sent to mobile worker | Dispatcher action or automation |
| `En Route` | Worker traveling to site | Mobile worker action in app |
| `On Site` | Worker arrived | Mobile worker action in app |
| `Completed` | Job finished | Mobile worker action in app |
| `Cannot Complete` | Job could not be finished | Mobile worker action; follow-up required |

**Status field API values:** The API values match the labels above exactly (with spaces). For example, `Status = 'En Route'` not `'EnRoute'`.

### Completing Appointments

When a mobile worker completes an appointment:
1. `ServiceAppointment.Status` changes to `Completed`
2. `ServiceAppointment.ActualEndTime` is set by the mobile app
3. `AssignedResource.ActualTravelTime` is recorded
4. The parent `WorkOrder.Status` may auto-update depending on org automation (not automatic in FSL out of the box — configure via Flow or Process Builder)

### Manual vs. Auto-Schedule

| Method | How | When to Use |
|--------|-----|-------------|
| **Manual (Gantt drag)** | Dispatcher drags from service list to Gantt slot | Ad hoc assignments, override situations |
| **Schedule action** | Dispatcher clicks "Schedule" on appointment; system finds best slot | Single appointment scheduling with candidate suggestion |
| **Appointment Booking API** | Expose candidate slots to customer for self-service | Customer-facing scheduling (Experience Cloud portals, etc.) |
| **Bulk optimization** | Run optimization for territory/day; system reschedules all unscheduled | Nightly batch scheduling for next day |

### Appointment Booking Slots API

For customer self-scheduling, the `appointmentBookingSlots` Apex API (or equivalent REST endpoint) returns available time slots for a given `ServiceAppointment`:

```apex
// Pseudocode — actual class is FSL managed package class
List<FSL.AppointmentBookingSlot> slots = FSL.AppointmentBookingService.getSlots(
    sa.Id,           // ServiceAppointment Id
    schedulingPolicyId,
    operatingHoursId,
    false            // false = return all slots; true = respect preferred resources only
);
```

Each slot contains `StartTime`, `EndTime`, `Grade` (quality score), and optionally `ServiceResourceId` (if a specific resource is identified). The customer selects a slot, and the integration calls the scheduling action to lock in the appointment.

---

## Common WorkOrder / ServiceAppointment Mistakes

1. **Setting WorkOrder.Status = 'Completed' without updating ServiceAppointment** — The Gantt continues to show the appointment as open. Always update `ServiceAppointment.Status` to `Completed` when closing the work order.

2. **Not setting DurationInMinutes** — The appointment is created with a zero-width Gantt block. The scheduler may technically schedule it, but travel time calculation produces incorrect results.

3. **Omitting EarliestStartPermitted and DueDate** — The appointment has no scheduling window and the optimizer skips it or places it arbitrarily. Always set both fields.

4. **Linking ServiceAppointment to WorkOrder instead of WorkOrderLineItem when multi-step** — If a job has line items, link each appointment to the relevant line item so completion tracking works at the right granularity.

5. **Not setting ServiceTerritoryId on ServiceAppointment** — The appointment does not appear in any territory's dispatcher console. A territory must be assigned for the appointment to be visible to dispatchers.
