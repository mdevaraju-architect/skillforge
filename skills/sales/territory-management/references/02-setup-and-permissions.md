# ETM Setup, Permissions, and Org Configuration

## Enabling Enterprise Territory Management

ETM is not enabled by default. It requires a one-time org-level setup step.

**Steps to enable:**
1. Navigate to Setup → Territory Management.
2. Click **Enable Enterprise Territory Management**.
3. Confirm the prompt — this action cannot be undone for the org.
4. After enabling, the `Territory2Model`, `Territory2Type`, `Territory2`, `Territory2Rule`, `ObjectTerritory2Association`, and `UserTerritory2Association` objects become available.

**Prerequisites:**
- Salesforce Edition: Enterprise, Unlimited, or Developer (Performance included)
- The `EnterpriseTerritory2Management` feature license must be active
- System Administrator profile required to enable
- Enabling ETM does not automatically enable territory-based forecasting — that is a separate step

**Cannot be disabled once enabled.** If ETM is enabled in a scratch org template, all scratch orgs from that template will have ETM available.

---

## Territory2Model Creation

After enabling ETM, create at least one `Territory2Model` before building territories.

**Via Setup UI:**
1. Setup → Territory Management → Territory Models → New
2. Provide `Name` and optional `Description`
3. Model is created in `Planning` state automatically

**Via API (Apex DML):**
```apex
Territory2Model model = new Territory2Model(
    Name = 'FY26 North America Sales',
    Description = 'North America territory model for FY26'
);
insert model;
// State defaults to Planning; cannot be set on insert
```

**Via Metadata API / SFDX:**
Territory models can be retrieved and deployed via the Metadata API using the `Territory2Model` metadata type. Use `sf project retrieve start --metadata Territory2Model` to pull an existing model's configuration.

---

## Territory2Type Setup

`Territory2Type` records must be created before `Territory2` records. Create one type per logical classification.

**Recommended starting types:**

| Name | Priority | Use Case |
|------|----------|----------|
| Named Account | 10 | Strategic accounts assigned to named AEs |
| Geographic | 20 | State/region/country-based coverage |
| Overlay | 30 | SE, specialist, or partner overlay coverage |
| Industry Vertical | 40 | Vertical market segmentation |

**Via Apex:**
```apex
Territory2Type t2type = new Territory2Type(
    Name = 'Geographic',
    Priority = 20,
    Description = 'State and region-based territory assignments'
);
insert t2type;
```

Priority is used to determine precedence when an account matches rules in multiple territory types. Lower `Priority` number = higher precedence.

---

## Required Permissions

### System Administrator
- Full ETM configuration access: create Territory2Model, Territory2Type, Territory2, Territory2Rule
- Run assignment rules
- Manage UserTerritory2Association

### `ManageTerritory2` Permission
Users who need to manage territory configuration but are not System Admins require the `ManageTerritory2` system permission. This permission can be granted via a Permission Set.

```
Permission Set Name: Territory Manager
System Permissions: ManageTerritory2 = true
```

**What `ManageTerritory2` allows:**
- Create, edit, delete Territory2Model, Territory2Type, Territory2, Territory2Rule
- Manage UserTerritory2Association
- Run assignment rules

**What it does NOT grant:**
- Access to all Account records (that is governed by the territory sharing model and AccountShare)
- The ability to change the territory sharing model (requires System Administrator)

### Standard Sales Rep
No special permissions required to access accounts via territory membership. Access flows through `AccountShare` records auto-created when the user is added to a territory containing the account.

---

## Territory Sharing Model Configuration

The territory sharing model controls what level of access territory membership grants. Configure in Setup → Sharing Settings → Territory-Based Sharing.

**Access levels for Accounts:**

| Setting | Effect |
|---------|--------|
| `Read Only` | Territory members can view assigned accounts |
| `Read/Write` | Territory members can edit assigned accounts |
| `Owner/Full Access` | Territory owners get full access; other members get Read/Write |

**Grant access to parent territories:**
- When enabled, users assigned to a parent territory automatically gain access to accounts assigned to child territories
- When disabled (default), parent territory users do not see child territory accounts
- This setting has significant impact on sales manager visibility — enable deliberately

**Opportunity and Case access:**
Configured separately per the `Territory2.OpportunityAccessLevel` and `Territory2.CaseAccessLevel` fields on each territory record.

---

## Forecast Type Linkage to Territory Model

Territory-based forecasting requires linking a `ForecastingType` to the active territory model. This is configured in Setup → Forecasts Settings.

**Steps:**
1. Setup → Forecasts Settings → Enable Collaborative Forecasts (if not already enabled)
2. Add a forecast type with **Territory** as the forecast hierarchy
3. Select the active Territory2Model as the hierarchy source
4. The forecast type uses `OpportunityTerritory2Association.Territory2Id` to roll up pipeline by territory

**Important:** Territory forecast rollup depends on `OpportunityTerritory2Association` records being accurate. If opportunities have stale territory assignments (e.g., after a territory realignment), the forecast will be incorrect until `OpportunityTerritory2Association` records are updated.

---

## Org Limits Relevant to ETM

| Limit | Value | Notes |
|-------|-------|-------|
| Active Territory Models | 1 | Only one `Territory2Model` can be in `Active` state at any time |
| Territory2 records per model | No hard limit | Performance degrades beyond ~10,000 territories per model |
| Territory2Rule criteria per rule | 25 | Maximum filter criteria per individual rule |
| Territory hierarchy depth | No enforced limit | SOQL relationship queries traverse max 5 levels; use Apex for deeper hierarchies |
| UserTerritory2Association per territory | No hard limit | |
| ObjectTerritory2Association per account | No hard limit | An account can belong to multiple territories |

---

## API Access for ETM Objects

All ETM objects are accessible via the standard Salesforce REST, SOAP, and Bulk APIs.

**Objects accessible via standard API:**
- `Territory2Model` — CRUD (State transitions have restrictions)
- `Territory2Type` — CRUD
- `Territory2` — CRUD
- `Territory2Rule` — CRUD (only when model is in Planning state)
- `ObjectTerritory2Association` — Create (Manual), Read, Delete
- `UserTerritory2Association` — CRUD
- `OpportunityTerritory2Association` — Create, Read, Update, Delete

**Objects NOT directly writable:**
- `AccountShare` with `RowCause = Territory2` — system-managed; read-only via API
- `Territory2RuleCriterion` — managed through Metadata API, not standard DML

**Running rules via API:**
Rules are executed by updating `Territory2Model.State` to `Active` (full run on activation) or by invoking the REST endpoint:
```
POST /services/data/v60.0/territory2/models/{modelId}/territories/{territoryId}/runRules
```
Or via Apex:
```apex
List<Territory2Model> models = [SELECT Id FROM Territory2Model WHERE State = 'Planning' LIMIT 1];
// Trigger rule run programmatically via process builder, flow, or async Apex
```

**Metadata API retrieval:**
```bash
sf project retrieve start \
  --metadata "Territory2Model" \
  --metadata "Territory2Type" \
  --metadata "Territory2" \
  --target-org myAlias
```
