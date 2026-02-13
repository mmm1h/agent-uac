import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSnapshotRoot } from "./config.js";
import { AgentPlan } from "./planner.js";
import { SkillsManifest, getManifestPath } from "./skills.js";
import { hasDiff } from "./utils/json.js";
import { copyIfExists, ensureParentDir, pathExists, readTextIfExists, writeTextAtomic } from "./utils/fs.js";

export interface AppliedAgent {
  agent: string;
  mcpPath: string;
  mcpChanged: boolean;
  mcpBackupPath?: string;
  mcpExistedBefore: boolean;
  skillsDir: string;
  skillsChanged: boolean;
  skillsBackupDir?: string;
  skillsManifestExistedBefore: boolean;
}

export interface SyncResult {
  snapshotId: string;
  snapshotDir: string;
  applied: AppliedAgent[];
}

interface RollbackMeta {
  snapshotId: string;
  createdAt: string;
  applied: AppliedAgent[];
}

function makeSnapshotId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hasSkillsDiff(plan: AgentPlan): boolean {
  return hasDiff(plan.skillsDiff);
}

async function backupSkillsState(plan: AgentPlan, snapshotDir: string): Promise<string> {
  const agentBackupDir = path.join(snapshotDir, "skills", plan.agent);
  await mkdir(agentBackupDir, { recursive: true });

  const manifestPath = getManifestPath(plan.skillsDir);
  const manifestRaw = await readTextIfExists(manifestPath);
  if (manifestRaw !== null) {
    await writeTextAtomic(path.join(agentBackupDir, "manifest.json"), manifestRaw);
  }

  for (const skill of Object.values(plan.currentSkills)) {
    const sourcePath = path.join(plan.skillsDir, skill.fileName);
    if (await pathExists(sourcePath)) {
      await copyIfExists(sourcePath, path.join(agentBackupDir, skill.fileName));
    }
  }

  return agentBackupDir;
}

