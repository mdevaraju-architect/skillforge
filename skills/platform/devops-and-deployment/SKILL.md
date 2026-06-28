---
name: platform-devops-and-deployment
description: >-
  SFDX, sf CLI, sf project deploy, sf project retrieve, scratch org, sandbox,
  change set, Metadata API, source tracking, unlocked package, managed package,
  2GP, second-generation packaging, package version, package dependency,
  CI/CD, GitHub Actions, deployment validation, checkonly, dry-run, code coverage,
  destructive changes, org shape, source format, metadata format, delta deployment,
  org compare, environment management, deployment rollback, test level
compliance:
  regulations: ["SOC2"]
  org-types: ["scratch","sandbox","uat","production"]
  data-sensitivity: "internal"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: platform
  module: devops-and-deployment
  api-version-min: "60.0"
  salesforce-release-min: "Summer25"
  approval-tier: "draft"
---

# platform-devops-and-deployment

Salesforce DevOps and deployment skill covering the full lifecycle from local development through production release: Salesforce CLI (`sf`), scratch orgs, sandboxes, unlocked and managed packages, CI/CD pipeline construction, delta deployment, destructive changes, and code coverage enforcement.

---

## Routing Table

| User intent | Reference file |
|---|---|
| CLI commands, org auth, sfdx-project.json, scratch org setup | `references/02-sf-cli-and-orgs.md` |
| Deployment flags, test levels, code coverage, rollback, destructive changes | `references/03-deployment-and-testing.md` |
| Unlocked packages, managed packages, 2GP, version lifecycle | `references/04-packaging.md` |
| CI/CD pipelines, GitHub Actions, JWT auth, delta deployment, sgd | `references/05-cicd-and-delta.md` |
| Development model comparison, environment architecture, metadata vs source format | `references/01-architecture.md` |

---

## Gotchas

### 1. `sf project deploy start` replaces `sfdx force:source:deploy` — the legacy `sfdx` commands are deprecated as of Spring '24

The Salesforce CLI unified to `sf` (not `sfdx`). `sfdx force:source:deploy` still works but is deprecated and will be removed. All new pipelines should use `sf project deploy start`, `sf project retrieve start`, and `sf org create scratch`. Scripts using `sfdx` commands need migration planning before the commands are removed. Do not write new automation using `sfdx` verbs. The `sf` CLI uses a noun-verb-noun pattern (`sf project deploy start`) rather than the legacy colon-separated format (`sfdx force:source:deploy`).

### 2. Code coverage must be at least 75% across ALL Apex in the org at deployment time — not just the classes being deployed

Salesforce enforces 75% org-wide Apex code coverage at the time of production deployment. A deployment that itself has 100% coverage can fail if the existing org-wide coverage drops below 75% when the new code is included. The `RunLocalTests` test level runs all local Apex tests; a single failing test or a drop in org-wide coverage causes deployment failure. Monitor org-wide coverage with Tooling API queries against `ApexOrgWideCoverage`. Never assume that a class-level coverage report equals org-wide compliance.

### 3. Scratch org shapes define the org edition and features but do NOT capture data or configuration not in source

`config/project-scratch-def.json` defines edition, features, settings, and org preferences for a scratch org. It does not capture: record data, permission set assignments, named credentials with credentials, custom label values set via UI, or manual Setup configuration. Use `sf data export` (or a seed script) to populate scratch orgs with test data separately. Automation that relies on data existing in a scratch org must explicitly create or import that data as a pipeline step after `sf project deploy start`.

### 4. Unlocked packages have strict dependency versioning — a subscriber org cannot install a newer version that breaks an API used by a dependent package

In 2GP (Second-Generation Packaging), `sfdx-project.json` specifies `packageAliases` with version IDs. Package dependencies must be installed in order: dependency first, then dependent. Installing out of order causes `PACKAGE_DEPENDENCY_NOT_MET`. Always run `sf package install` in dependency-resolved order in CI. When creating a new package version, if the dependency has a new released version, update the version number in `sfdx-project.json` before running `sf package version create` — otherwise the new package version pins to the old dependency.

### 5. `--checkonly` (`--dry-run`) deployment validates but does not deploy — it still runs all specified tests and respects code coverage

`sf project deploy start --checkonly` validates the metadata and runs tests without committing the deployment. It is required before most production deployments (change-set-style orgs). The check-only deployment ID can be used for `sf project deploy quick` to fast-deploy within 10 days without re-running tests. After 10 days, the quick-deploy window expires and the full deployment (with tests) must be re-run. Store the deployment ID output from `--checkonly` in your CI artifact store so it is available for the quick-deploy step.

### 6. Destructive changes require a `destructiveChanges.xml` (or `destructiveChangesPost.xml`) file — they cannot be expressed in source format

To delete metadata components from an org, create a `destructiveChanges.xml` (deletes before the deployment) or `destructiveChangesPost.xml` (deletes after). Removing a file from source tracking does NOT delete it from the org on next deploy. Destructive changes must be explicitly declared. Deleting a custom field that has data requires the field to be custom (standard fields cannot be deleted), and the data in that field is permanently lost. Always take a data export before deploying destructive field changes to production. The package.xml accompanying a destructive-only deployment may be empty, but it must be present.

