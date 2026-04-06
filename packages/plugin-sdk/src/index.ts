export interface PluginCapabilityRequest {
  action: string;
  resourceType: string;
  resourceId: string;
  constraints?: Record<string, unknown>;
}

export interface PluginManifestV1 {
  manifestVersion: "1.0";
  pluginId: string;
  name: string;
  entrypoint: string;
  requestedCapabilities: PluginCapabilityRequest[];
  hooks: Array<{
    name: string;
    inputSchemaRef: string;
  }>;
}

export interface PluginInvocationContext {
  traceId: string;
  correlationId: string;
  tenantId: string;
}

export interface PluginRuntime {
  invokeHook(
    hookName: string,
    input: unknown,
    context: PluginInvocationContext
  ): Promise<{ ok: boolean; output?: unknown; error?: string }>;
}
