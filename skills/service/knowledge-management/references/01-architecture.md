# Lightning Knowledge — Object Model and Architecture

## Overview

Lightning Knowledge consolidates all article content into a single SObject hierarchy.
The two core objects are `KnowledgeArticle` (the master/parent record) and
`Knowledge__kav` (the versioned article content). All other Knowledge objects are
either lookup children of these two or standalone configuration objects.

---

## Core Object Hierarchy

```
KnowledgeArticle  (master record — one per logical article)
│   Id                         -- stable, never changes across versions
│   ArticleNumber              -- auto-generated, human-readable article ID
│   CreatedDate
│   LastPublishedDate
│   TotalViewCount
│   TotalVoteCount
│
├── Knowledge__kav  (version record — one row per version)
│   │   Id                     -- unique per version (changes when new version is published)
│   │   KnowledgeArticleId     -- FK to KnowledgeArticle.Id (shared across versions)
│   │   VersionNumber          -- auto-incremented integer
│   │   PublishStatus          -- Draft | Online | Archived
│   │   Title
│   │   Summary                -- 255 chars, used as search snippet
│   │   Language               -- ISO language code, e.g. 'en_US', 'fr', 'de'
│   │   RecordTypeId           -- differentiates article types (FAQ, How-To, etc.)
│   │   IsVisibleInApp         -- Internal App channel
│   │   IsVisibleInPkb         -- Public Knowledge Base channel
│   │   IsVisibleInCsp         -- Customer Community channel
│   │   IsVisibleInPrm         -- Partner Community channel
│   │   ValidationStatus       -- custom picklist (if Validation Status is enabled)
│   │   LastModifiedDate
│   │   CreatedById
│   │   [custom fields]        -- rich-text body, attachments, etc.
│   │
│   └── (version is archived/deleted when newer version is published/deleted)
│
├── DataCategoryGroupAssignment  (controls category-based visibility)
│   │   ParentId               -- FK to KnowledgeArticle.Id
│   │   DataCategoryGroupName  -- developer name of DataCategoryGroup
│   │   DataCategoryName       -- developer name of DataCategory
│
├── CaseArticle  (junction: article attached to a case)
│   │   CaseId                 -- FK to Case.Id
│   │   KnowledgeArticleId     -- FK to KnowledgeArticle.Id
│   │   CreatedDate
│   │   CreatedById
│
├── KnowledgeArticleViewStat  (read-only, auto-populated view analytics)
│   │   ParentId               -- FK to KnowledgeArticle.Id
│   │   NormalizedScore        -- 0.0–1.0 relative view score
│   │   Count                  -- raw view count
│   │   Channel                -- App | Pkb | Csp | Prm
│
└── KnowledgeArticleVoteStat  (read-only, auto-populated vote analytics)
        ParentId               -- FK to KnowledgeArticle.Id
        NormalizedScore        -- 0.0–1.0 relative helpfulness score
        WasVotedHelpful        -- true/false aggregated vote
        Channel
```

---

## DataCategory Object Model

```
DataCategoryGroup  (top-level grouping, e.g. "Products", "Regions")
│   Name
│   DeveloperName
│   SobjectType       -- 'KnowledgeArticle' | 'Question' | 'Solution'
│   IsActive
│   IsNavigable
│
└── DataCategory  (individual category node within the group)
        Name
        DeveloperName
        ParentId            -- self-referential for hierarchical categories
        DataCategoryGroupId -- FK to DataCategoryGroup.Id
        SortOrder
```

`DataCategoryGroupAssignment` links a `KnowledgeArticle` to a specific
`DataCategory` within a `DataCategoryGroup`. An article can be assigned to multiple
categories across multiple groups.

---

## PublishStatus Lifecycle

```
                    insert
                      │
                      ▼
                  ┌────────┐
              ┌──►│ Draft  │◄──────────────────────────────────┐
              │   └────────┘                                   │
              │       │ PublishStatus = 'Online'               │
              │       ▼                                        │
              │   ┌────────┐                                   │
              │   │ Online │──── editOnlineArticle() ──────────┘
              │   │(Published)│   (creates new Draft version,  │
              │   └────────┘    previous version stays Online) │
              │       │                                        │
              │       │ PublishStatus = 'Archived'             │
              │       │ (or auto-archived when new version     │
              │       │  is published)                         │
              │       ▼                                        │
              │   ┌──────────┐                                 │
              └───│ Archived │                                 │
   restore Draft  └──────────┘                                 │
   (manual edit)       │                                       │
                       │ delete                                │
                       ▼                                       │
                  ┌─────────┐                                  │
                  │ Deleted │                                  │
                  │(Recycle)│                                  │
                  └─────────┘
```

**Key rules:**
- Only one version can have `PublishStatus = 'Online'` at a time per language per article.
- Publishing a new version automatically archives the previous `Online` version.
- Archiving does not delete — the record remains queryable.
- A Draft can be deleted directly (goes to Recycle Bin).

---

## Channel Visibility Fields

