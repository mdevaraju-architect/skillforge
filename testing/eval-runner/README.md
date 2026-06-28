# Eval Runner

CI tooling for validating skill structure and running eval scenarios.

## Scripts

| Script | What it does |
|---|---|
| `validate-structure.js` | Checks every skill directory for required files |
| `run-evals.js` | Loads each `evals.json` and validates schema |
| `check-api-versions.js` | Cross-references `skill-manifest.json` against the API version matrix |
| `security-scan.js` | Scans for hardcoded org IDs, credentials, and injection patterns |

## Running locally

```bash
# Install dependencies (ajv, js-yaml)
npm install

# Validate structure
node testing/eval-runner/validate-structure.js

# Validate eval schema
node testing/eval-runner/run-evals.js

# Check API version matrix
node testing/eval-runner/check-api-versions.js

# Security scan
node testing/eval-runner/security-scan.js
```

## Eval schema

Each `evals/evals.json` file must conform to this schema:

```json
{
  "skill": "<skill-name>",
  "evals": [
    {
      "id": "<unique-id>",
      "prompt": "<user question or task>",
      "expected_topics": ["<concept-1>", "<concept-2>"],
      "must_not_contain": ["<drift-indicator-1>", "<drift-indicator-2>"],
      "compliance_check": null
    }
  ]
}
```

- `expected_topics`: strings that should appear (case-insensitive) in a correct response
- `must_not_contain`: strings that indicate domain drift — if any appear in the response, the eval fails
- `compliance_check`: optional; if set, the eval runner flags the response for human compliance review

## CI integration

The eval runner is called by `.github/workflows/run-evals.yml` on every PR that modifies files under `skills/`. The workflow fails if:
- Any skill directory is missing required files
- Any `evals.json` has fewer than 10 evals
- Any `evals.json` fails schema validation
- Any `skill-manifest.json` fails schema validation against `governance/skill-manifest-schema.json`
