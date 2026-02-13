import cors from "cors";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { getDefaultConfigPath, loadAndValidateConfig, saveConfig } from "../config.js";
import { previewImportSnippet } from "../importers/snippet.js";
import { buildPlan } from "../planner.js";
import { applyPlan, listSnapshots, readSnapshotMeta, rollbackSnapshot } from "../sync.js";
import { getAdapters } from "../adapters/index.js";
import {
  AGENTS,
  AgentName,
  UnifiedConfig,
  UnifiedMcpServer,
  UnifiedSkill
} from "../types.js";
import { loadNotes, setNote } from "../notes.js";

interface ApiError {
  error: string;
}

type BoolAgentMap = Record<AgentName, boolean>;
type BoolMatrix = Record<string, BoolAgentMap>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function emptyAgentMap(defaultValue = false): BoolAgentMap {
  const map: Record<string, boolean> = {};
  for (const agent of AGENTS) {
    map[agent] = defaultValue;
  }
  return map as BoolAgentMap;
}

function ensureTargets(config: UnifiedConfig): void {
  if (!config.targets) {
    config.targets = {};
  }
  for (const agent of AGENTS) {
    if (!config.targets[agent]) {
      config.targets[agent] = {};
    }
  }
}

function parseAgents(input: unknown): AgentName[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new Error("agents must be an array when provided.");
  }

  const allowed = new Set(AGENTS);
  const parsed: AgentName[] = [];
  for (const item of input) {
    if (typeof item !== "string") {
      throw new Error("agents must be an array of strings.");
    }
    const normalized = item.trim();
    if (!allowed.has(normalized as AgentName)) {
      throw new Error(`Invalid agent "${normalized}". Allowed: ${AGENTS.join(", ")}`);
    }
    parsed.push(normalized as AgentName);
  }
  return parsed;
}

function resolveConfigPath(raw: unknown): string {
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw;
  }
  return getDefaultConfigPath();
}

function serializePlans(plans: Awaited<ReturnType<typeof buildPlan>>) {
  return plans.map((plan) => ({
    agent: plan.agent,
    path: plan.path,
    skillsDir: plan.skillsDir,
    mcp: plan.diff,
    skills: plan.skillsDiff
  }));
}

function isMcpEnabledForAgent(config: UnifiedConfig, serverId: string, agent: AgentName): boolean {
  const target = config.targets?.[agent] ?? {};
  if (target.enabled === false) {
    return false;
  }
  if (target.allow && target.allow.length > 0 && !target.allow.includes(serverId)) {
    return false;
  }
  if (target.deny && target.deny.includes(serverId)) {
    return false;
  }
  const server = config.mcp.servers[serverId];
  if (server.enabledIn && server.enabledIn[agent] === false) {
    return false;
  }
  return true;
}

function isSkillEnabledForAgent(config: UnifiedConfig, skillId: string, agent: AgentName): boolean {
  const target = config.targets?.[agent] ?? {};
  if (target.enabled === false || target.skillsEnabled === false) {
    return false;
  }
  if (target.allowSkills && target.allowSkills.length > 0 && !target.allowSkills.includes(skillId)) {
    return false;
  }
  if (target.denySkills && target.denySkills.includes(skillId)) {
    return false;
  }
  const skill = config.skills?.items?.[skillId];
  if (!skill) {
    return false;
  }
  if (skill.enabledIn && skill.enabledIn[agent] === false) {
    return false;
  }
  return true;
}

