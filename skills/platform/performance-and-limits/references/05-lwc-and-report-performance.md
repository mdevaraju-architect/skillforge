# 05 — LWC Performance and Report/Dashboard Optimisation

## LWC wire adapter caching

### How wire caching works

LWC `@wire` adapters (from `lightning/uiRecordApi`, custom Apex `@AuraEnabled(cacheable=true)`, or platform adapters) cache server responses in the Lightning Data Service (LDS) cache at the browser level. The cache is keyed by the adapter + parameters combination.

When a component uses:
```javascript
@wire(getAccountDetails, { accountId: '$recordId' })
wiredAccount;
```

The first call fetches from the server. Subsequent calls with the same `accountId` return the cached response without a server round-trip. This is efficient for read-heavy scenarios but requires explicit invalidation after writes.

### refreshApex() — invalidating the cache after DML

After a component performs a DML operation (via an Apex `@AuraEnabled` method that calls `insert`, `update`, or `delete`), the wire cache is stale. The UI will continue to show pre-DML data until either:
- The page is refreshed, or
- `refreshApex()` is explicitly called.

**Correct pattern:**

```javascript
// In the component JS file
import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getAccountDetails from '@salesforce/apex/AccountController.getAccountDetails';
import updateAccount from '@salesforce/apex/AccountController.updateAccount';

export default class AccountEditor extends LightningElement {
    recordId = '001...';

    // Store the wired result for later refresh
    wiredAccountResult;

    @wire(getAccountDetails, { accountId: '$recordId' })
    wiredAccount(result) {
        this.wiredAccountResult = result; // Store the {data, error} wire result object
        if (result.data) {
            this.account = result.data;
        }
    }

    async handleSave() {
        try {
            await updateAccount({ accountId: this.recordId, newName: this.newName });
            // REQUIRED: invalidate the wire cache so the component re-fetches
            await refreshApex(this.wiredAccountResult);
        } catch (error) {
            console.error('Update failed:', error);
        }
    }
}
```

> **Common mistake:** Storing `result.data` directly in `wiredAccount(result)` instead of storing `result` (the full `{data, error}` object). `refreshApex()` requires the full wire result object, not just the data. Passing `this.account` (the data) to `refreshApex()` silently does nothing.

### @AuraEnabled(cacheable=true) vs cacheable=false

| Attribute | `cacheable=true` | `cacheable=false` (default) |
|---|---|---|
| Wire adapter compatible | Yes — required for `@wire` | No — `@wire` requires cacheable=true |
| Imperative call compatible | Yes | Yes |
| Can perform DML | **No** — Salesforce throws exception | Yes |
| Response cached in LDS | Yes | No — each call hits the server |
| `refreshApex()` applicable | Yes | Not applicable (no cache) |
| Performance | Faster for repeated reads | Higher latency on every call |

**Rule:** Methods called via `@wire` must have `cacheable=true`. Methods that perform DML must NOT have `cacheable=true` and cannot be used with `@wire` — call them imperatively from event handlers.

```apex
public class AccountController {

    // For @wire — read only, no DML
    @AuraEnabled(cacheable=true)
    public static Account getAccountDetails(Id accountId) {
        return [SELECT Id, Name, Industry FROM Account WHERE Id = :accountId LIMIT 1];
    }

    // For imperative calls from event handlers — can do DML, not cacheable
    @AuraEnabled
    public static void updateAccount(Id accountId, String newName) {
        update new Account(Id = accountId, Name = newName);
    }
}
```

---

## Lazy loading with conditional wire

By default, a `@wire` call executes as soon as the component is connected to the DOM, even if the data is not yet needed (e.g. hidden behind a tab or modal). For components with many wire adapters or expensive server calls, lazy loading defers the call until it is actually needed.

### Pattern: conditional wire with reactive property

```javascript
export default class LazyLoadExample extends LightningElement {
    // Wire only triggers when this property is non-null/non-undefined/non-false
    _accountId = null;

    @wire(getAccountDetails, { accountId: '$_accountId' })
    wiredAccount;

    // Called when user clicks a "Load Details" button
    handleLoadDetails() {
        this._accountId = this.recordId; // Setting this triggers the wire call
    }
}
```

