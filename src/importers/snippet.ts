import * as TOML from "@iarna/toml";
import {
  ImportEnvSuggestion,
  ImportFormat,
  ImportPreviewResult,
  ImportPreviewWarning,
  UnifiedMcpServer
} from "../types.js";

type JsonRecord = Record<string, unknown>;

const SUPPORTED_FIELDS = new Set([
  "transport",
  "type",
  "command",
  "args",
  "url",
  "env",
  "headers",
  "startup_timeout_sec",
  "enabledIn"
]);

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  const match = /^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  return match[1].trim();
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value.filter((item): item is string => typeof item === "string");
  return result.length > 0 ? result : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  return value;
}

function sanitizeEnvToken(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function makeEnvKey(serverId: string, key: string, used: Set<string>): string {
  const baseServer = sanitizeEnvToken(serverId) || "SERVER";
  const baseKey = sanitizeEnvToken(key) || "VALUE";
  let candidate = `UAC_${baseServer}_${baseKey}`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `UAC_${baseServer}_${baseKey}_${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function looksSensitive(key: string, value: string): boolean {
  const keySensitive = /(token|secret|password|authorization|api[_-]?key|cookie|session|credential|private)/i.test(key);
  const valueSensitive = /(sk-|ntn_|ghp_|xoxb-|bearer\s+|^eyJ[A-Za-z0-9_-]{10,})/i.test(value);
  return keySensitive || valueSensitive;
}

function convertSecrets(
  serverId: string,
  server: UnifiedMcpServer,
  used: Set<string>
): {
  server: UnifiedMcpServer;
  envSuggestions: ImportEnvSuggestion[];
  warnings: ImportPreviewWarning[];
} {
  const next: UnifiedMcpServer = structuredClone(server);
  const envSuggestions: ImportEnvSuggestion[] = [];
  const warnings: ImportPreviewWarning[] = [];

  function convertRecord(record: Record<string, string> | undefined, fieldName: "env" | "headers"): Record<string, string> | undefined {
    if (!record) {
      return record;
    }
    const replaced: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value.startsWith("env://")) {
        replaced[key] = value;
        continue;
      }
      if (!looksSensitive(key, value)) {
        replaced[key] = value;
        continue;
      }
      const envKey = makeEnvKey(serverId, key, used);
      const replacement = `env://${envKey}`;
      replaced[key] = replacement;
      envSuggestions.push({
        serverId,
        fieldPath: `${fieldName}.${key}`,
        envKey,
        replacement
      });
      warnings.push({
        code: "secret_converted",
        message: `已将 ${serverId}.${fieldName}.${key} 的明文值转换为 ${replacement}`
      });
    }
    return replaced;
  }

  next.env = convertRecord(next.env, "env");
  next.headers = convertRecord(next.headers, "headers");
  return { server: next, envSuggestions, warnings };
}

function normalizeServer(
  serverId: string,
  raw: unknown,
  warnings: ImportPreviewWarning[]
): UnifiedMcpServer | null {
  if (!isRecord(raw)) {
    warnings.push({
      code: "partial_invalid",
      message: `跳过 "${serverId}"：条目不是对象。`
    });
    return null;
  }

  for (const field of Object.keys(raw)) {
    if (!SUPPORTED_FIELDS.has(field)) {
      warnings.push({
        code: "unsupported_field",
        message: `服务 "${serverId}" 包含未处理字段 "${field}"，已忽略。`
      });
    }
  }

  const typeRaw = typeof raw.transport === "string" ? raw.transport : typeof raw.type === "string" ? raw.type : null;
  let transport: "stdio" | "sse" | "http";
  if (typeRaw === "stdio" || typeRaw === "sse" || typeRaw === "http") {
    transport = typeRaw;
  } else if (typeof raw.url === "string" && raw.url.trim() !== "") {
    transport = "sse";
  } else if (typeof raw.command === "string" && raw.command.trim() !== "") {
    transport = "stdio";
  } else {
    warnings.push({
      code: "partial_invalid",
      message: `跳过 "${serverId}"：无法识别 transport（缺少 command/url/type）。`
    });
    return null;
  }

  const normalized: UnifiedMcpServer = {
    transport,
    enabledIn: {
      codex: true,
      gemini: true,
      claude: true
    }
  };

  if (transport === "stdio") {
    if (typeof raw.command !== "string" || raw.command.trim() === "") {
      warnings.push({
        code: "partial_invalid",
        message: `跳过 "${serverId}"：stdio 模式缺少 command。`
      });
      return null;
    }
    normalized.command = raw.command.trim();
    normalized.args = toStringArray(raw.args);
    normalized.env = toStringRecord(raw.env);
    const timeout = toPositiveNumber(raw.startup_timeout_sec);
    if (timeout !== undefined) {
      normalized.startup_timeout_sec = timeout;
    }
  } else {
    if (typeof raw.url !== "string" || raw.url.trim() === "") {
      warnings.push({
        code: "partial_invalid",
        message: `跳过 "${serverId}"：${transport} 模式缺少 url。`
      });
      return null;
    }
    normalized.url = raw.url.trim();
    normalized.headers = toStringRecord(raw.headers);
  }

  return normalized;
}

function parseJsonOrThrow(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`JSON 解析失败: ${String(error)}`);
  }
}

function parseTomlOrThrow(input: string): unknown {
  try {
    return TOML.parse(input);
  } catch (error) {
    throw new Error(`TOML 解析失败: ${String(error)}`);
  }
}

