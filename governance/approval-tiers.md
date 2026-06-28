# Skill Approval Tiers

Skills in this repository go through a four-stage governance lifecycle. The current tier is declared in `skill-manifest.json` and in the `SKILL.md` frontmatter. CI blocks promotion if requirements are not met.

---

## Tiers

### Draft

- **Who can set:** The author, on any new skill.
- **What it means:** The author has written and locally tested the skill. No peer review has occurred. Do not install in production.
- **Required artefacts:** `SKILL.md` with valid frontmatter, `skill-manifest.json`, at least `01-architecture.md`, 5 or more evals.
- **Safe environments:** Scratch orgs, personal developer orgs only.

### Reviewed

- **Who can promote:** 2 maintainer approvals on a pull request, plus passing CI.
- **What it means:** At least two independent Salesforce architects or senior developers have verified the skill's accuracy, gotchas, and boundary statements. No known inaccuracies. Safe for team sandbox and UAT environments.
- **Required artefacts:** All `draft` requirements, plus: complete reference file set, 10 or more evals (each with `must_not_contain`), all scripts executable with `--help`, `skill-manifest.json` valid against schema.
- **CI gates:** `validate-structure.yml`, `run-evals.yml`, `check-api-versions.yml`.
- **Safe environments:** Sandbox, Developer Pro, UAT.

### Certified

- **Who can promote:** Project lead + explicit compliance review sign-off, documented in `governance/compliance-matrix.md`.
- **What it means:** The skill has been validated in a production or production-equivalent environment by the primary domain expert. Compliance review confirms it does not give unsafe guidance for the regulations declared in `skill-manifest.json`. Suitable for enterprise production deployment.
- **Required artefacts:** All `reviewed` requirements, plus: compliance review entry in `compliance-matrix.md`, changelog entry in `skill-manifest.json`, at least one named enterprise reference customer (internal record only — not public).
- **CI gates:** All `reviewed` gates plus `security-scan.yml`.
- **Safe environments:** All org types including production.

### Deprecated

- **Who can set:** Any maintainer.
- **What it means:** The skill has been superseded by a newer version, found to contain significant inaccuracies, or the underlying Salesforce feature has changed materially. Do not install.
- **Required action:** The `SKILL.md` must contain a `deprecated-by:` frontmatter field pointing to the replacement, or a `deprecation-reason:` if no replacement exists.
- **Safe environments:** None. Remove from any environment where it is installed.

---

## Promotion process

```
Draft → Reviewed
  1. Author opens PR with "promote: reviewed" label
  2. Two maintainers review against the Reviewed checklist
  3. CI must pass all gates
  4. Squash-merge; version bump to next minor (e.g. 1.0.0 → 1.1.0)

Reviewed → Certified
  1. Author opens PR with "promote: certified" label
  2. Project lead performs compliance review; adds row to compliance-matrix.md
  3. security-scan.yml must pass
  4. Squash-merge; version bump to next major (e.g. 1.1.0 → 2.0.0)

Any tier → Deprecated
  1. Author or maintainer opens PR adding deprecation fields to SKILL.md and manifest
  2. Single maintainer approval sufficient
  3. Skill is moved from skills table to a "Deprecated" section in README.md
```

---

## Enforcement

The `check-api-versions.yml` workflow rejects any PR that:
- Declares `approval-tier: reviewed` or higher without the required artefact count
- Bumps a skill from `draft` to `reviewed` without 2 PR approvals (enforced via `CODEOWNERS`)
- Declares a regulation in `compliance.regulations` without a corresponding row in `compliance-matrix.md`
