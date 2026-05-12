import { randomUUID } from "node:crypto";

import {
  createPolicyEvaluationRequest,
  type ActionClass,
  type CreateAuditEventInput,
  type PolicyDecisionResult,
  type PolicyEvaluationRequest,
  type PolicyTrace,
  type PrincipalReference,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";
import type { PolicyClient } from "@manasvi/policy-sdk";

import type { IntegrationAccountRecord } from "./index.js";

export type GoogleServiceFamily = "gmail" | "calendar" | "drive" | "docs";
export type GoogleReadWriteClass = "read" | "write" | "destructive_write" | "communication_write" | "sharing_write";
export type ApprovalSensitivity = "none" | "policy" | "required";

export interface GoogleScopeDescriptor {
  providerScope: string;
  normalizedScope: string;
  serviceFamily: GoogleServiceFamily;
  class: GoogleReadWriteClass;
  sensitivity: "low" | "medium" | "high";
  impliedCapabilities: GoogleCapabilityId[];
}

export type GoogleCapabilityId =
  | "gmail.read_threads"
  | "gmail.read_metadata"
  | "gmail.compose"
  | "gmail.send"
  | "gmail.modify"
  | "calendar.read_events"
  | "calendar.write_events"
  | "drive.read_files"
  | "drive.write_files"
  | "docs.read"
  | "docs.write";

export interface GoogleCapabilityDescriptor {
  capabilityId: GoogleCapabilityId;
  serviceFamily: GoogleServiceFamily;
  class: GoogleReadWriteClass;
  displayName: string;
  description: string;
  approvalSensitivity: ApprovalSensitivity;
}

export type GoogleActionId =
  | "gmail.threads.read"
  | "gmail.draft.create"
  | "gmail.draft.reply"
  | "gmail.message.send"
  | "gmail.message.archive"
  | "gmail.message.label"
  | "calendar.events.read"
  | "calendar.events.write"
  | "drive.files.read"
  | "drive.files.write"
  | "docs.document.read"
  | "docs.document.write";

export interface GoogleActionDescriptor {
  actionId: GoogleActionId;
  serviceFamily: GoogleServiceFamily;
  class: GoogleReadWriteClass;
  requiredCapabilities: GoogleCapabilityId[];
  approvalSensitivity: ApprovalSensitivity;
  policyActionClass: ActionClass;
}

export const GOOGLE_SCOPE_CATALOG: GoogleScopeDescriptor[] = [
  {
    providerScope: "https://www.googleapis.com/auth/gmail.readonly",
    normalizedScope: "google.gmail.readonly",
    serviceFamily: "gmail",
    class: "read",
    sensitivity: "low",
    impliedCapabilities: ["gmail.read_threads", "gmail.read_metadata"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/gmail.metadata",
    normalizedScope: "google.gmail.metadata",
    serviceFamily: "gmail",
    class: "read",
    sensitivity: "low",
    impliedCapabilities: ["gmail.read_metadata"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/gmail.compose",
    normalizedScope: "google.gmail.compose",
    serviceFamily: "gmail",
    class: "write",
    sensitivity: "medium",
    impliedCapabilities: ["gmail.compose"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/gmail.send",
    normalizedScope: "google.gmail.send",
    serviceFamily: "gmail",
    class: "communication_write",
    sensitivity: "high",
    impliedCapabilities: ["gmail.send"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/gmail.modify",
    normalizedScope: "google.gmail.modify",
    serviceFamily: "gmail",
    class: "write",
    sensitivity: "medium",
    impliedCapabilities: ["gmail.read_threads", "gmail.read_metadata", "gmail.compose", "gmail.modify"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/calendar.readonly",
    normalizedScope: "google.calendar.readonly",
    serviceFamily: "calendar",
    class: "read",
    sensitivity: "low",
    impliedCapabilities: ["calendar.read_events"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/calendar",
    normalizedScope: "google.calendar",
    serviceFamily: "calendar",
    class: "write",
    sensitivity: "medium",
    impliedCapabilities: ["calendar.read_events", "calendar.write_events"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/drive.readonly",
    normalizedScope: "google.drive.readonly",
    serviceFamily: "drive",
    class: "read",
    sensitivity: "low",
    impliedCapabilities: ["drive.read_files"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/drive.file",
    normalizedScope: "google.drive.file",
    serviceFamily: "drive",
    class: "sharing_write",
    sensitivity: "high",
    impliedCapabilities: ["drive.read_files", "drive.write_files"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/documents.readonly",
    normalizedScope: "google.docs.readonly",
    serviceFamily: "docs",
    class: "read",
    sensitivity: "low",
    impliedCapabilities: ["docs.read"]
  },
  {
    providerScope: "https://www.googleapis.com/auth/documents",
    normalizedScope: "google.docs",
    serviceFamily: "docs",
    class: "write",
    sensitivity: "medium",
    impliedCapabilities: ["docs.read", "docs.write"]
  }
];

export const GOOGLE_CAPABILITY_CATALOG: GoogleCapabilityDescriptor[] = [
  { capabilityId: "gmail.read_threads", serviceFamily: "gmail", class: "read", displayName: "Read Gmail threads", description: "Read Gmail message threads and content.", approvalSensitivity: "none" },
  { capabilityId: "gmail.read_metadata", serviceFamily: "gmail", class: "read", displayName: "Read Gmail metadata", description: "Read Gmail headers and metadata.", approvalSensitivity: "none" },
  { capabilityId: "gmail.compose", serviceFamily: "gmail", class: "write", displayName: "Compose Gmail drafts", description: "Create and update draft messages.", approvalSensitivity: "policy" },
  { capabilityId: "gmail.send", serviceFamily: "gmail", class: "communication_write", displayName: "Send Gmail messages", description: "Send outbound email messages.", approvalSensitivity: "required" },
  { capabilityId: "gmail.modify", serviceFamily: "gmail", class: "write", displayName: "Modify Gmail mailbox", description: "Archive messages, apply/remove labels, and mutate mailbox state.", approvalSensitivity: "policy" },
  { capabilityId: "calendar.read_events", serviceFamily: "calendar", class: "read", displayName: "Read Calendar events", description: "Read calendar events and metadata.", approvalSensitivity: "none" },
  { capabilityId: "calendar.write_events", serviceFamily: "calendar", class: "write", displayName: "Write Calendar events", description: "Create and modify calendar events.", approvalSensitivity: "policy" },
  { capabilityId: "drive.read_files", serviceFamily: "drive", class: "read", displayName: "Read Drive files", description: "Read Drive file metadata/content where permitted.", approvalSensitivity: "none" },
  { capabilityId: "drive.write_files", serviceFamily: "drive", class: "sharing_write", displayName: "Write/Share Drive files", description: "Create/update/share Drive files.", approvalSensitivity: "policy" },
  { capabilityId: "docs.read", serviceFamily: "docs", class: "read", displayName: "Read Docs", description: "Read Google Docs content.", approvalSensitivity: "none" },
  { capabilityId: "docs.write", serviceFamily: "docs", class: "write", displayName: "Write Docs", description: "Create/update Google Docs content.", approvalSensitivity: "policy" }
];

export const GOOGLE_ACTION_CATALOG: GoogleActionDescriptor[] = [
  { actionId: "gmail.threads.read", serviceFamily: "gmail", class: "read", requiredCapabilities: ["gmail.read_threads"], approvalSensitivity: "none", policyActionClass: "read" },
  { actionId: "gmail.draft.create", serviceFamily: "gmail", class: "write", requiredCapabilities: ["gmail.compose"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "gmail.draft.reply", serviceFamily: "gmail", class: "write", requiredCapabilities: ["gmail.compose"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "gmail.message.send", serviceFamily: "gmail", class: "communication_write", requiredCapabilities: ["gmail.send"], approvalSensitivity: "required", policyActionClass: "external-side-effect" },
  { actionId: "gmail.message.archive", serviceFamily: "gmail", class: "write", requiredCapabilities: ["gmail.modify"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "gmail.message.label", serviceFamily: "gmail", class: "write", requiredCapabilities: ["gmail.modify"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "calendar.events.read", serviceFamily: "calendar", class: "read", requiredCapabilities: ["calendar.read_events"], approvalSensitivity: "none", policyActionClass: "read" },
  { actionId: "calendar.events.write", serviceFamily: "calendar", class: "write", requiredCapabilities: ["calendar.write_events"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "drive.files.read", serviceFamily: "drive", class: "read", requiredCapabilities: ["drive.read_files"], approvalSensitivity: "none", policyActionClass: "read" },
  { actionId: "drive.files.write", serviceFamily: "drive", class: "sharing_write", requiredCapabilities: ["drive.write_files"], approvalSensitivity: "policy", policyActionClass: "write" },
  { actionId: "docs.document.read", serviceFamily: "docs", class: "read", requiredCapabilities: ["docs.read"], approvalSensitivity: "none", policyActionClass: "read" },
  { actionId: "docs.document.write", serviceFamily: "docs", class: "write", requiredCapabilities: ["docs.write"], approvalSensitivity: "policy", policyActionClass: "write" }
];

export interface CapabilityDerivationResult {
  grantedScopes: GoogleScopeDescriptor[];
  normalizedScopes: string[];
  availableCapabilities: GoogleCapabilityDescriptor[];
  missingCapabilities: GoogleCapabilityDescriptor[];
}

export function deriveGoogleCapabilities(grantedProviderScopes: string[]): CapabilityDerivationResult {
  const grantedSet = new Set(grantedProviderScopes);
  const grantedScopes = GOOGLE_SCOPE_CATALOG.filter((scope) => grantedSet.has(scope.providerScope));
  const normalizedScopes = grantedScopes.map((scope) => scope.normalizedScope);
  const availableIds = new Set<GoogleCapabilityId>();
  for (const scope of grantedScopes) {
    for (const cap of scope.impliedCapabilities) availableIds.add(cap);
  }
  const availableCapabilities = GOOGLE_CAPABILITY_CATALOG.filter((cap) => availableIds.has(cap.capabilityId));
  const missingCapabilities = GOOGLE_CAPABILITY_CATALOG.filter((cap) => !availableIds.has(cap.capabilityId));
  return { grantedScopes, normalizedScopes, availableCapabilities, missingCapabilities };
}

export type GooglePermissionDecision = "allow" | "deny" | "require_approval";

export interface GooglePermissionCheckInput {
  account: IntegrationAccountRecord | null;
  actionId: GoogleActionId;
  principalContext: ResolvedPrincipalContext;
  actor: PrincipalReference;
  caller: PrincipalReference;
  tenantId: string;
  workspaceId: string;
  trace: PolicyTrace;
  approvalPresent?: boolean;
  pluginId?: string;
  policyClient?: PolicyClient;
}

export interface GooglePermissionCheckResult {
  decision: GooglePermissionDecision;
  approvalRequired: boolean;
  reasonCodes: string[];
  action: GoogleActionDescriptor;
  connected: boolean;
  authorizedByScopes: boolean;
  requiredCapabilities: GoogleCapabilityId[];
  availableCapabilities: GoogleCapabilityId[];
  missingCapabilities: GoogleCapabilityId[];
  policyDecision?: PolicyDecisionResult;
  policyRequest?: PolicyEvaluationRequest;
}

export function buildGooglePolicyBinding(input: {
  action: GoogleActionDescriptor;
  account: IntegrationAccountRecord;
  principalContext: ResolvedPrincipalContext;
  tenantId: string;
  workspaceId: string;
  trace: PolicyTrace;
  approvalPresent?: boolean;
  pluginId?: string;
}): PolicyEvaluationRequest {
  return createPolicyEvaluationRequest({
    requestingService: { principalId: "service:api-gateway", principalType: "service" },
    principalContext: input.principalContext,
    action: {
      actionClass: input.action.policyActionClass,
      actionId: `integration.google.${input.action.actionId}`,
      attributes: {
        providerId: "google",
        serviceFamily: input.action.serviceFamily,
        readWriteClass: input.action.class,
        approvalSensitivity: input.action.approvalSensitivity,
        pluginId: input.pluginId
      }
    },
    resource: {
      resourceClass: "service-endpoint",
      resourceId: input.account.accountId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      attributes: {
        connectorId: input.account.connectorId,
        providerAccountId: input.account.providerAccountId
      }
    },
    requestedCapabilities: input.action.requiredCapabilities.map((capabilityId) => ({
      capabilityId: `integration.google.capability.${capabilityId}`,
      scope: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        resourceClass: "service-endpoint",
        resourcePattern: input.account.accountId
      },
      constraints: {
        providerId: "google",
        serviceFamily: input.action.serviceFamily,
        pluginId: input.pluginId
      }
    })),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    approval: {
      approvalPresent: input.approvalPresent ?? false,
      skipApprovalRequested: false
    },
    risk: {
      flags: [
        `integration:google`,
        `service_family:${input.action.serviceFamily}`,
        `rw_class:${input.action.class}`,
        ...(input.action.approvalSensitivity === "required" ? ["google_approval_sensitive_required"] : []),
        ...(input.action.approvalSensitivity === "policy" ? ["google_approval_sensitive_policy"] : []),
        ...(input.pluginId ? ["plugin_initiated_integration_access"] : [])
      ],
      requireExplicitRiskPolicy: true
    },
    environment: {
      attributes: {
        integrationProvider: "google"
      }
    },
    trace: input.trace
  });
}

export async function checkGoogleActionPermission(
  input: GooglePermissionCheckInput
): Promise<GooglePermissionCheckResult> {
  const action = GOOGLE_ACTION_CATALOG.find((item) => item.actionId === input.actionId);
  if (!action) {
    throw new Error(`Unknown Google action: ${input.actionId}`);
  }

  if (!input.account || input.account.status !== "connected") {
    return {
      decision: "deny",
      approvalRequired: false,
      reasonCodes: ["CONNECTOR_NOT_CONNECTED"],
      action,
      connected: false,
      authorizedByScopes: false,
      requiredCapabilities: action.requiredCapabilities,
      availableCapabilities: [],
      missingCapabilities: action.requiredCapabilities
    };
  }

  const derived = deriveGoogleCapabilities(input.account.scopesGranted);
  const available = new Set(derived.availableCapabilities.map((item) => item.capabilityId));
  const missingCapabilities = action.requiredCapabilities.filter((cap) => !available.has(cap));
  if (missingCapabilities.length > 0) {
    return {
      decision: "deny",
      approvalRequired: false,
      reasonCodes: ["MISSING_REQUIRED_SCOPE_OR_CAPABILITY"],
      action,
      connected: true,
      authorizedByScopes: false,
      requiredCapabilities: action.requiredCapabilities,
      availableCapabilities: [...available],
      missingCapabilities
    };
  }

  const binding = buildGooglePolicyBinding({
    action,
    account: input.account,
    principalContext: input.principalContext,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    trace: input.trace,
    ...(typeof input.approvalPresent === "boolean" ? { approvalPresent: input.approvalPresent } : {}),
    ...(input.pluginId ? { pluginId: input.pluginId } : {})
  });

  if (!input.policyClient) {
    return {
      decision: "deny",
      approvalRequired: false,
      reasonCodes: ["POLICY_CLIENT_UNAVAILABLE"],
      action,
      connected: true,
      authorizedByScopes: true,
      requiredCapabilities: action.requiredCapabilities,
      availableCapabilities: [...available],
      missingCapabilities: [],
      policyRequest: binding
    };
  }

  const decision = await input.policyClient.evaluate(binding);
  if (decision.decision === "DENY") {
    return {
      decision: "deny",
      approvalRequired: false,
      reasonCodes: decision.reasonCodes,
      action,
      connected: true,
      authorizedByScopes: true,
      requiredCapabilities: action.requiredCapabilities,
      availableCapabilities: [...available],
      missingCapabilities: [],
      policyDecision: decision.decision,
      policyRequest: binding
    };
  }

  if (decision.decision === "REQUIRE_APPROVAL" || (action.approvalSensitivity === "required" && !input.approvalPresent)) {
    return {
      decision: "require_approval",
      approvalRequired: true,
      reasonCodes: action.approvalSensitivity === "required" ? ["ACTION_MARKED_APPROVAL_REQUIRED"] : decision.reasonCodes,
      action,
      connected: true,
      authorizedByScopes: true,
      requiredCapabilities: action.requiredCapabilities,
      availableCapabilities: [...available],
      missingCapabilities: [],
      policyDecision: decision.decision,
      policyRequest: binding
    };
  }

  return {
    decision: "allow",
    approvalRequired: false,
    reasonCodes: decision.reasonCodes,
    action,
    connected: true,
    authorizedByScopes: true,
    requiredCapabilities: action.requiredCapabilities,
    availableCapabilities: [...available],
    missingCapabilities: [],
    policyDecision: decision.decision,
    policyRequest: binding
  };
}

export function buildGooglePermissionAuditEvent(input: {
  traceId: string;
  correlationId: string;
  actor?: PrincipalReference;
  caller?: PrincipalReference;
  tenantId?: string;
  workspaceId?: string;
  accountId?: string;
  pluginId?: string;
  result: GooglePermissionCheckResult;
}): CreateAuditEventInput {
  const eventType =
    input.result.decision === "allow"
      ? "policy.decision.allow"
      : input.result.decision === "require_approval"
        ? "policy.decision.require_approval"
        : "policy.decision.deny";

  return {
    producingService: "api-gateway",
    eventType,
    severity: input.result.decision === "deny" ? "warn" : "info",
    traceId: input.traceId,
    correlationId: input.correlationId,
    actor: input.actor,
    caller: input.caller,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    ...(input.accountId
      ? {
          resource: {
            resourceClass: "integration-account",
            resourceId: input.accountId
          }
        }
      : {}),
    decisionOutcome:
      input.result.decision === "allow"
        ? "allow"
        : input.result.decision === "require_approval"
          ? "require_approval"
          : "deny",
    reasonCodes: input.result.reasonCodes,
    payload: {
      providerId: "google",
      actionId: input.result.action.actionId,
      serviceFamily: input.result.action.serviceFamily,
      readWriteClass: input.result.action.class,
      approvalSensitivity: input.result.action.approvalSensitivity,
      connected: input.result.connected,
      authorizedByScopes: input.result.authorizedByScopes,
      requiredCapabilities: input.result.requiredCapabilities,
      availableCapabilities: input.result.availableCapabilities,
      missingCapabilities: input.result.missingCapabilities,
      policyDecision: input.result.policyDecision,
      permissionCheckId: `permchk:${randomUUID()}`
    }
  };
}

export function buildGoogleAuthorizationSnapshot(account: IntegrationAccountRecord | null) {
  if (!account || account.status !== "connected") {
    return {
      connected: false,
      status: account?.status ?? "not_connected",
      grantedScopes: [],
      normalizedScopes: [],
      availableCapabilities: [],
      missingCapabilities: GOOGLE_CAPABILITY_CATALOG,
      actions: GOOGLE_ACTION_CATALOG.map((action) => ({
        actionId: action.actionId,
        serviceFamily: action.serviceFamily,
        class: action.class,
        approvalSensitivity: action.approvalSensitivity,
        canAttempt: false,
        missingCapabilities: action.requiredCapabilities
      }))
    };
  }

  const derived = deriveGoogleCapabilities(account.scopesGranted);
  const available = new Set(derived.availableCapabilities.map((item) => item.capabilityId));
  return {
    connected: true,
    status: account.status,
    grantedScopes: derived.grantedScopes,
    normalizedScopes: derived.normalizedScopes,
    availableCapabilities: derived.availableCapabilities,
    missingCapabilities: derived.missingCapabilities,
    actions: GOOGLE_ACTION_CATALOG.map((action) => {
      const missingCapabilities = action.requiredCapabilities.filter((cap) => !available.has(cap));
      return {
        actionId: action.actionId,
        serviceFamily: action.serviceFamily,
        class: action.class,
        approvalSensitivity: action.approvalSensitivity,
        canAttempt: missingCapabilities.length === 0,
        missingCapabilities
      };
    })
  };
}
