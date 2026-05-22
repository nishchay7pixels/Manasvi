import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GoogleTokenRecord {
  id: string;
  account?: string;
  provider: "google";
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  tokenType?: string;
  expiryDate?: string;
  grantedScopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SafeGoogleTokenStatus {
  id: string;
  account?: string;
  provider: "google";
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  tokenType?: string;
  expiryDate?: string;
  grantedScopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GoogleTokenStore {
  save(record: GoogleTokenRecord): Promise<GoogleTokenRecord>;
  getByAccount(account: string): Promise<GoogleTokenRecord | null>;
  getDefault(): Promise<GoogleTokenRecord | null>;
  update(record: GoogleTokenRecord): Promise<GoogleTokenRecord>;
  delete(recordId: string): Promise<void>;
}

interface TokenCollection {
  version: "1";
  records: GoogleTokenRecord[];
}

export interface LocalGoogleTokenStoreOptions {
  filePath?: string;
  encryptionKey?: string;
}

export function defaultGoogleTokenStorePath(): string {
  return join(process.env.MANASVI_HOME ?? join(homedir(), ".manasvi"), "secrets", "google", "tokens.json");
}

export function redactToken(token: string): string {
  if (token.length <= 8) return "<redacted>";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function redactGoogleTokenRecord(record: GoogleTokenRecord): SafeGoogleTokenStatus {
  return {
    id: record.id,
    ...(record.account ? { account: record.account } : {}),
    provider: "google",
    hasAccessToken: Boolean(record.accessTokenEncrypted),
    hasRefreshToken: Boolean(record.refreshTokenEncrypted),
    ...(record.tokenType ? { tokenType: record.tokenType } : {}),
    ...(record.expiryDate ? { expiryDate: record.expiryDate } : {}),
    grantedScopes: [...record.grantedScopes],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptGoogleToken(plaintext: string, encryptionKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `g3.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptGoogleToken(encrypted: string, encryptionKey: string): string {
  const [prefix, iv, payload, tag] = encrypted.split(".");
  if (prefix !== "g3" || !iv || !payload || !tag) {
    throw new Error("Malformed encrypted Google token.");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(encryptionKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

export async function ensureGoogleTokenEncryptionKey(keyPath?: string): Promise<string> {
  if (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) return process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const path = keyPath ?? join(process.env.MANASVI_HOME ?? join(homedir(), ".manasvi"), "secrets", "google", "token-store.key");
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    const key = randomBytes(32).toString("base64url");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, key, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
    return key;
  }
}

export function createGoogleTokenRecord(input: {
  account?: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiryDate?: string;
  grantedScopes: string[];
  encryptionKey: string;
  id?: string;
}): GoogleTokenRecord {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `google-token:${randomUUID()}`,
    ...(input.account ? { account: input.account } : {}),
    provider: "google",
    accessTokenEncrypted: encryptGoogleToken(input.accessToken, input.encryptionKey),
    ...(input.refreshToken ? { refreshTokenEncrypted: encryptGoogleToken(input.refreshToken, input.encryptionKey) } : {}),
    ...(input.tokenType ? { tokenType: input.tokenType } : {}),
    ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
    grantedScopes: [...new Set(input.grantedScopes)],
    createdAt: now,
    updatedAt: now
  };
}

export class LocalEncryptedGoogleTokenStore implements GoogleTokenStore {
  readonly filePath: string;

  constructor(private readonly options: LocalGoogleTokenStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultGoogleTokenStorePath();
  }

  async save(record: GoogleTokenRecord): Promise<GoogleTokenRecord> {
    const collection = await this.load();
    const idx = collection.records.findIndex((item) => item.id === record.id || (record.account && item.account === record.account));
    const next = { ...record, updatedAt: new Date().toISOString() };
    if (idx >= 0) collection.records[idx] = { ...collection.records[idx]!, ...next };
    else collection.records.push(next);
    await this.persist(collection);
    return next;
  }

  async getByAccount(account: string): Promise<GoogleTokenRecord | null> {
    return (await this.load()).records.find((record) => record.account === account) ?? null;
  }

  async getDefault(): Promise<GoogleTokenRecord | null> {
    return (await this.load()).records[0] ?? null;
  }

  async update(record: GoogleTokenRecord): Promise<GoogleTokenRecord> {
    return this.save(record);
  }

  async delete(recordId: string): Promise<void> {
    const collection = await this.load();
    collection.records = collection.records.filter((record) => record.id !== recordId);
    await this.persist(collection);
  }

  async decryptAccessToken(record: GoogleTokenRecord): Promise<string | null> {
    if (!record.accessTokenEncrypted) return null;
    return decryptGoogleToken(record.accessTokenEncrypted, await this.encryptionKey());
  }

  async decryptRefreshToken(record: GoogleTokenRecord): Promise<string | null> {
    if (!record.refreshTokenEncrypted) return null;
    return decryptGoogleToken(record.refreshTokenEncrypted, await this.encryptionKey());
  }

  async encryptToken(token: string): Promise<string> {
    return encryptGoogleToken(token, await this.encryptionKey());
  }

  private async encryptionKey(): Promise<string> {
    return this.options.encryptionKey ?? ensureGoogleTokenEncryptionKey();
  }

  private async load(): Promise<TokenCollection> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as TokenCollection;
      return parsed.version === "1" && Array.isArray(parsed.records) ? parsed : { version: "1", records: [] };
    } catch {
      return { version: "1", records: [] };
    }
  }

  private async persist(collection: TokenCollection): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(collection, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}
