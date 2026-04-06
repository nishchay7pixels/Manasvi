import assert from "node:assert/strict";
import test from "node:test";

import {
  principalRecordSchema,
  principalReferenceSchema,
  sessionOwnershipSchema
} from "./identity.js";

test("principal schema validation succeeds for service principal", () => {
  const now = new Date().toISOString();
  const parsed = principalRecordSchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    principalId: "service:orchestrator-service",
    principalType: "service",
    status: "active",
    provenance: {
      source: "bootstrap"
    },
    externalIdentifiers: [],
    attributes: {},
    service: {
      serviceName: "orchestrator-service",
      instanceId: "orchestrator-local-1",
      environment: "local",
      registeredAt: now
    },
    createdAt: now,
    updatedAt: now
  });
  assert.equal(parsed.principalType, "service");
});

test("principal reference validation rejects unknown type", () => {
  assert.throws(() =>
    principalReferenceSchema.parse({
      principalId: "foo",
      principalType: "invalid"
    })
  );
});

test("session ownership schema supports explicit ownership and participants", () => {
  const now = new Date().toISOString();
  const parsed = sessionOwnershipSchema.parse({
    version: "1.0",
    sessionId: "session-1",
    owner: {
      principalId: "user:alice",
      principalType: "human_user"
    },
    participants: [
      {
        principal: {
          principalId: "agent:planner",
          principalType: "agent"
        },
        role: "assistant"
      }
    ],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    createdBy: {
      principalId: "service:api-gateway",
      principalType: "service"
    },
    createdAt: now,
    updatedAt: now
  });
  assert.equal(parsed.owner.principalType, "human_user");
  assert.equal(parsed.participants.length, 1);
});
