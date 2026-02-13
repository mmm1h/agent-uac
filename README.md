# agent-uac

`agent-uac` (`uac`) is a local-first sync tool for distributing one MCP definition set to multiple agents with per-agent enable/disable control.

## Status

Early V1 CLI scaffold:
- `init`
- `validate`
- `plan`
- `sync`
- `rollback`
- `snapshots`
- `import-mcp-router`

Desktop UI scaffold:
- React dashboard (`web/`)
- Local API server (`src/api/server.ts`)
- Tauri shell config (`src-tauri/`)
- matrix editor for MCP/Skill per-agent toggles

Supported targets in this version:
- Codex CLI (`~/.codex/config.toml`)
- Gemini CLI (`~/.gemini/settings.json`)
- Claude (`~/.claude.json` or `~/.claude/settings.json`)

## Quick Start

```bash
npm install
npm run dev -- init
npm run dev -- validate
npm run dev -- plan
npm run dev -- sync
```

## Desktop UI (Now)

Run local API + React UI:

```bash
npm run dev:desktop
```

Then open:

`http://127.0.0.1:5173`

Dashboard workflow:
1. Set config path and click `Validate`
2. Edit MCP/Skill matrix checkboxes
3. Click `Save Matrix`
4. Click `Plan` then `Sync`
5. Rollback from `Snapshots` when needed

## Tauri Desktop (After Rust install)

Prerequisite: install Rust toolchain (`cargo`, `rustc`) and platform deps for Tauri.

```bash
npm run tauri:dev
```

Package build:

```bash
npm run tauri:build
```

Current scaffold mode:
- UI runs inside Tauri WebView
- business logic still served by local Node API (`http://127.0.0.1:4310`)
- for packaged usage, start API service separately:

```bash
npm run build
npm run start:api
```

## Config path

Default config path:

`~/.uac/unified.config.yaml`

You can override with `--config`.

## Example

```bash
npm run dev -- plan --agents codex,gemini
npm run dev -- sync --agents codex,claude
npm run dev -- snapshots --show-meta
npm run dev -- rollback --snapshot <snapshot-id>
npm run dev -- import-mcp-router --input ./mcp-servers-2026-02-12.json --output ~/.uac/unified.config.yaml --force
```

## Secrets

`env://KEY` references are resolved at plan/sync time.

Example:

```yaml
headers:
  Authorization: env://MCP_ROUTER_TOKEN
```

If the environment variable is missing, `plan/sync` fails with a clear error.

## Skills Sync

`skills.items` supports inline content or source files. V1 syncs skill files into per-agent managed folders.

```yaml
skills:
  items:
    security-checklist:
      sourcePath: "./skills/security-checklist.md"
      enabledIn:
        codex: true
        gemini: true
        claude: true
targets:
  codex:
    allowSkills: ["security-checklist"]
  gemini:
    allowSkills: []
  claude:
    allowSkills: ["security-checklist"]
```

Managed skill directories (default):
- Codex: `~/.codex/skills/uac-managed`
- Gemini: `~/.gemini/skills/uac-managed`
- Claude: `~/.claude/skills/uac-managed`
