# Schedulable and Continuation Reference

## Schedulable Interface

### Interface Definition

```apex
public interface Schedulable {
    void execute(SchedulableContext ctx);
}
```

`SchedulableContext` provides:

| Method | Return Type | Description |
|---|---|---|
| `getTriggerId()` | `Id` | The `CronTrigger.Id` of the scheduled job |

### Minimal Implementation

```apex
public class DailyCleanupJob implements Schedulable {
    public void execute(SchedulableContext ctx) {
        Id cronTriggerId = ctx.getTriggerId();
        // Business logic here — runs in its own async transaction
        deleteOldLogs();
    }

    private void deleteOldLogs() {
        List<Log__c> oldLogs = [
            SELECT Id FROM Log__c
            WHERE CreatedDate < :System.now().addDays(-30)
            LIMIT 200
        ];
        if (!oldLogs.isEmpty()) {
            delete oldLogs;
        }
    }
}
```

---

## `System.schedule()` Syntax

```apex
// Signature:
// String System.schedule(String jobName, String cronExpression, Schedulable schedulable)
// Returns: Id of the CronTrigger record

String jobName  = 'Daily Cleanup - Midnight';
String cronExpr = '0 0 0 * * ?'; // Every day at midnight

Id cronTriggerId = System.schedule(jobName, cronExpr, new DailyCleanupJob());
```

`System.schedule()` always creates a **new** `CronTrigger` record. It does not replace or update an existing job with the same name. Calling it twice with the same name creates two separate jobs.

---

## CRON Expression Format

Salesforce uses a 6-field CRON syntax: `Seconds Minutes Hours Day-of-month Month Day-of-week`

```
Field           Position   Allowed Values        Special Characters
Seconds         1          0–59                  , - * /
Minutes         2          0–59                  , - * /
Hours           3          0–23                  , - * /
Day-of-month    4          1–31                  , - * ? / L W
Month           5          1–12 or JAN–DEC       , - * /
Day-of-week     6          1–7 or SUN–SAT        , - * ? / L #
```

Special character meanings:
- `*` — every value (wildcard)
- `?` — no specific value (used in Day-of-month or Day-of-week to avoid conflict)
- `-` — range (e.g. `1-5` = Monday through Friday)
- `,` — list (e.g. `MON,WED,FRI`)
- `/` — increment (e.g. `0/15` in Minutes = every 15 minutes starting at 0)
- `L` — last (e.g. `L` in Day-of-month = last day of month)
- `W` — nearest weekday (e.g. `15W` = nearest weekday to the 15th)
- `#` — nth day of month (e.g. `2#1` in Day-of-week = first Monday)

### Common CRON Expressions

```
'0 * * * * ?'         — Every minute (minimum frequency)
'0 0 * * * ?'         — Every hour at minute 0
'0 0 8 * * ?'         — Every day at 8:00 AM
'0 30 9 ? * MON-FRI'  — Weekdays at 9:30 AM
'0 0 0 * * ?'         — Every day at midnight
'0 0 8 1 * ?'         — First of every month at 8:00 AM
'0 0 0 L * ?'         — Last day of every month at midnight
'0 0 6 ? * SUN'       — Every Sunday at 6:00 AM
```

**Minimum frequency:** Once per minute. No Salesforce CRON expression can fire more frequently than `'0 * * * * ?'`.

---

## Checking for Existing Jobs Before Scheduling

`System.schedule()` does not replace existing jobs. Always abort existing active jobs before creating a new one with the same name.

