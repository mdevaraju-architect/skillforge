# metadata-deployer

MCP plugin for Salesforce metadata deployment with `--checkonly` default.

## What it does

- Validates metadata against a target org (`--checkonly` by default — no changes applied)
- Executes actual deployments when `SF_ALLOW_DEPLOY=true` is set in the environment
- Runs specified test classes as part of deployment validation
- Returns deployment results: component successes, failures, test pass/fail
- Retrieves metadata from an org for local comparison

## What it will not do

- Deploy without explicit `SF_ALLOW_DEPLOY=true` in the environment
- Skip tests when deploying to production (Salesforce requirement: 75% coverage)
- Accept metadata XML directly from the agent — only deploys from a path on disk
- Accept credentials from the agent

## Setup

```bash
export SF_AUTH_URL=$(sf org display --target-org <alias> --verbose --json | jq -r '.result.sfdxAuthUrl')
# Leave SF_ALLOW_DEPLOY unset (or set to 'false') for validation-only mode
cd plugins/metadata-deployer
npm install
npm start
```

## Tools exposed

| Tool | Input | Output |
|---|---|---|
| `validateDeployment` | `{ path, testLevel?, testClasses? }` | Validation result — components + test results |
| `deployMetadata` | `{ path, testLevel?, testClasses? }` | Deploy result — requires `SF_ALLOW_DEPLOY=true` |
| `retrieveMetadata` | `{ metadataTypes[], outputPath }` | Retrieved files written to `outputPath` |
| `getDeployStatus` | `{ deployId }` | Async deployment status |

## Security notes

See [../PLUGIN-SECURITY.md](../PLUGIN-SECURITY.md) for the full security model.

The deployer user requires: Deploy Customization Apps, Apex Modify All. For production, also requires: Author Apex (if deploying Apex classes). Always test in sandbox first.
