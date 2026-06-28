# Agent Design: [Agent Name]

## Problem statement

_What does this agent solve? Who is the user? What does "success" look like for one interaction?_

## Scope

### What this agent does

- _Specific capability 1_
- _Specific capability 2_

### What this agent escalates to a human

- _Scenario that requires human judgment_
- _Scenario involving regulatory or compliance risk_
- _Scenario where the agent is not confident in its answer_

### What this agent refuses to do

- _Actions outside its declared topics_
- _Access to data it is not authorised to see_
- _Anything that would require a human approval workflow_

## Topic design

| Topic | Description | Typical actions |
|---|---|---|
| _TopicName_ | _What triggers this topic_ | _Action1, Action2_ |

## Action inventory

| Action | Type | Source | Description |
|---|---|---|---|
| _ActionApiName_ | Flow / Apex / Prompt Template / External | _File or managed package_ | _What it does_ |

## Guardrails

- _Guardrail 1: what the agent must always say_
- _Guardrail 2: what the agent must never say_
- _Guardrail 3: escalation trigger_

## Evaluation strategy

- _Primary eval dimension_
- _Edge case coverage plan_
- _Regression criteria: what regressions are unacceptable_

## Known limitations

_Document things the agent currently cannot do but that users might expect it to do._

## Deployment notes

- Minimum API version:
- Required permission sets:
- Required connected apps:
- Approval tier: draft
