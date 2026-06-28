---
name: sales-territory-management
description: >-
  Territory2Model, Territory2Type, Territory2, Territory2Rule, ObjectTerritory2Association,
  UserTerritory2Association, AccountShare, OpportunityTerritory2Association,
  Enterprise Territory Management, ETM, territory hierarchy, account assignment rules,
  territory assignment, sales territory, territory model lifecycle, Planning state,
  Active state, territory forecast, filter-based rules, territory inheritance,
  territory access, manual territory assignment, territory cloning
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "confidential"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: sales
  module: territory-management
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Enterprise Territory Management — Skill

## Scope

This skill covers Salesforce Enterprise Territory Management (ETM): designing and activating territory models, building filter-based account assignment rules, managing user territory assignments, traversing territory hierarchies, and integrating territories with opportunity forecasting. It targets the `Territory2` object family (API version 60.0+).

## Not covered

- **Classic Territory Management** (the legacy pre-ETM model; deprecated). If you see `Territory` (no "2"), you are in Classic — this skill does not apply.
- **Collaborative Forecasting configuration** beyond territory-based forecast type linkage — use the `sales-forecasting` skill.
- **Opportunity lifecycle** (stages, close plans, CPQ) — use `sales-opportunity-to-close`.
- **Platform sharing model beyond territory access** (OWD, role hierarchy, manual sharing, Apex sharing for non-territory objects) — use the platform security skill.

---

## Always true — gotchas

### 1. Only one `Territory2Model` can be `Active` at a time

`Territory2Model.State` transitions through three stages: `Planning → Active → Archived`. When you activate a new model, Salesforce automatically archives the currently active model — there is no rollback. An archived model cannot be re-activated; it can only be cloned back to Planning state. Test all rules and assignments exhaustively in Planning state before activating. Never activate a model without verifying account coverage counts against the prior model.

### 2. `Territory2Type` is required before creating `Territory2`

Every `Territory2` record must reference a `Territory2Type` via `Territory2TypeId`. `Territory2Type` records carry metadata like `Priority__c` and the `ForecastingType` linkage. Attempting to insert a `Territory2` without a valid `Territory2TypeId` fails with `REQUIRED_FIELD_MISSING: Territory2TypeId`. Create all needed `Territory2Type` records (Named Account, Geographic, Overlay, etc.) before building the territory hierarchy.

### 3. `Territory2Rule` filter criteria target the Account object only

`Territory2Rule` evaluates filter logic exclusively against fields on the `Account` object to auto-assign accounts to territories. Rules cannot reference `Opportunity`, `Contact`, `Lead`, `Case`, or any custom object. If you need to derive territory from a non-Account field, write a Flow or Apex that copies the relevant value to an Account field first, then let the rule engine pick it up. Common Account fields in rules: `BillingState`, `BillingCountry`, `Industry`, `AnnualRevenue`, `OwnerId`, `NumberOfEmployees`, and custom segment fields.

### 4. `ObjectTerritory2Association` is the assignment record — not `Territory2` itself

Account-to-territory assignment is represented by `ObjectTerritory2Association` records, not by any field on `Territory2`. When a rule assigns an Account, Salesforce creates an `ObjectTerritory2Association` with `AssociationCause = Territory2AssignmentRule` and `ObjectId` pointing to the Account Id. Manual assignments set `AssociationCause = Manual`. To assign an account to a territory manually, insert an `ObjectTerritory2Association` record; do not attempt to edit fields on `Territory2` to add accounts. To query all accounts in a territory, query `ObjectTerritory2Association` filtered by `Territory2Id`.

### 5. Running assignment rules is async — not real-time

`Territory2Rule` execution does not fire automatically when an Account field changes. Rules are triggered in one of three ways: (a) Setup → Territory Management → Territory Models → Run Rules for the model; (b) the `Territory2.runRules()` SOAP/REST API call; (c) a scheduled or triggered Apex job that calls `Database.executeBatch` against the territory rule runner. If your territory strategy depends on Account field changes (e.g., segment reclassification), build an Account After Update Flow or scheduled Apex to invoke rule execution. Do not tell users that editing an Account field will immediately re-assign it.

