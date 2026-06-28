# Producer Hierarchy — Setup and Deployment

## Required features and licenses

| Feature | Required for | Notes |
|---|---|---|
| FSC Insurance | All producer hierarchy work | Base FSC Insurance features |
| FSCInsurancePsl | Standard `ProducerRelationship` object | Zero-seat default in most orgs — see custom object fallback |
| Contacts to Multiple Accounts | `AccountContactRelation` multi-firm affiliations | Enabled in Setup → Account Settings |

---

## Permission sets

| Permission Set | Purpose |
|---|---|
| `FSCInsurance` | Base FSC Insurance object access — Producer, InsurancePolicy, InsurancePolicyParticipant |
| `FSCInsuranceBilling` | BillingAccount and billing-related fields |
| `InsProducerRelationship_Access` | Full CRUD on InsProducerRelationship__c (custom hierarchy object) |

### InsProducerRelationship_Access permission set

When `InsProducerRelationship__c` is deployed, assign `InsProducerRelationship_Access` to all users who manage producer hierarchy records.

Object permissions granted:
- Read, Create, Edit, Delete, View All Records, Modify All Records: **true**

Field permissions (Read + Edit = true for all):
- `Role__c`, `StartDate__c`, `EndDate__c`, `IsActive__c`
- `RelationshipType__c`, `Description__c`, `ExternalId__c`

---

## Custom object: InsProducerRelationship__c

Deploy this object when the org does not have `FSCInsurancePsl` seats allocated.

### Object properties

| Property | Value |
|---|---|
| API Name | `InsProducerRelationship__c` |
| Label | Insurance Producer Relationship |
| Plural Label | Insurance Producer Relationships |
| Sharing Model | ReadWrite |
| Enable History | true |
| Enable Reports | true |
| Enable Search | true |
| Name Field Type | Text (`Relationship Name`) |

### Custom fields

| Field Label | API Name | Type | Required | Notes |
|---|---|---|---|---|
| Parent Producer | `ParentProducerId__c` | Lookup(Producer) | Yes | `deleteConstraint=Restrict`. Parent in the hierarchy (agency, DST, RTF above the child) |
| Child Producer | `ChildProducerId__c` | Lookup(Producer) | Yes | `deleteConstraint=Restrict`. Child in the hierarchy (agent or sub-agency below the parent) |
| Role | `Role__c` | Picklist (open) | No | `Employee / Staff Representative`, `Corporate Officer / Principal`, `Affiliated Corporate Broker`, `Independent Contractor`, `Supervising Agent`, `Sub-Agent`, `Managing General Agent`, `General Agent`, `Wholesale Broker` |
| Relationship Type | `RelationshipType__c` | Picklist (restricted) | No | `Hierarchical` (default), `Affiliated`, `Supervisory`, `Contractual` |
| Start Date | `StartDate__c` | Date | No | Date relationship became effective |
| End Date | `EndDate__c` | Date | No | Blank = ongoing |
| Is Active | `IsActive__c` | Checkbox | — | Default = true |
| Description | `Description__c` | LongTextArea(32768) | No | 3 visible lines |
| External ID | `ExternalId__c` | Text(255) | No | Unique, externalId, caseSensitive = false |

### Delete constraint enforcement

Both lookup fields (`ParentProducerId__c`, `ChildProducerId__c`) use `deleteConstraint=Restrict`. A `Producer` cannot be deleted while referenced in any `InsProducerRelationship__c` record. This mirrors the standard `ProducerRelationship` constraint.

---

## SFDX deployment

### Project structure

```
fsc-insurance/
├── sfdx-project.json
├── config/
│   └── project-scratch-def.json
└── force-app/main/default/
    ├── objects/
    │   └── InsProducerRelationship__c/
    │       ├── InsProducerRelationship__c.object-meta.xml
    │       └── fields/
    │           ├── ChildProducerId__c.field-meta.xml
    │           ├── Description__c.field-meta.xml
    │           ├── EndDate__c.field-meta.xml
    │           ├── ExternalId__c.field-meta.xml
    │           ├── IsActive__c.field-meta.xml
    │           ├── ParentProducerId__c.field-meta.xml
    │           ├── RelationshipType__c.field-meta.xml
    │           ├── Role__c.field-meta.xml
    │           └── StartDate__c.field-meta.xml
    ├── layouts/
    │   ├── Account-Account Layout.layout-meta.xml
    │   ├── Contact-Contact Layout.layout-meta.xml
    │   ├── InsProducerRelationship__c-Insurance Producer Relationship Layout.layout-meta.xml
    │   ├── InsurancePolicy-Insurance Policy Layout.layout-meta.xml
    │   └── Producer-Producer Layout.layout-meta.xml
    └── permissionsets/
        └── InsProducerRelationship_Access.permissionset-meta.xml
```

