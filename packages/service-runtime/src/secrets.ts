export interface SecretProvider {
  readonly name: string;
  getSecret(secretName: string): Promise<string | undefined>;
}

export class MissingSecretError extends Error {
  constructor(secretName: string) {
    super(`Required secret "${secretName}" is missing`);
    this.name = "MissingSecretError";
  }
}

export class EnvSecretProvider implements SecretProvider {
  readonly name = "env";
  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async getSecret(secretName: string): Promise<string | undefined> {
    const value = this.env[secretName];
    return value && value.length > 0 ? value : undefined;
  }
}

export class StubExternalSecretProvider implements SecretProvider {
  readonly name = "external-stub";
  async getSecret(_secretName: string): Promise<string | undefined> {
    return undefined;
  }
}

export function createSecretProvider(env: NodeJS.ProcessEnv): SecretProvider {
  const provider = env.SECRET_PROVIDER ?? "env";
  switch (provider) {
    case "env":
      return new EnvSecretProvider(env);
    case "external-stub":
      return new StubExternalSecretProvider();
    default:
      throw new Error(
        `Unsupported SECRET_PROVIDER="${provider}". Supported values: env, external-stub.`
      );
  }
}

export interface SecretAccessor {
  require(secretName: string): Promise<string>;
  optional(secretName: string): Promise<string | undefined>;
}

export function createSecretAccessor(provider: SecretProvider): SecretAccessor {
  return {
    async require(secretName: string): Promise<string> {
      const value = await provider.getSecret(secretName);
      if (!value) {
        throw new MissingSecretError(secretName);
      }
      return value;
    },
    optional(secretName: string): Promise<string | undefined> {
      return provider.getSecret(secretName);
    }
  };
}
