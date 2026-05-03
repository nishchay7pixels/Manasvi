import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── browser ────────────────────────────────────────────────────────────────────

const browserInputSchema = z.object({
  operation: z.enum(["open", "screenshot", "extract_text", "click", "fill", "close"]).default("open"),
  url: z.string().url().optional(),
  selector: z.string().optional(),
  value: z.string().optional(),
  sessionId: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60000).default(20000)
});

const browserOutputSchema = z.object({
  operation: z.string(),
  sessionId: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  screenshotBase64: z.string().optional(),
  success: z.boolean(),
  provenance: z.object({
    source: z.literal("browser-session"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED"),
    url: z.string().optional()
  }).optional()
});

const browserSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.browser",
    name: "Browser",
    version: "1.0.0",
    description:
      "Controls a headless browser session within the operator-provisioned browser runtime. " +
      "Supports page navigation, screenshot capture, text extraction, form interaction, and session management. " +
      "All browser content is EXTERNAL_UNTRUSTED. Approval required by default. " +
      "Requires the operator to provision a browser runtime (Playwright/Puppeteer) in the execution environment.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "render-ui",
    sideEffectClass: "external_side_effect",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "browser.control",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node", "network-zone", "channel-surface"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Browser operation: open, screenshot, extract_text, click, fill, or close.", "string", { enum: ["open", "screenshot", "extract_text", "click", "fill", "close"] }),
        url: prop("URL to navigate to (for open operation). Must match the egress allowlist.", "string"),
        selector: prop("CSS selector for click/fill operations.", "string"),
        value: prop("Value to fill into a form field.", "string"),
        sessionId: prop("Existing browser session ID to reuse.", "string"),
        timeoutMs: prop("Operation timeout. Max 60 000 ms.", "number")
      },
      "Input for the Browser tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The browser operation performed.", "string"),
        sessionId: prop("Browser session ID (reusable for subsequent operations).", "string"),
        url: prop("Current page URL after the operation.", "string"),
        title: prop("Page title.", "string"),
        text: prop("Extracted text content (for extract_text operation). EXTERNAL_UNTRUSTED.", "string"),
        screenshotBase64: prop("Base64-encoded screenshot PNG (for screenshot operation).", "string"),
        success: prop("True if the operation completed without error.", "boolean"),
        provenance: prop("Provenance indicating this is browser content from an external URL. Always EXTERNAL_UNTRUSTED.", "object")
      },
      "Output from the Browser tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 25000,
      defaultSandboxMode: "privileged_operator_approved",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:browser", operation: "browser_control" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "execution-node", resourceId: "execution:browser" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "All browser-rendered content is EXTERNAL_UNTRUSTED.",
      "Browser egress is restricted to the operator-configured allowlist.",
      "Approval required: browser sessions can access external URLs and potentially sensitive content.",
      "Requires operator to provision a browser runtime in the execution environment."
    ],
    tags: ["ui", "browser", "external", "privileged", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: browserInputSchema,
  outputSchema: browserOutputSchema,
  examples: [
    {
      description: "Open a URL and capture a screenshot",
      input: { operation: "open", url: "https://example.com/dashboard" },
      output: { operation: "open", sessionId: "browser:ses-xyz", url: "https://example.com/dashboard", title: "Dashboard | Example", success: true, provenance: { source: "browser-session", trustClassification: "EXTERNAL_UNTRUSTED", url: "https://example.com/dashboard" } }
    },
    {
      description: "Extract text from the current page",
      input: { operation: "extract_text", sessionId: "browser:ses-xyz" },
      output: { operation: "extract_text", sessionId: "browser:ses-xyz", text: "Dashboard\nTotal users: 1,234\nActive sessions: 42\n...", success: true, provenance: { source: "browser-session", trustClassification: "EXTERNAL_UNTRUSTED" } }
    }
  ]
};

// ── canvas ─────────────────────────────────────────────────────────────────────

const canvasInputSchema = z.object({
  operation: z.enum(["render", "append", "clear", "export"]).default("render"),
  content: z.string().optional(),
  format: z.enum(["markdown", "html", "json", "text"]).default("markdown"),
  canvasId: z.string().optional(),
  metadata: z.record(z.unknown()).default({})
});

const canvasOutputSchema = z.object({
  operation: z.string(),
  canvasId: z.string(),
  format: z.string(),
  contentLength: z.number().int().nonnegative(),
  exportedContent: z.string().optional(),
  success: z.boolean()
});

const canvasSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.canvas",
    name: "Canvas",
    version: "1.0.0",
    description:
      "Renders structured content to an operator-visible canvas surface within the admin dashboard. " +
      "Supports markdown, HTML, JSON, and text formats. " +
      "Canvas content is visible to operators in the dashboard's Canvas tab. " +
      "Append mode adds to existing canvas content without clearing it.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "render-ui",
    sideEffectClass: "external_side_effect",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "ui.canvas",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "channel-surface" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["channel-surface"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Canvas operation: render (replace), append, clear, or export.", "string", { enum: ["render", "append", "clear", "export"] }),
        content: prop("Content to render or append. Format controlled by format field.", "string"),
        format: prop("Content format: markdown, html, json, or text.", "string", { enum: ["markdown", "html", "json", "text"] }),
        canvasId: prop("Canvas identifier. Defaults to the session canvas.", "string"),
        metadata: prop("Metadata attached to the canvas update.", "object")
      },
      "Input for the Canvas tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "canvasId", "format", "contentLength", "success"],
      {
        operation: prop("The canvas operation performed.", "string"),
        canvasId: prop("The canvas that was modified.", "string"),
        format: prop("Format of the content.", "string"),
        contentLength: prop("Current canvas content length in characters.", "number"),
        exportedContent: prop("Exported content string (for export operation).", "string"),
        success: prop("True if the operation succeeded.", "boolean")
      },
      "Output from the Canvas tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 5000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:canvas", operation: "canvas_render" },
    policyBinding: {
      policyActionClass: "external-side-effect",
      resource: { resourceClass: "channel-surface", resourceId: "channel:canvas" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "Canvas content is operator-visible in the dashboard.",
      "HTML content is sandboxed in the dashboard renderer.",
      "Canvas operations are audited."
    ],
    tags: ["ui", "canvas", "dashboard", "operator"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: canvasInputSchema,
  outputSchema: canvasOutputSchema,
  examples: [
    {
      description: "Render a markdown report to the canvas",
      input: { operation: "render", content: "## Analysis Summary\n\n- Total records: 142\n- Anomalies detected: 3\n- All within acceptable thresholds.\n", format: "markdown" },
      output: { operation: "render", canvasId: "canvas:session-abc", format: "markdown", contentLength: 82, success: true }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const UI_TOOL_SPECS = {
  "tool.browser": browserSpec,
  "tool.canvas": canvasSpec
} as const;

export type UiToolId = keyof typeof UI_TOOL_SPECS;
