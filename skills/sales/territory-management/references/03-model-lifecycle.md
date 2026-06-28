# Territory2Model Lifecycle — Planning, Active, Archived

## State Overview

A `Territory2Model` moves through three states. Understanding what each state allows and prevents is critical for planning territory changes safely.

| State | Rules Editable | Rule Run Impact | User Assignment Editable | Shareable/Forecast |
|-------|---------------|-----------------|-------------------------|--------------------|
| `Planning` | Yes | Preview only (no live AccountShare) | Yes | No |
| `Active` | No | Live (creates/updates AccountShare) | Yes | Yes |
| `Archived` | No | None | No | No |

Only one model can be `Active` at any time. All other models must be in `Planning` or `Archived`.

---

## Planning State

The Planning state is the workspace for building and validating a territory model before it affects any live data.

**What is allowed:**
- Create, update, delete `Territory2` records in this model
- Create, update, delete `Territory2Rule` records and their criteria
- Insert and delete `UserTerritory2Association` records
- Run rules in "preview" mode — creates `ObjectTerritory2Association` records scoped to the Planning model

**What a Planning-state rule run does:**
- Evaluates all `Territory2Rule` records against all Account records
- Creates `ObjectTerritory2Association` records associated with this model's territories
- Does NOT create `AccountShare` records (no sharing impact while Planning)
- Allows you to query `ObjectTerritory2Association` to verify account coverage before going live

**Validation steps recommended in Planning:**
1. Run rules and count `ObjectTerritory2Association` records per territory — confirm expected account counts
2. Identify accounts with no territory assignment (`Account` records not present in any `ObjectTerritory2Association` for this model)
3. Identify accounts in multiple territories — verify this is intentional
4. Spot-check specific named accounts against their expected territories
5. Confirm user assignments cover all territories (no territory with zero `UserTerritory2Association` records)

---

## Activating a Model (Planning → Active)

Activating a model is an irreversible action for the currently active model. The currently active model is automatically archived.

**What happens at activation:**
1. `Territory2Model.State` transitions from `Planning` to `Active` for the new model
2. The previously active model's `State` transitions from `Active` to `Archived`
3. Salesforce executes a full assignment rule run against all Account records
4. `ObjectTerritory2Association` records are created for all rule-based assignments
5. `AccountShare` records are created for all `UserTerritory2Association` members of territories containing assigned accounts
6. `OpportunityTerritory2Association` records are created or updated for open Opportunities based on their Accounts' new territory assignments

**How to activate:**
Via Setup: Territory Management → Territory Models → [Model Name] → Activate Model

Via API:
```apex
Territory2Model model = [SELECT Id, State FROM Territory2Model WHERE Name = 'FY26 North America' LIMIT 1];
model.State = 'Active';
update model;
```

**Timing:** For large orgs (100k+ accounts), activation can take several minutes. It runs asynchronously. Monitor `Territory2Model.LastRunRuleDate` to know when the run has completed.

**Pre-activation checklist:**
- [ ] All rule criteria reviewed and tested in Planning
- [ ] Account coverage counts validated (no unexpected gaps)
- [ ] `UserTerritory2Association` records populated for all territories
- [ ] Stakeholder sign-off obtained
- [ ] Change window scheduled (activation causes sharing recalculation — potential brief access disruption)
- [ ] Rollback plan documented (clone of the current active model saved for re-activation)

---

## Active State

While Active, the model is live. Assignment rules cannot be edited.

**What is allowed:**
- Read `Territory2`, `Territory2Rule`, `ObjectTerritory2Association`, `UserTerritory2Association` records
- Add and remove `UserTerritory2Association` records (you can still reassign reps without a model change)
- Manually create `ObjectTerritory2Association` records with `AssociationCause = Manual`
- Delete `ObjectTerritory2Association` records with `AssociationCause = Manual`

**What is NOT allowed:**
- Create, update, or delete `Territory2Rule` records
- Add or remove `Territory2` records from the Active model
- Change `Territory2.ParentTerritory2Id` on records in the Active model

**Re-running rules on the active model:**
Rules can be re-run on the Active model (via Setup or API) without changing state. This re-evaluates all `Territory2AssignmentRule` associations. `Manual` associations are preserved across rule re-runs.

