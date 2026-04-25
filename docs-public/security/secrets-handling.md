---
sidebar_position: 7
title: Secrets Handling
description: How sensitive credentials are managed and protected
---

# Secrets Handling

## The problem with secrets in AI systems

AI agents frequently need to use credentials — API keys, passwords, tokens — to interact with external services. This creates a risk: if the agent can read a secret, and the agent's behavior can be influenced by external inputs, a malicious instruction in retrieved content could cause the agent to exfiltrate the secret.

Manasvi's approach to secrets is designed to prevent this.

## Secrets are not in the model's context

The most important principle: **secrets are never placed in the model's context window**. The model never sees a secret value.

When an agent needs to make an authenticated API call, the tool handles authentication at the execution layer — after the model has proposed the action and the execution manager has authorized it. The secret is retrieved from the secrets store and injected into the request without the model ever seeing the value.

## The secrets store

Secrets are stored in a dedicated, access-controlled secrets store:

- Secrets are named and versioned (e.g., `integration.slack.webhook-url`)
- Access is governed by capability grants (`access-secret`)
- Only tools with an explicit `access-secret` grant for a specific secret name can read it
- Access is logged in the audit trail

## Capability-gated access

A tool that needs a secret must declare it in its manifest:

```
Required capabilities:
  - access-secret: integration.slack.webhook-url
```

If the tool's manifest doesn't include this declaration, the tool cannot access the secret — even if the model requests it.

This means: if a manipulated agent attempts to use a tool to read a secret it wasn't declared to access, the capability enforcement will block it.

## Plugin access to secrets

Plugins that need secrets must request access in their manifest. Operator approval is required. The approval is secret-name specific — you can grant a plugin access to `api.openai.key` without granting it access to `db.production.password`.

## Audit trail

Every secret access is recorded:

- Which secret was accessed
- Which tool accessed it
- The execution intent ID (linking back to the full authorization chain)
- Timestamp

This means you can audit: "which tools accessed the production database password in the last 30 days?"

## Related concepts

- [Security: Sandboxed Execution](/docs/security/sandboxed-execution) — how tools run in constrained environments
- [Security: Plugin Isolation](/docs/security/plugin-isolation) — how plugin capabilities are enforced
- [Plugins](/docs/concepts/plugins) — plugin capability declarations