function parseAsCodexToml(input: string, warnings: ImportPreviewWarning[]): Record<string, UnifiedMcpServer> {
  const parsed = parseTomlOrThrow(input);
  if (!isRecord(parsed) || !isRecord(parsed.mcp_servers)) {
    throw new Error('Codex TOML 片段缺少 "mcp_servers"。');
  }

  const servers: Record<string, UnifiedMcpServer> = {};
  for (const [serverId, raw] of Object.entries(parsed.mcp_servers)) {
    const normalized = normalizeServer(serverId, raw, warnings);
    if (normalized) {
      servers[serverId] = normalized;
    }
  }
  return servers;
}

function isServerLikeObject(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.command === "string" ||
    typeof value.url === "string" ||
    typeof value.type === "string" ||
    typeof value.transport === "string"
  );
}

function parseAsJsonFormats(
  input: string,
  format: ImportFormat,
  warnings: ImportPreviewWarning[]
): Record<string, UnifiedMcpServer> {
  const parsed = parseJsonOrThrow(input);
  if (!isRecord(parsed)) {
    throw new Error("JSON 顶层必须是对象。");
  }

  let rawServers: Record<string, unknown> | null = null;

  if (format === "mcp_router_json" || format === "gemini_json") {
    if (!isRecord(parsed.mcpServers)) {
      throw new Error('JSON 缺少对象字段 "mcpServers"。');
    }
    rawServers = parsed.mcpServers;
  } else if (format === "generic_mcp_json") {
    if (isRecord(parsed.mcpServers)) {
      rawServers = parsed.mcpServers;
    } else if (isServerLikeObject(parsed)) {
      const singleId =
        typeof parsed.id === "string"
          ? parsed.id.trim()
          : typeof parsed.name === "string"
            ? parsed.name.trim()
            : "imported-server";
      rawServers = { [singleId]: parsed };
    } else {
      const maybeMap = Object.entries(parsed).filter(([, value]) => isServerLikeObject(value));
      if (maybeMap.length > 0) {
        rawServers = Object.fromEntries(maybeMap);
      }
    }
  }

  if (!rawServers) {
    throw new Error("无法在 JSON 中识别 MCP 服务结构。");
  }

  const servers: Record<string, UnifiedMcpServer> = {};
  for (const [serverId, raw] of Object.entries(rawServers)) {
    const normalized = normalizeServer(serverId, raw, warnings);
    if (normalized) {
      servers[serverId] = normalized;
    }
  }
  return servers;
}

function detectFormatAuto(input: string): ImportFormat {
  const trimmed = input.trim();
  if (trimmed.startsWith("[")) {
    return "codex_toml";
  }

  const parsed = parseJsonOrThrow(trimmed);
  if (!isRecord(parsed)) {
    throw new Error("仅支持对象类型的 JSON/TOML 代码段。");
  }

  if (isRecord(parsed.mcpServers)) {
    const hasType = Object.values(parsed.mcpServers).some(
      (value) => isRecord(value) && typeof value.type === "string"
    );
    return hasType ? "gemini_json" : "mcp_router_json";
  }

  if (isServerLikeObject(parsed)) {
    return "generic_mcp_json";
  }

  const looksMap = Object.values(parsed).some((value) => isServerLikeObject(value));
  if (looksMap) {
    return "generic_mcp_json";
  }

  throw new Error("格式识别失败：未识别到 mcpServers、Codex TOML、或通用 MCP 结构。");
}

export function previewImportSnippet(params: {
  snippet: string;
  sourceHint?: string;
  existingServerIds?: Iterable<string>;
}): ImportPreviewResult {
  const text = stripCodeFence(params.snippet);
  if (!text) {
    throw new Error("导入内容为空。");
  }

  const warnings: ImportPreviewWarning[] = [];
  const existing = new Set(params.existingServerIds ?? []);
  const usedEnvKeys = new Set<string>();

  const hint = (params.sourceHint ?? "auto").trim().toLowerCase();
  const detectedFormat: ImportFormat =
    hint === "auto"
      ? detectFormatAuto(text)
      : hint === "mcp_router_json" || hint === "mcp-router" || hint === "mcp-router-json"
        ? "mcp_router_json"
        : hint === "codex_toml" || hint === "codex-toml"
          ? "codex_toml"
          : hint === "gemini_json" || hint === "gemini-json" || hint === "claude-json"
            ? "gemini_json"
            : "generic_mcp_json";

  warnings.push({
    code: "format_detected",
    message: `识别格式：${detectedFormat}`
  });

  let servers: Record<string, UnifiedMcpServer>;
  if (detectedFormat === "codex_toml") {
    servers = parseAsCodexToml(text, warnings);
  } else {
    servers = parseAsJsonFormats(text, detectedFormat, warnings);
  }

  const convertedServers: Record<string, UnifiedMcpServer> = {};
  const envSuggestions: ImportEnvSuggestion[] = [];
  for (const [serverId, server] of Object.entries(servers)) {
    const converted = convertSecrets(serverId, server, usedEnvKeys);
    convertedServers[serverId] = converted.server;
    envSuggestions.push(...converted.envSuggestions);
    warnings.push(...converted.warnings);
  }

  const conflicts = Object.keys(convertedServers)
    .filter((serverId) => existing.has(serverId))
    .sort();

  if (Object.keys(convertedServers).length === 0) {
    throw new Error("未解析到可导入的 MCP 服务。");
  }

  return {
    detectedFormat,
    servers: convertedServers,
    conflicts,
    envSuggestions,
    warnings
  };
}
