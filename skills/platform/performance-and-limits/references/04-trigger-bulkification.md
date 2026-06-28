# 04 — Trigger Bulkification

## Trigger context variables

Every Apex trigger has access to these implicit variables. Understanding their types is the foundation of bulkification.

| Variable | Type | Available in | Description |
|---|---|---|---|
| `Trigger.new` | `List<SObject>` | insert, update, undelete | New versions of records being saved. Read-only in after triggers; writable in before triggers. |
| `Trigger.old` | `List<SObject>` | update, delete | Old versions of records before the change. Always read-only. |
| `Trigger.newMap` | `Map<Id, SObject>` | update, after insert | Map of Id → new record. Not available in before insert (records have no Id yet). |
| `Trigger.oldMap` | `Map<Id, SObject>` | update, delete | Map of Id → old record. |
| `Trigger.operationType` | `TriggerOperation` | all | Enum: BEFORE_INSERT, BEFORE_UPDATE, BEFORE_DELETE, AFTER_INSERT, AFTER_UPDATE, AFTER_DELETE, AFTER_UNDELETE |
| `Trigger.isInsert` | `Boolean` | all | True if insert operation |
| `Trigger.isUpdate` | `Boolean` | all | True if update operation |
| `Trigger.isDelete` | `Boolean` | all | True if delete operation |
| `Trigger.isBefore` | `Boolean` | all | True if before phase |
| `Trigger.isAfter` | `Boolean` | all | True if after phase |
| `Trigger.size` | `Integer` | all | Number of records in `Trigger.new` or `Trigger.old` |

> **Key fact:** A single DML operation in Apex (`update accountList`) that processes 200 records will invoke the trigger once with `Trigger.new.size() == 200`. Data Loader, Bulk API, or any batch operation can produce this. Triggers must handle any size up to 200.

---

## Bulkification patterns

### Pattern 1: Collect → Query → Map → Process

This is the canonical pattern for handling related-record lookups in a trigger.

```apex
// Trigger on Opportunity (after insert, after update)
trigger OpportunityTrigger on Opportunity (after insert, after update) {
    OpportunityTriggerHandler.handleAfter(Trigger.new, Trigger.oldMap);
}

public class OpportunityTriggerHandler {

    public static void handleAfter(List<Opportunity> newOpps, Map<Id, Opportunity> oldMap) {

        // STEP 1: Collect all lookup IDs into a Set (deduplication is automatic)
        Set<Id> accountIds = new Set<Id>();
        for (Opportunity opp : newOpps) {
            if (opp.AccountId != null) {
                accountIds.add(opp.AccountId);
            }
        }

        // Guard: nothing to process
        if (accountIds.isEmpty()) {
            return;
        }

        // STEP 2: Single SOQL query outside the loop
        Map<Id, Account> accountMap = new Map<Id, Account>(
            [SELECT Id, Name, Industry, BillingState FROM Account WHERE Id IN :accountIds]
        );

        // STEP 3: Collect records to update
        List<Opportunity> oppsToUpdate = new List<Opportunity>();

        // STEP 4: Process using Map lookups (O(1) per lookup)
        for (Opportunity opp : newOpps) {
            Account acc = accountMap.get(opp.AccountId);
            if (acc == null) {
                continue; // Account not found or accountId was null
            }

            // Check if field change actually requires an update
            Opportunity oldOpp = (oldMap != null) ? oldMap.get(opp.Id) : null;
            Boolean accountChanged = (oldOpp == null || oldOpp.AccountId != opp.AccountId);

            if (accountChanged) {
                Opportunity oppUpdate = new Opportunity(Id = opp.Id);
                oppUpdate.AccountIndustry__c = acc.Industry;
                oppUpdate.AccountBillingState__c = acc.BillingState;
                oppsToUpdate.add(oppUpdate);
            }
        }

        // STEP 5: Single DML outside the loop
        if (!oppsToUpdate.isEmpty()) {
            update oppsToUpdate;
        }
    }
}
```

### Pattern 2: Multiple relationship lookups

When a trigger requires lookups to multiple parent objects, collect all IDs in a single pass, query each object once, then process:

