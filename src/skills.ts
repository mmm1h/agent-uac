import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { AgentName, SkillMaterialized, TargetConfig, UnifiedConfig, UnifiedSkill } from "./types.js";
import { pathExists, readTextIfExists } from "./utils/fs.js";

export interface SkillsManifest {
  version: number;
  items: Array<{
    id: string;
    fileName: string;
  }>;
}

export interface ManagedSkillsState {
  manifestExists: boolean;
  manifest: SkillsManifest;
  skillsById: Record<string, SkillMaterialized>;
}

export function defaultSkillsOutputDir(agent: AgentName): string {
  if (agent === "codex") {
    return path.join(os.homedir(), ".codex", "skills", "uac-managed");
  }
  if (agent === "gemini") {
    return path.join(os.homedir(), ".gemini", "skills", "uac-managed");
  }
  return path.join(os.homedir(), ".claude", "skills", "uac-managed");
}

export function resolveSkillsDir(agent: AgentName, target: TargetConfig): string {
  return target.skillsOutputDir ?? defaultSkillsOutputDir(agent);
}

export function getManifestPath(skillsDir: string): string {
  return path.join(skillsDir, ".uac-skills-manifest.json");
}

export async function readManagedSkills(skillsDir: string): Promise<ManagedSkillsState> {
  const manifestPath = getManifestPath(skillsDir);
  const rawManifest = await readTextIfExists(manifestPath);
  if (rawManifest === null || rawManifest.trim() === "") {
    return {
      manifestExists: false,
      manifest: { version: 1, items: [] },
      skillsById: {}
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(`Failed to parse skills manifest (${manifestPath}): ${String(error)}`);
  }

  const manifest = parsed as SkillsManifest;
  const skillsById: Record<string, SkillMaterialized> = {};
  for (const item of manifest.items ?? []) {
    const filePath = path.join(skillsDir, item.fileName);
    const content = await readTextIfExists(filePath);
    skillsById[item.id] = {
      fileName: item.fileName,
      content: content ?? ""
    };
  }

  return {
    manifestExists: true,
    manifest,
    skillsById
  };
}

function skillEnabledForAgent(
  skillId: string,
  skill: UnifiedSkill,
  agent: AgentName,
  target: TargetConfig
): boolean {
  if (target.enabled === false || target.skillsEnabled === false) {
    return false;
  }

  if (target.allowSkills && target.allowSkills.length > 0 && !target.allowSkills.includes(skillId)) {
    return false;
  }

  if (target.denySkills && target.denySkills.includes(skillId)) {
    return false;
  }

  if (skill.enabledIn && skill.enabledIn[agent] === false) {
    return false;
  }

  return true;
}

async function loadSkillContent(skillId: string, skill: UnifiedSkill, configDir: string): Promise<string> {
  if (typeof skill.content === "string") {
    return skill.content;
  }
  if (!skill.sourcePath) {
    throw new Error(`Skill "${skillId}" requires either "content" or "sourcePath".`);
  }

  const sourcePath = path.isAbsolute(skill.sourcePath) ? skill.sourcePath : path.join(configDir, skill.sourcePath);
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Skill "${skillId}" source file not found: ${sourcePath}`);
  }
  return readFile(sourcePath, "utf8");
}

export async function buildDesiredSkills(
  config: UnifiedConfig,
  agent: AgentName,
  target: TargetConfig,
  configDir: string
): Promise<Record<string, SkillMaterialized>> {
  const items = config.skills?.items ?? {};
  const result: Record<string, SkillMaterialized> = {};
  for (const [skillId, skill] of Object.entries(items)) {
    if (!skillEnabledForAgent(skillId, skill, agent, target)) {
      continue;
    }
    const content = await loadSkillContent(skillId, skill, configDir);
    result[skillId] = {
      fileName: skill.fileName ?? `${skillId}.md`,
      content
    };
  }
  return result;
}
