import os from "node:os";
import path from "node:path";
import * as TOML from "@iarna/toml";
import { TargetConfig, UnifiedMcpServer } from "../types.js";
import { readTextIfExists } from "../utils/fs.js";
import { AgentAdapter, LoadResult } from "./base.js";

export class CodexAdapter implements AgentAdapter {
  readonly agent = "codex" as const;

  resolvePath(target?: TargetConfig): string {
    if (target?.outputPath) {
      return target.outputPath;
    }
    return path.join(os.homedir(), ".codex", "config.toml");
  }

  async load(filePath: string): Promise<LoadResult> {
    const content = await readTextIfExists(filePath);
    if (content === null || content.trim() === "") {
      return { exists: false, data: this.createEmpty() };
    }

    let parsed: unknown;
    try {
      parsed = TOML.parse(content);
    } catch (error) {
      throw new Error(`Failed parsing Codex TOML config (${filePath}): ${String(error)}`);
    }
    return { exists: true, data: parsed };
  }

  createEmpty(): unknown {
    return {};
  }

  extractServers(data: unknown): Record<string, unknown> {
    const root = data as Record<string, unknown>;
    const servers = root.mcp_servers;
    if (!servers || typeof servers !== "object") {
      return {};
    }
    return servers as Record<string, unknown>;
  }

  withServers(data: unknown, servers: Record<string, unknown>): unknown {
    const root = { ...(data as Record<string, unknown>) };
    root.mcp_servers = servers;
    return root;
  }

  normalizeServer(serverId: string, server: UnifiedMcpServer): Record<string, unknown> {
    if (server.transport === "stdio") {
      if (!server.command) {
        throw new Error(`Server "${serverId}" requires "command" for stdio transport.`);
      }
      const result: Record<string, unknown> = {
        command: server.command
      };
      if (server.args && server.args.length > 0) {
        result.args = server.args;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        result.env = server.env;
      }
      if (typeof server.startup_timeout_sec === "number") {
        result.startup_timeout_sec = server.startup_timeout_sec;
      }
      return result;
    }

    if (!server.url) {
      throw new Error(`Server "${serverId}" requires "url" for ${server.transport} transport.`);
    }

    const result: Record<string, unknown> = {
      url: server.url
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      result.headers = server.headers;
    }
    return result;
  }

  format(data: unknown): string {
    return TOML.stringify(data as TOML.JsonMap);
  }
}
