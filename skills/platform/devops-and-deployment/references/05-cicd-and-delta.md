# 05 — CI/CD and Delta Deployment: GitHub Actions, Bitbucket Pipelines, JWT Auth, and sgd

## Branch Strategy Recommendation

For Salesforce source-driven projects, a trunk-based or Gitflow-style branch strategy works well:

```
main                         ← production-ready; protected; deploys to production on merge
  └─ staging                 ← pre-production; mirrors production config
       └─ develop / integration ← shared integration branch; CI deploys to integration sandbox
            └─ feature/XXX   ← individual developer feature branches; validates against integration sandbox
```

Branch protection rules (enforce on all teams):
- `main` — require PR + 1 approval + passing CI + `--checkonly` validation against production.
- `integration` — require PR + passing CI + `--checkonly` validation against integration sandbox.
- `feature/*` — no required approvals, but CI runs `--checkonly` to catch compilation errors.

---

## GitHub Actions: Full Workflow Examples

### Validate on Pull Request (`validate.yml`)

```yaml
name: Validate PR

on:
  pull_request:
    branches: [integration, main]

jobs:
  validate:
    runs-on: ubuntu-latest
    env:
      SF_CONSUMER_KEY: ${{ secrets.SF_CONSUMER_KEY }}
      SF_USERNAME: ${{ secrets.SF_USERNAME_SANDBOX }}
      SF_JWT_KEY: ${{ secrets.SF_JWT_KEY }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Salesforce CLI
        run: npm install --global @salesforce/cli@latest

      - name: Write JWT key
        run: echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key

      - name: Authenticate to integration sandbox
        run: |
          sf org login jwt \
            --client-id "$SF_CONSUMER_KEY" \
            --jwt-key-file /tmp/server.key \
            --username "$SF_USERNAME" \
            --alias integration-sandbox \
            --set-default \
            --instance-url https://test.salesforce.com

      - name: Validate (checkonly)
        run: |
          sf project deploy start \
            --checkonly \
            --test-level RunLocalTests \
            --source-dir force-app \
            --target-org integration-sandbox \
            --wait 60 \
            --verbose

      - name: Cleanup JWT key
        if: always()
        run: rm -f /tmp/server.key
```

---

### Deploy on Merge to Integration (`deploy-integration.yml`)

```yaml
name: Deploy to Integration Sandbox

on:
  push:
    branches: [integration]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      SF_CONSUMER_KEY: ${{ secrets.SF_CONSUMER_KEY }}
      SF_USERNAME: ${{ secrets.SF_USERNAME_SANDBOX }}
      SF_JWT_KEY: ${{ secrets.SF_JWT_KEY }}
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Salesforce CLI
        run: npm install --global @salesforce/cli@latest

      - name: Install sfdx-git-delta
        run: echo y | sf plugins install sfdx-git-delta

      - name: Write JWT key
        run: echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key

      - name: Authenticate to integration sandbox
        run: |
          sf org login jwt \
            --client-id "$SF_CONSUMER_KEY" \
            --jwt-key-file /tmp/server.key \
            --username "$SF_USERNAME" \
            --alias integration-sandbox \
            --set-default \
            --instance-url https://test.salesforce.com

      - name: Generate delta package
        run: |
          mkdir -p delta
          sf sgd source delta \
            --to HEAD \
            --from HEAD~1 \
            --output delta/ \
            --source-dir force-app

      - name: Deploy delta
        run: |
          sf project deploy start \
            --manifest delta/package/package.xml \
            --test-level RunLocalTests \
            --target-org integration-sandbox \
            --wait 60 \
            --verbose

      - name: Deploy destructive changes (if any)
        if: hashFiles('delta/destructiveChanges/destructiveChanges.xml') != ''
        run: |
          sf project deploy start \
            --manifest delta/destructiveChanges/destructiveChanges.xml \
            --target-org integration-sandbox \
            --wait 30

      - name: Notify Slack on success
        if: success()
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":white_check_mark: Deployed to integration sandbox — ${{ github.ref_name }} @ ${{ github.sha }}"
            }

      - name: Notify Slack on failure
        if: failure()
        uses: slackapi/slack-github-action@v2
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":x: Integration sandbox deployment failed — ${{ github.ref_name }} @ ${{ github.sha }}. See: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
            }

      - name: Cleanup JWT key
        if: always()
        run: rm -f /tmp/server.key
```

---

