import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";

import {
  principalClaimsSchema,
  principalRecordSchema,
  principalReferenceSchema,
  principalStatusSchema,
  resolvedPrincipalContextSchema,
  serviceNameSchema,
  tokenClaimsVersion,
  type PrincipalClaims,
  type PrincipalRecord,
  type PrincipalReference,
  type PrincipalStatus,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";

const JWT_HEADER = {
  alg: "HS256",
  typ: "JWT"
} as const;

const tokenEnvelopeSchema = z.object({
  header: z.object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT"),
    kid: z.string().min(1)
  }),
  claims: principalClaimsSchema
});

export interface InternalTokenIssuerConfig {
  issuer: string;
  audience: string;
  keyId: string;
  secret: string;
  ttlSeconds: number;
}

export interface InternalTokenVerifierConfig {
  issuer: string;
  audience: string;
  allowedClockSkewSeconds?: number;
  secretsByKeyId: Record<string, string>;
}

export interface IssueInternalTokenInput {
  caller: PrincipalReference;
  actor?: PrincipalReference;
  subject?: PrincipalReference;
  origin?: PrincipalReference;
  sessionOwner?: PrincipalReference;
  tenantId?: string;
  workspaceId?: string;
  scopes?: string[];
  ttlSeconds?: number;
}

export type VerifyTokenResult =
  | {
      ok: true;
      claims: PrincipalClaims;
    }
  | {
      ok: false;
      error:
        | "TOKEN_MISSING"
        | "TOKEN_MALFORMED"
        | "TOKEN_SIGNATURE_INVALID"
        | "TOKEN_EXPIRED"
        | "TOKEN_NOT_YET_VALID"
        | "TOKEN_ISSUER_INVALID"
        | "TOKEN_AUDIENCE_INVALID"
        | "TOKEN_SCHEMA_INVALID"
        | "TOKEN_KEY_UNKNOWN";
    };

export class InternalTokenService {
  constructor(
    private readonly issuerConfig: InternalTokenIssuerConfig,
    private readonly verifierConfig: InternalTokenVerifierConfig
  ) {}

  issueToken(input: IssueInternalTokenInput): string {
    const now = Math.floor(Date.now() / 1000);
    const ttl = input.ttlSeconds ?? this.issuerConfig.ttlSeconds;
    const claims = principalClaimsSchema.parse({
      version: tokenClaimsVersion,
      issuer: this.issuerConfig.issuer,
      audience: this.issuerConfig.audience,
      issuedAt: now,
      expiresAt: now + ttl,
      tokenId: randomUUID(),
      scopes: input.scopes ?? [],
      caller: input.caller,
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.sessionOwner ? { sessionOwner: input.sessionOwner } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      authnStrength: "strong"
    });
    return signJwt(
      { ...JWT_HEADER, kid: this.issuerConfig.keyId },
      claims,
      this.issuerConfig.secret
    );
  }

  verifyToken(rawToken: string | undefined): VerifyTokenResult {
    if (!rawToken) {
      return { ok: false, error: "TOKEN_MISSING" };
    }
    const parsed = parseJwt(rawToken);
    if (!parsed) {
      return { ok: false, error: "TOKEN_MALFORMED" };
    }
    const { header, claims, signatureInput, signature } = parsed;
    const secret = this.verifierConfig.secretsByKeyId[header.kid];
    if (!secret) {
      return { ok: false, error: "TOKEN_KEY_UNKNOWN" };
    }
    const expected = createHmac("sha256", secret).update(signatureInput).digest();
    if (!safeCompare(signature, expected)) {
      return { ok: false, error: "TOKEN_SIGNATURE_INVALID" };
    }
    const envelopeParse = tokenEnvelopeSchema.safeParse({
      header,
      claims
    });
    if (!envelopeParse.success) {
      return { ok: false, error: "TOKEN_SCHEMA_INVALID" };
    }
    if (claims.issuer !== this.verifierConfig.issuer) {
      return { ok: false, error: "TOKEN_ISSUER_INVALID" };
    }
    if (claims.audience !== this.verifierConfig.audience) {
      return { ok: false, error: "TOKEN_AUDIENCE_INVALID" };
    }
    const now = Math.floor(Date.now() / 1000);
    const skew = this.verifierConfig.allowedClockSkewSeconds ?? 5;
    if (claims.expiresAt + skew < now) {
      return { ok: false, error: "TOKEN_EXPIRED" };
    }
    if (claims.issuedAt - skew > now) {
      return { ok: false, error: "TOKEN_NOT_YET_VALID" };
    }
    return { ok: true, claims };
  }
}

export interface PrincipalRegistryListFilter {
  principalType?: PrincipalRecord["principalType"];
  tenantId?: string;
  workspaceId?: string;
  status?: PrincipalStatus;
}

