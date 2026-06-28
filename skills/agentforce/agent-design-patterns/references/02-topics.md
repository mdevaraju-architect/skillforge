# Agentforce Topics

## What a Topic is

A Topic (`AgentTopic`) is a named intent category. The LLM reads all Topic descriptions when it receives a user message and routes to the best-matching Topic. Think of it as a classifier label with a natural-language rule.

Topics do not execute anything. They organise Actions.

---

## Topic description — the most important field

The `Description` field is what the LLM reads. Write it as:

**Pattern:**
> "This topic handles requests where the user wants to [primary intent]. Examples include: [example 1], [example 2], [example 3]. Do not use this topic for [explicit exclusion]."

**Good example:**
> "This topic handles requests where the user wants to check the status of an existing service case or open incident. Examples include: 'where is my case', 'what's the status of my ticket', 'has my issue been resolved'. Do not use this topic for creating new cases or for billing questions."

**Bad example:**
> "Case status topic."

The bad example gives the LLM no signal — it will misclassify.

---

## Topic design rules

### One intent per Topic
Do not bundle unrelated intents into one Topic to "save" Topics. The LLM classifies better with focused, specific descriptions. Bundled topics cause Action mis-selection downstream.

### Write exclusions explicitly
Always add a "Do not use this topic for X" clause when there is a neighbouring Topic that could overlap. Explicit exclusions reduce false matches.

### Ordering does not matter
The LLM evaluates all Topics simultaneously and picks the best match. Topic order in the metadata has no effect on classification.

### The Out-of-Scope Topic is mandatory
Always create a Topic called "Out of Scope" (or equivalent) with a description like:
> "This topic handles any request that does not match the agent's defined capabilities. Respond politely that the request is outside the agent's scope and suggest an alternative if possible."

Without it, the LLM attempts to handle everything — including requests it has no Actions for.

---

## Topic `Scope` field

Optional. Provides additional context that narrows when this Topic applies. Use it to specify:
- The record type or object context ("only applicable when viewing a Case record")
- The user role ("applies to service agents, not end customers")
- The channel ("SMS channel only")

The Scope field supplements the Description — it does not replace it.

---

## How many Topics should an agent have?

| Agent complexity | Topics |
|---|---|
| Simple (single domain) | 3–7 |
| Standard (multi-domain) | 8–20 |
| Complex (enterprise) | 20–50 |

Start small. Add Topics only when a new intent genuinely needs different Actions. Splitting Topics to "improve accuracy" when the underlying Actions are the same is counterproductive.

---

## Topic metadata example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<AgentTopic xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>This topic handles requests where the customer wants to check the current status of a claim, ask what step their claim is on, or understand what happens next in the claims process. Examples: &apos;what is my claim status&apos;, &apos;where is my claim&apos;, &apos;when will my claim be resolved&apos;. Do not use for filing a new claim or for billing/payment questions.</description>
    <developerName>ClaimStatus</developerName>
    <masterLabel>Claim Status</masterLabel>
    <scope>Applies when the customer has an existing claim on file.</scope>
</AgentTopic>
```

---

## Common Topic design mistakes

| Mistake | Impact | Fix |
|---|---|---|
| Description is the same as the label | Constant misclassification | Write a full natural-language description with examples |
| Two Topics overlap in description | Random routing between them | Add explicit exclusions to both |
| No Out-of-Scope Topic | Agent tries to answer everything | Always add Out-of-Scope as the last Topic |
| Too many Topics (50+) | Approaching the limit, degraded classification | Merge Topics that share the same Actions |
| Scope field used instead of Description | LLM ignores Scope for primary routing | Put routing logic in Description; use Scope for supplemental context |
| Business logic in Description | Description is not executed — it is read by LLM | Move logic to Actions |
