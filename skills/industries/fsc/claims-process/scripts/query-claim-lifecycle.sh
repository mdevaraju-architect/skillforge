#!/usr/bin/env bash
# Print the full lifecycle of a single claim: record, participants, coverages,
# items, reserves, payments, documents, and action history in chronological order.
# Usage: ./query-claim-lifecycle.sh --target-org <alias> --claim-id <Id|ClaimNumber>
set -euo pipefail

TARGET_ORG=""
CLAIM_REF=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target-org) TARGET_ORG="$2"; shift 2 ;;
    --claim-id)   CLAIM_REF="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --target-org <alias> --claim-id <Id or ClaimNumber>"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -z "$TARGET_ORG" ]] && { echo "Error: --target-org required"; exit 1; }
[[ -z "$CLAIM_REF" ]]  && { echo "Error: --claim-id required"; exit 1; }

run_soql() {
  sf data query --query "$1" --target-org "$TARGET_ORG" --result-format human 2>/dev/null \
    || echo "(no records)"
}

echo "====== CLAIM ======"
run_soql "SELECT Id, ClaimNumber, Status, LossType, DateOfLoss, LossAmount, LossDescription, InsurancePolicyId FROM Claim WHERE Id = '${CLAIM_REF}' OR ClaimNumber = '${CLAIM_REF}'"

echo ""
echo "====== PARTICIPANTS ======"
run_soql "SELECT Role, ParticipantId, IsPrimary FROM ClaimParticipant WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}' ORDER BY Role"

echo ""
echo "====== COVERAGES + RESERVES ======"
run_soql "SELECT CoverageType, CoverageLimit, Deductible, (SELECT ReserveType, ReserveAmount, Status FROM ClaimReserves) FROM ClaimCoverage WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}'"

echo ""
echo "====== CLAIM ITEMS ======"
run_soql "SELECT LossType, DamageType, DamageAmount, Status, Description FROM ClaimItem WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}'"

echo ""
echo "====== PAYMENTS ======"
run_soql "SELECT Amount, PaymentMethod, PaymentStatus, PaymentDate, PaymentReference FROM ClaimPayment WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}' ORDER BY PaymentDate ASC"

echo ""
echo "====== DOCUMENTS ======"
run_soql "SELECT DocumentType, Status, IsRequired, ReceivedDate FROM ClaimDocument WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}'"

echo ""
echo "====== ACTION HISTORY (chronological) ======"
run_soql "SELECT ActionType, ActionDate, ActorId, ActionNotes FROM ClaimAction WHERE Claim.ClaimNumber = '${CLAIM_REF}' OR ClaimId = '${CLAIM_REF}' ORDER BY ActionDate ASC"
