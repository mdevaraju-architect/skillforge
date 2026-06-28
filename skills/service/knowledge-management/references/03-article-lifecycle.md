# Lightning Knowledge — Article Lifecycle

## Overview

Every Knowledge article passes through a defined set of states controlled by
`Knowledge__kav.PublishStatus`. This document covers the full lifecycle from initial
creation through archival and deletion, including version management and bulk
operations.

---

## Article Creation (Draft)

### Via UI

In the Service Console or App Builder Knowledge tab:
1. Click **New** on the Knowledge tab.
2. Select the article Record Type (e.g., FAQ, How-To).
3. Fill in Title, Summary, and body fields.
4. Save — the article is created with `PublishStatus = 'Draft'`.

### Via Apex

```apex
Id recordTypeId = Schema.SObjectType.Knowledge__kav
    .getRecordTypeInfosByDeveloperName()
    .get('FAQ')
    .getRecordTypeId();

Knowledge__kav article = new Knowledge__kav(
    RecordTypeId   = recordTypeId,
    Title          = 'Article Title',
    Summary        = 'Brief description for search snippets (max 255 chars)',
    IsVisibleInApp = true,
    IsVisibleInPkb = false,
    IsVisibleInCsp = false,
    IsVisibleInPrm = false
    // Do NOT set PublishStatus on insert — it defaults to 'Draft'
);
insert article;
```

**Do not set `PublishStatus` on insert.** Setting it to `'Online'` on the initial
insert is unsupported and may throw `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` or
silently fail depending on the API version.

### Via Data Loader / API

Use the standard Bulk API or REST API to insert rows into `Knowledge__kav`. The same
rules apply: omit `PublishStatus` on insert (it defaults to `'Draft'`).

---

## Review / Approval Workflow

Lightning Knowledge has no built-in approval step — teams implement review via one of
three patterns:

### Pattern A: Validation Status Field

Enable Validation Status in Knowledge Settings. Use the `ValidationStatus` field as a
lightweight review indicator:

```
Draft + ValidationStatus = 'Not Validated'
  → author submits for review (manually or via Flow)
Draft + ValidationStatus = 'In Review'
  → reviewer approves
Draft + ValidationStatus = 'Validated'
  → manager publishes (sets PublishStatus = 'Online')
```

This pattern is purely informational — no system enforcement prevents publishing an
unvalidated article.

### Pattern B: Approval Process on Knowledge__kav

Configure a standard Salesforce Approval Process:
- Entry criteria: `PublishStatus = 'Draft'`
- Approval step: designated reviewer(s)
- Approval action: Field Update → `PublishStatus = 'Online'`
- Rejection action: Field Update → `ValidationStatus = 'Rejected'`

This provides system-enforced governance and an audit trail in the Approval History
related list.

### Pattern C: Flow-Based Review

Use a Record-Triggered Flow on `Knowledge__kav`:
- Trigger: After Save, when `ValidationStatus` changes to `'Submitted for Review'`
- Action: Create a Task assigned to the reviewer, or send an email notification
- On review completion: separate action updates `ValidationStatus` to `'Validated'`

Combine with a Screen Flow accessible via a button on the article page for a guided
submission experience.

---

## Publishing an Article

### Set PublishStatus to 'Online'

```apex
Knowledge__kav draft = [
    SELECT Id, PublishStatus
    FROM Knowledge__kav
    WHERE Id = :draftId
    AND PublishStatus = 'Draft'
    LIMIT 1
];
draft.PublishStatus = 'Online';
update draft;
```

The article is immediately searchable by users with the appropriate channel visibility
and data category access.

### Using KbManagement.PublishingService

The `KbManagement.PublishingService` class provides managed publish/archive operations:

```apex
// Publish a draft article by KnowledgeArticleId
KbManagement.PublishingService.publishArticle(
    knowledgeArticleId,  // master KnowledgeArticle.Id
    true                 // true = mark as major version
);
```

Note: `KbManagement.PublishingService` methods operate on `KnowledgeArticleId` (the
master record), not the version `Id`. Ensure you have the correct ID type.

---

## Editing a Published Article (New Version Creation)

Editing a published article creates a new Draft version while the current published
version remains visible to users.

### Via KbManagement.PublishingService (recommended)

```apex
// Create a new Draft version from the currently Online article
// Returns the Id of the new Draft Knowledge__kav record
String newDraftVersionId = KbManagement.PublishingService.editOnlineArticle(
    knowledgeArticleId,  // KnowledgeArticle.Id (master)
    false                // false = keep current version Online until new one is published
);

// Edit the new Draft
Knowledge__kav newDraft = [
    SELECT Id, Title, Summary FROM Knowledge__kav WHERE Id = :newDraftVersionId
];
newDraft.Summary = 'Updated summary text.';
update newDraft;

// Publish the new version (auto-archives the previous Online version)
newDraft.PublishStatus = 'Online';
update newDraft;
```

### Version Numbering After Edit+Publish

```
Before edit:
  version 2: PublishStatus = Online, VersionNumber = 2

After editOnlineArticle():
  version 2: PublishStatus = Online, VersionNumber = 2  (still live)
  version 3: PublishStatus = Draft,  VersionNumber = 3  (new editable copy)

After publishing version 3:
  version 2: PublishStatus = Archived, VersionNumber = 2
  version 3: PublishStatus = Online,   VersionNumber = 3
```

