# 04 — Packaging: Unlocked Packages, Managed Packages, 2GP, and Version Lifecycle

## Package Type Comparison

| Attribute | Unlocked Package | Managed Package (2GP) | Org-Dependent Unlocked |
|---|---|---|---|
| Namespace required | No | Yes | No |
| Code visible to subscribers | Yes | Obfuscated (protected Apex) | Yes |
| Components modifiable by subscribers | Most types | No | Most types |
| Can reference org metadata outside package | No (strict) | No (strict) | Yes |
| Distributed via AppExchange | No | Yes | No |
| Version promotable | Yes | Yes | Yes |
| Ancestry enforcement | No | Yes (ancestor chain) | No |
| Suitable for ISV distribution | Not recommended | Yes | No |
| Suitable for enterprise modular development | Yes | Depends | Limited (org-tied) |

---

## 2GP vs 1GP

### First-Generation Packaging (1GP)

1GP uses a legacy toolset and Packaging org. It requires a Packaging org to create managed packages, and version creation is done through the UI or legacy `sfdx` commands. 1GP is still supported but not recommended for new projects.

Limitations of 1GP:
- Package creation happens in a special Packaging org, separate from the Dev Hub.
- Limited automation support.
- Cannot use scratch orgs for package version creation.
- Metadata types supported are more limited.

### Second-Generation Packaging (2GP)

2GP is the current standard. Package creation and version management happen entirely through the CLI, driven by `sfdx-project.json`, with the Dev Hub as the control plane.

2GP advantages:
- Full scratch org support for package development and testing.
- `sf package version create` is fully automated.
- Package versions are created in scratch orgs (isolated, reproducible).
- Dependency management is declared in `sfdx-project.json`.
- Supports both unlocked and managed packages.

---

## Unlocked Packages

Unlocked packages are the recommended model for modular development within an enterprise (internal use, not AppExchange distribution). They provide version control for metadata without the restrictions of managed packages.

### Key properties:

- **No namespace required** — components retain their original API names in subscriber orgs.
- **Subscriber org can modify components** — Apex classes, objects, and fields installed from an unlocked package can be modified directly in the subscriber org. However, upgrading the package to a new version will overwrite those modifications.
- **Strict mode vs. lenient mode** — By default, unlocked packages use a "strict" validation mode that prevents references to metadata not included in the package. Org-dependent unlocked packages relax this restriction.

### Package creation:

```bash
# Create the package definition (one time)
sf package create \
  --name "MyUnlockedPackage" \
  --package-type Unlocked \
  --path force-app \
  --target-dev-hub DevHub

# Output: Package ID (0Ho prefix) — save in packageAliases in sfdx-project.json
```

### Package version creation:

```bash
# Create a new version (beta by default)
sf package version create \
  --package MyUnlockedPackage \
  --installation-key-bypass \
  --code-coverage \
  --wait 30 \
  --target-dev-hub DevHub

# With an installation key (subscribers need the key to install)
sf package version create \
  --package MyUnlockedPackage \
  --installation-key "mySecretKey" \
  --code-coverage \
  --wait 30
```

The `--code-coverage` flag enforces 75% Apex code coverage across the package. If coverage is insufficient, version creation fails. This is the correct gate — do not skip it.

The output includes the subscriber package version ID (`04t` prefix). Add it to `packageAliases` in `sfdx-project.json`.

---

## Managed Packages (2GP)

Managed packages require a namespace. The namespace must be registered in a Dev Hub org and linked to the package project.

### Key properties:

- **Namespace prefix on all API names** — `myns__ClassName`, `myns__ObjectName__c`, `myns__FieldName__c`.
- **Apex is obfuscated** — subscribers see method signatures but not implementation (for non-global classes).
- **Components cannot be deleted after release** — once a managed package version is released and installed in subscriber orgs, you cannot remove components from subsequent versions (only deprecate them).
- **Ancestry chain required** — each new managed package version must declare the previous released version as its ancestor. This enforces an upgrade path.

### Namespace setup:

1. Register a namespace in a Developer Edition org (Setup > Package Manager > Developer Settings).
2. Link the namespace org to the Dev Hub (Setup > Dev Hub > Link Namespace Org).
3. Set `"namespace": "myns"` in `sfdx-project.json`.

### Ancestor version requirement:

For managed 2GP packages, each version must specify an ancestor:

```json
{
  "packageDirectories": [
    {
      "path": "force-app",
      "package": "MyManagedPackage",
      "versionNumber": "2.0.0.NEXT",
      "ancestorVersion": "1.5.0.RELEASED"
    }
  ]
}
```

The ancestor must be a released version. Setting `"ancestorId": "HIGHEST"` automatically uses the most recent released version as the ancestor.

