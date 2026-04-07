import assert from "node:assert/strict";
import test from "node:test";

import { memoryRecordSchema, memoryWriteRequestSchema } from "./memory.js";

test("memory write schema requires provenance", () => {
  const parsed = memoryWriteRequestSchema.safeParse({
    schemaVersion: "1.0",
    memoryClass: "UNTRUSTED_EXTERNAL",
    namespace: "external/web/example.com",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trustClassification: "EXTERNAL_UNTRUSTED",
    contentType: "text/plain",
    content: { text: "hello", data: {} },
    tags: [],
    sourceReferences: [],
    trace: {
      traceId: "6c123956-95e6-4e86-9368-3be57f4ecc58",
      correlationId: "8f9f7fbe-e916-4ad2-b235-bf7ffbd2b8f3"
    }
  });
  assert.equal(parsed.success, false);
});

test("memory record supports encryption metadata", () => {
  const now = new Date().toISOString();
  const parsed = memoryRecordSchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    recordId: "memory:test",
    memoryClass: "USER_DURABLE",
    namespace: "user/user:alice/profile",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    ownerPrincipal: {
      principalId: "user:alice",
      principalType: "human_user"
    },
    trustClassification: "USER_OWNED",
    contentType: "application/json",
    content: {
      data: { preference: "concise" }
    },
    tags: [],
    provenance: {
      sourceType: "user-input",
      sourceId: "msg:1",
      sourceRef: "session:1/msg:1",
      createdAt: now,
      derivation: {
        derived: false,
        derivedFromRecordIds: [],
        derivedFromSourceRefs: []
      }
    },
    createdAt: now,
    updatedAt: now,
    createdByPrincipal: {
      principalId: "service:orchestrator-service",
      principalType: "service"
    },
    createdByService: "orchestrator-service",
    retention: {
      retentionClass: "durable",
      deleteAfterExpiry: false
    },
    encryption: {
      encryptedAtRest: true,
      algorithm: "aes-256-gcm",
      keyRef: "memory-key:local",
      encryptedAt: now
    },
    promotion: {
      status: "not_applicable"
    },
    sourceReferences: [],
    auditLinkage: {}
  });
  assert.equal(parsed.encryption.encryptedAtRest, true);
});
