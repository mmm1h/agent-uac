#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { getDefaultConfigPath, initConfig, loadAndValidateConfig, saveConfig } from "./config.js";
import { importFromMcpRouterJson } from "./importers/mcpRouter.js";
import { buildPlan } from "./planner.js";
import { applyPlan, listSnapshots, readSnapshotMeta, rollbackSnapshot } from "./sync.js";
import { AGENTS, AgentName } from "./types.js";
import { hasDiff } from "./utils/json.js";
import { copyIfExists, pathExists } from "./utils/fs.js";

function parseAgents(input?: string): AgentName[] | undefined {
  if (!input) {
    return undefined;
  }
  const requested = input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const valid = new Set(AGENTS);
  for (const agent of requested) {
    if (!valid.has(agent as AgentName)) {
      throw new Error(`Invalid agent "${agent}". Allowed: ${AGENTS.join(", ")}`);
    }
  }
  return requested as AgentName[];
}

function printPlanSummary(plans: Awaited<ReturnType<typeof buildPlan>>): void {
  for (const plan of plans) {
    const changeFlag = hasDiff(plan.diff) ? "CHANGE" : "NO-CHANGE";
    console.log(`\n[${plan.agent}] ${changeFlag}`);
    console.log(`Path: ${plan.path}`);
    console.log(
      `+${plan.diff.added.length} ~${plan.diff.changed.length} -${plan.diff.removed.length} =${plan.diff.unchanged}`
    );

    if (plan.diff.added.length > 0) {
      console.log(`  Added: ${plan.diff.added.join(", ")}`);
    }
    if (plan.diff.changed.length > 0) {
      console.log(`  Changed: ${plan.diff.changed.join(", ")}`);
    }
    if (plan.diff.removed.length > 0) {
      console.log(`  Removed: ${plan.diff.removed.join(", ")}`);
    }

    const skillChangeFlag = hasDiff(plan.skillsDiff) ? "CHANGE" : "NO-CHANGE";
    console.log(`Skills: ${skillChangeFlag}`);
    console.log(`Skills Dir: ${plan.skillsDir}`);
    console.log(
      `  +${plan.skillsDiff.added.length} ~${plan.skillsDiff.changed.length} -${plan.skillsDiff.removed.length} =${plan.skillsDiff.unchanged}`
    );
    if (plan.skillsDiff.added.length > 0) {
      console.log(`  Skills Added: ${plan.skillsDiff.added.join(", ")}`);
    }
    if (plan.skillsDiff.changed.length > 0) {
      console.log(`  Skills Changed: ${plan.skillsDiff.changed.join(", ")}`);
    }
    if (plan.skillsDiff.removed.length > 0) {
      console.log(`  Skills Removed: ${plan.skillsDiff.removed.join(", ")}`);
    }
  }
}

