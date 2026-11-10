<!-- 职责：独立插件跨仓迁移实施与验收记录；不写：当前使用教程、重复策略契约。 -->

# 子代理模型插件独立迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this approved inline migration. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 providers 迁出独立 npm 插件，保留已审查行为，旧包不再覆盖子代理。

**Architecture:** 新插件继续采用 server + 无 JSX 的 TUI + JSON Schema RPC；旧项目移除对应入口、模块和测试。
新插件有独立 ID 与存储命名空间，不跨库迁移设置；用户首次重新选择模型。

**Tech Stack:** TypeScript、Node ≥ 24 原生测试、OpenCode V2 插件 API，无运行时依赖。

**Spec:** [策略契约](./subagent-model-policy.md)；执行授权来自本次会话中已确认的独立插件、npm 分发和“撤包后移动工作区开始迁移”。

## 全局约束

- 新项目名与插件 ID 为 `opencode-subagent-model`，包名为 `@justsilver/opencode-subagent-model`。
- `/subagent-model` 命令与末尾标记行为不变；不增加系统上下文、HUD、日志或新的策略能力。
- 保留新仓已有 `.gitignore`、`.gitattributes`、LICENSE 与仓库元数据。
- 不修改真实用户配置、存储或凭据；不自动发布新版本、提交、推送；不复用已撤包的旧 beta 版本号。
- 纯迁移不新增平行行为测试；迁移旧用例并通过新 server 入口驱动现有策略用例。

## 审查重点

1. 新旧插件 ID、RPC、命令归属独立，不残留旧包钩子或跨仓源码导入。
2. 全局存储、变体校验、前台/后台与并发返回标记保留原行为。
3. npm tarball 包含所有入口及模块，无宿主运行时副本或源码外路径。
4. 旧 providers 恢复供应商职责，原注册表与刷新能力不退化。
5. 迁移说明明确新包尚未发布、旧 npm beta 已撤回但本机副本不会自动移除，须先停用旧覆盖。

### Task 1: 迁移代码与测试并解除旧包耦合

**Files:** 新仓 `package.json`、`plugin/opencode-subagent-model/{index,tui,rpc,subagent-model}.ts`、
`plugin/opencode-subagent-model/view/subagent-model.ts`、`tests/subagent-model*.test.ts`；
旧仓 `plugin/opencode-providers/{index,tui,rpc}.ts`、旧模块/用例、`tests/setup.test.ts`。

**Interfaces:** 保持 `registerSubagentModelPolicy`、`configureSubagentModel` 和 get/set RPC 方法；
新的 `subagentModelRpc.id` 与新插件 ID 一致，providers 只保留注册表 refresh RPC。

- [x] 运行旧项目基线测试，记录新项目初始仅仓库元数据、无代码测试。
- [x] 迁入已有行为测试，更新路径；策略用例改为通过真实独立 server 入口取得 RPC handlers，不新增同规则用例。
- [x] 迁移已审查模块、JSON Schema RPC、server/TUI 入口；更新旧提示为“所需工具钩子”。
- [x] providers 移除旧命令、模块和 RPC，删除已消失的集成用例及其专属 fake 能力，不改注册表。
- [x] 两仓分别运行 `node --test`，确认策略只在新仓覆盖、旧仓用例仍全部通过。

### Task 2: 文档、打包与独立审查

**Files:** 两仓 README、CONTRIBUTING、AGENTS、CHANGELOG；新仓策略文档与本计划；旧仓策略入口保留迁移链接。

- [x] 新仓补使用、开发/发布与策略文档；旧仓删除现行使用入口、保留历史计划与链接，记录已确认撤包事实。
- [x] 两仓全量测试、双入口 esbuild、`npm pack --dry-run`、`git diff --check` 全部通过。
- [x] 核对新包 `npm pack --dry-run --json` 文件清单；不发布、不改用户配置、不发真实供应商请求。
- [x] 只读独立审查两仓未提交改动；记录结论、实际验证数据与未进行的真机验证。

## 验证记录（2026-11-10）

- 新仓功能分支 `feat/extract-subagent-model`，旧仓仍为 `feat/subagent-model-result-marker`；两个仓库均保留未提交改动。
- 来源基线 170/170；新仓 37/37，旧仓 131/131。37 条原有用例随功能迁入，原旧集成形态消失的 2 条用例删除。
- 策略用例现由真实新 server 入口接入 RPC 后驱动；未增加与既有规则重复的用例。
- 两仓 server / TUI 共 4 次 esbuild、两次 npm 打包预检、两仓 `git diff --check` 均退出 0。
- 新包预检包含 9 个文件：5 个插件模块与 package.json / README / CHANGELOG / LICENSE，无运行时依赖或旧仓路径。
- 旧包 tarball 预检无子代理模块；package.json 与 CHANGELOG 顶部版本均为待发布的 `0.4.0-beta.1`。
- 新包 `0.1.0-beta.0` 未发布；未配置发布工作流，不自动提交、推送、打 tag 或发布。
- 新仓用户初始化的 `.gitattributes`、LICENSE 和仓库元数据原样保留；`.gitignore` 仅补 `dist/`。
- 没有真实 TUI 点击、供应商子代理请求或用户配置/数据库操作；核验为业务用例、宿主源码契约与打包检查。
- 迁移不自动继承旧存储，用户首次需重新选择模型；旧本机 beta 必须先停用或切换来源。

## 独立审查与收尾

- 无 Critical / Important；唯一 Minor 为旧历史文档指向迁移占位页内已消失的锚点，按全局历史文档维护约束已修正为新仓策略文档链接，注明在线内容待推送。仅链接修改，不新增测试。
- 审查者独立复跑新仓 37/37、旧仓真实 server 注册与刷新用例 11/11，并核查真实宿主加载、存储与工具钩子链路。
- 旧仓完整 131/131、四次构建与两次 npm 预检由主代理执行；不能把它们称为审查者独立全量复跑。
- 真机 TUI、供应商请求、安装后运行及用户配置切换仍未验证；未发布、提交或推送。
- 执行裁决：沿用用户明确要求的当前会话直接迁移；在两个原目录功能分支保留未提交改动，不额外创建 worktree；复用既有业务测试，不增补结构/默认值用例。代价是没有额外目录或提交快照隔离，也未覆盖真实供应商环境。
