# SkillForge — the KnowledgeForce aCoE Skill Exchange

> *Forge expertise. Deploy capability.*

**KnowledgeForce** is an AI Center of Excellence (aCoE) concept: encode Salesforce institutional knowledge once, version it, govern it, and let it compound across every project and every agent.

**SkillForge** is its implementation — an enterprise-grade, open-source library of **Agent Skills**, **MCP Plugins**, and **Agentforce Agent definitions** for Salesforce architects, developers, consultants, and implementation teams.

Not documentation. Not a chatbot. Versioned, governed, deployable expertise — a claims adjudication skill, a fraud triage agent, a data migration runbook. Encoded once, reviewed by domain experts, compliance-mapped, and consumable by any AI agent on any engagement.

Built for **Claude Code, Cursor, Windsurf, GitHub Copilot, Cline**, and any AI coding agent that reads `SKILL.md` instruction packages.

---

## Three Layers

| Layer | Path | What it is | Risk |
|---|---|---|---|
| **Skills** | `skills/` | Instruction packages — teach the agent domain knowledge | Read-only context. No org access. Low risk. |
| **Plugins** | `plugins/` | MCP servers — give the agent live Salesforce org access | Read or read-write. Must be scoped and audited. High risk. |
| **Agentforce Agents** | `agentforce-agents/` | `.agent` definitions deployed *into* Salesforce | Runs inside Salesforce. Deployment-gated. |

---

## Skill Library

### Platform

| Skill | Status | Description |
|---|---|---|
| `platform/bulk-data-processing` | 🚧 Planned | Bulk API 2.0, batch Apex, data loader patterns, governor limits |
| `platform/async-patterns` | 🚧 Planned | Queueable, future methods, Platform Events, Change Data Capture |
| `platform/security-and-sharing` | 🚧 Planned | Sharing model, FLS, encryption, connected app security |
| `platform/integration-patterns` | 🚧 Planned | REST/SOAP, Platform Events, CDC, MuleSoft, named credentials |
| `platform/devops-and-deployment` | 🚧 Planned | SFDX, scratch orgs, CI/CD, change sets, deployment strategies |
| `platform/performance-and-limits` | 🚧 Planned | SOQL optimisation, heap/CPU profiling, async offloading |

### Sales Cloud

| Skill | Status | Description |
|---|---|---|
| `sales/opportunity-to-close` | ✅ v1.0 | Opportunity stages, forecasting, close plans, CPQ handoff |
| `sales/revenue-cloud` | ✅ v1.0 | New-core Revenue Cloud PCM, pricing, transaction management |
| `sales/forecasting` | ✅ v1.0 | Collaborative forecasting, territory hierarchies, overlays |
| `sales/territory-management` | ✅ v1.0 | Enterprise Territory Management, assignment rules |

### Service Cloud

| Skill | Status | Description |
|---|---|---|
| `service/case-lifecycle` | ✅ v1.0 | Case creation, routing, escalation, SLAs, entitlements |
| `service/omni-channel-routing` | ✅ v1.0 | Unified routing, skills-based routing, queues, capacity |
| `service/knowledge-management` | ✅ v1.0 | Knowledge articles, search, Lightning Knowledge migration |
| `service/field-service` | ✅ v1.0 | Work orders, service appointments, dispatcher console |

### Financial Services Cloud (FSC)

| Skill | Status | Description |
|---|---|---|
| `industries/fsc/claims-process` | ✅ v1.0 | End-to-end claims lifecycle — FNOL, adjudication, fraud/STP, reserves, payments |
| `industries/fsc/policy-administration` | ✅ v1.0 | InsurancePolicy lifecycle, endorsements, renewals, cancellations, coverage, participants |
| `industries/fsc/wealth-management` | ✅ v1.0 | FinancialAccount, household model, holdings, goals, plans, FINRA compliance |
| `industries/fsc/mortgage-origination` | ✅ v1.0 | URLA/1003 intake, underwriting, HMDA/TRID/RESPA compliance, LOS integration, closing |
| `industries/fsc/producer-hierarchy` | ✅ v1.0 | Multi-tier distribution (DST/RTF/CRP/Agent), ProducerRelationship, PPA, commissions, licensing |
| `industries/fsc/household-management` | ✅ v1.0 | Household group model, membership, FinancialAccountRole, goals, plans, relationship map |

### Health Cloud

| Skill | Status | Description |
|---|---|---|
| `industries/health-cloud/care-management` | 🚧 Planned | CarePlan, clinical encounters, FHIR R4, HIPAA guardrails |
| `industries/health-cloud/provider-management` | 🚧 Planned | Provider network, credentialing, referral management |

