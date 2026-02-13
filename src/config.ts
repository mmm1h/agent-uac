import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import YAML from "yaml";
import { UnifiedConfig } from "./types.js";
import { validateConfigShape } from "./schema.js";
import { pathExists, readTextIfExists, writeTextAtomic } from "./utils/fs.js";

export function getStateDir(): string {
  return path.join(os.homedir(), ".uac");
}

export function getDefaultConfigPath(): string {
  return path.join(getStateDir(), "unified.config.yaml");
}

export function getSnapshotRoot(): string {
  return path.join(getStateDir(), "snapshots");
}

export interface LoadedConfig {
  path: string;
  config: UnifiedConfig;
}

export async function loadAndValidateConfig(configPath?: string): Promise<LoadedConfig> {
  const targetPath = configPath ?? getDefaultConfigPath();
  const content = await readTextIfExists(targetPath);
  if (content === null) {
    throw new Error(`Config not found: ${targetPath}`);
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse YAML config: ${String(error)}`);
  }

  const result = validateConfigShape(parsed);
  if (!result.ok) {
    throw new Error(`Config validation failed:\n- ${result.errors.join("\n- ")}`);
  }

  return {
    path: targetPath,
    config: parsed as UnifiedConfig
  };
}

export async function saveConfig(configPath: string, config: UnifiedConfig): Promise<void> {
  const result = validateConfigShape(config);
  if (!result.ok) {
    throw new Error(`Config validation failed:\n- ${result.errors.join("\n- ")}`);
  }
  await writeTextAtomic(configPath, YAML.stringify(config));
}

export async function initConfig(configPath?: string, force = false): Promise<string> {
  const targetPath = configPath ?? getDefaultConfigPath();
  if ((await pathExists(targetPath)) && !force) {
    throw new Error(`Config already exists: ${targetPath}\nUse --force to overwrite.`);
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeTextAtomic(targetPath, sampleConfigYAML());
  return targetPath;
}

function sampleConfigYAML(): string {
  const sample: UnifiedConfig = {
    version: "1",
    mcp: {
      servers: {
        "filesystem-mcp": {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\12562"],
          enabledIn: {
            codex: true,
            gemini: false,
            claude: true
          }
        },
        "router-sse": {
          transport: "sse",
          url: "http://localhost:3282/mcp/sse",
          headers: {
            Authorization: "env://MCP_ROUTER_TOKEN"
          },
          enabledIn: {
            codex: true,
            gemini: true,
            claude: true
          }
        }
      }
    },
    skills: {
      items: {
        "codex-style": {
          content: "# codex-style\n\nPrefer concise and direct engineering language.",
          enabledIn: {
            codex: true,
            gemini: false,
            claude: true
          }
        },
        "security-checklist": {
          content: "# security-checklist\n\n- Validate untrusted input\n- Avoid plaintext secrets in logs",
          enabledIn: {
            codex: true,
            gemini: true,
            claude: true
          }
        }
      }
    },
    targets: {
      codex: {
        enabled: true,
        allow: ["filesystem-mcp", "router-sse"],
        allowSkills: ["codex-style", "security-checklist"]
      },
      gemini: {
        enabled: true,
        allow: ["router-sse"],
        allowSkills: ["security-checklist"]
      },
      claude: {
        enabled: true
      }
    }
  };

  return YAML.stringify(sample);
}
