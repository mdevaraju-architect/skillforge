---
name: agentforce-agent-design-patterns
description: >-
  Agentforce, agent topic, agent action, agent guardrail, agent channel,
  agent session, agent testing, system prompt, Service Agent, Sales Agent,
  Einstein Copilot, AgentTopic, AgentAction, Agentforce Studio, Bot,
  BotVersion, ConversationDefinition, EinsteinLLMSettings, GenAiPlugin,
  GenAiPluginInstructions, MlDomain, agentforce builder, topic classifier,
  action classifier, action invocation, invocable action, prompt chaining,
  out-of-scope response, clarification, grounding, hallucination, agent
  evaluation, agent simulation, agent metadata, agent deployment, agent limit
compliance:
  regulations: []
  org-types: ["scratch", "sandbox", "uat", "production"]
  data-sensitivity: "none"
license: MIT
metadata:
  author: skillforge-maintainers
  version: 1.0.0
  domain: agentforce
  module: agent-design-patterns
  api-version-min: "62.0"
  salesforce-release-min: "Spring26"
  approval-tier: "draft"
---

# Agentforce Agent Design Patterns

You are helping design, build, configure, test, or troubleshoot an **Agentforce agent** on Salesforce. Agentforce is the Salesforce platform for deploying AI agents — autonomous, multi-step assistants that can take actions in Salesforce and connected systems. It is not a chatbot, not Einstein Copilot (retired), and not a Flow.

This file is your routing layer. Load the right reference before answering detailed questions.

---

## Always-true gotchas (never forget these)

1. **Topics are classifiers, not flows.** A Topic tells the agent *what kind of request this is*. It does not execute steps — the LLM routes to it, then selects an Action. Never put business logic in a Topic description. Topic descriptions are natural-language classifiers only.

2. **Actions are the unit of execution — not Topics.** Every real action (query, update, send, calculate) lives in an Action. Actions are invocable methods, flows, prompt templates, or external service calls. If a developer asks "how do I make the agent do X", the answer is always: build an Action.

3. **Agentforce is not a chatbot.** It can take multi-step autonomous actions without user confirmation on each step. Design for that: every Action must be safe to execute without asking "are you sure?" — or include an explicit confirmation step in the action's flow/Apex.

4. **`GenAiPlugin` is the metadata type for an Agent Topic.** `GenAiPlugin` has `GenAiPluginInstructions` child records — those are the actions. Do not confuse with `Bot` (legacy Einstein Bot metadata). Agentforce uses `GenAiPlugin`, not `Bot`.

5. **System prompts are not editable in production via UI.** The base system prompt is Salesforce-managed. You extend it through the agent's Instructions field and through Topic/Action descriptions. Attempting to fully replace the system prompt is not supported.

6. **Out-of-scope handling is a Topic, not an error.** Always define an explicit "Out of Scope" topic with a clear description and a graceful decline action. Without it, the agent attempts to answer anything — including requests it should refuse.

7. **Action descriptions are LLM instructions, not documentation.** The Action description is what the LLM reads to decide whether to invoke this action. Write it as: "Use this action when the user wants to [specific intent]. Do not use it for [exclusions]." Vague descriptions cause mis-invocation.

8. **Governor limits apply inside Agentforce actions.** Each action invocation runs in a standard Apex transaction context — 100 SOQL queries, 150 DML rows, 10MB heap. The agent's multi-step loop does NOT share a single transaction. Each action step is a separate transaction.

9. **Channels affect what actions are available.** An action enabled for Messaging (SMS) behaves differently from one in Service Console. Some UI-dependent actions (open record, navigate) are not available on async/messaging channels. Always check channel compatibility.

10. **Testing requires Simulation mode, not live sessions.** Use Agentforce Studio → Test tab (Simulation) for development. Do not test against production agent sessions — errors and unexpected responses are logged and may surface to end users.

11. **`MlDomain` controls which LLM model the agent uses.** The default is `sfdc_ai__DefaultGPT4Omni`. You can override per org in Einstein Setup → AI Models. Do not hardcode model names in prompts — the model can be swapped by an admin.

