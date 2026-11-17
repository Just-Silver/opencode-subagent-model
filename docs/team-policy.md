<!-- 职责：opencode-team 的 Agent 注册、按 Agent 模型策略、存储、迁移、冲突与执行边界；不写：安装教程、发布流程、重复的 Agent 角色说明。 -->

# opencode-team 策略契约

状态：`opencode-team` 的现行实现契约。Agent 角色与权限边界见 [团队 Agent](./team-agents.md)；
providers 拆分出旧独立插件的历史见[独立迁移计划](./extraction-plan.md)，旧包到本插件的用户步骤见
[README](../README.md#从旧版插件迁移)。

## 目标与范围

插件做两件事：

1. 用官方运行时 API 注册 Orchestrator Primary Agent，以及 QA、Reviewer 子代理，复用内置
   `general`、`explore`；用户不需要手工创建 Agent 文件。
2. 按 Agent ID 为子代理指定模型与变体；未配置的 Agent 继承 OpenCode 原生规则。

不做主代理模型覆盖，不管理供应商或凭据，不修改已经执行中的请求，不直接读写 SQLite，
只给 QA/Reviewer 注入 `question * deny`，不通过提示词宣称权限隔离；其余职责边界由 System Prompt
约束，需要硬限制时由用户配置。

## Agent 注册

- 使用官方 `ctx.agent.transform((editor) => { ... })`，在插件 setup 阶段同步注册。
  `editor.update(id, fn)` 会创建缺失的 Agent；插件卸载时宿主关闭注册 scope，Agent 自动消失。
- 注册内容只包含 `orchestrator`、`qa`、`reviewer`；`general`、`explore` 由内置插件继续提供。
- 插件写 `name`、`description`、`mode`、`system`、`hidden`；权限只给 `qa`、`reviewer`
  追加 `question * deny`，Orchestrator 不追加，其余权限来自 OpenCode 默认值和用户配置。
- 用户配置的 Agent 在宿主里注册得更晚：`packages/core/src/plugin/supervisor.ts` 将外部插件放在
  `pre`，`ConfigAgentPlugin` 在 `post`。因此项目/全局 `agent` 配置会覆盖同名内置/插件默认值；
  `disabled: true` 会移除该 Agent。冲突不静默：以用户配置为准，插件不反向覆盖。
- 当前宿主不提供 `ctx.agent.transform` 时，`agentsSupported: false` 明确上报；模型策略仍可用于
  已存在的子代理，不会伪造团队 Agent 已可用。
- 不自动部署全局 Agent 定义文件：已核实 OpenCode V2（本机源码 2.3.0；npm `@opencode/plugin`
  2.3.0 类型与 2.0.24 的类型都包含 `agent.transform`）支持运行时新增 Agent。文件部署会引入更新、
  冲突和卸载清理问题，因此不采用。

| 边界 | 行为 |
|---|---|
| 首次加载 | 插件 setup 注册 transform，下一次 Agent 状态读取即包含三个团队成员 |
| 更新/重载 | transform 按注册顺序重放；用户配置在插件之后运行，因此用户字段优先 |
| 重复插件 | 宿主按 duplicate plugin ID 丢弃后加载者；本插件不自行清理其他副本 |
| 旧版冲突 | 旧包 active 时停止新覆盖，导入旧设置后要求移除旧包 |
| 卸载 | 宿主关闭插件 scope，transform 释放，团队成员从 Agent 状态移除 |

## 存储与模型格式

- 唯一事实源为服务端 `ctx.storage`，逻辑键 `team-policy`。
- 值为 `{ "version": 1, "agents": { "<agentID>": "<model>" } }`。
- `<model>` 为 `providerID/modelID` 或 `providerID/modelID#variant`；模型 ID 自身可包含 `/`，
  因此只在第一个 `/` 分隔供应商。
- 键存在表示启用覆盖；删除该 Agent 的键表示恢复 OpenCode 原生选择。没有 `null` 占位值。
- 宿主为存储键附加插件 ID `opencode-team` 命名空间后写入 OpenCode SQLite 的 `kv` 表。
  这是持久设置，不使用 TTL，也不写 TUI 本地存储或 `opencode.json`。
- 每次 `subagent` 执行前读取同一键，不在 location 实例闭包中缓存设置；保存成功后跨项目生效。
- 只通过宿主存储 API 读写，不直接操作 SQLite 文件。

迁移用独立键 `team-legacy-migration` 记录一次性导入结果，结构为
`{ from, status: "applied" | "empty", model, agents: string[] }`。

## 执行边界

- 只拦截工具 `subagent` 的有效对象输入，其他工具不受影响。
- 从输入读取 `agent` 字符串，按 Agent ID 精确匹配；命中才覆盖 `model`，未命中保持输入原样。
- 命中时无条件覆盖 `model`，无论原值缺省还是显式指定；新建与续接调用一致。
- 不修改主代理的会话模型。`/team` 与 RPC 也会拒绝为主代理写覆盖，并明确说明主代理由
  OpenCode 原生选择。原因：TUI 新会话始终写入 `session.model`，Agent 定义的 `model` 只在没有
  显式选择时兜底；`experimental.model.resolve` 又只能在同供应商内换模型，无法可靠地跨供应商覆盖。
- 读取失败或持久值损坏时阻止 `subagent` 调用，不静默绕过已保存策略。
- 保存时校验当前 location 的可用聊天模型与变体，并校验 Agent 存在且不是 primary；
  清除旧覆盖不要求 Agent 仍存在，便于清理跨项目或已删除的 Agent。只存在于其他项目的自定义
  Agent 需要在该项目打开 `/team` 配置；保存后的策略仍按 Agent ID 全局生效。
- 已保存模型后来不可用时，由内置 `subagent` 的模型解析明确报错，不回退。
- 缺少工具钩子的宿主返回 `supported: false`，TUI 明确提示，不写入策略。
- 执行前与执行后钩子均注册成功后才启用覆盖；任一注册失败时撤销已有注册，撤销失败也保持禁用。

## 旧版迁移与冲突

旧包 `@justsilver/opencode-subagent-model` 的存储命名空间属于它自己的插件 ID，
新插件无法通过官方 `ctx.storage` 读取。不沿用旧 ID：宿主会按 duplicate ID 丢弃后加载的插件，
两份实现无法同时完成交接；也不直接读 SQLite。因此采用“旧插件仍加载时经其 RPC 交接”：

1. 新插件在 setup 时调用 `ctx.plugin.list()`，按旧插件 ID、npm 包名或本地目录末段识别旧包；
   每次读取策略和执行前覆盖前也会重新探测，因为插件 setup 顺序不保证，启动时可能还看不到旧包。
2. 旧插件处于 `active` 时标记冲突；冲突期间新插件不覆盖 `subagent` 输入，也不接受 `/team` 保存，
   避免两份策略按插件顺序互相覆盖。
3. 通过旧插件已注册的 RPC `opencode-subagent-model.getSubagentModel` 读取旧全局模型。
   RPC 按定义 ID 路由，与注册它的插件无关。
4. 旧模型非空时，写入当前 location 中所有非 primary Agent 的覆盖（包括 `general`、`explore`、
   `qa`、`reviewer` 及自定义子代理）；已存在的键不覆盖。旧模型为空时只写 `empty` 标记。
   其他项目独有的自定义 Agent 不在当前列表中，需要在该项目打开 `/team` 重新选择；迁移后新增的
   Agent 也按“未配置即原生”处理。
5. 写入 `team-legacy-migration` 后不再导入；迁移结果通过 RPC 返回给 TUI，提示用户移除旧包并重启。
6. 旧插件在新插件之后才完成 setup 时，首次读取可能拿不到 RPC；迁移会在 `/team` 打开或下一次
   命中覆盖的调用时重试，成功后才固化标记。

限制：旧包已移除后才启动新插件时，旧值仍在 SQLite 的旧命名空间中，但官方插件 API 无法跨命名空间
读取；本插件不直接访问数据库，因此不会自动导入。此时在 `/team` 重新选择即可。

## 主代理知情边界

启用的 `subagent` 调用成功返回后，在原工具返回末尾追加一行，与原文以空行分隔：

```text
[effective subagent model: provider/model#variant (forced by policy)]
```

无变体时不拼 `#variant`。子代理启动确认返回时追加，续接调用同样处理。只改工具返回的 `content`，
不改子代理自己的回答、结构化 `output` 或 `metadata`。未命中策略、其他工具及失败返回均不追加标记；
清除前已派发的调用仍按本次记录告知。

执行前对覆盖后的输入对象作弱引用关联，执行后使用本次覆盖值，不重读设置，避免配置变动或并发串值。
若后续插件替换输入对象或修改其 `model`，不再追加原策略标记，以免误报。其他插件若继续改写结果或
在更晚的模型请求阶段换模型，不在本功能保证范围内。

## TUI 交互

全局 slash / 命令面板入口为 `/team`，打开 Agent Team Dashboard；完整界面契约、数据来源与
键盘/尺寸行为见 [TUI Dashboard](./team-tui.md)。

1. 左侧列出团队 Agent：Orchestrator、所有可见子代理，以及已保存但不在团队视图的覆盖；
   隐藏 Agent 和其他 primary 不进入团队列表，但如果已有覆盖会出现在该分组，只能清除。
   顶部搜索框常驻并默认聚焦，直接输入即过滤。右侧展示角色说明、模型来源、Variant、权限摘要与
   只读 System Prompt。
2. 模型状态区分：primary 无独立模型为“原生”，subagent 无独立模型为“继承”，团队覆盖或
   Agent 配置模型为“自定义”；详情标注来源是团队策略还是 Agent 配置。
3. 选择子代理后打开内嵌模型配置：按 Provider 分组展示模型，搜索框默认聚焦、直接输入即过滤，
   左右方向键切换区域与 Variant，`Enter` 先选思考等级再保存；`ESC` 返回不保存；`Ctrl+R` 恢复原生/
   清除团队覆盖（先在 Modal 内确认）。保存经 RPC 写到服务端，成功或失败都在当前 Modal 的
   状态栏反馈，不再使用宿主 Toast；RPC 显式携带当前 location。
4. 主代理模型只读展示；策略与 RPC 都拒绝为主代理写覆盖。
5. 检测到旧插件时提示迁移结果并要求移除旧插件，不打开可写配置。
6. 宿主不能动态注册团队 Agent 时在面板内警告，但仍允许查看现有 Agent 并配置已存在的子代理。
7. System Prompt 来自宿主当前生效的 `AgentInfo.system`，在详情区完整只读展示；缺失时明确说明，不伪造。
8. 权限摘要按最后命中规则去重，展示效果计数与关键限制；它是规则摘要，不是权限沙箱。

标题与详情中的当前模型优先写可读名称；只有模型已不在目录中时才显示原引用和
「当前目录不可用」。内嵌模型配置直接展示模型名称与完整引用，不再依赖插件侧
`dialog.select` 的 `title`/`category` 过滤。

## 已核实的宿主契约

- `packages/core/src/plugin/host.ts`：`agent.transform` 将编辑回调转交给 `Agent.Service`；
  `storage(kv, pluginID)` 只用插件 ID 作为命名空间。
- `packages/core/src/agent.ts` 与 `packages/core/src/state.ts`：transform 按注册顺序重放；
  注册/释放会重建状态并通知。
- `packages/core/src/plugin/supervisor.ts`：重复插件 ID 会被记为失败；外部插件在 `pre`，
  配置 Agent 插件在 `post`，因此用户 Agent 配置覆盖插件默认值。
- `packages/core/src/agent.ts`：默认主代理依次取 `data.default`、内置 `build`、首个可选 primary；
  本插件不调用 `editor.default`，所以不会抢占默认主代理。
- `packages/core/src/plugin.ts` 与 `packages/core/src/state.ts`：每个插件有独立 activation scope，
  卸载时关闭 scope，`agent.transform` 的 finalizer 会移除团队成员。
- `packages/core/src/plugin/host.ts` 的 `rpc.client` 与 `packages/core/src/rpc.ts` 的 `call`：
  客户端按定义 ID 调用，能够读取另一个已加载插件注册的 RPC。
- `packages/core/src/tool/plugin/subagent.ts`：`input.agent` 是调用方指定的 Agent ID；
  `input.model` 优先于 Agent 配置和父会话模型；续接也会切换模型。
- `packages/core/src/permission.ts`：Agent 权限先与会话权限合并，规则从后往前匹配；`deny` 在
  saved “always allow” 之前判定，saved allow 只能把 `ask` 结算为 `allow`，不能覆盖 `deny`。
  `shell` 解析出的每条命令分别断言，复合命令任一条拒绝则整体拒绝。
- `packages/core/src/tool.ts`：工具是否暴露只看对应 action 的最后一条规则；最后一条是全资源
  `deny` 时工具隐藏，否则保留并按每次调用的 resource 继续判定。
- `packages/core/src/tool/plugin/{edit,write}.ts` 与 `packages/core/src/file-write.ts`：
  `edit`、`write`、`patch` 共用 `edit` 权限动作，resource 是 location 相对路径或外部绝对路径。
- `packages/core/src/session/runner/step.ts`：子会话执行工具时把 `input.agent` 放进 `Tool.Context`，
  因此子代理使用自己的 Agent 权限；派生新子代理的 `subagent` 权限断言使用父会话 Agent。
- `packages/core/src/session/runner/model.ts`：`experimental.model.resolve` 只能在同供应商内换模型，
  不能作为跨供应商的主代理覆盖方案，因此本插件不采用它。
- `packages/tui/src/ui/dialog.tsx` 与 `packages/plugin/src/tui/context.ts`：`dialog.show` 支持插件
  JSX，`show` 会重置尺寸，`set` 必须在挂载后调用；`ctx.data.location.agent` 提供当前 location
  的 Agent 列表，`ctx.data.location.model` 提供模型与 Variant 能力。

## 验证

`node --test` 覆盖：按 Agent 精确覆盖、未命中保留原生、清除恢复、模型/变体校验、
未知 Agent 与 primary 拒绝、跨实例共享、存储损坏/失败阻止调用、启动确认与并发返回标记、旧插件冲突
（含 setup 顺序漏检后的动态发现）、一次性迁移、用户配置覆盖、团队权限策略、Dashboard 状态/搜索/
尺寸模型，以及内嵌模型配置的 Provider 分组、区域切换、过滤后选中项、语义色映射、Variant、
保存与失败提示。权限用例复刻宿主的最后命中、deny 优先于 saved allow、会话追加、
工具可见性、`edit/write/patch` 共用动作和子会话取用规则，并验证插件只注入 QA/Reviewer 的
`question` 拒绝、用户配置可覆盖。TUI 视觉、键盘与真实交互由用户手动验证，不提交临时渲染脚本；
双入口 esbuild、`npm pack --dry-run`、`git diff --check` 作为回归验证。
未进行真实供应商请求或旧 SQLite 数据操作。
