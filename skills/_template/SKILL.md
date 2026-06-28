---
name: <domain>-<capability>
description: >-
  [Trigger description — BE EXHAUSTIVE. List every Salesforce object API name, field name,
  method, keyword, and phrase that should trigger the agent to load this skill.
  Example: "Claim, ClaimParticipant, ClaimItem, FNOL, straight-through processing, STP,
  ClaimAction, ClaimReserve, ClaimPayment, adjudication, InsurancePolicy, OmniStudio,
  FSCInsurance, FSCInsuranceClaims permission set, claims lifecycle"]
compliance:
  regulations: []
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "none"
license: MIT
metadata:
  author: <github-handle>
  version: 1.0.0
  domain: <domain>
  module: <capability>
  api-version-min: "60.0"
  salesforce-release-min: "Winter25"
  approval-tier: "draft"
---

# [Domain] — [Capability] Skill

## Always true — read first

> These facts are commonly missed. Apply them before writing a single line of code or SOQL.

1. **[Gotcha 1]** — [Precise, actionable fact. Not advice. One sentence.]
2. **[Gotcha 2]** — [Precise, actionable fact.]
3. **[Gotcha 3]** — [Precise, actionable fact.]
4. **[Gotcha 4]** — [Precise, actionable fact.]
5. **[Gotcha 5]** — [Precise, actionable fact.]
6. **[Gotcha 6]** — [Precise, actionable fact.]
7. **[Gotcha 7]** — [Precise, actionable fact.]
8. **[Gotcha 8]** — [Precise, actionable fact.]
9. **[Gotcha 9]** — [Precise, actionable fact.]
10. **[Gotcha 10]** — [Precise, actionable fact.]

---

## When to load a reference

Load a reference file on demand when the user's task falls in that area. Do not load all references at once.

| If the user asks about… | Load |
|---|---|
| [Topic 1 — objects, architecture, overview] | `references/01-architecture.md` |
| [Topic 2 — setup, permissions, metadata config] | `references/02-setup-and-permissions.md` |
| [Topic 3 — specific feature area] | `references/03-<feature>.md` |
| [Topic 4] | `references/04-<feature>.md` |
| [Topic 5] | `references/05-<feature>.md` |

---

## Standard workflows

### Workflow 1: [Name]

1. [Step 1]
2. [Step 2]
3. [Step 3]
4. [Step 4]
5. [Step 5]

### Workflow 2: [Name]

1. [Step 1]
2. [Step 2]
3. [Step 3]

### Workflow 3: [Name]

1. [Step 1]
2. [Step 2]
3. [Step 3]

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/describe-objects.sh` | Describe all key objects for this skill |
| `scripts/query-lifecycle.sh` | Query records across the lifecycle |
| `scripts/check-config.sh` | Validate required metadata configuration |
| `scripts/seed-test-data.sh` | Create minimal test records |

---

## NOT covered by this skill

This skill covers [capability] only. Do not use it for:

- [Adjacent domain 1 — be specific: object names, feature names]
- [Adjacent domain 2]
- [Adjacent domain 3]

If the user asks about these areas, say so explicitly and stop rather than guessing.
