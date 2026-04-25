---
sidebar_position: 1
title: Agent Runtime
description: What is the agent runtime and how does it work?
---

# Agent Runtime

## What is it?

The agent runtime is the "brain" of Manasvi — the component that takes an incoming message, thinks about what to do, and coordinates the response.

When you send Manasvi a message like "Search for recent news about climate policy," the agent runtime:

1. Reads your message and any relevant context from your conversation history
2. Asks the AI model what it should do
3. Parses the model's response into a structured decision
4. Checks whether that decision is suspicious or violates any rules
5. Asks the policy service whether the proposed action is allowed
6. Requests approval if the action is sensitive
7. Issues a signed execution intent for any actions that will proceed
8. Waits for results and assembles a response

## Why is this better than a direct model-to-tool connection?

In a typical agent framework, the model directly decides to call tools and the framework executes them. This is simple but creates several problems:

- **No authorization layer**: If the model decides to delete a file, who stops it?
- **No audit trail**: What did the model actually decide? What did it execute?
- **Prompt injection risk**: What if malicious content in a document tells the model to ignore its instructions?
- **No approval for dangerous actions**: Should any AI be able to send emails without human review?

The Manasvi agent runtime inserts a structured governance layer between the model's output and any execution. The model proposes; the runtime validates, authorizes, and records.

## The planning loop

The agent runtime operates in a loop:

1. **Assemble context** — recent messages, memory, system configuration, all labeled with their trust level
2. **Invoke the model** — send the assembled context and instructions
3. **Parse the response** — interpret what the model wants to do (respond, propose a tool action, ask for clarification, or stop)
4. **Validate the proposal** — check for suspicious patterns (e.g., model claiming it already got approval for something)
5. **Evaluate policy** — ask the policy service whether this is allowed
6. **Create an intent** — issue a signed, time-limited execution intent
7. **Handle approval if needed** — if policy says approval is required, pause and wait
8. **Execute** — once authorized, dispatch to the execution manager
9. **Update context** — store the result for the next loop iteration

The loop has limits: a maximum number of iterations (to prevent infinite loops) and a maximum number of consecutive errors (to halt safely when something is wrong).

## Key safety properties

- Model output is **never directly executed** — it must pass through proposal parsing, validation, and authorization first
- Suspicious proposals (e.g., model claiming approval it doesn't have) are **rejected by default**
- External content (like web search results) cannot **claim control authority** over the agent's behavior
- Every decision is **recorded** in the audit trail

## Related concepts

- [Execution Intent](/docs/concepts/execution-intent) — the signed artifact that authorizes execution
- [Policies](/docs/concepts/policies) — how authorization decisions are made
- [Approvals](/docs/concepts/approvals) — how sensitive actions get human sign-off
