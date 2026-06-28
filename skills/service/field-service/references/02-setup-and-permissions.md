# FSL Setup and Permissions

## Package Installation

Salesforce Field Service Lightning is a **managed package** — it is not included in the core Salesforce platform. FSL must be installed separately from the AppExchange before any FSL objects (`ServiceAppointment`, `ServiceResource`, etc.) are available.

### Installation Steps

1. Go to AppExchange and search for **Salesforce Field Service**. The package publisher is Salesforce.
2. Install in your target org (sandbox first, then production). Choose **Install for All Users** or **Install for Admins Only** — the latter is safer for initial setup.
3. After installation, the `FieldService` feature is enabled. You can verify with: `SELECT IsSandbox, FeatureLicenses FROM Organization` — `FeatureLicenses` will include `FieldService`.
4. Post-install, navigate to **Field Service Settings** (in Setup or via the FSL app) to complete guided setup: enable scheduling optimization, set travel time calculation mode, configure the dispatcher console.

### Managed Package Objects Installed

The FSL package adds the following objects not present in core Salesforce:

- `ServiceAppointment`, `AssignedResource`
- `ServiceResource`, `ServiceTerritoryMember`
- `ServiceCrewMember`, `ServiceCrew`
- `ResourceAbsence`, `ResourcePreference`
- `ServiceResourceSkill`, `SkillRequirement`, `Skill`
- `OperatingHours`, `TimeSlot`
- `SchedulingPolicy`, `AppointmentTopicTimePolicy`
- `WorkType`, `WorkTypeSkill`

`WorkOrder` and `WorkOrderLineItem` are part of the core Salesforce platform (available with Service Cloud) but FSL adds additional fields and behavior on top of them.

---

## Permission Sets

FSL ships with managed package permission sets. Do not recreate these as custom permission sets — use the FSL-provided ones and stack them with your org's custom permission sets as needed.

| Permission Set | Who Gets It | What It Unlocks |
|----------------|-------------|-----------------|
| `Field Service Admin` | Org admins, implementation team | Full access to all FSL objects and settings, FSL Setup, Scheduling Policy admin |
| `Field Service Dispatcher` | Dispatchers, scheduling team | Dispatcher console, Gantt, scheduling actions, optimization run |
| `Field Service Dispatcher Console User` | Same as Dispatcher, required for console | License for the embedded dispatcher console component |
| `Field Service Agent` | Field technicians | Mobile app access, appointment check-in/check-out, work order completion |
| `Field Service Mobile` | Field technicians (alternate) | Mobile-only subset; used when full Agent PS is not needed |

**Stacking requirement:** FSL permission sets must be combined with core Salesforce licenses. A field technician typically needs: `Salesforce` or `Force.com` license + `Field Service Agent` PS + org-specific custom PS for any additional object/field access.

**Common mistake:** Assigning `Service Cloud User` PS and expecting FSL console access — `Service Cloud User` grants access to Cases, Entitlements, and Service Console, not the FSL dispatcher console.

---

## Creating a ServiceResource from a User

Every field technician or dispatcher who appears in the scheduling system needs a `ServiceResource` record linked to their User.

```apex
// Example: Create a ServiceResource for a User
ServiceResource sr = new ServiceResource();
sr.Name = 'Jane Smith';
sr.RelatedRecordId = '005XXXXXXXXXXXXXXX'; // User Id
sr.ResourceType = 'T'; // T = Technician, C = Crew
sr.IsActive = true;
sr.IsOptimizationCapable = true;
insert sr;
```

After insertion, assign the `Field Service Agent` permission set to the same User:

```apex
PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'FSL_Agent' LIMIT 1];
PermissionSetAssignment psa = new PermissionSetAssignment();
psa.AssigneeId = '005XXXXXXXXXXXXXXX';
psa.PermissionSetId = ps.Id;
insert psa;
```

The FSL-managed package permission set `Name` may vary slightly by package version — query by `Label` containing `'Field Service Agent'` if the exact API name is unknown.

---

## Creating a ServiceTerritory

