import { AgentName, TargetConfig, UnifiedMcpServer } from "../types.js";

export interface LoadResult {
  exists: boolean;
  data: unknown;
}

export interface AgentAdapter {
  readonly agent: AgentName;
  resolvePath(target?: TargetConfig): Promise<string> | string;
  load(filePath: string): Promise<LoadResult>;
  createEmpty(): unknown;
  extractServers(data: unknown): Record<string, unknown>;
  withServers(data: unknown, servers: Record<string, unknown>): unknown;
  normalizeServer(serverId: string, server: UnifiedMcpServer): Record<string, unknown>;
  format(data: unknown): string;
}
