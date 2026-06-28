# Setup, Permissions, and Configuration Reference

## Overview

This reference covers the Salesforce org configuration required to support the full opportunity-to-close lifecycle: enabling Quotes and Opportunity Teams, configuring stages and paths, setting up products and pricebooks, assigning permissions, and establishing the sharing model.

---

## Profiles and Permission Sets

### Standard Sales User Profile

The `Standard User` and `Sales User` standard profiles include basic Opportunity read/write/create/delete permissions. In most production orgs, direct profile assignment is deprecated in favor of Minimum Access + Permission Sets.

### Key Object Permissions Required for Opportunity Work

| Object | Typical Sales Rep Permissions |
|---|---|
| `Opportunity` | Read, Create, Edit, Delete (own records) |
| `OpportunityLineItem` | Read, Create, Edit, Delete |
| `OpportunityContactRole` | Read, Create, Edit, Delete |
| `OpportunityTeamMember` | Read, Create, Edit, Delete |
| `OpportunityHistory` | Read only (no create/edit/delete) |
| `Quote` | Read, Create, Edit, Delete |
| `QuoteLineItem` | Read, Create, Edit, Delete |
| `Product2` | Read |
| `Pricebook2` | Read |
| `PricebookEntry` | Read |
| `CampaignMember` | Read |
| `Task` | Read, Create, Edit, Delete (own) |
| `Event` | Read, Create, Edit, Delete (own) |

### Recommended Permission Sets

- **Sales Cloud User**: Core opportunity and activity permissions. Assign to all sales reps.
- **Sales Cloud Einstein**: Required for Einstein Activity Capture and Einstein Opportunity Scoring. Assign to reps using AI features.
- **CPQ Steelbrick User** (if CPQ is installed): Required for reps who create `SBQQ__Quote__c` records.

### Field-Level Security Considerations

- `Opportunity.Amount`: Should be read-only for reps when line items exist (enforced by the platform), but editable for admin/ops roles when no line items are present.
- `Opportunity.Probability`: Consider making this field read-only for reps and editable only by managers, to prevent gaming of forecast numbers.
- `Opportunity.ForecastCategory`: In most orgs this should be visible but not directly editable by reps; changes come through stage updates.
- `OpportunityTeamMember.TeamMemberRole`: Visible to all, editable only by the team member's manager or the opportunity owner.

---

## Enabling Opportunity Teams

1. Navigate to **Setup → Opportunity Team Settings**.
2. Enable **Opportunity Teams**.
3. Define **Opportunity Team Roles** in Setup → Opportunity Team Roles. Common roles: `Account Executive`, `Solutions Engineer`, `Customer Success`, `Overlay Specialist`, `Partner Manager`.
4. Optionally configure **Default Opportunity Teams** per user so that a rep's default team is automatically added to every new opportunity they create.
5. Grant `OpportunityTeamMember` Create/Edit/Delete permissions via the profile or permission set.

**Note:** `TeamMemberRole` is a restricted picklist. Only values defined in Setup → Opportunity Team Roles are valid. Cross-org data migrations must re-map roles to the target org's configured values.

---

## Enabling Quotes

1. Navigate to **Setup → Quotes Settings**.
2. Enable **Quotes**.
3. This activates the `Quote` and `QuoteLineItem` objects and the **Quotes** related list on the Opportunity page layout.
4. Add `Quote` and `QuoteLineItem` objects to the relevant profiles or permission sets.
5. Assign Quote PDF templates under **Setup → Quote Templates**.
6. Only one `Quote` can have `IsSyncing = true` per opportunity at a time.

**Important:** Standard Quotes and Salesforce CPQ (`SBQQ__Quote__c`) are different features. Enabling standard Quotes does not install CPQ. CPQ requires a separate managed package installation.

---

## Products and Pricebooks Setup

### Standard Pricebook

Salesforce automatically creates one **Standard Price Book** (`Pricebook2` where `IsStandard = true`) per org. It cannot be deleted. All `Product2` records must have a `PricebookEntry` in the Standard Price Book before they can be added to any custom pricebook.

### Setting Up Products

1. Navigate to **Products** (App Launcher or Setup → Products).
2. Create a `Product2` record: set `Name`, `ProductCode`, `Family` (picklist), and `IsActive = true`.
3. Add a Standard Price: on the product record, set `UnitPrice` in the Standard Price Book. This creates a `PricebookEntry` in the standard pricebook.

### Custom Pricebooks

1. Navigate to **Setup → Price Books** or the **Pricebooks** tab.
2. Create a `Pricebook2` record: `Name`, `IsActive = true`.
3. Add `PricebookEntry` records linking each `Product2` to the custom pricebook with its price override.
4. Assign the custom pricebook to `Opportunity.Pricebook2Id` before adding line items.

**Key rule:** A `PricebookEntry` must exist in both the Standard Price Book (required by Salesforce) and any custom pricebook before the product can be added to an opportunity using that custom pricebook.

