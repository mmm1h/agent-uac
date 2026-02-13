export const AGENTS = ["codex", "gemini", "claude", "vscode", "antigravity"] as const;

export type AgentName = (typeof AGENTS)[number];
export type TransportType = "stdio" | "sse" | "http";
export type ImportFormat =
  | "mcp_router_json"
  | "codex_toml"
  | "gemini_json"
  | "generic_mcp_json";

export interface UnifiedMcpServer {
  transport: TransportType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  startup_timeout_sec?: number;
  enabledIn?: Partial<Record<AgentName, boolean>>;
}

export interface TargetConfig {
  enabled?: boolean;
  allow?: string[];
  deny?: string[];
  outputPath?: string;
  skillsEnabled?: boolean;
  allowSkills?: string[];
  denySkills?: string[];
  skillsOutputDir?: string;
}

export interface UnifiedSkill {
  content?: string;
  sourcePath?: string;
  fileName?: string;
  enabledIn?: Partial<Record<AgentName, boolean>>;
}

export interface UnifiedConfig {
  version: string;
  mcp: {
    servers: Record<string, UnifiedMcpServer>;
  };
  skills?: {
    items: Record<string, UnifiedSkill>;
  };
  targets?: Partial<Record<AgentName, TargetConfig>>;
}

export interface ImportPreviewWarning {
  code: "format_detected" | "partial_invalid" | "unsupported_field" | "secret_converted";
  message: string;
}

export interface ImportEnvSuggestion {
  serverId: string;
  fieldPath: string;
  envKey: string;
  replacement: string;
}

export interface ImportPreviewResult {
  detectedFormat: ImportFormat;
  servers: Record<string, UnifiedMcpServer>;
  conflicts: string[];
  envSuggestions: ImportEnvSuggestion[];
  warnings: ImportPreviewWarning[];
}

export interface ConfigDraft {
  mcpServers: Record<string, UnifiedMcpServer>;
  skills: Record<string, UnifiedSkill>;
  mcpMatrix: Record<string, Record<AgentName, boolean>>;
  skillMatrix: Record<string, Record<AgentName, boolean>>;
}

export interface ServerDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

export interface SkillMaterialized {
  fileName: string;
  content: string;
}
