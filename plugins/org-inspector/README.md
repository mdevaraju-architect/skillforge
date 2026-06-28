# org-inspector

Read-only MCP plugin for Salesforce metadata discovery.

## What it does

- Describes any standard or custom object (fields, picklists, relationships, record types)
- Lists all custom objects, custom fields, and metadata types in the org
- Reads permission set and profile field-level security
- Retrieves installed package information and API version
- Fetches metadata XML for a specific component (Apex class, Flow, custom object, etc.)

## What it will not do

- Execute DML (no insert, update, delete, upsert)
- Run SOQL data queries (use `soql-runner` for that)
- Deploy metadata (use `metadata-deployer` for that)
- Accept credentials from the agent

## Setup

```bash
# Set authentication
export SF_AUTH_URL=$(sf org display --target-org <alias> --verbose --json | jq -r '.result.sfdxAuthUrl')

# Start the plugin
cd plugins/org-inspector
npm install
npm start
```

## Tools exposed

| Tool | Input | Output |
|---|---|---|
| `describeObject` | `{ objectApiName: string }` | Full describe result — fields, picklists, relationships |
| `listObjects` | `{ type: 'custom' \| 'standard' \| 'all' }` | Array of object API names |
| `describeField` | `{ objectApiName: string, fieldApiName: string }` | Field describe + FLS |
| `getMetadata` | `{ metadataType: string, fullName: string }` | Metadata XML |
| `listMetadata` | `{ metadataType: string }` | Array of component names |
| `getOrgInfo` | `{}` | Org ID, edition, API version, installed packages |

## Security notes

See [../PLUGIN-SECURITY.md](../PLUGIN-SECURITY.md) for the full security model.

All connections use the shared auth module. This plugin connects using a minimum-permission profile: View Setup and Configuration, Read on all objects, no data access required.
