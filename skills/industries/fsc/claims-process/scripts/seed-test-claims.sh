#!/usr/bin/env bash
# Seed a sandbox with a minimal but complete set of test claims covering all statuses,
# claim types, and lifecycle states. Useful for smoke-testing new deployments.
# Usage: ./seed-test-claims.sh --target-org <alias>
# WARNING: This creates real records. Only run in sandbox/scratch orgs.
set -euo pipefail

TARGET_ORG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-org) TARGET_ORG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --target-org <alias>"
      echo "WARNING: Creates test records. Use in sandbox or scratch orgs only."
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -z "$TARGET_ORG" ]] && { echo "Error: --target-org required"; exit 1; }

echo "WARNING: This will create test Claim records in org: $TARGET_ORG"
read -r -p "Continue? (yes/no): " CONFIRM
[[ "$CONFIRM" != "yes" ]] && { echo "Aborted."; exit 0; }

run_soql() { sf data query --query "$1" --target-org "$TARGET_ORG" --result-format csv 2>/dev/null; }
create_record() { sf data create record --sobject "$1" --values "$2" --target-org "$TARGET_ORG" --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['id'] if d.get('result') else '')"; }

echo ""
echo "Step 1: Fetching or creating test Contact (claimant)..."
CONTACT_ID=$(run_soql "SELECT Id FROM Contact WHERE LastName = 'ClaimsTestUser' LIMIT 1" | tail -1 | tr -d '"')
if [[ -z "$CONTACT_ID" || "$CONTACT_ID" == "Id" ]]; then
  CONTACT_ID=$(create_record "Contact" "FirstName='Claims' LastName='ClaimsTestUser' Email='claims.test@example.com'")
  echo "  Created Contact: $CONTACT_ID"
else
  echo "  Using existing Contact: $CONTACT_ID"
fi

echo ""
echo "Step 2: Fetching a test InsurancePolicy..."
POLICY_ID=$(run_soql "SELECT Id FROM InsurancePolicy WHERE Status = 'Active' LIMIT 1" | tail -1 | tr -d '"')
if [[ -z "$POLICY_ID" || "$POLICY_ID" == "Id" ]]; then
  echo "  No active InsurancePolicy found."
  echo "  Please create an InsurancePolicy manually or via your FNOL OmniScript, then re-run this script."
  echo "  Seed aborted — InsurancePolicy is required."
  exit 1
fi
echo "  Using InsurancePolicy: $POLICY_ID"

echo ""
echo "Step 3: Fetching InsurancePolicyCoverage..."
COVERAGE_ID=$(run_soql "SELECT Id FROM InsurancePolicyCoverage WHERE InsurancePolicyId = '${POLICY_ID}' AND Status = 'Active' LIMIT 1" | tail -1 | tr -d '"')
if [[ -z "$COVERAGE_ID" || "$COVERAGE_ID" == "Id" ]]; then
  echo "  No active InsurancePolicyCoverage found for this policy. Seed aborted."
  exit 1
fi
echo "  Using Coverage: $COVERAGE_ID"

echo ""
echo "Step 4: Creating test Claims..."

declare -A CLAIMS

# Claim 1: New status (just filed)
C1=$(create_record "Claim" "InsurancePolicyId='${POLICY_ID}' DateOfLoss=2026-06-01 LossType='AutoCollision' LossDescription='Test auto collision - rear-end on highway' Status='New' LossAmount=3500 ClaimChannel='Web'")
CLAIMS["New"]=$C1
echo "  New Claim: $C1"

# Claim 2: Open (assigned to adjuster)
C2=$(create_record "Claim" "InsurancePolicyId='${POLICY_ID}' DateOfLoss=2026-05-15 LossType='PropertyDwelling' LossDescription='Test property water damage - kitchen leak' Status='Open' LossAmount=12000 ClaimChannel='Phone'")
CLAIMS["Open"]=$C2
echo "  Open Claim: $C2"

# Claim 3: In Review
C3=$(create_record "Claim" "InsurancePolicyId='${POLICY_ID}' DateOfLoss=2026-04-10 LossType='AutoCollision' LossDescription='Test auto claim under investigation' Status='In Review' LossAmount=8500 ClaimChannel='Agent'")
CLAIMS["InReview"]=$C3
echo "  In Review Claim: $C3"

# Claim 4: Closed
C4=$(create_record "Claim" "InsurancePolicyId='${POLICY_ID}' DateOfLoss=2026-03-01 LossType='PropertyContents' LossDescription='Test contents claim - fully settled' Status='Closed' LossAmount=2200 ClaimChannel='Web'")
CLAIMS["Closed"]=$C4
echo "  Closed Claim: $C4"

# Claim 5: Denied
C5=$(create_record "Claim" "InsurancePolicyId='${POLICY_ID}' DateOfLoss=2026-02-14 LossType='AutoLiability' LossDescription='Test denied claim - no coverage' Status='Denied' LossAmount=500 ClaimChannel='Phone'")
CLAIMS["Denied"]=$C5
echo "  Denied Claim: $C5"

echo ""
echo "Step 5: Creating ClaimParticipants..."
for STATUS in New Open InReview Closed Denied; do
  CID="${CLAIMS[$STATUS]}"
  create_record "ClaimParticipant" "ClaimId='${CID}' Role='Claimant' ParticipantId='${CONTACT_ID}' IsPrimary=true" > /dev/null
done
echo "  ClaimParticipant (Claimant) created for all 5 claims."

echo ""
echo "Step 6: Creating ClaimCoverages..."
for STATUS in New Open InReview Closed Denied; do
  CID="${CLAIMS[$STATUS]}"
  create_record "ClaimCoverage" "ClaimId='${CID}' InsurancePolicyCoverageId='${COVERAGE_ID}'" > /dev/null
done
echo "  ClaimCoverage created for all 5 claims."

echo ""
echo "====== SEED COMPLETE ======"
echo "Claims created:"
for STATUS in New Open InReview Closed Denied; do
  echo "  $STATUS: ${CLAIMS[$STATUS]}"
done
echo ""
echo "Run ./query-claim-lifecycle.sh --target-org ${TARGET_ORG} --claim-id <Id> to inspect any claim."
