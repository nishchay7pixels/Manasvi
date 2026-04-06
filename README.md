# Manasvi (Secure orchestration for real-world AI actions)

Secure, policy-driven, multi-service agent operating fabric for auditable AI automation.

## What Is Manasvi?

Manasvi is an architecture-first runtime for agent workflows where identity, policy, approvals, provenance, and execution safety are core system contracts.

Manasvi is:
- A distributed control and execution fabric for LLM-assisted automation.
- A system with explicit trust boundaries across channels, orchestration, policy, memory, and execution.
- A platform intended for real-world side effects with governance, not just prompt-response demos.

Manasvi is not:
- A simple chatbot.
- A thin LLM API wrapper.
- An in-process tool-calling loop where model output directly triggers actions.

## Why Manasvi Exists

Most agent implementations optimize for speed of feature assembly: prompt in, tool call out. That pattern is useful for prototypes, but unsafe for systems that can mutate data, access secrets, or trigger external effects.

Common failure modes Manasvi is designed to avoid:
- Prompt output treated as authority for side effects.
- Weak boundaries between user input, model suggestions, and execution.
- Plugins/extensions trusted because they are "inside" the app.
- Session membership mistaken for authorization.
- Insufficient identity attribution and policy traceability.
- Poor replay/immutability protections for sensitive actions.
- Incomplete auditability of why actions were allowed.

Manasvi exists to make those boundaries explicit and enforceable in the architecture itself.

## Core Design Philosophy

- Zero-trust by default: model output, external content, plugins, channels, and nodes are untrusted until validated.
- Policy first: sensitive decisions are centralized through policy evaluation, not scattered conditionals.
- Separation of planes: ingress, orchestration, policy, execution, memory, extensions, and observability stay distinct.
- Observable side effects: every significant decision/action carries traceable metadata and audit context.
- Capability-based access: actions are authorized against principals, resources, actions, and capability scope.
- Isolation over convention: safety is encoded in contracts, validation, and boundaries, not "engineer discipline".
- Human approval as security primitive: approval is protocol-level for dangerous actions, not only a UI event.
- Model output is not executable authority: model proposals become structured intents, never direct execution.
- Session is context hygiene, not authorization: session boundaries reduce leakage but do not grant privilege.
- Plugins/tools/nodes are untrusted by default: internal network location does not imply trusted authority.

## High-Level Architecture

```text
                         External Channels / API Clients
                                      |
                                      v
+------------------+       +----------------------+       +------------------+
| Ingress Plane    | ----> | Orchestration Plane | ----> | Policy Plane     |
| normalize input  |       | session/context/flow |       | allow/deny/need  |
| provenance/trust |       | intent creation       |       | approval         |
+------------------+       +----------+-----------+       +------------------+
                                     |
                                     v
                          +----------------------+
                          | Approval Plane       |
                          | request/decide/sign  |
                          | approved artifacts   |
                          +----------+-----------+
                                     |
                                     v
                          +----------------------+
                          | Execution Plane      |
                          | validate artifact    |
                          | fail-closed gating   |
                          +----------+-----------+
                                     |
                                     v
                          +----------------------+
                          | Side Effects / Tools |
                          +----------------------+

Cross-cutting planes:
- Identity/Principal model
- Memory/context provenance
- Observability/audit
- Node/remote execution management
```

### Plane Responsibilities

- Ingress plane: authenticates where possible, normalizes inbound messages to canonical events, tags trust/provenance.
- Orchestration plane: resolves identity/session/context, calls policy, creates execution intents, coordinates flow.
- Policy plane: evaluates authorization using principal/action/resource/capability/risk context.
- Approval plane: handles approval requests/decisions and issues signed approval-bound artifacts.
- Execution plane: validates intent + artifact immutability/signature/expiry/replay before any sensitive execution.
- Memory plane: stores context/memory with trust classes and provenance lineage.
- Extension plane: isolates plugin workloads and capability contracts.
- Node plane: manages local/remote execution node identity and scoped authority.
- Observability plane: structured logs, traces, and durable decision/action records.

