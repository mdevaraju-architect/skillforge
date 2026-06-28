# API Version Matrix

This matrix tracks minimum Salesforce API version and release requirements for each skill. Use it to determine whether a skill is compatible with a specific org's API version before installing.

Salesforce releases three major releases per year: Winter (Oct–Nov), Spring (Feb–Mar), Summer (Jun–Jul). Each release increments the API version by 1.

---

## Current release mapping

| Salesforce Release | API Version | GA Date |
|---|---|---|
| Summer 26 | 63.0 | June 2026 |
| Spring 26 | 62.0 | February 2026 |
| Winter 26 | 61.0 | October 2025 |
| Summer 25 | 60.0 | June 2025 |
| Spring 25 | 59.0 | February 2025 |
| Winter 25 | 58.0 | October 2024 |

---

## Skill compatibility matrix

| Skill | Min API | Min Release | Max Tested | Notes |
|---|---|---|---|---|
| `industries/fsc/claims-process` | 60.0 | Summer 25 | 63.0 | Requires FSC Insurance + OmniStudio. ClaimItem subtypes GA since Winter 24. |

> Rows are added as skills reach `reviewed` tier and their version requirements are formally verified.

---

## Feature availability by release

Skills may require features that are not available in all API versions. This section tracks known feature availability gates.

### Financial Services Cloud — Insurance

| Feature | API Version | Release | Notes |
|---|---|---|---|
| ClaimItem subtypes (ClaimBuildingItem, etc.) | 56.0+ | Winter 23+ | All 4 subtypes GA |
| ClaimReserve | 54.0+ | Summer 22+ | |
| ClaimPayment | 54.0+ | Summer 22+ | |
| AssessmentTask / AssessmentIndicator | 56.0+ | Winter 23+ | |
| FSCInsurance permission set | 52.0+ | Summer 21+ | Replaces older FSC base perm set |
| ClaimDocument | 56.0+ | Winter 23+ | Uses ContentDocumentLink, not Attachment |

### OmniStudio

| Feature | API Version | Release | Notes |
|---|---|---|---|
| OmniStudio (Vlocity-native) | 54.0+ | Summer 22+ | Managed package superseded |
| OmniStudio Standard (Salesforce-native) | 58.0+ | Winter 25+ | Recommended for new implementations |
| DataRaptor | 54.0+ | Summer 22+ | |
| Integration Procedure | 54.0+ | Summer 22+ | |

### Agentforce

| Feature | API Version | Release | Notes |
|---|---|---|---|
| Agentforce (Service Agent) | 61.0+ | Winter 26+ | |
| Agent Topics API | 62.0+ | Spring 26+ | |
| AiEvaluationDefinition (metadata type) | 62.0+ | Spring 26+ | |
| Prompt Template metadata | 61.0+ | Winter 26+ | |

### Data Cloud

| Feature | API Version | Release | Notes |
|---|---|---|---|
| Data Cloud Ingestion API v2 | 59.0+ | Spring 25+ | |
| Identity Resolution Rules API | 59.0+ | Spring 25+ | |
| Calculated Insights (Batch) | 58.0+ | Winter 25+ | |
| Real-time Activation | 60.0+ | Summer 25+ | |

---

## Version checking

Before installing a skill in a target org:

```bash
# Check org API version
sf org display --target-org <alias> --json | jq '.result.instanceApiVersion'

# Compare against skill requirement
cat skills/industries/fsc/claims-process/skill-manifest.json | jq '."api-version-min"'
```

CI automation (`check-api-versions.yml`) validates that every skill manifest specifies a valid `api-version-min` that matches the feature availability table above.
