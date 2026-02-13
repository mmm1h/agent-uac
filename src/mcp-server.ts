#!/usr/bin/env node
/**
 * Agent UAC — MCP Server (stdio)
 *
 * An stdio-based JSON-RPC MCP server that allows AI agents
 * to query and modify Agent UAC's MCP configuration.
 *
 * Follows the Model Context Protocol specification.
 * Transport: stdio (reads JSON-RPC from stdin, writes to stdout)
 */

import * as readline from "node:readline";
import path from "node:path";
import { getDefaultConfigPath, loadAndValidateConfig, saveConfig } from "./config.js";
import { buildPlan } from "./planner.js";
import { applyPlan } from "./sync.js";
import { AGENTS, UnifiedConfig, UnifiedMcpServer, AgentName } from "./types.js";
import { loadNotes, setNote } from "./notes.js";

// ── JSON-RPC Types ──

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
}

// ── MCP Protocol Constants ──

const SERVER_INFO = {
    name: "agent-uac",
    version: "0.1.0"
};

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
    {
        name: "uac_list_servers",
        description: "List all MCP servers in the Agent UAC unified configuration, with their transport type, enabled agents, and notes.",
        inputSchema: {
            type: "object" as const,
            properties: {},
            required: [] as string[]
        }
    },
    {
        name: "uac_get_server",
        description: "Get the full configuration of a specific MCP server by its ID.",
        inputSchema: {
            type: "object" as const,
            properties: {
                serverId: { type: "string" as const, description: "The MCP server ID to look up" }
            },
            required: ["serverId"]
        }
    },
    {
        name: "uac_add_server",
        description: "Add a new MCP server to the Agent UAC unified configuration.",
        inputSchema: {
            type: "object" as const,
            properties: {
                serverId: { type: "string" as const, description: "Unique ID for the new MCP server" },
                transport: { type: "string" as const, enum: ["stdio", "sse", "http"], description: "Transport type" },
                command: { type: "string" as const, description: "Command to run (for stdio transport)" },
                args: { type: "array" as const, items: { type: "string" as const }, description: "Arguments (for stdio transport)" },
                url: { type: "string" as const, description: "URL (for sse and http transport)" },
                env: { type: "object" as const, description: "Environment variables (for stdio transport)" },
                enabledAgents: { type: "array" as const, items: { type: "string" as const }, description: "List of agents to enable this server for (default: all)" }
            },
            required: ["serverId", "transport"]
        }
    },
    {
        name: "uac_update_server",
        description: "Update an existing MCP server's configuration. Only provided fields are updated.",
        inputSchema: {
            type: "object" as const,
            properties: {
                serverId: { type: "string" as const, description: "ID of the MCP server to update" },
                transport: { type: "string" as const, enum: ["stdio", "sse", "http"], description: "Transport type" },
                command: { type: "string" as const, description: "Command to run (for stdio transport)" },
                args: { type: "array" as const, items: { type: "string" as const }, description: "Arguments (for stdio transport)" },
                url: { type: "string" as const, description: "URL (for sse and http transport)" },
                env: { type: "object" as const, description: "Environment variables (for stdio transport)" },
                enabledAgents: { type: "array" as const, items: { type: "string" as const }, description: "List of agents to enable this server for" }
            },
            required: ["serverId"]
        }
    },
    {
        name: "uac_remove_server",
        description: "Remove an MCP server from the Agent UAC unified configuration.",
        inputSchema: {
            type: "object" as const,
            properties: {
                serverId: { type: "string" as const, description: "ID of the MCP server to remove" }
            },
            required: ["serverId"]
        }
    },
    {
        name: "uac_sync",
        description: "Synchronize the unified configuration to all enabled agents. This pushes config changes to each agent's native config file.",
        inputSchema: {
            type: "object" as const,
            properties: {
                agents: { type: "array" as const, items: { type: "string" as const }, description: "Specific agents to sync to (default: all)" }
            },
            required: [] as string[]
        }
    }
];

// ── Helper Functions ──

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
    const json = JSON.stringify(msg);
    process.stdout.write(json + "\n");
}

function sendResult(id: number | string, result: unknown): void {
    send({ jsonrpc: "2.0", id, result });
}

