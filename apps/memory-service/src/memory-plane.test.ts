import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemoryPromotionReview,
  MemoryWriteRequest,
  ResolvedPrincipalContext
} from "@manasvi/contracts";

import { InMemoryTrustClassifiedMemoryPlane, MemoryPlaneError } from "./memory-plane.js";

function context(): ResolvedPrincipalContext {
  return {
    caller: { principalId: "service:orchestrator-service", principalType: "service" },
    actor: { principalId: "user:alice", principalType: "human_user" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    authnStrength: "strong",
    authenticated: true,
    scopes: ["memory.read", "memory.write"]
  };
}

function writeRequest(overrides?: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return {
    schemaVersion: "1.0",
    memoryClass: "EPHEMERAL_SESSION",
    namespace: "session/session:1",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trustClassification: "USER_OWNED",
    contentType: "text/plain",
    content: {
      text: "hello",
      data: {}
    },
    tags: [],
    provenance: {
      sourceType: "session-message",
      sourceId: "msg:1",
      sourceRef: "session:1/msg:1",
      createdAt: new Date().toISOString(),
      derivation: {
        derived: false,
        derivedFromRecordIds: [],
        derivedFromSourceRefs: []
      }
    },
    sourceReferences: [],
    trace: {
      traceId: "30b4fce5-af3a-4d1e-8664-7e3f62c302f8",
      correlationId: "9fd9f1b3-29f0-4502-b939-7c598afe3b17"
    },
    ...overrides
  };
}

test("create/read/query per memory class works", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  const ctx = context();
  const ephemeral = plane.createRecord({
    write: writeRequest(),
    principalContext: ctx
  });
  const userDurable = plane.createRecord({
    write: writeRequest({
      memoryClass: "USER_DURABLE",
      namespace: "user/user:alice/profile",
      ownerPrincipal: { principalId: "user:alice", principalType: "human_user" },
      trustClassification: "USER_OWNED"
    }),
    principalContext: ctx
  });
  const shared = plane.createRecord({
    write: writeRequest({
      memoryClass: "ORG_SHARED_TRUSTED",
      namespace: "org/workspace-local/shared-notes",
      trustClassification: "CONTROL_TRUSTED"
    }),
    principalContext: ctx
  });
  const untrusted = plane.createRecord({
    write: writeRequest({
      memoryClass: "UNTRUSTED_EXTERNAL",
      namespace: "external/web/example.com",
      trustClassification: "EXTERNAL_UNTRUSTED"
    }),
    principalContext: ctx
  });
  const audit = plane.createRecord({
    write: writeRequest({
      memoryClass: "AUDIT_ACTION_HISTORY",
      namespace: "audit/run:1",
      trustClassification: "AUDIT_SECURITY",
      provenance: {
        sourceType: "audit-event-reference",
        sourceId: "audit:1",
        sourceRef: "audit:1",
        linkedAuditRecordId: "audit-record:1",
        createdAt: new Date().toISOString(),
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      }
    }),
    principalContext: ctx
  });

  assert.equal(plane.getRecord({ recordId: ephemeral.recordId, principalContext: ctx, trace: writeRequest().trace })?.recordId, ephemeral.recordId);
  const queried = plane.queryRecords({
    query: {
      schemaVersion: "1.0",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      classes: ["EPHEMERAL_SESSION", "USER_DURABLE", "ORG_SHARED_TRUSTED", "UNTRUSTED_EXTERNAL", "AUDIT_ACTION_HISTORY"],
      includeExpired: false,
      limit: 20,
      trace: writeRequest().trace
    },
    principalContext: ctx
  });
  assert.equal(queried.records.length, 5);
  assert.equal(userDurable.encryption.encryptedAtRest, true);
  assert.equal(shared.encryption.encryptedAtRest, true);
  assert.equal(audit.encryption.encryptedAtRest, true);
  assert.equal(untrusted.encryption.encryptedAtRest, false);
});

test("namespace and tenant boundary enforcement rejects invalid access", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  const ctx = context();
  assert.throws(
    () =>
      plane.createRecord({
        write: writeRequest({
          memoryClass: "USER_DURABLE",
          namespace: "user/user:bob/profile",
          ownerPrincipal: { principalId: "user:alice", principalType: "human_user" }
        }),
        principalContext: ctx
      }),
    (error: unknown) =>
      error instanceof MemoryPlaneError && error.code === "NAMESPACE_OWNER_MISMATCH"
  );
});

test("no silent trust promotion from untrusted to trusted durable", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  assert.throws(
    () =>
      plane.createRecord({
        write: writeRequest({
          memoryClass: "USER_DURABLE",
          namespace: "user/user:alice/profile",
          ownerPrincipal: { principalId: "user:alice", principalType: "human_user" },
          trustClassification: "EXTERNAL_UNTRUSTED"
        }),
        principalContext: context()
      }),
    (error: unknown) =>
      (error instanceof MemoryPlaneError && error.code === "SILENT_TRUST_PROMOTION_BLOCKED") ||
      (error instanceof Error && error.message.includes("not allowed for memory class"))
  );
});

