import { randomUUID } from "node:crypto";

import {
  CONTRACT_SCHEMA_VERSION,
  createNodePairingGrant,
  createPolicyEvaluationRequest,
  nodeAttestationMetadataSchema,
  nodeCapabilitySchema,
  nodeClassSchema,
  nodeDispatchRequestSchema,
  nodeQuarantineRecordSchema,
  nodeRevocationRecordSchema,
  runtimePolicySchema,
  type ActionClass,
  toolExecutionContractSchema
} from "@manasvi/contracts";
import {
  JsonFilePrincipalRegistry,
  InternalTokenService,
  PrincipalResolver,
  bootstrapServicePrincipal,
  buildExecutionNodePrincipalReference,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadNodeManagerConfig } from "./config.js";
import { NodeRegistry } from "./node-registry.js";

async function main(): Promise<void> {
  const config = await loadNodeManagerConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const registry = new JsonFilePrincipalRegistry(config.principalRegistryPath);

  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: config.internalAuthKeyId,
      secret: config.internalAuthSigningSecret,
      ttlSeconds: 120
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: config.internalAuthVerificationKeys
    }
  );
  const nodeCredentialTokenService = new InternalTokenService(
    {
      issuer: config.nodeCredentialIssuer,
      audience: config.nodeCredentialAudience,
      keyId: config.nodeCredentialKeyId,
      secret: config.nodeCredentialSigningSecret,
      ttlSeconds: config.nodeCredentialTtlSeconds
    },
    {
      issuer: config.nodeCredentialIssuer,
      audience: config.nodeCredentialAudience,
      secretsByKeyId: config.nodeCredentialVerificationKeys
    }
  );
  const principalResolver = new PrincipalResolver(tokenService);
  const nodePlane = new NodeRegistry(config.heartbeatStaleSeconds * 1000);

  const pairingRequestSchema = z.object({
    nodeId: z.string().min(1),
    nodeClass: nodeClassSchema,
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    ownerPrincipal: z
      .object({
        principalId: z.string().min(1),
        principalType: z.enum(["human_user", "service", "agent"])
      })
      .optional(),
    attestation: nodeAttestationMetadataSchema,
    requestedCapabilities: z.array(nodeCapabilitySchema).default([])
  });
  const pairingCompleteSchema = z.object({
    nodeId: z.string().min(1),
    pairingToken: z.string().min(1),
    attestation: nodeAttestationMetadataSchema.optional(),
    capabilities: z.array(nodeCapabilitySchema).optional(),
    agentEndpoint: z.string().url().optional()
  });
  const heartbeatSchema = z.object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    runtimeVersion: z.string().min(1),
    load: z.object({
      activeRuns: z.number().int().nonnegative(),
      cpuPct: z.number().min(0).max(100),
      memoryPct: z.number().min(0).max(100)
    }),
    attestationFresh: z.boolean().default(true)
  });
  const capabilityUpdateSchema = z.object({
    capabilities: z.array(nodeCapabilitySchema).min(1)
  });
  const dispatchRequestSchema = z.object({
    nodeId: z.string().min(1),
    toolContract: toolExecutionContractSchema,
    runtimePolicy: runtimePolicySchema,
    dryRun: z.boolean().default(false)
  });
  const nodeReasonSchema = z.object({
    reasonCode: z.string().min(1),
    reason: z.string().min(1)
  });

  await bootstrapServicePrincipal(registry, {
    serviceName: config.serviceName,
    environment: config.environment,
    instanceId: `${config.serviceName}-${config.host}-${config.port}`
  });

  async function evaluatePolicy(input: {
    principal: NonNullable<ReturnType<typeof principalResolver.resolveFromHttpHeaders>["context"]>;
    actionClass: ActionClass;
    actionId: string;
    resourceId: string;
    tenantId: string;
    workspaceId: string;
    requestedCapabilities: string[];
    trace: { traceId: string; correlationId: string; parentTraceId?: string };
    riskFlags?: string[];
  }) {
    const request = createPolicyEvaluationRequest({
      requestingService: servicePrincipal,
      principalContext: input.principal,
      action: {
        actionClass: input.actionClass,
        actionId: input.actionId,
        attributes: {}
      },
      resource: {
        resourceClass: "execution-node",
        resourceId: input.resourceId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        attributes: {}
      },
      requestedCapabilities: input.requestedCapabilities.map((capabilityId) => ({
        capabilityId,
        scope: {},
        constraints: {}
      })),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      approval: {
        approvalPresent: false,
        skipApprovalRequested: false
      },
      risk: {
        flags: input.riskFlags ?? [],
        requireExplicitRiskPolicy: true
      },
      environment: {
        attributes: {}
      },
      trace: input.trace,
    });
    const response = await fetch(`${config.policyServiceBaseUrl.replace(/\/$/, "")}/policy/evaluate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenService.issueToken({
          caller: servicePrincipal,
          scopes: ["policy.evaluate", "service:node-manager"]
        })}`
      },
      body: JSON.stringify(request)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Policy evaluation failed with status ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as {
      decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "CONDITIONAL_ALLOW";
      decisionId: string;
      approvalRequired: boolean;
      reasonCodes: string[];
      auditRecordId: string;
    };
  }

  await startHttpService({
    config,
    serviceName: "node-manager",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "node_registry_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "node",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/nodes") {
        respondJson(res, 200, {
          schemaVersion: "1.0",
          nodes: nodePlane.listNodes()
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/nodes/")) {
        const nodeId = req.url.slice("/nodes/".length);
        if (!nodeId) {
          return false;
        }
        const node = nodePlane.getNode(nodeId);
        if (!node) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            error: "NODE_NOT_FOUND"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: "1.0",
          node
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/pairing/request") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const payload = pairingRequestSchema.parse(await readJsonBody(req));
        const policy = await evaluatePolicy({
          principal: principal.context,
          actionClass: "register",
          actionId: "node.pairing.request",
          resourceId: payload.nodeId,
          tenantId: payload.tenantId,
          workspaceId: payload.workspaceId,
          requestedCapabilities: ["node.pair"],
          trace,
          riskFlags: [payload.nodeClass]
        });
        if (policy.decision !== "ALLOW") {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            decision: policy
          });
          return true;
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + config.pairingTtlSeconds * 1000);
        const nodePrincipal = buildExecutionNodePrincipalReference(payload.nodeId);
        const pairingToken = tokenService.issueToken({
          caller: servicePrincipal,
          subject: nodePrincipal,
          scopes: ["node.pair.complete"],
          tenantId: payload.tenantId,
          workspaceId: payload.workspaceId,
          ttlSeconds: config.pairingTtlSeconds
        });
        const verified = tokenService.verifyToken(pairingToken);
        if (!verified.ok) {
          throw new Error(`Unexpected pairing token verification failure: ${verified.error}`);
        }
        const node = nodePlane.registerPairing(
          {
            nodeId: payload.nodeId,
            nodeClass: payload.nodeClass,
            tenantId: payload.tenantId,
            workspaceId: payload.workspaceId,
            principalId: nodePrincipal.principalId,
            ...(payload.ownerPrincipal ? { ownerPrincipal: payload.ownerPrincipal } : {}),
            attestation: payload.attestation,
            requestedCapabilities: payload.requestedCapabilities,
            nowIso: now.toISOString()
          },
          verified.claims.tokenId,
          expiresAt.getTime()
        );
        await registry.registerPrincipal({
          principalId: nodePrincipal.principalId,
          principalType: "execution_node",
          displayName: payload.nodeId,
          tenantId: payload.tenantId,
          workspaceId: payload.workspaceId,
          provenance: {
            source: "node_registration",
            sourceRef: principal.context.caller.principalId
          },
          executionNode: {
            nodeId: payload.nodeId,
            mode: payload.nodeClass === "local_node" ? "local" : "remote",
            status: "registered",
            runtimeClass: "sandboxed",
            sandboxProfile: payload.nodeClass,
            registeredAt: now.toISOString()
          }
        });
        const grant = createNodePairingGrant({
          nodeId: payload.nodeId,
          status: "pending",
          expiresAt: expiresAt.toISOString(),
          trace
        });
        logger.info("Node pairing requested", {
          nodeId: payload.nodeId,
          nodeClass: payload.nodeClass,
          decisionId: policy.decisionId,
          traceId: trace.traceId
        });
        respondJson(res, 201, {
          schemaVersion: "1.0",
          accepted: true,
          node,
          pairing: grant,
          pairingToken
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/pairing/complete") {
        const payload = pairingCompleteSchema.parse(await readJsonBody(req));
        const verified = tokenService.verifyToken(payload.pairingToken);
        if (!verified.ok || !verified.claims.subject || !verified.claims.scopes.includes("node.pair.complete")) {
          respondJson(res, 401, {
            schemaVersion: "1.0",
            accepted: false,
            error: "INVALID_PAIRING_TOKEN"
          });
          return true;
        }
        const expectedPrincipal = buildExecutionNodePrincipalReference(payload.nodeId);
        if (verified.claims.subject.principalId !== expectedPrincipal.principalId) {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            error: "PAIRING_SUBJECT_MISMATCH"
          });
          return true;
        }
        const completed = nodePlane.completePairing({
          nodeId: payload.nodeId,
          pairingTokenId: verified.claims.tokenId,
          nowIso: new Date().toISOString(),
          ...(payload.attestation ? { attestation: payload.attestation } : {}),
          ...(payload.capabilities ? { capabilities: payload.capabilities } : {}),
          ...(payload.agentEndpoint ? { agentEndpoint: payload.agentEndpoint } : {})
        });
        if (!completed) {
          respondJson(res, 409, {
            schemaVersion: "1.0",
            accepted: false,
            error: "PAIRING_NOT_PENDING_OR_EXPIRED"
          });
          return true;
        }
        const nodeToken = nodeCredentialTokenService.issueToken({
          caller: expectedPrincipal,
          scopes: ["node.heartbeat.write", "node.dispatch.receive"],
          tenantId: completed.tenantId,
          workspaceId: completed.workspaceId,
          ttlSeconds: config.nodeCredentialTtlSeconds
        });
        const nodeTokenClaims = nodeCredentialTokenService.verifyToken(nodeToken);
        if (!nodeTokenClaims.ok) {
          throw new Error(`Node token verification failed after issuance: ${nodeTokenClaims.error}`);
        }
        const grant = createNodePairingGrant({
          nodeId: payload.nodeId,
          status: "paired",
          expiresAt: new Date(Date.now() + config.nodeCredentialTtlSeconds * 1000).toISOString(),
          trace,
          issuedCredential: {
            tokenId: nodeTokenClaims.claims.tokenId,
            keyId: config.nodeCredentialKeyId,
            issuedAt: new Date(nodeTokenClaims.claims.issuedAt * 1000).toISOString(),
            expiresAt: new Date(nodeTokenClaims.claims.expiresAt * 1000).toISOString(),
            scopes: nodeTokenClaims.claims.scopes
          }
        });
        logger.info("Node pairing completed", {
          nodeId: payload.nodeId,
          nodePrincipalId: expectedPrincipal.principalId,
          traceId: trace.traceId
        });
        respondJson(res, 200, {
          schemaVersion: "1.0",
          accepted: true,
          node: completed,
          pairing: grant,
          nodeCredentialToken: nodeToken
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/heartbeat") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: false,
          allowActorOverride: false
        });
        const authHeader = req.headers.authorization;
        const nodeToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : undefined;
        const verified = nodeCredentialTokenService.verifyToken(nodeToken);
        if (!verified.ok || !verified.claims.scopes.includes("node.heartbeat.write")) {
          respondJson(res, 401, {
            schemaVersion: "1.0",
            accepted: false,
            error: "INVALID_NODE_CREDENTIAL"
          });
          return true;
        }
        const payload = heartbeatSchema.parse(await readJsonBody(req));
        const nodeId = verified.claims.caller.principalId.replace(/^node:/, "");
        const updated = nodePlane.recordHeartbeat(
          {
            nodeId,
            nowIso: new Date().toISOString(),
            status: payload.status,
            runtimeVersion: payload.runtimeVersion,
            load: payload.load,
            attestationFresh: payload.attestationFresh
          },
          trace
        );
        if (!updated) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            accepted: false,
            error: "NODE_NOT_FOUND"
          });
          return true;
        }
        logger.info("Node heartbeat accepted", {
          nodeId,
          heartbeatStatus: payload.status,
          callerPrincipalId: principal.context?.caller.principalId ?? verified.claims.caller.principalId
        });
        respondJson(res, 202, {
          schemaVersion: "1.0",
          accepted: true,
          node: updated
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/capabilities/register") {
        const authHeader = req.headers.authorization;
        const nodeToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : undefined;
        const verified = nodeCredentialTokenService.verifyToken(nodeToken);
        if (!verified.ok) {
          respondJson(res, 401, {
            schemaVersion: "1.0",
            accepted: false,
            error: "INVALID_NODE_CREDENTIAL"
          });
          return true;
        }
        const payload = capabilityUpdateSchema.parse(await readJsonBody(req));
        const nodeId = verified.claims.caller.principalId.replace(/^node:/, "");
        const updated = nodePlane.updateCapabilities(nodeId, payload.capabilities, new Date().toISOString());
        if (!updated) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            accepted: false,
            error: "NODE_NOT_FOUND"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: "1.0",
          accepted: true,
          node: updated
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/dispatch") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const payload = dispatchRequestSchema.parse(await readJsonBody(req));
        const intent = payload.toolContract.intent;
        const artifact = payload.toolContract.artifact;
        const eligibility = nodePlane.dispatchEligibility({
          nodeId: payload.nodeId,
          requiredSandboxMode: payload.runtimePolicy.sandboxMode,
          requiredActionClass: intent.snapshot.action.actionClass
        });
        if (!eligibility.eligible) {
          respondJson(res, 409, {
            schemaVersion: "1.0",
            accepted: false,
            eligibility
          });
          return true;
        }
        const policy = await evaluatePolicy({
          principal: principal.context,
          actionClass: "execute",
          actionId: "node.dispatch.workload",
          resourceId: payload.nodeId,
          tenantId: intent.snapshot.tenantId,
          workspaceId: intent.snapshot.workspaceId,
          requestedCapabilities: ["node.execute", ...intent.snapshot.requiredCapabilities],
          trace,
          riskFlags: intent.snapshot.risk.reasons
        });
        if (policy.decision !== "ALLOW") {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            decision: policy
          });
          return true;
        }
        const dispatchId = `dispatch:${randomUUID()}`;
        const expiresAt = new Date(
          Math.min(Date.parse(artifact.expiresAt), Date.now() + config.nodeDispatchTimeoutMs)
        ).toISOString();
        const nodePrincipal = buildExecutionNodePrincipalReference(payload.nodeId);
        const dispatchToken = nodeCredentialTokenService.issueToken({
          caller: servicePrincipal,
          subject: nodePrincipal,
          scopes: ["node.dispatch.accept", `node.dispatch.id:${dispatchId}`],
          tenantId: intent.snapshot.tenantId,
          workspaceId: intent.snapshot.workspaceId,
          ttlSeconds: Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
        });
        const dispatch = nodeDispatchRequestSchema.parse({
          schemaVersion: "1.0",
          dispatchId,
          nodeId: payload.nodeId,
          executionIntent: intent,
          approvedArtifact: artifact,
          toolContract: payload.toolContract,
          runtimePolicy: payload.runtimePolicy,
          scopedExecutionToken: dispatchToken,
          expiresAt,
          policyDecisionId: policy.decisionId,
          trace,
          metadata: {
            requestingPrincipalId: principal.context.caller.principalId
          }
        });
        if (payload.dryRun) {
          respondJson(res, 202, {
          schemaVersion: "1.0",
          accepted: true,
          dispatch,
          decision: policy.decision,
          dryRun: true
        });
          return true;
        }
        const endpoint = nodePlane.getAgentEndpoint(payload.nodeId);
        if (!endpoint) {
          respondJson(res, 409, {
            schemaVersion: "1.0",
            accepted: false,
            error: "NODE_AGENT_ENDPOINT_UNAVAILABLE"
          });
          return true;
        }
        const response = await fetch(`${endpoint.replace(/\/$/, "")}/node-agent/dispatch`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${dispatchToken}`,
            "x-trace-id": trace.traceId,
            "x-correlation-id": trace.correlationId
          },
          body: JSON.stringify(dispatch)
        });
        const body = await response.json();
        logger.info("Node dispatch attempted", {
          nodeId: payload.nodeId,
          dispatchId,
          statusCode: response.status,
          traceId: trace.traceId
        });
        respondJson(res, response.ok ? 202 : 502, {
          schemaVersion: "1.0",
          accepted: response.ok,
          dispatchId,
          nodeId: payload.nodeId,
          nodeResponse: body
        });
        return true;
      }
      if (req.method === "POST" && req.url?.startsWith("/nodes/") && req.url.endsWith("/quarantine")) {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const nodeId = req.url.slice("/nodes/".length, -"/quarantine".length);
        const reason = nodeReasonSchema.parse(await readJsonBody(req));
        const policy = await evaluatePolicy({
          principal: principal.context,
          actionClass: "administer-policy",
          actionId: "node.quarantine",
          resourceId: nodeId,
          tenantId: principal.context.tenantId ?? "tenant-local",
          workspaceId: principal.context.workspaceId ?? "workspace-local",
          requestedCapabilities: ["node.quarantine"],
          trace,
          riskFlags: ["node_quarantine"]
        });
        if (policy.decision !== "ALLOW") {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            decision: policy
          });
          return true;
        }
        const node = nodePlane.quarantineNode({
          nodeId,
          reason: reason.reason,
          nowIso: new Date().toISOString()
        });
        if (!node) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            accepted: false,
            error: "NODE_NOT_FOUND"
          });
          return true;
        }
        const record = nodeQuarantineRecordSchema.parse({
          schemaVersion: "1.0",
          quarantineId: `quarantine:${randomUUID()}`,
          nodeId,
          reasonCode: reason.reasonCode,
          reason: reason.reason,
          quarantinedBy: principal.context.caller,
          quarantinedAt: new Date().toISOString(),
          inFlightDisposition: "allow_completion",
          trace
        });
        logger.warn("Node quarantined", {
          nodeId,
          reasonCode: reason.reasonCode,
          traceId: trace.traceId
        });
        respondJson(res, 202, {
          schemaVersion: "1.0",
          accepted: true,
          node,
          quarantine: record
        });
        return true;
      }
      if (req.method === "POST" && req.url?.startsWith("/nodes/") && req.url.endsWith("/revoke")) {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const nodeId = req.url.slice("/nodes/".length, -"/revoke".length);
        const reason = nodeReasonSchema.parse(await readJsonBody(req));
        const policy = await evaluatePolicy({
          principal: principal.context,
          actionClass: "administer-policy",
          actionId: "node.revoke",
          resourceId: nodeId,
          tenantId: principal.context.tenantId ?? "tenant-local",
          workspaceId: principal.context.workspaceId ?? "workspace-local",
          requestedCapabilities: ["node.revoke"],
          trace,
          riskFlags: ["node_revocation"]
        });
        if (policy.decision !== "ALLOW") {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            decision: policy
          });
          return true;
        }
        const node = nodePlane.revokeNode({
          nodeId,
          reason: reason.reason,
          nowIso: new Date().toISOString()
        });
        if (!node) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            accepted: false,
            error: "NODE_NOT_FOUND"
          });
          return true;
        }
        const record = nodeRevocationRecordSchema.parse({
          schemaVersion: "1.0",
          revocationId: `revocation:${randomUUID()}`,
          nodeId,
          reasonCode: reason.reasonCode,
          reason: reason.reason,
          revokedBy: principal.context.caller,
          revokedAt: new Date().toISOString(),
          trace
        });
        logger.warn("Node revoked", {
          nodeId,
          reasonCode: reason.reasonCode,
          traceId: trace.traceId
        });
        respondJson(res, 202, {
          schemaVersion: "1.0",
          accepted: true,
          node,
          revocation: record
        });
        return true;
      }
      return false;
    }
  });
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "node-manager",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