### Manufacturing Cloud

| Skill | Status | Description |
|---|---|---|
| `industries/manufacturing-cloud/sales-agreements` | 🚧 Planned | Account-based forecasting, sales agreements, rebates |
| `industries/manufacturing-cloud/partner-programs` | 🚧 Planned | Channel partner management, program terms, tier logic |

### Public Sector Solutions

| Skill | Status | Description |
|---|---|---|
| `industries/public-sector/grants-management` | 🚧 Planned | Grant lifecycle, compliance reporting, disbursements |
| `industries/public-sector/licensing-permitting` | 🚧 Planned | Permit applications, inspections, renewals, violations |

### Net Zero Cloud

| Skill | Status | Description |
|---|---|---|
| `industries/net-zero/sustainability-reporting` | 🚧 Planned | Emissions inventory, ESG reporting, audit trail |
| `industries/net-zero/carbon-accounting` | 🚧 Planned | Scope 1/2/3 calculations, reduction targets, offsets |

### Agentforce

| Skill | Status | Description |
|---|---|---|
| `agentforce/agent-design-patterns` | ✅ v1.0 | Topic design, action architecture, guardrail patterns, testing and evaluation |
| `agentforce/topic-and-action-design` | 🚧 Planned | Topic instructions, action types, context management |
| `agentforce/prompt-template-authoring` | 🚧 Planned | Flex templates, merge fields, grounding strategies |
| `agentforce/evaluation-and-testing` | 🚧 Planned | AiEvaluationDefinition, test specs, CI integration |

### Data Cloud

| Skill | Status | Description |
|---|---|---|
| `data-cloud/ingestion-and-streaming` | 🚧 Planned | Connectors, streaming API, batch ingestion, transforms |
| `data-cloud/identity-resolution` | 🚧 Planned | Matching rules, reconciliation, unified individual |
| `data-cloud/segmentation` | 🚧 Planned | Segment builder, calculated insights, activation |
| `data-cloud/activation` | 🚧 Planned | Activation targets, Marketing Cloud, CRM activation |

---

## Plugins (MCP Servers)

> ⚠️ Plugins give the AI agent live Salesforce org access. Read [PLUGIN-SECURITY.md](plugins/PLUGIN-SECURITY.md) before using any plugin.

| Plugin | Scope | Description |
|---|---|---|
| `org-inspector` | Read-only | Object/field describe, metadata discovery, permission inspection |
| `soql-runner` | Read-only | Query execution with governor-limit guardrails |
| `metadata-deployer` | Read (default) / Write (explicit) | `sf project deploy` wrapper; `--checkonly` by default |
| `data-cloud-query` | Read-only | Data Cloud SQL API execution |

---

## Agentforce Agent Definitions

Agentforce agents deployed *into* Salesforce. These are `.agent` files + topic definitions + action configurations.

| Agent | Description |
|---|---|
| `claims-triage` | Routes and scores incoming claims; orders STP check or adjuster assignment |
| `developer-assistant` | Answers Salesforce dev questions, runs SOQL, explains debug logs |
| `onboarding-guide` | Guides new developers through org setup and coding standards |

---

## Installation

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, and Continue.

```bash
# Claude Code
npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent claude-code -y

# Cursor
npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent cursor -y

# Windsurf
npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent windsurf -y

# GitHub Copilot
npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent copilot -y

# Cline / Roo
npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent cline -y

# List installed skills
npx @skillforge/skills list
```

> **Note:** The `@skillforge/skills` CLI is pending internal approval before publishing to npm.
> Until then, add the skill manually — see the [wiki](https://github.com/mdevaraju-architect/skillforge/wiki) for agent-specific instructions.

---

## Governance

Enterprise adoption requires more than a skills library. See [`governance/`](governance/) for:

- [Skill Manifest Schema](governance/skill-manifest-schema.json) — machine-readable skill metadata
- [Approval Tiers](governance/approval-tiers.md) — Draft → Reviewed → Certified → Deprecated
- [Compliance Matrix](governance/compliance-matrix.md) — skill × regulation coverage map
- [Adoption Playbook](governance/adoption-playbook.md) — how to fork, customise, gate, and train
- [API Version Matrix](governance/api-version-matrix.md) — skill × Salesforce release compatibility

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every skill needs: a `SKILL.md` routing layer, architecture reference, object reference, scripts, and ≥10 evals. Quality bar is production-enterprise — not tutorial-grade.

## License

MIT