async function applySkills(plan: AgentPlan): Promise<void> {
  await ensureParentDir(path.join(plan.skillsDir, ".placeholder"));
  const manifestPath = getManifestPath(plan.skillsDir);

  const desiredEntries = Object.entries(plan.desiredSkills);
  const desiredById = new Map(desiredEntries);
  for (const [skillId, current] of Object.entries(plan.currentSkills)) {
    if (desiredById.has(skillId)) {
      continue;
    }
    const filePath = path.join(plan.skillsDir, current.fileName);
    if (await pathExists(filePath)) {
      await rm(filePath, { force: true });
    }
  }

  const manifest: SkillsManifest = {
    version: 1,
    items: []
  };

  for (const [skillId, desired] of desiredEntries) {
    const targetPath = path.join(plan.skillsDir, desired.fileName);
    await writeTextAtomic(targetPath, desired.content);
    manifest.items.push({
      id: skillId,
      fileName: desired.fileName
    });
  }

  manifest.items.sort((a, b) => a.id.localeCompare(b.id));
  await writeTextAtomic(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function applyPlan(plans: AgentPlan[]): Promise<SyncResult> {
  const snapshotId = makeSnapshotId();
  const snapshotDir = path.join(getSnapshotRoot(), snapshotId);
  await mkdir(snapshotDir, { recursive: true });

  const applied: AppliedAgent[] = [];
  for (const plan of plans) {
    const mcpChanged = hasDiff(plan.diff);
    const skillsChanged = hasSkillsDiff(plan);

    let mcpBackupPath: string | undefined;
    if (mcpChanged) {
      const backupPath = path.join(snapshotDir, `${plan.agent}${path.extname(plan.path) || ".bak"}`);
      const backupMade = await copyIfExists(plan.path, backupPath);
      mcpBackupPath = backupMade ? backupPath : undefined;
    }

    let skillsBackupDir: string | undefined;
    if (skillsChanged) {
      skillsBackupDir = await backupSkillsState(plan, snapshotDir);
    }

    if (mcpChanged) {
      const nextData = plan.adapter.withServers(plan.currentData, plan.desiredServers);
      const serialized = plan.adapter.format(nextData);
      await ensureParentDir(plan.path);
      await writeTextAtomic(plan.path, serialized);
    }

    if (skillsChanged) {
      await applySkills(plan);
    }

    applied.push({
      agent: plan.agent,
      mcpPath: plan.path,
      mcpChanged,
      mcpBackupPath,
      mcpExistedBefore: plan.fileExists,
      skillsDir: plan.skillsDir,
      skillsChanged,
      skillsBackupDir,
      skillsManifestExistedBefore: plan.skillsManifestExists
    });
  }

  const meta: RollbackMeta = {
    snapshotId,
    createdAt: new Date().toISOString(),
    applied
  };

  await writeFile(
    path.join(snapshotDir, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );

  return { snapshotId, snapshotDir, applied };
}

async function restoreMcp(agent: AppliedAgent): Promise<void> {
  if (!agent.mcpChanged) {
    return;
  }

  if (agent.mcpBackupPath && (await pathExists(agent.mcpBackupPath))) {
    await copyIfExists(agent.mcpBackupPath, agent.mcpPath);
    return;
  }

  if (!agent.mcpExistedBefore && (await pathExists(agent.mcpPath))) {
    await rm(agent.mcpPath, { force: true });
  }
}

async function removeManagedSkillsFromCurrentManifest(skillsDir: string): Promise<void> {
  const manifestPath = getManifestPath(skillsDir);
  const currentManifestRaw = await readTextIfExists(manifestPath);
  if (currentManifestRaw === null || currentManifestRaw.trim() === "") {
    return;
  }

  try {
    const manifest = JSON.parse(currentManifestRaw) as SkillsManifest;
    for (const item of manifest.items ?? []) {
      const filePath = path.join(skillsDir, item.fileName);
      if (await pathExists(filePath)) {
        await rm(filePath, { force: true });
      }
    }
  } catch {
    // Ignore invalid current manifest while rolling back.
  }
}

async function restoreSkills(agent: AppliedAgent): Promise<void> {
  if (!agent.skillsChanged) {
    return;
  }

  await ensureParentDir(path.join(agent.skillsDir, ".placeholder"));
  await removeManagedSkillsFromCurrentManifest(agent.skillsDir);

  const manifestPath = getManifestPath(agent.skillsDir);
  if (agent.skillsBackupDir && (await pathExists(agent.skillsBackupDir))) {
    const backupManifestPath = path.join(agent.skillsBackupDir, "manifest.json");
    const backupManifestRaw = await readTextIfExists(backupManifestPath);
    if (backupManifestRaw && backupManifestRaw.trim() !== "") {
      const backupManifest = JSON.parse(backupManifestRaw) as SkillsManifest;
      for (const item of backupManifest.items ?? []) {
        const backupFile = path.join(agent.skillsBackupDir, item.fileName);
        if (await pathExists(backupFile)) {
          await copyIfExists(backupFile, path.join(agent.skillsDir, item.fileName));
        }
      }
      await writeTextAtomic(manifestPath, `${JSON.stringify(backupManifest, null, 2)}\n`);
      return;
    }
  }

  if (!agent.skillsManifestExistedBefore && (await pathExists(manifestPath))) {
    await rm(manifestPath, { force: true });
  }
}

export async function rollbackSnapshot(snapshotId: string, agents?: string[]): Promise<AppliedAgent[]> {
  const snapshotDir = path.join(getSnapshotRoot(), snapshotId);
  const metaPath = path.join(snapshotDir, "meta.json");
  const metaRaw = await readTextIfExists(metaPath);
  if (metaRaw === null) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const parsed = JSON.parse(metaRaw) as RollbackMeta;
  const filter = agents && agents.length > 0 ? new Set(agents) : null;
  const targets = parsed.applied.filter((item) => (filter ? filter.has(item.agent) : true));
  for (const item of targets) {
    await restoreMcp(item);
    await restoreSkills(item);
  }
  return targets;
}

export async function listSnapshots(limit = 20): Promise<string[]> {
  const root = getSnapshotRoot();
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

export async function readSnapshotMeta(snapshotId: string): Promise<RollbackMeta | null> {
  const metaPath = path.join(getSnapshotRoot(), snapshotId, "meta.json");
  if (!(await pathExists(metaPath))) {
    return null;
  }
  const raw = await readFile(metaPath, "utf8");
  return JSON.parse(raw) as RollbackMeta;
}
