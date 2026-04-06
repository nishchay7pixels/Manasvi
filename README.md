# Manasvi Monorepo Foundation (Milestone 1)

This repository is the multi-service platform foundation for Manasvi.

## Stack Choice
- **Runtime:** Node.js + TypeScript (single-language platform for consistency).
- **Monorepo:** `pnpm` workspaces + `turborepo`.
- **Why:** fast local iteration, explicit package boundaries, shared package reuse, CI-friendly incremental tasks, and predictable dependency management.

## Repository Structure
```text
apps/
  api-gateway/
  ingress-service/
  orchestrator-service/
  policy-service/
  execution-manager/
  memory-service/
  node-manager/
  audit-service/

packages/
  contracts/
  auth/
  logging/
  tracing/
  policy-sdk/
  executor-sdk/
  plugin-sdk/
  session-sdk/
  testing/
  service-runtime/
  event-bus/

docker/
scripts/
docs/
```

## Shared Package Usage
- `@manasvi/contracts`: versioned shared service and protocol contract types.
- `@manasvi/service-runtime`: standardized service bootstrap (config, secrets, health/readiness, shutdown).
- `@manasvi/event-bus`: canonical event publish/consume abstraction with retry, idempotency and dead-letter behavior.
- `@manasvi/logging`: structured JSON logging with redaction and trace fields.
- `@manasvi/tracing`: trace/correlation propagation and request-scoped context.
- `@manasvi/auth`: principal schemas, short-lived internal token auth, principal registry, and principal-resolution middleware.
- `@manasvi/policy-sdk`: typed HTTP client for `policy-service` evaluation API.
- `@manasvi/executor-sdk`: execution dispatch interfaces.
- `@manasvi/plugin-sdk`: plugin manifest and hook contracts.
- `@manasvi/session-sdk`: session store, isolation-aware resolution, and context assembly pipeline with provenance traces.
- `@manasvi/testing`: reusable health/readiness and contract test helpers.

## Service Boot Convention
Every service follows the same pattern:
1. `src/config.ts`: typed env + secret-backed config loading with startup validation.
2. `src/index.ts`: boot via `startHttpService` from `@manasvi/service-runtime`.
3. Expose:
   - `GET /health` (liveness)
   - `GET /ready` (readiness checks)
4. Emit startup/shutdown + request logs with trace and correlation IDs.

## Config and Secret Conventions
- Profiles: `local | dev | test | staging | production` via `MANASVI_ENV`.
- Required config is validated at startup; invalid config causes boot failure.
- Secret access goes through `SecretProvider` abstraction (`@manasvi/service-runtime`).
- `SECRET_PROVIDER=env` for local. `external-stub` exists as future extension point.
- No plaintext secrets are committed. Use `.env.example` placeholders only.
- Sensitive config is fail-closed in `staging`/`production` by requiring secret values.

## Logging and Trace Conventions
- Structured JSON logs by default.
- Every log includes:
  - `timestamp`, `level`, `service`, `version`, `environment`
  - `traceId`, `correlationId`
  - message + structured fields
- Redaction is built in for sensitive key patterns (`secret`, `token`, `password`, `key`).
- Request handlers always propagate `x-trace-id` and `x-correlation-id`.
- Internal service-to-service calls use short-lived bearer tokens with caller/actor claims.
- Policy service settings:
  - `POLICY_SERVICE_BASE_URL`
  - `POLICY_SET_PATH`
  - `POLICY_DECISION_AUDIT_BUFFER_SIZE`
- Internal auth env vars:
  - `INTERNAL_AUTH_ISSUER`
  - `INTERNAL_AUTH_AUDIENCE`
  - `INTERNAL_AUTH_KEY_ID`
  - `INTERNAL_AUTH_SIGNING_SECRET` (issuer-side, e.g., ingress)
  - `INTERNAL_AUTH_VERIFICATION_KEYS` (verifier-side map `kid:secret,...`)

## Local Development

### Prerequisites
- Node.js >= 20
- `pnpm` (via corepack recommended)
- Docker (for compose-based multi-service boot)

### Install
```bash
corepack enable
pnpm install
```

### Run all services (host)
```bash
pnpm dev
```

### Run one service
```bash
pnpm --filter @manasvi/policy-service dev
```

### Run all services (Docker Compose)
```bash
docker compose up --build
```

### Verify health/readiness
```bash
pnpm health:check
```

## Deterministic Local Port Map
- `api-gateway`: `4100`
- `ingress-service`: `4101`
- `orchestrator-service`: `4102`
- `policy-service`: `4103`
- `execution-manager`: `4104`
- `memory-service`: `4105`
- `node-manager`: `4106`
- `audit-service`: `4107`

## Build/Test/Lint/Typecheck
```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

## Add a New Service (Bootstrap Pattern)
1. Create `apps/<service-name>/` with `package.json`, `tsconfig.json`, `src/config.ts`, `src/index.ts`.
2. In `config.ts`:
   - define schema by extending `baseServiceConfigSchema`
   - load with `loadValidatedConfig`
   - require sensitive secrets for `staging`/`production`
3. In `index.ts`:
   - call `startHttpService`
   - provide readiness checks
   - add service-specific routes
4. Add service to:
   - root `tsconfig.json` references
   - `docker-compose.yml` (if needed in local all-services boot)
   - port map documentation

## Milestone 1 Boundaries
Implemented:
- monorepo, shared packages, consistent service bootstrap, health/readiness, config validation, structured logging, trace/correlation, local compose.

Deferred to Milestone 2+:
- policy engine internals
- execution intent validation pipeline
- plugin host runtime
- node attestation and grant issuance backend

## Milestone 2 Event Slice
- Ingress publishes normalized canonical events to `EVENT_BUS_TARGET_URLS` (default: `http://localhost:4102/internal/events`).
- Orchestrator subscribes via `/internal/events` and validates schema/integrity/idempotency before handling.
- Dead letters are available at `GET /internal/dead-letter` on orchestrator.

## Milestone 4 Policy Slice
- Policy service evaluates authorization requests at `POST /policy/evaluate`.
- Orchestrator and execution manager call policy-service before sensitive operations.
- Policy decisions include reason codes, matched policy metadata, risk metadata, and audit linkage.
- Policy metadata and decision audit visibility:
  - `GET /policy/metadata`
  - `GET /policy/audit/decisions`

## Milestone 5 Session/Context Slice
- Orchestrator resolves/creates sessions and assembles structured context with provenance/trust metadata.
- Context traces are generated per message and can be inspected with:
  - `GET /orchestration/context-traces?sessionId=<id>`
  - `GET /orchestration/sessions?sessionId=<id>`
- Session isolation is explicit and session membership does not replace policy authorization.
