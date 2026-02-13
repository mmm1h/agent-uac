import { AGENTS, UnifiedConfig, UnifiedMcpServer } from "../types.js";

interface McpRouterServerRaw {
  transport?: unknown;
  type?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
}

interface McpRouterDocumentRaw {
  mcpServers?: unknown;
}

export interface ImportResult {
  config: UnifiedConfig;
  importedServerIds: string[];
  skippedServerIds: string[];
  warnings: string[];
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function importFromMcpRouterJson(input: unknown): ImportResult {
  const raw = input as McpRouterDocumentRaw;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON document.");
  }

  if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) {
    throw new Error('Invalid mcp-router JSON: missing object field "mcpServers".');
  }

  const warnings: string[] = [];
  const servers: Record<string, UnifiedMcpServer> = {};
  const importedServerIds: string[] = [];
  const skippedServerIds: string[] = [];

  for (const [serverId, entry] of Object.entries(raw.mcpServers as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skippedServerIds.push(serverId);
      warnings.push(`Skipped "${serverId}": server entry is not an object.`);
      continue;
    }

    const item = entry as McpRouterServerRaw;
    const url = toNonEmptyString(item.url);
    const command = toNonEmptyString(item.command);
    const args = toStringArray(item.args);
    const env = toStringRecord(item.env);
    const headers = toStringRecord(item.headers);
    const transportRaw = toNonEmptyString(item.transport) || toNonEmptyString(item.type);

    if (url) {
      const transport = (transportRaw === "http") ? "http" : "sse";
      servers[serverId] = {
        transport,
        url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        enabledIn: {
          codex: true,
          gemini: true,
          claude: true
        }
      };
      importedServerIds.push(serverId);
      continue;
    }

    if (!command) {
      skippedServerIds.push(serverId);
      warnings.push(`Skipped "${serverId}": missing usable "command" and "url".`);
      continue;
    }

    servers[serverId] = {
      transport: "stdio",
      command,
      args: args.length > 0 ? args : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      enabledIn: {
        codex: true,
        gemini: true,
        claude: true
      }
    };
    importedServerIds.push(serverId);
  }

  if (importedServerIds.length === 0) {
    throw new Error("No valid MCP servers were imported.");
  }

  importedServerIds.sort();
  skippedServerIds.sort();

  const targets: UnifiedConfig["targets"] = {};
  for (const agent of AGENTS) {
    targets[agent] = {
      enabled: true,
      allow: [...importedServerIds]
    };
  }

  const config: UnifiedConfig = {
    version: "1",
    mcp: {
      servers
    },
    targets
  };

  return {
    config,
    importedServerIds,
    skippedServerIds,
    warnings
  };
}
