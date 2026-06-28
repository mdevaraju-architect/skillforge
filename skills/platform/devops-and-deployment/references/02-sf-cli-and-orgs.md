# 02 — sf CLI and Orgs: Authentication, Configuration, and Org Management

## The sf Unified CLI

The Salesforce CLI was consolidated into a single `sf` binary starting in 2022, completing the deprecation of the old `sfdx` binary's command verbs in Spring '24. The `sf` binary is installed as part of `@salesforce/cli`.

### Installation

```bash
# npm (recommended for CI)
npm install --global @salesforce/cli

# Homebrew (macOS local dev)
brew install sf

# Verify version
sf version
sf --version
```

Always pin the CLI version in CI pipelines to avoid unexpected behavior changes:

```yaml
# In GitHub Actions
- name: Install Salesforce CLI
  run: npm install --global @salesforce/cli@2.x.x
```

---

## Key Commands Reference

### Org Authentication

| Command | Use case |
|---|---|
| `sf org login web --alias myAlias` | Interactive browser OAuth (local dev) |
| `sf org login jwt --client-id KEY --jwt-key-file server.key --username user@example.com --alias myAlias` | Headless JWT auth (CI) |
| `sf org logout --target-org myAlias` | Remove saved credentials |
| `sf org display --target-org myAlias` | Show org details: instance URL, username, expiry date, auth method |
| `sf org list` | List all authenticated orgs (scratch, sandbox, production) |
| `sf org list --all` | Include expired scratch orgs in the list |

### Scratch Org Management

| Command | Description |
|---|---|
| `sf org create scratch --definition-file config/project-scratch-def.json --alias myScratch --duration-days 7 --set-default` | Create a scratch org |
| `sf org delete scratch --target-org myScratch --no-prompt` | Delete a scratch org immediately |
| `sf org open --target-org myScratch` | Open the org in a browser |

### Source Deployment and Retrieval

| Command | Description |
|---|---|
| `sf project deploy start --target-org mySandbox` | Deploy all source in default package directory |
| `sf project deploy start --source-dir force-app/main/default/classes --target-org mySandbox` | Deploy specific directory |
| `sf project deploy start --metadata ApexClass:MyClass --target-org mySandbox` | Deploy specific metadata by type and name |
| `sf project deploy start --manifest package.xml --target-org mySandbox` | Deploy using a package.xml manifest |
| `sf project deploy start --checkonly --test-level RunLocalTests --target-org mySandbox` | Validate only (no commit) |
| `sf project deploy quick --job-id 0AfXXX --target-org mySandbox` | Fast-deploy a previously validated deployment |
| `sf project deploy report --job-id 0AfXXX --target-org mySandbox` | Check deployment status |
| `sf project deploy cancel --job-id 0AfXXX --target-org mySandbox` | Cancel an in-progress deployment |
| `sf project deploy preview --target-org mySandbox` | Preview changes without deploying |
| `sf project retrieve start --target-org mySandbox` | Retrieve changes from org to local source |
| `sf project retrieve start --source-dir force-app --target-org mySandbox` | Retrieve specific directory |
| `sf project retrieve start --manifest package.xml --target-org mySandbox` | Retrieve using manifest |

---

## JWT Bearer Flow for CI Authentication

JWT Bearer Flow is the correct authentication method for headless CI environments. It requires a Connected App configured in the target org.

### Setup Steps

1. **Generate a self-signed certificate and private key:**
   ```bash
   openssl genrsa -out server.key 2048
   openssl req -new -x509 -nodes -sha256 \
     -days 365 \
     -key server.key \
     -out server.crt \
     -subj "/C=US/ST=CA/L=SF/O=MyOrg/CN=ci-auth"
   ```

2. **Create a Connected App** in the target org (Setup > App Manager > New Connected App):
   - Enable OAuth settings.
   - Set callback URL to `http://localhost:1717/OauthRedirect` (placeholder; not used in JWT flow).
   - Enable "Use digital signatures" and upload `server.crt`.
   - Grant OAuth scopes: `api`, `refresh_token`, `offline_access`.
   - Set "Permitted Users" to "Admin approved users are pre-authorized".
   - After saving, note the **Consumer Key** (client ID).

3. **Pre-authorize the CI user:**
   - In the Connected App, under "Manage" > "Profiles" or "Permission Sets", add the CI user's profile or permission set.

4. **Store secrets in CI:**
   - `SF_CONSUMER_KEY` — the Connected App consumer key.
   - `SF_JWT_KEY` — the contents of `server.key`, base64-encoded.
   - `SF_USERNAME` — the CI user's username in the target org.

5. **Authenticate in CI pipeline:**
   ```bash
   echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key
   sf org login jwt \
     --client-id "$SF_CONSUMER_KEY" \
     --jwt-key-file /tmp/server.key \
     --username "$SF_USERNAME" \
     --alias ci-sandbox \
     --instance-url https://test.salesforce.com \
     --set-default
   rm /tmp/server.key
   ```
   Use `https://login.salesforce.com` for production. Use `https://test.salesforce.com` for sandboxes.

---

## sfdx-project.json

Full annotated example:

```json
{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true,
      "package": "MyUnlockedPackage",
      "versionName": "v1.3",
      "versionNumber": "1.3.0.NEXT",
      "versionDescription": "Quarterly release",
      "definitionFile": "config/project-scratch-def.json",
      "dependencies": [
        {
          "package": "MyFoundationPackage",
          "versionNumber": "1.0.0.LATEST"
        }
      ]
    },
    {
      "path": "force-app-config",
      "default": false
    }
  ],
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "61.0",
  "plugins": {
    "lightning-stub-generator": {
      "namespaceRoots": ["force-app"]
    }
  },
  "packageAliases": {
    "MyUnlockedPackage": "0HoXXXXXXXXXXXXX",
    "MyUnlockedPackage@1.2.0-1": "04tAAAAAAAAAAAAAA",
    "MyUnlockedPackage@1.3.0-1": "04tBBBBBBBBBBBBBB",
    "MyFoundationPackage": "0HoYYYYYYYYYYYYY",
    "MyFoundationPackage@1.0.0-1": "04tCCCCCCCCCCCCCC"
  }
}
```

Key fields explained:
- `path` — relative path to the source directory. Multiple package directories are supported.
- `default: true` — identifies the default directory used when no `--source-dir` flag is given.
- `package` — the human-readable package name (must match a key in `packageAliases`).
- `versionNumber` — `MAJOR.MINOR.PATCH.BUILD`. Use `NEXT` for the build number to auto-increment; use `LATEST` in dependencies to resolve to the most recent released version.
- `namespace` — set to your namespace string for managed packages; leave empty (`""`) for unlocked packages.
- `sourceApiVersion` — determines which metadata types and features are available. Set to the API version of your target orgs.

---

## config/project-scratch-def.json

The scratch org definition file controls the edition, features, settings, and org preferences of a scratch org created from this project.

```json
{
  "orgName": "My Dev Scratch Org",
  "edition": "Developer",
  "features": [
    "EnableSetPasswordInApi",
    "Communities",
    "LightningSalesConsole",
    "ServiceCloud"
  ],
  "settings": {
    "lightningExperienceSettings": {
      "enableS1DesktopEnabled": true
    },
    "languageSettings": {
      "enableTranslationWorkbench": false
    },
    "apexSettings": {
      "enableDisableParallelApexTesting": false
    }
  },
  "adminEmail": "admin@example.com",
  "hasSampleData": false,
  "release": "Preview"
}
```

Common `edition` values: `Developer`, `Enterprise`, `Group`, `Professional`.

Common `features`: `API`, `AuthorApex`, `Communities`, `ContactsToMultipleAccounts`, `EnableSetPasswordInApi`, `LightningScheduler`, `NetworkingOptIn`, `PersonAccounts`, `Sandbox`, `ServiceCloud`, `Sites`.

Note: `hasSampleData: true` populates Salesforce standard sample data (Accounts, Contacts, etc.). Set to `false` for clean scratch orgs used in automated testing.

---

## Source Tracking

Source tracking maintains a record of changes between the local project and a remote org so that `sf project deploy start` and `sf project retrieve start` can automatically calculate the delta.

Orgs that support source tracking:
- Scratch orgs (always enabled).
- Developer Pro sandboxes (enable in Setup > Sandboxes > Edit).
- Partial Copy sandboxes (enable in Setup > Sandboxes > Edit, if the feature is available in your org).

Orgs that do NOT support source tracking:
- Production orgs.
- Classic Developer sandboxes.
- Full Copy sandboxes (check Salesforce release notes for current availability).
- Developer Edition orgs.

### Useful source tracking commands:

```bash
# See what has changed locally vs the org (preview before deploy)
sf project deploy preview --target-org myScratch

# See what has changed in the org vs local (preview before retrieve)
sf project retrieve preview --target-org myScratch

# Reset source tracking (clears all tracking records — use carefully)
sf project reset tracking --target-org myScratch --no-prompt
```

---

## Org Lifecycle Summary

### Scratch Org Lifecycle

```
sf org create scratch
       |
       v
  [Active Scratch Org]
  Max 30 days (default 7)
       |
       v
  [Expired] ← no recovery possible after expiry
       |
  (or) sf org delete scratch
```

### Sandbox Lifecycle

Sandboxes are created from production (or a sandbox as a source) and do not expire automatically. They are refreshed (reset to a new copy) on demand, subject to sandbox refresh intervals:
- Developer/Developer Pro: 1-day refresh interval.
- Partial Copy: 5-day refresh interval.
- Full Copy: 29-day refresh interval.

```bash
# Create sandbox (requires production org auth)
sf org create sandbox \
  --definition-file config/sandbox-def.json \
  --alias integration-sandbox \
  --target-org production \
  --wait 30

# Refresh an existing sandbox
sf org sandbox refresh \
  --name IntegrationSandbox \
  --target-org production \
  --wait 60
```

Sandbox definition file (`config/sandbox-def.json`):
```json
{
  "sandboxName": "IntegrationSandbox",
  "licenseType": "DEVELOPER",
  "sourceSandboxName": "production",
  "autoActivate": true
}
```
