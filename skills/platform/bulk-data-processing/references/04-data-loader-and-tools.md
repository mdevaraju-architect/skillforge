# Data Loader and External Tools

## Salesforce Data Loader Overview

Salesforce Data Loader is a client application (Java-based, available for Windows and macOS) for bulk import and export of Salesforce records. It supports both a GUI (wizard) mode and a CLI (command-line) mode for automation.

Official download: Setup > Integrations > Data Loader (or via Salesforce CLI plugin `sfdx plugins:install dataloader`).

Supported operations: `insert`, `update`, `upsert`, `delete`, `hard delete`, `export`, `export all`.

Data Loader uses Bulk API 2.0 by default (v45+) for insert/update/upsert/delete operations and the REST API for export.

---

## Data Loader GUI Mode

### Configuration Settings (config.properties)

Data Loader stores configuration in `%APPDATA%\Salesforce\Data Loader\conf\config.properties` (Windows) or `~/Library/Preferences/Salesforce Data Loader/conf/config.properties` (macOS).

Key settings:

| Setting | Default | Description |
|---|---|---|
| `sfdc.loadBatchSize` | 200 | Records per batch sent to Bulk API. Max 10,000 for Bulk API 2.0. |
| `sfdc.useBulkApi` | `true` | Use Bulk API (true) or SOAP API (false) |
| `sfdc.bulkApiSerialMode` | `false` | Set `true` to use Bulk API serial concurrency mode |
| `sfdc.bulkApiZipContent` | `false` | Zip CSV content before upload (for large payloads) |
| `sfdc.csvEncoding` | `UTF-8` | Encoding for CSV files |
| `sfdc.timeoutSecs` | 540 | Timeout in seconds per batch |
| `sfdc.maxErrorsBeforeFailTask` | 10 | Number of row errors before the task is considered failed |
| `sfdc.noCompression` | `false` | If `true`, disables HTTP compression |
| `process.outputSuccess` | — | Path for success output CSV |
| `process.outputError` | — | Path for error output CSV |

### Steps for GUI Upsert

1. Launch Data Loader.
2. Click **Upsert**.
3. Log in with username/password + security token, or OAuth.
4. Select the target object.
5. Select the CSV file.
6. Choose the external ID field from the dropdown (only fields with External ID enabled appear).
7. Map columns: drag and drop CSV column names to Salesforce field API names, or load a saved mapping file (`.sdl` format).
8. Review and finish. Monitor progress in the progress bar.
9. After completion, review the success and error output CSVs.

---

## Data Loader CLI Mode

CLI mode enables automation via scripts and scheduled jobs. Configuration is stored in `process-conf.xml`.

### process-conf.xml Structure

```xml
<!DOCTYPE beans PUBLIC "-//SPRING//DTD BEAN//EN"
  "http://www.springframework.org/dtd/spring-beans.dtd">
<beans>
  <bean id="accountUpsertProcess"
        class="com.salesforce.dataloader.process.ProcessRunner"
        singleton="false">
    <description>Upsert Accounts from CSV</description>
    <property name="name" value="accountUpsertProcess"/>
    <property name="configOverrideMap">
      <map>
        <entry key="sfdc.debugMessages"          value="false"/>
        <entry key="sfdc.endpoint"               value="https://login.salesforce.com"/>
        <entry key="sfdc.username"               value="user@example.com"/>
        <entry key="sfdc.password"               value="passwordPLUS_SECURITY_TOKEN"/>
        <entry key="sfdc.entity"                 value="Account"/>
        <entry key="process.operation"           value="upsert"/>
        <entry key="process.mappingFile"         value="/data/account-mapping.sdl"/>
        <entry key="dataAccess.type"             value="csvRead"/>
        <entry key="dataAccess.name"             value="/data/accounts.csv"/>
        <entry key="process.outputSuccess"       value="/data/output/accounts_success.csv"/>
        <entry key="process.outputError"         value="/data/output/accounts_error.csv"/>
        <entry key="sfdc.externalIdField"        value="External_ID__c"/>
        <entry key="sfdc.loadBatchSize"          value="200"/>
        <entry key="sfdc.useBulkApi"             value="true"/>
        <entry key="sfdc.bulkApiSerialMode"      value="false"/>
      </map>
    </property>
  </bean>
</beans>
```