## Conceptual Request Lifecycle

Typical path for a sensitive workflow:

1. Message enters ingress.
2. Identity is resolved (caller, actor, tenant/workspace context).
3. Session is resolved or created; context is assembled with provenance/trust tags.
4. Policy is evaluated for requested action/resource/capabilities/risk.
5. If action is dangerous, orchestrator creates an execution intent.
6. If policy requires approval, approval request is created and decided by authorized approver.
7. Approval service issues signed, payload-bound approved artifact.
8. Execution manager validates intent + artifact (schema, hash, signature, expiry, replay, state).
9. Only then can execution proceed.
10. Decisions and outcomes are logged/audited with trace linkage.

## What Makes Manasvi Different

Compared with common agent stacks, Manasvi emphasizes:
- Architecture-first design instead of wrapper-first assembly.
- Formal execution contracts instead of ad hoc tool invocation.
- Policy-governed side effects instead of implicit runtime trust.
- Approval-bound immutable artifacts instead of mutable post-hoc flags.
- Context provenance and trust labeling instead of flat prompt concatenation.
- Distributed boundary clarity for long-term multi-tenant and regulated use cases.

## Current Project Status

Manasvi is under active construction and is not production-complete.

Stable foundations implemented:
- Multi-service monorepo and shared contracts.
- Event envelope + event bus + dead-letter model.
- Identity/principal model and service-to-service auth.
- Policy service and authorization core.
- Session/context lifecycle with provenance tagging.
- End-to-end chat harness with model adapter modes.
- Execution intent and approval flow with strict execution validation.

Still evolving:
- Durable stores for approvals/intents/replay state.
- Full sandboxed execution runtime depth.
- Extension/runtime hardening and richer node dispatch controls.
- Broader production-grade operational hardening.

## Progress So Far

| Milestone | Focus | Why it exists | Status |
|---|---|---|---|
| 0 | Architecture + threat model specs | Prevent unsafe design drift before implementation | Completed |
| 1 | Monorepo + service foundation | Establish consistent boot/config/log/trace/security baseline | Completed |
| 2 | Canonical events + internal bus | Standardize inter-service communication and integrity semantics | Completed |
| 3 | Identity + principal model | Make caller/actor attribution explicit for policy and audit | Completed |
| 4 | Policy engine + auth core | Centralize allow/deny/approval decisions | Completed |
| 5 | Session + context lifecycle | Enforce context hygiene/provenance and prevent cross-session leakage | Completed |
| 5 (harness) | Early end-to-end AI path | Validate real message→policy→context→model loop | Completed |
| 6 | Execution intent + approval flow | Secure bridge from orchestration to side effects | Completed (runtime slice) |
| 7 | Sandboxed execution runtime | Harden real side-effect execution substrate | Completed |

## What Can Be Tested Right Now

- End-to-end chat harness flow through gateway/ingress/orchestrator/model adapter.
- Session creation/reuse and context trace outputs.
- Policy decision paths and reason codes.
- Execution intent creation and approval-required vs not-required outcomes.
- Approval decision submission and signed artifact issuance.
- Execution-manager fail-closed validation for:
  - malformed intent/artifact
  - hash mismatch (mutation)
  - invalid signature
  - expiration
  - replayed artifact ID

What is not complete yet:
- Full production sandbox runtime with broad tool adapters.
- Durable distributed stores for approval and replay controls.
- Full operator-grade approval UX.

## Using Manasvi

### Conceptual Usage

Future usage model:
- Integrate channels and business workflows into ingress/orchestration.
- Define policy/capability constraints centrally.
- Route dangerous operations through intent + approval + validation.
- Execute side effects only through validated execution contracts.

### Current Developer Usage

