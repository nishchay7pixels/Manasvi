import {
  memoryClassSchema,
  memoryContextCandidatesRequestSchema,
  memoryContextCandidatesResponseSchema,
  memoryPromotionCandidateRequestSchema,
  memoryPromotionReviewSchema,
  memoryQueryRequestSchema,
  memoryQueryResponseSchema,
  memoryWriteRequestSchema,
  type MemoryClass,
  type MemoryContextCandidatesRequest,
  type MemoryContextCandidatesResponse,
  type MemoryPromotionCandidateRequest,
  type MemoryPromotionReview,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type MemoryRecord,
  type MemoryWriteRequest,
  type TrustClass
} from "@manasvi/contracts";

const TENANT_WORKSPACE_PREFIX_REGEX = /^tenant\/([^/]+)\/workspace\/([^/]+)\/(.+)$/;

export interface ParsedScopedNamespace {
  tenantId: string;
  workspaceId: string;
  suffix: string;
}

export function parseTenantWorkspaceNamespace(namespace: string): ParsedScopedNamespace | undefined {
  const match = namespace.match(TENANT_WORKSPACE_PREFIX_REGEX);
  if (!match) {
    return undefined;
  }
  const tenantId = match[1];
  const workspaceId = match[2];
  const suffix = match[3];
  if (!tenantId || !workspaceId || !suffix) {
    return undefined;
  }
  return {
    tenantId,
    workspaceId,
    suffix
  };
}

export function buildTenantWorkspaceMemoryNamespace(input: {
  tenantId: string;
  workspaceId: string;
  suffix: string;
}): string {
  return `tenant/${input.tenantId}/workspace/${input.workspaceId}/${input.suffix}`;
}

export function isNamespaceCompatible(memoryClass: MemoryClass, namespace: string): boolean {
  const scoped = parseTenantWorkspaceNamespace(namespace);
  if (!scoped) {
    return false;
  }
  const suffix = scoped.suffix;
  switch (memoryClass) {
    case "EPHEMERAL_SESSION":
      return /^session\/[^/]+(\/.*)?$/.test(suffix);
    case "USER_DURABLE":
      return /^user\/[^/]+\/[^/]+(\/.*)?$/.test(suffix);
    case "ORG_SHARED_TRUSTED":
      return /^shared\/[^/]+(\/.*)?$/.test(suffix);
    case "UNTRUSTED_EXTERNAL":
      return /^external\/[^/]+\/[^/]+(\/.*)?$/.test(suffix);
    case "AUDIT_ACTION_HISTORY":
      return /^audit\/[^/]+(\/.*)?$/.test(suffix);
    default:
      return false;
  }
}

export function isTrustAllowedForClass(memoryClass: MemoryClass, trust: TrustClass): boolean {
  switch (memoryClass) {
    case "EPHEMERAL_SESSION":
      return trust !== "SECRET_SENSITIVE";
    case "USER_DURABLE":
      return trust === "USER_OWNED" || trust === "CONTROL_TRUSTED" || trust === "SECRET_SENSITIVE";
    case "ORG_SHARED_TRUSTED":
      return trust === "CONTROL_TRUSTED" || trust === "AUDIT_SECURITY";
    case "UNTRUSTED_EXTERNAL":
      return trust === "EXTERNAL_UNTRUSTED" || trust === "MODEL_INTERMEDIATE";
    case "AUDIT_ACTION_HISTORY":
      return trust === "AUDIT_SECURITY" || trust === "CONTROL_TRUSTED";
    default:
      return false;
  }
}

export function isSensitiveMemoryClass(memoryClass: MemoryClass): boolean {
  return (
    memoryClass === "USER_DURABLE" ||
    memoryClass === "ORG_SHARED_TRUSTED" ||
    memoryClass === "AUDIT_ACTION_HISTORY"
  );
}