---

## Archiving a Model (Active → Archived)

Archiving happens automatically when a new model is activated. There is no direct API call to archive a model.

**Consequences of archiving:**
- `AccountShare` records derived from the archived model are removed
- `ObjectTerritory2Association` records for the archived model's territories are removed
- `UserTerritory2Association` records for the archived model's territories are preserved (read-only)
- Users lose access to accounts they had only through the archived model (access through OWD, role hierarchy, or manual sharing is unaffected)
- `OpportunityTerritory2Association` records are NOT automatically removed — orphaned territory references may remain until the new model's activation reassigns them

**Archiving is not data deletion:**
All `Territory2`, `Territory2Rule`, and `UserTerritory2Association` records for the archived model remain in the org as read-only historical records. Storage impact is minimal, but the records are not cleaned up automatically.

---

## Cloning a Model

Cloning is the primary mechanism for making changes to a live territory model. You clone the active (or archived) model to a new Planning-state model, make changes, and then activate the clone.

**What clone copies:**
- All `Territory2` records (including `ParentTerritory2Id` relationships)
- All `Territory2Rule` records and their criteria
- `Territory2TypeId` references

**What clone does NOT copy:**
- `UserTerritory2Association` records
- `ObjectTerritory2Association` records
- Any runtime data (account assignments, sharing)

**Cloning via Setup:**
Setup → Territory Management → Territory Models → [Model Name] → Clone

**Post-clone steps:**
1. The cloned model is in `Planning` state and ready for editing
2. Re-add `UserTerritory2Association` records — retrieve them from the source model and re-insert with the new model's territory IDs
3. Make the necessary rule changes
4. Run rules on the Planning clone to validate
5. Activate when ready

**Script for copying user assignments from source to clone:**
```apex
// Map from source Territory2.Name to cloned Territory2.Id
Map<String, Id> clonedTerritoryIdByName = new Map<String, Id>();
for (Territory2 t : [SELECT Id, Name FROM Territory2 WHERE Territory2ModelId = :clonedModelId]) {
    clonedTerritoryIdByName.put(t.Name, t.Id);
}

// Retrieve source user assignments
List<UserTerritory2Association> sourceAssignments = [
    SELECT UserId, RoleInTerritory2, Territory2.Name
    FROM UserTerritory2Association
    WHERE Territory2.Territory2ModelId = :sourceModelId
];

// Build new associations for cloned model
List<UserTerritory2Association> newAssignments = new List<UserTerritory2Association>();
for (UserTerritory2Association uta : sourceAssignments) {
    if (clonedTerritoryIdByName.containsKey(uta.Territory2.Name)) {
        newAssignments.add(new UserTerritory2Association(
            UserId = uta.UserId,
            Territory2Id = clonedTerritoryIdByName.get(uta.Territory2.Name),
            RoleInTerritory2 = uta.RoleInTerritory2
        ));
    }
}
insert newAssignments;
```

---

## Rolling Back to a Prior Model

There is no native rollback. To revert to a previous territory configuration:

1. Find the archived model in Setup → Territory Models (Archived tab)
2. Clone it to create a new Planning-state model
3. Re-add `UserTerritory2Association` records to the clone
4. Activate the cloned model

**Risk:** Account data and Account fields may have changed since the prior model was active. Rules that previously matched may produce different assignment results on the re-cloned model. Always re-run and validate rules before re-activating an archived model's clone.

---

## Territory Model Versioning Best Practice

Treat territory model activations as deployments, not configuration changes.

**Recommended practices:**
1. **Name models with a version or date:** e.g., `FY26 H1 North America`, `FY26 H2 North America v2`
2. **Track in version control:** Use `sf project retrieve start --metadata Territory2Model` to export and commit model configuration to Git
3. **Document activation dates and change justifications** in the model `Description` field
4. **Keep at least one prior archived model** for rollback reference; purge only after a full fiscal year
5. **Never edit an Active model's rules directly** — always clone first, even for minor rule changes
6. **Test rule changes in a sandbox** before applying to production: clone the production active model's configuration into a sandbox and test against a representative Account dataset