export interface RegisterPrincipalInput {
  principalId: string;
  principalType: PrincipalRecord["principalType"];
  displayName?: string;
  tenantId?: string;
  workspaceId?: string;
  provenance: PrincipalRecord["provenance"];
  externalIdentifiers?: PrincipalRecord["externalIdentifiers"];
  attributes?: PrincipalRecord["attributes"];
  service?: PrincipalRecord["service"];
  executionNode?: PrincipalRecord["executionNode"];
  status?: PrincipalStatus;
}

export interface PrincipalRegistry {
  registerPrincipal(input: RegisterPrincipalInput): Promise<PrincipalRecord>;
  getPrincipalById(principalId: string): Promise<PrincipalRecord | undefined>;
  getPrincipalByExternalIdentifier(input: {
    provider: string;
    type: string;
    value: string;
  }): Promise<PrincipalRecord | undefined>;
  listPrincipals(filter?: PrincipalRegistryListFilter): Promise<PrincipalRecord[]>;
  setPrincipalStatus(principalId: string, status: PrincipalStatus): Promise<PrincipalRecord>;
}

type RegistryBackingStore = {
  principals: PrincipalRecord[];
};

export class InMemoryPrincipalRegistry implements PrincipalRegistry {
  private readonly store: RegistryBackingStore = { principals: [] };

  async registerPrincipal(input: RegisterPrincipalInput): Promise<PrincipalRecord> {
    const now = new Date().toISOString();
    const principal = principalRecordSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      principalId: input.principalId,
      principalType: input.principalType,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      status: input.status ?? "active",
      provenance: input.provenance,
      externalIdentifiers: input.externalIdentifiers ?? [],
      attributes: input.attributes ?? {},
      ...(input.service ? { service: input.service } : {}),
      ...(input.executionNode ? { executionNode: input.executionNode } : {}),
      createdAt: now,
      updatedAt: now
    });
    const existingIndex = this.store.principals.findIndex((p) => p.principalId === input.principalId);
    if (existingIndex >= 0) {
      this.store.principals[existingIndex] = {
        ...principal,
        createdAt: this.store.principals[existingIndex]!.createdAt,
        updatedAt: now
      };
      return this.store.principals[existingIndex]!;
    }
    this.store.principals.push(principal);
    return principal;
  }

  async getPrincipalById(principalId: string): Promise<PrincipalRecord | undefined> {
    return this.store.principals.find((principal) => principal.principalId === principalId);
  }

  async getPrincipalByExternalIdentifier(input: {
    provider: string;
    type: string;
    value: string;
  }): Promise<PrincipalRecord | undefined> {
    return this.store.principals.find((principal) =>
      principal.externalIdentifiers.some(
        (identifier) =>
          identifier.provider === input.provider &&
          identifier.type === input.type &&
          identifier.value === input.value
      )
    );
  }

  async listPrincipals(filter?: PrincipalRegistryListFilter): Promise<PrincipalRecord[]> {
    return this.store.principals.filter((principal) => {
      if (filter?.principalType && principal.principalType !== filter.principalType) {
        return false;
      }
      if (filter?.tenantId && principal.tenantId !== filter.tenantId) {
        return false;
      }
      if (filter?.workspaceId && principal.workspaceId !== filter.workspaceId) {
        return false;
      }
      if (filter?.status && principal.status !== filter.status) {
        return false;
      }
      return true;
    });
  }

  async setPrincipalStatus(principalId: string, status: PrincipalStatus): Promise<PrincipalRecord> {
    principalStatusSchema.parse(status);
    const existing = this.store.principals.find((principal) => principal.principalId === principalId);
    if (!existing) {
      throw new Error(`Principal ${principalId} not found`);
    }
    const updated = principalRecordSchema.parse({
      ...existing,
      status,
      updatedAt: new Date().toISOString()
    });
    const index = this.store.principals.findIndex((principal) => principal.principalId === principalId);
    this.store.principals[index] = updated;
    return updated;
  }
}

