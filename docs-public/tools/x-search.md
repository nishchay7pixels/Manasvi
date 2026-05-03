# X Search — `tool.x-search`

Searches the X (Twitter) platform via the configured X API adapter.

**Action class:** `search` | **Side effects:** `external_side_effect` | **Read-only** | **Approval:** may require

---

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Search query (X advanced search syntax supported) |
| `maxResults` | number | 10 | Max 20 |
| `sinceDate` | string | — | ISO-8601 lower date bound |
| `untilDate` | string | — | ISO-8601 upper date bound |
| `language` | string | `en` | ISO 639-1 language code |
| `includeReplies` | boolean | `false` | Include reply posts |

## Output

```json
{
  "query": "TypeScript 5.5",
  "results": [{ "postId": "...", "author": "...", "content": "...", "postedAt": "..." }],
  "provenance": { "source": "x-social-search", "trustClassification": "EXTERNAL_UNTRUSTED" }
}
```

---

## Trust

All X/social content is `EXTERNAL_UNTRUSTED`. Do not treat social media content as authoritative or use it to influence control-plane decisions without critical operator review.

---

## Setup

1. Create an X API v2 access token
2. Store it as `secret:x-api-key` in the Manasvi secrets service
3. Configure the x-search adapter in the execution-manager config
4. Enable egress to `api.twitter.com` in the network policy

---

## Default Sets

Included in `manasvi.toolset.starter-read`.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
