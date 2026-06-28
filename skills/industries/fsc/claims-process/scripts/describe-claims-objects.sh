#!/usr/bin/env bash
# Describe all FSC Claims objects and write schemas to claims-describe/
# Usage: ./describe-claims-objects.sh --target-org <alias>
set -euo pipefail

TARGET_ORG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-org) TARGET_ORG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --target-org <alias>"
      echo "Describes all FSC Claims objects and writes schemas to ./claims-describe/"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TARGET_ORG" ]]; then
  echo "Error: --target-org is required"
  exit 1
fi

OBJECTS=(
  Claim
  ClaimParticipant
  ClaimCoverage
  ClaimItem
  ClaimBuildingItem
  ClaimVehicleItem
  ClaimLifeEventItem
  ClaimPolicyItem
  ClaimReserve
  ClaimPayment
  ClaimAction
  ClaimCase
  ClaimDocument
  AssessmentTask
  AssessmentIndicator
  InsurancePolicy
  InsurancePolicyCoverage
  InsurancePolicyAsset
  InsurancePolicyParticipant
)

mkdir -p claims-describe

for OBJ in "${OBJECTS[@]}"; do
  echo "Describing $OBJ..."
  sf sobject describe \
    --sobject "$OBJ" \
    --target-org "$TARGET_ORG" \
    --json > "claims-describe/${OBJ}.json" 2>/dev/null \
    && echo "  ✓ $OBJ" \
    || echo "  ✗ $OBJ (not found — check API version or license)"
done

echo ""
echo "Schema files written to ./claims-describe/"
echo "Objects not found may require FSC Insurance license or higher API version."
