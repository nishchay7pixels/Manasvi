---
sidebar_position: 2
title: Policy-Governed Agents
description: Why explicit policy is better than implicit configuration
---

# Policy-Governed Agents

## The current approach: configuration

Most agent frameworks govern behavior through configuration: you decide which tools the agent can use, and then it uses them. This is simple and works for low-stakes applications.

The problem: configuration is coarse. You can say "the agent can use the web search tool" or "the agent cannot use the web search tool" — but you can't easily say "the agent can use web search when the user is an authenticated employee, but not when the request comes from the public API, and always only for approved domains."

## The Manasvi approach: runtime policy evaluation

Manasvi evaluates authorization at runtime, for every proposed action, considering the full context of the request.

Policy rules can reference:

- **Who is asking**: user identity, trust level, channel
- **What they want to do**: tool, action class, specific parameters
- **What resource is targeted**: which URL, which file, which endpoint
- **The current context**: time of day, session state, previous approvals
- **The risk level**: how sensitive this category of action is

This means the policy decision for "fetch this URL" can be different depending on whether it's a trusted operator making an internal API call or an unauthenticated user making a request to an external endpoint.

## Why policy > configuration

**Expressiveness**: Policy can express conditions that configuration can't. Not just "can the agent use this tool" but "under what conditions, for whom, and requiring what approval."

**Composability**: Policy layers compose. System defaults apply everywhere; operator rules refine them; user rules refine further. You can build up a precise authorization model without fighting with a flat configuration file.

**Auditability**: Every policy decision is recorded with its reason codes. You can always answer "why was this action allowed?" or "why was it denied?" You can't do this with configuration — you just know whether something is enabled or not.

**Fail-closed**: Policy evaluation failure is a denial. Configuration not loading might silently allow everything.

## What this looks like in practice

Instead of:
```
allowed_tools: [web_search, file_read, memory_write]
```

You configure:
```
rules:
  - tool: file_read
    conditions:
      actor_trust: >= trusted
    decision: allow

  - tool: web_search
    conditions:
      resource: not in approved_domains
    decision: deny

  - tool: shell_command
    decision: allow_with_approval
    approval_channel: admin
```

The agent can read files if the user is trusted. It can search the web, but only approved domains. Shell commands always go to an admin for approval.

## Related pages

- [Policies](/docs/concepts/policies) — how policies work
- [Architecture: Policy Service](/docs/architecture/policy-service) — implementation
- [Why Manasvi: Not Just a Chatbot](/docs/why-manasvi/not-just-a-chatbot)
