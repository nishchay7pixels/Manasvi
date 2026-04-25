---
sidebar_position: 2
title: Contributing
description: How to contribute to Manasvi
---

# Contributing

## Getting started

Manasvi is an open project. Contributions are welcome — whether that's bug reports, documentation improvements, new features, or security findings.

Before contributing code, please read this guide. It covers the project structure, how to run the development environment, and the conventions we follow.

## Project structure

```
manasvi/
├── apps/                    # Deployable services
│   ├── ingress-service/     # Message ingress (Telegram, API)
│   ├── orchestrator-service/# Agent runtime + policy service
│   ├── node-manager/        # Remote node management
│   ├── node-agent/          # Runs on remote nodes
│   └── docs-web/            # This documentation site
│
├── packages/                # Shared libraries
│   ├── contracts/           # Shared schemas and types
│   ├── executor-sdk/        # Execution intent + artifact utilities
│   └── tool-sdk/            # Tool manifest and execution primitives
│
├── docs-public/             # Public documentation content
└── docs-internal/           # Internal design docs and progress notes
```

## Development environment

### Prerequisites

- Node.js 20+
- pnpm 9+

### Install dependencies

```bash
pnpm install
```

### Run all services

```bash
pnpm dev
```

### Run tests

```bash
pnpm test
```

### Type checking

```bash
pnpm typecheck
```

## Contribution process

1. **Check existing issues** — see if the bug or feature is already tracked
2. **Open an issue** — for non-trivial changes, describe what you want to do before starting work
3. **Fork and branch** — use a descriptive branch name (`fix/approval-expiry-check`, `feat/slack-adapter`)
4. **Write tests** — new behavior should have tests; bug fixes should have a regression test
5. **Submit a pull request** — describe what you changed and why

## Code conventions

### TypeScript

- Strict mode is enabled. No `any` unless justified.
- Use Zod schemas for all external inputs.
- Prefer explicit return types on exported functions.

### Security-critical code

If you're touching authorization, signing, verification, or the policy service:

- Document the security property your change preserves or adds
- Ensure tests cover both the happy path and the failure case
- Tag the PR with `security` for additional review

### Tests

- Unit tests live next to the code they test (`foo.test.ts` alongside `foo.ts`)
- Tests should be readable as documentation — clear names, explicit arrange/act/assert structure
- Avoid mocking unless you're testing a unit boundary. Integration tests should use real service calls.

## Reporting security issues

Please do not report security vulnerabilities through public GitHub issues.

Instead, email the security contact directly with:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any proposed fix

We will respond within 48 hours and work with you on a coordinated disclosure.

## Documentation

Documentation is in `docs-public/`. The site is built with Docusaurus and lives in `apps/docs-web/`.

To run the docs site locally:

```bash
cd apps/docs-web
pnpm start
```

Documentation PRs are welcome — especially for setup guides, troubleshooting, and conceptual explanations. If you find something confusing or missing, that's a bug worth fixing.

## License

See the LICENSE file at the root of the repository.
