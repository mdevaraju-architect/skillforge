# 03 — Deployment and Testing: Flags, Test Levels, Coverage, Rollback, and Destructive Changes

## `sf project deploy start` — Full Flag Reference

```bash
sf project deploy start [flags]
```

| Flag | Short | Description |
|---|---|---|
| `--target-org <alias>` | `-o` | Target org alias or username |
| `--source-dir <path>` | `-d` | Source directory to deploy (relative to project root) |
| `--metadata <type:name>` | `-m` | Specific metadata components (e.g., `ApexClass:MyClass`) |
| `--manifest <file>` | `-x` | Deploy using a package.xml manifest |
| `--metadata-dir <path>` | | Deploy from metadata format directory |
| `--checkonly` | `-c` | Validate only; do not commit the deployment |
| `--test-level <level>` | `-l` | Test execution level (see table below) |
| `--tests <names>` | `-t` | Comma-separated test class names (required for RunSpecifiedTests) |
| `--wait <minutes>` | `-w` | Minutes to wait for async deployment (default: 33) |
| `--ignore-conflicts` | | Skip conflict detection (use with caution) |
| `--ignore-errors` | | Ignore non-fatal errors (sandbox only; never use in production) |
| `--ignore-warnings` | | Treat warnings as non-fatal |
| `--purge-on-delete` | | Immediately purge deleted components from recycle bin |
| `--pre-destructive-changes <file>` | | XML file listing components to delete before deployment |
| `--post-destructive-changes <file>` | | XML file listing components to delete after deployment |
| `--dry-run` | | Alias for `--checkonly` |
| `--verbose` | | Show full deployment output including test results |
| `--async` | | Start deployment asynchronously and return immediately |
| `--api-version <version>` | | Override API version for the deployment |

---

## Test Levels

The `--test-level` flag controls which Apex tests are run during deployment. The appropriate level depends on the target org type and your coverage requirements.

| Test Level | Description | Production? | Sandbox? |
|---|---|---|---|
| `NoTestRun` | No tests run. No coverage check. | No — rejected | Yes |
| `RunSpecifiedTests` | Only the tests listed in `--tests`. Coverage checked for deployed components only. | Yes (with care) | Yes |
| `RunLocalTests` | All tests not from managed packages. Org-wide coverage enforced. | Yes (recommended) | Yes |
| `RunAllTestsInOrg` | All tests including managed package tests. Very slow. | Rarely needed | Yes |

### Choosing a Test Level

- **Production deployments:** Use `RunLocalTests` for safety. Use `RunSpecifiedTests` only when you have a well-maintained test mapping and want faster CI runs.
- **Sandbox validation on PR:** Use `RunLocalTests` to catch regressions.
- **Sandbox deploy (non-test metadata like static resources, LWC, reports):** `NoTestRun` is acceptable in sandboxes to speed up deployment.
- **Package version creation:** Code coverage is enforced separately at package version create time with `--code-coverage`.

### RunSpecifiedTests Example

```bash
sf project deploy start \
  --source-dir force-app \
  --test-level RunSpecifiedTests \
  --tests "AccountServiceTest,OpportunityHandlerTest,InvoiceCalculatorTest" \
  --target-org production \
  --wait 60
```

All listed tests must collectively cover all Apex classes being deployed at 75%+. If any deployed class lacks coverage from the listed tests, deployment fails.

---

## Code Coverage: 75% Org-Wide Requirement

Salesforce requires 75% code coverage across **all Apex in the org** for any production deployment that runs tests. This is an org-wide aggregate, not per-class.

### Coverage is calculated as:

```
Total covered lines across all Apex classes
─────────────────────────────────────────── >= 0.75
Total executable lines across all Apex classes
```

### Common failure scenarios:

1. **New Apex class with no tests** — even if existing org coverage is 80%, adding a large untested class can drop the aggregate below 75%.
2. **Deleted test class not removed from tracking** — coverage count drops if tests are removed but the org shows fewer test-covered lines.
3. **RunSpecifiedTests with incomplete test list** — some classes are not covered by the specified tests, causing `INSUFFICIENT_CODE_COVERAGE`.

### Check org-wide coverage via Tooling API:

```bash
sf data query \
  --query "SELECT PercentCovered FROM ApexOrgWideCoverage" \
  --use-tooling-api \
  --target-org production
```

### Check coverage per class:

```bash
sf data query \
  --query "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate ORDER BY NumLinesUncovered DESC LIMIT 20" \
  --use-tooling-api \
  --target-org production
```

---

## Check-Only (--checkonly) and Quick Deploy

### How checkonly works:

`sf project deploy start --checkonly` submits the deployment to Salesforce for validation. Salesforce:
1. Compiles all metadata.
2. Runs the specified tests (or all local tests if `RunLocalTests`).
3. Validates code coverage.
4. Returns success/failure **without** committing the deployment.

The output includes a **deployment ID** (starts with `0Af`). This ID is used for quick deploy.

### Quick Deploy:

If a `--checkonly` deployment succeeds, you can fast-deploy the same payload within **10 days** without re-running all tests:

```bash
# Step 1: Validate
DEPLOY_ID=$(sf project deploy start \
  --checkonly \
  --test-level RunLocalTests \
  --source-dir force-app \
  --target-org production \
  --wait 60 \
  --json | jq -r '.result.id')

echo "Deployment ID: $DEPLOY_ID"

# Step 2 (within 10 days): Quick deploy
sf project deploy quick \
  --job-id "$DEPLOY_ID" \
  --target-org production \
  --wait 30
```

The quick deploy window expires 10 days after the `--checkonly` run. After expiration, a full deployment with tests is required again.

---

## Destructive Changes

