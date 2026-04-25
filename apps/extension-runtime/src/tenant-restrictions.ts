import { z } from "zod";

import type { PluginManifest } from "@manasvi/contracts";

const pluginRiskOrder = {
  low: 1,
  medium: 2,
  high: 3,
  privileged: 4
} as const;

export const tenantPluginRestrictionSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1).default("*"),
  pluginIdPattern: z.string().min(1).default("*"),
  pluginVersionPattern: z.string().min(1).default("*"),
  action: z.enum(["register", "start", "invoke"]),
  effect: z.enum(["allow", "deny"]),
  maxRiskClass: z.enum(["low", "medium", "high", "privileged"]).optional(),
  deniedCapabilityFamilies: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1)
});

export type TenantPluginRestriction = z.infer<typeof tenantPluginRestrictionSchema>;

export interface TenantScope {
  tenantId: string;
  workspaceId: string;
}

export interface PluginRestrictionDecision {
  allowed: boolean;
  reason: string;
  matchedRule?: TenantPluginRestriction;
}

export function parseTenantPluginRestrictions(input: string): TenantPluginRestriction[] {
  if (!input || input.trim().length === 0) {
    return [];
  }
  const parsed = JSON.parse(input) as unknown;
  return z.array(tenantPluginRestrictionSchema).parse(parsed);
}

export function evaluateTenantPluginRestriction(input: {
  restrictions: TenantPluginRestriction[];
  scope: TenantScope;
  manifest: PluginManifest;
  action: TenantPluginRestriction["action"];
}): PluginRestrictionDecision {
  const matching = input.restrictions
    .filter((rule) => rule.action === input.action)
    .filter((rule) => rule.tenantId === input.scope.tenantId)
    .filter((rule) => rule.workspaceId === "*" || rule.workspaceId === input.scope.workspaceId)
    .filter((rule) => wildcardMatch(rule.pluginIdPattern, input.manifest.pluginId))
    .filter((rule) => wildcardMatch(rule.pluginVersionPattern, input.manifest.version))
    .sort((a, b) => {
      if (a.workspaceId !== "*" && b.workspaceId === "*") return -1;
      if (a.workspaceId === "*" && b.workspaceId !== "*") return 1;
      if (a.effect === "deny" && b.effect === "allow") return -1;
      if (a.effect === "allow" && b.effect === "deny") return 1;
      return 0;
    });

  for (const rule of matching) {
    if (rule.maxRiskClass) {
      const pluginRisk = pluginRiskOrder[input.manifest.riskClass];
      const maxRisk = pluginRiskOrder[rule.maxRiskClass];
      if (pluginRisk > maxRisk) {
        return {
          allowed: false,
          reason: `${rule.reason}: plugin risk class ${input.manifest.riskClass} exceeds ${rule.maxRiskClass}`,
          matchedRule: rule
        };
      }
    }
    if (rule.deniedCapabilityFamilies.length > 0) {
      const deniedFamily = input.manifest.requestedCapabilities.find((capability) =>
        rule.deniedCapabilityFamilies.includes(capability.family)
      );
      if (deniedFamily) {
        return {
          allowed: false,
          reason: `${rule.reason}: capability family ${deniedFamily.family} denied`,
          matchedRule: rule
        };
      }
    }
    if (rule.effect === "deny") {
      return {
        allowed: false,
        reason: rule.reason,
        matchedRule: rule
      };
    }
    if (rule.effect === "allow") {
      return {
        allowed: true,
        reason: rule.reason,
        matchedRule: rule
      };
    }
  }

  return {
    allowed: true,
    reason: "no tenant restriction matched"
  };
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
