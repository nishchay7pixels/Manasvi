import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPromotionCompatibility,
  assertWriteCompatibility,
  isNamespaceCompatible,
  isTrustAllowedForClass
} from "./index.js";

test("namespace compatibility validates per class", () => {
  assert.equal(isNamespaceCompatible("EPHEMERAL_SESSION", "session/session:1"), true);
  assert.equal(isNamespaceCompatible("USER_DURABLE", "user/user:alice/profile"), true);
  assert.equal(isNamespaceCompatible("ORG_SHARED_TRUSTED", "org/workspace-local/shared-notes"), true);
  assert.equal(isNamespaceCompatible("UNTRUSTED_EXTERNAL", "external/web/example.com"), true);
  assert.equal(isNamespaceCompatible("AUDIT_ACTION_HISTORY", "audit/run:1"), true);
  assert.equal(isNamespaceCompatible("USER_DURABLE", "external/web/example.com"), false);
});

test("trust compatibility is class-aware", () => {
  assert.equal(isTrustAllowedForClass("UNTRUSTED_EXTERNAL", "EXTERNAL_UNTRUSTED"), true);
  assert.equal(isTrustAllowedForClass("UNTRUSTED_EXTERNAL", "CONTROL_TRUSTED"), false);
  assert.equal(isTrustAllowedForClass("ORG_SHARED_TRUSTED", "CONTROL_TRUSTED"), true);
  assert.equal(isTrustAllowedForClass("ORG_SHARED_TRUSTED", "EXTERNAL_UNTRUSTED"), false);
});

test("write compatibility rejects invalid namespace/class combinations", () => {
  assert.throws(() =>
    assertWriteCompatibility({
      schemaVersion: "1.0",
      memoryClass: "USER_DURABLE",
      namespace: "external/web/example.com",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      trustClassification: "USER_OWNED",
      contentType: "text/plain",
      content: {
        text: "x",
        data: {}
      },
      tags: [],
      provenance: {
        sourceType: "user-input",
        sourceId: "msg:1",
        sourceRef: "msg:1",
        createdAt: new Date().toISOString(),
        derivation: {
          derived: false,
          derivedFromRecordIds: [],
          derivedFromSourceRefs: []
        }
      },
      sourceReferences: [],
      trace: {
        traceId: "e2ac7d80-0bce-4542-a478-b0c22f5d0475",
        correlationId: "a4e7d20c-6d39-4af7-8e7e-7dc8fb6e4925"
      }
    })
  );
});

test("promotion compatibility blocks untrusted direct promotion", () => {
  assert.throws(() =>
    assertPromotionCompatibility({
      source: {
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        recordId: "memory:1",
        memoryClass: "UNTRUSTED_EXTERNAL",
        namespace: "external/web/example.com",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        trustClassification: "EXTERNAL_UNTRUSTED",
        contentType: "text/plain",
        content: { text: "x", data: {} },
        tags: [],
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
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdByPrincipal: {
          principalId: "service:ingress-service",
          principalType: "service"
        },
        createdByService: "ingress-service",
        retention: {
          retentionClass: "bounded_cache",
          ttlSeconds: 600,
          deleteAfterExpiry: true
        },
        encryption: {
          encryptedAtRest: false
        },
        promotion: {
          status: "candidate"
        },
        sourceReferences: [],
        auditLinkage: {}
      },
      targetClass: "USER_DURABLE",
      targetNamespace: "user/user:alice/profile"
    })
  );
});
