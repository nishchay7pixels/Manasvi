---
sidebar_position: 18
title: Connect Google (Foundation)
description: Connect a Google account to Manasvi's reusable integration substrate
---

# Connect Google (Foundation)

Milestone G1 adds the shared Google integration foundation used by future Gmail, Calendar, Drive, and Docs connectors.

## What this enables now

- Connect a Google account through OAuth 2.0
- Store access/refresh state securely (encrypted token vault + secret references)
- Refresh and revoke/disconnect lifecycle management
- Status visibility in CLI and dashboard
- Gmail read integration (health, list/search/read/thread inspection with policy enforcement)

## What this does not enable yet

- Sending Gmail messages
- Managing Calendar events
- Reading/writing Drive files
- Editing Docs content

Those arrive in later milestones and will reuse this foundation.

## Prerequisites

- Running Manasvi services (`pnpm manasvi start`)
- Google OAuth client configured in `.env.local`

Required env vars:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (default: `http://127.0.0.1:4100/integrations/oauth/google/callback`)

## Connect flow

```bash
pnpm manasvi integrations add google
```

1. CLI calls gateway integration endpoint.
2. Gateway issues a secure OAuth state.
3. CLI prints the Google authorization URL.
4. You complete consent in browser.
5. Google calls the configured callback URL.
6. Gateway exchanges code for tokens and stores encrypted references.

## Check status

```bash
pnpm manasvi integrations status
pnpm manasvi integrations list
```

Dashboard: open **Integrations** and inspect the Google card.

For governed permissions, action classes, and policy decisions, see:

- `/docs/setup/google-permissions-and-policy`

## Disconnect

```bash
pnpm manasvi integrations remove google
```

This revokes/disconnects and clears token references from the active account state.

## Troubleshooting

- `Failed to start Google OAuth flow`: verify client ID/secret are present.
- `OAuth state is invalid or expired`: start flow again; state TTL is short-lived.
- `refresh_failed`: reconnect to issue a fresh refresh token.
- No dashboard status: verify api-gateway is running on port `4100`.