When `_accountId` is `null` or `undefined`, the wire adapter does not make a server call. Setting the reactive property to a valid value triggers the first server call.

### Pattern: wire with sections/tabs

For components with tabs that show different data sets, only load data for the active tab:

```javascript
export default class TabbedDetails extends LightningElement {
    activeTab = 'overview';
    _loadContactsTab = null;

    @wire(getRelatedContacts, { accountId: '$recordId', trigger: '$_loadContactsTab' })
    wiredContacts;

    handleTabActivate(event) {
        this.activeTab = event.target.value;
        if (this.activeTab === 'contacts') {
            this._loadContactsTab = true; // Triggers the contacts wire
        }
    }
}
```

---

## Pagination in LWC: offset vs keyset

### Offset-based pagination (simple, limited)

```javascript
// Component JS
currentOffset = 0;
pageSize = 10;

@wire(getPagedAccounts, { offset: '$currentOffset', pageSize: '$pageSize' })
wiredAccounts;

handleNextPage() {
    this.currentOffset += this.pageSize;
}
```

```apex
@AuraEnabled(cacheable=true)
public static List<Account> getPagedAccounts(Integer offset, Integer pageSize) {
    // Works only for offset < 2000
    return [SELECT Id, Name FROM Account ORDER BY Name LIMIT :pageSize OFFSET :offset];
}
```

**Limitation:** Fails when `offset >= 2000` (SOQL limit). Suitable only for small data sets or when users are unlikely to navigate beyond page 200 with a 10-record page size.

### Keyset pagination (scalable)

```javascript
// Component JS
lastId = null;
accounts = [];
hasMore = true;

async loadNextPage() {
    const result = await getNextPageAccounts({ lastId: this.lastId, pageSize: 20 });
    if (result.length < 20) {
        this.hasMore = false; // Fewer records returned than requested = last page
    }
    this.accounts = [...this.accounts, ...result];
    if (result.length > 0) {
        this.lastId = result[result.length - 1].Id;
    }
}
```

```apex
// Not cacheable=true because the result depends on mutable state (pagination cursor)
@AuraEnabled
public static List<Account> getNextPageAccounts(Id lastId, Integer pageSize) {
    if (lastId == null) {
        return [SELECT Id, Name FROM Account ORDER BY Id ASC LIMIT :pageSize];
    }
    return [SELECT Id, Name FROM Account WHERE Id > :lastId ORDER BY Id ASC LIMIT :pageSize];
}
```

---

## LWC performance metrics and diagnostics

### Chrome DevTools — Salesforce Lightning Inspector

The Salesforce Lightning Inspector (Chrome extension) provides:
- **Component tree**: shows all LWC and Aura components on the page with render times.
- **Performance tab**: records component lifecycle events (connectedCallback, renderedCallback, wire calls).
- **Event log**: shows events fired and handled, with timing.

Key metrics to investigate:
- `renderedCallback` duration: a long `renderedCallback` indicates expensive DOM operations or reactive property loops.
- Wire call timing: time from wire trigger to data received.
- Component count: pages with > 50 components have significant framework overhead.

### Common LWC performance anti-patterns

**1. Mutating reactive properties in renderedCallback**

```javascript
// BAD — mutating a reactive property in renderedCallback causes infinite re-render loop
renderedCallback() {
    this.processedData = this.rawData.map(item => ({ ...item, label: item.Name.toUpperCase() }));
}

// GOOD — transform in the wire callback or a getter
@wire(getData)
wiredData({ data }) {
    if (data) {
        this.processedData = data.map(item => ({ ...item, label: item.Name.toUpperCase() }));
    }
}
```

**2. Getters with expensive computation**

LWC calls getters on every render cycle. Expensive computations in getters run on every re-render:

```javascript
// BAD — sorts 1000 items on every render
get sortedAccounts() {
    return [...this.accounts].sort((a, b) => a.Name.localeCompare(b.Name));
}

// GOOD — compute once when data changes
@wire(getAccounts)
wiredAccounts({ data }) {
    if (data) {
        this._sortedAccounts = [...data].sort((a, b) => a.Name.localeCompare(b.Name));
    }
}
get sortedAccounts() {
    return this._sortedAccounts;
}
```