- Use `api-gateway` harness endpoint for end-to-end request flow.
- Use orchestrator/policy/approval/execution endpoints to validate governance protocol.
- Use structured logs and trace IDs to inspect decisions and state transitions.

## Repository Structure

```text
apps/
  api-gateway/
  ingress-service/
  orchestrator-service/
  policy-service/
  approval-service/
  execution-manager/
  memory-service/
  node-manager/
  audit-service/

packages/
  contracts/
  auth/
  logging/
  tracing/
  event-bus/
  policy-sdk/
  executor-sdk/
  session-sdk/
  model-adapter/
  plugin-sdk/
  service-runtime/
  testing/

configs/
  policies/

docs/
  architecture/
  security/
  progress/
  testing/
```

## Running Locally

### Prerequisites
- Node.js >= 20
- `pnpm`
- Docker (optional)

### Install
```bash
corepack enable
pnpm install
```

### Configure
Create `.env.local` from `.env.example` and fill required values.

Critical groups:
- Internal auth keys and issuer/audience.
- Event signing keys for internal event integrity.
- Approval signing/verification keys.
- Policy/orchestration/ingress base URLs.
- Model adapter mode (`ollama`, `mock`, or `openai`) and provider settings.

### Start
```bash
pnpm dev
```

If grouped startup is unstable on your machine, run critical services in separate terminals:
```bash
pnpm --filter @manasvi/policy-service dev
pnpm --filter @manasvi/approval-service dev
pnpm --filter @manasvi/orchestrator-service dev
pnpm --filter @manasvi/ingress-service dev
pnpm --filter @manasvi/api-gateway dev
pnpm --filter @manasvi/execution-manager dev
```

### Verify
```bash
pnpm health:check
```

### Build and test
```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm harness:smoke
```

### Local service ports
- `api-gateway`: `4100`
- `ingress-service`: `4101`
- `orchestrator-service`: `4102`
- `policy-service`: `4103`
- `execution-manager`: `4104`
- `memory-service`: `4105`
- `node-manager`: `4106`
- `audit-service`: `4107`
- `approval-service`: `4108`

## Safety and Security Posture

- Untrusted-by-default model outputs and external content.
- Policy-gated sensitive operations with explicit reason codes.
- Approval-aware execution protocol for dangerous actions.
- Payload-bound approved artifacts to prevent post-approval mutation.
- Strict execution validation and fail-closed behavior.
- Explicit identity attribution for caller/actor/session context.
- Provenance-rich context lifecycle and traceable assembly decisions.
- Least-privilege direction via capability-scoped decisions.

## Roadmap Ahead

Priority next steps:
- Harden sandboxed execution runtime and side-effect adapters.
- Introduce durable stores for intents, approvals, and replay protection.
- Expand approval authority and multi-step approval policies.
- Strengthen remote node controls and attestation signals.
- Expand memory plane capabilities and retention/governance controls.
- Improve observability and audit export pipelines.
- Add more channels and richer integration surfaces.

## Contribution and Development Philosophy

- Preserve trust boundaries; do not collapse planes for convenience.
- Never bypass policy for sensitive paths.
- Keep model proposal and execution authority separate.
- Preserve provenance and audit linkage in all new flows.
- Prefer fail-closed behavior for ambiguous/unsafe states.
- Make security semantics explicit in contracts, not implicit in comments.

## Documentation Map

- Architecture specifications: `docs/architecture/`
- Security specs and trust boundaries: `docs/security/`
- Progress and implementation notes: `docs/progress/`
- Testing and operator runbooks: `docs/testing/`

## Closing Summary

Manasvi is being built as an operating substrate for secure AI automation, not a thin agent wrapper.  
Its core value is architectural discipline: explicit identity, policy-first governance, approval-bound execution intent, provenance-aware context, and auditable side effects.  
The project is already testable end to end for core governance flows, while execution hardening and production durability are the next major build focus.
