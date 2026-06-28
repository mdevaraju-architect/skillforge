# Enterprise Adoption Playbook

This playbook covers how an enterprise team forks, customises, governs, and trains on this skill library.

---

## Stage 1: Fork and baseline

### 1.1 Fork the repository

```bash
# Fork via GitHub UI, then clone your fork
git clone https://github.com/<your-org>/salesforce-agent-skills.git
cd salesforce-agent-skills
git remote add upstream https://github.com/mdevaraju-architect/salesforce-agent-skills.git
```

### 1.2 Establish your baseline

Decide which skills your team will use in production. Start with the smallest set and expand. A skill library that covers everything but that no one trusts is worse than a narrow, deeply validated set.

Recommended starting set for an FSC/Insurance implementation team:
- `industries/fsc/claims-process` (v1.0, certified required before production)

For a general Salesforce team:
- `platform/bulk-data-processing` (when available)
- `platform/devops-and-deployment` (when available)

### 1.3 Pin versions

Your enterprise fork should pin specific versions of each skill. Skills are versioned in `skill-manifest.json`. Create a `pinned-versions.json` at the repo root:

```json
{
  "pins": [
    {
      "skill": "fsc-claims-process",
      "version": "1.0.0",
      "approved-for": ["sandbox", "uat", "production"],
      "approved-by": "<your-lead>",
      "approved-date": "2026-06-27"
    }
  ]
}
```

---

## Stage 2: Customise for your org

### 2.1 Extend, do not modify upstream files

Create org-specific reference files alongside the upstream ones. For example:

```
skills/industries/fsc/claims-process/
├── SKILL.md                          ← upstream (do not edit)
├── references/                        ← upstream
└── org-extensions/
    ├── 01-custom-claim-types.md       ← your org's custom claim types
    ├── 02-integration-endpoints.md    ← your org's named credentials and endpoints
    └── 03-org-specific-config.md      ← your custom metadata values, queue names, etc.
```

Add an `org-extensions` section to your local SKILL.md override (or add it as a post-install hook) that directs the agent to also load files from `org-extensions/`.

### 2.2 Add org-specific evals

Append to `evals/evals.json` with scenarios specific to your org's custom objects, flows, and integration patterns. Name them with your org prefix: `org-custom-claim-intake-validation`.

### 2.3 Update `skill-manifest.json` for your org

If your org runs an older API version, update `api-version-min`. If you've completed a compliance review for your org's regulatory context, update `approval-tier` and add the review log to your local `compliance-matrix.md`.

---

## Stage 3: Governance gate

### 3.1 Define your internal approval tiers

The upstream tiers (draft / reviewed / certified / deprecated) are the baseline. Enterprises typically add:

- **org-validated**: the skill has been tested in your specific org configuration
- **production-approved**: the skill has been approved by your architecture review board for production use

Document these extensions in your fork's `governance/approval-tiers.md`.

### 3.2 Set up CODEOWNERS

Your fork's `.github/CODEOWNERS` should require architecture review board approval for any skill promotion to `production-approved`:

```
# All skill manifest files require architect approval
skills/**/skill-manifest.json @your-org/architects

# Governance docs require lead approval
governance/ @your-org/platform-lead
```

### 3.3 Connect CI to your org

The `run-evals.yml` workflow can be extended to run against a real scratch org or developer sandbox. Add the following secrets to your fork:

- `SALESFORCE_AUTH_URL` — SFDX auth URL for your CI org
- `SALESFORCE_API_VERSION` — target API version

### 3.4 Create an internal skill registry

Maintain a `registry/` directory in your fork that maps each approved skill to:
- The team(s) that may use it
- The org environments it is approved for
- The review chain that approved it
- The date of approval and next review date

---

## Stage 4: Train your team

### 4.1 Skill installation

Distribute a standard install command for your team:

```bash
# Install your org's approved skill set
npx skills add <your-org>/salesforce-agent-skills --skill '*' --agent claude-code -y
```

Optionally, publish your fork as an npm package and instruct teams to install via package.json rather than npx.

### 4.2 Skill usage guidelines

Publish internal guidelines covering:
- When to load a skill: load the relevant skill at the start of a work session in that domain.
- What the skill does and does not cover: each skill's `SKILL.md` has an explicit `NOT covered` section. Trust it.
- Escalation: if an agent gives guidance that conflicts with a skill's boundary statement, escalate to the maintainer.
- Feedback loop: teams that find an error in a skill should file a GitHub issue against the upstream repo. Errors in org-extension files should be filed internally.

### 4.3 Feedback loop

Establish a monthly skill review cadence:
1. Collect feedback from practitioners (what was wrong, what was missing).
2. Triage: upstream bug → PR to upstream; org-specific gap → add to org-extensions.
3. Update `approval-tier` and revalidate evals after any substantive change.

---

## Stage 5: Sync with upstream

```bash
# Pull upstream changes
git fetch upstream
git checkout main
git merge upstream/main

# Review skill manifest changes for version bumps
git diff upstream/main -- '**/skill-manifest.json'

# Re-run your org's validation after sync
npm run validate
npm run test:evals
```

After any upstream sync, re-validate that pinned versions still match and that no upstream changes break your org-extension files.