```apex
public class JobScheduler {
    public static Id safeSchedule(String jobName, String cronExpr, Schedulable job) {
        // Find all active jobs with this name
        List<CronTrigger> existing = [
            SELECT Id, State
            FROM CronTrigger
            WHERE CronJobDetail.Name = :jobName
              AND State NOT IN ('DELETED', 'COMPLETE')
        ];

        // Abort all found jobs
        for (CronTrigger ct : existing) {
            System.abortJob(ct.Id);
        }

        // Schedule the new job
        return System.schedule(jobName, cronExpr, job);
    }

    public static void abortAllByName(String jobName) {
        for (CronTrigger ct : [
            SELECT Id FROM CronTrigger
            WHERE CronJobDetail.Name = :jobName
              AND State NOT IN ('DELETED', 'COMPLETE')
        ]) {
            System.abortJob(ct.Id);
        }
    }
}
```

---

## `CronTrigger` Query Patterns

```apex
// All active scheduled Apex jobs
List<CronTrigger> allJobs = [
    SELECT Id,
           CronJobDetail.Name,
           CronJobDetail.JobType,
           CronExpression,
           State,
           NextFireTime,
           PreviousFireTime,
           TimesTriggered
    FROM CronTrigger
    WHERE CronJobDetail.JobType = '7'  // 7 = Scheduled Apex
      AND State NOT IN ('DELETED', 'COMPLETE')
    ORDER BY NextFireTime ASC
];

// Find a specific job by name
CronTrigger ct = [
    SELECT Id, State, NextFireTime
    FROM CronTrigger
    WHERE CronJobDetail.Name = 'Daily Cleanup - Midnight'
      AND State NOT IN ('DELETED', 'COMPLETE')
    LIMIT 1
];

// Count active jobs (max is 100 per org)
Integer activeCount = [
    SELECT COUNT()
    FROM CronTrigger
    WHERE CronJobDetail.JobType = '7'
      AND State NOT IN ('DELETED', 'COMPLETE')
];
System.debug('Active scheduled jobs: ' + activeCount + ' / 100');
```

---

## `System.abortJob()`

```apex
// Abort a single job by CronTrigger ID
System.abortJob(cronTriggerId);

// Abort a job from within its own execute() (self-canceling job)
public class RunOnceJob implements Schedulable {
    public void execute(SchedulableContext ctx) {
        doWork();
        System.abortJob(ctx.getTriggerId()); // cancel after first run
    }
}
```

After `System.abortJob()`, the `CronTrigger.State` changes to `DELETED` and the job no longer fires.

---

## Maximum Scheduled Jobs Limit

Each Salesforce org can have at most **100 active scheduled Apex jobs** at a time. This includes jobs in `WAITING`, `PAUSED`, and `BLOCKED` states — but not `DELETED` or `COMPLETE`.

If the limit is reached, `System.schedule()` throws `System.AsyncException: Maximum number of Apex scheduled jobs (100) has been reached.`

Strategies to stay within the limit:
- Use a single "master scheduler" job that processes a work queue, rather than scheduling one job per record.
- Abort completed or obsolete jobs using `System.abortJob()`.
- For high-frequency needs, use Platform Events + trigger subscriber instead of Scheduled Apex.

---

## Unit Testing Schedulable Apex

```apex
@isTest
static void testScheduledJob() {
    Test.startTest();
    String cronExpr = '0 0 0 1 1 ? 2099'; // Far future — runs in test isolation
    Id jobId = System.schedule('Test Job', cronExpr, new DailyCleanupJob());
    Test.stopTest(); // Forces the scheduled job to execute synchronously in test

    // Assert side effects of the job
    List<Log__c> remainingLogs = [SELECT Id FROM Log__c WHERE CreatedDate < :System.now().addDays(-30)];
    System.assertEquals(0, remainingLogs.size(), 'Old logs should have been deleted');

    // Clean up
    System.abortJob(jobId);
}
```

---

## Continuation

### What Is Continuation

`Continuation` is a platform mechanism for making long-running HTTP callouts from Visualforce or LWC server-side Apex without blocking the user interface. Instead of holding an Apex server thread open during the callout, the platform suspends the request, makes the callout asynchronously, and resumes the Apex execution when the response arrives.

