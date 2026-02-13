# AGENTS.md

## 1. 项目目标

`agent-uac` 是一个本地优先的统一配置分发工具，用一套配置同步到多个 Agent（Codex / Gemini / Claude），支持按 Agent 选择性启用 MCP 与 Skills。

## 2. 当前范围（V1）

- 核心：CLI + 本地 API + React UI + Tauri 壳
- 支持目标：
  - Codex: `~/.codex/config.toml`
  - Gemini: `~/.gemini/settings.json`
  - Claude: `~/.claude.json` 或 `~/.claude/settings.json`
- 已实现能力：
  - `init / validate / plan / sync / rollback / snapshots`
  - `import-mcp-router`（从 mcp-router JSON 导入）
  - MCP/Skill 矩阵开关编辑（UI）
  - 快照备份与回滚

## 3. 运行方式

### 3.1 本地 GUI（推荐）

```powershell
cd F:\agent_uac
npm run dev:desktop
```

打开：`http://127.0.0.1:5173`

### 3.2 CLI 常用命令

```powershell
npm run dev -- validate --config C:/Users/12562/.uac/unified.config.yaml
npm run dev -- plan --config C:/Users/12562/.uac/unified.config.yaml --agents codex,gemini
npm run dev -- sync --config C:/Users/12562/.uac/unified.config.yaml --agents codex,gemini
```

### 3.3 Tauri 桌面

```powershell
npm run tauri:dev
```

## 4. 关键行为约定

### 4.1 密钥解析策略

- `plan` / 计划预览：允许 `env://KEY` 缺失（不阻断）。
- `sync` / 真正写入：若缺失 `env://KEY` 对应环境变量则报错并阻断。

### 4.2 导入 mcp-router

```powershell
npm run dev -- import-mcp-router --input F:/agent_uac/mcp-servers-2026-02-12.json --output C:/Users/12562/.uac/unified.config.yaml --force
```

- 导入时会跳过无有效 `command/url` 的服务器项，并给出 warnings。

### 4.3 配置格式说明

- Codex TOML 中子表（如 `[mcp_servers.xxx.env]`）前导空格是格式化风格，语义合法。

## 5. 安全约定

- 避免在统一配置中长期保留明文密钥。
- 推荐将敏感值改为 `env://KEY` 引用，并在运行环境注入变量。
- 同步前先 `plan`，确认差异后再 `sync`。

## 6. 讨论同步机制（必须执行）

从本条开始，后续每次“关键讨论结论/行为变更”都要同步到本文件第 7 节：

- 何为关键：
  - 架构或数据结构变更
  - 新命令或新接口
  - 默认行为变更（例如密钥策略、同步策略）
  - 兼容性/安全策略变化
- 记录格式：
  - 日期（YYYY-MM-DD）
  - 变更摘要
  - 受影响文件
  - 对用户的影响

## 7. 决策日志（持续追加）

### 2026-02-12

- 引入本地 GUI：React + 本地 API + Tauri 壳，支持矩阵化开关与快照回滚。
- 新增 `import-mcp-router`，可直接将 mcp-router JSON 导入为统一配置。

### 2026-02-13

- 调整密钥解析行为：`plan` 允许缺失 env，`sync` 强制校验 env。
- 完成中文化 UI 交互文案（按钮/提示/状态）。
- 使用 `mcp-servers-2026-02-12.json` 完成实际导入并验证 Codex/Gemini 对齐成功。

### 2026-02-12

- 新增 Agent TDD 执行指南，明确 `RED -> GREEN -> REFACTOR -> DEBUG`、分层门禁、日志与夹具回放契约。
- 受影响文件：`tdd-guide.md`、`AGENTS.md`
- 对用户的影响：后续 agent 可按统一测试/调试标准执行任务，降低回归与不可复现问题。

### 2026-02-12

- 完成桌面优先 UI 重构：主导航收敛为 `MCP 管理` 与 `Skills 管理`，全局栏承载校验/计划/同步，“快照历史”下沉到“更多/高级”抽屉。
- 新增 MCP 导入与编辑链路：支持代码段预览、冲突覆盖预览、环境变量占位建议、分模块保存。
- 新增 API：`/api/config/load`、`/api/mcp/import/preview`、`/api/mcp/import/apply`、`/api/mcp/save`、`/api/skills/save`，并保留旧 `matrix` 接口兼容。
- 受影响文件：`src/api/server.ts`、`src/importers/snippet.ts`、`src/types.ts`、`web/src/App.tsx`、`web/src/styles.css`、`AGENTS.md`
- 对用户的影响：可在图形界面中按模块维护配置并独立保存，导入 mcp 片段后可先预览再落盘，低频功能不会干扰主流程。

### 2026-02-13 (chrome-mcp-stdio 修复)

- 修复 `chrome-mcp-stdio` MCP 启动失败（`initialize response` 错误）：
  - 原始配置使用 `"command": "npx", "args": ["node", "/Users/12562/..."]`，双重错误：
    1. `npx node` 会把 `node` 当作 npm 包名而非 Node.js 运行时
    2. `/Users/12562/...` 是 Unix 路径格式，Windows 环境无法识别
  - 修正为 `"command": "node", "args": ["C:/Users/12562/AppData/Roaming/npm/node_modules/mcp-chrome-bridge/dist/mcp/mcp-server-stdio.js"]`
  - 同步修复至 `mcp-servers-2026-02-12.json`、`~/.gemini/settings.json`、`~/.codex/config.toml`
  - 重新执行 `import-mcp-router` 更新统一配置
- 受影响文件：`mcp-servers-2026-02-12.json`、`~/.gemini/settings.json`、`~/.codex/config.toml`、`~/.uac/unified.config.yaml`
- 对用户的影响：`chrome-mcp-stdio` MCP 可正常启动并连接到 Chrome bridge 后端（`http://127.0.0.1:12306/mcp`）

### 2026-02-13 (前端布局优化)

- 全面重构前端布局：精简顶栏为两行 Flex（标题+配置+Agent芯片 / 按钮+内联通知）；去掉 240px 左侧导航改为 Tab 栏（附计数和脏标记）；计划预览移至底部可折叠面板；全量矩阵表格改为选中项内联 Agent 开关行。
- 受影响文件：`web/src/styles.css`、`web/src/App.tsx`
- 对用户的影响：控制台操作效率提升，编辑区更宽敞，导航更直观，低频功能不再占用主视野。

### 2026-02-13 (新增 Agent + 移除顶栏开关)

- 新增 VSCode agent adapter（`%APPDATA%/Code/User/mcp.json`，`servers` key）和 Antigravity agent adapter（`~/.gemini/antigravity/mcp_config.json`，`mcpServers` key）。
- 移除顶栏 Agent 选择芯片，计划/同步始终对全部 Agent 生效（per-MCP 矩阵已覆盖选择需求）。
- 受影响文件：`src/types.ts`、`src/schema.ts`、`src/adapters/vscode.ts`[NEW]、`src/adapters/antigravity.ts`[NEW]、`src/adapters/index.ts`、`src/api/server.ts`、`web/src/App.tsx`
- 对用户的影响：可统一管理 5 个 Agent（codex/gemini/claude/vscode/antigravity）的 MCP 配置。
