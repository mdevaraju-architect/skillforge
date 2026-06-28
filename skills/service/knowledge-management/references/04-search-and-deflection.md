# Lightning Knowledge — Search and Case Deflection

## Overview

Knowledge search in Salesforce uses SOSL (Salesforce Object Search Language) for
full-text search across article content. Case deflection surfaces relevant articles
to agents and customers before or during case creation. This document covers SOSL
query patterns, data category visibility in search, case deflection configuration,
and article analytics.

---

## SOSL Query Patterns for Knowledge

### Basic Knowledge Search

```apex
public static List<Knowledge__kav> searchArticles(String searchTerm) {
    String escapedTerm = String.escapeSingleQuotes(searchTerm);
    List<List<SObject>> results = [
        FIND :escapedTerm IN ALL FIELDS
        RETURNING Knowledge__kav(
            Id,
            KnowledgeArticleId,
            Title,
            Summary,
            VersionNumber,
            IsVisibleInApp,
            LastModifiedDate
            WHERE PublishStatus = 'Online'
            AND IsVisibleInApp = true
            ORDER BY Title
            LIMIT 10
        )
    ];
    return (List<Knowledge__kav>) results[0];
}
```

### Search with Data Category Filter

```apex
// Search for articles in a specific data category
List<List<SObject>> results = [
    FIND :searchTerm IN ALL FIELDS
    RETURNING Knowledge__kav(
        Id, KnowledgeArticleId, Title, Summary
        WHERE PublishStatus = 'Online'
        AND IsVisibleInApp = true
        WITH DATA CATEGORY Products__c AT PasswordReset__c
        LIMIT 20
    )
];
```

The `WITH DATA CATEGORY` clause filters results to articles assigned to the specified
category. Use the `DataCategoryGroup` developer name and `DataCategory` developer name
in the query (not the label).

### Search Public Knowledge Base Articles

```apex
// Search articles visible to unauthenticated external users
List<List<SObject>> results = [
    FIND :searchTerm IN TITLE FIELDS
    RETURNING Knowledge__kav(
        Id, KnowledgeArticleId, Title, Summary, UrlName
        WHERE PublishStatus = 'Online'
        AND IsVisibleInPkb = true
        ORDER BY Title
        LIMIT 10
    )
];
```

### SOSL Targeting Specific Fields

```apex
// Search only in Title and Summary (faster, more precise)
List<List<SObject>> results = [
    FIND :searchTerm IN NAME FIELDS
    RETURNING Knowledge__kav(
        Id, Title, Summary
        WHERE PublishStatus = 'Online'
        LIMIT 5
    )
];
```

SOSL `IN` clauses:
- `ALL FIELDS` — searches all indexed text fields including body
- `NAME FIELDS` — searches name/title fields only (faster)
- `EMAIL FIELDS` — email fields only (not useful for Knowledge)
- `PHONE FIELDS` — phone fields only (not useful for Knowledge)

### Dynamic SOSL in Apex

```apex
// Build dynamic SOSL for variable search terms and channels
public static List<Knowledge__kav> dynamicSearch(
    String term,
    Boolean internalOnly,
    Integer resultLimit
) {
    String channel   = internalOnly ? 'AND IsVisibleInApp = true' : '';
    String limitClause = 'LIMIT ' + Math.min(resultLimit, 200);
    String query = 'FIND :term IN ALL FIELDS '
        + 'RETURNING Knowledge__kav('
        + '    Id, KnowledgeArticleId, Title, Summary '
        + '    WHERE PublishStatus = \'Online\' '
        + channel + ' ' + limitClause + ')';
    List<List<SObject>> results = Search.query(query);
    return (List<Knowledge__kav>) results[0];
}
```

---

## Data Category Visibility in SOSL

SOSL automatically applies data category visibility rules for the running user:

- If the user's role/profile has visibility to `Products → PasswordReset`, SOSL
  returns articles in that category.
