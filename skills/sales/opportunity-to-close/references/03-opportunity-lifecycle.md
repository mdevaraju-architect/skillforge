# Opportunity Lifecycle Reference

## Overview

This reference covers the full stage lifecycle of a Salesforce `Opportunity` from initial creation through close. It includes stage-entry criteria patterns, required field checklists per stage, ForecastCategory mappings, close plan structure, win/loss capture, OpportunityHistory audit, and operations for renewals and overlay splits.

---

## Full Stage Lifecycle

### Stage Progression Overview

```
Prospecting → Qualification → Needs Analysis → Value Proposition
→ Id. Decision Makers → Perception Analysis → Proposal/Price Quote
→ Negotiation/Review → Closed Won
                      → Closed Lost (from any open stage)
```

Stage transitions are not platform-enforced by default. See the validation rule and trigger patterns in `02-setup-and-permissions.md`. Every stage change is recorded in `OpportunityHistory`.

---

## Required Fields Per Stage — Recommended Checklist

This checklist combines required platform fields with best-practice custom fields. Adapt to your org's sales methodology.

### Prospecting
- `Name` (required)
- `AccountId` (required in most orgs)
- `CloseDate` (required; set a realistic future date)
- `StageName` = `Prospecting`
- `Type` (`New Business` or `Existing Business`)
- `LeadSource`
- `OwnerId`

### Qualification
- All Prospecting fields
- `OpportunityContactRole` with `IsPrimary = true` exists
- `Description` or custom qualification notes field populated
- `Amount` (initial estimate)
- `CampaignId` (if sourced from a campaign)

### Needs Analysis
- All Qualification fields
- Discovery activity logged: `Task` or `Event` with `WhatId` = opportunity Id and `Subject` containing "Discovery" or equivalent
- Custom `Business_Pain__c` or `Use_Case__c` populated

### Value Proposition
- All Needs Analysis fields
- `NextStep` populated with a clear action item
- Custom `Value_Proposition__c` or `Compelling_Event__c` populated

### Id. Decision Makers
- `OpportunityContactRole` with `Role = Decision Maker` exists
- `OpportunityContactRole` with `Role = Economic Buyer` exists
- Org chart or stakeholder map documented (custom field or attached file)

### Perception Analysis
- Competitive analysis documented (custom `Competitor__c` picklist or text field)
- `OpportunityTeamMember` records added if SE or overlay support needed

### Proposal/Price Quote
- `Pricebook2Id` set
- At least one `OpportunityLineItem` exists, or a `Quote` record created
- `Quote` sent to customer (custom `Quote_Sent_Date__c` or `Task` logged)

### Negotiation/Review
- `ForecastCategory` = `BestCase` or `Commit` (set by rep override if org permits)
- Legal or procurement contact role added to `OpportunityContactRole`
- Custom `Verbal_Commit_Date__c` or equivalent logged

### Closed Won
- `StageName` = `Closed Won`
- `CloseDate` updated to actual close date
- `Amount` finalized and matches signed deal
- Win-capture custom fields populated (e.g., `Win_Reason__c`, `Why_We_Won__c`)
- `ContractId` linked if a contract was generated

### Closed Lost
- `StageName` = `Closed Lost`
- `CloseDate` updated to actual loss date
- `Loss_Reason__c` populated (picklist; never leave blank)
- `Competitor__c` populated if lost to a competitor
- Custom `Why_We_Lost__c` free-text field populated

---

## ForecastCategory Mapping Recap

| Stage | ForecastCategory | Included in Forecast |
|---|---|---|
| Prospecting through Proposal | `Pipeline` | Pipeline total only |
| Negotiation/Review | `BestCase` | Best Case + Pipeline |
| (Rep override) | `Commit` | Commit + Best Case + Pipeline |
| Closed Won | `Closed` | Closed total (historical) |
| Closed Lost | `Omitted` | Excluded from all views |

Rep-managed override of `ForecastCategory` (changing to `Commit` or `BestCase` independently of stage) requires org-level configuration in Forecast Settings.

---

## Stage-Entry Criteria Patterns

### Pattern 1: Validation Rule Blocking Backward Jumps

Prevent a rep from moving a Closed Won opportunity back to an open stage (which would corrupt OpportunityHistory and forecast rollups):

```
AND(
  NOT(ISPICKVAL(StageName, "Closed Won")),
  ISPICKVAL(PRIORVALUE(StageName), "Closed Won")
)
```

### Pattern 2: Required Activity Before Stage Advance

Block advance to `Proposal/Price Quote` without a completed discovery task. Because validation rules cannot query child records directly, use a helper formula field `Has_Discovery_Task__c` (populated by a flow or trigger) and reference it in the rule:

```
AND(
  ISPICKVAL(StageName, "Proposal/Price Quote"),
  NOT(ISPICKVAL(PRIORVALUE(StageName), "Proposal/Price Quote")),
  NOT(Has_Discovery_Task__c)
)
```

### Pattern 3: Apex Trigger for Complex Multi-Object Validation

For stage-entry criteria that check related objects (OpportunityContactRole, Task counts, product line items), use a `before update` Apex trigger. Query the related objects inside the trigger and call `opp.addError()` to block the save with a descriptive message.

---

## Close Plan Structure

A close plan documents the mutually agreed actions required to close the deal by the target `CloseDate`. It can be implemented as:

### Option A: Activity-Based Close Plan
- Create a series of `Task` records with `WhatId` = opportunity Id, each with a `Subject`, `ActivityDate`, and assigned `OwnerId`.
- Use a standard List View or report filtered to `WhatId = [opportunity]` and `Status != Completed` to show the open close plan items.