```apex
// 1. Create OperatingHours first
OperatingHours oh = new OperatingHours();
oh.Name = 'US Central - Standard Business Hours';
oh.TimeZone = 'America/Chicago';
insert oh;

// 2. Create TimeSlots for Mon-Fri 08:00-17:00
List<TimeSlot> slots = new List<TimeSlot>();
Integer[] workdays = new Integer[]{1, 2, 3, 4, 5}; // Mon=1 ... Fri=5
for (Integer day : workdays) {
    TimeSlot ts = new TimeSlot();
    ts.OperatingHoursId = oh.Id;
    ts.DayOfWeek = String.valueOf(day);
    ts.StartTime = Time.newInstance(8, 0, 0, 0);
    ts.EndTime = Time.newInstance(17, 0, 0, 0);
    slots.add(ts);
}
insert slots;

// 3. Create ServiceTerritory
ServiceTerritory st = new ServiceTerritory();
st.Name = 'Chicago Metro';
st.IsActive = true;
st.OperatingHoursId = oh.Id;
st.Street = '123 Main St';
st.City = 'Chicago';
st.State = 'IL';
st.PostalCode = '60601';
st.Country = 'US';
insert st;
```

---

## Skill Setup

Skills define what capabilities a technician has. They are configured as master data and assigned to both workers (via `ServiceResourceSkill`) and jobs (via `SkillRequirement`).

```apex
// Create a Skill
Skill electricalSkill = new Skill();
electricalSkill.MasterLabel = 'Electrical Certification';
electricalSkill.DeveloperName = 'Electrical_Certification';
insert electricalSkill;

// Assign to a ServiceResource
ServiceResourceSkill srs = new ServiceResourceSkill();
srs.ServiceResourceId = sr.Id; // ServiceResource from above
srs.SkillId = electricalSkill.Id;
srs.SkillLevel = 4; // Optional; scale is typically 1-5
srs.AcquiredSkillCertification = 'NFPA 70E Certified';
srs.ExpirationDate = Date.today().addYears(2);
insert srs;
```

**Expiration:** When `ServiceResourceSkill.ExpirationDate` is in the past, the skill is considered expired and is not matched by the scheduler. Build a scheduled job or flow to alert managers before skills expire.

---

## SchedulingPolicy Configuration

`SchedulingPolicy` records are configured in **Field Service Settings → Scheduling Policies** in the FSL app, not via Apex insert. Key settings in the policy UI:

| Setting | Description |
|---------|-------------|
| **Work Rule: Match Skills** | Whether skill matching is enforced; can be soft (preferred) or hard (required) |
| **Work Rule: Match Territory** | Whether resource must belong to the appointment's territory |
| **Work Rule: Business Hours** | Enforce territory OperatingHours window |
| **Service Objective: Minimize Travel** | Optimizer weight for reducing total travel distance |
| **Service Objective: Maximize Utilization** | Optimizer weight for filling technician schedules |
| **Service Objective: Preferred Resource** | Weight for honoring ResourcePreference records |
| **Service Objective: SLA** | Weight for scheduling before DueDate |

Assign the policy to the territory via `ServiceTerritory.SchedulingPolicyId`. To apply a policy to a specific scheduling operation without changing the territory default, pass the `schedulingPolicyId` parameter in the scheduling API call.

---

## FSL Settings: Travel Time Calculation Mode

In **Field Service Settings → General Settings**, configure travel time calculation:

| Mode | Description |
|------|-------------|
| `None` | No travel time calculated; appointments are back-to-back |
| `Straight Line` | Aerial distance between addresses; fast but inaccurate |
| `Road Network` | Actual road distance via mapping provider; requires additional licensing |

Road network mode requires a mapping service integration (e.g., the Salesforce Maps add-on or a third-party provider). For most FSL implementations, `Road Network` is required for production accuracy.

---

## Mobile App Setup

1. Install the **Salesforce Field Service** mobile app on iOS or Android (available from the App Store / Google Play).
2. Technicians log in with their Salesforce credentials. The `Field Service Agent` or `Field Service Mobile` permission set must be assigned.
3. The mobile app shows all `ServiceAppointment` records where the technician's `ServiceResource` is in an `AssignedResource` record and `Status = Dispatched` (or later).
4. Custom quick actions on `WorkOrder` and `ServiceAppointment` appear in the mobile app if configured in the object's **Mobile** action layout.
5. For offline capability, configure offline briefcase settings in **Field Service Settings → Mobile Settings**. Field references and related records that should be available offline must be explicitly included.