### 6. `UserTerritory2Association` records control access — not OWD or profile

A user's membership in a territory is stored in `UserTerritory2Association` with fields `UserId`, `Territory2Id`, and `RoleInTerritory2`. The `RoleInTerritory2` picklist values are `Owner`, `Partner`, and `User`. This record does not change the user's profile or role hierarchy. Access to accounts in the territory flows through Salesforce sharing rules configured under Setup → Sharing Settings → Territory-Based Sharing. The sharing model determines whether territory members get Read-Only or Read/Write access to associated accounts.

### 7. Territory hierarchy inheritance is one-way downward

When a user is assigned to a parent territory via `UserTerritory2Association`, they do NOT automatically gain access to accounts in child territories unless the sharing model explicitly configures upward rollup. By default, territory access is granted at the territory level where the `ObjectTerritory2Association` record exists. Child territory assignments do not bubble access up to parent territory owners. Configure "Grant access to parent territories" in the territory sharing settings if your model requires parent-level visibility into child territory accounts.

### 8. `OpportunityTerritory2Association` is separate from Account territory

An Opportunity's territory assignment is stored in `OpportunityTerritory2Association.Territory2Id`, which is distinct from the Account's territory assignment in `ObjectTerritory2Association`. When an Opportunity is created, Salesforce sets its territory based on the Account's primary territory at that moment. If the Account's territory changes later, the Opportunity territory does NOT automatically update. `OpportunityTerritory2Association.Territory2Id` drives the territory-based forecast rollup — if this record points to the wrong territory, the opportunity will appear in the wrong forecast hierarchy. Manually update `OpportunityTerritory2Association` records when territory realignments occur.

### 9. `Territory2Model.State = Planning` is required for rule edits

You cannot insert, update, or delete `Territory2Rule` records on a `Territory2Model` that is in `Active` or `Archived` state. All rule changes require cloning the active model to a new `Planning`-state model, making the changes, running rules to validate coverage, and then activating the new model (which archives the old one). This means territory rule changes are a deployment-level operation, not an ad-hoc config change. Plan for a maintenance window when activating model changes in production.

### 10. Territory cloning copies hierarchy and rules but not user assignments

When you clone a `Territory2Model` (via Setup or the `Territory2Model` clone API), Salesforce copies all `Territory2` records (preserving the `ParentTerritory2Id` hierarchy) and all `Territory2Rule` records. It does NOT copy `UserTerritory2Association` records. After cloning, user assignments are empty in the new model. Before activating the cloned model, re-populate user assignments — either manually, via Data Loader, or via a provisioning script that reads the prior model's `UserTerritory2Association` records and re-inserts them with the new model's territory IDs.

### 11. `AccountShare` records are auto-created by the territory engine — do not manually create territory-type shares

When an Account is assigned to a territory (via `ObjectTerritory2Association`), Salesforce automatically creates `AccountShare` records with `RowCause = Territory2` for each `UserTerritory2Association` member of that territory. Manually inserting `AccountShare` records with `RowCause = Territory` or `Territory2` throws an `INVALID_FIELD_FOR_INSERT_UPDATE` error. Never attempt to create or delete territory-derived `AccountShare` records directly. Sharing is managed exclusively through territory membership and the territory sharing model configuration.

### 12. `Territory2.ParentTerritory2Id` drives the hierarchy — null means top-level

Territory hierarchy is a parent-child tree built on the `ParentTerritory2Id` lookup field on `Territory2`. Root territories (top of the hierarchy) have `ParentTerritory2Id = null`. A single territory model supports unlimited hierarchy depth. SOQL cannot traverse unlimited depth natively — relationship queries only go five levels deep. To traverse a full deep hierarchy, use Apex recursion with a depth guard, or build a recursive CTE-style approach by iterating SOQL results until no child records remain. Always guard against infinite loops if data quality allows circular references (which the UI prevents but data migration can introduce).

---

## Reference files