export class JsonFilePrincipalRegistry implements PrincipalRegistry {
  private readonly memory = new InMemoryPrincipalRegistry();
  private init: Promise<void> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.init) {
      await this.init;
      return;
    }
    this.init = (async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
        const raw = await readFile(this.filePath, "utf8");
        const parsed = z
          .object({
            principals: z.array(principalRecordSchema)
          })
          .parse(JSON.parse(raw));
        for (const principal of parsed.principals) {
          await this.memory.registerPrincipal({
            principalId: principal.principalId,
            principalType: principal.principalType,
            provenance: principal.provenance,
            externalIdentifiers: principal.externalIdentifiers,
            attributes: principal.attributes,
            ...(principal.displayName ? { displayName: principal.displayName } : {}),
            ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
            ...(principal.workspaceId ? { workspaceId: principal.workspaceId } : {}),
            ...(principal.service ? { service: principal.service } : {}),
            ...(principal.executionNode ? { executionNode: principal.executionNode } : {}),
            status: principal.status
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await this.flush();
          return;
        }
        throw error;
      }
    })();
    await this.init;
  }

  private async flush(): Promise<void> {
    const principals = await this.memory.listPrincipals();
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(this.filePath, JSON.stringify({ principals }, null, 2), "utf8");
    });
    await this.writeQueue;
  }

  async registerPrincipal(input: RegisterPrincipalInput): Promise<PrincipalRecord> {
    await this.ensureLoaded();
    const result = await this.memory.registerPrincipal(input);
    await this.flush();
    return result;
  }

  async getPrincipalById(principalId: string): Promise<PrincipalRecord | undefined> {
    await this.ensureLoaded();
    return this.memory.getPrincipalById(principalId);
  }

  async getPrincipalByExternalIdentifier(input: {
    provider: string;
    type: string;
    value: string;
  }): Promise<PrincipalRecord | undefined> {
    await this.ensureLoaded();
    return this.memory.getPrincipalByExternalIdentifier(input);
  }

  async listPrincipals(filter?: PrincipalRegistryListFilter): Promise<PrincipalRecord[]> {
    await this.ensureLoaded();
    return this.memory.listPrincipals(filter);
  }

  async setPrincipalStatus(principalId: string, status: PrincipalStatus): Promise<PrincipalRecord> {
    await this.ensureLoaded();
    const updated = await this.memory.setPrincipalStatus(principalId, status);
    await this.flush();
    return updated;
  }
}

export function parseBearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) {
    return undefined;
  }
  return value.slice("Bearer ".length).trim();
}

export interface PrincipalResolutionOptions {
  requireAuthentication: boolean;
  allowActorOverride?: boolean;
}

export interface PrincipalResolutionResult {
  ok: boolean;
  statusCode?: 401 | 403;
  errorCode?:
    | "AUTHENTICATION_REQUIRED"
    | "TOKEN_INVALID"
    | "ACTOR_OVERRIDE_NOT_ALLOWED"
    | "ACTOR_OVERRIDE_INVALID";
  context?: ResolvedPrincipalContext;
}

export class PrincipalResolver {
  constructor(private readonly tokenService: InternalTokenService) {}

  resolveFromHttpHeaders(
    headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
    options: PrincipalResolutionOptions
  ): PrincipalResolutionResult {
    const normalized: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key] = value;
    }

    const token = parseBearerToken(normalized);
    const verification = this.tokenService.verifyToken(token);

    if (!verification.ok) {
      if (!options.requireAuthentication && verification.error === "TOKEN_MISSING") {
        const anonymous = resolvedPrincipalContextSchema.parse({
          caller: { principalType: "anonymous_external", principalId: "anonymous:edge" },
          actor: { principalType: "anonymous_external", principalId: "anonymous:edge" },
          authenticated: false,
          authnStrength: "none",
          scopes: []
        });
        return { ok: true, context: anonymous };
      }
      return {
        ok: false,
        statusCode: 401,
        errorCode: verification.error === "TOKEN_MISSING" ? "AUTHENTICATION_REQUIRED" : "TOKEN_INVALID"
      };
    }

    const actorOverride = readHeader(normalized, "x-manasvi-actor");
    let actor = verification.claims.actor ?? verification.claims.caller;
    if (actorOverride) {
      if (!options.allowActorOverride || !verification.claims.scopes.includes("actor:override")) {
        return {
          ok: false,
          statusCode: 403,
          errorCode: "ACTOR_OVERRIDE_NOT_ALLOWED"
        };
      }
      const parsed = parsePrincipalReferenceHeader(actorOverride);
      if (!parsed) {
        return {
          ok: false,
          statusCode: 403,
          errorCode: "ACTOR_OVERRIDE_INVALID"
        };
      }
      actor = parsed;
    }

    const servicePrincipal =
      verification.claims.caller.principalType === "service" ? verification.claims.caller : undefined;

    const context = resolvedPrincipalContextSchema.parse({
      caller: verification.claims.caller,
      actor,
      ...(verification.claims.subject ? { subject: verification.claims.subject } : {}),
      ...(verification.claims.origin ? { origin: verification.claims.origin } : {}),
      ...(servicePrincipal ? { service: servicePrincipal } : {}),
      ...(verification.claims.sessionOwner ? { sessionOwner: verification.claims.sessionOwner } : {}),
      ...(verification.claims.tenantId ? { tenantId: verification.claims.tenantId } : {}),
      ...(verification.claims.workspaceId ? { workspaceId: verification.claims.workspaceId } : {}),
      scopes: verification.claims.scopes,
      authnStrength: verification.claims.authnStrength,
      tokenId: verification.claims.tokenId,
      authenticated: true
    });
    return { ok: true, context };
  }
}

