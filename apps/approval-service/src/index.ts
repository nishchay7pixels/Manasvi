import { randomUUID } from "node:crypto";

import { InternalTokenService, PrincipalResolver } from "@manasvi/auth";
import {
  CONTRACT_SCHEMA_VERSION,
  approvalDecisionInputSchema,
  approvalRequestSchema,
  approvedIntentArtifactSchema,
  executionIntentSchema,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovedIntentArtifact,
  type ExecutionIntent
} from "@manasvi/contracts";
import {
  createApprovalRecord,
  signApprovedIntentArtifact,
  verifyExecutionIntentSignature
} from "@manasvi/executor-sdk";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadApprovalServiceConfig } from "./config.js";

function minIsoDate(a: string, b: string): string {
  return new Date(Math.min(new Date(a).getTime(), new Date(b).getTime())).toISOString();
}

async function main(): Promise<void> {
  const config = await loadApprovalServiceConfig();
  const firstKeyId = Object.keys(config.internalAuthVerificationKeys)[0];
  if (!firstKeyId) {
    throw new Error("internalAuthVerificationKeys must include at least one key");
  }
  if (!config.internalAuthVerificationKeys[firstKeyId]) {
    throw new Error(`Missing secret for key id ${firstKeyId}`);
  }
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: firstKeyId,
      secret: config.internalAuthVerificationKeys[firstKeyId]!,
      ttlSeconds: 120
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: config.internalAuthVerificationKeys
    }
  );
  const resolver = new PrincipalResolver(tokenService);

  const requests = new Map<string, ApprovalRequest>();
  const requestByIntentId = new Map<string, string>();
  const records: ApprovalRecord[] = [];
  const artifactsByIntentId = new Map<string, ApprovedIntentArtifact>();
  const auditEvents: Array<Record<string, unknown>> = [];

  const appendAudit = (event: Record<string, unknown>): void => {
    auditEvents.unshift(event);
    if (auditEvents.length > config.approvalAuditBufferSize) {
      auditEvents.pop();
    }
  };

  const issueArtifact = (input: {
    intent: ExecutionIntent;
    approvalState: "approved" | "not_required";
    approvalRequestId?: string;
    approvalRecordId: string;
  }): ApprovedIntentArtifact => {
    return signApprovedIntentArtifact(
      {
        schemaVersion: "1.0",
        artifactId: `approved-artifact:${randomUUID()}`,
        intentId: input.intent.intentId,
        intentVersion: input.intent.intentVersion,
        intentPayloadHash: input.intent.payloadHash,
        approvalState: input.approvalState,
        issuedAt: new Date().toISOString(),
        expiresAt: minIsoDate(
          input.intent.snapshot.expiresAt,
          new Date(Date.now() + config.approvedArtifactTtlSeconds * 1000).toISOString()
        ),
        issuedByService: "approval-service",
        ...(input.approvalRequestId ? { approvalRequestId: input.approvalRequestId } : {}),
        approvalRecordId: input.approvalRecordId,
        policyDecisionId: input.intent.snapshot.policy.decisionId,
        nonce: `approval-nonce:${randomUUID()}`,
        trace: input.intent.snapshot.trace,
        tokenVersion: "1.0"
      },
      {
        keyId: config.approvalSigningKeyId,
        secret: config.approvalSigningSecret
      }
    );
  };

  await startHttpService({
    config,
    serviceName: "approval-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "approval_state_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "approval",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/approvals/audit/records") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          records,
          auditEvents
        });
        return true;
      }

      // ── Admin list-all endpoint (no intentId required) ───────────────────
      if (req.method === "GET" && req.url?.startsWith("/admin/approvals")) {
        const url = new URL(req.url, "http://localhost");
        const state = url.searchParams.get("state");
        let all = [...requests.values()];
        if (state) {
          all = all.filter((r) => r.state === state);
        }
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          requests: all,
          count: all.length
        });
        return true;
      }
      // ─────────────────────────────────────────────────────────────────────

      if (req.method === "GET" && req.url?.startsWith("/approvals/requests")) {
        const url = new URL(req.url, "http://localhost");
        const intentId = url.searchParams.get("intentId");
        if (!intentId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intentId query parameter is required"
          });
          return true;
        }
        const requestId = requestByIntentId.get(intentId);
        if (!requestId) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approval request not found"
          });
          return true;
        }
        const approvalRequest = requests.get(requestId);
        if (!approvalRequest) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approval request not found"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          request: approvalRequest
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/approvals/artifacts")) {
        const url = new URL(req.url, "http://localhost");
        const intentId = url.searchParams.get("intentId");
        if (!intentId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intentId query parameter is required"
          });
          return true;
        }
        const artifact = artifactsByIntentId.get(intentId);
        if (!artifact) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approved artifact not found"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          artifact
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/approvals/requests") {
        const principal = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const body = z
          .object({
            intent: executionIntentSchema,
            summary: z.string().min(1).optional(),
            policyReason: z.string().min(1).optional()
          })
          .parse(await readJsonBody(req));
        const intent = body.intent;
        const signatureVerification = verifyExecutionIntentSignature(intent, config.internalAuthVerificationKeys);
        if (!signatureVerification.ok) {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intent signature verification failed",
            errorCode: signatureVerification.code,
            detail: signatureVerification.message
          });
          return true;
        }
        if (!intent.approval.required) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "Intent does not require approval; use artifact issue path."
          });
          return true;
        }
        const now = Date.now();
        const expiresAt = minIsoDate(
          intent.snapshot.expiresAt,
          new Date(now + config.approvalRequestTtlSeconds * 1000).toISOString()
        );
        const existingRequestId = requestByIntentId.get(intent.intentId);
        if (existingRequestId) {
          const existing = requests.get(existingRequestId)!;
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            request: existing
          });
          return true;
        }

        const approvalRequest = approvalRequestSchema.parse({
          schemaVersion: "1.0",
          approvalRequestId: `approval-request:${randomUUID()}`,
          intentId: intent.intentId,
          tenantId: intent.snapshot.tenantId,
          workspaceId: intent.snapshot.workspaceId,
          actor: intent.snapshot.actor,
          target: intent.snapshot.target,
          actionClass: intent.snapshot.action.actionClass,
          requestedCapabilities: intent.snapshot.requiredCapabilities,
          risk: {
            score: intent.snapshot.risk.score,
            level: intent.snapshot.risk.level
          },
          summary:
            body.summary ??
            `${intent.snapshot.action.actionClass} ${intent.snapshot.action.operation} on ${intent.snapshot.target.resourceId}`,
          policyReason:
            body.policyReason ?? (intent.snapshot.policy.reasonCodes.join(",") || "approval required by policy"),
          state: "pending",
          createdAt: new Date().toISOString(),
          expiresAt,
          trace: intent.snapshot.trace,
          intentPayloadHash: intent.payloadHash
        });
        requests.set(approvalRequest.approvalRequestId, approvalRequest);
        requestByIntentId.set(intent.intentId, approvalRequest.approvalRequestId);
        appendAudit({
          event: "approval_request_created",
          intentId: intent.intentId,
          approvalRequestId: approvalRequest.approvalRequestId,
          actorPrincipalId: intent.snapshot.actor.principalId,
          traceId: intent.snapshot.trace.traceId
        });
        logger.info("Approval request created", {
          intentId: intent.intentId,
          approvalRequestId: approvalRequest.approvalRequestId,
          actionClass: intent.snapshot.action.actionClass,
          targetResourceId: intent.snapshot.target.resourceId,
          riskLevel: intent.snapshot.risk.level,
          traceId: intent.snapshot.trace.traceId,
          correlationId: intent.snapshot.trace.correlationId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          request: approvalRequest
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/approvals/requests/decision") {
        const principal = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const body = z
          .object({
            approvalRequestId: z.string().min(1),
            intent: executionIntentSchema,
            decision: approvalDecisionInputSchema
          })
          .parse(await readJsonBody(req));
        const signatureVerification = verifyExecutionIntentSignature(
          body.intent,
          config.internalAuthVerificationKeys
        );
        if (!signatureVerification.ok) {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intent signature verification failed",
            errorCode: signatureVerification.code,
            detail: signatureVerification.message
          });
          return true;
        }
        const approvalRequest = requests.get(body.approvalRequestId);
        if (!approvalRequest) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approval request not found"
          });
          return true;
        }
        if (approvalRequest.intentId !== body.intent.intentId) {
          respondJson(res, 409, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approval request is not linked to provided intent"
          });
          return true;
        }
        if (new Date(approvalRequest.expiresAt).getTime() <= Date.now()) {
          const expiredRequest = {
            ...approvalRequest,
            state: "expired" as const
          };
          requests.set(body.approvalRequestId, expiredRequest);
          respondJson(res, 409, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "approval request expired"
          });
          return true;
        }
        if (approvalRequest.state !== "pending") {
          respondJson(res, 409, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: `approval request already ${approvalRequest.state}`
          });
          return true;
        }

        const updatedRequest = approvalRequestSchema.parse({
          ...approvalRequest,
          state: body.decision.decision === "approved" ? "approved" : "rejected"
        });
        requests.set(body.approvalRequestId, updatedRequest);

        const approvalRecord = createApprovalRecord({
          intent: body.intent,
          decision: body.decision.decision === "approved" ? "approved" : "rejected",
          decidedBy: body.decision.decidedBy,
          decidedAt: body.decision.decidedAt,
          policyDecisionId: body.intent.snapshot.policy.decisionId,
          policyAuditRecordId: body.intent.snapshot.policy.auditRecordId,
          recordedByService: "approval-service",
          ...(body.decision.reason ? { reason: body.decision.reason } : {})
        });
        records.unshift(approvalRecord);
        if (records.length > config.approvalAuditBufferSize) {
          records.pop();
        }

        if (body.decision.decision === "rejected") {
          appendAudit({
            event: "approval_rejected",
            intentId: body.intent.intentId,
            approvalRequestId: body.approvalRequestId,
            approvalRecordId: approvalRecord.approvalRecordId
          });
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            request: updatedRequest,
            approvalRecord
          });
          return true;
        }

        const artifact = issueArtifact({
          intent: body.intent,
          approvalState: "approved",
          approvalRequestId: body.approvalRequestId,
          approvalRecordId: approvalRecord.approvalRecordId
        });
        artifactsByIntentId.set(body.intent.intentId, approvedIntentArtifactSchema.parse(artifact));
        appendAudit({
          event: "approval_granted",
          intentId: body.intent.intentId,
          approvalRequestId: body.approvalRequestId,
          approvalRecordId: approvalRecord.approvalRecordId,
          artifactId: artifact.artifactId
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          request: updatedRequest,
          approvalRecord,
          artifact
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/approvals/artifacts/issue-system") {
        const principal = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const body = z
          .object({
            intent: executionIntentSchema,
            reason: z.string().min(1).optional()
          })
          .parse(await readJsonBody(req));
        const signatureVerification = verifyExecutionIntentSignature(
          body.intent,
          config.internalAuthVerificationKeys
        );
        if (!signatureVerification.ok) {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intent signature verification failed",
            errorCode: signatureVerification.code,
            detail: signatureVerification.message
          });
          return true;
        }
        if (body.intent.approval.required) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "Intent requires approval and cannot be system-authorized"
          });
          return true;
        }
        const approvalRecord = createApprovalRecord({
          intent: body.intent,
          decision: "approved",
          decidedBy: principal.context.actor,
          decidedAt: new Date().toISOString(),
          policyDecisionId: body.intent.snapshot.policy.decisionId,
          policyAuditRecordId: body.intent.snapshot.policy.auditRecordId,
          recordedByService: "approval-service",
          reason: body.reason ?? "approval_not_required_by_policy"
        });
        records.unshift(approvalRecord);
        if (records.length > config.approvalAuditBufferSize) {
          records.pop();
        }
        const artifact = issueArtifact({
          intent: body.intent,
          approvalState: "not_required",
          approvalRecordId: approvalRecord.approvalRecordId
        });
        artifactsByIntentId.set(body.intent.intentId, artifact);
        appendAudit({
          event: "system_artifact_issued",
          intentId: body.intent.intentId,
          approvalRecordId: approvalRecord.approvalRecordId,
          artifactId: artifact.artifactId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          artifact,
          approvalRecord
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
      service: "approval-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