```apex
public static void handleCaseAfterInsert(List<Case> newCases) {

    Set<Id> accountIds = new Set<Id>();
    Set<Id> contactIds = new Set<Id>();

    for (Case c : newCases) {
        if (c.AccountId != null) accountIds.add(c.AccountId);
        if (c.ContactId != null) contactIds.add(c.ContactId);
    }

    Map<Id, Account> accountMap = accountIds.isEmpty()
        ? new Map<Id, Account>()
        : new Map<Id, Account>([SELECT Id, SLA__c FROM Account WHERE Id IN :accountIds]);

    Map<Id, Contact> contactMap = contactIds.isEmpty()
        ? new Map<Id, Contact>()
        : new Map<Id, Contact>([SELECT Id, Preferred_Language__c FROM Contact WHERE Id IN :contactIds]);

    List<Case> casesToUpdate = new List<Case>();
    for (Case c : newCases) {
        Case cUpdate = new Case(Id = c.Id);
        Account acc = accountMap.get(c.AccountId);
        Contact con = contactMap.get(c.ContactId);

        if (acc != null) cUpdate.SLA_Type__c = acc.SLA__c;
        if (con != null) cUpdate.Language__c = con.Preferred_Language__c;
        casesToUpdate.add(cUpdate);
    }

    if (!casesToUpdate.isEmpty()) {
        update casesToUpdate;
    }
}
```

---

## SOQL-in-loop detection and fix

### Detection checklist

SOQL-in-loop typically appears as one of these patterns in code review:

```apex
// Anti-pattern 1: Literal SOQL inside for loop
for (Opportunity opp : Trigger.new) {
    List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId = :opp.AccountId]; // BAD
}

// Anti-pattern 2: Method call inside loop that internally performs SOQL
for (Opportunity opp : Trigger.new) {
    Account acc = AccountService.getById(opp.AccountId); // BAD if getById() does SOQL
}

// Anti-pattern 3: Database.query() inside loop
for (String objectName : objectNames) {
    List<SObject> records = Database.query('SELECT Id FROM ' + objectName); // BAD
}
```

### Fix: extract the query, use a Map

See Pattern 1 above. The universal fix is:
1. Move the query outside all loops.
2. Use a `Set<Id>` to collect all IDs before querying.
3. Build a `Map<Id, SObject>` from the query result.
4. Use `Map.get()` inside the loop for O(1) access.

---

## DML-in-loop detection and fix

DML inside a loop (insert, update, delete per iteration) consumes one DML statement per iteration and hits the 150 DML statement limit.

### Anti-pattern

```apex
// BAD — one DML per record
for (Account acc : accountsToProcess) {
    acc.Status__c = 'Processed';
    update acc; // DML per record = 200 DML statements for 200 records
}
```

### Fix: collect into List, single DML

```apex
// GOOD — single DML for all records
List<Account> toUpdate = new List<Account>();
for (Account acc : accountsToProcess) {
    acc.Status__c = 'Processed';
    toUpdate.add(acc);
}
if (!toUpdate.isEmpty()) {
    update toUpdate;
}
```

### Partial-failure handling

When using a single `update myList` on a large batch, a validation error on one record will fail all records in the DML by default. Use `Database.update(myList, false)` to allow partial success:

```apex
List<Database.SaveResult> results = Database.update(toUpdate, false);
for (Database.SaveResult sr : results) {
    if (!sr.isSuccess()) {
        for (Database.Error err : sr.getErrors()) {
            System.debug(LoggingLevel.ERROR, 'DML Error: ' + err.getMessage()
                + ' on fields: ' + err.getFields());
        }
    }
}
```

---

## Handler class pattern

The trigger file should contain no business logic. All logic belongs in a handler class. This:
- Makes the handler independently testable.
- Allows disabling the trigger for data migration (static flag).
- Keeps the trigger file readable.

### Recommended trigger file structure

```apex
// AccountTrigger.trigger
trigger AccountTrigger on Account (
    before insert, before update, before delete,
    after insert, after update, after delete, after undelete
) {
    AccountTriggerHandler handler = new AccountTriggerHandler();

    if (Trigger.isBefore) {
        if (Trigger.isInsert)  handler.onBeforeInsert(Trigger.new);
        if (Trigger.isUpdate)  handler.onBeforeUpdate(Trigger.new, Trigger.oldMap);
        if (Trigger.isDelete)  handler.onBeforeDelete(Trigger.old);
    }
    if (Trigger.isAfter) {
        if (Trigger.isInsert)   handler.onAfterInsert(Trigger.new);
        if (Trigger.isUpdate)   handler.onAfterUpdate(Trigger.new, Trigger.oldMap);
        if (Trigger.isDelete)   handler.onAfterDelete(Trigger.oldMap);
        if (Trigger.isUndelete) handler.onAfterUndelete(Trigger.new);
    }
}
```

### Handler class structure