12. **Action output must be a single `String` or `List<String>` to display in chat.** Agentforce renders action output as a chat message. Complex objects, SObject results, and maps are not directly renderable — transform them to a formatted string in the action before returning.

13. **Clarification vs. out-of-scope are different patterns.** Clarification asks the user for more info before proceeding. Out-of-scope declines entirely. Do not use out-of-scope when you mean clarification — the agent should ask, not refuse, when intent is ambiguous but in-domain.

14. **`AgentTopic` and `AgentAction` are the Spring 26 metadata type names.** Earlier docs and videos may use `GenAiPlugin` / `GenAiPluginInstructions`. Both refer to the same things — the new names are the current API. Use `AgentTopic` / `AgentAction` in new metadata.

---

## When to load which reference

| User intent | Load |
|---|---|
| Overall architecture, how Agentforce works, layers, mental model | `references/01-architecture.md` |
| Building topics — classifiers, descriptions, scope | `references/02-topics.md` |
| Building actions — invocable methods, flows, prompt templates, external calls | `references/03-actions.md` |
| Guardrails, out-of-scope, safety, restrictions, declining requests | `references/04-guardrails-and-safety.md` |
| Testing, simulation, evals, debugging, logs | `references/05-testing-and-evaluation.md` |

---

## Named workflows

### Workflow 1 — Build a new Agentforce agent from scratch

1. Enable Agentforce in Setup → Agentforce → Agent Setup. Enable Einstein generative AI features.
2. Open Agentforce Studio → New Agent. Choose agent type: Service Agent (customer-facing) or Internal Agent (employee-facing).
3. Define the agent's persona in the Instructions field — role, tone, what it can and cannot do.
4. Create Topics (classifiers). Start with 3–5 focused topics. Add an "Out of Scope" topic last.
5. For each Topic, create Actions. Map each action to an invocable method, Flow, Prompt Template, or External Service.
6. Write Action descriptions as LLM instructions — what the action does and when to invoke it.
7. Test in Simulation mode. Watch the topic classification and action selection trace.
8. Refine topic descriptions if the wrong topic fires. Refine action descriptions if the wrong action fires.
9. Activate the agent. Deploy to a Channel (Messaging, Service Console, Experience Cloud, or custom).

### Workflow 2 — Diagnose a mis-firing topic or action

1. Open Agentforce Studio → Test → Simulation. Reproduce the failing conversation.
2. In the trace panel, note which Topic was classified and which Action was selected.
3. If wrong Topic: compare your Topic description to the user's phrasing. The description should explicitly include the kind of language the user used. Update the description — do not add more Topics to "catch" edge cases.
4. If wrong Action: check that the Action description explicitly says what it handles and what it does NOT handle. Overlapping action descriptions cause random selection.
5. If no Topic matched: the input may genuinely be out of scope, or your topic descriptions are too narrow. Broaden the intended topic before adding a new one.
6. If the agent refused when it shouldn't: check the Guardrails settings and the Out-of-Scope topic description.
7. Re-test after each change. Changes to descriptions take effect immediately in Simulation — no deployment needed.

### Workflow 3 — Add an external system action to an agent

1. Create a Named Credential for the external system (Setup → Named Credentials).
2. Create an External Service from the OpenAPI spec or manually define the operation (Setup → External Services).
3. In Agentforce Studio, create a new Action. Type: External Service. Select the operation.
4. Map the action's input parameters to Agentforce context variables (e.g., `{!Account.Name}`).
5. Write the Action description: "Call this action when the user asks to [intent] using [system name]."
6. Test in Simulation. Check that the Named Credential authenticates and the response is returned correctly.
7. Transform the response to a string in the action output field for display in chat.

---

## NOT covered by this skill

- **Einstein Bots (legacy)** — the `Bot` / `BotVersion` metadata pre-Agentforce. Use a dedicated legacy bot skill.
- **Prompt Builder / GenAiPromptTemplate** in isolation — covered by `agentforce-prompt-template-authoring`.
- **Data Cloud grounding and unified profiles** — covered by `data-cloud-identity-resolution`.
- **Flow Builder internals** — covered by `platform-async-patterns`.
- **Specific industry agent templates** (FSC Claims Triage, Health intake) — see the relevant industry skill.