### 7. Source tracking only works with scratch orgs and sandboxes with source tracking enabled — it is NOT available in production or developer-classic sandboxes

`sf project deploy start` with source tracking auto-calculates delta changes. In orgs without source tracking (production, Developer Edition, classic sandboxes), you must specify `--source-dir` or `--metadata` explicitly. Deploying to production without specifying what to deploy defaults to the entire project directory, which can be very slow and can cause unexpected deployments of components not yet ready for production. Enable source tracking on Developer Pro and Partial Copy sandboxes in Setup > Sandboxes when the feature is available.

### 8. Managed package namespace prefix pollutes all API names in the subscriber org — custom fields deployed inside a managed package are namespaced

Once a managed package (1GP or 2GP) is installed, all its components have the namespace prefix. Queries, references, and integrations in the subscriber org must use the prefixed names (e.g., `mypkg__FieldName__c`). If the org already has a field `FieldName__c` before package install, the namespaced field `mypkg__FieldName__c` is a separate field — a common source of duplicate-field confusion. SOQL queries written before the package is installed must be updated to use the namespaced API names after installation. Automation tools (Flow, Process Builder, triggers) that reference those fields must also be updated.

### 9. `sf org create scratch` creates a scratch org that expires in 1–30 days (default 7) — scratch orgs cannot be recovered after expiration

`--duration-days` sets the expiry. After expiration, the scratch org and all its data and configuration are permanently deleted. CI pipelines must complete within the scratch org's lifespan. For long-running test environments, use a sandbox, not a scratch org. Track scratch org expiry dates in pipeline config. The Dev Hub has a limit on active scratch orgs per day and in total — exceeding the daily allocation causes `sf org create scratch` to fail with `EXCEEDED_LIMIT`. Monitor scratch org usage with `sf org list --all`.

### 10. `RunSpecifiedTests` test level requires specifying ALL tests that provide coverage for the deployed components — omitting any test causes deployment failure

`--test-level RunSpecifiedTests --tests MyTest1,MyTest2` only runs the specified test classes. Salesforce validates that the deployed Apex components are covered by those specified tests. If a class needs coverage from a test not listed, deployment fails with `INSUFFICIENT_CODE_COVERAGE`. `RunLocalTests` is safer (runs all local tests) but slower. `RunSpecifiedTests` is faster but requires a continuously maintained test-to-component mapping. In large orgs, maintaining that mapping is operationally expensive — evaluate the tradeoff between speed and maintenance overhead.

### 11. Delta deployments require knowing what changed — use `sf project deploy start --source-dir` with a git-diff-generated manifest, not source tracking in CI

In CI (non-scratch org deployment), there is no source tracking. Delta deployments must be derived from `git diff` between the current and target branch, then passed to the deployment command. Tools like `sgd` (Salesforce Git Delta, `sfdx-git-delta`) automate this by generating a `delta/` directory and `package/package.xml`. Deploying the full project on every PR is slow and increases risk of accidental over-deployment. Delta deployment is the CI best practice for large orgs. Always verify the generated delta manifest before deploying to production.

### 12. Permission sets and profiles in metadata format omit unset permissions — retrieved files are NOT the full permission picture

When you retrieve a Permission Set from an org, the XML only includes permissions explicitly set (not all possible permissions). Re-deploying a retrieved permission set to a different org does not recreate the original permission set completely unless the XML explicitly lists every permission. Use `--all` flag or permission set comparison tools for full fidelity migration. Profiles are especially lossy in source format — they only include the subset of the profile relevant to the components in your project. Full profile retrieval requires specifying all component types in the package.xml.

### 13. Apex classes in managed packages cannot be modified by subscribers — only behaviors exposed via global/public interfaces can be overridden

In a managed package, `global` and `public` Apex is visible to subscribers; `private` and `protected` is not. Subscribers cannot extend or override managed package Apex classes unless the package author marked them `virtual` or `abstract` with `global` access. Attempting to extend a managed non-virtual class throws a compile error. When building integration logic that depends on a managed package, prefer calling its global methods rather than trying to subclass its implementations. If you need extensibility, raise that requirement with the package author.

### 14. `sf project deploy start --ignore-conflicts` bypasses conflict detection and can overwrite org changes — never use in production without reviewing conflicts first

Source tracking detects conflicts between local source and org state. `--ignore-conflicts` skips this check and deploys regardless. In production, this can overwrite hotfixes or manual config changes applied directly to the org. Always run `sf project deploy preview` first to review what will be overwritten. In CI pipelines targeting sandboxes, `--ignore-conflicts` is sometimes used intentionally (when the pipeline is the source of truth), but the team must agree on that policy explicitly and document it in the pipeline README.

---

## Common Workflows

### Workflow 1: Set up a CI/CD pipeline for sandbox deployment

**Goal:** On every pull request, validate metadata against an integration sandbox using `--checkonly` and `RunLocalTests`. On merge to `main`, deploy with tests and notify Slack.

**Steps:**