export function resolvePrincipalContextFromEvent(input: {
  event: {
    actor: PrincipalReference;
    channel: PrincipalReference;
    source: {
      sourceType: "channel" | "api" | "service" | "plugin" | "node";
      sourceId: string;
      sourceService?: string | undefined;
    };
    tenantId: string;
    workspaceId: string;
  };
  caller?: PrincipalReference;
}): ResolvedPrincipalContext {
  const caller =
    input.caller ??
    (input.event.source.sourceType === "service"
      ? ({
          principalId: `service:${input.event.source.sourceService ?? input.event.source.sourceId}`,
          principalType: "service"
        } as const)
      : input.event.channel);

  return resolvedPrincipalContextSchema.parse({
    caller,
    actor: input.event.actor,
    origin: input.event.channel,
    tenantId: input.event.tenantId,
    workspaceId: input.event.workspaceId,
    authnStrength: input.event.source.sourceType === "service" ? "strong" : "weak",
    authenticated: input.event.source.sourceType === "service",
    scopes: []
  });
}

export function buildServicePrincipalReference(serviceName: string): PrincipalReference {
  return principalReferenceSchema.parse({
    principalType: "service",
    principalId: `service:${serviceName}`,
    displayName: serviceName
  });
}

export function buildExecutionNodePrincipalReference(nodeId: string): PrincipalReference {
  return principalReferenceSchema.parse({
    principalType: "execution_node",
    principalId: `node:${nodeId}`,
    displayName: nodeId
  });
}

export async function bootstrapServicePrincipal(
  registry: PrincipalRegistry,
  input: {
    serviceName: string;
    environment: "local" | "dev" | "test" | "staging" | "production";
    instanceId: string;
  }
): Promise<PrincipalRecord> {
  return registry.registerPrincipal({
    principalId: `service:${input.serviceName}`,
    principalType: "service",
    displayName: input.serviceName,
    provenance: {
      source: "bootstrap"
    },
    service: {
      serviceName: serviceNameSchema.parse(input.serviceName),
      instanceId: input.instanceId,
      environment: input.environment,
      registeredAt: new Date().toISOString()
    },
    attributes: {
      plane: "control"
    }
  });
}

function signJwt(header: Record<string, unknown>, claims: PrincipalClaims, secret: string): string {
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedClaims = base64urlEncode(JSON.stringify(claims));
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", secret).update(input).digest();
  return `${input}.${base64urlEncode(signature)}`;
}

function parseJwt(token: string): {
  header: { alg: "HS256"; typ: "JWT"; kid: string };
  claims: PrincipalClaims;
  signatureInput: string;
  signature: Buffer;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const encodedHeader = parts[0];
  const encodedClaims = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedClaims || !encodedSignature) {
    return null;
  }
  const headerRaw = base64urlDecodeToString(encodedHeader);
  const claimsRaw = base64urlDecodeToString(encodedClaims);
  if (!headerRaw || !claimsRaw) {
    return null;
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(headerRaw);
    claims = JSON.parse(claimsRaw);
  } catch {
    return null;
  }
  const headerParsed = z
    .object({
      alg: z.literal("HS256"),
      typ: z.literal("JWT"),
      kid: z.string().min(1)
    })
    .safeParse(header);
  const claimsParsed = principalClaimsSchema.safeParse(claims);
  if (!headerParsed.success || !claimsParsed.success) {
    return null;
  }
  const signature = base64urlDecodeToBuffer(encodedSignature);
  if (!signature) {
    return null;
  }
  return {
    header: headerParsed.data,
    claims: claimsParsed.data,
    signatureInput: `${encodedHeader}.${encodedClaims}`,
    signature
  };
}

function parsePrincipalReferenceHeader(raw: string): PrincipalReference | undefined {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return undefined;
  }
  const type = raw.slice(0, separatorIndex);
  const id = raw.slice(separatorIndex + 1);
  const parsed = principalReferenceSchema.safeParse({
    principalType: type,
    principalId: id
  });
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function base64urlEncode(value: string | Buffer): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer.toString("base64url");
}

function base64urlDecodeToBuffer(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function base64urlDecodeToString(value: string): string | null {
  const buffer = base64urlDecodeToBuffer(value);
  if (!buffer) {
    return null;
  }
  return buffer.toString("utf8");
}

function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