| Field Name        | UI Label              | Audience                          |
|-------------------|-----------------------|-----------------------------------|
| `IsVisibleInApp`  | Internal App          | Agents in Service Console         |
| `IsVisibleInPkb`  | Public Knowledge Base | Unauthenticated external users    |
| `IsVisibleInCsp`  | Customer Community    | Authenticated customer portal users |
| `IsVisibleInPrm`  | Partner Community     | Authenticated partner portal users |

All four are boolean fields on `Knowledge__kav`. They can be set independently.
An article can be visible in multiple channels simultaneously.

**Visibility requires both conditions:**
1. The channel flag is `true` (e.g., `IsVisibleInApp = true`)
2. `PublishStatus = 'Online'`

---

## Version Relationship: KnowledgeArticleId vs Id

```
KnowledgeArticle
  Id = 0TO000000000001  (stable master ID)
  ArticleNumber = '000001234'

  Knowledge__kav (version 1 — archived)
    Id = ka0000000000001  (version-specific ID)
    KnowledgeArticleId = 0TO000000000001
    VersionNumber = 1
    PublishStatus = 'Archived'

  Knowledge__kav (version 2 — currently online)
    Id = ka0000000000002  (different version-specific ID)
    KnowledgeArticleId = 0TO000000000001
    VersionNumber = 2
    PublishStatus = 'Online'

  Knowledge__kav (version 3 — draft being edited)
    Id = ka0000000000003
    KnowledgeArticleId = 0TO000000000001
    VersionNumber = 3
    PublishStatus = 'Draft'
```

**Always use `KnowledgeArticleId` as the stable external reference.** The version
`Id` changes each time a new version is published and the old one is archived. Storing
the version `Id` in external systems leads to broken links pointing at archived
versions.

---

## Key Field Reference

### Knowledge__kav

| Field                  | Type          | Notes                                           |
|------------------------|---------------|-------------------------------------------------|
| `Id`                   | ID            | Unique per version; changes across publishes    |
| `KnowledgeArticleId`   | ID (lookup)   | Stable master ID; shared across all versions    |
| `VersionNumber`        | Integer       | Auto-incremented; higher = newer                |
| `PublishStatus`        | Picklist      | `Draft` \| `Online` \| `Archived`              |
| `Title`                | Text(255)     | Article title; required                         |
| `Summary`              | Text(255)     | Search snippet; should always be populated      |
| `Language`             | Picklist      | ISO code; default = org default language        |
| `RecordTypeId`         | ID            | Differentiates article types (record types)     |
| `IsVisibleInApp`       | Checkbox      | Internal App channel visibility                 |
| `IsVisibleInPkb`       | Checkbox      | Public Knowledge Base channel visibility        |
| `IsVisibleInCsp`       | Checkbox      | Customer Community channel visibility           |
| `IsVisibleInPrm`       | Checkbox      | Partner Community channel visibility            |
| `ValidationStatus`     | Picklist      | Custom validation; must be enabled in settings  |
| `LastModifiedDate`     | DateTime      | Last modified timestamp                         |
| `CreatedById`          | ID            | Article author                                  |
| `IsDeleted`            | Boolean       | True = in Recycle Bin                           |

### DataCategoryGroupAssignment

| Field                  | Type    | Notes                                          |
|------------------------|---------|------------------------------------------------|
| `Id`                   | ID      | Assignment record ID                           |
| `ParentId`             | ID      | FK to `KnowledgeArticle.Id` (master record)    |
| `DataCategoryGroupName`| String  | Developer name of the DataCategoryGroup        |
| `DataCategoryName`     | String  | Developer name of the DataCategory             |

### CaseArticle

| Field                  | Type    | Notes                                          |
|------------------------|---------|------------------------------------------------|
| `Id`                   | ID      | Junction record ID                             |
| `CaseId`               | ID      | FK to Case.Id                                  |
| `KnowledgeArticleId`   | ID      | FK to KnowledgeArticle.Id (master, not version)|
| `CreatedDate`          | DateTime| When the article was attached to the case      |
| `CreatedById`          | ID      | Who attached the article                       |

### KnowledgeArticleViewStat

| Field             | Type    | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| `ParentId`        | ID      | FK to KnowledgeArticle.Id                          |
| `NormalizedScore` | Double  | 0.0–1.0 relative view score across all articles   |
| `Count`           | Integer | Raw view count                                     |
| `Channel`         | Picklist| `App` \| `Pkb` \| `Csp` \| `Prm` \| `AllChannels`|

### KnowledgeArticleVoteStat

| Field             | Type    | Notes                                              |
|-------------------|---------|----------------------------------------------------|
| `ParentId`        | ID      | FK to KnowledgeArticle.Id                          |
| `NormalizedScore` | Double  | 0.0–1.0 relative helpfulness score                |
| `WasVotedHelpful` | Boolean | Aggregated: did majority vote this helpful?        |
| `Channel`         | Picklist| `App` \| `Pkb` \| `Csp` \| `Prm` \| `AllChannels`|
