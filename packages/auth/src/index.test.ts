import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { principalReferenceSchema, sessionOwnershipSchema } from "@manasvi/contracts";

import {
  InternalTokenService,
  InMemoryPrincipalRegistry,
  JsonFilePrincipalRegistry,
  PrincipalResolver,
  buildExecutionNodePrincipalReference,
  buildServicePrincipalReference,
  resolvePrincipalContextFromEvent
} from "./index.js";

function createTokenService(ttlSeconds = 60): InternalTokenService {
  return new InternalTokenService(
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      keyId: "k1",
      secret: "super-secret-key",
      ttlSeconds
    },
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      secretsByKeyId: {
        k1: "super-secret-key"
      }
    }
  );
}

test("principal registry create/read flows", async () => {
  const registry = new InMemoryPrincipalRegistry();
  const principal = await registry.registerPrincipal({
    principalId: "service:ingress-service",
    principalType: "service",
    displayName: "Ingress Service",
    provenance: { source: "bootstrap" },
    attributes: { plane: "ingress" }
  });

  const byId = await registry.getPrincipalById(principal.principalId);
  assert.equal(byId?.principalType, "service");

  const listed = await registry.listPrincipals({ principalType: "service" });
  assert.equal(listed.length, 1);
});

test("node principal registration and lookup", async () => {
  const registry = new InMemoryPrincipalRegistry();
  const nodeRef = buildExecutionNodePrincipalReference("node-local-1");
  await registry.registerPrincipal({
    principalId: nodeRef.principalId,
    principalType: nodeRef.principalType,
    displayName: "Local Node 1",
    provenance: { source: "node_registration", sourceRef: "manual" },
    executionNode: {
      nodeId: "node-local-1",
      mode: "local",
      status: "registered",
      runtimeClass: "sandboxed",
      sandboxProfile: "default",
      registeredAt: new Date().toISOString()
    }
  });

  const loaded = await registry.getPrincipalById("node:node-local-1");
  assert.equal(loaded?.executionNode?.mode, "local");
});

test("json file principal registry persists data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manasvi-registry-"));
  const path = join(dir, "principals.json");
  try {
    const registry = new JsonFilePrincipalRegistry(path);
    await registry.registerPrincipal({
      principalId: "service:orchestrator-service",
      principalType: "service",
      displayName: "Orchestrator Service",
      provenance: { source: "bootstrap" }
    });

    const second = new JsonFilePrincipalRegistry(path);
    const loaded = await second.getPrincipalById("service:orchestrator-service");
    assert.equal(loaded?.displayName, "Orchestrator Service");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("internal token issuance and validation", () => {
  const tokenService = createTokenService();
  const token = tokenService.issueToken({
    caller: buildServicePrincipalReference("ingress-service"),
    scopes: ["events:publish"]
  });

  const result = tokenService.verifyToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.claims?.caller.principalType, "service");
});

test("expired token rejection", () => {
  const tokenService = createTokenService(-10);
  const token = tokenService.issueToken({
    caller: buildServicePrincipalReference("ingress-service")
  });
  const result = tokenService.verifyToken(token);
  assert.equal(result.ok, false);
  assert.equal(result.error, "TOKEN_EXPIRED");
});

test("malformed token rejection", () => {
  const tokenService = createTokenService();
  const result = tokenService.verifyToken("bad.token");
  assert.equal(result.ok, false);
  assert.equal(result.error, "TOKEN_MALFORMED");
});

test("principal resolution rejects unauthenticated when required", () => {
  const resolver = new PrincipalResolver(createTokenService());
  const result = resolver.resolveFromHttpHeaders({}, { requireAuthentication: true });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "AUTHENTICATION_REQUIRED");
});

test("principal resolution accepts authenticated service and resolves actor/caller distinction", () => {
  const tokenService = createTokenService();
  const resolver = new PrincipalResolver(tokenService);
  const token = tokenService.issueToken({
    caller: buildServicePrincipalReference("api-gateway"),
    actor: principalReferenceSchema.parse({
      principalType: "human_user",
      principalId: "user:alice"
    }),
    scopes: ["actor:override"]
  });

  const result = resolver.resolveFromHttpHeaders(
    {
      authorization: `Bearer ${token}`,
      "x-manasvi-actor": "human_user:user:bob"
    },
    {
      requireAuthentication: true,
      allowActorOverride: true
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.context?.caller.principalId, "service:api-gateway");
  assert.equal(result.context?.actor.principalType, "human_user");
});

test("resolve principal context from event", () => {
  const context = resolvePrincipalContextFromEvent({
    event: {
      actor: {
        principalType: "human_user",
        principalId: "user:alice"
      },
      channel: {
        principalType: "channel",
        principalId: "channel:slack"
      },
      source: {
        sourceType: "channel",
        sourceId: "slack"
      },
      tenantId: "tenant-a",
      workspaceId: "workspace-a"
    }
  });
  assert.equal(context.origin?.principalType, "channel");
  assert.equal(context.actor.principalId, "user:alice");
  assert.equal(context.caller.principalType, "channel");
});

test("session ownership schema validation", () => {
  const now = new Date().toISOString();
  const session = sessionOwnershipSchema.parse({
    version: "1.0",
    sessionId: "session-123",
    owner: {
      principalType: "human_user",
      principalId: "user:alice"
    },
    participants: [],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    createdBy: {
      principalType: "service",
      principalId: "service:api-gateway"
    },
    lastActedBy: {
      principalType: "agent",
      principalId: "agent:planner"
    },
    createdAt: now,
    updatedAt: now
  });
  assert.equal(session.owner.principalType, "human_user");
});
