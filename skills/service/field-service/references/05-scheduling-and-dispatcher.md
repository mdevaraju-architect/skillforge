# Scheduling and the Dispatcher Console

## Dispatcher Console Overview

The FSL dispatcher console is the primary interface for dispatchers managing field operations. It consists of three synchronized panels:

| Panel | Description |
|-------|-------------|
| **Service List** | List of `ServiceAppointment` records — filtered by territory, date, and status. Shows unscheduled (Status = None) appointments and those needing attention |
| **Gantt** | Time-based visual grid showing each `ServiceResource`'s schedule for the selected day/week. Appointment blocks are color-coded by status |
| **Map** | Geographic view of appointment locations and resource positions. Shows travel routes between appointments |

All three panels update in real time as appointments are scheduled, rescheduled, or completed by field workers.

### Accessing the Dispatcher Console

1. Navigate to the **Field Service** app.
2. Open the **Dispatcher Console** tab or component.
3. Select the `ServiceTerritory` and date range to view.
4. Requires: `Field Service Dispatcher` + `Field Service Dispatcher Console User` permission sets assigned to the dispatcher's User.

---

## Scheduling Actions

### Manual Schedule (Gantt Drag)

1. Find the appointment in the service list (Status = `None`).
2. Drag it onto a technician's Gantt slot.
3. FSL automatically:
   - Creates or updates `AssignedResource` linking the `ServiceResource` to the `ServiceAppointment`
   - Sets `ServiceAppointment.SchedStartTime` and `SchedEndTime`
   - Calculates `EstimatedTravelTime` based on the previous appointment's end location
   - Sets `ServiceAppointment.Status = Scheduled`

### Schedule Action (System-Suggested Slot)

1. Click the **Schedule** action button on a `ServiceAppointment` record or from the service list.
2. The system evaluates available candidates (resources in the territory with matching skills and availability).
3. A ranked list of candidate slots is presented (time + resource + travel time estimate + grade).
4. Dispatcher selects a slot; FSL creates `AssignedResource` and updates the appointment.

### Bulk Optimization

1. In the dispatcher console, click **Optimize** (for a territory or selected appointments).
2. The optimizer evaluates all unscheduled and reschedulable appointments against the `SchedulingPolicy`.
3. The optimizer produces a schedule that minimizes/maximizes the objectives defined in the policy (travel time, utilization, SLA compliance, preferred resources).
4. The dispatcher can preview the proposed schedule before committing.
5. **Committing optimization** updates all affected `ServiceAppointment` records and creates/updates `AssignedResource` records in bulk.

---

## SchedulingPolicy Configuration

`SchedulingPolicy` governs how the optimizer evaluates and ranks scheduling options. Each policy has:

### Work Rules (Hard Constraints)

Work rules eliminate candidates that violate the rule. If a work rule fails for all candidates, the appointment is unschedulable.

| Work Rule | Effect |
|-----------|--------|
| **Match Skills** | Only resources with all required `ServiceResourceSkill` records are candidates |
| **Match Territory** | Only resources with a `ServiceTerritoryMember` in the appointment's territory are candidates |
| **Business Hours** | Appointment must fall within the territory's `OperatingHours` window |
| **Resource Availability** | Resources with `ResourceAbsence` during the appointment window are excluded |
| **Required Resources** | Resources marked as `Required` in `ResourcePreference` must be available |
| **Resource Gantt Working Hours** | Resource-level shift hours (if configured) must cover the appointment |

### Service Objectives (Weighted Scoring)

Service objectives rank valid candidates. Higher weight = stronger influence on final selection.

| Service Objective | What It Optimizes |
|-------------------|-------------------|
| **Minimize Travel** | Reduces total travel distance for the route |
| **Maximize Utilization** | Fills technician schedules to minimize idle time |
| **Preferred Resource** | Honors `ResourcePreference` (Preferred type) |
| **Arrival Window Compliance** | Schedules within `ArrivalWindowStartTime`/`ArrivalWindowEndTime` |
| **SLA** | Schedules before `ServiceAppointment.DueDate` |
| **Skill Level** | Prefers resources whose `SkillLevel` best matches the `SkillRequirement.SkillLevel` |

### Assigning a SchedulingPolicy to a Territory

