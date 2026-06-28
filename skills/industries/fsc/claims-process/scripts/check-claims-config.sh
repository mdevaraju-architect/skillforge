#!/usr/bin/env bash
# Validate FSC Claims org configuration: license, permission sets, queues,
# OmniStudio version, Named Credentials, and Custom Metadata records.
# Usage: ./check-claims-config.sh --target-org <alias>
set -euo pipefail

TARGET_ORG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-org) TARGET_ORG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --target-org <alias>"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -z "$TARGET_ORG" ]] && { echo "Error: --target-org required"; exit 1; }

run_soql() { sf data query --query "$1" --target-org "$TARGET_ORG" --result-format human 2>/dev/null || echo "(query failed)"; }

echo "====== INSTALLED PACKAGES ======"
run_soql "SELECT SubscriberPackageName, SubscriberPackageVersionNumber FROM InstalledSubscriberPackage ORDER BY SubscriberPackageName" 2>/dev/null || echo "Check manually in Setup > Installed Packages"

echo ""
echo "====== PERMISSION SETS (Claims-related) ======"
run_soql "SELECT Name, Label FROM PermissionSet WHERE Name LIKE '%FSC%' OR Name LIKE '%Claims%' OR Name LIKE '%OmniStudio%' ORDER BY Name"

echo ""
echo "====== QUEUES (Claims) ======"
run_soql "SELECT Name, DeveloperName FROM Group WHERE Type = 'Queue' AND (Name LIKE '%Claim%' OR Name LIKE '%Adjuster%' OR Name LIKE '%SIU%') ORDER BY Name"

echo ""
echo "====== NAMED CREDENTIALS ======"
run_soql "SELECT DeveloperName, Endpoint FROM NamedCredential WHERE DeveloperName LIKE '%ISO%' OR DeveloperName LIKE '%Payment%' OR DeveloperName LIKE '%Claims%' ORDER BY DeveloperName" 2>/dev/null || echo "Check manually in Setup > Named Credentials"

echo ""
echo "====== CUSTOM METADATA: ClaimsRouting__mdt ======"
run_soql "SELECT DeveloperName, LossType__c, QueueApiName__c, SLAHours__c FROM ClaimsRouting__mdt ORDER BY LossType__c" 2>/dev/null || echo "ClaimsRouting__mdt not found — create Custom Metadata Type and records"

echo ""
echo "====== ACTIVE RECORD-TRIGGERED FLOWS (Claims) ======"
run_soql "SELECT MasterLabel, ApiName, Status FROM Flow WHERE TriggerType = 'RecordAfterSave' AND (ApiName LIKE '%Claim%') AND Status = 'Active' ORDER BY MasterLabel"

echo ""
echo "====== FSC CLAIMS OBJECT AVAILABILITY ======"
OBJECTS=(Claim ClaimParticipant ClaimCoverage ClaimItem ClaimReserve ClaimPayment ClaimAction AssessmentTask AssessmentIndicator)
for OBJ in "${OBJECTS[@]}"; do
  COUNT=$(sf data query --query "SELECT COUNT() FROM ${OBJ}" --target-org "$TARGET_ORG" --result-format csv 2>/dev/null | tail -1 || echo "ERROR")
  if [[ "$COUNT" == "ERROR" ]]; then
    echo "  ✗ $OBJ — not accessible (license or permission issue)"
  else
    echo "  ✓ $OBJ — $COUNT records"
  fi
done

echo ""
echo "Config check complete."
