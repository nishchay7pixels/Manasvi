import { createHmac } from "node:crypto";

import {
  auditIntegrityMetadataSchema,
  computeAuditEventContentHash,
  type AuditEvent,
  type AuditIntegrityMetadata
} from "@manasvi/contracts";

const ZERO_HASH = "0".repeat(64);

function canonicalForIntegrity(metadata: Omit<AuditIntegrityMetadata, "signature">): string {
  return `${metadata.sequenceNumber}:${metadata.previousEventHash}:${metadata.contentHash}`;
}

function withoutIntegrity(event: AuditEvent): Omit<AuditEvent, "integrity"> {
  const raw = { ...event } as Partial<AuditEvent>;
  delete raw.integrity;
  return raw as Omit<AuditEvent, "integrity">;
}

export function buildIntegrityMetadata(input: {
  event: AuditEvent;
  previousEventHash?: string;
  sequenceNumber: number;
  integrityKey?: string;
}): AuditIntegrityMetadata {
  const base = auditIntegrityMetadataSchema.parse({
    contentHash: computeAuditEventContentHash(withoutIntegrity(input.event)),
    previousEventHash: input.previousEventHash ?? ZERO_HASH,
    sequenceNumber: input.sequenceNumber
  });
  if (!input.integrityKey) {
    return base;
  }
  const signature = createHmac("sha256", input.integrityKey)
    .update(canonicalForIntegrity(base), "utf8")
    .digest("hex");
  return auditIntegrityMetadataSchema.parse({
    ...base,
    signature
  });
}

export interface IntegrityIssue {
  auditId: string;
  code:
    | "MISSING_INTEGRITY"
    | "HASH_MISMATCH"
    | "CHAIN_MISMATCH"
    | "SEQUENCE_MISMATCH"
    | "SIGNATURE_MISMATCH";
  message: string;
}

export function verifyAuditChain(events: AuditEvent[], integrityKey?: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let expectedPreviousHash = ZERO_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (!event.integrity) {
      issues.push({
        auditId: event.auditId,
        code: "MISSING_INTEGRITY",
        message: "Integrity metadata is missing"
      });
      continue;
    }
    const expectedSequence = index + 1;
    if (event.integrity.sequenceNumber !== expectedSequence) {
      issues.push({
        auditId: event.auditId,
        code: "SEQUENCE_MISMATCH",
        message: `Expected sequence ${expectedSequence} but found ${event.integrity.sequenceNumber}`
      });
    }
    const expectedHash = computeAuditEventContentHash(withoutIntegrity(event));
    if (event.integrity.contentHash !== expectedHash) {
      issues.push({
        auditId: event.auditId,
        code: "HASH_MISMATCH",
        message: "Event content hash mismatch"
      });
    }
    if (event.integrity.previousEventHash !== expectedPreviousHash) {
      issues.push({
        auditId: event.auditId,
        code: "CHAIN_MISMATCH",
        message: "Previous hash chain linkage mismatch"
      });
    }
    if (integrityKey && event.integrity.signature) {
      const expectedSignature = createHmac("sha256", integrityKey)
        .update(canonicalForIntegrity(event.integrity), "utf8")
        .digest("hex");
      if (event.integrity.signature !== expectedSignature) {
        issues.push({
          auditId: event.auditId,
          code: "SIGNATURE_MISMATCH",
          message: "Integrity signature mismatch"
        });
      }
    }
    expectedPreviousHash = event.integrity.contentHash;
  }
  return issues;
}
