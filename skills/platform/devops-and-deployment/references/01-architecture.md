# 01 — Architecture: Development Models, Environment Pipeline, and Metadata Formats

## Development Model Comparison

Salesforce projects operate under one of three development models. Understanding which model applies to your org determines which tools and processes are appropriate.

### Org-Based Development (Change Sets)

The legacy model. Changes are made directly in a sandbox org through the Setup UI or Apex IDE, then migrated to other orgs via **Change Sets** (Outbound/Inbound Change Sets). No version control is inherent to this model — version control must be bolted on manually.

Characteristics:
- Changes originate in an org, not in a repository.
- Change sets are point-in-time snapshots; they cannot be merged or diffed.
- Deployments are manual UI operations.
- Rollback requires a previous change set or manual reverse operation.
- No concept of a package or version — the org is the artifact.

Limitations:
- Change sets cannot delete components (destructive changes are not supported).
- Change sets do not support all metadata types.
- No automated testing gate in the change set itself (tests run at deployment time only).
- Difficult to enforce code review or branching strategies.

**When still in use:** Organizations that have not yet migrated to source-driven development. Change sets remain a valid deployment mechanism but are considered legacy. New projects should not be started with a change-set-only model.

---

### Source-Driven Development (SFDX + Sandboxes)

The current recommended model for orgs that are not packaging their components. Source lives in a Git repository in **source format** (one file per metadata component, directory structure mirrors the component tree). The CLI (`sf`) is the deployment tool.

Characteristics:
- The Git repository is the source of truth.
- Sandboxes are ephemeral environments that receive deployments from source.
- Source tracking in scratch orgs and source-tracked sandboxes detects drift.
- Deployments are CLI commands (`sf project deploy start`) executable in CI/CD.
- Rollback is a re-deployment of the previous Git commit.

Environment pipeline example:
```
Developer Machine (local)
       |
       | sf project deploy start
       v
Feature Scratch Org (or Developer Sandbox)
       |
       | Pull Request → CI validates via --checkonly
       v
Integration Sandbox (source of truth for shared development)
       |
       | Merge to main → CI deploys
       v
UAT Sandbox (user acceptance testing)
       |
       | Manual approval gate
       v
Production Org
```

---

### Package-Based Development (2GP Unlocked / Managed Packages)

The model for ISVs and mature DevOps teams. Metadata is grouped into discrete, versionable units called **packages**. Each package has a version ID, a release state (beta or released), and an install/upgrade lifecycle.

Characteristics:
- Each package is a deployable artifact with an immutable version.
- Package versions are installed in subscriber orgs with `sf package install`.
- Dependencies between packages are declared and enforced.
- Rollback is installing a prior released version (subject to field/object deletion restrictions).
- Code coverage is enforced at package version creation time (`--code-coverage`).

Package types:
- **Unlocked Package** — flexible, components can be modified in subscriber orgs (with some restrictions), no namespace required.
- **Managed Package** — namespace required, code is locked/protected, distributed via AppExchange; supports 1GP (first-gen) and 2GP (second-gen).
- **Org-Dependent Unlocked Package** — components can reference org metadata not in the package; useful for org-specific customization layers.

---

## Environment Pipeline: Standard Topology

```
[Dev Hub Org]
      |
      |-- (creates) --> [Scratch Org: Feature Work, n-day expiry]
      |
[Source Repository (Git)]
      |
      |-- CI/CD --> [Integration Sandbox]   (shared dev integration)
      |                    |
      |             [QA / UAT Sandbox]       (testing and acceptance)
      |                    |
      |             [Staging Sandbox]        (pre-prod; full-copy preferred)
      |                    |
      |             [Production Org]         (live; requires 75% coverage + test run)
```

**Org types by sandbox license:**
- **Developer Sandbox** — metadata-only copy, 200 MB data; source tracking available on Developer Pro.
- **Developer Pro Sandbox** — metadata + 1 GB data; source tracking available.
- **Partial Copy Sandbox** — metadata + sample data; suitable for integration testing.
- **Full Copy Sandbox** — full data copy of production; suitable for load/regression testing.

---

## Metadata API vs Source API

### Metadata API

The original programmatic interface for deploying Salesforce metadata. Works with **metadata format** (sometimes called "mdapi format"): a flat directory with `package.xml` at the root, and all metadata in `unpackaged/` or similar directories.