- If the user has no visibility to a category, articles assigned only to that category
  are excluded from SOSL results — even if the query does not use `WITH DATA CATEGORY`.
- System context (e.g., Apex running without sharing) may bypass visibility; use
  `WITH SECURITY_ENFORCED` or manually apply `WITH DATA CATEGORY` to respect user
  visibility in system-context Apex.

**Verify data category visibility for a user:**
```soql
SELECT DataCategoryGroupName, DataCategoryName
FROM DataCategoryGroupAssignment
WHERE ParentId IN (
    SELECT KnowledgeArticleId FROM Knowledge__kav
    WHERE Title = 'Article Title' AND PublishStatus = 'Online'
)
```

---

## Channel Visibility in Search Results

SOSL results are filtered by the `IsVisible*` fields in the `WHERE` clause of the
RETURNING clause. There is no automatic channel filtering based on the current user's
context — you must explicitly add the appropriate filter:

| Context                        | Filter to Add               |
|--------------------------------|-----------------------------|
| Service Console (agents)       | `AND IsVisibleInApp = true`  |
| Public Knowledge Base          | `AND IsVisibleInPkb = true`  |
| Customer Community (logged in) | `AND IsVisibleInCsp = true`  |
| Partner Community (logged in)  | `AND IsVisibleInPrm = true`  |

Without a channel filter, SOSL may return articles that are not intended for the
current context. Always specify the channel in Knowledge search queries.

---

## Knowledge Sidebar in Service Console

### Configuration

The Knowledge component surfaces SOSL search results within the Service Console
without custom Apex:

1. **Open App Builder** for the Case record page (Setup → Object Manager → Case →
   Lightning Record Pages).
2. Add the **Knowledge** standard component to the sidebar or a utility bar tab.
3. Configure auto-search: enable **Search articles using case subject** to auto-fire
   a SOSL search as soon as the agent opens a case.
4. Set the channel filter in the component configuration to `Internal App`.

### Auto-Search Behavior

When auto-search is enabled, Salesforce fires a SOSL query using the case Subject
field as the search term when:
- The agent opens a new or existing case record.
- The case subject is updated (re-fires the search).

The component respects the running user's data category visibility and the configured
channel filter.

---

## Case Deflection Configuration

### Web-to-Case Deflection (Self-Service)

1. Navigate to: **Setup → Self-Service → Web-to-Case**
2. Enable **Include Suggested Articles** in the Web-to-Case form.
3. Configure the channels to search (`IsVisibleInPkb` or `IsVisibleInCsp`).
4. Salesforce uses the form's Subject and Description fields to fire a SOSL query and
   display matching articles before the form is submitted.

### Email-to-Case Auto-Reply with Suggested Articles

1. Navigate to: **Setup → Email-to-Case Settings**
2. Enable **Suggested Articles** in the email-to-case routing address configuration.
3. When a case is created via email, Salesforce sends an auto-reply containing links
   to `Online` articles matching the email subject/body.
4. Configure the reply template to include the `{!Case.SuggestedArticles}` merge
   field (if using Classic email templates) or a dynamic component in Lightning email
   templates.

### Suggested Articles Component (Lightning Experience)

For guided case creation flows:
1. Add the **Suggested Articles** Lightning component to the case creation Lightning
   page or a Utility Bar.
2. Configure the component to query `IsVisibleInApp = true` for agent-facing
   deflection.
3. Agents can click **Attach to Case** on a suggested article to create a `CaseArticle`
   junction record.

---

## CaseArticle: Tracking Article Attachment

When an agent attaches an article to a case (via the Knowledge sidebar or Suggested
Articles component), Salesforce automatically creates a `CaseArticle` record. You can
also create them programmatically:

```apex
// Attach an article to a case
CaseArticle attachment = new CaseArticle(
    CaseId           = caseId,
    KnowledgeArticleId = knowledgeArticleId  // master ID, NOT version Id
);
insert attachment;
```

### Query Articles Attached to a Case

