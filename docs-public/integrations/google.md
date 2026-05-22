# Google Integration

Manasvi’s Google integration uses a backend-neutral capability router. Agents request Manasvi Google capabilities; agents never receive shell access, raw `gog` access, OAuth tokens, or raw Google API clients.

## Google integration modes

| Mode | Description | Best for |
|---|---|---|
| `gog` | Uses the external `gog` CLI behind Manasvi governance | Local/dev |
| `native` | Uses Google OAuth and Google APIs behind Manasvi governance | Production/governed use |
| `mixed` | Uses different backends per Google service | Advanced setups |

All modes flow through:

```txt
Google capability request
  -> capability registry
  -> capability router
  -> policy / approval checks
  -> selected provider
  -> normalized result
  -> audit metadata
```

Backend fallback is never silent. If a capability cannot run on the configured backend, Manasvi blocks and reports the mismatch.

## G3 status

Milestone G3 adds the native Google API backend for Gmail and Calendar while preserving the G2 `gog` backend.

Native support in G3:

- `google.gmail.search`
- `google.gmail.read`
- `google.gmail.draft` behind verified approval
- `google.gmail.send` behind verified approval
- `google.calendar.list`
- `google.calendar.create` behind verified approval
- `google.calendar.update` behind verified approval
- `google.calendar.delete` behind verified approval

Drive, Docs, Sheets, and Contacts remain on the `gog` backend or future native milestones.

## OAuth setup

Set OAuth configuration through environment variables:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4100/integrations/google/oauth/callback
```

Start OAuth:

```bash
pnpm manasvi integrations google oauth start
```

Complete OAuth manually if using CLI completion:

```bash
pnpm manasvi integrations google oauth complete --code <code> --state <state>
```

Check OAuth status:

```bash
pnpm manasvi integrations google oauth status
```

Tokens are stored outside normal config under:

```txt
~/.manasvi/secrets/google/tokens.json
```

Token values are encrypted and the local token files are written with restricted file permissions. This is suitable for local development; production should wire the same provider interface to an external secrets vault.

## Scope model

Scopes are explicit per capability. Manasvi does not silently request or expand scopes during execution.

Important mappings:

| Capability | Required scope |
|---|---|
| `google.gmail.search` | `https://www.googleapis.com/auth/gmail.readonly` |
| `google.gmail.read` | `https://www.googleapis.com/auth/gmail.readonly` |
| `google.gmail.draft` | `https://www.googleapis.com/auth/gmail.compose` |
| `google.gmail.send` | `https://www.googleapis.com/auth/gmail.send` |
| `google.calendar.list` | `https://www.googleapis.com/auth/calendar.readonly` |
| `google.calendar.create` | `https://www.googleapis.com/auth/calendar.events` |
| `google.calendar.update` | `https://www.googleapis.com/auth/calendar.events` |
| `google.calendar.delete` | `https://www.googleapis.com/auth/calendar.events` |

Missing scopes block execution and include a reconnect next step.

## Backend switching

Global mode:

```bash
pnpm manasvi integrations google switch-mode gog
pnpm manasvi integrations google switch-mode native
pnpm manasvi integrations google switch-mode mixed
```

Per-service backend:

```bash
pnpm manasvi integrations google set-backend gmail native
pnpm manasvi integrations google set-backend calendar native
pnpm manasvi integrations google set-backend drive gog
pnpm manasvi integrations google set-backend docs gog
```

Shortcut:

```bash
pnpm manasvi connect google --mode native
pnpm manasvi connect google gmail --mode native
```

Switching backends does not delete native tokens, delete `gog` auth, or grant scopes automatically.

## gog mode

`gog` mode lets Manasvi use the external `gog` CLI as a Google Workspace execution backend.

The agent never calls `gog` directly. Manasvi maps approved Google capabilities to safe, predefined `gog` commands and executes them with `spawn()` argument arrays, not shell interpolation.

Before using gog mode, install and authenticate gog separately:

```bash
gog auth credentials /path/to/client_secret.json
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets
```

## Approval requirements

Write and destructive actions require approval in both `gog` and `native` modes.

G3 includes native Gmail and Calendar write client methods, but provider execution remains blocked unless approval verification is wired and passes. Approval must come from execution context, not from user-controlled input.

## CLI

```bash
pnpm manasvi integrations google status
pnpm manasvi integrations google status --json
pnpm manasvi integrations google check
pnpm manasvi integrations google check --backend gog
pnpm manasvi integrations google check --backend native
pnpm manasvi integrations google oauth start
pnpm manasvi integrations google oauth complete --code <code> --state <state>
pnpm manasvi integrations google oauth status
```

Status shows configured mode, service backends, native token status, granted/missing scopes, approval requirements, and security boundaries.

## Security boundaries

- `gog` is an internal execution backend, not an agent tool.
- Native Google clients are provider internals, not agent tools.
- OAuth tokens and refresh tokens are redacted and not stored in normal config.
- Capability routing is mandatory.
- Missing scopes block execution.
- Write actions require approval in both backends.
- Audit metadata is produced for completed, blocked, failed, and not-connected outcomes.