```apex
public with sharing class AccountTriggerHandler {

    // -------------------------------------------------------
    // Before phase
    // -------------------------------------------------------
    public void onBeforeInsert(List<Account> newAccounts) {
        AccountService.setDefaultValues(newAccounts);
    }

    public void onBeforeUpdate(List<Account> newAccounts, Map<Id, Account> oldMap) {
        AccountService.validateStateTransitions(newAccounts, oldMap);
    }

    public void onBeforeDelete(List<Account> oldAccounts) {
        AccountService.preventDeleteIfActiveContracts(oldAccounts);
    }

    // -------------------------------------------------------
    // After phase
    // -------------------------------------------------------
    public void onAfterInsert(List<Account> newAccounts) {
        AccountService.createDefaultContacts(newAccounts);
    }

    public void onAfterUpdate(List<Account> newAccounts, Map<Id, Account> oldMap) {
        AccountService.syncRelatedOpportunities(newAccounts, oldMap);
    }

    public void onAfterDelete(Map<Id, Account> oldMap) {
        AccountService.cleanupRelatedRecords(oldMap);
    }

    public void onAfterUndelete(List<Account> newAccounts) {
        AccountService.restoreRelatedRecords(newAccounts);
    }
}
```

---

## Recursive trigger prevention

A trigger that performs DML can re-invoke itself (recursion). Example: an after-update trigger on Account that updates Account fields triggers another after-update execution.

### Static Boolean flag pattern

```apex
public class AccountTriggerHandler {

    // Static variable persists for the lifetime of the transaction
    private static Boolean isRunning = false;

    public void onAfterUpdate(List<Account> newAccounts, Map<Id, Account> oldMap) {
        if (isRunning) {
            return; // Prevent recursive execution
        }
        isRunning = true;
        try {
            // ... logic that may trigger another update ...
            update accountsToUpdate;
        } finally {
            isRunning = false; // Reset in case called again in same transaction for different purpose
        }
    }
}
```

> **Caution:** The static flag approach prevents ALL re-entrant execution, including legitimate cases where a second batch of records needs processing in the same transaction. A more granular approach tracks processed record IDs.

### Set-based recursion guard

```apex
public class AccountTriggerHandler {
    private static Set<Id> processedIds = new Set<Id>();

    public void onAfterUpdate(List<Account> newAccounts, Map<Id, Account> oldMap) {
        List<Account> toProcess = new List<Account>();
        for (Account acc : newAccounts) {
            if (!processedIds.contains(acc.Id)) {
                toProcess.add(acc);
                processedIds.add(acc.Id);
            }
        }
        if (!toProcess.isEmpty()) {
            AccountService.syncRelatedOpportunities(toProcess, oldMap);
        }
    }
}
```

---

## Apex trigger order of execution (with Flows)

Understanding execution order prevents duplicate processing and unexpected limit consumption.

For a single DML save (e.g. `update myAccount`):

1. **System validation** (required fields, data type)
2. **Before-save Record-Triggered Flows** (optimized flows that run before the record is saved)
3. **Before triggers** (all `before update` triggers on Account)
4. **Validation rules** (including custom validation)
5. **Duplicate rules**
6. **Record saved to database** (not yet committed)
7. **After triggers** (all `after update` triggers on Account)
8. **Assignment rules** (Leads, Cases only)
9. **Auto-response rules** (Cases, Leads only)
10. **Workflow rules** and their **field updates** (field updates re-run steps 7–9 once)
11. **Processes** (Process Builder — legacy)
12. **Escalation rules** (Cases only)
13. **After-save Record-Triggered Flows** (run after record is saved)
14. **Roll-up summary field** recalculation on parent object (may trigger parent object's triggers → recursive execution order applies to parent)
15. **Sharing rules** recalculation
16. **Commit** to database

### Governor limits across this chain

All steps 1–16 share the same per-transaction governor limit pool. If a before-trigger uses 80 SOQL queries, an after-save Flow that uses 30 more will cause a `System.LimitException: Too many SOQL queries: 101` at step 13, even though the trigger code itself was within limits.

**Diagnostic approach when limits are exceeded:**
1. Enable a debug log with `DB: FINEST` and `WORKFLOW: FINEST`.
2. Look for `FLOW_START_INTERVIEW_BEGIN` entries followed by `SOQL_EXECUTE_BEGIN` — these are Flow-generated queries.
3. Look for `WF_RULE_EVAL_BEGIN` entries — these show workflow processing.
4. Deactivate Flows and Process Builder one at a time to identify which automation is consuming the limit.
5. Merge redundant queries: if the trigger and a Flow both query the same Account fields, move the query to the trigger and pass data to the Flow via a Flow input variable or by pre-computing a formula field.
