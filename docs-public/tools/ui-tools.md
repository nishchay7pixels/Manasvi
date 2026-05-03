# UI Tools

Two tools for interacting with operator-visible UI surfaces: `browser` and `canvas`.

---

## browser — `tool.browser`

Controls a headless browser session for page navigation, screenshot capture, text extraction, and form interaction.

**Action class:** `render-ui` | **Side effects:** `external_side_effect` | **Approval:** required

### Operations

| Operation | Description |
|---|---|
| `open` | Navigate to a URL |
| `screenshot` | Capture a PNG screenshot |
| `extract_text` | Extract visible text from the page |
| `click` | Click a CSS-selected element |
| `fill` | Fill a form field |
| `close` | Close the browser session |

### Safety notes
- All browser content is `EXTERNAL_UNTRUSTED`
- Egress restricted to operator-configured allowlist
- Requires a provisioned headless browser runtime (Playwright/Puppeteer)
- Approval required — browsers can access external URLs

### Setup

Provision a browser runtime in the execution environment and configure `browser.control` capability in the execution-manager.

---

## canvas — `tool.canvas`

Renders structured content to the operator-visible canvas surface in the admin dashboard.

**Action class:** `render-ui` | **Side effects:** `external_side_effect` | **Approval:** may require

### Operations

| Operation | Description |
|---|---|
| `render` | Replace canvas content |
| `append` | Add to existing canvas |
| `clear` | Clear canvas |
| `export` | Return current canvas as string |

### Formats

`markdown`, `html`, `json`, `text`

### Safety notes
- HTML content is sandboxed in the dashboard renderer
- Canvas operations are audited
- Canvas is visible to operators in the dashboard Canvas tab

---

## Default Sets

`tool.browser` is included in `manasvi.toolset.workflow-operator`.
`tool.canvas` is included in `manasvi.toolset.controlled-write`.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
