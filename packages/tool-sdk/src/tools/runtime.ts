import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── exec ───────────────────────────────────────────────────────────────────────

const execInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  workingDir: z.string().optional(),
  timeoutMs: z.number().int().positive().max(300000).default(30000),
  captureStdout: z.boolean().default(true),
  captureStderr: z.boolean().default(true)
});

const execOutputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean().default(false),
  durationMs: z.number().int().nonnegative()
});

const execSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.exec",
    name: "Exec",
    version: "1.0.0",
    description:
      "Executes a command in the sandboxed execution runtime. " +
      "All execution is mediated through the Execution Manager: proposal → policy → intent → approval (where required) → sandbox → artifact. " +
      "Commands are always run in an isolated no-network sandbox. " +
      "Approval is required by default. Operator must configure explicit policy to enable this tool.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "execute",
    sideEffectClass: "privileged",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "execution.run",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node", "filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["command"],
      {
        command: prop("Executable path or name. Must be available in the sandbox PATH.", "string"),
        args: prop("Positional arguments for the command.", "array"),
        env: prop("Additional environment variables injected into the sandbox. Secrets must use secret refs, not inline values.", "object"),
        workingDir: prop("Sandbox-relative working directory.", "string"),
        timeoutMs: prop("Execution timeout in milliseconds. Maximum 300 000 ms.", "number"),
        captureStdout: prop("Capture and return standard output.", "boolean"),
        captureStderr: prop("Capture and return standard error.", "boolean")
      },
      "Input for the Exec tool."
    ),
    outputSchema: jsonSchemaObject(
      ["command", "args", "exitCode", "stdout", "stderr", "timedOut", "durationMs"],
      {
        command: prop("The command that was executed.", "string"),
        args: prop("Arguments passed to the command.", "array"),
        exitCode: prop("Process exit code.", "number"),
        stdout: prop("Captured standard output. Treated as EXTERNAL_UNTRUSTED.", "string"),
        stderr: prop("Captured standard error.", "string"),
        timedOut: prop("True if the command exceeded the timeout.", "boolean"),
        durationMs: prop("Wall-clock execution duration in milliseconds.", "number")
      },
      "Output from the Exec tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 30000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:exec", operation: "exec_command" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "execution-node", resourceId: "execution:sandbox" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Execution output is EXTERNAL_UNTRUSTED. Do not promote to control-trusted.",
      "Approval is required before each invocation by default.",
      "No network egress from sandbox. Use tool.http-fetch for remote access."
    ],
    tags: ["runtime", "execute", "privileged", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: execInputSchema,
  outputSchema: execOutputSchema,
  examples: [
    {
      description: "Run a build command in the workspace",
      input: { command: "npm", args: ["run", "build"], timeoutMs: 120000 },
      output: { command: "npm", args: ["run", "build"], exitCode: 0, stdout: "> build\n> tsc -b\n\nBuilt successfully.\n", stderr: "", timedOut: false, durationMs: 3420 }
    },
    {
      description: "Run a test suite",
      input: { command: "node", args: ["--test", "src/**/*.test.js"], timeoutMs: 60000 },
      output: { command: "node", args: ["--test", "src/**/*.test.js"], exitCode: 0, stdout: "ok 1 - all manifests valid\nok 2 - input validation\n# tests 2\n# pass  2\n", stderr: "", timedOut: false, durationMs: 892 }
    }
  ]
};

// ── process ────────────────────────────────────────────────────────────────────

const processInputSchema = z.object({
  operation: z.enum(["list", "inspect", "kill"]).default("list"),
  pid: z.number().int().positive().optional(),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).default("SIGTERM"),
  filter: z.string().optional()
});

const processOutputSchema = z.object({
  operation: z.string(),
  processes: z.array(
    z.object({
      pid: z.number().int(),
      name: z.string(),
      status: z.string(),
      cpu: z.number().optional(),
      memoryMb: z.number().optional()
    })
  ).optional(),
  pid: z.number().int().optional(),
  signalSent: z.string().optional(),
  success: z.boolean()
});

const processSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.process",
    name: "Process",
    version: "1.0.0",
    description:
      "Inspect or manage running processes within the sandbox. " +
      "Supports listing processes, inspecting a specific PID, or sending a signal. " +
      "Signal operations (kill) are approval-sensitive. " +
      "Process info is scoped to the sandbox namespace — no host process visibility.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "execute",
    sideEffectClass: "privileged",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "process.inspect",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Operation: list all processes, inspect a specific PID, or kill (send signal) a PID.", "string", { enum: ["list", "inspect", "kill"] }),
        pid: prop("Target process ID for inspect or kill operations.", "number"),
        signal: prop("Signal to send for kill operation. Default SIGTERM.", "string", { enum: ["SIGTERM", "SIGKILL", "SIGINT"] }),
        filter: prop("Optional name filter for list operation.", "string")
      },
      "Input for the Process tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The operation that was performed.", "string"),
        processes: prop("Process list (for list/inspect operations).", "array"),
        pid: prop("PID affected (for kill operations).", "number"),
        signalSent: prop("Signal that was sent (for kill operations).", "string"),
        success: prop("Whether the operation completed successfully.", "boolean")
      },
      "Output from the Process tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 8000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:process", operation: "process_manage" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "execution-node", resourceId: "execution:process" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Signal operations are irreversible — approval required.",
      "Process list is scoped to the current sandbox namespace.",
      "No host-level process visibility."
    ],
    tags: ["runtime", "process", "privileged", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: processInputSchema,
  outputSchema: processOutputSchema,
  examples: [
    {
      description: "List running processes in sandbox",
      input: { operation: "list" },
      output: { operation: "list", processes: [{ pid: 1, name: "node", status: "running", cpu: 0.2, memoryMb: 48 }], success: true }
    },
    {
      description: "Send SIGTERM to a specific process",
      input: { operation: "kill", pid: 1234, signal: "SIGTERM" },
      output: { operation: "kill", pid: 1234, signalSent: "SIGTERM", success: true }
    }
  ]
};

// ── code-execution ─────────────────────────────────────────────────────────────

const codeExecutionInputSchema = z.object({
  language: z.enum(["python", "javascript", "typescript", "shell"]),
  code: z.string().min(1),
  stdin: z.string().default(""),
  timeoutMs: z.number().int().positive().max(120000).default(30000),
  packages: z.array(z.string()).default([])
});

const codeExecutionOutputSchema = z.object({
  language: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean().default(false),
  durationMs: z.number().int().nonnegative()
});

const codeExecutionSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.code-execution",
    name: "Code Execution",
    version: "1.0.0",
    description:
      "Executes code in a specified language runtime within the sandboxed execution environment. " +
      "Distinct from exec: takes code as text input rather than a binary path. " +
      "Supported languages: python, javascript, typescript, shell. " +
      "No network access from the code runtime. Approval required by default.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "execute",
    sideEffectClass: "privileged",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "code.execute",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node", "filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["language", "code"],
      {
        language: prop("Runtime language: python, javascript, typescript, or shell.", "string", { enum: ["python", "javascript", "typescript", "shell"] }),
        code: prop("Code text to execute. UTF-8 string.", "string"),
        stdin: prop("Optional standard input to pipe to the program.", "string"),
        timeoutMs: prop("Execution timeout in milliseconds. Maximum 120 000 ms.", "number"),
        packages: prop("Additional packages to install before execution (operator-configured allow list applies).", "array")
      },
      "Input for the Code Execution tool."
    ),
    outputSchema: jsonSchemaObject(
      ["language", "exitCode", "stdout", "stderr", "timedOut", "durationMs"],
      {
        language: prop("Language runtime used.", "string"),
        exitCode: prop("Exit code from the code runtime process.", "number"),
        stdout: prop("Captured standard output. EXTERNAL_UNTRUSTED.", "string"),
        stderr: prop("Captured standard error.", "string"),
        timedOut: prop("True if execution was killed due to timeout.", "boolean"),
        durationMs: prop("Execution duration in milliseconds.", "number")
      },
      "Output from the Code Execution tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 30000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:code-execution", operation: "code_execute" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "execution-node", resourceId: "execution:code-runtime" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Code runs in an isolated no-network sandbox. No host FS or network access.",
      "Code output is EXTERNAL_UNTRUSTED.",
      "Package installation is subject to operator allow list."
    ],
    tags: ["runtime", "code", "execute", "privileged", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: codeExecutionInputSchema,
  outputSchema: codeExecutionOutputSchema,
  examples: [
    {
      description: "Run a Python snippet",
      input: { language: "python", code: "print(sum(range(1, 11)))" },
      output: { language: "python", exitCode: 0, stdout: "55\n", stderr: "", timedOut: false, durationMs: 210 }
    },
    {
      description: "Run a JavaScript snippet",
      input: { language: "javascript", code: "console.log(JSON.stringify({ok: true, n: 42}))" },
      output: { language: "javascript", exitCode: 0, stdout: '{"ok":true,"n":42}\n', stderr: "", timedOut: false, durationMs: 65 }
    }
  ]
};

// ── bash ───────────────────────────────────────────────────────────────────────

const bashInputSchema = z.object({
  script: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().max(120000).default(30000)
});

const bashOutputSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean().default(false),
  durationMs: z.number().int().nonnegative()
});

const bashSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.bash",
    name: "Bash",
    version: "1.0.0",
    description:
      "Convenience alias for running a bash shell script through the governed execution runtime. " +
      "Equivalent to tool.code-execution with language=shell but optimised for multi-line scripts. " +
      "All governance: proposal → policy → intent → approval → sandbox → artifact applies. " +
      "No network access. Approval required by default.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "execute",
    sideEffectClass: "privileged",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "shell.execute",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "execution-node" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["execution-node", "filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["script"],
      {
        script: prop("Bash script text to execute.", "string"),
        args: prop("Positional arguments available as $1, $2, ... in the script.", "array"),
        timeoutMs: prop("Script execution timeout in milliseconds. Maximum 120 000 ms.", "number")
      },
      "Input for the Bash tool."
    ),
    outputSchema: jsonSchemaObject(
      ["exitCode", "stdout", "stderr", "timedOut", "durationMs"],
      {
        exitCode: prop("Bash exit code.", "number"),
        stdout: prop("Captured standard output. EXTERNAL_UNTRUSTED.", "string"),
        stderr: prop("Captured standard error.", "string"),
        timedOut: prop("True if the script exceeded the timeout.", "boolean"),
        durationMs: prop("Execution duration in milliseconds.", "number")
      },
      "Output from the Bash tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 30000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:bash", operation: "bash_script" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "execution-node", resourceId: "execution:bash" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Runs in no-network sandbox. No host FS or network access.",
      "Script output is EXTERNAL_UNTRUSTED.",
      "Approval required by default — this is a shell execution surface."
    ],
    tags: ["runtime", "bash", "shell", "execute", "privileged", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  examples: [
    {
      description: "Run a simple bash script",
      input: { script: "#!/bin/bash\necho \"Hello from sandbox\"\ndate -u" },
      output: { exitCode: 0, stdout: "Hello from sandbox\nSun May  4 00:00:00 UTC 2026\n", stderr: "", timedOut: false, durationMs: 45 }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const RUNTIME_TOOL_SPECS = {
  "tool.exec": execSpec,
  "tool.process": processSpec,
  "tool.code-execution": codeExecutionSpec,
  "tool.bash": bashSpec
} as const;

export type RuntimeToolId = keyof typeof RUNTIME_TOOL_SPECS;
