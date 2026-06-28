# Case Lifecycle — Channels and Integrations

## Web-to-Case

Web-to-Case allows customers to submit cases through an HTML form on your website. Salesforce generates a form that POSTs directly to a Salesforce endpoint.

### Form Generation

**Path:** Setup > Service > Web-to-Case > Generate the HTML

The generated form includes:
- Hidden field `orgid` — your Salesforce org ID.
- Hidden field `retURL` — the redirect URL after successful submission.
- Input fields mapped to Case field API names.

### Spam Filtering

Two approaches:
1. **Hidden honeypot field** — add a hidden `<input>` that legitimate users will not fill; reject submissions where it has a value (requires custom handling).
2. **reCAPTCHA** — not natively supported in the standard Web-to-Case form. Implement server-side form validation with a proxy endpoint that validates reCAPTCHA before forwarding to Salesforce.

### Assignment Rule Activation

Enable **"Assign Cases to Case Assignment Rules"** in Setup > Service > Web-to-Case. Without this, all Web-to-Case submissions go to the default case owner configured on the Web-to-Case settings page.

### Limits and Gotchas

| Issue | Detail |
|-------|--------|
| Daily limit | 5,000 cases/day per org via Web-to-Case |
| File attachments | Not natively supported; use a custom form + Salesforce API |
| CAPTCHA | Not built-in; implement via a proxy |
| Required fields | Web form must include all fields required by validation rules; otherwise submission fails silently from the customer's perspective |
| Email confirmation | Configure an auto-response rule (Setup > Service > Auto-Response Rules) to send case confirmation emails to customers |

---

## Email-to-Case

Email-to-Case converts inbound emails into Case records and captures the email body as an `EmailMessage` record.

### On-Demand vs Salesforce-Hosted

| Mode | Email Path | Max Attachment Size | Notes |
|------|-----------|---------------------|-------|
| On-Demand | Customer → Your mail server → Salesforce API | 25 MB | Requires email agent install or mail server forwarding rule |
| Salesforce-Hosted | Customer → Salesforce directly | 10 MB | Simpler; email address is `@salesforce.com` or mapped via MX record |

### Routing Address Configuration

Each inbound email address is a separate routing address. Fields:
- **Email Address** — the address customers write to
- **Queue** — which queue owns the created case
- **Case Origin** — set to `Email`
- **Priority** — default priority for cases from this address
- **Enable Auto-Response** — sends a confirmation email reply

**Note:** Multiple routing addresses can map to the same queue. Use separate routing addresses for different product lines, languages, or priorities.

### Auto-Response Rules

**Path:** Setup > Service > Auto-Response Rules (Case)

Auto-response rules trigger an email reply to the case contact when a case is created. Works for Web-to-Case and Email-to-Case. One rule can be active at a time. Uses email templates.

---

## EmailMessage Object

`EmailMessage` is the Salesforce object that stores individual email messages on a case. It is a child of `Case` via `ParentId`.

### Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `ParentId` | Lookup(Case) | The case this message belongs to |
| `Incoming` | Boolean | `true` = inbound from customer; `false` = outbound from agent |
| `Subject` | Text | Email subject line |
| `TextBody` | Long Text | Plain text body |
| `HtmlBody` | Long Text | HTML body |
| `FromAddress` | Email | Sender email address |
| `ToAddress` | Text | Recipient email address(es) |
| `CcAddress` | Text | CC recipients |
| `ThreadIdentifier` | Text | Salesforce threading token; system-managed |
| `MessageIdentifier` | Text | The email's Message-ID header |
| `Status` | Picklist | `New`, `Read`, `Replied`, `Sent`, `Forwarded`, `Draft` |
| `IsExternallyVisible` | Boolean | Whether visible to portal/community users |

### Threading

Salesforce embeds the `ThreadIdentifier` in the email footer and subject line in the format:
```
[ ref:_<orgId>._<caseId>:ref ]
```

When a customer replies and the token is present, Salesforce creates the new `EmailMessage` under the existing `Case`. When the token is absent, a new `Case` is created.

**IsExternallyVisible vs IsPublished (CaseComment):** These are distinct. `EmailMessage.IsExternallyVisible` controls whether portal users see the email thread. `CaseComment.IsPublished` controls whether portal users see a comment. They are not interchangeable.

### Querying Email Thread for a Case

```sql
SELECT Id, Subject, Incoming, FromAddress, ToAddress, TextBody, CreatedDate
FROM EmailMessage
WHERE ParentId = '<CaseId>'
ORDER BY CreatedDate ASC
```

---

## LiveChatTranscript Linking to Case

When a live chat session ends, Salesforce creates a `LiveChatTranscript` record. It can be linked to a `Case` via `LiveChatTranscript.CaseId`.

### Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `CaseId` | Lookup(Case) | Linked case (set manually or by agent during chat) |
| `ContactId` | Lookup(Contact) | Customer contact |
| `AccountId` | Lookup(Account) | Customer account |
| `Body` | Long Text | Full chat transcript |
| `StartTime` | DateTime | Chat session start |
| `EndTime` | DateTime | Chat session end |
| `ChatDuration` | Number | Duration in seconds |
| `AgentId` | Lookup(User) | Handling agent |
| `WaitTime` | Number | Seconds customer waited for agent |
| `Status` | Picklist | `Completed`, `Missed`, `Disconnected` |

### Case Creation from Chat

Agents can create a case directly from the chat window using a quick action. If the agent creates a case, `LiveChatTranscript.CaseId` is set. If no case is created, the transcript remains unlinked.

To automatically create a case from every chat and link the transcript, configure a post-chat Flow:
1. Trigger on `LiveChatTranscript` creation.
2. Insert a `Case` record with the transcript's `ContactId` and `AccountId`.
3. Update `LiveChatTranscript.CaseId` with the new case ID.

---

## MessagingSession (WhatsApp, SMS, In-App)

`MessagingSession` represents a messaging conversation (WhatsApp, SMS, Facebook Messenger, In-App and Web messaging). It can be linked to a `Case`.

### Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `CaseId` | Lookup(Case) | Linked case |
| `ContactId` | Lookup(Contact) | Customer contact |
| `AccountId` | Lookup(Account) | Customer account |
| `Status` | Picklist | `Active`, `Ended`, `Waiting` |
| `ChannelType` | Picklist | `WhatsApp`, `SMS`, `FacebookMessenger`, `Custom` |
| `Origin` | Text | Source channel identifier |
| `AgentId` | Lookup(User) | Handling agent |
| `StartTime` / `EndTime` | DateTime | Session duration |

### Case-Session Linking

MessagingSession can be linked to a Case during or after the session. Agents can use a quick action in the Service Console to create or link a case. Automated Flow-based case creation follows the same pattern as LiveChatTranscript.

**Note:** `MessagingSession` is distinct from the older `LiveChatTranscript` object. New Salesforce messaging (Messaging for In-App and Web) uses `MessagingSession`. Classic Salesforce Live Agent uses `LiveChatTranscript`.

---

## Knowledge Article Integration

Knowledge articles can be attached to cases in two ways:

### 1. Case Feed / Knowledge Component

The Lightning Knowledge component in the Service Console allows agents to search for and attach articles to the case. When an article is attached:
- A `CaseArticle` junction object record is created (`CaseId` + `KnowledgeArticleId`).
- The article can optionally be emailed to the customer.

**SOQL for articles attached to a case:**
```sql
SELECT Id, KnowledgeArticleId, KnowledgeArticle.Title, CreatedDate
FROM CaseArticle
WHERE CaseId = '<CaseId>'
```

### 2. Einstein Case Classification / Suggested Articles

Einstein Article Recommendations (requires Einstein for Service add-on) suggests relevant articles based on case subject and description. Agents accept or dismiss suggestions. Accepted articles create `CaseArticle` records.

### Knowledge Deflection via Web-to-Case

Configure the Web-to-Case form to display suggested articles before submission (requires Experience Cloud or a custom implementation with the Knowledge API). This reduces case volume by resolving issues before they become cases.

---

## Macro Automation

Macros allow agents to apply a sequence of actions to a case with a single click from the Service Console. Macros automate repetitive tasks without agent error.

### Common Macro Use Cases

| Use Case | Actions in Macro |
|----------|-----------------|
| Send acknowledgment email | Select email template, populate To field, send email |
| Close case with resolution | Set Status = Closed, populate Resolution__c, send closure email |
| Escalate to Tier 2 | Change OwnerId to Tier 2 queue, set Priority = High, add CaseComment |
| Apply knowledge article | Search for article, attach to case, email to customer |

### Macro Configuration

**Path:** Setup > Service > Macros

Macros are built using a declarative step-by-step action builder. Actions can reference:
- **Quick Actions** — on the Case object
- **Email actions** — send a specific template
- **Field updates** — update Case fields
- **Publisher actions** — run a flow or Apex action

**Macro permissions:** Users must have the `Run Macros` permission. Macros can be restricted by profile or permission set.

**Bulk macros** (available in Lightning): Run a macro on multiple selected cases from a list view. Requires the `Run Macros on Multiple Records` permission.

---

## Einstein Case Classification

Einstein Case Classification (part of Einstein for Service) uses machine learning to suggest or auto-populate case fields based on the case subject and description.

### Supported Fields

- `Priority`
- `Type`
- `Reason`
- Custom picklist fields (configured in Setup)

### How It Works

1. After collecting sufficient historical case data (minimum ~1,000 cases with field values), train the classification model in Setup > Einstein Case Classification.
2. Enable auto-populate (applies suggestions automatically) or assisted (shows suggestions for agent approval).
3. Field values are set when the case is created from Email-to-Case, Web-to-Case, or the New Case quick action.

### Limitations

- Requires Service Cloud Einstein license.
- Does not classify cases created via Apex DML or API (only via standard intake channels).
- Model must be retrained periodically as case patterns change.
- Does not set `EntitlementId` — entitlement lookup is separate.