### Field Mapping File (.sdl)

The `.sdl` mapping file maps CSV column headers to Salesforce field API names:

```
# Account upsert field mapping
# Format: CSV_COLUMN_NAME=SALESFORCE_FIELD_API_NAME
External_ID__c=External_ID__c
Company_Name=Name
City=BillingCity
State=BillingState
Phone_Number=Phone
Industry_Sector=Industry
```

Lines starting with `#` are comments. The left side is the CSV column header; the right side is the Salesforce field API name.

### Running CLI

```bash
# Windows
"C:\Program Files\Salesforce\Data Loader\bin\process.bat" \
  C:\data\config accountUpsertProcess

# macOS / Linux
/opt/dataloader/bin/process.sh \
  /data/config accountUpsertProcess
```

### Automating with Scheduled Tasks / Cron

**Windows**: Use Task Scheduler to run the `process.bat` command on a schedule.

**macOS/Linux**: Use cron:
```cron
0 2 * * * /opt/dataloader/bin/process.sh /data/config accountUpsertProcess >> /var/log/dataloader.log 2>&1
```

### Log File Analysis

Data Loader produces detailed log files in the configured log directory. Key log patterns:

| Log Pattern | Meaning |
|---|---|
| `Processed X records` | Total records attempted |
| `X records failed` | Row-level failures; see error CSV |
| `INVALID_FIELD` | Field API name in mapping file is wrong |
| `REQUIRED_FIELD_MISSING` | Required field not in mapping or CSV |
| `InvalidBatch` | CSV format error (encoding, line endings, unclosed quotes) |
| `REQUEST_LIMIT_EXCEEDED` | Org has hit the 10,000 Bulk API job/24h limit |
| `Connection refused` | Network/firewall issue or wrong endpoint URL |
| `INVALID_LOGIN` | Credentials wrong, security token missing, or IP restricted |

---

## Bulk API 1.0 vs 2.0 Differences

| Feature | Bulk API 1.0 | Bulk API 2.0 |
|---|---|---|
| Chunking control | Client creates explicit batches | Server splits automatically (2,000 records/batch) |
| Result access | Per-batch polling and per-batch results | Job-level results (successfulResults / failedResults CSVs) |
| Content types | CSV, XML, ZIP | CSV only |
| External ID upsert | Supported | Supported |
| PK Chunking | Supported (for large exports) | Not applicable |
| SOAP dependencies | None | None |
| Monitoring | More granular (batch-by-batch) | Simpler (job-level) |
| Recommended for new work | No | Yes |
| Data Loader default | v45+ defaults to 2.0 | Native in v45+ |

Data Loader v45+ uses Bulk API 2.0 for all supported operations. To force API 1.0, set `sfdc.bulkApiV2` to `false` in `config.properties` (useful for edge cases where 1.0-specific features like PK Chunking are needed).

---

## upsert Key Strategy — External ID Field Setup

### Why External IDs?

External IDs allow upsert operations to match incoming records to existing Salesforce records without knowing the Salesforce `Id`. They are the recommended integration key for any system-of-record integration pattern where the external system assigns its own unique identifier.

### Creating an External ID Field

1. Setup > Object Manager > [Object] > Fields & Relationships > New.
2. Choose a data type appropriate to the key (Text, Number, Email).
3. Check **External ID** and **Unique** on the field definition screen.
4. Deploy via Change Set, Metadata API, or Salesforce CLI.