function sendError(id: number | string, code: number, message: string, data?: unknown): void {
    send({ jsonrpc: "2.0", id, error: { code, message, data } });
}

async function getConfig(): Promise<{ config: UnifiedConfig; configPath: string }> {
    const configPath = getDefaultConfigPath();
    const loaded = await loadAndValidateConfig(configPath);
    return { config: loaded.config, configPath: loaded.path };
}

function getEnabledAgents(server: UnifiedMcpServer): string[] {
    if (!server.enabledIn) return [...AGENTS];
    return AGENTS.filter((a) => server.enabledIn?.[a] !== false);
}

// ── Tool Handlers ──

async function handleListServers(): Promise<unknown> {
    const { config } = await getConfig();
    const notes = loadNotes();
    const servers = Object.entries(config.mcp.servers).map(([id, server]) => ({
        id,
        transport: server.transport,
        command: server.command,
        url: server.url,
        enabledAgents: getEnabledAgents(server),
        note: notes[id] || undefined
    }));
    return { servers, totalCount: servers.length };
}

async function handleGetServer(params: Record<string, unknown>): Promise<unknown> {
    const serverId = params.serverId as string;
    if (!serverId) throw new Error("serverId is required");

    const { config } = await getConfig();
    const server = config.mcp.servers[serverId];
    if (!server) throw new Error(`Server "${serverId}" not found`);

    const notes = loadNotes();
    return {
        id: serverId,
        ...server,
        enabledAgents: getEnabledAgents(server),
        note: notes[serverId] || undefined
    };
}

async function handleAddServer(params: Record<string, unknown>): Promise<unknown> {
    const serverId = params.serverId as string;
    if (!serverId?.trim()) throw new Error("serverId is required");

    const transport = params.transport as "stdio" | "sse" | "http";
    if (transport !== "stdio" && transport !== "sse" && transport !== "http") {
        throw new Error("transport must be 'stdio', 'sse', or 'http'");
    }

    const { config, configPath } = await getConfig();
    if (config.mcp.servers[serverId]) throw new Error(`Server "${serverId}" already exists`);

    const newServer: UnifiedMcpServer = { transport };

    if (transport === "stdio") {
        const command = params.command as string | undefined;
        if (!command?.trim()) throw new Error("command is required for stdio transport");
        newServer.command = command.trim();
        if (Array.isArray(params.args)) newServer.args = params.args.filter((a): a is string => typeof a === "string");
        if (params.env && typeof params.env === "object") {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(params.env as Record<string, unknown>)) {
                if (typeof v === "string") env[k] = v;
            }
            if (Object.keys(env).length > 0) newServer.env = env;
        }
    } else {
        const url = params.url as string | undefined;
        if (!url?.trim()) throw new Error(`url is required for ${transport} transport`);
        newServer.url = url.trim();
    }

    // Set enabledIn
    const enabledAgents = Array.isArray(params.enabledAgents)
        ? params.enabledAgents.filter((a): a is string => typeof a === "string" && AGENTS.includes(a as AgentName))
        : [...AGENTS];
    newServer.enabledIn = {};
    for (const agent of AGENTS) {
        newServer.enabledIn[agent] = enabledAgents.includes(agent);
    }

    config.mcp.servers[serverId] = newServer;
    await saveConfig(configPath, config);

    return { ok: true, serverId, message: `Server "${serverId}" added successfully` };
}

async function handleUpdateServer(params: Record<string, unknown>): Promise<unknown> {
    const serverId = params.serverId as string;
    if (!serverId?.trim()) throw new Error("serverId is required");

    const { config, configPath } = await getConfig();
    const server = config.mcp.servers[serverId];
    if (!server) throw new Error(`Server "${serverId}" not found`);

    if (params.transport === "stdio" || params.transport === "sse" || params.transport === "http") {
        server.transport = params.transport;
    }

    if (typeof params.command === "string") server.command = params.command;
    if (typeof params.url === "string") server.url = params.url;
    if (Array.isArray(params.args)) server.args = params.args.filter((a): a is string => typeof a === "string");
    if (params.env && typeof params.env === "object") {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(params.env as Record<string, unknown>)) {
            if (typeof v === "string") env[k] = v;
        }
        server.env = Object.keys(env).length > 0 ? env : undefined;
    }

    if (Array.isArray(params.enabledAgents)) {
        const enabledAgents = params.enabledAgents.filter((a): a is string => typeof a === "string" && AGENTS.includes(a as AgentName));
        if (!server.enabledIn) server.enabledIn = {};
        for (const agent of AGENTS) {
            server.enabledIn[agent] = enabledAgents.includes(agent);
        }
    }

    config.mcp.servers[serverId] = server;
    await saveConfig(configPath, config);

    return { ok: true, serverId, message: `Server "${serverId}" updated successfully` };
}

