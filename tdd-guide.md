# Agent UAC TDD Guide

## 1. 目标
本指南用于约束 agent 的开发流程：任何功能改动都必须通过 TDD（先写失败测试，再实现，再重构），并提供可复现的自动 debug 证据。

## 2. 适用范围
适用于以下改动：
- `src/`（核心逻辑、配置、导入、同步、API）
- `web/src/`（前端交互、页面状态）
- 与 MCP/Skills 同步行为相关的任何变更

## 3. 强制流程（RED -> GREEN -> REFACTOR -> DEBUG）
1. RED（先失败）
- 先写或补测试，确保新场景在当前代码下失败。
- 失败原因必须与需求直接相关，不能是环境偶发问题。

2. GREEN（最小实现）
- 只做让测试通过的最小改动。
- 不在此阶段做额外重构。

3. REFACTOR（整理）
- 在测试保持通过的前提下整理命名、重复代码、边界处理。
- 必须重新跑对应测试集。

4. DEBUG（失败闭环）
- 若测试失败，输出结构化日志与失败夹具。
- 失败必须可通过回放命令复现后再修复。

## 4. 分层门禁（必须遵守）
- 本地快速门禁：`npm run gate:quick`
- 合并前门禁：`npm run gate:premerge`

若脚本不存在：
- 在当前任务中先补齐脚本，再执行门禁。
- 不允许跳过门禁直接交付。

## 5. 模块改动 -> 必跑测试映射
- 改动 `src/importers/*` 或 `src/schema.ts`：
  - 必跑：`npm run test:core`
  - 必加：导入格式解析/校验失败分支测试

- 改动 `src/api/*`：
  - 必跑：`npm run test:core`
  - 必加：API 正常路径 + 参数错误路径测试

- 改动 `src/sync.ts`、`src/planner.ts`、`src/secrets.ts`、`src/skills.ts`：
  - 必跑：`npm run test:core`
  - 必加：目标差异计算、密钥解析、快照/回滚相关测试

- 改动 `web/src/*` 交互：
  - 必跑：`npm run test:web`
  - 必加：页面切换、按钮流程、关键状态更新测试

- 跨层改动（同时涉及 core + web）：
  - 必跑：`npm run test`
  - 必跑：`npm run gate:premerge`

## 6. Debug 工件与回放
默认目录：`.uac/test-artifacts/`

约定输出：
- `latest.json`：本次失败摘要（测试名、错误栈、时间）
- `replay/*.json`：可复现输入夹具（例如导入片段、配置样本）

常用命令：
- 调试运行：`npm run test:debug -- --grep "<case>"`
- 回放失败：`npm run test:debug -- --replay <file>`

## 7. 交付完成定义（DoD）
同时满足以下条件才算完成：
- 需求对应测试已新增/更新，并且先失败后通过
- 相关分层门禁全部通过
- 若出现失败，已产出 debug 工件且可回放复现
- 变更说明中写明：改动范围、测试范围、结果摘要

## 8. 提交说明模板（给 agent 使用）
- 变更范围：
- 新增/修改测试：
- 执行命令：
- 结果：
- 是否产生 debug 工件：
- 风险与后续建议：

## 9. 与 AGENTS.md 的联动要求
每次关键流程变化（门禁规则、脚本名、回放机制）必须同步到 `AGENTS.md` 第 7 节“决策日志”。
