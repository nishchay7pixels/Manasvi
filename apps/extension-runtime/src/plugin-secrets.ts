export function allowPluginRawSecretExposure(input: {
  runtimeFlagEnabled: boolean;
  requestFlagEnabled: boolean;
}): boolean {
  return input.runtimeFlagEnabled && input.requestFlagEnabled;
}

export function pluginSecretEnvName(reference: string): string {
  return `MANASVI_PLUGIN_SECRET_${reference.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`;
}
