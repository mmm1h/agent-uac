import os from "node:os";
import path from "node:path";
import { TargetConfig, UnifiedMcpServer } from "../types.js";
import { readTextIfExists } from "../utils/fs.js";
import { AgentAdapter, LoadResult } from "./base.js";

export class VscodeAdapter implements AgentAdapter {
    readonly agent = "vscode" as const;

    resolvePath(target?: TargetConfig): string {
        if (target?.outputPath) {
            return target.outputPath;
        }
        // VS Code user-level MCP config on Windows
        const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appData, "Code", "User", "mcp.json");
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
            throw new Error(`Failed parsing VS Code MCP config (${filePath}): ${String(error)}`);
        }
        return { exists: true, data: parsed };
    }

    createEmpty(): unknown {
        return { servers: {} };
    }

    extractServers(data: unknown): Record<string, unknown> {
        const root = data as Record<string, unknown>;
        const servers = root.servers;
        if (!servers || typeof servers !== "object") {
            return {};
        }
        return servers as Record<string, unknown>;
    }

    withServers(data: unknown, servers: Record<string, unknown>): unknown {
        const root = { ...(data as Record<string, unknown>) };
        root.servers = servers;
        return root;
    }

    normalizeServer(serverId: string, server: UnifiedMcpServer): Record<string, unknown> {
        if (server.transport === "stdio") {
            if (!server.command) {
                throw new Error(`Server "${serverId}" requires "command" for stdio transport.`);
            }
            // VS Code stdio servers: command + args + env, no "type" field needed
            const result: Record<string, unknown> = {
                command: server.command
            };
            if (server.args && server.args.length > 0) {
                result.args = server.args;
            }
            if (server.env && Object.keys(server.env).length > 0) {
                result.env = server.env;
            }
            return result;
        }

        if (!server.url) {
            throw new Error(`Server "${serverId}" requires "url" for ${server.transport} transport.`);
        }

        // VS Code HTTP-based servers need "type" field
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