---

## Archiving an Article

Archive removes an article from search and all channel visibility without deleting it.

```apex
Knowledge__kav published = [
    SELECT Id, PublishStatus
    FROM Knowledge__kav
    WHERE KnowledgeArticleId = :articleMasterId
    AND PublishStatus = 'Online'
    LIMIT 1
];
published.PublishStatus = 'Archived';
update published;
```

Or using the publishing service:
```apex
KbManagement.PublishingService.archiveArticle(knowledgeArticleId);
```

**Archived articles are not deleted.** They remain in the org, can be queried
directly, and can be restored to Draft by setting `PublishStatus = 'Draft'`.

---

## Restoring an Archived Article

```apex
Knowledge__kav archived = [
    SELECT Id, PublishStatus
    FROM Knowledge__kav
    WHERE KnowledgeArticleId = :articleMasterId
    AND PublishStatus = 'Archived'
    ORDER BY VersionNumber DESC
    LIMIT 1
];
archived.PublishStatus = 'Draft';
update archived;
// Article is now a Draft; update content, re-assign data categories if needed, then publish
```

---

## Deletion

Deleting an article version moves it to the Recycle Bin (`IsDeleted = true`). The
master `KnowledgeArticle` is also deleted if all versions are deleted.

```apex
Knowledge__kav toDelete = [
    SELECT Id FROM Knowledge__kav
    WHERE Id = :versionId
];
delete toDelete;
// Restore from Recycle Bin:
undelete toDelete;
```

You cannot delete a `Published (Online)` article directly. Archive it first, then
delete.

---

## Article Cloning

Clone an existing article to use as a template:

```apex
Knowledge__kav source = [
    SELECT RecordTypeId, Title, Summary, IsVisibleInApp, IsVisibleInPkb,
           IsVisibleInCsp, IsVisibleInPrm
    FROM Knowledge__kav
    WHERE Id = :sourceId
];

Knowledge__kav clone = source.clone(false, true, false, false);
clone.Title   = 'Cloned: ' + source.Title;
clone.Summary = source.Summary;
insert clone;
// clone.PublishStatus = 'Draft' automatically
```

---

## Bulk Publish via Apex

For batch publishing scenarios (e.g., after a content migration or large-scale review
cycle):

```apex
public class BulkPublishKnowledgeArticlesBatch implements Database.Batchable<SObject> {

    public Database.QueryLocator start(Database.BatchableContext bc) {
        // Only publish Draft articles that have been validated
        return Database.getQueryLocator([
            SELECT Id, PublishStatus
            FROM Knowledge__kav
            WHERE PublishStatus = 'Draft'
            AND ValidationStatus = 'Validated'
        ]);
    }

    public void execute(Database.BatchableContext bc, List<Knowledge__kav> articles) {
        for (Knowledge__kav a : articles) {
            a.PublishStatus = 'Online';
        }
        update articles;
    }

    public void finish(Database.BatchableContext bc) {
        // Optional: send notification email or create a report
    }
}

// Execute:
Database.executeBatch(new BulkPublishKnowledgeArticlesBatch(), 50);
```

**Batch size guidance:** Keep batch size ≤ 50 for Knowledge DML operations to stay
within Apex governor limits, especially in orgs with complex before-save Flows or
triggers on `Knowledge__kav`.

---

## Article Version Management

### Query All Versions of an Article

```soql
SELECT Id, VersionNumber, PublishStatus, LastModifiedDate, Language
FROM Knowledge__kav
WHERE KnowledgeArticleId = :masterArticleId
ORDER BY VersionNumber DESC
```

### Query Only the Currently Published Version

```soql
SELECT Id, VersionNumber, Title, Summary
FROM Knowledge__kav
WHERE KnowledgeArticleId = :masterArticleId
AND PublishStatus = 'Online'
LIMIT 1
```

### Query the Latest Draft (in-progress edit)

```soql
SELECT Id, VersionNumber, Title
FROM Knowledge__kav
WHERE KnowledgeArticleId = :masterArticleId
AND PublishStatus = 'Draft'
ORDER BY VersionNumber DESC
LIMIT 1
```

---

## Validation Status Custom Field Pattern

When Validation Status is enabled in Knowledge Settings, the `ValidationStatus`
picklist supports a structured review workflow without requiring a formal Approval
Process. Recommended custom values:

| Value                    | Meaning                                          |
|--------------------------|--------------------------------------------------|
| `Not_Validated`          | Default state for new drafts                     |
| `Submitted_For_Review`   | Author has submitted for peer/manager review     |
| `In_Review`              | Actively being reviewed                          |
| `Pending_Legal_Approval` | Requires legal sign-off (regulated content)      |
| `Validated`              | Approved and ready to publish                    |
| `Rejected`               | Returned to author for rework                    |

Use a Record-Triggered Flow or Approval Process to enforce transitions and send
notifications. The `PublishStatus` can then be set to `'Online'` only when
`ValidationStatus = 'Validated'` — enforce this via a Validation Rule on
`Knowledge__kav`:

```
AND(
  ISPICKVAL(PublishStatus, 'Online'),
  NOT(ISPICKVAL(ValidationStatus, 'Validated'))
)
```

Error message: "Articles must be Validated before publishing."