async function handleRemoveServer(params: Record<string, unknown>): Promise<unknown> {
    const serverId = params.serverId as string;
    if (!serverId?.trim()) throw new Error("serverId is required");

    const { config, configPath } = await getConfig();
    if (!config.mcp.servers[serverId]) throw new Error(`Server "${serverId}" not found`);

    delete config.mcp.servers[serverId];
    await saveConfig(configPath, config);

    return { ok: true, serverId, message: `Server "${serverId}" removed successfully` };
}

async function handleSync(params: Record<string, unknown>): Promise<unknown> {
    const { config, configPath } = await getConfig();

    let targetAgents: AgentName[] | undefined;
    if (Array.isArray(params.agents)) {
        const validAgents = params.agents.filter(
            (a): a is AgentName => typeof a === "string" && AGENTS.includes(a as AgentName)
        );
        if (validAgents.length > 0) targetAgents = validAgents;
    }

    const plans = await buildPlan(config, {
        agents: targetAgents,
        configDir: path.dirname(configPath),
        resolveSecrets: true
    });

    const result = await applyPlan(plans);
    return {
        ok: true,
        snapshotId: result.snapshotId,
        applied: result.applied,
        message: `Synced to ${result.applied.length} agent(s)`
    };
}

// ── MCP Protocol Handler ──

async function handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    try {
        switch (method) {
            case "initialize":
                sendResult(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO
                });
                break;

            case "notifications/initialized":
                // Client acknowledges initialization — no response needed
                break;

            case "tools/list":
                sendResult(id, { tools: TOOLS });
                break;

            case "tools/call": {
                const toolName = (params as Record<string, unknown>)?.name as string;
                const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;

                let result: unknown;
                switch (toolName) {
                    case "uac_list_servers":
                        result = await handleListServers();
                        break;
                    case "uac_get_server":
                        result = await handleGetServer(toolArgs);
                        break;
                    case "uac_add_server":
                        result = await handleAddServer(toolArgs);
                        break;
                    case "uac_update_server":
                        result = await handleUpdateServer(toolArgs);
                        break;
                    case "uac_remove_server":
                        result = await handleRemoveServer(toolArgs);
                        break;
                    case "uac_sync":
                        result = await handleSync(toolArgs);
                        break;
                    default:
                        sendError(id, -32601, `Unknown tool: ${toolName}`);
                        return;
                }
                sendResult(id, {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                });
                break;
            }

            case "ping":
                sendResult(id, {});
                break;

            default:
                sendError(id, -32601, `Method not found: ${method}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendResult(id, {
            content: [{ type: "text", text: JSON.stringify({ error: message }) }],
            isError: true
        });
    }
}

// ── Main Entry Point ──

function main(): void {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    // Log to stderr so we don't interfere with JSON-RPC on stdout
    process.stderr.write(`[agent-uac-mcp] MCP server started (stdio)\n`);

    rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
            const request = JSON.parse(trimmed) as JsonRpcRequest;
            if (request.jsonrpc !== "2.0") {
                process.stderr.write(`[agent-uac-mcp] Invalid JSON-RPC version\n`);
                return;
            }

            // Notifications don't have an id
            if (request.id === undefined || request.id === null) {
                // Handle as notification — no response
                return;
            }

            void handleRequest(request);
        } catch (err) {
            process.stderr.write(
                `[agent-uac-mcp] Parse error: ${err instanceof Error ? err.message : String(err)}\n`
            );
        }
    });

    rl.on("close", () => {
        process.stderr.write(`[agent-uac-mcp] stdin closed, exiting\n`);
        process.exit(0);
    });
}

main();