1. Generate a Connected App in the target sandbox with OAuth JWT Bearer Flow enabled. Download the server certificate and store the private key as a CI secret (`SF_JWT_KEY`). Store the consumer key as `SF_CONSUMER_KEY` and the sandbox username as `SF_USERNAME`.

2. In the CI workflow file, decode the key and authenticate:
   ```yaml
   - name: Write JWT key
     run: echo "$SF_JWT_KEY" | base64 --decode > server.key
   - name: Authenticate to sandbox
     run: |
       sf org login jwt \
         --client-id $SF_CONSUMER_KEY \
         --jwt-key-file server.key \
         --username $SF_USERNAME \
         --alias target-sandbox \
         --set-default \
         --instance-url https://test.salesforce.com
   ```

3. For pull request validation (`validate.yml`, triggers on `pull_request`):
   ```yaml
   - name: Validate (checkonly)
     run: |
       sf project deploy start \
         --checkonly \
         --test-level RunLocalTests \
         --target-org target-sandbox \
         --wait 30
   ```

4. For deployment on merge to `main` (`deploy.yml`, triggers on `push` to `main`):
   ```yaml
   - name: Deploy
     run: |
       sf project deploy start \
         --test-level RunLocalTests \
         --target-org target-sandbox \
         --wait 60
   - name: Notify Slack on success
     if: success()
     uses: slackapi/slack-github-action@v1
     with:
       payload: '{"text":"Deployment to integration sandbox succeeded — ${{ github.sha }}"}'
     env:
       SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
   ```

5. For delta deployment on large orgs, insert a `sfdx-git-delta` step before the deploy step to generate only the changed components. See `references/05-cicd-and-delta.md`.

---

### Workflow 2: Create and use a scratch org for feature development

**Goal:** Spin up a scratch org, push source, run tests, then tear it down.

**Steps:**

1. Ensure a Dev Hub org is authenticated:
   ```bash
   sf org login web --set-default-dev-hub --alias DevHub
   ```

2. Create the scratch org:
   ```bash
   sf org create scratch \
     --definition-file config/project-scratch-def.json \
     --alias feature-scratch \
     --duration-days 7 \
     --set-default
   ```

3. Deploy source to the scratch org:
   ```bash
   sf project deploy start --target-org feature-scratch
   ```

4. Seed test data if required:
   ```bash
   sf apex run --file scripts/apex/seed-data.apex --target-org feature-scratch
   ```

5. Run Apex tests:
   ```bash
   sf apex run test \
     --test-level RunLocalTests \
     --target-org feature-scratch \
     --wait 10 \
     --result-format human
   ```

6. When done, delete the scratch org (or let it expire naturally after the duration):
   ```bash
   sf org delete scratch --target-org feature-scratch --no-prompt
   ```

See `references/02-sf-cli-and-orgs.md` for the scratch org definition file reference and `references/03-deployment-and-testing.md` for test execution details.

---

### Workflow 3: Manage an unlocked package release

**Goal:** Bump version, create a new package version, promote it from beta to released, and install it to a sandbox.

**Steps:**

1. Update `sfdx-project.json` — increment `versionNumber` in the package directory entry (e.g., `"versionNumber": "1.2.0.NEXT"`).

2. Create the package version (initially in beta state):
   ```bash
   sf package version create \
     --package MyUnlockedPackage \
     --installation-key-bypass \
     --wait 20 \
     --code-coverage
   ```
   The `--code-coverage` flag enforces the 75% code coverage requirement during version creation and fails the command if coverage is insufficient.

3. Note the `04t...` subscriber package version ID in the output. Test the beta version in a scratch org:
   ```bash
   sf package install \
     --package 04tXXXXXXXXXXXXXXX \
     --target-org feature-scratch \
     --wait 10
   ```

4. After validation, promote the version to released (this action is irreversible):
   ```bash
   sf package version promote --package 04tXXXXXXXXXXXXXXX
   ```

5. Install to the sandbox in dependency order — always install dependencies first:
   ```bash
   sf package install \
     --package 04t_DEPENDENCY_VERSION_ID \
     --target-org integration-sandbox \
     --wait 20
   sf package install \
     --package 04t_THIS_PACKAGE_VERSION_ID \
     --target-org integration-sandbox \
     --wait 20
   ```

6. Verify installation:
   ```bash
   sf package installed list --target-org integration-sandbox
   ```

See `references/04-packaging.md` for full package lifecycle, `packageAliases` structure, and managed package differences.

---

## Not Covered by This Skill

- **Salesforce DevOps Center UI** — This is a separate Salesforce product with its own pipeline UI workflow. Use Salesforce documentation or DevOps Center help articles directly.
- **Gearset, Copado, AutoRABIT tool-specific configuration** — Third-party DevOps tools have their own configuration models. This skill covers native Salesforce CLI and platform capabilities only.
- **Performance testing and profiling** — Use `platform-performance-and-limits` skill for Apex CPU limits, SOQL/DML governor limit analysis, and async performance tuning.
- **Security and permission deployment** — Use `platform-security-and-sharing` skill for permission set architecture, field-level security deployment, sharing rules, and OWD configuration.
