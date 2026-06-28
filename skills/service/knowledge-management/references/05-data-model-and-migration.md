# Lightning Knowledge — Data Model and Migration

## Key Field Reference

### Knowledge__kav — Complete Field Table

| Field API Name            | Type           | Length | Notes                                                        |
|---------------------------|----------------|--------|--------------------------------------------------------------|
| `Id`                      | ID             | 18     | Version-specific; changes when new version is published      |
| `KnowledgeArticleId`      | ID (lookup)    | 18     | FK to KnowledgeArticle; stable across versions               |
| `ArticleNumber`           | Text (auto)    | 255    | Human-readable article number; auto-generated; read-only     |
| `VersionNumber`           | Integer        | —      | Auto-incremented; read-only                                  |
| `PublishStatus`           | Picklist       | —      | `Draft` \| `Online` \| `Archived`                           |
| `Title`                   | Text           | 255    | Required                                                     |
| `Summary`                 | Text           | 255    | Search snippet; always populate for published articles       |
| `UrlName`                 | Text           | 255    | URL-friendly slug for PKB links; auto-generated from Title   |
| `Language`                | Picklist       | —      | ISO code; default = org default language                     |
| `RecordTypeId`            | ID             | 18     | Differentiates article types (FAQ, How-To, etc.)             |
| `IsVisibleInApp`          | Checkbox       | —      | Internal App channel; default = false                        |
| `IsVisibleInPkb`          | Checkbox       | —      | Public Knowledge Base channel; default = false               |
| `IsVisibleInCsp`          | Checkbox       | —      | Customer Community channel; default = false                  |
| `IsVisibleInPrm`          | Checkbox       | —      | Partner Community channel; default = false                   |
| `ValidationStatus`        | Picklist       | —      | Custom validation picklist; enabled in Knowledge Settings    |
| `IsLatestVersion`         | Checkbox       | —      | True if this version is the latest (Online or Draft)         |
| `IsDeleted`               | Checkbox       | —      | True = in Recycle Bin                                        |
| `CreatedById`             | ID             | 18     | Article author                                               |
| `CreatedDate`             | DateTime       | —      |                                                              |
| `LastModifiedById`        | ID             | 18     |                                                              |
| `LastModifiedDate`        | DateTime       | —      |                                                              |
| `LastPublishedDate`       | DateTime       | —      | When the article was last set to Online                      |

Custom fields (body content, attachments) are defined by the org and vary per
Record Type layout. Common custom field names:
- `Body__c` or `Details__c` — RichTextArea for article body content
- `Question__c` / `Answer__c` — for FAQ record types

---

### DataCategoryGroupAssignment — Complete Field Table

| Field API Name           | Type        | Notes                                                       |
|--------------------------|-------------|-------------------------------------------------------------|
| `Id`                     | ID          | Assignment record ID                                        |
| `ParentId`               | ID (lookup) | FK to `KnowledgeArticle.Id` (master, NOT version Id)        |
| `DataCategoryGroupName`  | String      | Developer name of the DataCategoryGroup                     |
| `DataCategoryName`       | String      | Developer name of the DataCategory leaf node                |

**Important:** `ParentId` must reference the `KnowledgeArticle` master record ID
(prefix `0TO`), not the `Knowledge__kav` version record ID (prefix `ka0`).

---

### CaseArticle — Complete Field Table

| Field API Name      | Type        | Notes                                                           |
|---------------------|-------------|-----------------------------------------------------------------|
| `Id`                | ID          | Junction record ID                                              |
| `CaseId`            | ID (lookup) | FK to Case.Id                                                   |
| `KnowledgeArticleId`| ID (lookup) | FK to KnowledgeArticle.Id (master, NOT version Id)              |
| `CreatedDate`       | DateTime    | When the article was attached                                   |
| `CreatedById`       | ID          | User who attached the article                                   |
| `IsDeleted`         | Checkbox    | True = in Recycle Bin                                           |

---

## Article Export and Import

### Export via Knowledge Article Export (Setup)

Salesforce provides a native article export tool:

1. Navigate to: **Setup → Knowledge → Article Import and Export**
2. Select export options:
   - Filter by language, publish status, data category, or article type (Record Type)
   - Export as CSV (metadata) + ZIP (attachments)
3. The export includes `Knowledge__kav` field values and binary attachments.

**CSV column headers** in the export correspond to API field names. Use these headers
exactly when reimporting.

### Import via Data Loader

For bulk imports using Data Loader or the Bulk API:

1. Prepare a CSV file with API field names as headers.
2. Required fields: `Title`, `RecordTypeId` (or `RecordType.DeveloperName`),
   `Language`.
