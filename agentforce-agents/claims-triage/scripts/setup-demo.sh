#!/bin/bash
# =============================================================================
# KnowledgeForce FSC Claims Demo — One-Command Org Setup
# Replicates the full Claims demo in any FSC-enabled Salesforce org.
#
# Usage:
#   ./setup-demo.sh --target-org <alias>
#   ./setup-demo.sh --target-org <alias> --claimant-name "Jane Demo"
#   ./setup-demo.sh --help
# =============================================================================

set -euo pipefail

# ---------- defaults ---------------------------------------------------------
TARGET_ORG=""
CLAIMANT_FIRST="Jane"
CLAIMANT_LAST="Demo"
CLAIM_NAME="FNOL-DEMO-001"
SKIP_SKILL=false
SKIP_PROMPT=false

# ---------- colours ----------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC}  $1"; }
fail() { echo -e "${RED}✗${NC}  $1"; exit 1; }
info() { echo -e "${CYAN}→${NC}  $1"; }
warn() { echo -e "${YELLOW}⚠${NC}   $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; echo "$(printf '─%.0s' {1..60})"; }

# ---------- help -------------------------------------------------------------
usage() {
  cat <<EOF

${BOLD}KnowledgeForce FSC Claims Demo Setup${NC}

Sets up the full FSC Claims proof of concept in any FSC-enabled Salesforce org:
  1. Verifies FSC prerequisites
  2. Seeds FNOL Claim + Person Account + ClaimParticipant
  3. Deploys the Claims_Implementation_Guide GenAiPromptTemplate
  4. Installs the fsc-claims-process skill into Claude Code

${BOLD}Usage:${NC}
  $0 --target-org <org-alias-or-username>  [options]

${BOLD}Options:${NC}
  --target-org       <alias>    Salesforce org alias (required)
  --claimant-name    <name>     Claimant full name, default: "Jane Demo"
  --claim-name       <name>     Claim name, default: FNOL-DEMO-001
  --skip-skill                  Skip Claude Code skill installation
  --skip-prompt                 Skip GenAiPromptTemplate deployment
  --help                        Show this help

${BOLD}Examples:${NC}
  $0 --target-org my-fsc-sandbox
  $0 --target-org my-fsc-sandbox --claimant-name "Priya Sharma"
  $0 --target-org my-fsc-sandbox --skip-skill

EOF
  exit 0
}

# ---------- parse args -------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-org)      TARGET_ORG="$2";                    shift 2 ;;
    --claimant-name)   CLAIMANT_FIRST="${2%% *}";
                       CLAIMANT_LAST="${2#* }";             shift 2 ;;
    --claim-name)      CLAIM_NAME="$2";                    shift 2 ;;
    --skip-skill)      SKIP_SKILL=true;                    shift   ;;
    --skip-prompt)     SKIP_PROMPT=true;                   shift   ;;
    --help|-h)         usage ;;
    *)                 fail "Unknown argument: $1. Run --help for usage." ;;
  esac
done

[[ -z "$TARGET_ORG" ]] && fail "Missing --target-org. Run $0 --help for usage."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TODAY=$(date +"%Y-%m-%d")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# =============================================================================
header "STEP 1 — Verifying prerequisites"
# =============================================================================

info "Checking Salesforce CLI..."
sf --version &>/dev/null || fail "Salesforce CLI not found. Install: npm install -g @salesforce/cli"
pass "Salesforce CLI found"

info "Checking org connection: $TARGET_ORG"
sf org display --target-org "$TARGET_ORG" &>/dev/null || \
  fail "Cannot connect to org '$TARGET_ORG'. Run: sf org login web --alias $TARGET_ORG"
pass "Org connected: $TARGET_ORG"

info "Checking FSC Insurance (Claim object)..."
CLAIM_CHECK=$(sf data query \
  --query "SELECT Id FROM Claim LIMIT 1" \
  --target-org "$TARGET_ORG" --json 2>&1)
if echo "$CLAIM_CHECK" | grep -q "sObject type"; then
  fail "FSC Insurance is not enabled in '$TARGET_ORG'. Enable it in Setup → Insurance Settings before running this script."
fi
pass "FSC Insurance enabled"

info "Checking Person Account record type..."
PA_RT=$(sf data query \
  --query "SELECT Id FROM RecordType WHERE SobjectType='Account' AND IsPersonType=true LIMIT 1" \
  --target-org "$TARGET_ORG" --json 2>/dev/null | \
  python3 -c "import json,sys; recs=json.load(sys.stdin).get('result',{}).get('records',[]); print(recs[0]['Id'] if recs else '')" 2>/dev/null)
[[ -z "$PA_RT" ]] && fail "Person Account record type not found. Enable Person Accounts in Setup → Account Settings."
pass "Person Account record type: $PA_RT"

# =============================================================================
header "STEP 2 — Seeding FNOL test data"
# =============================================================================

