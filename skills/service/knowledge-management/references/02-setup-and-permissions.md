# Lightning Knowledge — Setup and Permissions

## Enabling Lightning Knowledge

### Step 1: Enable Knowledge in the Org

Navigate to: **Setup → Service → Knowledge Settings**

- Check **Enable Lightning Knowledge**.
- Select the default language for the knowledge base.
- Optionally enable **Validation Status** (adds a `ValidationStatus` picklist to
  articles to support a review workflow; values are configurable).
- Click **Save**.

Once enabled, the `Knowledge__kav` SObject and `KnowledgeArticle` objects are
available. This setting cannot be disabled after articles are created.

### Step 2: Assign the Knowledge User Permission

Users who author, review, or manage articles must have the **Knowledge User** permission
enabled on their profile or via a Permission Set.

- **Profile path:** Setup → Users → Profiles → [Profile] → System Permissions →
  Knowledge User (check)
- **Permission Set path:** Setup → Permission Sets → [Set] → System Permissions →
  Knowledge User

Without this permission, users can read published articles in the console but cannot
create, edit, or manage article versions.

### Step 3: Configure Article Record Types

Lightning Knowledge uses Record Types to represent article types (replacing Classic
Knowledge's separate `kav` SObjects).

1. Navigate to: Setup → Object Manager → Knowledge → Record Types
2. Create one Record Type per article category (e.g., `FAQ`, `How_To`, `Known_Issue`,
   `Release_Note`).
3. Assign page layouts per Record Type to control which fields are shown for each
   article type.
4. Assign Record Types to profiles that need to create articles of each type.

**Custom fields** (including the article body rich-text field) are typically defined at
the object level and controlled via page layout assignments per Record Type.

### Step 4: Configure DataCategoryGroups

Data categories control article visibility by role, profile, or permission set.

1. Navigate to: **Setup → Data Categories**
2. Create a new `DataCategoryGroup`:
   - Set `SobjectType = KnowledgeArticle` (mandatory for Knowledge).
   - Add top-level `DataCategory` nodes.
   - Add child categories as needed (hierarchical structure is supported).
3. Activate the group: set `IsActive = true`.

**SOQL to verify active Knowledge category groups:**
```soql
SELECT Id, Name, DeveloperName, SobjectType, IsActive
FROM DataCategoryGroup
WHERE SobjectType = 'KnowledgeArticle' AND IsActive = true
```

### Step 5: Configure Category Visibility by Role/Profile

Data category visibility determines which categories (and therefore which articles) a
user can see.

1. Navigate to: **Setup → Roles** (or **Profiles** for profile-based visibility)
2. Click on a Role → **Category Group Visibility** section.
3. Set visibility for each `DataCategoryGroup`:
   - **All Categories** — user sees articles in all categories
   - **None** — user sees no articles in this category group
   - **Custom** — specify individual visible categories

Without explicit visibility settings, the default is determined by the org's default
data category visibility setting (Setup → Data Categories → Default Data Category
Visibility).

---

## Knowledge Base URL (Public Knowledge Base)

To expose articles to unauthenticated external users:

1. Navigate to: **Setup → Knowledge Settings → Knowledge Base URL Settings**
2. Enable the Public Knowledge Base and configure the URL prefix (e.g.,
   `https://help.yourcompany.com`).
3. Ensure articles have `IsVisibleInPkb = true` and `PublishStatus = 'Online'`.

The Public Knowledge Base uses Salesforce Sites under the hood. A Site must be active
for PKB to function.

---

## Translation Workbench Enablement

To support multilingual Knowledge articles:

1. Navigate to: **Setup → Translation Workbench → Translation Settings**
2. Click **Enable**.
3. Add supported languages: Setup → Translation Workbench → Translation Settings →
   Add Language.
4. For each language, optionally designate translators (users who can translate content
   into that language).

Once Translation Workbench is enabled:
- Articles can have translated versions sharing the same `KnowledgeArticleId`.
- Each translated version has a unique `Id` and a `Language` field value matching the
  ISO code of the translation (e.g., `'fr'`, `'de'`, `'ja'`).

**Without Translation Workbench**, attempting to create or import articles with a
`Language` field value different from the org's default language throws:
`FIELD_INTEGRITY_EXCEPTION: Language: You cannot insert an article in another language
without enabling Translation Workbench.`

---

## Validation Status (Review Workflow Support)

Enabling **Validation Status** in Knowledge Settings adds a `ValidationStatus` picklist
field to `Knowledge__kav`. This supports a lightweight review workflow without
requiring a formal Approval Process.

Default picklist values:
- `Not Validated`
- `Validated`

Custom values can be added (e.g., `In Review`, `Pending Legal Approval`). Validation
status is independent of `PublishStatus` — an article can be `Online` with
`ValidationStatus = 'Not Validated'`.

### Custom Approval Workflow via Approval Process

For stricter governance, configure an Approval Process on the `Knowledge__kav` object:

1. Setup → Approval Processes → Knowledge → New Approval Process
2. Configure entry criteria (e.g., `PublishStatus = 'Draft'`)
3. Add approval steps with designated approvers
4. On final approval, use a Field Update action to set `PublishStatus = 'Online'`

Note: The standard **Submit for Approval** button must be added to the article page
layout for authors to trigger the process.

---

## Smart Links

Smart Links allow Knowledge articles to link to other articles using internal IDs
that automatically resolve to the correct URL regardless of environment.

Enable via: **Setup → Knowledge Settings → Smart Links**

When Smart Links are enabled:
- Authors insert links using the rich-text editor's Link dialog.
- Salesforce stores the link as an internal reference (not a hardcoded URL).
- When the article is rendered, the platform resolves the internal link to the correct
  channel-appropriate URL.

Smart Links prevent broken links when articles are moved between channels or when the
PKB URL changes.

---

## Recommended Permission Set Structure

| Permission Set          | Permissions Included                               | Assigned To                   |
|-------------------------|----------------------------------------------------|-------------------------------|
| `Knowledge_Author`      | Knowledge User, Create/Edit/Delete on Knowledge__kav | Content authors              |
| `Knowledge_Manager`     | Knowledge User + Manage Articles + manage categories | Knowledge managers           |
| `Knowledge_Viewer`      | Read on Knowledge__kav (no Knowledge User)         | Agents who only consume articles |
| `Knowledge_Translator`  | Knowledge User + Manage Translations               | Translators                   |

**Important:** Knowledge User permission is required for any user who needs to create
or edit articles. Read-only consumers (agents reading articles in console) do not
need the Knowledge User permission but must have at minimum Read access to
`Knowledge__kav` granted through their profile or a permission set.
