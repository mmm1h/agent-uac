import { UnifiedMcpServer } from "./types.js";

export interface SecretResolveOptions {
  allowMissingEnv?: boolean;
}

function resolveStringRef(input: string, context: string, options: SecretResolveOptions): string {
  if (!input.startsWith("env://")) {
    return input;
  }

  const key = input.slice("env://".length).trim();
  if (!key) {
    throw new Error(`Invalid empty env reference at ${context}.`);
  }

  const value = process.env[key];
  if (typeof value !== "string") {
    if (options.allowMissingEnv) {
      return input;
    }
    throw new Error(`Missing environment variable "${key}" referenced at ${context}.`);
  }
  return value;
}

function resolveValue(value: unknown, context: string, options: SecretResolveOptions): unknown {
  if (typeof value === "string") {
    return resolveStringRef(value, context, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveValue(entry, `${context}[${index}]`, options));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveValue(entry, `${context}.${key}`, options);
    }
    return result;
  }
  return value;
}

export function resolveServerSecrets(
  serverId: string,
  server: UnifiedMcpServer,
  options: SecretResolveOptions = {}
): UnifiedMcpServer {
  return resolveValue(server, `mcp.servers.${serverId}`, options) as UnifiedMcpServer;
}