function buildMatrixFromConfig(config: UnifiedConfig): {
  mcpIds: string[];
  skillIds: string[];
  mcpMatrix: BoolMatrix;
  skillMatrix: BoolMatrix;
} {
  const mcpIds = Object.keys(config.mcp.servers).sort();
  const skillIds = Object.keys(config.skills?.items ?? {}).sort();
  const mcpMatrix: BoolMatrix = {};
  const skillMatrix: BoolMatrix = {};

  for (const serverId of mcpIds) {
    const row = emptyAgentMap();
    for (const agent of AGENTS) {
      row[agent] = isMcpEnabledForAgent(config, serverId, agent);
    }
    mcpMatrix[serverId] = row;
  }

  for (const skillId of skillIds) {
    const row = emptyAgentMap();
    for (const agent of AGENTS) {
      row[agent] = isSkillEnabledForAgent(config, skillId, agent);
    }
    skillMatrix[skillId] = row;
  }

  return { mcpIds, skillIds, mcpMatrix, skillMatrix };
}

function normalizeMatrix(input: unknown, ids: string[], fieldName: string): BoolMatrix {
  if (!isRecord(input)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const result: BoolMatrix = {};
  for (const id of ids) {
    const rowRaw = input[id];
    const row = emptyAgentMap();
    if (rowRaw !== undefined) {
      if (!isRecord(rowRaw)) {
        throw new Error(`${fieldName}.${id} must be an object.`);
      }
      for (const agent of AGENTS) {
        const value = rowRaw[agent];
        if (value === undefined) {
          row[agent] = false;
          continue;
        }
        if (typeof value !== "boolean") {
          throw new Error(`${fieldName}.${id}.${agent} must be boolean.`);
        }
        row[agent] = value;
      }
    }
    result[id] = row;
  }
  return result;
}

function normalizeEnabledIn(input: unknown): BoolAgentMap {
  const result = emptyAgentMap(true);
  if (!isRecord(input)) {
    return result;
  }
  for (const agent of AGENTS) {
    const value = input[agent];
    if (typeof value === "boolean") {
      result[agent] = value;
    }
  }
  return result;
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

function normalizeServer(serverId: string, raw: unknown): UnifiedMcpServer {
  if (!isRecord(raw)) {
    throw new Error(`servers.${serverId} must be an object.`);
  }

  const transportRaw =
    typeof raw.transport === "string" ? raw.transport : typeof raw.type === "string" ? raw.type : null;
  let transport: "stdio" | "sse" | "http";
  if (transportRaw === "stdio" || transportRaw === "sse" || transportRaw === "http") {
    transport = transportRaw;
  } else if (typeof raw.url === "string" && raw.url.trim() !== "") {
    transport = "sse";
  } else if (typeof raw.command === "string" && raw.command.trim() !== "") {
    transport = "stdio";
  } else {
    throw new Error(`servers.${serverId} missing valid transport (stdio/sse/http).`);
  }

  const server: UnifiedMcpServer = {
    transport,
    enabledIn: normalizeEnabledIn(raw.enabledIn)
  };

  if (transport === "stdio") {
    if (typeof raw.command !== "string" || raw.command.trim() === "") {
      throw new Error(`servers.${serverId}.command is required for stdio transport.`);
    }
    server.command = raw.command.trim();
    server.args = toStringArray(raw.args);
    server.env = toStringRecord(raw.env);
    if (typeof raw.startup_timeout_sec === "number") {
      server.startup_timeout_sec = raw.startup_timeout_sec;
    }
    return server;
  }

  if (typeof raw.url !== "string" || raw.url.trim() === "") {
    throw new Error(`servers.${serverId}.url is required for ${transport} transport.`);
  }
  server.url = raw.url.trim();
  server.headers = toStringRecord(raw.headers);
  return server;
}

function normalizeServerMap(input: unknown, fieldName: string): Record<string, UnifiedMcpServer> {
  if (!isRecord(input)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  const result: Record<string, UnifiedMcpServer> = {};
  for (const [serverId, raw] of Object.entries(input)) {
    if (serverId.trim() === "") {
      throw new Error(`${fieldName} contains empty server id.`);
    }
    result[serverId] = normalizeServer(serverId, raw);
  }
  return result;
}

function normalizeSkill(skillId: string, raw: unknown): UnifiedSkill {
  if (!isRecord(raw)) {
    throw new Error(`skills.${skillId} must be an object.`);
  }
  const skill: UnifiedSkill = {};
  if (typeof raw.content === "string") {
    skill.content = raw.content;
  }
  if (typeof raw.sourcePath === "string") {
    skill.sourcePath = raw.sourcePath;
  }
  if (!skill.content && !skill.sourcePath) {
    throw new Error(`skills.${skillId} requires content or sourcePath.`);
  }
  if (typeof raw.fileName === "string" && raw.fileName.trim() !== "") {
    skill.fileName = raw.fileName.trim();
  }
  skill.enabledIn = normalizeEnabledIn(raw.enabledIn);
  return skill;
}

function normalizeSkillMap(input: unknown, fieldName: string): Record<string, UnifiedSkill> {
  if (!isRecord(input)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  const result: Record<string, UnifiedSkill> = {};
  for (const [skillId, raw] of Object.entries(input)) {
    if (skillId.trim() === "") {
      throw new Error(`${fieldName} contains empty skill id.`);
    }
    result[skillId] = normalizeSkill(skillId, raw);
  }
  return result;
}

function matrixFromServerEnabled(servers: Record<string, UnifiedMcpServer>): BoolMatrix {
  const matrix: BoolMatrix = {};
  for (const [serverId, server] of Object.entries(servers)) {
    const row = emptyAgentMap();
    for (const agent of AGENTS) {
      row[agent] = server.enabledIn?.[agent] ?? true;
    }
    matrix[serverId] = row;
  }
  return matrix;
}

function matrixFromSkillEnabled(skills: Record<string, UnifiedSkill>): BoolMatrix {
  const matrix: BoolMatrix = {};
  for (const [skillId, skill] of Object.entries(skills)) {
    const row = emptyAgentMap();
    for (const agent of AGENTS) {
      row[agent] = skill.enabledIn?.[agent] ?? true;
    }
    matrix[skillId] = row;
  }
  return matrix;
}

function applyMcpMatrixToConfig(config: UnifiedConfig, mcpMatrix: BoolMatrix): void {
  ensureTargets(config);
  const mcpIds = Object.keys(config.mcp.servers).sort();

  for (const serverId of mcpIds) {
    const server = config.mcp.servers[serverId];
    if (!server.enabledIn) {
      server.enabledIn = {};
    }
    for (const agent of AGENTS) {
      server.enabledIn[agent] = mcpMatrix[serverId]?.[agent] ?? false;
    }
  }

  for (const agent of AGENTS) {
    const target = config.targets![agent]!;
    target.allow = mcpIds.filter((id) => mcpMatrix[id]?.[agent] === true);
    delete target.deny;
  }
}

function applySkillMatrixToConfig(config: UnifiedConfig, skillMatrix: BoolMatrix): void {
  ensureTargets(config);
  if (!config.skills) {
    config.skills = { items: {} };
  }
  const skillIds = Object.keys(config.skills.items).sort();

  for (const skillId of skillIds) {
    const skill = config.skills.items[skillId];
    if (!skill.enabledIn) {
      skill.enabledIn = {};
    }
    for (const agent of AGENTS) {
      skill.enabledIn[agent] = skillMatrix[skillId]?.[agent] ?? false;
    }
  }

  for (const agent of AGENTS) {
    const target = config.targets![agent]!;
    target.skillsEnabled = skillIds.length > 0;
    target.allowSkills = skillIds.filter((id) => skillMatrix[id]?.[agent] === true);
    delete target.denySkills;
  }
}

function applyMatrixToConfig(config: UnifiedConfig, mcpMatrix: BoolMatrix, skillMatrix: BoolMatrix): UnifiedConfig {
  const next = structuredClone(config) as UnifiedConfig;
  applyMcpMatrixToConfig(next, mcpMatrix);
  applySkillMatrixToConfig(next, skillMatrix);
  return next;
}

function fail(res: express.Response<ApiError>, error: unknown, status = 400): express.Response<ApiError> {
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).json({ error: message });
}

async function createPlans(configPath: string, agentsRaw: unknown, resolveSecrets: boolean) {
  const loaded = await loadAndValidateConfig(configPath);
  const agents = parseAgents(agentsRaw);
  const plans = await buildPlan(loaded.config, {
    agents,
    configDir: path.dirname(loaded.path),
    resolveSecrets
  });
  return {
    configPath: loaded.path,
    plans
  };
}

async function start(): Promise<void> {
  // Optional: Auto-terminate if parent process dies (for sidecar mode)
  const parentPidArgIndex = process.argv.indexOf("--parent-pid");
  if (parentPidArgIndex !== -1 && process.argv[parentPidArgIndex + 1]) {
    const ppid = parseInt(process.argv[parentPidArgIndex + 1], 10);
    if (!isNaN(ppid)) {
      console.log(`[uac-api] Monitoring parent process ${ppid}`);
      setInterval(() => {
        try {
          process.kill(ppid, 0); // Check if process exists
        } catch {
          console.log(`[uac-api] Parent process ${ppid} gone, exiting.`);
          process.exit(0);
        }
      }, 3000);
    }
  }

  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: false
    })
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/defaults", (_req, res) => {
    res.json({
      configPath: getDefaultConfigPath(),
      agents: AGENTS
    });
  });

  // ── Agent Info & Settings ──
  app.post("/api/agents/info", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const adapters = getAdapters();

      const agents = await Promise.all(adapters.map(async (adapter) => {
        const target = loaded.config.targets?.[adapter.agent];
        const defaultPath = await adapter.resolvePath();
        // Note: resolvePath might be async in some adapters (e.g. Claude checks existence), 
        // but base interface says Promise | string.

        // Check if the file actually exists
        let exists = false;
        try {
          await fs.access(defaultPath);
          exists = true;
        } catch { /* ignore */ }

        // If configured path is different, check that too? 
        // For now, "exists" refers to the default path detection or the currently effectively used path.
        // Let's check the *effective* path.
        const effectivePath = target?.outputPath || defaultPath;
        let effectiveExists = false;
        try {
          if (typeof effectivePath === "string" && effectivePath) {
            await fs.access(effectivePath);
            effectiveExists = true;
          }
        } catch { /* ignore */ }

        return {
          name: adapter.agent,
          defaultPath: typeof defaultPath === "string" ? defaultPath : "",
          configuredPath: target?.outputPath ?? null,
          enabled: target?.enabled !== false,
          exists: effectiveExists,
          defaultExists: exists
        };
      }));

      res.json({ agents });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/agents/detect", async (req, res) => {
    try {
      const adapters = getAdapters();
      const detected: string[] = [];
      for (const adapter of adapters) {
        const defaultPath = await adapter.resolvePath();
        try {
          if (typeof defaultPath === "string" && defaultPath) {
            await fs.access(defaultPath);
            detected.push(adapter.agent);
          }
        } catch { /* ignore */ }
      }
      res.json({ detected });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/agents/settings", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const settings = req.body?.settings;
      if (!settings || typeof settings !== "object") {
        throw new Error("settings is required.");
      }
      const next = structuredClone(loaded.config) as UnifiedConfig;
      ensureTargets(next);
      for (const agent of AGENTS) {
        const agentSettings = settings[agent];
        if (!agentSettings || typeof agentSettings !== "object") continue;
        const target = next.targets![agent]!;
        if (typeof agentSettings.enabled === "boolean") {
          target.enabled = agentSettings.enabled;
        }
        if (typeof agentSettings.outputPath === "string") {
          const trimmed = agentSettings.outputPath.trim();
          if (trimmed) {
            target.outputPath = trimmed;
          } else {
            delete target.outputPath;
          }
        }
      }
      await saveConfig(loaded.path, next);
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });

  // ── Notes ──
  app.get("/api/notes", (_req, res) => {
    try {
      res.json({ notes: loadNotes() });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/notes", (req, res) => {
    try {
      const serverId = req.body?.serverId;
      if (typeof serverId !== "string" || serverId.trim() === "") {
        throw new Error("serverId is required.");
      }
      const note = typeof req.body?.note === "string" ? req.body.note : "";
      setNote(serverId.trim(), note);
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/config/load", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const matrix = buildMatrixFromConfig(loaded.config);
      res.json({
        configPath: loaded.path,
        mcpServers: loaded.config.mcp.servers,
        skills: loaded.config.skills?.items ?? {},
        ...matrix
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/validate", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      res.json({
        ok: true,
        configPath: loaded.path,
        serverCount: Object.keys(loaded.config.mcp.servers).length,
        skillCount: Object.keys(loaded.config.skills?.items ?? {}).length
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/mcp/import/preview", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const snippet = typeof req.body?.snippet === "string" ? req.body.snippet : "";
      if (!snippet.trim()) {
        throw new Error("snippet is required.");
      }
      const sourceHint = typeof req.body?.sourceHint === "string" ? req.body.sourceHint : "auto";
      const loaded = await loadAndValidateConfig(configPath);
      const preview = previewImportSnippet({
        snippet,
        sourceHint,
        existingServerIds: Object.keys(loaded.config.mcp.servers)
      });
      res.json({
        configPath: loaded.path,
        ...preview
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/mcp/import/apply", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const mergePolicy = typeof req.body?.mergePolicy === "string" ? req.body.mergePolicy : "overwrite";
      if (mergePolicy !== "overwrite") {
        throw new Error(`Unsupported mergePolicy "${mergePolicy}".`);
      }

      const loaded = await loadAndValidateConfig(configPath);
      const resolvedServers = normalizeServerMap(req.body?.resolvedServers, "resolvedServers");
      const selectedServerIds =
        Array.isArray(req.body?.selectedServerIds) && req.body.selectedServerIds.length > 0
          ? req.body.selectedServerIds
          : Object.keys(resolvedServers);

      const normalizedSelected = selectedServerIds.map((item: unknown) => {
        if (typeof item !== "string" || item.trim() === "") {
          throw new Error("selectedServerIds must be an array of non-empty strings.");
        }
        return item.trim();
      });

      const next = structuredClone(loaded.config) as UnifiedConfig;
      ensureTargets(next);
      const overwrittenIds: string[] = [];
      const updatedServerIds: string[] = [];

      for (const serverId of normalizedSelected) {
        const server = resolvedServers[serverId];
        if (!server) {
          throw new Error(`selectedServerIds contains unknown id "${serverId}".`);
        }
        if (next.mcp.servers[serverId]) {
          overwrittenIds.push(serverId);
        }
        next.mcp.servers[serverId] = server;
        updatedServerIds.push(serverId);
      }

      for (const agent of AGENTS) {
        const target = next.targets![agent]!;
        if (!target.allow || target.allow.length === 0) {
          continue;
        }
        for (const serverId of updatedServerIds) {
          if (next.mcp.servers[serverId].enabledIn?.[agent] === false) {
            continue;
          }
          if (!target.allow.includes(serverId)) {
            target.allow.push(serverId);
          }
        }
      }

      await saveConfig(loaded.path, next);
      const matrix = buildMatrixFromConfig(next);
      res.json({
        configPath: loaded.path,
        updatedServerIds: updatedServerIds.sort(),
        overwrittenIds: overwrittenIds.sort(),
        ...matrix
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/mcp/save", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const servers = normalizeServerMap(req.body?.servers, "servers");
      const next = structuredClone(loaded.config) as UnifiedConfig;
      next.mcp.servers = servers;

      const mcpIds = Object.keys(servers).sort();
      const mcpMatrix = req.body?.targetMatrix
        ? normalizeMatrix(req.body.targetMatrix, mcpIds, "targetMatrix")
        : matrixFromServerEnabled(servers);
      applyMcpMatrixToConfig(next, mcpMatrix);

      await saveConfig(loaded.path, next);
      res.json({
        ok: true,
        configPath: loaded.path,
        updatedServerCount: mcpIds.length,
        mcpMatrix
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/skills/save", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const skills = normalizeSkillMap(req.body?.skills, "skills");
      const next = structuredClone(loaded.config) as UnifiedConfig;
      next.skills = { items: skills };

      const skillIds = Object.keys(skills).sort();
      const skillMatrix = req.body?.targetMatrix
        ? normalizeMatrix(req.body.targetMatrix, skillIds, "targetMatrix")
        : matrixFromSkillEnabled(skills);
      applySkillMatrixToConfig(next, skillMatrix);

      await saveConfig(loaded.path, next);
      res.json({
        ok: true,
        configPath: loaded.path,
        updatedSkillCount: skillIds.length,
        skillMatrix
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/matrix", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const matrix = buildMatrixFromConfig(loaded.config);
      res.json({
        configPath: loaded.path,
        ...matrix
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/matrix/apply", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const loaded = await loadAndValidateConfig(configPath);
      const mcpIds = Object.keys(loaded.config.mcp.servers).sort();
      const skillIds = Object.keys(loaded.config.skills?.items ?? {}).sort();

      const normalizedMcpMatrix = normalizeMatrix(req.body?.mcpMatrix, mcpIds, "mcpMatrix");
      const normalizedSkillMatrix = normalizeMatrix(req.body?.skillMatrix ?? {}, skillIds, "skillMatrix");

      const next = applyMatrixToConfig(loaded.config, normalizedMcpMatrix, normalizedSkillMatrix);
      await saveConfig(loaded.path, next);

      res.json({
        ok: true,
        configPath: loaded.path,
        mcpCount: mcpIds.length,
        skillCount: skillIds.length
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/plan", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const { configPath: resolvedPath, plans } = await createPlans(configPath, req.body?.agents, false);
      res.json({
        configPath: resolvedPath,
        plans: serializePlans(plans)
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/sync", async (req, res) => {
    try {
      const configPath = resolveConfigPath(req.body?.configPath);
      const dryRun = req.body?.dryRun === true;
      const { configPath: resolvedPath, plans } = await createPlans(configPath, req.body?.agents, !dryRun);

      if (dryRun) {
        res.json({
          dryRun: true,
          configPath: resolvedPath,
          plans: serializePlans(plans)
        });
        return;
      }

      const result = await applyPlan(plans);
      res.json({
        dryRun: false,
        configPath: resolvedPath,
        snapshotId: result.snapshotId,
        snapshotDir: result.snapshotDir,
        applied: result.applied
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/snapshots", async (req, res) => {
    try {
      const limitRaw = String(req.query.limit ?? "20");
      const includeMeta = String(req.query.meta ?? "0") === "1";
      const limit = Number.parseInt(limitRaw, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid snapshot limit "${limitRaw}".`);
      }

      const ids = await listSnapshots(limit);
      if (!includeMeta) {
        res.json({ snapshots: ids });
        return;
      }

      const enriched = [];
      for (const id of ids) {
        enriched.push({
          id,
          meta: await readSnapshotMeta(id)
        });
      }
      res.json({ snapshots: enriched });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/rollback", async (req, res) => {
    try {
      const snapshotId = req.body?.snapshotId;
      if (typeof snapshotId !== "string" || snapshotId.trim() === "") {
        throw new Error("snapshotId is required.");
      }
      const agents = parseAgents(req.body?.agents);
      const restored = await rollbackSnapshot(snapshotId, agents);
      res.json({
        snapshotId,
        restored
      });
    } catch (error) {
      fail(res, error);
    }
  });

  const port = Number.parseInt(process.env.UAC_API_PORT ?? "4310", 10);
  app.listen(port, "127.0.0.1", () => {
    console.log(`[uac-api] listening on http://127.0.0.1:${port}`);
  });
}

start().catch((error) => {
  console.error(`[uac-api] startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