```apex
ServiceTerritory st = [SELECT Id FROM ServiceTerritory WHERE Name = 'Chicago Metro' LIMIT 1];
SchedulingPolicy sp = [SELECT Id FROM SchedulingPolicy WHERE Name = 'SLA-First Policy' LIMIT 1];
st.SchedulingPolicyId = sp.Id;
update st;
```

---

## Travel Time Calculation Modes

Travel time is calculated when an appointment is scheduled and stored in `AssignedResource.EstimatedTravelTime`. The calculation is based on the resource's previous appointment end location (or home base for the first appointment of the day).

| Mode | Description | Requires |
|------|-------------|---------|
| `None` | No travel time; appointments placed back-to-back | Nothing |
| `Straight Line` | Aerial distance using Haversine formula; fast but inaccurate | Nothing |
| `Road Network` | Actual road routing via mapping provider | Salesforce Maps or third-party integration |

Configure in **Field Service Settings → General Settings → Routing Mode**.

---

## Optimization Window and Horizon

The optimizer operates on a defined window of time. Configure:

- **Optimization Horizon:** How far into the future to optimize (e.g., next 7 days, next 30 days)
- **Pinning:** Already-dispatched appointments (`Status = Dispatched` or later) are pinned — the optimizer does not move them unless you explicitly unpin
- **Fixed Appointments:** Appointments with `Status = Scheduled` but not yet dispatched can be included in re-optimization

**Best practice:** Run nightly bulk optimization for the next business day (horizon = 24–48 hours). This allows the optimizer to fill gaps and minimize travel before the day begins, while keeping dispatched appointments fixed.

---

## Candidate Selection for Appointment Booking

When a customer self-schedules (e.g., via an Experience Cloud portal), the appointment booking flow:

1. Customer specifies preferred date range and contact info.
2. System creates a `ServiceAppointment` with `Status = None` and the time window (`EarliestStartPermitted`/`DueDate`).
3. The `appointmentBookingSlots` API is called to retrieve ranked available slots.
4. Customer selects a slot; the system confirms the booking by scheduling the appointment (creating `AssignedResource`, setting `SchedStartTime`, updating status to `Scheduled`).
5. Confirmation is sent to the customer.

### appointmentBookingSlots API Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `appointmentId` | Id | The ServiceAppointment Id |
| `schedulingPolicyId` | Id | Policy to use for slot generation |
| `operatingHoursId` | Id | Restricts slot times to this operating hours window |
| `exactAppointments` | Boolean | If true, returns specific technician assignments; if false, returns time windows only |

Slots are returned with a `Grade` score (higher = better fit based on travel, utilization, and objectives). Display higher-grade slots prominently in the customer UI.

---

## OmniChannel Integration

FSL can be integrated with OmniChannel routing to handle field service work items alongside contact center work. In this pattern:

- A `WorkOrder` is created from a `Case` or directly
- A `ServiceAppointment` is created for the work order
- The appointment can be represented as an OmniChannel `PendingServiceRouting` work item to trigger routing logic
- An `AgentWork` record is created when the work item is routed to a dispatcher queue (dispatcher reviews and confirms scheduling)

This pattern is used when field work is initiated by inbound customer contact (phone, chat, messaging) and the contact center agent needs to hand off to the field scheduling team without losing context. OmniChannel routing and capacity rules are managed separately from FSL scheduling policies — see the `service-omni-channel-routing` skill for OmniChannel configuration.

---

## Bulk Scheduling Operations via Apex

For automated scheduling (e.g., nightly batch jobs), the FSL managed package provides Apex APIs:

```apex
// Schedule a single appointment using the default scheduling policy
// (FSL managed package class — exact class name varies by package version)
FSL.ScheduleResult result = FSL.GlobalAPIs.schedule(sa.Id, schedulingPolicyId);

if (result.isSuccess) {
    System.debug('Scheduled at: ' + result.start);
    System.debug('Resource: ' + result.ServiceResourceId);
} else {
    System.debug('Scheduling failed: ' + result.message);
}
```

For bulk optimization, use the `FSL.GlobalAPIs.optimizeWork` method, passing a list of `ServiceAppointment` Ids and a `SchedulingPolicy` Id. Note that optimization calls count against governor limits and should be batched carefully for large territories.