XML example:
```xml
<CustomField>
    <fullName>External_ID__c</fullName>
    <externalId>true</externalId>
    <label>External ID</label>
    <length>50</length>
    <type>Text</type>
    <unique>true</unique>
    <caseSensitive>false</caseSensitive>
</CustomField>
```

### Upsert Logic

When performing upsert with an external ID:
- If a record with the given external ID value exists → **update**.
- If no record with that external ID exists → **insert** (new record created).
- If multiple records with the same external ID exist → **error** (`DUPLICATE_VALUE`); this is why `unique = true` is required.

### Relationship Upsert (Parent References)

To set a relationship field (lookup or master-detail) using an external ID instead of a Salesforce `Id`, use the relationship name dot notation in the CSV:

```csv
External_ID__c,Name,Account.External_ID__c
CON-001,John Smith,ACC-001
```

This resolves `Account.External_ID__c = ACC-001` to the matching Account's Salesforce `Id` at processing time. The related object's field must also be marked as External ID.

---

## Import Wizard Limitations

The Data Import Wizard (available in Setup > Data > Data Import Wizard) is a simplified GUI tool for one-time imports.

Limitations:
- Maximum **50,000 records** per import.
- Supports only `insert` and `update` (no upsert, delete, or hard delete).
- Limited to: Accounts, Contacts, Leads, Solutions, Campaign Members, and certain custom objects.
- Does not support relationship fields via external ID dot notation.
- Not suitable for production-scale data migration or recurring integration pipelines.

Use Data Loader or Bulk API 2.0 directly for anything over 50,000 records, recurring jobs, or complex object types.

---

## External Data Tools (Brief)

### MuleSoft (Anypoint Platform)

Salesforce's integration platform for API-led connectivity. Uses Salesforce Connector (based on Bulk API 2.0 or REST API). Appropriate for event-driven or real-time integration patterns. Salesforce Data Cloud also integrates natively.

### Informatica Intelligent Cloud Services (IICS)

Enterprise ETL/ELT tool with native Salesforce connector. Supports bulk mode (Bulk API 2.0 internally) and real-time (REST). Used for large-scale data migration and ongoing sync between Salesforce and external warehouses.

### DataSpider / HULFT Integrate

Japanese-market-dominant iPaaS platform. Salesforce adapter uses Bulk API for large volume operations. Used primarily in Japan/APAC Salesforce implementations.

### Salesforce CLI (sf / sfdx)

```bash
# Export records to CSV using SOQL
sf data query --query "SELECT Id, Name FROM Account WHERE CreatedDate = TODAY" \
  --target-org myOrg --result-format csv > accounts.csv

# Import records via Bulk API 2.0
sf data import bulk --sobject Account --file accounts.csv \
  --target-org myOrg --wait 10

# Upsert records via Bulk API 2.0
sf data upsert bulk --sobject Account --file accounts.csv \
  --external-id External_ID__c --target-org myOrg --wait 10
```

---

## Data Migration Sequencing

When migrating a parent-child object hierarchy, always process in dependency order:

1. **Independent objects first** (no lookup/master-detail dependencies) — e.g., `Pricebook2`, `Product2`, `RecordType`.
2. **Parent objects** — e.g., `Account` before `Contact`, `Opportunity`.
3. **Child objects** — e.g., `Contact` after `Account`, referencing `Account.External_ID__c`.
4. **Junction objects last** — e.g., `AccountContactRelation`, `CampaignMember`.

Use external IDs throughout the migration chain so child records can reference parents by external ID rather than needing the Salesforce-assigned `Id` from step 2. This avoids a second-pass update step on child records.

Example sequence:
```
1. Insert Accounts          (External_ID__c = legacy_account_id)
2. Insert Contacts          (Account.External_ID__c = legacy_account_id)
3. Insert Opportunities     (Account.External_ID__c = legacy_account_id)
4. Insert OpportunityLineItems (Opportunity.External_ID__c = legacy_opp_id,
                                PricebookEntry.External_ID__c = legacy_pbe_id)
```
