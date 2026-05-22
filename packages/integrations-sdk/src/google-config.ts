import type { GoogleBackend, GoogleService } from "./google-capabilities.js";
import { GOOGLE_SERVICES } from "./google-capabilities.js";

export type GoogleIntegrationMode = "gog" | "native" | "mixed";

export interface GoogleServiceConfig {
  enabled: boolean;
  backend?: GoogleBackend;
  read?: boolean;
  write?: boolean;
  readOnly?: boolean;
}

export interface GogGoogleBackendConfig {
  binaryPath?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export interface NativeGoogleBackendConfig {
  clientIdEnv?: string;
  clientSecretEnv?: string;
  redirectUri?: string;
  tokenStore?: {
    type: "local_encrypted" | "local_restricted" | "external";
    path?: string;
  };
  stateStorePath?: string;
  tokenEncryptionKeyEnv?: string;
}

export interface GoogleIntegrationConfig {
  enabled: boolean;
  mode: GoogleIntegrationMode;
  defaultBackend: GoogleBackend;
  account?: string;
  services: Partial<Record<GoogleService, GoogleServiceConfig>>;
  backends?: {
    gog?: GogGoogleBackendConfig;
    native?: NativeGoogleBackendConfig;
  };
}

export const defaultGoogleIntegrationConfig: GoogleIntegrationConfig = {
  enabled: false,
  mode: "native",
  defaultBackend: "native",
  backends: {
    gog: {
      binaryPath: "gog",
      timeoutMs: 10000,
      maxStdoutBytes: 1048576,
      maxStderrBytes: 131072
    },
    native: {
      clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
      clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
      redirectUri: "http://localhost:4100/integrations/google/oauth/callback",
      tokenEncryptionKeyEnv: "GOOGLE_TOKEN_ENCRYPTION_KEY",
      tokenStore: {
        type: "local_encrypted"
      }
    }
  },
  services: {
    gmail: { enabled: false, backend: "native", read: false, write: false },
    calendar: { enabled: false, backend: "native", read: false, write: false },
    drive: { enabled: false, backend: "native", read: false, write: false },
    docs: { enabled: false, backend: "native", read: false, write: false },
    sheets: { enabled: false, backend: "native", read: false, write: false },
    contacts: { enabled: false, backend: "native", read: false, write: false }
  }
};

export function defaultBackendForGoogleMode(mode: GoogleIntegrationMode): GoogleBackend {
  return mode === "gog" ? "gog" : "native";
}

export function normalizeGoogleIntegrationConfig(
  input?: Partial<GoogleIntegrationConfig> | null
): GoogleIntegrationConfig {
  const mode = input?.mode ?? defaultGoogleIntegrationConfig.mode;
  const defaultBackend = input?.defaultBackend ?? defaultBackendForGoogleMode(mode);
  const services: Partial<Record<GoogleService, GoogleServiceConfig>> = {};

  for (const service of GOOGLE_SERVICES) {
    const existing = input?.services?.[service];
    services[service] = {
      enabled: existing?.enabled ?? defaultGoogleIntegrationConfig.services[service]?.enabled ?? false,
      backend: existing?.backend ?? defaultBackend,
      read: existing?.read ?? defaultGoogleIntegrationConfig.services[service]?.read ?? false,
      write: existing?.write ?? defaultGoogleIntegrationConfig.services[service]?.write ?? false,
      ...(typeof existing?.readOnly === "boolean" ? { readOnly: existing.readOnly } : {})
    };
  }

  return {
    enabled: input?.enabled ?? defaultGoogleIntegrationConfig.enabled,
    mode,
    defaultBackend,
    ...(input?.account ? { account: input.account } : {}),
    backends: {
      gog: {
        ...defaultGoogleIntegrationConfig.backends?.gog,
        ...(input?.backends?.gog ?? {})
      },
      native: {
        ...defaultGoogleIntegrationConfig.backends?.native,
        ...(input?.backends?.native ?? {}),
        tokenStore: {
          type: "local_encrypted",
          ...defaultGoogleIntegrationConfig.backends?.native?.tokenStore,
          ...(input?.backends?.native?.tokenStore ?? {})
        }
      }
    },
    services
  };
}

export function createGoogleIntegrationConfigForMode(mode: GoogleIntegrationMode): GoogleIntegrationConfig {
  return normalizeGoogleIntegrationConfig({
    enabled: true,
    mode,
    defaultBackend: defaultBackendForGoogleMode(mode),
    services: Object.fromEntries(
      GOOGLE_SERVICES.map((service) => [
        service,
        {
          enabled: false,
          backend: defaultBackendForGoogleMode(mode),
          read: false,
          write: false
        }
      ])
    ) as Partial<Record<GoogleService, GoogleServiceConfig>>
  });
}
