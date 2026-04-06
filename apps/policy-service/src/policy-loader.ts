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
