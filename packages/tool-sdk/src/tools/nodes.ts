import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── nodes ──────────────────────────────────────────────────────────────────────

const nodesInputSchema = z.object({
  operation: z.enum(["list", "inspect", "capabilities", "dispatch"]).default("list"),
  nodeId: z.string().optional(),
  capabilityFilter: z.array(z.string()).default([]),
  dispatchPayload: z.object({
    toolId: z.string().min(1),
    input: z.record(z.unknown()).default({})
  }).optional()
});

const nodesOutputSchema = z.object({
  operation: z.string(),
  nodes: z.array(
    z.object({
      nodeId: z.string(),
      name: z.string(),
      status: z.enum(["online", "offline", "degraded"]),
      capabilities: z.array(z.string()),
      region: z.string().optional(),
      load: z.object({
        cpu: z.number().optional(),
        memory: z.number().optional()
      }).optional()
    })
  ).optional(),
  node: z.object({
    nodeId: z.string(),
    name: z.string(),
    status: z.string(),
    capabilities: z.array(z.string()),
    runtimeVersion: z.string().optional(),
    region: z.string().optional(),
    uptimeSeconds: z.number().int().optional()
  }).optional(),
  capabilities: z.array(z.string()).optional(),
  dispatchedTo: z.string().optional(),
  dispatchId: z.string().optional(),
  success: z.boolean()
});

const nodesSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.nodes",
    name: "Nodes",
    version: "1.0.0",
    description:
      "Inspects the distributed node manager and remote execution surfaces. " +
      "Supports listing available nodes, inspecting specific nodes, querying capabilities, " +
      "and dispatching governed tool invocations to a specific node. " +
      "Dispatch requires approval and routes through the standard governance chain. " +
      "Inspection is read-only and safe-default.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "inspect-node",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "node.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Operation: list all nodes, inspect a specific node, query capabilities, or dispatch a tool invocation.", "string", { enum: ["list", "inspect", "capabilities", "dispatch"] }),
        nodeId: prop("Target node ID for inspect or dispatch operations.", "string"),
        capabilityFilter: prop("Filter nodes by required capabilities.", "array"),
        dispatchPayload: prop("Tool invocation to dispatch to the target node (for dispatch operation). Requires approval.", "object")
      },
      "Input for the Nodes tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The node operation performed.", "string"),
        nodes: prop("List of node summaries (for list operation).", "array"),
        node: prop("Detailed node record (for inspect operation).", "object"),
        capabilities: prop("Capability list (for capabilities operation).", "array"),
        dispatchedTo: prop("Node ID the invocation was dispatched to (for dispatch).", "string"),
        dispatchId: prop("Dispatch record ID for tracking (for dispatch).", "string"),
        success: prop("Whether the operation succeeded.", "boolean")
      },
      "Output from the Nodes tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:nodes", operation: "nodes_manage" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "execution-node", resourceId: "node:manager" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "List/inspect/capabilities operations are read-only and safe.",
      "Dispatch operation is approval-sensitive and requires additional policy.",
      "Node capabilities define what tools can be executed on that node."
    ],
    tags: ["nodes", "distributed", "inspect", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: nodesInputSchema,
  outputSchema: nodesOutputSchema,
  examples: [
    {
      description: "List all available execution nodes",
      input: { operation: "list" },
      output: {
        operation: "list",
        nodes: [
          { nodeId: "node:primary-eu", name: "Primary EU Worker", status: "online", capabilities: ["shell.execute", "code.execute", "filesystem.read"], region: "eu-west-1" }
        ],
        success: true
      }
    },
    {
      description: "Inspect a specific node",
      input: { operation: "inspect", nodeId: "node:primary-eu" },
      output: {
        operation: "inspect",
        node: { nodeId: "node:primary-eu", name: "Primary EU Worker", status: "online", capabilities: ["shell.execute", "code.execute"], runtimeVersion: "1.4.2", region: "eu-west-1", uptimeSeconds: 86400 },
        success: true
      }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const NODES_TOOL_SPECS = {
  "tool.nodes": nodesSpec
} as const;

export type NodesToolId = keyof typeof NODES_TOOL_SPECS;
