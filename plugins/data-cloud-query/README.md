# data-cloud-query

Read-only MCP plugin for Salesforce Data Cloud SQL API queries.

## What it does

- Executes SQL queries against Data Cloud objects (Data Model Objects, Data Lake Objects)
- Lists available DMOs and DLOs with schema information
- Queries Calculated Insights and Unified Profiles
- Returns results with pagination support

## What it will not do

- Execute DML against Data Cloud (no ingestion, deletion, or segment modification)
- Query more than 100,000 rows in a single call
- Accept raw SQL strings from the agent — query is built from structured parameters
- Access standard Salesforce CRM data (use `soql-runner` for that)
- Accept credentials from the agent

## Setup

```bash
# Requires a Data Cloud-enabled org and connected app with Data Cloud scope
export SF_AUTH_URL=$(sf org display --target-org <alias> --verbose --json | jq -r '.result.sfdxAuthUrl')
cd plugins/data-cloud-query
npm install
npm start
```

## Tools exposed

| Tool | Input | Output |
|---|---|---|
| `queryDMO` | `{ dmoApiName, fields[], where?, limit? }` | Array of records |
| `listDMOs` | `{}` | All available Data Model Objects |
| `listDLOs` | `{}` | All available Data Lake Objects |
| `describeDMO` | `{ dmoApiName }` | Schema — fields, types, relationships |
| `queryCalculatedInsight` | `{ insightApiName, dimensions?, metrics?, where?, limit? }` | Insight data |
| `getUnifiedProfile` | `{ unifiedIndividualId }` | Full unified profile for one individual |

## Security notes

See [../PLUGIN-SECURITY.md](../PLUGIN-SECURITY.md) for the full security model.

Data Cloud profiles contain unified PII. Ensure the connected app has restricted IP allowlisting and that audit logs are written to a monitored location.
