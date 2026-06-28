# Compliance Matrix

This matrix tracks which skills have been validated against specific regulatory frameworks. A skill declares the regulations it covers in `skill-manifest.json`; this document records the review outcome, reviewer, and date.

Only `certified` skills appear in this matrix. `draft` and `reviewed` skills may claim regulations in their manifest, but those claims are not formally verified until certification.

---

## How to read this table

- **Covered** — the skill's guidance has been reviewed and does not give unsafe or non-compliant advice in this area.
- **Partial** — the skill covers some aspects of this regulation but explicitly excludes others (see notes).
- **Out of scope** — the regulation does not apply to this skill's domain.
- **Not reviewed** — the regulation applies but has not been formally reviewed.

---

## Regulation coverage by skill

| Skill | FINRA | HIPAA | GDPR | FedRAMP | SOC 2 | PCI-DSS | CCPA | SOX |
|---|---|---|---|---|---|---|---|---|
| `industries/fsc/claims-process` | Not reviewed | Out of scope | Not reviewed | Out of scope | Not reviewed | Out of scope | Not reviewed | Out of scope |

> This matrix will be populated as skills reach `certified` tier. Every row in this table must have a corresponding compliance review entry below.

---

## Compliance review log

Each entry records: skill name, regulation, reviewer GitHub handle, review date, outcome, and any caveats or limitations.

_No certified skills yet. First certification pending._

---

## Regulation reference

### FINRA (Financial Industry Regulatory Authority)

Applies to: broker-dealer operations, investment advisory workflows, trade surveillance, customer account management. Skills in `industries/fsc/` that touch brokerage or advisory workflows must be reviewed.

Key risk areas for AI agent skills: giving investment advice, recommending specific securities, customer suitability assessments, order entry.

### HIPAA (Health Insurance Portability and Accountability Act)

Applies to: any skill that touches PHI (protected health information). Skills in `industries/health-cloud/` are always subject to HIPAA review. FSC skills that touch life insurance medical data may also require review.

Key risk areas: queries returning PHI, document handling, audit trail completeness.

### GDPR (General Data Protection Regulation)

Applies to: any skill handling EU resident personal data. Most skills with PII queries require at minimum a GDPR partial review covering: data minimisation in SOQL, right-to-erasure patterns, consent flags.

### SOC 2

Applies to: skills that guide users in building integrations or data pipelines that touch customer data. SOC 2 review focuses on: encryption guidance, access control patterns, audit logging completeness.

### FedRAMP

Applies to: skills used in US federal government deployments. Requires Government Cloud compatibility. Not applicable to most commercial cloud skills.

### PCI-DSS

Applies to: skills that touch payment card data — primarily `service/` or `industries/` skills with payment flows. Not applicable to general CRM or claims skills unless payment card processing is in scope.

### CCPA (California Consumer Privacy Act)

Applies to: skills handling California consumer personal data. Key areas: data subject rights workflows, opt-out mechanisms, data inventory.

### SOX (Sarbanes-Oxley)

Applies to: skills in financial reporting workflows — revenue recognition, close processes, audit trail requirements. Primarily relevant to `sales/revenue-cloud` and `platform/` skills used in financial systems.