export function assertWriteCompatibility(input: MemoryWriteRequest): void {
  const parsed = memoryWriteRequestSchema.parse(input);
  const scoped = parseTenantWorkspaceNamespace(parsed.namespace);
  if (!scoped) {
    throw new Error(`Namespace ${parsed.namespace} must include tenant/workspace prefix`);
  }
  if (scoped.tenantId !== parsed.tenantId || scoped.workspaceId !== parsed.workspaceId) {
    throw new Error(
      `Namespace ${parsed.namespace} tenant/workspace mismatch for ${parsed.tenantId}/${parsed.workspaceId}`
    );
  }
  if (!isNamespaceCompatible(parsed.memoryClass, parsed.namespace)) {
    throw new Error(
      `Namespace ${parsed.namespace} is not compatible with memory class ${parsed.memoryClass}`
    );
  }
  if (!isTrustAllowedForClass(parsed.memoryClass, parsed.trustClassification)) {
    throw new Error(
      `Trust class ${parsed.trustClassification} is not allowed for memory class ${parsed.memoryClass}`
    );
  }
}

export function assertPromotionCompatibility(input: {
  source: MemoryRecord;
  targetClass: MemoryClass;
  targetNamespace: string;
}): void {
  const scoped = parseTenantWorkspaceNamespace(input.targetNamespace);
  if (!scoped) {
    throw new Error(`Target namespace ${input.targetNamespace} must include tenant/workspace prefix`);
  }
  if (scoped.tenantId !== input.source.tenantId || scoped.workspaceId !== input.source.workspaceId) {
    throw new Error("Promotion cannot cross tenant/workspace boundaries");
  }
  if (!isNamespaceCompatible(input.targetClass, input.targetNamespace)) {
    throw new Error(`Target namespace ${input.targetNamespace} is not compatible with ${input.targetClass}`);
  }
  if (!isTrustAllowedForClass(input.targetClass, input.source.trustClassification)) {
    throw new Error(
      `Source trust class ${input.source.trustClassification} cannot be promoted to ${input.targetClass}`
    );
  }
  if (
    input.source.memoryClass === "UNTRUSTED_EXTERNAL" &&
    (input.targetClass === "USER_DURABLE" || input.targetClass === "ORG_SHARED_TRUSTED")
  ) {
    throw new Error("Untrusted external records require explicit review before promotion");
  }
}

export interface MemoryClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  getAuthToken?: () => Promise<string> | string;
}

async function fetchJson(input: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number | undefined;
  getAuthToken?: (() => Promise<string> | string) | undefined;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 5000);
  try {
    const authToken = input.getAuthToken ? await input.getAuthToken() : undefined;
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}${input.path}`, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Memory request failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export class HttpMemoryClient {
  constructor(private readonly options: MemoryClientOptions) {}

  async createRecord(request: MemoryWriteRequest): Promise<{ record: MemoryRecord }> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/records",
      method: "POST",
      body: memoryWriteRequestSchema.parse(request),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return body as { record: MemoryRecord };
  }

  async queryRecords(request: MemoryQueryRequest): Promise<MemoryQueryResponse> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/query",
      method: "POST",
      body: memoryQueryRequestSchema.parse(request),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return memoryQueryResponseSchema.parse(body);
  }

  async getRecord(recordId: string): Promise<{ record: MemoryRecord }> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: `/memory/records/${encodeURIComponent(recordId)}`,
      method: "GET",
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return body as { record: MemoryRecord };
  }

  async createPromotionCandidate(request: MemoryPromotionCandidateRequest): Promise<{ review: MemoryPromotionReview }> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/promotions/candidates",
      method: "POST",
      body: memoryPromotionCandidateRequestSchema.parse(request),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return body as { review: MemoryPromotionReview };
  }

  async reviewPromotion(request: MemoryPromotionReview): Promise<{ review: MemoryPromotionReview; promotedRecord?: MemoryRecord }> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/promotions/review",
      method: "POST",
      body: memoryPromotionReviewSchema.parse(request),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return body as { review: MemoryPromotionReview; promotedRecord?: MemoryRecord };
  }

  async getContextCandidates(
    request: MemoryContextCandidatesRequest
  ): Promise<MemoryContextCandidatesResponse> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/context-candidates",
      method: "POST",
      body: memoryContextCandidatesRequestSchema.parse(request),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    return memoryContextCandidatesResponseSchema.parse(body);
  }

  async listClasses(): Promise<{ classes: MemoryClass[] }> {
    const body = await fetchJson({
      baseUrl: this.options.baseUrl,
      path: "/memory/classes",
      method: "GET",
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.getAuthToken ? { getAuthToken: this.options.getAuthToken } : {})
    });
    const parsed = body as { classes: string[] };
    return {
      classes: parsed.classes.map((item) => memoryClassSchema.parse(item))
    };
  }
}
