# Claims Triage — Org Setup Runbook

How to replicate the full KnowledgeForce FSC Claims demo in any FSC-enabled org in under 30 minutes.

## Prerequisites

| Requirement | Verify with |
|---|---|
| FSC Insurance enabled | `sf data query --query "SELECT Id FROM Claim LIMIT 1" --target-org <alias>` — must return rows or 0 records, not an error |
| OmniStudio installed | Setup → Installed Packages → OmniStudio |
| Salesforce CLI authenticated | `sf org display --target-org <alias>` |
| GitHub access to SkillForge | `gh repo view mdevaraju-architect/skillforge` |

---

## Step 1 — Install the FSC Claims skill into Claude Code

```bash
npx skills add mdevaraju-architect/skillforge --skill fsc-claims-process --agent claude-code -y
```

This loads the full claims domain knowledge into your Claude Code agent — FNOL intake, adjudication, fraud/STP, reserves, payments, OmniStudio patterns, data migration, and 12 reference files.

Verify: open Claude Code and ask *"What are the required fields for a Claim FNOL in FSC?"* — the agent should answer from the skill without hallucinating.

---

## Step 2 — Seed test data (FNOL + Person Account + ClaimParticipant)

```bash
# Authenticate your org
sf org login web --alias <your-org-alias> --set-default

# Create FNOL Claim
sf data create record --sobject Claim --values "
  Name='FNOL-DEMO-001'
  Status='Notified'
  ClaimType='Auto'
  LossType='Partial Loss'
  ClaimReasonType='Accident'
  ClaimReason='Vehicle rear-end collision. Minor rear bumper damage. No injuries.'
  Summary='KnowledgeForce demo FNOL. Auto claim. Claimant: Jane Demo.'
  FnolChannel='Web'
  Severity='Medium'
  LossDate=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  InitiationDate=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  ClaimLossDate=$(date +"%Y-%m-%d")
  ReportDate=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  IncidentSiteCity='Chicago'
  IncidentSiteState='IL'
  IncidentSiteCountry='US'
  IsAuthoritiesNotified=false
  IsDrivable=true
" --target-org <your-org-alias> --json

# Note the Claim Id from the output above, then:
CLAIM_ID=<id-from-above>

# Create Person Account for claimant
sf data create record --sobject Account --values "
  FirstName='Jane'
  LastName='Demo'
  RecordTypeId=$(sf data query --query "SELECT Id FROM RecordType WHERE SobjectType='Account' AND IsPersonType=true LIMIT 1" --target-org <your-org-alias> --json | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['records'][0]['Id'])")
  Phone='312-555-0199'
  PersonEmail='jane.demo@skillforge-demo.example.com'
  BillingStreet='456 Demo Avenue'
  BillingCity='Chicago'
  BillingState='IL'
  BillingPostalCode='60601'
  BillingCountry='US'
" --target-org <your-org-alias> --json

# Note the Account Id, then get PersonContactId:
ACCOUNT_ID=<id-from-above>
CONTACT_ID=$(sf data query --query "SELECT PersonContactId FROM Account WHERE Id='$ACCOUNT_ID'" --target-org <your-org-alias> --json | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['records'][0]['PersonContactId'])")

# Create ClaimParticipant linking claim to person
sf data create record --sobject ClaimParticipant --values "
  ClaimId='$CLAIM_ID'
  Roles='Claimant'
  IsInjured=false
  ParticipantAccountId='$ACCOUNT_ID'
  ParticipantContactId='$CONTACT_ID'
" --target-org <your-org-alias>
```

---

## Step 3 — Deploy the Claims Implementation Guide prompt template

```bash
# Clone the SkillForge repo
git clone https://github.com/mdevaraju-architect/skillforge.git
cd skillforge

# The prompt template deploy package is at:
ls agentforce-agents/claims-triage/prompts/

# Copy the GenAiPromptTemplate into a deploy project
mkdir -p /tmp/claims-prompt-deploy/force-app/main/default/genAiPromptTemplates

cp agentforce-agents/claims-triage/prompts/Claims_Implementation_Guide.genAiPromptTemplate-meta.xml \
   /tmp/claims-prompt-deploy/force-app/main/default/genAiPromptTemplates/

# Create sfdx-project.json
cat > /tmp/claims-prompt-deploy/sfdx-project.json <<'EOF'
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "sourceApiVersion": "63.0"
}
EOF

# Deploy
cd /tmp/claims-prompt-deploy
sf project deploy start \
  --source-dir force-app/main/default/genAiPromptTemplates \
  --target-org <your-org-alias> \
  --ignore-warnings
```

Activate in the org: **Setup → Prompt Builder → Claims Implementation Guide → Activate**

---

## Step 4 — Verify end to end

```bash
# Confirm claim exists
sf data query --query "
  SELECT Id, Name, Status, ClaimType,
         (SELECT Roles, ParticipantAccount.Name FROM ClaimParticipants)
  FROM Claim
  WHERE Name = 'FNOL-DEMO-001'
" --target-org <your-org-alias>

# Confirm prompt template is active
sf data query --query "
  SELECT DeveloperName, MasterLabel
  FROM GenAiPromptTemplate
  WHERE DeveloperName = 'Claims_Implementation_Guide'
" --target-org <your-org-alias>
```

Open the claim in the org and run the prompt template from the record page to see the AI-generated claims summary.

---

## What you now have

| Artefact | What it proves |
|---|---|
| FNOL claim + Person Account + ClaimParticipant | FSC data model working end to end |
| `fsc-claims-process` skill in Claude Code | Agent knows the full claims domain |
| `Claims_Implementation_Guide` Prompt Template | AI can summarise a live claim with lifecycle-aware next actions |

This is the KnowledgeForce three-layer stack in one demo: **skill** (domain knowledge) + **prompt template** (live org AI) + **data** (real Salesforce records).