3. Omit `PublishStatus` on insert — it defaults to `Draft`.
4. Set `IsVisibleInApp`, `IsVisibleInPkb`, `IsVisibleInCsp`, `IsVisibleInPrm` as
   needed.
5. After import, assign `DataCategoryGroupAssignment` records in a separate bulk
   operation.
6. Bulk publish via Apex batch after all categories are assigned.

**Sample Data Loader CSV header row:**
```
Title,Summary,Language,RecordType.DeveloperName,IsVisibleInApp,IsVisibleInPkb,ValidationStatus
```

---

## Classic → Lightning Knowledge Migration

### Background

Salesforce Classic Knowledge had a separate SObject per article type (e.g.,
`FAQ__kav`, `HowTo__kav`, `ReleaseNote__kav`). Lightning Knowledge uses a single
`Knowledge__kav` object with Record Types replacing the separate SObjects.

### Migration Steps

**Step 1: Enable Lightning Knowledge**

Enable Lightning Knowledge in Setup → Knowledge Settings. This does not immediately
delete Classic article type objects — they coexist temporarily.

**Step 2: Map Article Types to Record Types**

Create a Record Type on `Knowledge__kav` for each Classic article type:
- Classic `FAQ__kav` → Lightning Record Type `FAQ`
- Classic `HowTo__kav` → Lightning Record Type `How_To`
- Classic `ReleaseNote__kav` → Lightning Record Type `Release_Note`

**Step 3: Map Custom Fields**

Classic article type fields lived on the type-specific SObject (`FAQ__kav.Question__c`).
In Lightning, all fields live on `Knowledge__kav` and are accessible per Record Type
via page layouts.

Create matching custom fields on `Knowledge__kav` for each Classic field:
```
FAQ__kav.Question__c    → Knowledge__kav.Question__c  (RichTextArea)
FAQ__kav.Answer__c      → Knowledge__kav.Answer__c    (RichTextArea)
HowTo__kav.Steps__c     → Knowledge__kav.Steps__c     (RichTextArea)
```

**Step 4: Export Classic Articles**

Use the Article Import/Export tool to export all Classic article versions (Draft,
Online, Archived) for each article type to CSV + attachment ZIP files.

**Step 5: Transform and Import**

Transform the exported CSV files:
- Add `RecordType.DeveloperName` column with the mapped Record Type name.
- Rename custom field columns to match the new `Knowledge__kav` field API names.
- Retain `Language`, channel visibility fields, `Summary`.

Import transformed CSVs into `Knowledge__kav` via Data Loader (insert).

**Step 6: Migrate DataCategoryGroupAssignments**

Export `DataCategoryGroupAssignment` records from Classic (referencing old article
master IDs), map to new `KnowledgeArticle.Id` values using the article number as
the join key, and insert into the new org.

**Step 7: Bulk Publish**

After categories are assigned and content is verified, run a batch Apex job to
publish validated articles.

**Step 8: Update External References**

Update any external systems (portals, intranets, email templates) that reference
Classic article URLs or article IDs to use the new `KnowledgeArticleId` values.

### Field Mapping Reference (Classic → Lightning)

| Classic Object    | Classic Field        | Lightning Field                  |
|-------------------|----------------------|----------------------------------|
| `FAQ__kav`        | `Title`              | `Knowledge__kav.Title`           |
| `FAQ__kav`        | `Summary__c`         | `Knowledge__kav.Summary`         |
| `FAQ__kav`        | `Question__c`        | `Knowledge__kav.Question__c`     |
| `FAQ__kav`        | `Answer__c`          | `Knowledge__kav.Answer__c`       |
| `FAQ__kav`        | `IsVisibleInApp`     | `Knowledge__kav.IsVisibleInApp`  |
| `FAQ__kav`        | `IsVisibleInPkb`     | `Knowledge__kav.IsVisibleInPkb`  |
| `FAQ__kav`        | `PublishStatus`      | `Knowledge__kav.PublishStatus`   |
| `KnowledgeArticle`| `Id` (Classic)       | `KnowledgeArticle.Id` (Lightning)|

---

## Bulk Publish Apex Pattern

