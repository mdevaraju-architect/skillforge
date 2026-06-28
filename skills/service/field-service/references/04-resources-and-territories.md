# Resources and Territories

## ServiceResource

`ServiceResource` is the FSL representation of a schedulable worker. It wraps a Salesforce User (or a virtual resource like a truck or tool) via `RelatedRecordId`. The dispatcher console, Gantt, and optimizer all operate on `ServiceResource` — not directly on User records.

### Creating a ServiceResource

```apex
ServiceResource sr = new ServiceResource();
sr.Name = 'Alex Torres'; // Display name in dispatcher console
sr.RelatedRecordId = userId; // User.Id
sr.ResourceType = 'T'; // T = Technician, C = Crew (virtual resource for crew lead)
sr.IsActive = true;
sr.IsOptimizationCapable = true; // Include in bulk optimization runs
insert sr;
```

### ServiceResource Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `RelatedRecordId` | Lookup(User) | Required; links to the Salesforce User |
| `ResourceType` | Picklist | `T` = Technician, `C` = Crew |
| `IsActive` | Boolean | False = hidden from scheduler, Gantt, and dispatcher console |
| `IsOptimizationCapable` | Boolean | Whether the resource is included in bulk optimizer runs |
| `Latitude` / `Longitude` | Number | Last known GPS location; updated by mobile app |
| `HomeBaseServiceTerritoryId` | Lookup(ServiceTerritory) | Optional; territory used for home-base distance calculation in optimization |

### Deactivating a ServiceResource

When a technician leaves, set `ServiceResource.IsActive = false` rather than deactivating or deleting the User. This:
- Preserves historical `ServiceAppointment` and `AssignedResource` records
- Removes the resource from future scheduling and Gantt views
- Does not affect completed appointment records or analytics

---

## ServiceTerritoryMember

The junction between `ServiceResource` and `ServiceTerritory`. A resource can belong to multiple territories with different roles.

### Territory Types

| TerritoryType | Label | Behavior |
|---------------|-------|----------|
| `P` | Primary | Resource's home territory; appears in Gantt; origin for travel time |
| `S` | Secondary | Resource can receive appointments from this territory |
| `R` | Relocation | Temporary assignment; used for field deployments or surge coverage |

```apex
ServiceTerritoryMember stm = new ServiceTerritoryMember();
stm.ServiceResourceId = sr.Id;
stm.ServiceTerritoryId = territory.Id;
stm.TerritoryType = 'P'; // Primary
stm.EffectiveStartDate = Date.today();
// stm.EffectiveEndDate = Date.today().addMonths(6); // For temporary assignments
insert stm;
```

### Membership Validity Windows

`EffectiveStartDate` and `EffectiveEndDate` control when a membership is active. The scheduler ignores memberships outside the validity window. This allows modeling:

- Seasonal resource redeployment (set `EffectiveEndDate` on the old territory, create new membership for the new territory)
- Temporary secondment (secondary membership with fixed `EffectiveStartDate` / `EffectiveEndDate`)
- Future onboarding (set `EffectiveStartDate` to a future date for pre-created resources)

---

## ResourceAbsence

`ResourceAbsence` blocks a `ServiceResource` from being scheduled during a time range. The optimizer and scheduler treat absences as hard constraints — no appointments will be placed that overlap with an absence.

### Creating a ResourceAbsence

```apex
ResourceAbsence ra = new ResourceAbsence();
ra.ResourceId = sr.Id; // ServiceResource.Id — NOT User.Id
ra.AbsenceType = 'Vacation';
ra.Start = Datetime.newInstance(Date.today().addDays(7), Time.newInstance(0, 0, 0, 0));
ra.End = Datetime.newInstance(Date.today().addDays(14), Time.newInstance(23, 59, 0, 0));
ra.Description = 'Annual leave';
insert ra;
```

### AbsenceType Values (Standard)

| Value | Usage |
|-------|-------|
| `Vacation` | Planned leave |
| `Training` | Training or certification sessions |
| `Medical` | Sick leave / medical appointment |
| `Meeting` | Internal meeting blocks |
| (Custom values) | Org-specific types configured in picklist |

### What ResourceAbsence Does NOT Do

- It does not automatically cancel or reschedule existing appointments that overlap. When you create a `ResourceAbsence` over an already-scheduled appointment, the appointment remains scheduled — dispatchers must manually handle the conflict.
- It is not a substitute for `OperatingHours` — use `OperatingHours`/`TimeSlot` for recurring schedule windows; use `ResourceAbsence` for one-off exceptions.

