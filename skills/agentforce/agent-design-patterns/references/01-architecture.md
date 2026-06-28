# Agentforce Architecture

## What Agentforce is

Agentforce is Salesforce's platform for deploying autonomous AI agents. An agent:
- Receives a user message (via Messaging, Service Console, Experience Cloud, API, or custom channel)
- Classifies intent to a **Topic**
- Selects and executes one or more **Actions**
- Returns a response — and may loop through multiple action steps before responding

It is not a chatbot (no scripted decision trees), not a Flow (no fixed execution path), and not Einstein Copilot (retired as a product; Agentforce is the successor).

---

## Layer diagram

```
User message
    │
    ▼
┌─────────────────────────────────────┐
│           Agent Instructions        │  ← persona, tone, what agent can/cannot do
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│         Topic Classification        │  ← LLM reads Topic descriptions, picks best match
│  Topic A │ Topic B │ Out of Scope   │
└─────────────────────────────────────┘
    │
    ▼  (matched topic)
┌─────────────────────────────────────┐
│         Action Selection            │  ← LLM reads Action descriptions under matched Topic
│  Action 1 │ Action 2 │ Action 3    │
└─────────────────────────────────────┘
    │
    ▼  (selected action)
┌─────────────────────────────────────┐
│         Action Execution            │  ← invocable method / Flow / Prompt Template / External Service
└─────────────────────────────────────┘
    │
    ▼
Agent response → user
```

---

## Key concepts

### Agent Instructions
Free-text field on the agent definition. The LLM reads this as its persona and operating guidelines. Keep it concise — under 500 words. Cover: role, tone, what it can do, what it cannot do, how to handle ambiguity.

### Topics (`AgentTopic`)
A Topic is a **natural-language classifier** — a named intent category with a description that tells the LLM "route here when the user wants X." Topics do not execute anything. One agent can have up to 50 Topics (Summer 26 limit).

Key fields:
| Field | Purpose |
|---|---|
| `DeveloperName` | API name — no spaces |
| `MasterLabel` | Display label |
| `Description` | **LLM reads this to classify** — write as natural language, be specific |
| `Scope` | Optional: further narrows when this topic applies |

### Actions (`AgentAction`)
An Action is what the agent **does** when a Topic is matched. Each Topic can have multiple Actions; the LLM selects based on the Action description and current context.

Action types:
| Type | Backed by | When to use |
|---|---|---|
| Invocable Action | Apex `@InvocableMethod` | Custom logic, complex queries, DML |
| Flow Action | Auto-launched Flow | Multi-step logic without Apex |
| Prompt Template Action | `GenAiPromptTemplate` | LLM-generated summaries, recommendations |
| External Service Action | External Service definition | Third-party API calls |
| Standard Action | Salesforce built-ins | Draft email, summarise record, create case |

### Channels
Where the agent is deployed. Each channel type has different UI capabilities:
| Channel | Notes |
|---|---|
| Service Console (Messaging In App) | Rich UI — can show LWC components alongside chat |
| Messaging (SMS, WhatsApp) | Async, text-only — no navigation actions |
| Experience Cloud | Self-service portal |
| Slack | Internal agent; Slack message formatting |
| Custom (API) | Direct API invocation — headless |

### Agent Session
One conversation = one session. Sessions store context (slot values, prior turns). Sessions expire after inactivity (default 60 min, configurable). Session variables can be passed between Actions within the same session.

---

## Metadata types reference

| Concept | Metadata type (Spring 26) | Old name |
|---|---|---|
| Agent definition | `Agent` | `BotVersion` |
| Topic | `AgentTopic` | `GenAiPlugin` |
| Action | `AgentAction` | `GenAiPluginInstructions` |
| Agent channel config | `AgentChannelConfig` | `BotChannel` |
| Prompt Template | `GenAiPromptTemplate` | (unchanged) |
| LLM configuration | `MlDomain` | (unchanged) |

---

## Deployment and lifecycle

```
Development    →  Simulation (test tab, no real sessions)
Staging        →  Sandbox deployment, user acceptance
Production     →  Activate agent → assign to channel → monitor
```

Agents are deployed via standard Salesforce metadata deployment (`sf project deploy`). Changes to Topic/Action descriptions do NOT require a full deployment — they update immediately via Agentforce Studio UI. Changes to backing Apex or Flows do require deployment.

---

## Limits (Spring 26)

| Limit | Value |
|---|---|
| Topics per agent | 50 |
| Actions per topic | 20 |
| Input variables per action | 25 |
| Output variables per action | 25 |
| Active agents per org | 10 (extendable) |
| Session timeout | 60 min (configurable) |
| Apex action transaction limits | Standard governor limits per action invocation |
