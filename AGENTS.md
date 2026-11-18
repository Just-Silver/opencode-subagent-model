<!-- 职责：agent 的项目约束、工作流程、验证要求与文档地图；不写：使用教程、完整设计契约、发版操作步骤。 -->

# 项目定位

`opencode-team` 是独立的 OpenCode V2 插件：零配置注册 Orchestrator Primary Agent、QA 与 Reviewer
子代理，复用内置 `general`/`explore`，并按 Agent ID 为子代理指定模型与变体。
npm 包名 `@justsilver/opencode-team`。

# 硬约束

- 全程简体中文，提交信息用中文；未经明确授权不提交、推送、发布或修改用户配置。
- 团队 Agent 只用官方运行时 `ctx.agent.transform` 注册，不自动部署全局 Agent 文件。
- 模型策略只覆盖 `subagent` 工具输入中按 Agent ID 精确命中的子代理；主代理模型始终由 OpenCode 选择。
- 未配置的 Agent 继承原生规则；读取失败或持久值损坏必须显式报错，不静默回退。
- 旧版插件仍加载时不得让两份策略同时覆盖：检测冲突、停止新覆盖、通过旧 RPC 一次性导入并提示移除。
- 不直接读写 SQLite，不自动迁移旧命名空间，不依赖供应商注册表或 HUD。
- 同目录双入口：`plugin/opencode-team/index.ts` 为 server，`tui.ts` 为 TUI。
- server 不运行时导入任何 `@opencode/*`；RPC 使用普通 JSON Schema 对象。
- 相对导入带显式扩展名（`.ts` / `.tsx`）；Node ≥ 24 原生擦除类型测试，不引入运行时依赖。
- 源码不放 `.opencode/plugins/`，避免本地自动发现与 npm 安装产生同 ID 重复插件。
- 策略每次执行前从宿主 storage 读取，不缓存；不直接读写 SQLite。
- 只在工具成功返回末尾增加模型标记；不注入系统上下文，不额外添加用户侧卡片/通知。
- 插件只给 QA/Reviewer 注入 `question * deny` 与 `subagent * deny`；其余权限继承 OpenCode 默认与用户配置，
  Orchestrator 不追加规则，General/Explore 的定义与权限不被修改。
- 不得把这些职责约束描述成权限沙箱；需要硬限制时由用户配置 Agent 权限。
- 不自动修改默认主代理；保持 Build 或用户显式 `default_agent`。
- 用户配置合并顺序在插件之后，测试必须覆盖用户对插件默认权限的覆盖。
- 测试只测本次业务行为，外部边界才用假件；纯迁移复用已有用例，不为类型结构、默认值或框架行为补测试。
- 注释只解释不显然的约束；迁移、来源、版本和审查记录写进文档。
- npm 包与本地目录两种加载方式不可同时启用；TUI 代码更新后须完全重启客户端。
- TUI 的 `@opentui/*` 与 `solid-js` 必须保留为 peerDependencies，且版本范围锁在宿主的 0.8.x。
  宿主固定 0.8.4；npm 插件位于 `node_modules`，宿主的 Solid 转换会跳过该路径、运行时改写也被 Bun
  原生加载绕过，因此依赖必须自带，装成 0.9.x 会再带进 core 0.9.2 并与宿主混用。
- **冒烟由用户执行**：agent 不启动真实 OpenCode 实例、不注入按键/鼠标、不截图，也不编写或
  提交临时渲染测试、探针和冒烟脚本；交付前只跑自动验证命令，真实 TUI、终端尺寸与视觉状态由用户验收。
- **每次发版前必须先用 question 工具向用户确认版本号**，确认后再改 `package.json` 与 CHANGELOG。

# 工作流程

1. **先定位**：动手前查文档地图，读对应文档；涉及行为边界时先确认是使用问题、实现缺陷还是契约变更。
2. **最小改动**：贴合现有结构、命名与风格；不顺手重构，不夹带无关修改；同一事实只写在一处。
3. **按需同步文档**：行为、契约或流程变化必须在同一次改动里更新归属文档，并登记新文档。
4. **交付前验证**：跑完下方全部命令，并如实报告结果；没有输出证据不宣称通过。
5. **提交与发布**：提交、推送、发布都要先获得明确授权；发版按 [CONTRIBUTING 的 npm 分发](CONTRIBUTING.md#npm-分发)。

# 验证要求

```text
npm install --no-package-lock
npm run typecheck
node --test
node scripts/changelog.mjs check
npx --yes esbuild plugin/opencode-team/index.ts --bundle --platform=node --format=esm --outfile=dist/team-server.js
npx --yes esbuild plugin/opencode-team/tui.ts --bundle --platform=node --format=esm --jsx=automatic --jsx-import-source=@opentui/solid --external:@opencode/plugin/tui --external:@opentui/core --external:@opentui/solid --external:solid-js --outfile=dist/team-tui.js
npm pack --dry-run
git diff --check
```

以上只做自动验证。真实 TUI 冒烟、视觉检查和终端尺寸验证由用户执行，agent 不生成临时脚本或截图。
CI 与 Release 工作流执行同一组检查，见 [CONTRIBUTING](CONTRIBUTING.md#npm-分发)。

# 文档地图

| 文档 | 负责 | 不写 |
|---|---|---|
| `README.md` | 使用者：介绍、特性、安装、快速开始、面板用法、迁移、疑难解答 | Agent 规则、策略与权限实现、开发发版流程 |
| `CONTRIBUTING.md` | 贡献者：环境、提交/PR/Issue 规范、本地调试、npm 分发与发版 | 使用教程、设计契约、验证命令细节 |
| `AGENTS.md` | agent：硬约束、工作流程、验证要求、本表 | 使用教程、完整设计、发版操作步骤 |
| `docs/team-policy.md` | 开发者：Agent 注册、按 Agent 模型策略、存储、迁移、冲突与执行边界 | 安装步骤、角色细节、发布历史 |
| `docs/team-tui.md` | 开发者：TUI Dashboard 架构、数据来源、状态语义、键盘与渲染验证 | 安装教程、模型存储契约、发布流程 |
| `docs/team-agents.md` | 开发者：Orchestrator/QA/Reviewer 角色、提示词占位、权限边界 | 模型存储契约、发版流程 |
| `docs/角色提示词/` | 设计稿：按角色拆分的 System Prompt 全文（Orchestrator/QA/Reviewer） | 运行期文本与加载方式（单一来源 `plugin/opencode-team/prompts.ts`） |
| `docs/extraction-plan.md` | 实现者：旧独立插件迁移历史与验收记录 | 当前契约、使用教程 |
| `CHANGELOG.md` | 用户：版本变更历史 | 完整设计与流程 |