**Maximum callout duration:** 120 seconds (configurable in the `Continuation` constructor).
**Contrast with standard callout:** Standard `Http.send()` has a 10-second per-callout timeout and blocks the thread.

### Supported Contexts

| Context | Supported |
|---|---|
| `@AuraEnabled(continuation=true)` method (LWC) | Yes |
| Visualforce controller action method | Yes |
| Apex trigger | **No** — compile-time error |
| Batch Apex `execute()` | **No** — runtime error |
| Queueable `execute()` | **No** — runtime error |
| `@future` method | **No** — runtime error |
| Schedulable `execute()` | **No** — runtime error |

Use standard `Http.send()` in Queueable and `@future` contexts; use `Continuation` only for UI-facing async callouts.

### LWC `@AuraEnabled(continuation=true)` Pattern

```apex
public class ExternalDataController {

    // Step 1: Start the continuation (called by LWC)
    @AuraEnabled(continuation=true cacheable=false)
    public static Object startCallout(String accountId) {
        Continuation cont = new Continuation(120); // wait up to 120 seconds
        cont.continuationMethod = 'handleResponse';

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ExternalAPI/accounts/' + accountId);
        req.setMethod('GET');

        // Add the request; save the label for response retrieval
        String reqLabel = cont.addHttpRequest(req);

        // Store state in the continuation (available in handleResponse)
        cont.state = new Map<String, String>{ 'accountId' => accountId, 'label' => reqLabel };

        return cont;
    }

    // Step 2: Handle the response (called by the platform after callout completes)
    @AuraEnabled
    public static Object handleResponse() {
        // Retrieve the response using the label stored in state
        // Note: Continuation.getResponse() is only valid in the continuation method
        Map<String, String> state = (Map<String, String>) Continuation.currentState;
        HttpResponse res = Continuation.getResponse(state.get('label'));

        if (res.getStatusCode() == 200) {
            return res.getBody();
        } else {
            throw new AuraHandledException('External service returned: ' + res.getStatusCode());
        }
    }
}
```

```javascript
// LWC component calling the continuation
import { LightningElement, api } from 'lwc';
import startCallout from '@salesforce/apex/ExternalDataController.startCallout';

export default class ExternalDataCard extends LightningElement {
    @api recordId;

    async connectedCallback() {
        try {
            // Continuation is transparent from LWC's perspective
            // The framework handles the async suspend/resume automatically
            const result = await startCallout({ accountId: this.recordId });
            this.processResult(result);
        } catch (error) {
            console.error('Callout failed', error);
        }
    }
}
```

### Visualforce Controller Pattern

```apex
public class MyVFController {
    public String calloutResult { get; set; }

    public Continuation startCallout() {
        Continuation cont = new Continuation(60);
        cont.continuationMethod = 'processCallout';

        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://api.example.com/data');
        req.setMethod('GET');
        cont.addHttpRequest(req);

        return cont;
    }

    public PageReference processCallout() {
        // Retrieve the HTTP response
        // In VF, responses are retrieved via the Continuation framework
        // The label is managed by the VF framework in this pattern
        calloutResult = 'Response received';
        return null; // return null to stay on same page
    }
}
```

---

## When to Use Which Callout Mechanism

| Requirement | Recommended Mechanism |
|---|---|
| Callout from trigger (fire-and-forget) | `@future(callout=true)` |
| Callout from trigger with error handling / retry | Queueable + `Database.AllowsCallouts` + `System.Finalizer` |
| Callout up to 10s from UI without blocking | Standard `Http.send()` in `@AuraEnabled` method |
| Callout 10–120s from UI without blocking | `Continuation` in `@AuraEnabled(continuation=true)` |
| Callout as part of scheduled/batch processing | Queueable + `Database.AllowsCallouts` (enqueued from Schedulable) |
| Callout with chaining and state | Queueable + `Database.AllowsCallouts` |
| Callout per-record in a loop | Queueable chain — one callout per `execute()` |
