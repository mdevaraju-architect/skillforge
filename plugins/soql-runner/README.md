# soql-runner

Read-only MCP plugin for Salesforce data queries with governor-limit guardrails.

## What it does

- Executes SOQL queries against any standard or custom object
- Enforces row limits (default 2,000, hard cap 50,000)
- Enforces field-level security — only returns fields the connected user can read
- Formats results as structured JSON
- Explains query plan on request (uses `EXPLAIN` prefix)

## What it will not do

- Execute DML (no insert, update, delete, upsert)
- Accept raw SOQL strings from the agent — the query is built from structured parameters
- Query more than 50,000 rows in a single call
- Expose system fields (encrypted fields, token fields) if FLS blocks them
- Accept credentials from the agent

## Setup

```bash
export SF_AUTH_URL=$(sf org display --target-org <alias> --verbose --json | jq -r '.result.sfdxAuthUrl')
cd plugins/soql-runner
npm install
npm start
```

## Tools exposed

| Tool | Input | Output |
|---|---|---|
| `queryRecords` | `{ object, fields[], where?, orderBy?, limit?, offset? }` | Array of records |
| `countRecords` | `{ object, where? }` | Integer count |
| `queryRelated` | `{ object, relationship, childFields[], parentWhere?, limit? }` | Parent + child records |
| `explainQuery` | `{ object, fields[], where? }` | Query plan nodes |
| `listPicklistValues` | `{ object, field }` | Picklist values + labels |

## Parameter guardrails

- `fields` must be an array of API names — no `*` wildcard, no subqueries.
- `where` accepts a filter object with `field`, `operator`, and `value` — not a raw SOQL string.
- `limit` is capped at 50,000. Default is 2,000.
- `object` must be a valid object API name discoverable via `org-inspector.listObjects`.

## Security notes

See [../PLUGIN-SECURITY.md](../PLUGIN-SECURITY.md) for the full security model.

Connect with a user that has Read-only access to all objects but no Modify All Data permission.