### Deploy command

```bash
sf project deploy start \
  --source-dir force-app \
  --target-org <ORG_ALIAS> \
  --wait 10
```

---

## Known API constraints (API 65.0)

These constraints apply at API 65.0 and require manual workarounds:

| Constraint | Detail | Workaround |
|---|---|---|
| `BusinessLicense` not deployable as Account related list | Layout XML with `BusinessLicense` in Account's `relatedLists` fails deployment | Add manually: Setup → Object Manager → Account → Page Layouts → drag "Business Licenses" |
| `DistributorAuthorization` not deployable as Account related list | Same constraint | Add manually: drag "Distributor Authorizations" onto Account layout |
| `relatedListType=Enhanced` not supported in layout XML | Including this attribute causes deployment error | Omit entirely from XML; configure via UI if needed |
| `ProducerPolicyAssignment` NAME field not valid as layout column | Specifying NAME as a PPA related list column on Insurance Policy or Producer layout fails | Use default columns; customize via UI |
| `InsProducerRelationship__c` related lists not deployable on Producer layout | Custom object related lists on standard FSC object layouts cannot be resolved by Metadata API | Add manually after deployment |
| Standard `ProducerRelationship` gated by `FSCInsurancePsl` | Requires license seats | Use `InsProducerRelationship__c` as custom proxy |

---

## Post-deployment manual steps (every fresh org)

These steps must be performed through the Salesforce Setup UI after metadata deployment:

### 1. Account layout — add related lists

1. Setup → Object Manager → Account → Page Layouts → Account Layout
2. Drag **"Business Licenses"** onto the layout (Compliance section)
3. Drag **"Distributor Authorizations"** onto the layout (Distribution section)
4. Click Save

### 2. Producer layout — add InsProducerRelationship__c related lists

When `HIERARCHY_MODE=custom` (InsProducerRelationship__c deployed):
1. Setup → Object Manager → Producer → Page Layouts → Producer Layout
2. Drag **"Parent Producer Relationships"** (where this producer is child) onto the layout
3. Drag **"Child Producer Relationships"** (where this producer is parent) onto the layout
4. Click Save

When `HIERARCHY_MODE=standard` (org has FSCInsurancePsl):
1. Setup → Object Manager → Producer → Page Layouts → Producer Layout
2. Drag **"Producer Relationships"** (where this producer is parent) onto the layout
3. Drag **"Related Producers"** (where this producer is child) onto the layout
4. Click Save

### 3. Enable Contacts to Multiple Accounts

Setup → Account Settings → **Allow users to relate a contact to multiple accounts** → Enable

---

## Hierarchy mode detection (Apex)

```apex
Boolean useStandardHierarchy = Schema.getGlobalDescribe().containsKey('ProducerRelationship');
String hierarchyObject = useStandardHierarchy ? 'ProducerRelationship' : 'InsProducerRelationship__c';
System.debug('Hierarchy mode: ' + (useStandardHierarchy ? 'standard' : 'custom'));
```

Use this pattern in setup scripts and validation code to avoid hard-coding the object name.

---

## Migration to standard ProducerRelationship

When `FSCInsurancePsl` seats are provisioned:

1. Confirm `ProducerRelationship` is queryable: `Schema.getGlobalDescribe().containsKey('ProducerRelationship')`
2. Map fields for migration:

| InsProducerRelationship__c | Standard ProducerRelationship |
|---|---|
| `ParentProducerId__c` | `ParentProducerId` |
| `ChildProducerId__c` | `ProducerId` |
| `Role__c` | `Role` |
| `StartDate__c` | `StartDate` |
| `EndDate__c` | `EndDate` |
| `IsActive__c` | `IsActive` |
| `ExternalId__c` | Use as upsert key |

3. Write migration Apex using `ExternalId__c` for idempotent upsert
4. Replace `InsProducerRelationship__c` related lists on Producer layout with standard `ProducerRelationship` lists
5. Set `InsProducerRelationship__c` deploymentStatus to Deleted after validation
