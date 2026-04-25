import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryTrustClassifiedMemoryPlane } from "../../../../apps/memory-service/src/memory-plane.js";

import { fixturePoisonedMemoryWrite, fixturePrincipalContext } from "./fixtures.js";
import { assertUntrustedMemoryNotPromoted } from "./oracles.js";

function createPlane() {
  return new InMemoryTrustClassifiedMemoryPlane({
    serviceName: "memory-service",
    encryptionKey: "manasvi-local-memory-encryption-key",
    encryptionKeyRef: "memory-key:test",
    ttlByClass: {
      EPHEMERAL_SESSION: 60,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: 600,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
}

test("[TB-MEMORY-001][memory] untrusted external content cannot be silently written to trusted durable store", () => {
  const plane = createPlane();
  try {
    plane.createRecord({
      write: fixturePoisonedMemoryWrite(),
      principalContext: fixturePrincipalContext({
        actor: { principalId: "user:alice", principalType: "human_user" }
      })
    });
    assert.fail("Expected silent trust promotion to be blocked");
  } catch (error) {
    assertUntrustedMemoryNotPromoted(error);
  }
});

test("[TB-MEMORY-001][memory][control] untrusted content can be stored in UNTRUSTED_EXTERNAL class", () => {
  const plane = createPlane();
  const write = fixturePoisonedMemoryWrite({
    memoryClass: "UNTRUSTED_EXTERNAL",
    namespace: "tenant/tenant-local/workspace/workspace-local/external/web/attacker.example",
    trustClassification: "EXTERNAL_UNTRUSTED"
  });
  const record = plane.createRecord({
    write,
    principalContext: fixturePrincipalContext({
      actor: { principalId: "user:alice", principalType: "human_user" }
    })
  });
  assert.equal(record.memoryClass, "UNTRUSTED_EXTERNAL");
  assert.equal(record.trustClassification, "EXTERNAL_UNTRUSTED");
});