### Option B: Custom Fields on Opportunity
Add custom fields:
- `Close_Plan_Summary__c` (Long Text Area): Free-text close plan overview
- `Mutual_Close_Plan_Date__c` (Date): Date the close plan was agreed with the prospect
- `Executive_Sponsor_Engaged__c` (Checkbox): Confirms exec alignment
- `Legal_Review_Complete__c` (Checkbox): Confirms legal sign-off
- `Next_Step_Due_Date__c` (Date): Deadline for the next action

### Option C: Chatter + Einstein Activity Capture
Use Chatter posts on the opportunity record with `@mentions` to tag team members for accountability. Einstein Activity Capture (if licensed) auto-logs emails and meetings, reducing manual task entry.

---

## Win/Loss Capture at Close

Win/loss data is only valuable if consistently captured. Enforce population at close using a flow or validation rule.

### Recommended Win/Loss Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Win_Reason__c` | Picklist | `Product Fit`, `Price`, `Relationship`, `Features`, `Support`, `Speed to Value` |
| `Loss_Reason__c` | Picklist | `Price`, `Competition`, `No Decision`, `Timing`, `Product Gap`, `Relationship`, `Budget Frozen` |
| `Competitor__c` | Picklist (multi-select or lookup) | Main competitor in the deal |
| `Why_We_Won__c` | Long Text Area | Rep narrative on win drivers |
| `Why_We_Lost__c` | Long Text Area | Rep narrative on loss factors |
| `Decision_Criteria__c` | Long Text Area | What the buyer said they were evaluating |

### Flow Enforcement Pattern

Create a Screen Flow triggered on `StageName` change to `Closed Lost`:
1. Trigger: Record-triggered flow on `Opportunity`, runs on Update.
2. Condition: `StageName = Closed Lost` AND `PRIORVALUE(StageName) != Closed Lost`.
3. Action: Launch a Screen Flow that presents the rep with required win/loss fields.
4. Commit: Update the `Opportunity` record with the captured values.

---

## OpportunityHistory — Using the Audit Trail

`OpportunityHistory` is the system-generated audit trail for opportunity field changes. It cannot be created, updated, or deleted via DML.

### Fields Tracked in OpportunityHistory

Changes to these fields on `Opportunity` generate a new `OpportunityHistory` row:
- `StageName`
- `Amount`
- `Probability`
- `ForecastCategory`
- `CloseDate`

### Querying Stage Velocity

```soql
SELECT OpportunityId, StageName, CreatedDate
FROM OpportunityHistory
WHERE Opportunity.CloseDate = THIS_FISCAL_YEAR
ORDER BY OpportunityId, CreatedDate ASC
```

Use this query to calculate time-in-stage per opportunity. Join to `Opportunity` to segment by rep, territory, or deal size. Average time-in-stage by stage reveals where deals stall.

### Querying Deal Slippage

```soql
SELECT OpportunityId, CloseDate, PRIORVALUE(CloseDate), CreatedDate
FROM OpportunityHistory
WHERE Field = 'CloseDate'
  AND PRIORVALUE(CloseDate) < CloseDate
ORDER BY CreatedDate DESC
```

This surfaces opportunities where `CloseDate` was pushed out — a key signal for forecast risk.

---

## Cloning Opportunities for Renewals

Salesforce does not have a native "renewal" process for standard Sales Cloud (that is a Revenue Cloud / Subscription Management capability). The common pattern for renewals:

1. **Clone the closed opportunity**: Use the standard Clone button or `Database.query` + `insert` in Apex on the parent `Opportunity`, copying key fields.
2. **Set the new CloseDate**: Advance by the renewal period (e.g., 12 months).
3. **Reset stage**: Set `StageName = Prospecting` on the cloned record.
4. **Re-link contact roles**: `OpportunityContactRole` records are not cloned automatically — re-insert them referencing the new `Opportunity.Id`.
5. **Re-link products**: `OpportunityLineItem` records are not cloned — re-insert from the same `PricebookEntry` references.
6. **Link to original**: Add a custom `Parent_Opportunity__c` lookup field to track the renewal chain.

**Automation approach:** Build a Flow or Apex handler that fires when `StageName` transitions to `Closed Won` and creates the renewal opportunity automatically, copying required fields and re-inserting contact roles.

---

## Opportunity Splitting for Overlay Reps

Opportunity Splits allow credit for a deal to be divided across multiple reps (e.g., territory rep + overlay specialist). This feature is separate from `OpportunityTeamMember`.

### Enabling Opportunity Splits

1. Navigate to **Setup → Opportunity Splits**.
2. Enable Opportunity Splits.
3. Configure split types: the default **Revenue Split** (must total 100%) and optional **Overlay Split** (can total any percentage, does not need to sum to 100%).
4. Add `OpportunityTeamMember` records — splits can only be assigned to existing team members.

### Key Object: `OpportunitySplit`

| Field API Name | Type | Notes |
|---|---|---|
| `OpportunityId` | Lookup(Opportunity) | Parent opportunity |
| `SplitOwnerId` | Lookup(User) | The rep receiving split credit |
| `SplitPercentage` | Percent | Percentage of credit |
| `SplitTypeId` | Lookup(OpportunitySplitType) | Revenue split or Overlay split |
| `SplitAmount` | Currency | Calculated: `Opportunity.Amount × SplitPercentage / 100` |

**Revenue Splits** must sum to exactly 100%. A validation error is thrown if they do not. **Overlay Splits** have no sum constraint.
