import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  policyLoadAuditRecordSchema,
  policySetSchema,
  type PolicyLoadAuditRecord,
  type PolicySet
} from "@manasvi/contracts";

export interface LoadedPolicySet {
  policySet: PolicySet;
  digest: string;
  loadAuditRecord: PolicyLoadAuditRecord;
}

export interface LoadedPolicySetRegistry {
  defaultPolicySet: LoadedPolicySet;
  scopedPolicySets: Array<{
    scopeKey: string;
    loaded: LoadedPolicySet;
  }>;
}

export async function loadPolicySetFromFile(input: {
  filePath: string;
  loadedByService: string;
}): Promise<LoadedPolicySet> {
  const raw = await readFile(input.filePath, "utf8");
  const parsed = policySetSchema.parse(JSON.parse(raw));
  const hydratedPolicySet: PolicySet = {
    ...parsed,
    loadedAt: new Date().toISOString()
  };
  const digest = createHash("sha256").update(JSON.stringify(hydratedPolicySet)).digest("hex");
  const loadAuditRecord = policyLoadAuditRecordSchema.parse({
    schemaVersion: "1.0",
    eventId: `policy-load:${digest.slice(0, 16)}`,
    timestamp: new Date().toISOString(),
    policySetVersion: hydratedPolicySet.policySetVersion,
    sourceRef: hydratedPolicySet.sourceRef,
    digest,
    loadedByService: input.loadedByService
  });
  return {
    policySet: hydratedPolicySet,
    digest,
    loadAuditRecord
  };
}

export function parseScopedPolicySetMap(input: string): Record<string, string> {
  if (!input || input.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("POLICY_SET_MAP_JSON must be a JSON object");
  }
  return Object.entries(parsed).reduce<Record<string, string>>((acc, [scopeKey, filePath]) => {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      return acc;
    }
    acc[scopeKey] = filePath;
    return acc;
  }, {});
}

export async function loadPolicySetRegistry(input: {
  defaultPolicySetPath: string;
  scopedPolicySetPaths: Record<string, string>;
  loadedByService: string;
}): Promise<LoadedPolicySetRegistry> {
  const defaultPolicySet = await loadPolicySetFromFile({
    filePath: input.defaultPolicySetPath,
    loadedByService: input.loadedByService
  });
  const scopedPolicySets: LoadedPolicySetRegistry["scopedPolicySets"] = [];
  for (const [scopeKey, filePath] of Object.entries(input.scopedPolicySetPaths)) {
    const loaded = await loadPolicySetFromFile({
      filePath,
      loadedByService: input.loadedByService
    });
    scopedPolicySets.push({
      scopeKey,
      loaded
    });
  }
  return {
    defaultPolicySet,
    scopedPolicySets
  };
}

export function resolvePolicySetForScope(
  registry: LoadedPolicySetRegistry,
  input: { tenantId: string; workspaceId: string }
): { scopeKey: string; loaded: LoadedPolicySet } {
  const exact = `${input.tenantId}/${input.workspaceId}`;
  const tenantWildcard = `${input.tenantId}/*`;
  const globalWildcard = "*/*";
  const ordered = [exact, tenantWildcard, globalWildcard];
  for (const key of ordered) {
    const found = registry.scopedPolicySets.find((item) => item.scopeKey === key);
    if (found) {
      return {
        scopeKey: key,
        loaded: found.loaded
      };
    }
  }
  return {
    scopeKey: "default",
    loaded: registry.defaultPolicySet
  };
}
