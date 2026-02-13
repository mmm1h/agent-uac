import os from "node:os";
import path from "node:path";
import { TargetConfig, UnifiedMcpServer } from "../types.js";
import { readTextIfExists } from "../utils/fs.js";
import { AgentAdapter, LoadResult } from "./base.js";

export class GeminiAdapter implements AgentAdapter {
  readonly agent = "gemini" as const;

  resolvePath(target?: TargetConfig): string {
    if (target?.outputPath) {
      return target.outputPath;
    }
    return path.join(os.homedir(), ".gemini", "settings.json");
  }

  async load(filePath: string): Promise<LoadResult> {
    const content = await readTextIfExists(filePath);
    if (content === null || content.trim() === "") {
      return { exists: false, data: this.createEmpty() };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed parsing Gemini config (${filePath}): ${String(error)}`);
    }
    return { exists: true, data: parsed };
  }

  createEmpty(): unknown {
    return {};
  }

  extractServers(data: unknown): Record<string, unknown> {
    const root = data as Record<string, unknown>;
    const servers = root.mcpServers;
    if (!servers || typeof servers !== "object") {
      return {};
    }
    return servers as Record<string, unknown>;
  }

  withServers(data: unknown, servers: Record<string, unknown>): unknown {
    const root = { ...(data as Record<string, unknown>) };
    root.mcpServers = servers;
    return root;
  }

  normalizeServer(serverId: string, server: UnifiedMcpServer): Record<string, unknown> {
    if (server.transport === "stdio") {
      if (!server.command) {
        throw new Error(`Server "${serverId}" requires "command" for stdio transport.`);
      }
      const result: Record<string, unknown> = {
        type: "stdio",
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
      type: server.transport,
      url: server.url
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      result.headers = server.headers;
    }
    return result;
  }

  format(data: unknown): string {
    return `${JSON.stringify(data, null, 2)}\n`;
  }
}