**3. Excessive child component creation**

Rendering a `<c-my-component>` for each of 500 records in a `template:for` creates 500 component instances, each with its own connectedCallback, wiring, and event listeners. Use virtual scrolling (paginate or render only visible rows) for large lists.

---

## Report performance

### Factors that make reports slow

| Factor | Impact | Remediation |
|---|---|---|
| Many joined objects (3+) | Each join adds a database JOIN operation | Reduce report type scope; use separate reports per object |
| Cross-filters ("with / without") | Each cross-filter adds a correlated subquery | Remove unnecessary cross-filters; use formula fields or custom fields to pre-compute the flag |
| Summary formula fields | Evaluated for every row at render time | Simplify formulas; move complex logic to a formula field on the record |
| > 2,000 rows without row limit | Full data fetch before display | Add row limit filter (Report → Edit → Filters → Add Row Limit) |
| Large date ranges on unindexed fields | Forces wide table scan | Narrow date range; filter on indexed CreatedDate/LastModifiedDate |
| Bucket fields on formula fields | Cannot be indexed; always full scan | Denormalize to a plain field |
| Reports on objects with 10M+ records | Inherent scalability limit | Use CRM Analytics; consider summary-level pre-aggregation |

### Cross-filters and their subquery cost

A cross-filter in a report ("Accounts with Opportunities", "Cases without Contacts") adds a correlated subquery to the report's underlying SOQL:

```sql
-- "Accounts with Open Opportunities" cross-filter generates approximately:
SELECT ... FROM Account
WHERE Id IN (
    SELECT AccountId FROM Opportunity WHERE IsClosed = false
)
```

Each cross-filter is one additional subquery. A report with 3 cross-filters has 3 nested subqueries. On large objects (1M+ Accounts, 5M+ Opportunities), this is extremely slow.

**Remediation:**
1. **Remove the cross-filter** and post-filter in the report row data instead.
2. **Denormalize to a field**: create a formula or trigger-maintained checkbox on Account (`Has_Open_Opportunities__c`), index it if selectivity allows, filter on it directly.
3. **Use CRM Analytics** (formerly Tableau CRM / Einstein Analytics) for complex multi-object queries — it uses a separate columnar store optimized for aggregation.

### Row limits

Adding a row limit is the single highest-impact change for slow reports with large result sets:
- **Filters → Row Limit**: caps the rows returned from the database.
- Start with 2,000 rows. If business needs require more, consider whether the full result set is actually being used or just exported to Excel once per quarter (in which case, use a data export instead).

### Joined report types and alternative approaches

A joined report (comparing data across multiple report types in a single view) executes multiple separate queries and merges them client-side. Each block in a joined report is an independent query:

- 3-block joined report = 3 queries, merged in browser.
- Very slow when each block returns thousands of rows.

**Alternatives:**
- Run separate standard reports and combine in a dashboard.
- Use CRM Analytics dashboards for multi-dataset joins at query time with push-down to columnar database.
- Use a Salesforce Report Type that already includes the needed objects (single-query alternative to joined report).

---

## List view SOQL and custom filters

List views in Salesforce generate SOQL behind the scenes. Custom list view filters on non-indexed fields on large objects are non-selective and slow, identical to a non-selective query in code.

**Example problem:**

A custom list view on Case with filter `Status = 'Open' AND Priority = 'High'` on an org with 2M Cases. Neither `Status` nor `Priority` is indexed. The list view query is non-selective and will time out or return a long-running query warning.

**Remediation:**
1. Add an indexed filter: `WHERE OwnerId = :currentUserId AND Status = 'Open'` — OwnerId is indexed, reducing the result set enough to be selective.
2. Create a formula checkbox field `Is_Open_High_Priority__c` (True if Status = 'Open' AND Priority = 'High'), mark it as External ID to get an index, then filter on this single indexed field.
3. Use a `CreatedDate >= LAST_N_DAYS:30` filter to reduce scope via an indexed date field.

> **Note:** The Query Plan tool does not analyze list view queries directly. To diagnose a slow list view, extract the equivalent SOQL and paste it into the Query Plan tool in Developer Console.