```apex
/**
 * BulkPublishKnowledgeArticlesBatch
 *
 * Publishes all Draft Knowledge articles that have ValidationStatus = 'Validated'
 * and at least one DataCategoryGroupAssignment.
 *
 * Usage: Database.executeBatch(new BulkPublishKnowledgeArticlesBatch(), 50);
 */
public class BulkPublishKnowledgeArticlesBatch implements Database.Batchable<SObject> {

    public Database.QueryLocator start(Database.BatchableContext bc) {
        // Only publish validated drafts with at least one category assignment
        Set<Id> assignedArticleIds = new Set<Id>();
        for (DataCategoryGroupAssignment dcga : [
            SELECT ParentId FROM DataCategoryGroupAssignment
        ]) {
            assignedArticleIds.add(dcga.ParentId);
        }

        return Database.getQueryLocator([
            SELECT Id, PublishStatus, KnowledgeArticleId, ValidationStatus
            FROM Knowledge__kav
            WHERE PublishStatus = 'Draft'
            AND ValidationStatus = 'Validated'
            AND KnowledgeArticleId IN :assignedArticleIds
        ]);
    }

    public void execute(Database.BatchableContext bc, List<Knowledge__kav> scope) {
        List<Knowledge__kav> toPublish = new List<Knowledge__kav>();
        for (Knowledge__kav a : scope) {
            a.PublishStatus = 'Online';
            toPublish.add(a);
        }
        Database.update(toPublish, false);  // allOrNone = false to continue on partial failures
    }

    public void finish(Database.BatchableContext bc) {
        AsyncApexJob job = [
            SELECT Id, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems
            FROM AsyncApexJob WHERE Id = :bc.getJobId()
        ];
        System.debug('Bulk publish complete: ' + job.NumberOfErrors + ' errors, '
            + job.JobItemsProcessed + ' batches processed.');
    }
}
```

---

## Translation Import via CSV

To bulk-import translated articles using Data Loader:

**CSV header row for translated articles:**
```
KnowledgeArticleId,Title,Summary,Language,IsVisibleInApp,IsVisibleInPkb,RecordType.DeveloperName
```

- `KnowledgeArticleId` — the master article ID from the source language article.
- `Language` — ISO code of the translation (e.g., `fr`, `de`, `ja`, `es`).
- `RecordType.DeveloperName` — same Record Type as the source language article.
- Omit `PublishStatus` — translated articles insert as Draft.

**Pre-requisite:** Translation Workbench must be enabled. The target language must be
configured as a supported language in Setup → Translation Workbench.

**Verify translations after import:**
```soql
SELECT Id, KnowledgeArticleId, Language, PublishStatus, VersionNumber
FROM Knowledge__kav
WHERE KnowledgeArticleId = :masterArticleId
ORDER BY Language, VersionNumber
```

---

## Knowledge Content Archival Policy and Retention

### Recommended Archival Policy

| Condition                                          | Action                           |
|----------------------------------------------------|----------------------------------|
| Article not viewed in 12 months (NormalizedScore=0)| Flag for review → Archive        |
| Article WasVotedHelpful = false consistently       | Flag for rework or archive        |
| Article superseded by newer article                | Archive old, link to new in body |
| Product/feature deprecated                         | Archive all related articles      |
| Legal content older than 3 years                   | Mandatory review → Archive or update |

### Archival Script (Apex)

```apex
// Archive articles with zero views in the last 12 months
// and no recent vote activity
List<KnowledgeArticleViewStat> stale = [
    SELECT ParentId FROM KnowledgeArticleViewStat
    WHERE Count = 0
    AND NormalizedScore = 0
    AND Channel = 'AllChannels'
];

Set<Id> staleArticleIds = new Set<Id>();
for (KnowledgeArticleViewStat s : stale) {
    staleArticleIds.add(s.ParentId);
}

List<Knowledge__kav> toArchive = [
    SELECT Id, PublishStatus
    FROM Knowledge__kav
    WHERE KnowledgeArticleId IN :staleArticleIds
    AND PublishStatus = 'Online'
    AND LastPublishedDate < :Date.today().addYears(-1)
];

for (Knowledge__kav a : toArchive) {
    a.PublishStatus = 'Archived';
}
update toArchive;
```

### Retention

Archived articles are **not deleted automatically**. Salesforce does not impose a
retention policy on archived articles — they persist indefinitely until explicitly
deleted. Implement a deletion policy through:

1. A scheduled Apex job that deletes archived articles older than a defined threshold.
2. A manual quarterly review process where Knowledge managers bulk-delete obsolete
   archived content.
3. Hard-delete via `Database.delete(records, false)` followed by
   `Database.emptyRecycleBin(records)` for immediate permanent deletion.

```apex
// Hard-delete archived articles older than 2 years (permanently, bypasses Recycle Bin)
List<Knowledge__kav> toDelete = [
    SELECT Id FROM Knowledge__kav
    WHERE PublishStatus = 'Archived'
    AND LastModifiedDate < :DateTime.now().addYears(-2)
];
Database.delete(toDelete, false);
Database.emptyRecycleBin(toDelete);
```

Use `Database.emptyRecycleBin` with caution — this permanently removes the records
with no recovery path.
