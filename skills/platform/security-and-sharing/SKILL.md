---
name: platform-security-and-sharing
description: >-
  OWD, organization-wide defaults, role hierarchy, sharing rules, criteria-based sharing,
  owner-based sharing, Apex managed sharing, AccountShare, OpportunityShare, Share objects,
  RowCause, manual sharing, Field-Level Security, FLS, object permissions, permission set,
  permission set group, profile, named credential, connected app, Shield Platform Encryption,
  field encryption, deterministic encryption, event monitoring, login forensics,
  audit trail, IP restrictions, session policy, CRUD, FLS enforcement in Apex
compliance:
  regulations: ["SOC2", "GDPR", "PCI-DSS"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "restricted"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: security-and-sharing
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# Platform Security and Sharing — Skill

## Overview

This skill covers the full Salesforce security and sharing model, from object-level access through field-level security, programmatic sharing, Shield Platform Encryption, named credentials, connected apps, and platform monitoring. It applies to all org types and is scoped for compliance-sensitive implementations (SOC2, GDPR, PCI-DSS).

---

## Always True (Gotchas)

### 1. OWD can only be opened, not closed, by sharing rules and role hierarchy

OWD sets the baseline (Private, Public Read Only, Public Read/Write, Controlled by Parent). Sharing rules, role hierarchy, teams, and Apex managed sharing can only GRANT additional access on top of OWD. They cannot restrict access below OWD. If a record needs restricted access, the OWD must be Private and access granted selectively. A common mistake is setting OWD to Public Read Only and then trying to "hide" certain records from a group of users using sharing rules — this is architecturally impossible.

### 2. `RowCause` on Share objects must use a custom RowCause for Apex managed sharing — using `Manual` causes the share to be deletable by users

Share objects (e.g. `AccountShare`, `OpportunityShare`) have a `RowCause` field. The platform values (`Manual`, `Role`, `Team`, `Rule`) are system-controlled. Apex managed sharing must use a custom `RowCause` (defined as a custom Share Reason in Setup under the object's detail page) so the shares are owned by Apex and cannot be accidentally deleted by users via the "Sharing" button. Shares created with `RowCause = 'Manual'` appear in the UI's manual sharing list and users with sharing access can delete them.

### 3. FLS is NOT automatically enforced in Apex — `WITH SECURITY_ENFORCED` or `Schema.describeSObjects()` checks are required

By default, Apex runs in system context and ignores FLS. A SOQL query in Apex can return fields the running user cannot see in the UI. Use `WITH SECURITY_ENFORCED` in SOQL (throws `System.QueryException` if any field in the query is inaccessible), or `WITH USER_MODE` (silently removes non-accessible fields and objects), or explicit `Schema.SObjectField.getDescribe().isAccessible()` checks before reading field values. Failing to enforce FLS in Apex is a security vulnerability and a common finding in security reviews. AppExchange security reviews (ISV) flag this as a P0 issue.

### 4. Permission sets stack on top of profiles — they can only grant permissions, never revoke them

Permission sets add permissions; they cannot remove a permission that a profile grants. If a profile grants "Delete Account" and you want some users to not have it, you cannot revoke it via a permission set. You must either change the profile, create a separate profile without that permission, or use a Permission Set Group muting permission set (which requires a specific License type). Permission Set Groups aggregate multiple permission sets but still cannot revoke profile-granted permissions. This is the primary reason the industry is moving to a "minimum access profile + permission sets" model.

### 5. Criteria-based sharing rules re-evaluate when the criteria field changes — owner-based rules only apply at record creation and ownership change

Criteria-based sharing rules trigger a re-evaluation when a field used in the criteria is updated (e.g. `Account.Industry` changes from `Technology` to `Healthcare`). This re-evaluation is synchronous for direct updates and asynchronous (sharing recalculation batch) after OWD or sharing rule changes. Owner-based sharing rules apply when a record's ownership changes. Never assume criteria-based sharing is "set and forget" — every relevant field update triggers re-evaluation and can add or remove access mid-lifecycle.

### 6. Apex managed sharing survives record owner changes — manual sharing does not

When a record owner changes, the platform deletes all `Manual` RowCause shares for that record. Custom RowCause shares (Apex managed) are preserved across owner changes. If your integration or Apex code creates shares with `RowCause = 'Manual'`, they will be silently deleted on record re-assignment. Always use a custom RowCause for any programmatic sharing that must survive ownership transfers. This is a frequent source of intermittent access bugs after record reassignment workflows.

### 7. `WITH USER_MODE` in SOQL silently omits non-accessible fields and objects — `WITH SECURITY_ENFORCED` throws a QueryException

`WITH USER_MODE` enforces FLS and object-level security but returns partial results: inaccessible fields are returned as `null`, and queries against inaccessible objects return empty results without error. `WITH SECURITY_ENFORCED` throws `System.QueryException: Not accessible` if any field in the query is inaccessible to the running user. Choose based on whether partial data is acceptable (USER_MODE) or whether an explicit failure is the safer outcome (SECURITY_ENFORCED). USER_MODE is generally preferred for LWC data service calls; SECURITY_ENFORCED for transactional Apex where partial data would cause incorrect behavior.

### 8. Shield Platform Encryption uses tenant-managed keys — encrypting a field that is used in a formula, filter, or sort requires deterministic encryption

Standard Shield encryption is probabilistic (different ciphertext each time), which prevents the field from being used in SOQL WHERE clauses, ORDER BY, or formula fields. Deterministic encryption produces consistent ciphertext for the same plaintext, enabling those operations at a slightly lower theoretical security level. Encrypting a field used in a filter/sort with probabilistic encryption silently breaks those queries — SOQL WHERE conditions return 0 results, ORDER BY produces non-alphabetical order. Always identify field usage (filters, formulas, list views, reports, flows) before choosing the encryption type.

### 9. Named Credentials store callout endpoints and authentication — never hardcode endpoint URLs or credentials in Apex

`Named Credential: MyService` is referenced in Apex as `callout:MyService/path`. The platform handles OAuth token refresh, basic auth header injection, and TLS certificate validation. Hardcoding credentials or endpoint URLs in Apex, custom settings, or custom metadata creates a compliance violation (credentials visible in code), breaks across environments (sandbox vs production use different endpoints), and bypasses the platform's credential rotation mechanism. As of API v57.0+, External Credentials paired with Named Credentials replace legacy Named Credentials for more granular per-principal auth.

### 10. Connected App OAuth scopes must explicitly include `api` for Salesforce API access — `refresh_token` alone does not grant API access

A Connected App with only `refresh_token, offline_access` scope cannot make REST or SOAP API calls. The `api` scope (or `full`) must be explicitly included. Scope mismatches produce `insufficient_scope` errors that are often misdiagnosed as token expiry or authentication failures. For server-to-server integrations using JWT Bearer flow, the `api` scope is required on the Connected App regardless of the JWT claims.

### 11. Role hierarchy sharing is enabled per object via the OWD "Grant Access Using Hierarchies" checkbox — and cannot be disabled on standard objects

By default, role hierarchy sharing is enabled: records owned by a subordinate in the role hierarchy are visible to users higher in the hierarchy. Unchecking "Grant Access Using Hierarchies" on a custom object's OWD disables role hierarchy access for that object. Standard objects (Account, Opportunity, Case, Contact, Lead) have this permanently enabled and the checkbox cannot be unchecked. This is a frequent source of unexpected access in orgs with deeply nested role hierarchies.

### 12. `Schema.SObjectField.getDescribe().isCreateable()` / `isUpdateable()` checks are required before DML in Apex for CRUD enforcement

Just as FLS governs field reads, CRUD governs object-level DML and must be explicitly checked in Apex. A user with Read-only object permissions can still have an Apex trigger or controller perform `insert`/`update`/`delete` on their behalf unless CRUD is explicitly checked. Use `SObjectType.getDescribe().isCreateable()` before `insert`, `isUpdateable()` before `update`, `isDeletable()` before `delete`. The `AccessType` enum with `Security.stripInaccessible()` provides a combined FLS+CRUD enforcement pattern for DML operations.

### 13. Session Security Level (Standard vs High Assurance) gates certain sensitive operations — activating High Assurance requires MFA at login

Salesforce allows permission sets and session-based permission sets to require a "High Assurance" session level. Operations gated behind High Assurance (e.g. connected app authorization, report export, certain API access) require the user to have authenticated with MFA during the current session. Enabling High Assurance for all API access in a session policy affects all service accounts and integration users; explicitly exempted named users or trusted IP ranges must be configured via Login IP Ranges to avoid breaking integrations.

### 14. Event Monitoring log files are available via the `EventLogFile` object — they expire after 24 hours (standard) or 30 days (with Event Monitoring add-on)

`EventLogFile.EventType` categorizes log types (`Login`, `API`, `Apex`, `LightningPageView`, `Report`, `Dashboard`, etc.). Without the Event Monitoring add-on, log files are available for 24 hours only and are permanently deleted after that window. The `LogFile` field contains a binary CSV blob. Querying `EventLogFile` requires the `ViewEventLogFiles` system permission. For compliance log retention, export must be automated (scheduled Apex or external ETL) within the 24-hour window, or the add-on must be purchased for 30-day retention.

---

## Routing Table

| User intent | Reference file | Workflow |
|---|---|---|
| Understand the sharing model layers, what controls what | `references/01-architecture.md` | — |
| Set up or change OWD for an object | `references/02-sharing-model.md` | — |
| Create sharing rules (owner-based or criteria-based) | `references/02-sharing-model.md` | — |
| Build Apex managed sharing with custom RowCause | `references/02-sharing-model.md` | Workflow 01 |
| Enforce FLS in Apex (WITH SECURITY_ENFORCED, WITH USER_MODE, stripInaccessible) | `references/03-fls-and-permissions.md` | Workflow 02 |
| Check or enforce CRUD permissions in Apex before DML | `references/03-fls-and-permissions.md` | Workflow 02 |
| Create or assign permission sets and permission set groups | `references/03-fls-and-permissions.md` | — |
| Understand profile vs permission set model | `references/03-fls-and-permissions.md` | — |
| Set up Shield Platform Encryption on a field | `references/04-encryption-and-credentials.md` | Workflow 03 |
| Choose between deterministic and probabilistic encryption | `references/04-encryption-and-credentials.md` | Workflow 03 |
| Set up Named Credentials or External Credentials for callouts | `references/04-encryption-and-credentials.md` | — |
| Configure a Connected App for OAuth | `references/04-encryption-and-credentials.md` | — |
| Query Event Monitoring logs / EventLogFile | `references/05-monitoring-and-audit.md` | — |
| Set up audit trail, login history, IP restrictions | `references/05-monitoring-and-audit.md` | — |
| Configure session policies or Transaction Security | `references/05-monitoring-and-audit.md` | — |

---

## Workflows

### Workflow 01 — Implement Apex Managed Sharing with Custom RowCause

**Goal:** Grant programmatic access to records via Apex that survives record owner changes and is not user-deletable.

**Steps:**
1. Navigate to **Setup → Object Manager → [Your Object] → Sharing Reasons**. Create a new Share Reason (e.g. `IntegrationShare`). This creates the custom RowCause token `IntegrationShare__c` on the `[Object]__Share` object.
2. Write Apex that queries existing shares for the records, builds the new share records with the custom RowCause, and upserts them. Always delete stale shares for removed access before inserting new ones to avoid orphaned share rows.
3. Invoke sharing logic from an after-insert / after-update trigger or a schedulable batch class for bulk recalculation.
4. Test by asserting share records in `@isTest` methods using `System.runAs()` to verify the target user can read the record.

See `references/02-sharing-model.md` for full code patterns.

### Workflow 02 — Harden a Visualforce/Apex Controller with FLS and CRUD Enforcement

**Goal:** Ensure an Apex controller respects the running user's field-level security and object-level CRUD permissions.

**Steps:**
1. Replace bare SOQL queries with `WITH USER_MODE` (or `WITH SECURITY_ENFORCED` where partial data is unacceptable).
2. Before any `insert`/`update`/`delete`, call `Security.stripInaccessible(AccessType.CREATABLE, records)` (or `UPDATABLE`) to strip fields the user cannot write.
3. Check `SObjectType.getDescribe().isCreateable()` / `isUpdateable()` / `isDeletable()` before performing DML and throw an `AuraHandledException` or surface an appropriate error if access is denied.
4. Run the PMD Apex Security ruleset or Salesforce Code Analyzer to validate no bare SOQL or DML remains.

See `references/03-fls-and-permissions.md` for full code patterns.

### Workflow 03 — Set Up Shield Platform Encryption with Deterministic Encryption for a Filtered Field

**Goal:** Encrypt a sensitive field (e.g. SSN, bank account number) while preserving the ability to use it in SOQL WHERE filters, list views, and reports.

**Steps:**
1. Activate Shield Platform Encryption in Setup and generate or upload a tenant secret.
2. Navigate to **Setup → Platform Encryption → Encryption Policy**. Select the target object and field.
3. Choose **Deterministic** encryption type if the field is used in SOQL WHERE, ORDER BY, flow filters, list view filters, or formula fields. Choose **Probabilistic** if the field is only displayed, never filtered.
4. After saving, run **Encrypt Existing Records** to retroactively encrypt existing data. This is an async job — monitor via **Encryption Statistics**.
5. Validate by running a SOQL query filtering on the field in Developer Console — deterministic-encrypted fields return correct results; probabilistic-encrypted fields return 0 rows when filtered.

See `references/04-encryption-and-credentials.md` for full details on field type support, key rotation, and SOQL impact.

---

## Boundaries — What This Skill Does NOT Cover

- **Identity Provider / SSO configuration** — SAML, OIDC, My Domain setup, single sign-on: use the dedicated identity skill.
- **Experience Cloud / Communities sharing model** — sharing sets, sharing groups, guest user access rules for Experience Cloud sites: use the Experience Cloud skill.
- **Territory Management sharing** — enterprise territory management access rules: use `sales-territory-management`.
- **Shield Platform Encryption key management with Salesforce support** — key ceremonies, BYOK hardware security modules, key compromise procedures: these require Salesforce support engagement and are outside automated skill scope.
