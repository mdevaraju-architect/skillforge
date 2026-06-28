# Agentforce Actions

## What an Action is

An Action (`AgentAction`) is the unit of execution in Agentforce. When a Topic is matched, the LLM selects one or more Actions to execute based on their descriptions and the current conversation context.

Each Action is backed by a real executor: Apex, Flow, Prompt Template, External Service, or a Salesforce standard action.

---

## Action types

### Invocable Action (Apex)
Backed by an Apex method annotated `@InvocableMethod`.

```apex
public class GetClaimStatus {
    @InvocableMethod(
        label='Get Claim Status'
        description='Returns the current status and next steps for a claim. Use when the customer asks about their claim status.'
    )
    public static List<Result> execute(List<Request> requests) {
        // query Claim, return formatted string
    }

    public class Request {
        @InvocableVariable(required=true description='The claim number provided by the customer')
        public String claimNumber;
    }

    public class Result {
        @InvocableVariable description='Formatted status summary for display in chat'
        public String statusSummary;
    }
}
```

**Key rules for Invocable Actions:**
- Input and output must be `List<T>` where T is an inner class with `@InvocableVariable` fields
- Output rendered in chat must be a `String` — return formatted text, not SObject
- The `description` on `@InvocableMethod` is what the LLM reads — write it as an instruction
- Method must be `public static`
- Governor limits apply per invocation — 100 SOQL, 150 DML, 10MB heap

### Flow Action
Backed by an auto-launched Flow. No screen elements — auto-launched only.

Input variables: define as `Input` variables in Flow Variables.
Output variables: define as `Output` variables in Flow Variables. Return a String for chat display.

Use Flow when: multi-step logic without Apex, callouts to external systems via Flow HTTP callout, or when the team prefers declarative tooling.

### Prompt Template Action
Backed by a `GenAiPromptTemplate`. The agent invokes the template, which generates an LLM response using grounded data.

Use when: summarising a record, generating a recommendation, drafting a response. The Prompt Template has access to the current record context.

See `agentforce-prompt-template-authoring` skill for full Prompt Template patterns.

### External Service Action
Backed by an External Service definition (from an OpenAPI spec or manually defined).

Required setup:
1. Named Credential (authentication)
2. External Service (operation definition — Setup → External Services)
3. In Agentforce Studio: Action type = External Service, select the operation

Input parameters map to the API request. Output maps from the API response — transform to String for chat display.

### Standard Actions (Salesforce built-ins)

| Action | What it does |
|---|---|
| Draft or Send Email | Compose and send email from the agent |
| Create Record | Create any SObject record |
| Update Record | Update a specific record |
| Get Record | Query a record by ID |
| Summarise Record | Generate an LLM summary of a record |
| Search Knowledge | Search Salesforce Knowledge articles |
| Query Records | SOQL-style record retrieval |

Standard Actions require no custom code. Add them directly in Agentforce Studio.

---

## Action description — writing it correctly

The Action description is read by the LLM to decide *when* to invoke this action. It is not documentation — it is a routing instruction.

**Pattern:**
> "Use this action when the user wants to [specific intent]. Input: [what you need from the conversation]. Do not use for [exclusion]."

**Good:**
> "Use this action when the customer asks for the current status of their claim. Input: the claim number mentioned in the conversation. Do not use for creating a new claim or checking payment status."

**Bad:**
> "Gets claim status."

---

## Action input variables

Input variables tell the LLM what information to extract from the conversation before invoking the action.

| Field | Notes |
|---|---|
| `Name` | API name of the variable |
| `Description` | **LLM reads this** — describe what to extract from conversation |
| `Required` | If true, the LLM asks for clarification before invoking if not found |
| `Data Type` | String, Number, Boolean, Date — keep simple; no complex objects |

**Required vs. Optional:**
- Mark as required only when the action genuinely cannot execute without it
- Too many required inputs = agent asks too many clarifying questions
- Optional inputs can be inferred by the LLM from context

---

## Action output

- Must be a `String` to display in chat
- Structure the string as readable text — not JSON, not raw SObject fields
- For long outputs, use line breaks (`\n`) for readability
- Max rendered length: ~2000 characters for messaging channels; more for console

---

## Action chaining

The LLM can invoke multiple actions in sequence within one turn if the task requires it. Design actions to be **composable**:
- Action 1 returns a claim ID → Action 2 uses that ID to get payment history
- Pass context between actions via session variables or by returning values that the next action description references

Do not build a single massive action that does everything. Build small, focused actions and let the LLM chain them.

---

## Common Action mistakes

| Mistake | Impact | Fix |
|---|---|---|
| Action description is vague | LLM selects wrong action | Rewrite as "Use this action when user wants to X" |
| Two actions have overlapping descriptions | Random selection | Add explicit exclusions to each |
| Action returns a complex object | Chat renders nothing | Transform output to a formatted String |
| Required inputs cause constant clarification | Poor UX | Mark most inputs as optional; let LLM infer |
| One action does too much | Hard to reuse, hard to debug | Split into focused single-purpose actions |
| Action calls SOQL in a loop | CPU/query limits | Aggregate SOQL, bulkify queries |
