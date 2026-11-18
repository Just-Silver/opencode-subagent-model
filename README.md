<!-- 职责：使用者的项目介绍、特性、安装、快速开始、日常使用、迁移与疑难解答；不写：Agent 规则、权限与策略实现、开发发版流程、设计契约。 -->

# opencode-team

给 OpenCode V2 提供零配置的多 Agent 团队：Orchestrator、QA、Reviewer 开箱即用，
并可按 Agent 单独指定子代理模型与变体。可选择当前目录可用的任意聊天模型，不依赖供应商插件。

## 特性

- **零配置团队**：安装即获得 Orchestrator 主代理，以及 QA、Reviewer 两个子代理；复用内置
  `general`、`explore`，不需要手写 Agent 文件。
- **按 Agent 覆盖模型**：只对指定 Agent ID 的子代理生效；没配置的 Agent 继续使用 OpenCode 原生选择。
- **可视化管理**：`/team` 面板查看角色、模型来源、权限摘要与完整 System Prompt，并在面板内改模型与变体。
- **随时可逆**：清除团队覆盖后回到 Agent 配置或 OpenCode 原生选择。
- **失败可见**：模型不可用、存储损坏或读取失败都明确报错，不静默回退。

## 安装

```bash
opencode plugin add @justsilver/opencode-team
```

预发布版用 `@justsilver/opencode-team@next`。

安装后**完全退出并重新启动** OpenCode，server 与 TUI 入口都在启动时加载。
也可以从本地源码目录加载：在 `plugins` 里给插件目录的绝对路径，
例如 `{ "package": "<仓库>/plugin/opencode-team" }`。两种方式同一个插件 ID，不要同时启用。

## 快速开始

1. 安装并完全退出、重新启动 OpenCode。
2. 输入 `/` 选择 `/team`，或在命令面板搜索「Agent 团队与模型」。
3. 用方向键选一个子代理（如 QA），按 `Enter` 打开模型配置。
4. 选择模型；如果该模型有变体，先按 `Enter` 选思考等级，再按 `Enter` 保存。
5. 之后 Orchestrator 派发子代理时，被配置的 Agent 会自动使用团队模型。

## 团队 Agent

| Agent | 类型 | 职责 |
|---|---|---|
| `Orchestrator` | 主代理 | 优先编排，简单任务可直接执行，协调子代理并完成最终交付 |
| `QA` | 子代理 | 独立设计、编写并执行验收测试；不迎合实现修改验收标准 |
| `Reviewer` | 子代理 | 默认只审查和报告；必要时做针对性验证，不替代 QA 验收 |
| `General` | 内置子代理 | 通用多步任务，由 Orchestrator 复用 |
| `Explore` | 内置子代理 | 代码库探索 |

- Orchestrator 不会自动成为默认主代理；用 OpenCode 的 Agent 切换选择它，或设置
  `default_agent: "orchestrator"`。
- QA 与 Reviewer 是叶子子代理：不能向用户提问，也不能再派发下级子代理。
- 其余权限继承 OpenCode 默认值与你在 `opencode.json` 中的配置；要加硬限制请配置对应 Agent 权限。

角色职责与提示词边界见[团队 Agent](docs/team-agents.md)。

## 团队面板

- 左侧列出团队 Agent 与自定义子代理，每行显示状态：原生、继承或自定义；自定义额外显示当前模型。
- 右侧显示角色说明、当前模型、权限摘要与只读 System Prompt；提示词完整展示，不提供编辑。
- 搜索框常驻并默认聚焦，直接输入即过滤；方向键选择，`Enter` 打开模型配置，`Ctrl+R` 清除团队覆盖，
  `ESC` 返回或关闭。
- 模型配置按 Provider 分组：`←`/`→` 与 `Tab` 切换区域和变体，`Enter` 选择并保存，
  `Ctrl+R` 恢复原生；保存结果与错误都显示在当前面板内。
- 窄终端自动切换为列表/详情或模型/Variant 单栏。

使用规则：

- 设置按 Agent ID 精确匹配，在同一 OpenCode 服务端数据库下全局共享，重启后保留。
- 主代理（包括 Orchestrator）的模型始终由 OpenCode 会话选择，面板只读展示。
- 清除团队覆盖后，如果该 Agent 在 `opencode.json` 配了模型，会回到该配置。
- 子代理启动确认末尾会附本次生效的模型标记，便于确认策略是否生效。

当前版本不提供 Agent 创建、删除、重命名或 Prompt 编辑。

界面细节与键盘契约见 [TUI Dashboard](docs/team-tui.md)。

## 从旧版插件迁移

旧包为 `@justsilver/opencode-subagent-model`，使用独立的存储命名空间与全局模型策略。
新插件无法直接读取旧命名空间，因此需要旧插件仍在加载时完成交接：

1. 保留旧包配置，先安装 `@justsilver/opencode-team` 并完全重启 OpenCode。
2. 打开一次 `/team`。若检测到旧插件，会提示冲突与迁移结果；若提示迁移失败，确认旧插件已加载后重新打开一次。
3. 旧全局模型会导入到当前 location 中所有非主代理 Agent（含自定义子代理）；旧设置为空时只记录迁移结果。
   其他项目独有的自定义 Agent 不在当前列表中，需要在那个项目打开 `/team` 重新选择。
4. 移除旧包配置，完全重启 OpenCode。
5. 打开 `/team` 调整个别 Agent 的模型或恢复原生选择。

如果先移除了旧包再启动新插件，旧值仍在旧命名空间中，但官方插件 API 无法跨命名空间读取；
本插件不会直接访问数据库。此时直接在 `/team` 重新选择即可。

旧 npm 包已在 registry 标记 deprecated：`@justsilver/opencode-subagent-model` 的全部版本安装时
都会提示迁移到 `@justsilver/opencode-team`。旧包保留可安装、不撤包，已经锁定旧版本的项目仍可重装。

## 疑难解答

| 现象 | 处理 |
|---|---|
| 找不到 `/team` | 确认插件已加载，且安装后完全重启过 OpenCode |
| 提示旧插件冲突 | 按迁移步骤先打开 `/team` 完成导入，再移除旧包并重启 |
| 提示团队 Agent 注册失败 | 按面板中的具体错误排查；旧宿主可升级 OpenCode。已存在的子代理仍可配置模型 |
| 提示功能不可用 | 当前宿主缺少工具钩子，或钩子注册失败；不会假装保存成功 |
| 当前模型不可用 | 切到可用模型或恢复原生选择；不会静默换成其他模型 |
| 命令重复或覆盖冲突 | 检查是否同时启用了旧包、本地目录和 npm 两份 |
| 面板能打开但按键、搜索、点击都不生效 | 插件目录被装进了自带的 `solid-js` / `@opentui/*` 副本，与宿主运行时冲突；升级到修复后的版本即可，不要手动补装这些依赖 |

开发与发布见 [CONTRIBUTING.md](CONTRIBUTING.md)，Agent 协作规范见 [AGENTS.md](AGENTS.md)，
设计契约见[策略](docs/team-policy.md)与[团队 Agent](docs/team-agents.md)。