test("derived content with untrusted lineage cannot be directly written to durable memory", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  assert.throws(
    () =>
      plane.createRecord({
        write: writeRequest({
          memoryClass: "USER_DURABLE",
          namespace: "user/user:alice/profile",
          ownerPrincipal: { principalId: "user:alice", principalType: "human_user" },
          trustClassification: "USER_OWNED",
          provenance: {
            sourceType: "model-summary",
            sourceId: "summary:1",
            sourceRef: "summary:1",
            originalTrustClassification: "EXTERNAL_UNTRUSTED",
            createdAt: new Date().toISOString(),
            derivation: {
              derived: true,
              derivationType: "summarize",
              derivedFromRecordIds: ["memory:external:1"],
              derivedFromSourceRefs: ["https://evil.example"]
            }
          }
        }),
        principalContext: context()
      }),
    (error: unknown) => error instanceof MemoryPlaneError && error.code === "SILENT_TRUST_PROMOTION_BLOCKED"
  );
});

test("promotion workflow preserves lineage and enforces review", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  const source = plane.createRecord({
    write: writeRequest({
      memoryClass: "UNTRUSTED_EXTERNAL",
      namespace: "external/web/example.com",
      trustClassification: "EXTERNAL_UNTRUSTED",
      provenance: {
        sourceType: "retrieved-web-content",
        sourceId: "src:1",
        sourceRef: "https://example.com",
        createdAt: new Date().toISOString(),
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      }
    }),
    principalContext: context()
  });
  assert.throws(() =>
    plane.createPromotionCandidate({
      request: {
        schemaVersion: "1.0",
        recordId: source.recordId,
        targetClass: "USER_DURABLE",
        targetNamespace: "user/user:alice/profile",
        reason: "attempt direct",
        trace: writeRequest().trace
      },
      principalContext: context()
    })
  );

  const trustedCandidate = plane.createRecord({
    write: writeRequest({
      memoryClass: "EPHEMERAL_SESSION",
      namespace: "session/session:1",
      trustClassification: "USER_OWNED"
    }),
    principalContext: context()
  });
  const review = plane.createPromotionCandidate({
    request: {
      schemaVersion: "1.0",
      recordId: trustedCandidate.recordId,
      targetClass: "USER_DURABLE",
      targetNamespace: "user/user:alice/profile",
      reason: "promote to durable",
      trace: writeRequest().trace
    },
    principalContext: context()
  });
  const decision: MemoryPromotionReview = {
    ...review,
    status: "approved",
    decisionReason: "approved"
  };
  const result = plane.reviewPromotion({
    review: decision,
    principalContext: context()
  });
  assert.ok(result.promotedRecord);
  assert.equal(result.promotedRecord?.provenance.derivation.derived, true);
  assert.equal(
    result.promotedRecord?.provenance.derivation.derivedFromRecordIds.includes(trustedCandidate.recordId),
    true
  );
});

test("retention expiration prunes ephemeral and untrusted entries", async () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 1,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 1,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  const ctx = context();
  const oldIso = new Date(Date.now() - 10_000).toISOString();
  const ephemeral = plane.createRecord({
    write: writeRequest({
      namespace: "session/session:retention",
      retentionOverrideTtlSeconds: 1,
      provenance: {
        sourceType: "session-message",
        sourceId: "old",
        sourceRef: "old",
        createdAt: oldIso,
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      }
    }),
    principalContext: ctx
  });
  const untrusted = plane.createRecord({
    write: writeRequest({
      memoryClass: "UNTRUSTED_EXTERNAL",
      namespace: "external/web/retention",
      trustClassification: "EXTERNAL_UNTRUSTED",
      retentionOverrideTtlSeconds: 1,
      provenance: {
        sourceType: "retrieved-web-content",
        sourceId: "old-ext",
        sourceRef: "old-ext",
        createdAt: oldIso,
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      }
    }),
    principalContext: ctx
  });
  assert.ok(ephemeral.recordId.length > 0);
  assert.ok(untrusted.recordId.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const prune = plane.pruneExpired();
  assert.equal(prune.deletedRecordIds.length >= 1, true);
});

test("context retrieval preserves trust labels across classes", () => {
  const plane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:local",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  const ctx = context();
  plane.createRecord({
    write: writeRequest({
      memoryClass: "USER_DURABLE",
      namespace: "user/user:alice/profile",
      ownerPrincipal: { principalId: "user:alice", principalType: "human_user" },
      trustClassification: "USER_OWNED"
    }),
    principalContext: ctx
  });
  plane.createRecord({
    write: writeRequest({
      memoryClass: "UNTRUSTED_EXTERNAL",
      namespace: "external/web/example.com",
      trustClassification: "EXTERNAL_UNTRUSTED",
      provenance: {
        sourceType: "retrieved-web-content",
        sourceId: "r1",
        sourceRef: "https://example.com",
        createdAt: new Date().toISOString(),
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      }
    }),
    principalContext: ctx
  });
  const candidates = plane.contextCandidates({
    request: {
      schemaVersion: "1.0",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actorPrincipal: ctx.actor,
      callerPrincipal: ctx.caller,
      sessionId: "session:1",
      maxPerClass: 5,
      trace: writeRequest().trace
    },
    principalContext: ctx
  });
  assert.equal(candidates.records.length >= 2, true);
  assert.equal(candidates.records.some((record) => record.trustClassification === "EXTERNAL_UNTRUSTED"), true);
});
