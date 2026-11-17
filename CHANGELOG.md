<!-- 职责：用户可见版本变更历史；不写：完整实现、安装与发版流程。 -->

# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- `/team` 从两级选择菜单升级为 Agent Team Dashboard：左侧 Agent 列表、右侧详情面板、
  底部快捷键栏，统一展示 Orchestrator 与所有可见子代理。
- 详情展示角色说明、模型来源、Variant、权限摘要与只读 System Prompt；`P` 可查看完整提示词。
- 模型配置改为 Dashboard 内的自定义 JSX 视图：按 Provider 分组展示模型，支持搜索、
  Variant 与 `Tab` 焦点切换；`Enter` 一次性保存，`Esc` 取消且不修改已有配置。
- 模型与变体保存继续复用 `setAgentModel` RPC、存储与错误处理；清除团队覆盖后回到 Agent 配置
  或 OpenCode 原生选择。
- 精简 Dashboard 左侧重复角色信息，详情区优先展示当前模型与来源。
- 面板明确区分原生、继承、自定义模型状态；主代理模型仍只读展示，不写团队覆盖。

### Added

- 支持键盘导航、内容滚动、Agent 搜索与窗口尺寸变化；窄终端自动切换单栏，低高度使用紧凑行。
- System Prompt 缺失时明确说明来源限制，不生成或伪造提示词；权限摘要按最后命中规则计算，
  并明确不是权限沙箱。

## [0.2.0] - 2026-11-17

### Changed

- 项目与 npm 包更名为 `opencode-team` / `@justsilver/opencode-team`，插件 ID、RPC ID 与
  命令入口统一为 `opencode-team`。
- 全局子代理模型策略改为按 Agent ID 精确匹配；未配置的 Agent 继续使用 OpenCode 原生选择，
  主代理模型始终由 OpenCode 选择。
- `/subagent-model` 整合为 `/team`：先选 Agent，再选模型与变体；每个 Agent 都可单独恢复原生选择。

### Added

- 使用官方 `ctx.agent.transform` 动态注册 Orchestrator Primary Agent，并新增 QA、Reviewer 子代理；
  复用内置 `general`、`explore`，安装后无需手工创建 Agent 文件。
- 插件只给 QA / Reviewer 注入 `question * deny`，子代理不得直接向用户提问：
  - Orchestrator 不追加权限规则，保留向用户提问能力。
  - QA / Reviewer 除 `question` 外，其余权限继承 OpenCode 默认与用户配置。
  - General、Explore 保持内置定义，插件不修改。
  - 用户配置在插件之后合并，可覆盖 `question` 拒绝或收紧其他权限。
- 用正式角色提示词替换占位：Orchestrator 负责任务编排、委派与交付；QA 负责独立验收设计与执行；
  Reviewer 负责独立审查并输出证据化结论。
- 职责边界改由 System Prompt 约束：Orchestrator 优先编排、简单任务可直接执行并协调并发写入
  与共享文件冲突；QA 独立设计、编写及执行验收测试且不迎合实现修改标准；Reviewer 默认只审查报告，
  确需直接修复时区分审查结果与后续修改。
- 保留现有客观验证机制；子代理自我声明不视为测试通过。权限测试覆盖无规则注入、用户配置覆盖、
  `edit/write/patch` 共用动作、会话权限、saved rules 与子会话场景。
- 旧版插件同时加载时检测冲突并停止覆盖，避免两份策略互相覆盖。
- 旧版插件仍加载时通过其 RPC 导入原全局模型到当前所有子代理，并记录一次性迁移标记；
  迁移完成后提示移除旧插件并重启。

### Migration

- 先安装新包并保留旧包加载，打开一次 `/team` 完成旧全局模型导入，再移除旧包并完全重启。
- 旧包已移除时不再读取其独立存储命名空间；需要在 `/team` 重新选择 Agent 模型。
- 旧包 `@justsilver/opencode-subagent-model` 的 npm 弃用操作尚未执行，计划见 [README](README.md#从旧版插件迁移)。

## [0.1.2] - 2026-11-11

### Changed

- 弹窗标题改为两行：第一行说明这是全局的当前选择，第二行单独显示当前模型与变体，
  不再把信息挤在一行里。

## [0.1.1] - 2026-11-10

### Fixed

- 选择弹窗标题不再重复显示同一模型（可读名称与 `provider/model#variant` 同时出现），
  模型不可用时才回显原引用。
- 选择弹窗加宽，标题与「名称 — 完整引用」不再挤成多行。

## [0.1.0] - 2026-11-10

### Added

- 独立插件：`/subagent-model` 全局模型与变体选择、持久策略、执行前强制覆盖。
- 工具成功返回末尾告知本次强制模型，保留前台/后台、并发与失败边界。
- server / TUI / RPC 三入口与 npm 包形态，无运行时依赖。

### Migration

- 从 providers 迁移时不自动继承旧设置：先停用旧覆盖，再在本插件重新选择一次模型，
  见 [README](README.md#从-providers-迁移)。

## [0.1.0-beta.0] - 2026-11-10

### Added

- 从 providers 中独立出 `/subagent-model`：全局模型与变体选择、持久策略、执行前强制覆盖。
- 工具成功返回末尾告知本次强制模型，保留前台/后台、并发与失败边界。
- 独立 server / TUI / RPC 入口与 npm 包形态，无运行时依赖。