Key facts:
- Used by `sf project deploy start --metadata-dir` when the source is in metadata format.
- Retrieved files are in `.<MetadataType>-meta.xml` extension pattern, combined per component (e.g., a single XML file for an entire object).
- Required for deploying from legacy tooling or when integrating with non-SFDX tools.

### Source API (Source Format)

The modern format introduced with SFDX. Metadata is decomposed into granular files — one file per component, with directories matching the component hierarchy. This format is what `sf project retrieve start` produces by default.

Key facts:
- One `CustomObject` (`Account`) becomes `objects/Account/Account.object-meta.xml`, `objects/Account/fields/MyField__c.field-meta.xml`, etc.
- Source format files end in `-meta.xml`.
- All `sf project deploy start --source-dir` operations use source format.
- Source format is compatible with Git diff workflows because changes to individual fields are isolated to individual files.

**Converting between formats:**
```bash
# Convert source format to metadata format
sf project convert source --source-dir force-app --output-dir mdapi-output

# Convert metadata format to source format
sf project convert mdapi --metadata-dir mdapi-output --output-dir force-app
```

---

## sfdx-project.json Structure

`sfdx-project.json` is the configuration file for a Salesforce DX project. It lives at the repository root.

```json
{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true,
      "package": "MyUnlockedPackage",
      "versionName": "Spring 2025",
      "versionNumber": "1.3.0.NEXT",
      "dependencies": [
        {
          "package": "DependencyPackage",
          "versionNumber": "2.1.0.LATEST"
        }
      ]
    }
  ],
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "61.0",
  "packageAliases": {
    "MyUnlockedPackage": "0HoXXXXXXXXXXXXX",
    "MyUnlockedPackage@1.3.0-1": "04tXXXXXXXXXXXXX",
    "DependencyPackage": "0HoYYYYYYYYYYYYY",
    "DependencyPackage@2.1.0-1": "04tYYYYYYYYYYYYY"
  }
}
```

Key fields:
- `packageDirectories` — array of source directories and (optionally) package configurations.
- `path` — relative path to the source directory.
- `default: true` — the default package directory used by `sf project deploy start` when no `--source-dir` is specified.
- `namespace` — empty string for unlocked packages, namespace string for managed packages.
- `sourceApiVersion` — the Salesforce API version used for source format files. Should match or exceed the org API version being targeted.
- `packageAliases` — maps human-readable names to Salesforce IDs for packages (0Ho prefix) and package versions (04t prefix).

---

## sf CLI Command Taxonomy

The `sf` CLI follows the pattern: `sf <topic> <subtopic> <action> [flags]`.

| Topic | Subtopic | Action | Description |
|---|---|---|---|
| `project` | `deploy` | `start` | Deploy source to an org |
| `project` | `deploy` | `quick` | Quick-deploy a validated deployment |
| `project` | `deploy` | `cancel` | Cancel an in-progress deployment |
| `project` | `deploy` | `report` | Check deployment status |
| `project` | `deploy` | `preview` | Preview what will be deployed (dry run without deploy) |
| `project` | `retrieve` | `start` | Retrieve source from an org |
| `project` | `retrieve` | `preview` | Preview what will be retrieved |
| `project` | `convert` | `source` | Convert source format to metadata format |
| `project` | `convert` | `mdapi` | Convert metadata format to source format |
| `org` | `create` | `scratch` | Create a scratch org |
| `org` | `create` | `sandbox` | Create a sandbox (requires production org) |
| `org` | `login` | `jwt` | Authenticate using JWT bearer flow (CI) |
| `org` | `login` | `web` | Authenticate using browser OAuth |
| `org` | `logout` | — | Remove org authentication |
| `org` | `display` | — | Show org details (alias, instance URL, expiry) |
| `org` | `list` | — | List all authenticated orgs |
| `org` | `delete` | `scratch` | Delete a scratch org |
| `package` | — | `create` | Create a new package definition |
| `package` | `version` | `create` | Create a new package version |
| `package` | `version` | `promote` | Promote a package version to released |
| `package` | `version` | `list` | List package versions |
| `package` | `version` | `report` | Show package version details |
| `package` | — | `install` | Install a package version in an org |
| `package` | `installed` | `list` | List installed packages in an org |
| `apex` | `run` | — | Execute anonymous Apex |
| `apex` | `run` | `test` | Run Apex tests |
| `data` | `query` | — | Execute a SOQL query |
| `data` | `export` | `tree` | Export record data for seeding |
| `data` | `import` | `tree` | Import record data |