---

## sfdx-project.json packageAliases

Every package ID and package version ID referenced in the project should have an alias. The alias maps to either a package ID (`0Ho` prefix) or a package version ID (`04t` prefix).

```json
"packageAliases": {
  "MyUnlockedPackage": "0HoXXXXXXXXXXXXXXXX",
  "MyUnlockedPackage@1.0.0-1": "04tAAAAAAAAAAAAAAAA",
  "MyUnlockedPackage@1.1.0-1": "04tBBBBBBBBBBBBBBBB",
  "MyUnlockedPackage@1.2.0-1": "04tCCCCCCCCCCCCCCCC",
  "DependencyPackage": "0HoYYYYYYYYYYYYYYYY",
  "DependencyPackage@2.0.0-1": "04tDDDDDDDDDDDDDDDD"
}
```

When referencing a package in `--package` flags, you can use either the alias or the raw ID.

---

## Package Version Lifecycle

```
sf package version create
        |
        v
  [Beta Version]
  (04t prefix, not yet released)
  Can install in scratch orgs and sandboxes
  Cannot install in production
        |
        v
  sf package version promote
        |
        v
  [Released Version]
  (irreversible — cannot be un-promoted)
  Can install in scratch orgs, sandboxes, AND production
  Included in AppExchange listings (for managed packages)
```

### Beta versions:

- Install anywhere except production.
- Useful for UAT and integration testing before promotion.
- Can be created as many times as needed while iterating.

### Promoting a version:

```bash
sf package version promote \
  --package "MyUnlockedPackage@1.3.0-1" \
  --target-dev-hub DevHub

# Or by 04t ID directly
sf package version promote \
  --package 04tXXXXXXXXXXXXXXXX \
  --target-dev-hub DevHub
```

Promotion is **irreversible**. Once promoted, the version cannot be demoted. You can create a new beta version with a higher version number to supersede it, but the promoted version remains in its released state.

### Listing versions:

```bash
sf package version list \
  --packages MyUnlockedPackage \
  --target-dev-hub DevHub \
  --order-by CreatedDate \
  --verbose
```

### Version report:

```bash
sf package version report \
  --package "MyUnlockedPackage@1.3.0-1" \
  --target-dev-hub DevHub
```

---

## Package Installation

### Install a package version in an org:

```bash
sf package install \
  --package "MyUnlockedPackage@1.3.0-1" \
  --target-org integration-sandbox \
  --installation-key-bypass \
  --wait 20 \
  --publish-wait 10
```

- `--installation-key-bypass` — bypass the installation key check (only works if the version was created with `--installation-key-bypass`).
- `--installation-key <key>` — provide the key if the version was created with one.
- `--publish-wait` — wait for the package to be published to the Salesforce package registry before installing.
- `--upgrade-type` — `Mixed` (default), `DeprecateOnly`, or `Delete`. Controls how deprecated components are handled during upgrade.

### Install in dependency order:

Dependencies must be installed before the dependent package. Salesforce validates dependency resolution at install time and returns `PACKAGE_DEPENDENCY_NOT_MET` if a required package version is missing or the wrong version.

```bash
# Install foundation package first
sf package install \
  --package "MyFoundationPackage@2.0.0-1" \
  --target-org integration-sandbox \
  --wait 20

# Install dependent package second
sf package install \
  --package "MyUnlockedPackage@1.3.0-1" \
  --target-org integration-sandbox \
  --wait 20
```

### Verify installed packages:

```bash
sf package installed list --target-org integration-sandbox
```

---

## Package Upgrade Considerations

### Unlocked package upgrades:

- Upgrading to a new version **overwrites** components with the package version's content.
- If a subscriber modified a class from the package directly in the org, that modification is overwritten by the upgrade.
- New components in the new version are added.
- Removed components in the new version are handled based on `--upgrade-type`:
  - `Mixed` — deprecated components remain in the org until explicitly deleted.
  - `DeprecateOnly` — deprecated components are marked deprecated.
  - `Delete` — deprecated components are deleted (requires subscriber opt-in).

### Managed package upgrades:

- Subscribers cannot modify managed components directly.
- New versions add new components; they cannot remove field data (fields may be deprecated but data is preserved until a subscriber explicitly deletes the field after uninstall or deprecation).
- Breaking changes (removing global Apex methods, renaming API names) are restricted — managed packages have stricter compatibility rules.

### Org-dependent unlocked packages:

- These packages reference org metadata not contained in the package. They are tied to a specific org (or org type) and cannot be freely installed across arbitrary orgs.
- Useful for capturing an org's customization layer incrementally, but introduces tight coupling to the target org's metadata state.
