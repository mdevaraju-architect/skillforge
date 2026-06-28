# Opportunity Object Model — Architecture Reference

## Overview

The `Opportunity` object is the central record in Sales Cloud representing a sales deal in progress or completed. It sits at the hub of a spoke-and-wheel data model: products, contacts, team members, history, activities, quotes, and campaign data all relate back to a single `Opportunity` record.

---

## Hub-and-Spoke Diagram

```
                        ┌──────────────────────────────┐
                        │          Opportunity          │
                        │  (Id, AccountId, OwnerId)     │
                        └──────────────┬───────────────┘
                                       │
          ┌────────────┬───────────────┼───────────────┬────────────┬──────────────┐
          │            │               │               │            │              │
          ▼            ▼               ▼               ▼            ▼              ▼
  OpportunityLineItem  OpportunityContactRole  OpportunityTeamMember  Task / Event
  (products / pricing) (contact roles)         (deal team)            (WhatId → Opp)

          │            │               │               │
          ▼            ▼               ▼               ▼
  PricebookEntry     Contact         User         OpportunityHistory
  (→ Product2,       (→ Account)     (team reps)  (auto-audit trail)
   → Pricebook2)

          │
          ▼
        Quote
        (→ QuoteLineItem)

          │
          ▼
   CampaignMember
   (→ Campaign via
    Opportunity.CampaignId
    + CampaignInfluence)
```

---

## Opportunity — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated 18-char Id |
| `Name` | Text(120) | Required. Opportunity name |
| `AccountId` | Lookup(Account) | Required in most orgs; the associated account |
| `OwnerId` | Lookup(User) | Record owner; defaults to creating user |
| `StageName` | Picklist | Required. Drives `ForecastCategory` and `Probability` |
| `CloseDate` | Date | Required. Expected or actual close date |
| `Amount` | Currency | Auto-calculated when line items exist; writable otherwise |
| `Probability` | Percent | Auto-set from stage default; can be overridden if enabled |
| `ForecastCategory` | Picklist | Derived from `StageName`; values: `Omitted`, `Pipeline`, `BestCase`, `Commit`, `Closed` |
| `Type` | Picklist | `New Business`, `Existing Business`, `Add-On Business`, `Renewal` |
| `LeadSource` | Picklist | How the opportunity was sourced |
| `CampaignId` | Lookup(Campaign) | Primary campaign source |
| `IsClosed` | Boolean | Formula: true when stage is a closed stage |
| `IsWon` | Boolean | Formula: true when stage is `Closed Won` |
| `NextStep` | Text(255) | Free-text field for next action |
| `Description` | TextArea | Long-form notes |
| `Pricebook2Id` | Lookup(Pricebook2) | Required before adding `OpportunityLineItem` records |
| `HasOpportunityLineItem` | Boolean | True if any `OpportunityLineItem` records exist |
| `LastActivityDate` | Date | Auto-populated from most recent `Task` or `Event` |
| `LastStageChangeDate` | Date | Auto-populated when `StageName` changes |
| `ExpectedRevenue` | Currency | Calculated as `Amount × Probability / 100` |
| `TotalOpportunityQuantity` | Number | Sum of `OpportunityLineItem.Quantity` |
| `FiscalQuarter` | Integer | Derived from `CloseDate` based on fiscal year settings |
| `FiscalYear` | Integer | Derived from `CloseDate` |
| `ContractId` | Lookup(Contract) | Optional link to a Contract record |
| `CreatedDate` | DateTime | System-set at record creation |
| `LastModifiedDate` | DateTime | System-set on every save |

---

## StageName — Standard Picklist Values and ForecastCategory Mappings

The following are the standard out-of-box `StageName` values and their default `ForecastCategory` and `Probability` mappings. These can be customized in Setup → Opportunity Stages.

| StageName | ForecastCategory | Default Probability (%) | IsClosed | IsWon |
|---|---|---|---|---|
| `Prospecting` | `Pipeline` | 10 | false | false |
| `Qualification` | `Pipeline` | 20 | false | false |
| `Needs Analysis` | `Pipeline` | 20 | false | false |
| `Value Proposition` | `Pipeline` | 50 | false | false |
| `Id. Decision Makers` | `Pipeline` | 60 | false | false |
| `Perception Analysis` | `Pipeline` | 70 | false | false |
| `Proposal/Price Quote` | `Pipeline` | 75 | false | false |
| `Negotiation/Review` | `BestCase` | 90 | false | false |
| `Closed Won` | `Closed` | 100 | true | true |
| `Closed Lost` | `Omitted` | 0 | true | false |