```soql
SELECT Id, KnowledgeArticleId, CreatedDate, CreatedById
FROM CaseArticle
WHERE CaseId = :caseId
```

### Find All Cases Where an Article Was Used

```soql
SELECT CaseId, Case.Subject, Case.Status, Case.ClosedDate
FROM CaseArticle
WHERE KnowledgeArticleId = :articleMasterId
ORDER BY CreatedDate DESC
```

---

## Article Effectiveness Metrics

### View Statistics

```soql
-- View count per article per channel
SELECT ParentId, Channel, Count, NormalizedScore
FROM KnowledgeArticleViewStat
WHERE ParentId IN :articleMasterIds
ORDER BY Count DESC
```

`NormalizedScore` is a 0.0–1.0 relative score across all articles in the org —
not an absolute view count. Use `Count` for absolute views.

### Vote/Helpfulness Statistics

```soql
-- Helpfulness score per article
SELECT ParentId, Channel, NormalizedScore, WasVotedHelpful
FROM KnowledgeArticleVoteStat
WHERE ParentId = :articleMasterId
```

### Combined Effectiveness Report (Apex)

```apex
// Articles sorted by combined view + vote score for an internal dashboard
List<KnowledgeArticleViewStat> viewStats = [
    SELECT ParentId, Count, NormalizedScore
    FROM KnowledgeArticleViewStat
    WHERE Channel = 'App'
    ORDER BY Count DESC
    LIMIT 50
];

Set<Id> topArticleIds = new Set<Id>();
for (KnowledgeArticleViewStat vs : viewStats) {
    topArticleIds.add(vs.ParentId);
}

Map<Id, KnowledgeArticleVoteStat> voteMap = new Map<Id, KnowledgeArticleVoteStat>();
for (KnowledgeArticleVoteStat vs : [
    SELECT ParentId, NormalizedScore, WasVotedHelpful
    FROM KnowledgeArticleVoteStat
    WHERE ParentId IN :topArticleIds
    AND Channel = 'App'
]) {
    voteMap.put(vs.ParentId, vs);
}

// Combine view and vote data for reporting
for (KnowledgeArticleViewStat vs : viewStats) {
    KnowledgeArticleVoteStat vote = voteMap.get(vs.ParentId);
    // ... build report rows
}
```

---

## SOSL Performance Considerations

### Indexed Fields and Search Performance

SOSL searches full-text indexed fields. Performance tips:

1. **Use `IN NAME FIELDS`** when searching only titles/summaries — significantly
   faster than `IN ALL FIELDS` on large knowledge bases (10,000+ articles).
2. **Add `LIMIT`** — always specify a `LIMIT` clause. Default SOSL limit is 2,000
   records; most use cases need 5–20.
3. **Filter by `PublishStatus` in RETURNING clause** — `WHERE PublishStatus = 'Online'`
   dramatically reduces the result set before returning to Apex.
4. **Filter by channel** — add `AND IsVisibleInApp = true` (or appropriate channel) to
   avoid retrieving articles the current user cannot see.
5. **Cache results** — for high-frequency search use cases (e.g., self-service
   portals), cache SOSL results in Platform Cache using the search term as the key.
   Invalidate cache entries when articles in the relevant categories are published or
   archived.

### Platform Cache for Knowledge Search

```apex
// Store search results in org cache (TTL: 10 minutes)
Cache.OrgPartition part = Cache.Org.getPartition('local.KnowledgeSearch');
String cacheKey = 'search_' + EncodingUtil.base64Encode(Blob.valueOf(searchTerm));

List<Knowledge__kav> cached = (List<Knowledge__kav>) part.get(cacheKey);
if (cached == null) {
    cached = searchArticles(searchTerm);
    part.put(cacheKey, cached, 600);  // 600 seconds = 10 minutes
}
return cached;
```

Use Platform Cache selectively — it is appropriate for public-facing self-service
portals with high search volume. Not recommended for internal agent console search
where freshness is critical.