### Deploy to Production with Quick Deploy (`deploy-production.yml`)

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  validate-and-deploy:
    runs-on: ubuntu-latest
    env:
      SF_CONSUMER_KEY_PROD: ${{ secrets.SF_CONSUMER_KEY_PROD }}
      SF_USERNAME_PROD: ${{ secrets.SF_USERNAME_PROD }}
      SF_JWT_KEY_PROD: ${{ secrets.SF_JWT_KEY_PROD }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Salesforce CLI
        run: npm install --global @salesforce/cli@latest

      - name: Write JWT key
        run: echo "$SF_JWT_KEY_PROD" | base64 --decode > /tmp/server-prod.key

      - name: Authenticate to production
        run: |
          sf org login jwt \
            --client-id "$SF_CONSUMER_KEY_PROD" \
            --jwt-key-file /tmp/server-prod.key \
            --username "$SF_USERNAME_PROD" \
            --alias production \
            --set-default \
            --instance-url https://login.salesforce.com

      - name: Validate (checkonly) and capture deployment ID
        id: validate
        run: |
          RESULT=$(sf project deploy start \
            --checkonly \
            --test-level RunLocalTests \
            --source-dir force-app \
            --target-org production \
            --wait 90 \
            --json)
          echo "$RESULT" | jq .
          DEPLOY_ID=$(echo "$RESULT" | jq -r '.result.id')
          echo "deploy_id=$DEPLOY_ID" >> "$GITHUB_OUTPUT"

      - name: Quick deploy (uses validated deployment ID)
        run: |
          sf project deploy quick \
            --job-id "${{ steps.validate.outputs.deploy_id }}" \
            --target-org production \
            --wait 30

      - name: Cleanup JWT key
        if: always()
        run: rm -f /tmp/server-prod.key
```

---

## Bitbucket Pipelines Equivalent

```yaml
# bitbucket-pipelines.yml
image: node:20

definitions:
  steps:
    - step: &install-sf-cli
        name: Install Salesforce CLI
        script:
          - npm install --global @salesforce/cli@latest
          - sf version
        caches:
          - node

pipelines:
  pull-requests:
    '**':
      - step:
          <<: *install-sf-cli
          name: Validate PR
          script:
            - echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key
            - sf org login jwt --client-id "$SF_CONSUMER_KEY" --jwt-key-file /tmp/server.key --username "$SF_USERNAME" --alias sandbox --set-default --instance-url https://test.salesforce.com
            - sf project deploy start --checkonly --test-level RunLocalTests --source-dir force-app --target-org sandbox --wait 60
          after-script:
            - rm -f /tmp/server.key

  branches:
    integration:
      - step:
          name: Deploy to Integration Sandbox
          script:
            - npm install --global @salesforce/cli@latest
            - echo y | sf plugins install sfdx-git-delta
            - echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key
            - sf org login jwt --client-id "$SF_CONSUMER_KEY" --jwt-key-file /tmp/server.key --username "$SF_USERNAME" --alias sandbox --set-default --instance-url https://test.salesforce.com
            - mkdir -p delta
            - sf sgd source delta --to HEAD --from HEAD~1 --output delta/ --source-dir force-app
            - sf project deploy start --manifest delta/package/package.xml --test-level RunLocalTests --target-org sandbox --wait 60
          after-script:
            - rm -f /tmp/server.key
```

---

## Azure DevOps Pipeline Equivalent

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include:
      - integration
      - main

pool:
  vmImage: ubuntu-latest

stages:
  - stage: Validate
    condition: eq(variables['Build.Reason'], 'PullRequest')
    jobs:
      - job: ValidatePR
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '20.x'

          - script: npm install --global @salesforce/cli@latest
            displayName: Install Salesforce CLI

          - script: |
              echo "$(SF_JWT_KEY)" | base64 --decode > /tmp/server.key
              sf org login jwt \
                --client-id "$(SF_CONSUMER_KEY)" \
                --jwt-key-file /tmp/server.key \
                --username "$(SF_USERNAME)" \
                --alias integration-sandbox \
                --set-default \
                --instance-url https://test.salesforce.com
            displayName: Authenticate to Sandbox
            env:
              SF_JWT_KEY: $(SF_JWT_KEY)
              SF_CONSUMER_KEY: $(SF_CONSUMER_KEY)
              SF_USERNAME: $(SF_USERNAME)

          - script: |
              sf project deploy start \
                --checkonly \
                --test-level RunLocalTests \
                --source-dir force-app \
                --target-org integration-sandbox \
                --wait 60
            displayName: Validate (checkonly)

          - script: rm -f /tmp/server.key
            displayName: Cleanup
            condition: always()
```

---

## Delta Deployment with sfdx-git-delta (sgd)

Full deployments push the entire project on every run, which is slow and increases risk. Delta deployments push only what changed between commits.

### Install sfdx-git-delta:

```bash
echo y | sf plugins install sfdx-git-delta
```

### Basic usage:

```bash
sf sgd source delta \
  --to HEAD \
  --from origin/main \
  --output delta/ \
  --source-dir force-app
```

- `--to` — the "new" commit (usually `HEAD` or the feature branch tip).
- `--from` — the "old" commit (usually the last deployed commit or the base branch).
- `--output` — the directory where the delta artifacts are generated.
- `--source-dir` — the source root to compare (matches `sfdx-project.json` path).

### Output structure:

```
delta/
  package/
    package.xml            ← lists all added/modified components
  destructiveChanges/
    destructiveChanges.xml ← lists all deleted components
  force-app/               ← source files matching the delta
```

### Deploy the delta:

```bash
# Deploy added/modified components
sf project deploy start \
  --manifest delta/package/package.xml \
  --test-level RunLocalTests \
  --target-org integration-sandbox \
  --wait 60

# Deploy destructive changes (if any deleted components)
if [ -s delta/destructiveChanges/destructiveChanges.xml ]; then
  sf project deploy start \
    --manifest delta/destructiveChanges/destructiveChanges.xml \
    --target-org integration-sandbox \
    --wait 30
fi
```

### Using a stored last-deployed commit:

In production pipelines, track the last deployed commit SHA rather than relying on `HEAD~1` (which breaks on squash merges):

```bash
# After a successful deployment, store the SHA
echo "$GITHUB_SHA" > .last-deployed-sha
git add .last-deployed-sha
git commit -m "ci: update last deployed SHA"
git push

# Before next deployment, use the stored SHA
LAST_SHA=$(cat .last-deployed-sha)
sf sgd source delta \
  --to HEAD \
  --from "$LAST_SHA" \
  --output delta/ \
  --source-dir force-app
```

Alternatively, use a Git tag (`last-deployed-production`) and move it after each successful deployment.

---

## CI Code Coverage Gate

In CI, validate that code coverage meets the 75% threshold before merging. The `--code-coverage` flag on `sf package version create` enforces this for packages. For non-package orgs, parse the deployment JSON result:

```bash
RESULT=$(sf project deploy start \
  --checkonly \
  --test-level RunLocalTests \
  --source-dir force-app \
  --target-org sandbox \
  --wait 60 \
  --json)

# Check for code coverage warnings
WARNINGS=$(echo "$RESULT" | jq '.result.details.runTestResult.codeCoverageWarnings')
if [ "$WARNINGS" != "null" ] && [ "$WARNINGS" != "[]" ]; then
  echo "Code coverage warnings detected:"
  echo "$WARNINGS" | jq .
fi

# Check deployment status
STATUS=$(echo "$RESULT" | jq -r '.result.status')
if [ "$STATUS" != "Succeeded" ]; then
  echo "Deployment validation failed: $STATUS"
  echo "$RESULT" | jq '.result.details.componentFailures, .result.details.runTestResult.failures'
  exit 1
fi
```

---

## CI Secrets Management Best Practices

| Secret | Recommended storage |
|---|---|
| JWT private key (`server.key`) | Base64-encoded, stored as CI environment secret. Decoded to a temp file at runtime; deleted after auth. Never committed to the repository. |
| Consumer key | CI environment secret. Do not embed in workflow YAML. |
| Username | CI environment secret (differs per env: sandbox vs production). |
| Slack webhook URL | CI environment secret. |
| Installation key for packages | CI environment secret. |

**Per-environment secrets:** Use separate secrets per environment (integration, UAT, production). In GitHub Actions, use environments (`environment: production`) with environment-scoped secrets and required reviewers for production deployments.

```yaml
jobs:
  deploy-prod:
    environment: production           # ← triggers required reviewers gate
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate to production
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY_PROD }}    # ← from environment secrets
          SF_CONSUMER_KEY: ${{ secrets.SF_CONSUMER_KEY_PROD }}
          SF_USERNAME: ${{ secrets.SF_USERNAME_PROD }}
        run: |
          echo "$SF_JWT_KEY" | base64 --decode > /tmp/server.key
          sf org login jwt ...
```

---

## Notification Patterns

### Slack (slackapi/slack-github-action)

```yaml
- name: Notify Slack
  if: always()
  uses: slackapi/slack-github-action@v2
  with:
    webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
    webhook-type: incoming-webhook
    payload: |
      {
        "text": "${{ job.status == 'success' && ':white_check_mark:' || ':x:' }} Salesforce deployment to ${{ vars.TARGET_ENV }} — ${{ job.status }} — <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View run>"
      }
```

### Microsoft Teams

```yaml
- name: Notify Teams
  if: always()
  uses: aliencube/microsoft-teams-actions@v0.8.0
  with:
    webhook_uri: ${{ secrets.TEAMS_WEBHOOK_URL }}
    title: "Salesforce Deployment"
    summary: "Deployment to ${{ vars.TARGET_ENV }} ${{ job.status }}"
    theme_color: "${{ job.status == 'success' && '0076D7' || 'D40000' }}"
```