# Check if claim already exists
EXISTING=$(sf data query \
  --query "SELECT Id FROM Claim WHERE Name='$CLAIM_NAME' LIMIT 1" \
  --target-org "$TARGET_ORG" --json 2>/dev/null | \
  python3 -c "import json,sys; recs=json.load(sys.stdin).get('result',{}).get('records',[]); print(recs[0]['Id'] if recs else '')" 2>/dev/null)

if [[ -n "$EXISTING" ]]; then
  warn "Claim '$CLAIM_NAME' already exists ($EXISTING) — skipping claim creation."
  CLAIM_ID="$EXISTING"
else
  info "Creating Claim: $CLAIM_NAME..."
  CLAIM_RESULT=$(sf data create record \
    --sobject Claim \
    --values "Name='$CLAIM_NAME' Status='Notified' ClaimType='Auto' LossType='Partial Loss' ClaimReasonType='Accident' ClaimReason='Vehicle rear-end collision. Minor rear bumper damage. No injuries reported.' Summary='KnowledgeForce demo FNOL. Auto claim. Claimant: $CLAIMANT_FIRST $CLAIMANT_LAST. Setup by setup-demo.sh.' FnolChannel='Web' Severity='Medium' LossDate='${NOW}' InitiationDate='${NOW}' ClaimLossDate='${TODAY}' ReportDate='${NOW}' IncidentSiteCity='Chicago' IncidentSiteState='IL' IncidentSiteCountry='US' IsAuthoritiesNotified=false IsDrivable=true" \
    --target-org "$TARGET_ORG" --json 2>/dev/null)
  CLAIM_ID=$(echo "$CLAIM_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
  [[ -z "$CLAIM_ID" ]] && fail "Failed to create Claim. Check org permissions."
  pass "Claim created: $CLAIM_ID"
fi

# Check if Person Account already exists
EXISTING_ACC=$(sf data query \
  --query "SELECT Id, PersonContactId FROM Account WHERE FirstName='$CLAIMANT_FIRST' AND LastName='$CLAIMANT_LAST' AND IsPersonAccount=true LIMIT 1" \
  --target-org "$TARGET_ORG" --json 2>/dev/null | \
  python3 -c "import json,sys; recs=json.load(sys.stdin).get('result',{}).get('records',[]); print(recs[0]['Id']+'|'+recs[0]['PersonContactId'] if recs else '')" 2>/dev/null)

if [[ -n "$EXISTING_ACC" ]]; then
  ACCOUNT_ID="${EXISTING_ACC%|*}"
  CONTACT_ID="${EXISTING_ACC#*|}"
  warn "Person Account '$CLAIMANT_FIRST $CLAIMANT_LAST' already exists ($ACCOUNT_ID) — reusing."
else
  info "Creating Person Account: $CLAIMANT_FIRST $CLAIMANT_LAST..."
  ACC_RESULT=$(sf data create record \
    --sobject Account \
    --values "FirstName='$CLAIMANT_FIRST' LastName='$CLAIMANT_LAST' RecordTypeId='$PA_RT' Phone='312-555-0199' PersonEmail='${CLAIMANT_FIRST,,}.${CLAIMANT_LAST,,}@skillforge-demo.example.com' BillingStreet='456 Demo Avenue' BillingCity='Chicago' BillingState='IL' BillingPostalCode='60601' BillingCountry='US'" \
    --target-org "$TARGET_ORG" --json 2>/dev/null)
  ACCOUNT_ID=$(echo "$ACC_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
  [[ -z "$ACCOUNT_ID" ]] && fail "Failed to create Person Account."
  pass "Person Account created: $ACCOUNT_ID"

  CONTACT_ID=$(sf data query \
    --query "SELECT PersonContactId FROM Account WHERE Id='$ACCOUNT_ID'" \
    --target-org "$TARGET_ORG" --json 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['result']['records'][0]['PersonContactId'])" 2>/dev/null)
  [[ -z "$CONTACT_ID" ]] && fail "Could not retrieve PersonContactId."
  pass "Contact retrieved: $CONTACT_ID"
fi

# Create ClaimParticipant
EXISTING_CP=$(sf data query \
  --query "SELECT Id FROM ClaimParticipant WHERE ClaimId='$CLAIM_ID' AND ParticipantAccountId='$ACCOUNT_ID' LIMIT 1" \
  --target-org "$TARGET_ORG" --json 2>/dev/null | \
  python3 -c "import json,sys; recs=json.load(sys.stdin).get('result',{}).get('records',[]); print(recs[0]['Id'] if recs else '')" 2>/dev/null)

if [[ -n "$EXISTING_CP" ]]; then
  warn "ClaimParticipant already exists ($EXISTING_CP) — skipping."
  CP_ID="$EXISTING_CP"
else
  info "Creating ClaimParticipant (Claimant)..."
  CP_RESULT=$(sf data create record \
    --sobject ClaimParticipant \
    --values "ClaimId='$CLAIM_ID' Roles='Claimant' IsInjured=false ParticipantAccountId='$ACCOUNT_ID' ParticipantContactId='$CONTACT_ID'" \
    --target-org "$TARGET_ORG" --json 2>/dev/null)
  CP_ID=$(echo "$CP_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
  [[ -z "$CP_ID" ]] && fail "Failed to create ClaimParticipant."
  pass "ClaimParticipant created: $CP_ID"
fi

# =============================================================================
header "STEP 3 — Deploying Claims_Implementation_Guide prompt template"
# =============================================================================

if [[ "$SKIP_PROMPT" == true ]]; then
  warn "Skipping prompt template deployment (--skip-prompt)"
else
  PROMPT_XML="$REPO_ROOT/agentforce-agents/claims-triage/prompts/Claims_Implementation_Guide.genAiPromptTemplate-meta.xml"
  [[ ! -f "$PROMPT_XML" ]] && fail "Prompt template XML not found at: $PROMPT_XML"

  info "Creating temporary deploy project..."
  DEPLOY_DIR=$(mktemp -d)
  mkdir -p "$DEPLOY_DIR/force-app/main/default/genAiPromptTemplates"
  cp "$PROMPT_XML" "$DEPLOY_DIR/force-app/main/default/genAiPromptTemplates/"
  cat > "$DEPLOY_DIR/sfdx-project.json" <<'SFDX'
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "sourceApiVersion": "63.0"
}
SFDX

  info "Deploying to $TARGET_ORG..."
  DEPLOY_RESULT=$(cd "$DEPLOY_DIR" && sf project deploy start \
    --source-dir force-app/main/default/genAiPromptTemplates \
    --target-org "$TARGET_ORG" \
    --ignore-warnings --json 2>/dev/null)

  DEPLOY_STATUS=$(echo "$DEPLOY_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result',{}).get('status','Failed'))" 2>/dev/null)

  rm -rf "$DEPLOY_DIR"

  if [[ "$DEPLOY_STATUS" == "Succeeded" ]]; then
    pass "Prompt template deployed"
  else
    warn "Prompt template deployment returned: $DEPLOY_STATUS"
    warn "Check Setup → Prompt Builder manually. This is non-blocking."
  fi
fi

# =============================================================================
header "STEP 4 — Installing fsc-claims-process skill into Claude Code"
# =============================================================================

if [[ "$SKIP_SKILL" == true ]]; then
  warn "Skipping skill installation (--skip-skill)"
else
  info "Installing fsc-claims-process skill..."
  if npx skills add mdevaraju-architect/skillforge --skill fsc-claims-process --agent claude-code -y 2>/dev/null; then
    pass "Skill installed"
  else
    warn "Skill install failed — npx skills CLI may not be available."
    warn "Install manually: npx skills add mdevaraju-architect/skillforge --skill fsc-claims-process --agent claude-code -y"
  fi
fi

# =============================================================================
header "SETUP COMPLETE"
# =============================================================================

ORG_URL=$(sf org display --target-org "$TARGET_ORG" --json 2>/dev/null | \
  python3 -c "import json,sys; print(json.load(sys.stdin).get('result',{}).get('instanceUrl',''))" 2>/dev/null)

echo ""
echo -e "${BOLD}What was created:${NC}"
echo ""
echo -e "  ${GREEN}Claim${NC}            $CLAIM_NAME  ($CLAIM_ID)"
echo -e "  ${GREEN}Person Account${NC}   $CLAIMANT_FIRST $CLAIMANT_LAST  ($ACCOUNT_ID)"
echo -e "  ${GREEN}ClaimParticipant${NC} Claimant role  ($CP_ID)"
[[ "$SKIP_PROMPT" == false ]] && echo -e "  ${GREEN}Prompt Template${NC}  Claims_Implementation_Guide"
[[ "$SKIP_SKILL" == false ]]  && echo -e "  ${GREEN}Claude Code Skill${NC} fsc-claims-process"
echo ""
echo -e "${BOLD}Open in org:${NC}"
echo "  Claim:   $ORG_URL/lightning/r/Claim/$CLAIM_ID/view"
echo "  Account: $ORG_URL/lightning/r/Account/$ACCOUNT_ID/view"
[[ "$SKIP_PROMPT" == false ]] && echo "  Prompts: $ORG_URL/lightning/setup/PromptBuilder/home"
echo ""
echo -e "${BOLD}Next step in the claims lifecycle:${NC}"
echo "  Move Status from 'Notified' → 'Open', assign to a claims queue."
echo "  Or run: sf data update record --sobject Claim --record-id $CLAIM_ID --values \"Status='Open'\" --target-org $TARGET_ORG"
echo ""
