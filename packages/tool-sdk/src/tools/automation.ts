import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── cron ───────────────────────────────────────────────────────────────────────

const cronInputSchema = z.object({
  operation: z.enum(["create", "list", "pause", "resume", "delete", "trigger"]).default("list"),
  cronId: z.string().optional(),
  schedule: z.string().optional(),
  taskDefinition: z.object({
    toolId: z.string().min(1),
    input: z.record(z.unknown()).default({})
  }).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true)
});

const cronOutputSchema = z.object({
  operation: z.string(),
  cronId: z.string().optional(),
  jobs: z.array(
    z.object({
      cronId: z.string(),
      name: z.string(),
      schedule: z.string(),
      enabled: z.boolean(),
      lastRunAt: z.string().optional(),
      nextRunAt: z.string().optional(),
      status: z.string()
    })
  ).optional(),
  success: z.boolean()
});

const cronSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.cron",
    name: "Cron",
    version: "1.0.0",
    description:
      "Manages scheduled tasks (cron jobs) within the operator's automation plane. " +
      "Cron jobs execute governed tool invocations on a schedule. " +
      "Each scheduled job is subject to the same policy, execution intent, and audit trail as a direct invocation. " +
      "Approval required for job creation and deletion. Cron expressions are validated before acceptance.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "schedule",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "automation.schedule",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["service-endpoint", "execution-node"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Cron operation: create, list, pause, resume, delete, or trigger (manual run).", "string", { enum: ["create", "list", "pause", "resume", "delete", "trigger"] }),
        cronId: prop("Cron job ID (for pause/resume/delete/trigger).", "string"),
        schedule: prop("Cron expression (e.g. '0 */6 * * *' for every 6 hours). Required for create.", "string"),
        taskDefinition: prop("Tool invocation to schedule. Required for create.", "object"),
        name: prop("Human-readable job name.", "string"),
        description: prop("Job description.", "string"),
        enabled: prop("Whether the job is active on creation.", "boolean")
      },
      "Input for the Cron tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The cron operation performed.", "string"),
        cronId: prop("ID of the cron job (for create/delete/trigger).", "string"),
        jobs: prop("List of scheduled jobs (for list operation).", "array"),
        success: prop("Whether the operation succeeded.", "boolean")
      },
      "Output from the Cron tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:cron", operation: "cron_manage" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "service-endpoint", resourceId: "service:cron-scheduler" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Scheduled jobs execute under the creating principal's policy constraints.",
      "Approval required for create and delete — schedules are persistent side effects.",
      "Cron job outputs are audited identically to direct invocations."
    ],
    tags: ["automation", "cron", "schedule", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: cronInputSchema,
  outputSchema: cronOutputSchema,
  examples: [
    {
      description: "List all scheduled cron jobs",
      input: { operation: "list" },
      output: { operation: "list", jobs: [], success: true }
    },
    {
      description: "Create a daily web search cron job",
      input: {
        operation: "create",
        schedule: "0 8 * * *",
        name: "Daily news digest",
        taskDefinition: { toolId: "tool.web-search", input: { query: "AI safety news", maxResults: 5 } }
      },
      output: { operation: "create", cronId: "cron:daily-news-abc", success: true }
    }
  ]
};

// ── gateway ────────────────────────────────────────────────────────────────────

const gatewayInputSchema = z.object({
  operation: z.enum(["invoke", "list_endpoints", "health"]).default("list_endpoints"),
  endpointId: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  path: z.string().default("/"),
  payload: z.record(z.unknown()).default({}),
  headers: z.record(z.string()).default({})
});

const gatewayOutputSchema = z.object({
  operation: z.string(),
  endpointId: z.string().optional(),
  status: z.number().int().optional(),
  responseBody: z.record(z.unknown()).optional(),
  endpoints: z.array(
    z.object({
      endpointId: z.string(),
      name: z.string(),
      methods: z.array(z.string()),
      status: z.string()
    })
  ).optional(),
  success: z.boolean(),
  provenance: z.object({
    source: z.literal("operator-gateway"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED")
  }).optional()
});

const gatewaySpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.gateway",
    name: "Gateway",
    version: "1.0.0",
    description:
      "Invokes operator-configured gateway endpoints for system-level integrations. " +
      "Gateway endpoints are defined and scoped by the operator — agents cannot invoke arbitrary endpoints. " +
      "All invocations go through the full governance chain. " +
      "Approval required by default. Gateway responses are EXTERNAL_UNTRUSTED.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "integration",
    actionClass: "access-gateway",
    sideEffectClass: "external_side_effect",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "gateway.invoke",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["service-endpoint", "network-zone"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Operation: invoke an endpoint, list available endpoints, or check health.", "string", { enum: ["invoke", "list_endpoints", "health"] }),
        endpointId: prop("Gateway endpoint ID to invoke (from the operator-configured list).", "string"),
        method: prop("HTTP method for invoke operation.", "string", { enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] }),
        path: prop("Sub-path to call within the endpoint.", "string"),
        payload: prop("Request body for POST/PUT/PATCH operations.", "object"),
        headers: prop("Additional headers. Sensitive headers are filtered by policy.", "object")
      },
      "Input for the Gateway tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The gateway operation performed.", "string"),
        endpointId: prop("Endpoint that was invoked.", "string"),
        status: prop("HTTP response status code.", "number"),
        responseBody: prop("Parsed response body. EXTERNAL_UNTRUSTED.", "object"),
        endpoints: prop("Available gateway endpoints (for list_endpoints operation).", "array"),
        success: prop("Whether the operation succeeded.", "boolean"),
        provenance: prop("Provenance marking response as EXTERNAL_UNTRUSTED.", "object")
      },
      "Output from the Gateway tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 20000,
      defaultSandboxMode: "privileged_operator_approved",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:gateway", operation: "gateway_invoke" },
    policyBinding: {
      policyActionClass: "external-side-effect",
      resource: { resourceClass: "service-endpoint", resourceId: "service:operator-gateway" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Only operator-registered endpoints are reachable.",
      "Gateway responses are EXTERNAL_UNTRUSTED.",
      "Approval required: gateway integrations can trigger real-world side effects."
    ],
    tags: ["automation", "gateway", "operator", "integration", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: gatewayInputSchema,
  outputSchema: gatewayOutputSchema,
  examples: [
    {
      description: "List available operator gateway endpoints",
      input: { operation: "list_endpoints" },
      output: { operation: "list_endpoints", endpoints: [{ endpointId: "gw:crm-api", name: "CRM API", methods: ["GET", "POST"], status: "healthy" }], success: true }
    },
    {
      description: "Invoke a CRM endpoint",
      input: { operation: "invoke", endpointId: "gw:crm-api", method: "GET", path: "/contacts/count" },
      output: { operation: "invoke", endpointId: "gw:crm-api", status: 200, responseBody: { count: 1420 }, success: true, provenance: { source: "operator-gateway", trustClassification: "EXTERNAL_UNTRUSTED" } }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const AUTOMATION_TOOL_SPECS = {
  "tool.cron": cronSpec,
  "tool.gateway": gatewaySpec
} as const;

export type AutomationToolId = keyof typeof AUTOMATION_TOOL_SPECS;
