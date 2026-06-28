---
name: service-knowledge-management
description: >-
  Knowledge, KnowledgeArticleVersion, DataCategory, DataCategoryGroup,
  DataCategoryGroupAssignment, KnowledgeArticleViewStat, KnowledgeArticleVoteStat,
  Lightning Knowledge, article lifecycle, Draft, Review, Published, Archived,
  article version, channel visibility, Internal App, Customer, Partner,
  Public Knowledge Base, case deflection, SOSL knowledge search, article feedback,
  article translation, article type migration, content type, record type articles
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "internal"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: service
  module: knowledge-management
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Knowledge Management — Skill

## Overview

This skill covers Salesforce Lightning Knowledge: article lifecycle management, data
category configuration, channel visibility, case deflection, full-text search via
SOSL, article versions, translations, and Classic-to-Lightning migration patterns.

---

## Always True (Gotchas)

### 1. Lightning Knowledge uses a single `Knowledge` object with Record Types — not separate Article Type objects

In Lightning Knowledge (post-Spring '18), all article types are **Record Types on the
`Knowledge` SObject** (standard API name: `Knowledge__kav`; managed-package variants
use a namespace prefix). Classic Knowledge had a separate `MyArticle__kav` SObject
per article type, with each type having its own fields and page layouts.

Migration from Classic to Lightning requires converting article type objects to Record
Types. After migration, all article content lives in `Knowledge__kav` rows
differentiated by `RecordTypeId`. Querying `MyArticle__kav` in a Lightning Knowledge
org returns an error — the type-specific SObjects no longer exist.

### 2. `Knowledge__kav.PublishStatus` transitions: `Draft → Online → Archived`

`Online` is the published state — **the field value is `'Online'`, not `'Published'`**.
Attempting to set `PublishStatus = 'Published'` throws
`INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`. The valid picklist values are:

| UI Label  | API Value    | Meaning                              |
|-----------|--------------|--------------------------------------|
| Draft     | `Draft`      | Work in progress, not visible        |
| Published | `Online`     | Live and searchable by users         |
| Archived  | `Archived`   | Removed from search, record retained |

To publish a Draft article programmatically, update `PublishStatus = 'Online'`. To
archive, set `PublishStatus = 'Archived'`. There is no direct `Draft → Archived`
transition — publish first if needed, or archive directly from Draft.

### 3. Each published edit creates a new version — `VersionNumber` increments, `KnowledgeArticleId` is shared

Editing a Published (`Online`) article creates a new `Knowledge__kav` row with an
incremented `VersionNumber` and a new `Id`, while the previously published row
remains visible to users until the new version is published.

- `Knowledge__kav.KnowledgeArticleId` — shared across **all versions** of the same
  logical article. Use this as the stable external identifier.
- `Knowledge__kav.Id` — unique per version row. Avoid storing this as a persistent
  reference — it changes each time a new version is published.
- `Knowledge__kav.VersionNumber` — auto-incremented integer. The currently published
  version has the highest `VersionNumber` where `PublishStatus = 'Online'`.

### 4. `DataCategoryGroupAssignment` controls article visibility — unassigned articles are not searchable in category-restricted contexts

Articles without a `DataCategoryGroupAssignment` record are **invisible** in:

- The Knowledge sidebar in Service Console
- Case deflection / Suggested Articles panels
- Channel search results when data category visibility is applied to roles/profiles

Always assign at least one data category to every published article. An article can
have multiple `DataCategoryGroupAssignment` records (one per DataCategoryGroup). The
assignment is on the **master** `KnowledgeArticle` record, not on the version row.

### 5. `DataCategoryGroup` must be assigned to the `KnowledgeArticle` SObject type

`DataCategoryGroup.SobjectType` specifies which object the category group applies to.
Valid values include `KnowledgeArticle`, `Question`, and `Solution`. A
`DataCategoryGroup` with `SobjectType = 'Question'` will **not** appear in Knowledge
article category selectors, even if the categories exist and are active.

Verify via SOQL: `SELECT Name, SobjectType FROM DataCategoryGroup WHERE IsActive = true
AND SobjectType = 'KnowledgeArticle'`. If no rows return, no category groups are
wired to Knowledge and all published articles are invisible in category-filtered
search.

### 6. Channel visibility is four separate checkbox fields on `Knowledge__kav`

Channel visibility is controlled by four boolean fields:

| Channel                | Field Name         |
|------------------------|--------------------|
| Internal App           | `IsVisibleInApp`   |
| Public Knowledge Base  | `IsVisibleInPkb`   |
| Customer Community     | `IsVisibleInCsp`   |
| Partner Community      | `IsVisibleInPrm`   |

Setting channel visibility on a **Draft** article does not make it visible — the
article must also have `PublishStatus = 'Online'`. Both conditions must be true
simultaneously. It is valid (and common) to pre-set channel flags on a Draft article
before publishing so the article is immediately visible in the correct channels upon
publication.

### 7. SOSL `FIND` is the correct query mechanism for Knowledge full-text search — SOQL is not available on body fields

Article body fields (rich text `Html` fields) are **not queryable** via SOQL `LIKE` or
`=`. Full-text search requires SOSL:

```apex
List<List<SObject>> results = [
    FIND :searchTerm IN ALL FIELDS
    RETURNING Knowledge__kav(
        Id, KnowledgeArticleId, Title, Summary, VersionNumber
        WHERE PublishStatus = 'Online'
        AND IsVisibleInApp = true
        ORDER BY Title LIMIT 10
    )
];
List<Knowledge__kav> articles = (List<Knowledge__kav>) results[0];
```

SOSL respects data category visibility and channel visibility for the running user.
Never attempt `SELECT Body__c FROM Knowledge__kav WHERE Body__c LIKE '%term%'` — this
throws `INVALID_FIELD` because rich-text fields are not filterable in SOQL.

### 8. `KnowledgeArticleViewStat` and `KnowledgeArticleVoteStat` are read-only system objects

These objects are populated automatically by Salesforce and **cannot be inserted,
updated, or deleted** via Apex or Data Loader. Attempting a DML operation throws
`OPERATION_NOT_ALLOWED`.

Query them for reporting and analytics:

```soql
-- View counts per article
SELECT ParentId, NormalizedScore, Count
FROM KnowledgeArticleViewStat
WHERE ParentId = :knowledgeArticleId

-- Vote/helpfulness scores
SELECT ParentId, NormalizedScore, WasVotedHelpful
FROM KnowledgeArticleVoteStat
WHERE ParentId = :knowledgeArticleId
```

`ParentId` is the **`KnowledgeArticleId`** (master record ID), not the version `Id`.

### 9. Archiving an article does NOT delete it

Setting `PublishStatus = 'Archived'` removes the article from all search results and
channel visibility but **retains the record** in the org. Archived articles:

- Are not returned in SOSL searches (unless explicitly filtering for `Archived`)
- Are not shown in the Knowledge sidebar or case deflection panels
- Can be restored to Draft: update `PublishStatus = 'Draft'`
- Can be queried directly: `SELECT Id, Title FROM Knowledge__kav WHERE PublishStatus = 'Archived'`

Deleted articles (via the UI delete button or DML `delete`) set `IsDeleted = true` and
go to the Recycle Bin. Many teams mistakenly assume Archived = deleted and recreate
content that already exists in archived state, accumulating duplicates. Always search
archived articles before creating new ones on similar topics.

### 10. The `Summary` field (255 characters max) is the search snippet

`Knowledge__kav.Summary` is surfaced in:

- SOSL search result cards in Service Console
- Case deflection / Suggested Articles panels
- Public Knowledge Base article listings
- Email-to-case auto-suggested article previews

Articles without a populated `Summary` display **only the Title** in search results,
significantly reducing click-through rates and deflection effectiveness. Always
populate `Summary` for every published article. Populate it as part of the article
creation workflow (see Workflow 1 below), not as a post-publish cleanup step.

### 11. Article translations require Translation Workbench to be enabled

Translated articles share the same `KnowledgeArticleId` as the source-language article
but have a distinct `Id` and a different `Language` field value (e.g., `'fr'`, `'de'`,
`'ja'`).

Pre-requisites:

1. Translation Workbench must be enabled in Setup → Translation Workbench.
2. The target language must be added as a supported language.
3. The running user must have the **Manage Translations** permission or be assigned as
   a translator for the target language.

Attempting to import translated articles via Data Loader or Apex without Translation
Workbench enabled throws a permission error. Translated versions cannot be created
in orgs where only the Knowledge feature (not Translation Workbench) is enabled.

### 12. `CaseArticle` is the correct junction for attaching articles to cases — not `Case.KnowledgeArticleId`

The recommended pattern for tracking which knowledge articles were used to resolve a
case uses the `CaseArticle` junction object:

```apex
CaseArticle ca = new CaseArticle(
    CaseId = caseId,
    KnowledgeArticleId = article.KnowledgeArticleId  // master ID, not version Id
);
insert ca;
```

`Case.KnowledgeArticleId` is a legacy field from an older integration pattern and is
not surfaced on standard Lightning page layouts. Using `CaseArticle` is required for:

- Article attachment tracking in Knowledge analytics
- `KnowledgeArticleViewStat` increments that are attributed to case resolution
- Reporting on deflected cases via the Knowledge dashboard

---

## Routing Table

| Question / Task                                      | Reference File                         |
|------------------------------------------------------|----------------------------------------|
| Object model, field names, relationships             | `references/01-architecture.md`        |
| Enabling Knowledge, permissions, org setup           | `references/02-setup-and-permissions.md` |
| Article lifecycle: create, publish, edit, archive    | `references/03-article-lifecycle.md`   |
| SOSL search queries, case deflection, view stats     | `references/04-search-and-deflection.md` |
| Data model tables, migration, bulk operations        | `references/05-data-model-and-migration.md` |

---

## Workflows

### Workflow 1: Create and Publish a New Article (Draft → Review → Published)

**Goal:** Create a new Knowledge article, route it through a review step, and publish
it to the Internal App channel.

**Steps:**

1. **Create the Draft article**

   ```apex
   // Get the target Record Type for the article category (e.g., "FAQ")
   Id faqRecordTypeId = Schema.SObjectType.Knowledge__kav
       .getRecordTypeInfosByDeveloperName()
       .get('FAQ')
       .getRecordTypeId();

   Knowledge__kav article = new Knowledge__kav(
       RecordTypeId    = faqRecordTypeId,
       Title           = 'How do I reset my password?',
       Summary         = 'Step-by-step instructions for resetting your account password via the login page or mobile app.',
       // Body__c is a custom rich-text field on the article record type layout
       // Field API name depends on the org's field configuration
       IsVisibleInApp  = true,
       IsVisibleInPkb  = false,
       IsVisibleInCsp  = false,
       IsVisibleInPrm  = false
       // PublishStatus defaults to 'Draft' — do not set explicitly on insert
   );
   insert article;
   ```

2. **Submit for review (Approval Process)**

   If an Approval Process is configured on `Knowledge__kav`:

   ```apex
   Approval.ProcessSubmitRequest req = new Approval.ProcessSubmitRequest();
   req.setObjectId(article.Id);
   req.setComments('Ready for technical review.');
   Approval.ProcessResult result = Approval.process(req);
   ```

   If using a custom Flow or manual review, update a custom validation status field:

   ```apex
   article.Validation_Status__c = 'In Review';
   update article;
   ```

3. **Assign a DataCategory after review approval**

   ```apex
   // DataCategoryGroupAssignment is on KnowledgeArticle (master), not the version
   KnowledgeArticle master = [
       SELECT Id FROM KnowledgeArticle
       WHERE Id = :article.KnowledgeArticleId
   ];

   DataCategoryGroupAssignment dcga = new DataCategoryGroupAssignment(
       ParentId              = master.Id,
       DataCategoryGroupName = 'Products',   // Developer name of the group
       DataCategoryName      = 'PasswordReset' // Developer name of the category
   );
   insert dcga;
   ```

4. **Publish the article**

   ```apex
   Knowledge__kav toPublish = [
       SELECT Id, PublishStatus FROM Knowledge__kav
       WHERE Id = :article.Id
   ];
   toPublish.PublishStatus = 'Online';
   update toPublish;
   ```

   After this update, `IsVisibleInApp = true` and `PublishStatus = 'Online'` — the
   article is immediately searchable in the Service Console for internal agents.

---

### Workflow 2: Update a Published Article and Publish the New Version

**Goal:** Edit a live article (correcting content), create a new version, and publish
it while keeping the old version visible until the new one is ready.

**Steps:**

1. **Find the currently published version**

   ```apex
   Knowledge__kav published = [
       SELECT Id, KnowledgeArticleId, Title, VersionNumber, PublishStatus
       FROM Knowledge__kav
       WHERE Title = 'How do I reset my password?'
       AND PublishStatus = 'Online'
       LIMIT 1
   ];
   ```

2. **Create an editable Draft copy (new version)**

   In Apex, use `KbManagement.PublishingService.editOnlineArticle` to create a new
   Draft version from the published article:

   ```apex
   // editOnlineArticle returns the Id of the newly created Draft version
   String newDraftId = KbManagement.PublishingService.editOnlineArticle(
       published.KnowledgeArticleId,
       false  // false = do not unpublish the current version immediately
   );
   ```

3. **Update the new Draft version**

   ```apex
   Knowledge__kav draft = [
       SELECT Id, Title, Summary FROM Knowledge__kav WHERE Id = :newDraftId
   ];
   draft.Summary = 'Updated: Step-by-step instructions for resetting your password, including new MFA reset steps added in June 2025.';
   update draft;
   ```

4. **Publish the new version**

   Publishing the new version automatically archives the previous `Online` version:

   ```apex
   Knowledge__kav draftToPublish = [
       SELECT Id, PublishStatus FROM Knowledge__kav WHERE Id = :newDraftId
   ];
   draftToPublish.PublishStatus = 'Online';
   update draftToPublish;
   ```

   After this step:
   - New version: `PublishStatus = 'Online'`, `VersionNumber` = previous + 1
   - Old version: `PublishStatus = 'Archived'`

---

### Workflow 3: Configure Case Deflection with Knowledge Search

**Goal:** Surface relevant Knowledge articles to agents and customers during case
creation to deflect cases before submission.

**Steps:**

1. **Verify Lightning Knowledge is enabled and articles are published with correct
   channel visibility**

   - Agents (Internal): `IsVisibleInApp = true`
   - Customers self-service: `IsVisibleInPkb = true` or `IsVisibleInCsp = true`

2. **Add Knowledge Search component to the Case record page**

   In App Builder (Setup → Object Manager → Case → Lightning Record Pages):
   - Add the **Knowledge** component to the case record page layout.
   - Configure the component to search by case subject/description automatically.

3. **Enable Suggested Articles in Email-to-Case or Web-to-Case**

   In Setup → Knowledge Settings:
   - Enable **Suggested Articles** for Email-to-Case and Web-to-Case channels.
   - Salesforce uses the case Subject and Description to auto-suggest `Online` articles
     matching the configured channels.

4. **Track article attachment when agent uses an article to resolve the case**

   ```apex
   // Agent clicks "Attach to Case" on a Knowledge article in the console
   // Platform auto-creates CaseArticle — verify via query:
   List<CaseArticle> attachments = [
       SELECT Id, CaseId, KnowledgeArticleId, CreatedDate
       FROM CaseArticle
       WHERE CaseId = :thisCaseId
   ];
   ```

5. **Query case deflection effectiveness (articles that resolved cases)**

   ```apex
   // Cases closed with at least one attached knowledge article
   List<AggregateResult> deflected = [
       SELECT COUNT(Id) deflectedCount
       FROM Case
       WHERE Id IN (SELECT CaseId FROM CaseArticle)
       AND Status = 'Closed'
       AND IsClosed = true
   ];
   ```

---

## Not Covered by This Skill

- **Experience Cloud (Community) Knowledge configuration** — Lightning Community
  Knowledge base setup, Community Knowledge components, and public site Search
  configuration are covered under the `experience-*` skill family.
- **Salesforce Search relevance tuning** — Einstein Search, synonym groups, search
  manager configuration, and promoted search terms are not covered here.
- **AI-generated article drafts (Einstein Generative AI)** — Einstein for Knowledge
  article generation, article recommendations, and AI-assisted authoring are separate
  from the core Knowledge data model covered here.
- **Service Cloud Voice IVR deflection** — Voice channel article deflection via
  Amazon Connect / Service Cloud Voice is not covered here.
- **Case lifecycle** — Case creation, assignment rules, escalation, milestones, and
  SLAs are covered in `service-case-lifecycle`.