Removing metadata components from an org requires explicitly declaring them in a destructive changes XML file. Simply deleting the source files and deploying does **not** remove components from the org.

### Types of destructive changes:

- `destructiveChanges.xml` — components deleted **before** the rest of the deployment is applied.
- `destructiveChangesPost.xml` — components deleted **after** the rest of the deployment is applied.

Use `destructiveChanges.xml` (pre) when the deleted components would conflict with or block the deployment. Use `destructiveChangesPost.xml` when new components depend on the old components during deployment (e.g., replacing a trigger with a new one that uses the same name).

### File format:

`destructiveChanges.xml` has the same structure as `package.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>OldTriggerName</members>
    <name>ApexTrigger</name>
  </types>
  <types>
    <members>Account.OldField__c</members>
    <name>CustomField</name>
  </types>
  <version>61.0</version>
</Package>
```

### Deploying destructive changes:

```bash
# With an accompanying deployment (recommended — both files in same directory)
sf project deploy start \
  --metadata-dir deploy-package/ \
  --target-org production \
  --test-level RunLocalTests \
  --wait 60

# deploy-package/ directory structure:
# deploy-package/
#   package.xml                  (may list new/modified components, or be empty)
#   destructiveChangesPost.xml   (components to delete after deployment)
#   classes/                     (new/modified Apex classes if any)
```

### Destructive change of a custom field with data:

Deleting a custom field permanently deletes all data stored in that field across all records. There is no undo. Before deploying destructive field changes to production:

1. Export the field data: `sf data query --query "SELECT Id, OldField__c FROM Account WHERE OldField__c != null" --target-org production --result-format csv > old-field-backup.csv`
2. Confirm the field data is no longer needed or has been migrated.
3. Proceed with the destructive deployment.

---

## Deploy Manifest (package.xml)

A `package.xml` specifies exactly which metadata components to deploy or retrieve. It gives precise control over what is included, independent of the directory structure.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>AccountService</members>
    <members>OpportunityHandler</members>
    <name>ApexClass</name>
  </types>
  <types>
    <members>AccountServiceTest</members>
    <name>ApexClass</name>
  </types>
  <types>
    <members>AccountTrigger</members>
    <name>ApexTrigger</name>
  </types>
  <types>
    <members>Account.Status__c</members>
    <name>CustomField</name>
  </types>
  <types>
    <members>*</members>
    <name>CustomObject</name>
  </types>
  <version>61.0</version>
</Package>
```

- `<members>*</members>` — wildcard; retrieves/deploys all components of that type.
- For fields, the format is `ObjectName.FieldName` (e.g., `Account.Status__c`).
- The `<version>` element must match or be compatible with the org API version.

---

## Deployment Monitoring

### Check deployment status:

```bash
# Poll until completion (--wait N waits N minutes)
sf project deploy report --job-id 0AfXXXXXXXXXXXX --target-org production --wait 60

# Check status without waiting
sf project deploy report --job-id 0AfXXXXXXXXXXXX --target-org production
```

### Parse JSON output in CI:

```bash
RESULT=$(sf project deploy start \
  --source-dir force-app \
  --test-level RunLocalTests \
  --target-org production \
  --wait 60 \
  --json)

STATUS=$(echo "$RESULT" | jq -r '.result.status')
if [ "$STATUS" != "Succeeded" ]; then
  echo "Deployment failed: $STATUS"
  echo "$RESULT" | jq '.result.details.componentFailures'
  exit 1
fi
```

### Key fields in the JSON result:

- `.result.status` — `Succeeded`, `Failed`, `InProgress`, `Canceled`.
- `.result.id` — the deployment job ID (0Af prefix).
- `.result.details.componentFailures` — array of failed components with error messages.
- `.result.details.runTestResult.failures` — array of test failures.
- `.result.details.runTestResult.codeCoverageWarnings` — classes below the coverage threshold.

---

## Deployment Rollback

Salesforce does not have a native one-click rollback mechanism. Rollback strategies:

### Strategy 1: Re-deploy the previous Git commit

The most reliable rollback. Check out the previous commit and re-deploy.

```bash
# Find the last good commit
git log --oneline

# Check out the last good state
git checkout abc1234 -- force-app/

# Re-deploy
sf project deploy start \
  --source-dir force-app \
  --test-level RunLocalTests \
  --target-org production \
  --wait 60
```

### Strategy 2: Use a checkonly deployment ID from before the bad deploy

If you stored the deployment ID from a previous successful `--checkonly`, and the 10-day window has not expired, you can quick-deploy that earlier validation.

### Strategy 3: Destructive changes to remove newly added components

If the failed deployment added new components that are now causing issues, delete them using `destructiveChanges.xml`.

### What cannot be easily rolled back:

- Deleted custom fields (data is permanently gone).
- Promoted package versions (cannot be un-promoted).
- Record data changes made by Apex that ran during deployment.
- Flow/Process Builder invocations triggered by test data.

---

## `--ignore-errors` and `--ignore-conflicts` — Use Cases and Risks

### `--ignore-errors`

Allows a deployment to "succeed" even if some components fail. Only use in sandboxes and only when you intentionally accept partial deployment (e.g., deploying a known-broken component to inspect its behavior).

Never use in production. In production, all or nothing is the correct behavior.

### `--ignore-conflicts`

Bypasses conflict detection from source tracking. Use in CI pipelines where the repository is authoritative and you expect (and intend to overwrite) any org-side changes.

Document this decision in your pipeline README. When a developer makes a quick fix directly in the sandbox, `--ignore-conflicts` in the next CI run will silently overwrite it. Team awareness is required.

Always run `sf project deploy preview --target-org mySandbox` before using `--ignore-conflicts` to verify what will be overwritten.
