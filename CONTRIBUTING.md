# Contributing

## Guiding principle

Every skill, plugin, and agent definition in this repo is held to **enterprise production quality** — not tutorial quality. The audience is architects and senior developers building on Salesforce for Fortune 500 and regulated-industry clients. If something wouldn't survive an enterprise architecture review, it doesn't belong here.

---

## Skill structure

Every skill lives at `skills/<domain>/<capability>/` and must contain:

```
skills/<domain>/<capability>/
├── SKILL.md                     # required — routing layer
├── skill-manifest.json          # required — machine-readable metadata
├── references/
│   ├── 01-architecture.md       # required
│   ├── 02-setup-and-permissions.md  # required
│   └── ...                      # additional self-contained references
├── scripts/
│   └── *.sh                     # optional but strongly recommended
└── evals/
    └── evals.json               # required — minimum 10 scenarios
```

### Domain naming

| Domain prefix | Salesforce product area |
|---|---|
| `platform/` | Core Salesforce platform — Apex, LWC, Flows, integrations, DevOps |
| `sales/` | Sales Cloud |
| `service/` | Service Cloud |
| `industries/fsc/` | Financial Services Cloud |
| `industries/health-cloud/` | Health Cloud |
| `industries/manufacturing-cloud/` | Manufacturing Cloud |
| `industries/public-sector/` | Public Sector Solutions |
| `industries/net-zero/` | Net Zero Cloud |
| `agentforce/` | Agentforce — agent design, prompt templates, evaluation |
| `data-cloud/` | Salesforce Data Cloud |

### `SKILL.md` frontmatter

```yaml
---
name: <domain>-<capability>         # globally unique; used as install key
description: >-
  Trigger description: list every object, field, method, or keyword
  that should cause an agent to load this skill. Be exhaustive.
  Include API names, not just human labels.
compliance:
  regulations: []                   # e.g. ["FINRA","HIPAA","GDPR","FedRAMP"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "none"          # none | internal | confidential | restricted
license: MIT
metadata:
  author: <github-handle>
  version: 1.0.0
  domain: <salesforce-domain>
  module: <capability>
  api-version-min: "60.0"
  salesforce-release-min: "Winter25"
  approval-tier: "draft"            # draft | reviewed | certified
---
```

### `skill-manifest.json`

Machine-readable metadata consumed by governance tooling:

```json
{
  "name": "fsc-claims-process",
  "version": "1.0.0",
  "domain": "industries/fsc",
  "capability": "claims-process",
  "api-version-min": "60.0",
  "salesforce-release-min": "Winter25",
  "approval-tier": "draft",
  "compliance": {
    "regulations": ["FINRA", "SOC2"],
    "org-types": ["scratch", "sandbox", "uat", "production"],
    "data-sensitivity": "restricted"
  },
  "requires-features": ["FSCInsurance", "OmniStudio"],
  "boundary": ["Health Cloud CarePlan", "Revenue Cloud pricing", "FSC Wealth/Banking"],
  "maintainers": ["mdevaraju-architect"]
}
```

### Quality bar for `SKILL.md`

- **Gotchas**: minimum 10. Each must be a concrete, actionable fact — not advice. If a senior developer could make the mistake without the gotcha, it belongs.
- **Reference files**: each must be fully self-contained. An agent reading only that file must answer questions in that area correctly without needing the SKILL.md.
- **Boundary statement**: explicit list of adjacent domains the skill does NOT cover. If the user crosses into them, the skill tells the agent to stop.
- **Workflows**: minimum 3 named end-to-end workflows with numbered steps.
- **Compliance notes**: if the skill touches regulated data (PII, PHI, financial records), the SKILL.md must say what it validates and what it explicitly does not validate.

### Scripts

- Every script must accept `--help` and `--target-org`.
- Scripts are read-only by default. Any script that creates or modifies records must print a warning and require `--confirm yes`.
- No hardcoded org IDs, user IDs, or credentials.
- All SOQL uses parameterised values — no string concatenation of user input.

### Evals

Minimum 10 eval scenarios per skill. Each scenario must include:
- `expected_topics` — concepts the response must address
- `must_not_contain` — domain drift guard (e.g., `SBQQ__`, `CarePlan` for FSC skills)
- `compliance_check` — for regulated-industry skills: flag if the response gives unsafe guidance

---

## Plugin structure

Plugins are MCP servers that give the agent live Salesforce org access. They are held to a higher standard than skills.

Every plugin must:
1. Declare its scope in `plugin-manifest.json`: `read-only` or `read-write`.
2. Implement the shared auth module from `plugins/_shared/`.
3. Log every tool invocation to the shared audit module.
4. Default to `--checkonly` / dry-run for any write operation.
5. Enforce governor-limit guards (SOQL row limits, heap thresholds).
6. Never accept raw SOQL string input from the agent without a parameterised allowlist.
7. Include a `PLUGIN-SECURITY.md` documenting: scope, auth model, audit behaviour, what it will refuse to do.

---

## Agentforce agent structure

Agentforce agents in `agentforce-agents/` are `.agent` files deployed into Salesforce. Every agent definition must include:
- `agent.yaml` — agent spec: name, description, topics, system prompt
- `topics/` — one `.yaml` per topic
- `actions/` — referenced Apex, flows, or prompt templates
- `AGENT-DESIGN.md` — design rationale: what problems it solves, what it escalates to a human, what it will refuse to do
- `tests/` — `AiEvaluationDefinition` YAML test specs

---

## Approval tiers

| Tier | Meaning | Who can approve |
|---|---|---|
| `draft` | Author-only testing; do not use in production | Author |
| `reviewed` | Peer-reviewed; safe for sandbox and UAT | 2 maintainers |
| `certified` | Enterprise-validated; production-safe | Project lead + compliance review |
| `deprecated` | Superseded or broken; do not use | Any maintainer |

Skills ship as `draft`. PRs to promote to `reviewed` require 2 maintainer approvals and passing CI. `certified` requires an explicit compliance review documented in `governance/compliance-matrix.md`.

---

## PR checklist

- [ ] `SKILL.md` has complete frontmatter including `compliance` and `approval-tier: draft`
- [ ] `skill-manifest.json` is present and valid against `governance/skill-manifest-schema.json`
- [ ] `references/01-architecture.md` exists
- [ ] `evals/evals.json` has ≥ 10 scenarios with `must_not_contain`
- [ ] All scripts have `--help` and `--target-org`
- [ ] `README.md` skill table updated
- [ ] No hardcoded org IDs, credentials, or endpoints
- [ ] CI passes (structure validation + eval schema check)
