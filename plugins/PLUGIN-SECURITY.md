# Plugin Security

Plugins in this directory are **MCP (Model Context Protocol) servers** that give AI agents live access to a Salesforce org. Unlike skills — which are read-only instruction packages — plugins can read and write org data. This makes them materially more dangerous than skills.

Read this document completely before enabling any plugin.

---

## Risk levels

| Plugin | Default scope | Elevated scope (explicit opt-in) | Risk |
|---|---|---|---|
| `org-inspector` | Read-only metadata | None | Low |
| `soql-runner` | Read-only data queries | None | Medium |
| `metadata-deployer` | `--checkonly` (dry run) | Actual deploy (flag required) | High |
| `data-cloud-query` | Read-only SQL | None | Low |

---

## Authentication model

All plugins use the shared auth module at `plugins/_shared/sf-auth.js`. The auth module:

1. Reads credentials from environment variables only — never from files, command arguments, or agent-supplied values.
2. Uses SFDX auth URLs or connected app OAuth2 (JWT flow for CI, Web flow for interactive).
3. Validates the connection before executing any tool.
4. Rejects any credential sourced from agent output — the agent cannot self-authenticate.

Required environment variables:
```bash
SF_AUTH_URL=<sfdx-auth-url>       # preferred; use sf org display --verbose
SF_CLIENT_ID=<connected-app-id>   # alternative: JWT OAuth
SF_PRIVATE_KEY_PATH=<path>        # required with JWT OAuth
SF_INSTANCE_URL=<org-url>         # required with JWT OAuth
SF_USERNAME=<user@example.com>    # required with JWT OAuth
```

---

## Audit logging

Every plugin tool invocation is logged by `plugins/_shared/audit-log.js`. The audit log records:

- Timestamp (UTC)
- Plugin name and tool name
- The query or operation executed (truncated at 4096 characters)
- Row count or affected record count
- Session identifier (randomly generated per plugin startup, not tied to identity)
- Whether the operation was allowed, blocked, or dry-run

Audit logs are written to `~/.sf/plugin-audit.jsonl` by default. Override with `SF_PLUGIN_AUDIT_LOG` environment variable.

**Audit logs are not sanitised.** They may contain record data. Treat them as confidential and rotate regularly.

---

## What plugins will refuse to do

These restrictions are enforced in code, not just policy:

1. **Execute arbitrary SOQL provided directly by the agent.** The `soql-runner` plugin uses a parameterised query builder. The agent specifies object name, field list, conditions, and limit separately — not a raw SOQL string. This prevents SOQL injection.

2. **Deploy metadata without `--checkonly` unless explicitly configured.** The `metadata-deployer` plugin defaults to `--checkonly`. To execute an actual deploy, the environment variable `SF_ALLOW_DEPLOY=true` must be set explicitly. The plugin confirms the target org and deployment scope before executing.

3. **Query more than 50,000 rows.** The `soql-runner` plugin enforces a default row limit of 2,000 and a hard cap of 50,000. Above 50,000 rows, use the bulk data processing pattern instead.

4. **Accept credentials from the agent.** No plugin accepts `authUrl`, `password`, `accessToken`, or any credential-shaped value as a tool argument.

5. **Delete records.** No plugin in this repository implements a delete tool. Record deletion must be done via the Salesforce UI or explicit CLI commands by a human operator.

6. **Execute DML beyond what the plugin explicitly declares.** The `org-inspector` and `soql-runner` plugins are read-only at the network level — they connect using a user profile with read-only permissions in the recommended setup.

---

## Recommended connected app permissions

For maximum safety, create a connected app and user profile specifically for agent plugins with:

| Permission | org-inspector | soql-runner | metadata-deployer | data-cloud-query |
|---|---|---|---|---|
| Read all objects | ✓ | ✓ | ✓ | ✓ |
| Query all records | — | ✓ | — | ✓ |
| Deploy metadata | — | — | ✓ | — |
| Modify all data | — | — | — | — |
| View setup | ✓ | — | ✓ | — |

Never use a System Administrator profile or "Modify All Data" permission for plugin connections.

---

## Before enabling a plugin in production

- [ ] Review audit log location and ensure it is written to a secure, monitored path.
- [ ] Confirm the connected app profile has the minimum permissions listed above.
- [ ] Enable IP allowlisting on the connected app to restrict to your developer workstations.
- [ ] Set `SF_ALLOW_DEPLOY=false` (or leave unset) unless you specifically need live deploys.
- [ ] Notify your Salesforce system administrator that an MCP plugin is active.
- [ ] Review `plugins/_shared/rate-limit.js` — default: 30 API calls per minute, 500 per hour. Adjust if needed.