| File | Contents |
|------|----------|
| `references/01-architecture.md` | ETM object model, field tables, state diagrams |
| `references/02-setup-and-permissions.md` | Enabling ETM, permissions, sharing model, forecast linkage, org limits |
| `references/03-model-lifecycle.md` | Planning → Active → Archived transitions, cloning, rollback, versioning |
| `references/04-assignment-rules.md` | Territory2Rule structure, filter criteria, running rules, manual assignment |
| `references/05-user-assignments-and-reporting.md` | UserTerritory2Association, OpportunityTerritory2Association, SOQL, reporting |

---

## Workflows

### Workflow 1 — Design and activate a new territory model

**Goal:** Stand up a net-new territory model from scratch and activate it.

1. Enable Enterprise Territory Management in Setup → Territory Management (one-time org setup).
2. Create `Territory2Type` records for each type of territory in your model (e.g., Named Account, Geographic, Overlay). Set `Priority__c` to define precedence when multiple types apply to the same account.
3. Create a `Territory2Model` record with `State = Planning`. Give it a descriptive `Name` and `Description`.
4. Build the territory hierarchy by inserting `Territory2` records. Set `Territory2TypeId` on each. Set `ParentTerritory2Id` for non-root territories. Set `Territory2ModelId` on all records.
5. Create `Territory2Rule` records for each territory, specifying filter criteria against `Account` fields. Associate each rule to its `Territory2Id`.
6. In Setup, run rules on the Planning model. Review `ObjectTerritory2Association` records created. Verify account coverage counts, check for accounts in unexpected territories or missing assignments.
7. Add `UserTerritory2Association` records to assign reps to territories. Set `RoleInTerritory2` appropriately (`Owner`, `User`, `Partner`).
8. Validate that `OpportunityTerritory2Association` records will roll up to the correct forecast territory.
9. Activate the model by setting `Territory2Model.State = Active`. This archives the current active model and triggers a full rule run.
10. Post-activation: verify `AccountShare` records exist for territory members, confirm opportunity territories are correct, and validate forecast rollup.

### Workflow 2 — Add and run account assignment rules

**Goal:** Add new filter-based rules to an existing territory model without a full model rebuild.

1. Identify the active `Territory2Model`. Note its Id.
2. Clone the active model to a new Planning-state model: Setup → Territory Models → Clone. Record the new model's Id.
3. In the cloned Planning model, navigate to the target `Territory2` and add or modify `Territory2Rule` records. Rules filter on `Account` fields using standard filter criteria (field, operator, value). Boolean logic supports AND/OR combinations.
4. Run rules on the cloned Planning model (Setup → Run Rules or API). Do not run rules on production data in Planning — the Planning run creates `ObjectTerritory2Association` records scoped to the Planning model only.
5. Query `ObjectTerritory2Association` for the Planning model's territory IDs to review which accounts were assigned to which territories. Compare against expected results.
6. Adjust rule criteria as needed and re-run until satisfied.
7. Re-add `UserTerritory2Association` records to the cloned model (cloning does not copy them).
8. Activate the cloned model. This archives the prior active model and applies the new rules org-wide.
9. Schedule a periodic rule-run job (Flow or scheduled Apex) to re-evaluate assignments as Account data changes.

### Workflow 3 — User territory assignment and access verification

**Goal:** Assign a sales rep to a territory and verify they can access the correct accounts.

1. Identify the target `Territory2Id` in the active `Territory2Model`.
2. Insert a `UserTerritory2Association` record: `UserId` = rep's user Id, `Territory2Id` = target territory, `RoleInTerritory2` = `Owner` (or `User` for non-owning reps).
3. Verify that `AccountShare` records with `RowCause = Territory2` are created for the rep on accounts assigned to the territory via `ObjectTerritory2Association`. (These are auto-created; do not insert manually.)
4. Log in as the rep (or use the "Log In As" button in Setup) and confirm account list view shows the expected territory accounts.
5. Confirm `OpportunityTerritory2Association` records on open opportunities in the territory reference the correct `Territory2Id` so the rep's forecast pipeline is accurate.
6. If access is missing: check (a) `UserTerritory2Association` record exists and `Territory2Id` is in the Active model; (b) territory sharing model is set to at least Read-Only; (c) `ObjectTerritory2Association` records exist for the expected accounts.
7. To remove a rep from a territory, delete the `UserTerritory2Association` record. Salesforce will automatically remove the corresponding `AccountShare` records.