async function run(): Promise<void> {
  const program = new Command();
  program.name("uac").description("Unified Agent Config sync tool").version("0.1.0");

  program
    .command("init")
    .description("Create sample unified config file")
    .option("-c, --config <path>", "Path to unified config file", getDefaultConfigPath())
    .option("-f, --force", "Overwrite if config already exists", false)
    .action(async (options: { config: string; force: boolean }) => {
      const targetPath = await initConfig(options.config, options.force);
      console.log(`Config created at: ${targetPath}`);
    });

  program
    .command("import-mcp-router")
    .description("Import mcp-router JSON export into unified config format")
    .requiredOption("-i, --input <path>", "Path to mcp-router JSON export")
    .option("-o, --output <path>", "Output unified config path", getDefaultConfigPath())
    .option("-f, --force", "Overwrite output config if it already exists", false)
    .option("--no-backup", "Do not create backup of existing output config")
    .action(async (options: { input: string; output: string; force: boolean; backup: boolean }) => {
      if (!(await pathExists(options.input))) {
        throw new Error(`Input file not found: ${options.input}`);
      }

      const outputExists = await pathExists(options.output);
      if (outputExists && !options.force) {
        throw new Error(`Output config already exists: ${options.output}\nUse --force to overwrite.`);
      }

      if (outputExists && options.backup !== false) {
        const backupPath = `${options.output}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await copyIfExists(options.output, backupPath);
        console.log(`Backup created: ${backupPath}`);
      }

      const raw = await readFile(options.input, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Failed to parse JSON input: ${String(error)}`);
      }

      const imported = importFromMcpRouterJson(parsed);
      await saveConfig(options.output, imported.config);
      console.log(`Imported ${imported.importedServerIds.length} MCP servers into: ${options.output}`);

      if (imported.skippedServerIds.length > 0) {
        console.log(`Skipped ${imported.skippedServerIds.length}: ${imported.skippedServerIds.join(", ")}`);
      }
      if (imported.warnings.length > 0) {
        console.log("Warnings:");
        for (const warning of imported.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  program
    .command("validate")
    .description("Validate unified config schema")
    .option("-c, --config <path>", "Path to unified config file", getDefaultConfigPath())
    .action(async (options: { config: string }) => {
      const loaded = await loadAndValidateConfig(options.config);
      const count = Object.keys(loaded.config.mcp.servers).length;
      console.log(`Config is valid: ${loaded.path}`);
      console.log(`MCP servers: ${count}`);
    });

  program
    .command("plan")
    .description("Preview planned sync diff for each agent")
    .option("-c, --config <path>", "Path to unified config file", getDefaultConfigPath())
    .option("-a, --agents <list>", "Comma-separated agent list, e.g. codex,gemini")
    .option("--json", "Output JSON plan", false)
    .action(async (options: { config: string; agents?: string; json: boolean }) => {
      const loaded = await loadAndValidateConfig(options.config);
      const plans = await buildPlan(loaded.config, {
        agents: parseAgents(options.agents),
        configDir: path.dirname(loaded.path),
        resolveSecrets: false
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            plans.map((plan) => ({
              agent: plan.agent,
              path: plan.path,
              diff: plan.diff,
              skillsDir: plan.skillsDir,
              skillsDiff: plan.skillsDiff
            })),
            null,
            2
          )
        );
        return;
      }

      printPlanSummary(plans);
    });

  program
    .command("sync")
    .description("Apply sync to target agent configs")
    .option("-c, --config <path>", "Path to unified config file", getDefaultConfigPath())
    .option("-a, --agents <list>", "Comma-separated agent list, e.g. codex,claude")
    .option("--dry-run", "Only preview, no file writes", false)
    .action(async (options: { config: string; agents?: string; dryRun: boolean }) => {
      const loaded = await loadAndValidateConfig(options.config);
      const plans = await buildPlan(loaded.config, {
        agents: parseAgents(options.agents),
        configDir: path.dirname(loaded.path),
        resolveSecrets: options.dryRun ? false : true
      });

      if (options.dryRun) {
        printPlanSummary(plans);
        return;
      }

      printPlanSummary(plans);
      const result = await applyPlan(plans);
      console.log(`\nSnapshot: ${result.snapshotId}`);
      console.log(`Snapshot dir: ${result.snapshotDir}`);
      for (const item of result.applied) {
        const mcpText = item.mcpChanged ? "mcp=updated" : "mcp=skipped";
        const skillsText = item.skillsChanged ? "skills=updated" : "skills=skipped";
        if (!item.mcpChanged && !item.skillsChanged) {
          console.log(`- ${item.agent}: skipped (no change)`);
          continue;
        }
        const mcpBackup = item.mcpBackupPath ? item.mcpBackupPath : "none";
        const skillsBackup = item.skillsBackupDir ? item.skillsBackupDir : "none";
        console.log(`- ${item.agent}: ${mcpText}, ${skillsText}`);
        console.log(`  mcpPath=${item.mcpPath}, mcpBackup=${mcpBackup}`);
        console.log(`  skillsDir=${item.skillsDir}, skillsBackup=${skillsBackup}`);
      }
    });

  program
    .command("rollback")
    .description("Rollback files from a snapshot")
    .requiredOption("-s, --snapshot <id>", "Snapshot ID from sync output")
    .option("-a, --agents <list>", "Comma-separated agent list, e.g. codex,claude")
    .action(async (options: { snapshot: string; agents?: string }) => {
      const agentList = parseAgents(options.agents);
      const restored = await rollbackSnapshot(options.snapshot, agentList);
      if (restored.length === 0) {
        console.log("No matching agents to rollback.");
        return;
      }
      console.log(`Rollback snapshot: ${options.snapshot}`);
      for (const item of restored) {
        console.log(`- ${item.agent}: rollback applied`);
      }
    });

  program
    .command("snapshots")
    .description("List local snapshots")
    .option("-n, --limit <count>", "Max snapshots to list", "20")
    .option("--show-meta", "Include basic metadata", false)
    .action(async (options: { limit: string; showMeta: boolean }) => {
      const limit = Number.parseInt(options.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid --limit value "${options.limit}".`);
      }

      const ids = await listSnapshots(limit);
      if (ids.length === 0) {
        console.log("No snapshots found.");
        return;
      }

      for (const id of ids) {
        if (!options.showMeta) {
          console.log(id);
          continue;
        }
        const meta = await readSnapshotMeta(id);
        if (!meta) {
          console.log(`${id} (meta missing)`);
          continue;
        }
        console.log(`${id} | createdAt=${meta.createdAt} | agents=${meta.applied.map((x) => x.agent).join(",")}`);
      }
    });

  await program.parseAsync(process.argv);
}

run().catch((error) => {
  console.error(`[uac] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
