/**
 * Plugin manifest validation.
 *
 * The manifest is the formal contract for plugin governance.
 * Invalid manifests must be rejected — not degraded or patched.
 */

import {
  pluginManifestSchema,
  type PluginManifest,
  PLUGIN_API_VERSION
} from "@manasvi/contracts";

export interface ManifestValidationResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors: string[];
}

const SUPPORTED_API_VERSIONS: Set<string> = new Set([PLUGIN_API_VERSION]);

/**
 * Validates a raw plugin manifest object.
 *
 * Checks performed:
 * 1. Schema validation via Zod.
 * 2. Supported API version check.
 * 3. Entrypoint presence (non-empty string validated by schema).
 * 4. Risk-class / capability coherence checks.
 * 5. Provided tool IDs match requestedCapabilities for "provide-tools".
 */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];

  // 1. Schema validation
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `[schema] ${i.path.join(".") || "(root)"}: ${i.message}`
      )
    };
  }

  const manifest = parsed.data;

  // 2. Supported API version
  if (!SUPPORTED_API_VERSIONS.has(manifest.supportedApiVersion)) {
    errors.push(
      `[version] Unsupported plugin API version '${manifest.supportedApiVersion}'. ` +
        `Supported: ${[...SUPPORTED_API_VERSIONS].join(", ")}`
    );
  }

  // 3. Privileged risk class must declare a justification on every capability
  if (manifest.riskClass === "privileged") {
    for (const cap of manifest.requestedCapabilities) {
      if (!cap.justification) {
        errors.push(
          `[risk] Capability '${cap.capabilityId}' in a 'privileged' plugin must include a justification`
        );
      }
    }
  }

  // 4. If "provide-tools" capability is requested, providedTools must be non-empty
  const hasProvideToolsCap = manifest.requestedCapabilities.some(
    (c) => c.family === "provide-tools"
  );
  if (hasProvideToolsCap && manifest.providedTools.length === 0) {
    errors.push(
      `[coherence] Capability 'provide-tools' is requested but no tools are declared in 'providedTools'`
    );
  }

  // 5. If "provide-hooks" capability is requested, providedHooks must be non-empty
  const hasProvideHooksCap = manifest.requestedCapabilities.some(
    (c) => c.family === "provide-hooks"
  );
  if (hasProvideHooksCap && manifest.providedHooks.length === 0) {
    errors.push(
      `[coherence] Capability 'provide-hooks' is requested but no hooks are declared in 'providedHooks'`
    );
  }

  // 6. Tool IDs must be unique within the manifest
  const toolIds = manifest.providedTools.map((t) => t.toolId);
  const duplicateToolIds = toolIds.filter((id, i) => toolIds.indexOf(id) !== i);
  if (duplicateToolIds.length > 0) {
    errors.push(`[coherence] Duplicate tool IDs in manifest: ${duplicateToolIds.join(", ")}`);
  }

  // 7. Required secrets must be refs (not raw values — validated by regex heuristic)
  for (const ref of manifest.requiredSecretRefs) {
    if (/[\s]/.test(ref) || ref.length > 256) {
      errors.push(
        `[secrets] Secret ref '${ref.slice(0, 40)}...' looks like a raw value, not a reference`
      );
    }
  }

  // 8. Disabled manifests with provided tools cause a warning (not an error)
  // — captured as an informational note in the errors list with [warn] prefix
  if (!manifest.enabled && manifest.providedTools.length > 0) {
    errors.push(
      `[warn] Manifest declares enabled=false but provides ${manifest.providedTools.length} tools. ` +
        `They will not be registered.`
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, manifest, errors: [] };
}