---

## Stage Configuration

### Configuring Opportunity Stages

1. Navigate to **Setup → Opportunity Stages** (or **Setup → Object Manager → Opportunity → Fields & Relationships → Stage**).
2. Each stage has: `Stage Name`, `Probability (%)`, `Forecast Category`, `Type` (`Open`, `Closed/Won`, `Closed/Lost`), `Position` (sort order).
3. `Forecast Category` must be one of: `Omitted`, `Pipeline`, `BestCase`, `Commit`, `Closed`.
4. `Type` of `Closed/Won` sets `IsWon = true` and `IsClosed = true`. `Type` of `Closed/Lost` sets `IsClosed = true` and `IsWon = false`.
5. Stage changes take effect immediately — no migration of existing records.

**Best practice:** Limit stages to 7–9. Too many stages create confusion and reduce rep adoption. Map stages to real buyer journey milestones, not internal sales process steps.

### Path Configuration for Guided Selling

1. Navigate to **Setup → Path Settings** → **Enable Path**.
2. Create a new Path on the `Opportunity` object using the `StageName` field.
3. For each stage, configure:
   - **Key Fields**: Fields that should be filled in before advancing (displayed in the Path component).
   - **Guidance for Success**: Free-text coaching notes shown to the rep at that stage.
4. Deploy the Path to the Opportunity Lightning record page via **Setup → Lightning App Builder**.
5. **Entry criteria on Path do not block record save** — they are guidance only. To enforce entry criteria, combine Path with validation rules.

---

## Validation Rule Patterns for Stage Entry Criteria

Stage entry criteria prevent reps from advancing an opportunity to a new stage without completing required fields or activities. Two approaches:

### Approach 1: Validation Rule (Platform-Enforced)

Blocks save if a stage is advanced without required fields populated.

```
/* Block advancing past Qualification without a close date in the future */
AND(
  ISPICKVAL(StageName, "Needs Analysis"),
  ISPICKVAL(PRIORVALUE(StageName), "Prospecting"),
  CloseDate <= TODAY()
)
```

```
/* Block Proposal stage without an economic buyer contact role */
AND(
  ISPICKVAL(StageName, "Proposal/Price Quote"),
  /* Custom formula field: HasEconomicBuyer__c = TRUE when IsPrimary OCR exists */
  NOT(HasEconomicBuyer__c)
)
```

**Tip:** Validation rules that check related objects (e.g., "has at least one OpportunityContactRole with Role = Decision Maker") require a helper formula field or Apex trigger, since validation rules cannot traverse relationships in aggregate.

### Approach 2: Apex Trigger

For complex multi-step stage-entry validation involving related records (contact roles, activities), use a `before update` trigger on `Opportunity`. This approach can query related objects and build rich error messages.

```apex
trigger OpportunityStageGate on Opportunity (before update) {
    for (Opportunity opp : Trigger.new) {
        Opportunity old = Trigger.oldMap.get(opp.Id);
        if (opp.StageName == 'Proposal/Price Quote'
            && old.StageName != 'Proposal/Price Quote') {
            // query OpportunityContactRole for IsPrimary = true
            // query Task for completed discovery call activity
            // add opp.addError(...) if criteria not met
        }
    }
}
```

---

## Sharing Model

### Organization-Wide Defaults (OWD)

`Opportunity` OWD is typically set to **Private** in most orgs. This means only the owner and users above them in the role hierarchy can access an opportunity by default.

Common configurations:
- **Private**: Standard for most sales orgs. Visibility controlled by role hierarchy and sharing rules.
- **Public Read Only**: All users can see all opportunities; only owner can edit.
- **Public Read/Write**: All users can see and edit all opportunities. Rare; typically only used in very small orgs.

### Sharing Mechanisms

| Mechanism | How It Works |
|---|---|
| **Role Hierarchy** | Users above the owner in the role hierarchy automatically see the owner's records (if `Grant Access Using Hierarchies` is enabled) |
| **Criteria-Based Sharing Rules** | Share opportunities matching field criteria (e.g., `Type = New Business`) with a group or role |
| **Owner-Based Sharing Rules** | Share opportunities owned by a particular role with another role or group |
| **Manual Sharing** | Rep-initiated share to a specific user or group; available if OWD is Private or Public Read Only |
| **Opportunity Team Sharing** | `OpportunityTeamMember` records with `OpportunityAccessLevel = Edit` or `Read` grant access to team members automatically |
| **Account Team Sharing** | If Account Teams are enabled, team members on the account may inherit opportunity access based on Account Team sharing settings |

### Apex Managed Sharing

For complex dynamic sharing (e.g., share with the rep's manager's manager automatically), use Apex Managed Sharing: create `OpportunityShare` records programmatically with `RowCause = Schema.OpportunityShare.RowCause.Manual` (or a custom share reason).