---

## ServiceResourceSkill

Links a `Skill` to a `ServiceResource`. The scheduler matches these against `SkillRequirement` records on `WorkOrder` / `WorkOrderLineItem`.

```apex
ServiceResourceSkill srs = new ServiceResourceSkill();
srs.ServiceResourceId = sr.Id;
srs.SkillId = skill.Id;
srs.SkillLevel = 4; // 1-5 scale; 5 = highest proficiency
srs.AcquiredSkillCertification = 'Certified Plumber - State of Illinois';
srs.ExpirationDate = Date.today().addYears(3);
insert srs;
```

When `ExpirationDate` is in the past, the FSL scheduler treats the skill as absent — the resource will not match against `SkillRequirement` records that reference that `Skill`. Build a scheduled Flow or Apex batch to alert managers 30 days before skill expiration.

---

## ServiceCrew and ServiceCrewMember

For jobs requiring multiple technicians working together, use `ServiceCrew` as a logical group.

### ServiceCrew

```apex
ServiceCrew crew = new ServiceCrew();
crew.Name = 'Install Team Alpha';
crew.IsActive = true;
insert crew;
```

### ServiceCrewMember

```apex
// Add a lead technician
ServiceCrewMember lead = new ServiceCrewMember();
lead.ServiceCrewId = crew.Id;
lead.ServiceResourceId = leadTechResource.Id;
lead.IsLead = true;
lead.EffectiveStartDate = Date.today();
insert lead;

// Add a second technician
ServiceCrewMember member = new ServiceCrewMember();
member.ServiceCrewId = crew.Id;
member.ServiceResourceId = secondTechResource.Id;
member.IsLead = false;
member.EffectiveStartDate = Date.today();
insert member;
```

### Scheduling a Crew

When scheduling a crew-based job:
1. Create a `ServiceResource` record with `ResourceType = 'C'` (Crew) for the crew itself — this is the virtual resource the appointment is scheduled against.
2. The crew's individual members are managed via `ServiceCrewMember`.
3. The `AssignedResource` on the `ServiceAppointment` points to the crew's `ServiceResource` (not to individual technicians).
4. `IsRequiredResource = true` on the `AssignedResource` marks the crew as the required assignee.

---

## ResourcePreference

`ResourcePreference` records configure customer-technician preferences. The optimizer uses these when placing appointments.

### Creating ResourcePreference Records

```apex
ResourcePreference pref = new ResourcePreference();
pref.ServiceResourceId = preferredTech.Id;
pref.AccountId = customerAccount.Id; // OR ContactId for contact-level preference
pref.PreferenceType = 'Preferred'; // Preferred, Excluded, Required
insert pref;
```

### PreferenceType Behaviors

| PreferenceType | Optimizer Behavior | Risk |
|----------------|-------------------|------|
| `Preferred` | Optimizer tries to assign this resource; falls back to others if unavailable | Low |
| `Excluded` | Optimizer never assigns this resource to this customer | Low |
| `Required` | Optimizer only assigns this resource; fails if unavailable | High — appointment may become unschedulable |

**`Required` preference warning:** If `PreferenceType = Required` and the preferred resource is on leave (`ResourceAbsence`), at capacity, or outside their territory, the appointment cannot be scheduled. It will surface as an error in the dispatcher console. Test `Required` preferences in sandbox with representative schedules before deploying to production.

---

## AssignedResource for Multi-Resource Appointments

For appointments requiring more than one technician (but not using a formal `ServiceCrew`):

```apex
// First resource (lead)
AssignedResource ar1 = new AssignedResource();
ar1.ServiceAppointmentId = sa.Id;
ar1.ServiceResourceId = leadResource.Id;
ar1.IsRequiredResource = true;
insert ar1;

// Second resource (support)
AssignedResource ar2 = new AssignedResource();
ar2.ServiceAppointmentId = sa.Id;
ar2.ServiceResourceId = supportResource.Id;
ar2.IsRequiredResource = false;
insert ar2;
```

Both resources see the appointment in their Gantt row and mobile app queue. The `ServiceAppointment.Status` is shared — when either technician updates the status on mobile, both are affected. For independent status tracking per technician, use separate `ServiceAppointment` records per technician (linked to the same `WorkOrderLineItem`).
