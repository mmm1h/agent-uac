import path from "node:path";
import { AgentAdapter } from "./adapters/base.js";
import { getAdapters } from "./adapters/index.js";
import { resolveServerSecrets } from "./secrets.js";
import { buildDesiredSkills, readManagedSkills, resolveSkillsDir } from "./skills.js";
import { AGENTS, AgentName, ServerDiff, SkillMaterialized, TargetConfig, UnifiedConfig, UnifiedMcpServer } from "./types.js";
import { diffServerMaps } from "./utils/json.js";

export interface AgentPlan {
  agent: AgentName;
  path: string;
  adapter: AgentAdapter;
  targetConfig: TargetConfig;
  fileExists: boolean;
  currentData: unknown;
  currentServers: Record<string, unknown>;
  desiredServers: Record<string, unknown>;
  diff: ServerDiff;
  skillsDir: string;
  currentSkills: Record<string, SkillMaterialized>;
  desiredSkills: Record<string, SkillMaterialized>;
  skillsDiff: ServerDiff;
  skillsManifestExists: boolean;
}

export interface BuildPlanOptions {
  agents?: AgentName[];
  configDir?: string;
  resolveSecrets?: boolean;
}

function serverEnabledForAgent(
  serverId: string,
  server: UnifiedMcpServer,
  agent: AgentName,
  target: TargetConfig
): boolean {
  if (target.enabled === false) {
    return false;
  }

  if (target.allow && target.allow.length > 0 && !target.allow.includes(serverId)) {
    return false;
  }

  if (target.deny && target.deny.includes(serverId)) {
    return false;
  }

  if (server.enabledIn && server.enabledIn[agent] === false) {
    return false;
  }

  return true;
}

function normalizeForAgent(
  agent: AgentName,
  adapter: AgentAdapter,
  config: UnifiedConfig,
  target: TargetConfig,
  options: BuildPlanOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const servers = config.mcp.servers;
  for (const [serverId, server] of Object.entries(servers)) {
    if (!serverEnabledForAgent(serverId, server, agent, target)) {
      continue;
    }
    const resolved = resolveServerSecrets(serverId, server, {
      allowMissingEnv: options.resolveSecrets !== true
    });
    result[serverId] = adapter.normalizeServer(serverId, resolved);
  }
  return result;
}

export async function buildPlan(config: UnifiedConfig, options: BuildPlanOptions = {}): Promise<AgentPlan[]> {
  const configDir = options.configDir ?? process.cwd();
  const filter = new Set(options.agents ?? AGENTS);
  const adapters = getAdapters().filter((item) => filter.has(item.agent));
  const plans: AgentPlan[] = [];

  for (const adapter of adapters) {
    const targetConfig = config.targets?.[adapter.agent] ?? {};
    const targetPath = await adapter.resolvePath(targetConfig);
    const loaded = await adapter.load(targetPath);
    const currentServers = adapter.extractServers(loaded.data);
    const desiredServers = normalizeForAgent(adapter.agent, adapter, config, targetConfig, options);
    const serverDiff = diffServerMaps(currentServers, desiredServers);
    const skillsDir = resolveSkillsDir(adapter.agent, targetConfig);
    const currentSkillsState = await readManagedSkills(skillsDir);
    const desiredSkills = await buildDesiredSkills(config, adapter.agent, targetConfig, configDir);
    const skillsDiff = diffServerMaps(currentSkillsState.skillsById, desiredSkills);

    plans.push({
      agent: adapter.agent,
      path: targetPath,
      adapter,
      targetConfig,
      fileExists: loaded.exists,
      currentData: loaded.data,
      currentServers,
      desiredServers,
      diff: serverDiff,
      skillsDir: path.resolve(skillsDir),
      currentSkills: currentSkillsState.skillsById,
      desiredSkills,
      skillsDiff,
      skillsManifestExists: currentSkillsState.manifestExists
    });
  }

  return plans;
}