**Note:** Custom stages can be added in Setup → Opportunity Stages. Each custom stage must have a `ForecastCategory` assigned. If left blank, that stage's opportunities will not appear in forecast rollups.

---

## ForecastCategory — API Values

| API Value | Display Label | Meaning |
|---|---|---|
| `Omitted` | Omitted | Excluded from all forecast views; typically Closed Lost |
| `Pipeline` | Pipeline | Included in pipeline totals; not committed or best-case |
| `BestCase` | Best Case | Rep believes this deal could close; included in Best Case forecast |
| `Commit` | Commit | Rep is committing this deal; included in Commit forecast |
| `Closed` | Closed | Deal is closed; historical revenue |

---

## OpportunityLineItem — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `OpportunityId` | Lookup(Opportunity) | Required. Parent opportunity |
| `PricebookEntryId` | Lookup(PricebookEntry) | Required. Must match `Opportunity.Pricebook2Id` |
| `Product2Id` | Lookup(Product2) | Auto-populated from `PricebookEntry` |
| `Name` | Text | Auto-populated from `Product2.Name`; can be overridden |
| `Quantity` | Number | Required. Number of units |
| `UnitPrice` | Currency | Required. Price per unit |
| `TotalPrice` | Currency | Calculated: `Quantity × UnitPrice × (1 - Discount/100)` |
| `Discount` | Percent | Optional. Reduces `UnitPrice` |
| `ListPrice` | Currency | Read-only. From `PricebookEntry.UnitPrice` |
| `ServiceDate` | Date | Optional. Start date for service/subscription |
| `Description` | Text | Line item notes |
| `SortOrder` | Integer | Display order on quote/PDF |
| `HasRevenueSchedule` | Boolean | True if `OpportunityLineItemSchedule` records exist |
| `HasQuantitySchedule` | Boolean | True if quantity schedules exist |

---

## OpportunityContactRole — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `OpportunityId` | Lookup(Opportunity) | Parent opportunity |
| `ContactId` | Lookup(Contact) | The related contact |
| `Role` | Picklist | `Decision Maker`, `Economic Buyer`, `Technical Buyer`, `Champion`, `Evaluator`, `User`, `Executive Sponsor`, `Influencer` |
| `IsPrimary` | Boolean | Exactly one per opportunity should be true |

**Note:** `Contact.AccountId` does not need to match `Opportunity.AccountId`. Cross-account contact roles are allowed and common in partner or channel deals.

---

## OpportunityTeamMember — Key Fields

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `OpportunityId` | Lookup(Opportunity) | Parent opportunity |
| `UserId` | Lookup(User) | The team member |
| `TeamMemberRole` | Picklist | Org-specific values configured in Setup → Opportunity Team Roles |
| `OpportunityAccessLevel` | Picklist | `Read`, `Edit` |

---

## OpportunityHistory — Key Fields

This is a read-only, system-managed child object. No DML is permitted.

| Field API Name | Type | Notes |
|---|---|---|
| `Id` | ID | System-generated |
| `OpportunityId` | Lookup(Opportunity) | Parent opportunity |
| `StageName` | Picklist | Stage value at time of change |
| `Amount` | Currency | Amount at time of change |
| `Probability` | Percent | Probability at time of change |
| `ForecastCategory` | Picklist | Forecast category at time of change |
| `CloseDate` | Date | Close date at time of change |
| `CreatedDate` | DateTime | When the change was recorded |
| `CreatedById` | Lookup(User) | Who made the change |

---

## Account and Contact Relationships

- `Opportunity.AccountId` → `Account.Id`: The company the deal is with.
- `OpportunityContactRole.ContactId` → `Contact.Id`: Contacts involved in the deal. These contacts may belong to different accounts (e.g., partner contacts, consulting firm contacts).
- `Opportunity.OwnerId` → `User.Id`: The primary sales rep. Does not need to be an `OpportunityTeamMember` — the owner already has full access.

---

## Campaign Relationship

- `Opportunity.CampaignId` → `Campaign.Id`: The single primary campaign source. Auto-populated from the most recent `CampaignMember` record when a lead is converted or when a campaign is manually selected.
- `CampaignInfluence` (object): Links `Campaign.Id`, `Opportunity.Id`, and `Contact.Id` for multi-touch attribution. Not the same as `Opportunity.CampaignId`. Requires Campaign Influence to be enabled in Setup.

---

## Task and Event Relationship

`Task` and `Event` records link to `Opportunity` via the `WhatId` field (polymorphic lookup). The `ActivityTimeline` component on the Opportunity record page displays all tasks and events where `WhatId` = the opportunity Id. `LastActivityDate` on `Opportunity` is auto-maintained by the platform based on completed tasks and events.
