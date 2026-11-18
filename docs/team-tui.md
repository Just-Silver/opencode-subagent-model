<!-- 职责：TUI Dashboard 的架构、数据来源、状态语义、键盘与验证；不写：安装教程、模型策略存储契约、发布流程。 -->

# TUI Dashboard

`/team` 的 TUI 源码入口是 `plugin/opencode-team/tui.ts`（npm 包通过 `dist/tui.js` 加载），界面实现按职责拆分：

视觉参考见 `docs/UI参考图/团队管理.png` 与 `docs/UI参考图/模型配置.png`（仅作设计对照，不参与构建）。

```text
plugin/opencode-team/
  tui.ts                  全局 /team 命令
  view/configure.tsx      打开 Dashboard，注入保存/恢复回调
  view/dashboard.tsx      Dashboard JSX（Agent 列表、详情、Prompt）
  view/model-config.tsx   内嵌模型配置 JSX（Provider 分组、搜索、Variant）
  view/ui.tsx             共享主题组件（标题、分组、搜索、Badge、分隔线、图例、提示）
  view/model.ts           纯视图模型（状态、Prompt、权限、搜索、尺寸）
  view/team.ts            数据加载、保存与恢复 RPC
```

`view/model.ts` 与 `view/team.ts` 不导入 JSX，可直接用 `node --test` 验证；
JSX 只在 `view/*.tsx` 中出现。

## 宿主能力与运行方式

- Dashboard 使用 `ctx.ui.dialog.show()` 渲染自定义 JSX，`ctx.ui.dialog.set({ size: "xlarge", centered: true })`
  设置展示方式。`show()` 会把弹窗重置为 `medium`，所以尺寸必须在挂载后设置。
- 全局 `/team` 命令层保持 `mode: "global"`；Dashboard 键盘层是
  `mode: "modal"`、`priority: 10`，模型配置键盘层是 `mode: "modal"`、`priority: 20`。
  模型配置打开时 Dashboard 层通过 `enabled: () => !modelOpen()` 停止响应。
- OpenCode 的 Solid 转换只作用于不在 `node_modules` 内的源码。本地目录插件因此可以直接加载
  `tui.ts` 与 `.tsx`；npm 安装的插件位于 `node_modules` 下，`.tsx` 不会被转换
  （anomalyco/opencode#39986），现象是首帧渲染后不再重绘，或直接报找不到
  `@opentui/solid`。
- 因此发布包把 TUI 依赖图预编译成 `dist/*.js`，`exports["./tui"]` 指向 `dist/tui.js`；编译产物
  显式 import `@opentui/solid`、`solid-js`、`@opencode/plugin/tui`，由宿主的运行时改写指向宿主实例，
  插件侧不再需要本地副本。
- `@opentui/core`、`@opentui/solid`、`solid-js` 保持 **optional** peerDependencies：npm 不会安装
  副本；一旦装出 0.9.x 等不同 minor，会与宿主的 0.8.x 并存并破坏响应式。
- `view/team.ts` 不依赖 TUI 渲染；模型保存复用 `setAgentModel` RPC、存储与错误处理。

## 构建

`npm run build:tui`（由 `prepack` 自动执行）用 `babel-preset-solid`（`moduleName: "@opentui/solid"`、
`generate: "universal"`）从 `tui.ts` 出发递归编译 TUI 依赖图：

```text
tui.ts → rpc.ts, view/configure.tsx
view/configure.tsx → dashboard.tsx, model.ts, team.ts
view/dashboard.tsx → model-config.tsx, ui.tsx, model.ts, team.ts
view/model.ts → ../model-ref.ts, ../team-ids.ts
```

产物保持目录结构、相对导入改写为 `.js`，不打包第三方依赖。`dist/` 是构建产物，不提交；发布前由
`prepack` 清理并重建，避免残留旧的 `.js`。本地目录调试仍加载源码，改动 `view/*.tsx` 后无需构建。

验证与构建命令见 [AGENTS](../AGENTS.md#验证要求)。

## 数据来源

`loadTeamDashboard` 在打开时读取：

- 团队模型策略：`getTeamPolicy` RPC。
- Agent 定义：`ctx.data.location.agent.sync()` 后读取。同步失败但存在缓存时继续展示，
  并明确标注内容可能不是最新；没有缓存则报错，不打开面板。
- 模型目录与供应商：只用于展示名称和模型选择；目录失败时面板仍可查看 Agent 与 Prompt，
  模型名称回退为原始引用；打开模型配置时会重试一次，保存时由服务端再校验。
- 策略冲突、缺少工具钩子、策略损坏：按原有安全路径直接阻止打开。
- 模型收藏：存于 TUI 插件持久存储 `team-favorites`（基础模型引用，不含 Variant），跨重启保留、
  多个 TUI 实例同步；不进入模型策略，也不读写 `/models` 的私有收藏。
- 宿主 `ctx.storage.store` 按存储文件路径缓存实例（`packages/tui/src/context/storage.tsx`），
  同一 key 重复获取返回同一个 store 与 update 闭包，重复打开 `/team` 不会累积订阅。

Dashboard 只展示团队范围：Orchestrator、所有可见子代理，以及已保存但不在团队视图的覆盖。
Build/Plan 等其他 primary 和隐藏 Agent 不进入团队列表；如果它们已有保存的覆盖，会出现在
「已保存但不在团队视图」中，只能清除。模型覆盖仍然只写子代理。

团队列表上方有一行独立的「默认代理 · Orchestrator」设置：空查询且存在 Agent 行时显示，
选中后搜索框失焦、`空格` 切换（也可鼠标点击）；搜索时隐藏，避免空格被开关拦截。
极窄终端收为单行（保留开关与状态，隐藏说明文字）。
开关存入 `team-policy` 的 `defaultAgent`，切换后调用 RPC 并 `agent.reload()`，
影响新会话默认代理；已有会话不变。其他 location 的插件实例在打开面板或重启后同步。
该行只调整新会话的默认主代理，不删除、不隐藏 Orchestrator：它仍在 `PRIMARY` 分组中，
模型与角色信息照常展示。

## 模型状态

| 状态 | 条件 | 模型行 | 来源 |
|---|---|---|---|
| 原生 | primary 且无团队覆盖、无 Agent 配置模型 | OpenCode 会话选择 | 无独立模型 |
| 继承 | subagent 且无团队覆盖、无 Agent 配置模型 | 继承调用方模型 | 无独立模型 |
| 自定义 | 存在团队覆盖 | 宿主目录中的名称 + variant | 团队策略 |
| 自定义 | 无团队覆盖，但 Agent 配置了 `model` | 宿主目录中的名称 + variant | Agent 配置 |

团队覆盖优先于 Agent 配置。清除团队覆盖后，面板重新计算为“Agent 配置”或“原生/继承”。
主代理模型始终由 OpenCode 会话选择，面板只读展示，不写入覆盖。

## System Prompt

- 完整内容来自宿主当前生效的 `AgentInfo.system`，界面只读。
- 详情区直接显示完整 Prompt，复用详情面板已有的滚动条，不再有预览或独立的 Prompt 页。
- `agent.system` 缺失或为空白时，面板明确说明宿主没有提供独立 System Prompt，
  不生成、不补全、不伪造内容。

## 权限摘要

权限摘要按宿主合并后的规则计算：

- 相同 `action + resource` 只保留最后一次规则，符合宿主“最后命中”的语义。
- 统计允许、询问、拒绝的生效规则数，展示默认 `*/*` 规则与少量关键限制。
- 文案明确这是规则效果摘要，**不是权限沙箱**；Shell 仍可能写文件，需要硬限制时由用户配置
  Agent 权限。

## 配色与视觉层级

界面只使用宿主 `ResolvedTheme` 的语义 token，不硬编码 RGB，深色与浅色主题都随宿主解析：

- 两个视图共用 `view/ui.tsx` 的 `ViewHeader`：`Agent Team / 当前页` 加右侧 `ESC` 提示，
  标题下方一条分隔线；不再重复副标题。
- 主要信息（Agent 名称、模型名称、当前配置）使用 `text.base`；当前项加粗。
- 次要信息（模型 ID、来源、角色描述、分组计数）使用 `text.muted`；`text.faint` 只留给
  分隔点、未选中行的占位标记等不承载信息的位置。
- 分组标题统一用 `GroupHeader`：Provider 分组使用宿主强调色阶 `theme.hue.accent[200]`，
  Agent 分组使用次要文字色，数量固定在右侧，不再塞进标题文本（搜索后只更新右侧数量）。
- Agent 列表默认两行：第一行名称 + 来源短标签（团队 / Agent / 原生 / 继承），
  第二行 `Provider · Model · Variant`。来源短标签只描述配置来源，选中态由左侧强调条和
  低对比抬升背景表示，二者不共用同一颜色语义。
- Provider 只有在完整显示、且模型名仍能保留至少 16 格时才进入第二行；短模型即使低于
  16 格也优先完整展示 Provider。空间不足时 Provider 让位，完整引用始终在详情区展示。
- 模型名过长时保留首词与末尾版本词（如 `DeepSeek … Flash 1017`），并跳过中间放不下的词，
  优先保留版本号等辨识信息。
- 选中行统一使用抬升表面和左侧指示条；模型配置再叠加面板焦点：聚焦面板边框与标题用强调色、
  背景轻微提亮，失焦面板保持普通边框与对话背景。行选中的强弱由所在面板是否聚焦决定，
  当前焦点不会覆盖“当前生效/待保存”的文字语义。
- 模型配置的状态语义固定：`当前` 仅表示生效配置，使用强调色文字；`待保存` 仅表示用户改动后的
  未提交配置，使用警告色；行选中只使用背景和 `|` 指示条，不借用上述两种颜色或文字标记。
- 状态语义固定：原生 / 继承用次要文字色，团队覆盖与 Agent 配置用主题强调色；
  权限拒绝用错误色、询问用警告色，允许规则保持中性以减少干扰。Badge 背景由
  `theme.decrease(theme.background.base)` 从主题推导，不在组件里维护另一套颜色。
- 详情区按「身份与类型 → 当前模型与来源 → 角色职责 → 权限摘要 → System Prompt」
  排列；当前模型卡片使用抬升表面和强调色左边条，其余章节由 `SectionHeading` 统一
  「分隔线 + 标题」，Prompt 只读且完整。
- 可滚动的内容区（详情、Agent 列表、模型列表、右侧模型详情与 Variant）超过可用高度时，
  右侧显示常驻主题滚动条，使用 `theme.scrollbar` 颜色并绝对定位，不因滚动条出现而改变内容宽度。
- 标题、分组标题、分隔线、选中态在 Dashboard、Provider 分组、模型列表和 Variant 面板
  共用 `view/ui.tsx` 的定义；界面快捷键提示统一写作 `ESC`。

## 键盘与布局

Dashboard：

| 按键 | 行为 |
|---|---|
| `直接输入` | 顶部搜索框常驻并默认聚焦，输入即过滤 Agent |
| `↑↓` | 在「默认代理」设置行与 Agent 行之间选择 |
| `Home` / `End` | 首个/最后一个可选行 |
| `PgUp` / `PgDn` | 滚动详情或列表 |
| `Enter` | 打开内嵌模型配置；单栏模式下先进入详情；确认条出现时执行确认 |
| `Ctrl+R` | 清除团队覆盖；无覆盖时只提示；执行前在 Modal 内确认 |
| `空格` | 选中「默认代理」设置行时切换开关 |
| `ESC` | 取消确认 / 返回列表 / 关闭面板 |

模型配置：

| 按键 | 行为 |
|---|---|
| `↑↓` | 移动当前焦点：模型列表或右侧详情/Variant；右侧无 Variant 时继续在模型间移动 |
| `←` / `→` | 在模型列表与右侧面板之间切换焦点 |
| `Tab` / `Shift+Tab` | 与左右方向键等效的区域切换 |
| 直接输入 | 搜索框默认聚焦，输入即过滤模型、Provider 与引用 |
| `Enter` | 单栏：先在模型列表进入右侧详情；双栏有 Variant 时先聚焦 Variant；右侧面板中保存；确认条出现时执行确认 |
| `Ctrl+R` | 恢复原生 / 清除团队覆盖；先在 Modal 内确认 |
| `Ctrl+F` | 收藏 / 取消收藏当前模型；全局共享，与 `/models` 的收藏互相独立 |
| `PgUp` / `PgDn` | 滚动模型或 Variant |
| `ESC` | 取消确认 / 返回 Dashboard，不保存 |

Dashboard 与模型配置的搜索框都常驻并默认聚焦，不需要按 `/` 进入搜索；Backspace、Delete、
粘贴和中文输入法都由宿主输入组件处理。`j`、`k`、`r`、`/` 会作为普通字符输入查询，
不再触发导航或恢复。模型配置的过滤实时更新 Provider 分组与数量，空分组不显示；没有结果时
显示明确提示，清空查询后恢复完整列表。搜索变化后选中项落到第一个可见模型，没有可见模型时
不保留旧选中项。

- 宽度按弹窗内容宽度判断（弹窗上限 116 列，含左右内边距）：内容 `< 88` 时 Dashboard 单栏，
  列表与详情切换；模型配置也只显示当前焦点面板。
- 高度 `< 14` 或内容宽度 `< 60`：Agent 行退化为单行（只保留名称与来源），详情隐藏次要说明。
- 高度 ≤ 28 行（弹窗高度 ≤ 24）：收紧 AgentCard 内边距、搜索与底栏的固定占位，
  避免 80×24 / 100×24 / 25–28 行终端下 Variant 列表和状态摘要没有空间；
  右侧详情整体可滚动，低高度不会丢失 Variant 或摘要。
- 内容宽度 `< 46`：只保留核心快捷键；搜索框始终显示，支持直接输入。
- 宽度分界用弹窗实际可用宽度计算，80 / 100 / 120 / 160 列终端都能稳定降级或保持双栏。
- 尺寸变化通过 `useTerminalDimensions()` 响应式重算。

## 内嵌模型配置

模型配置是 Dashboard 内的视图，不替换弹窗、不重新打开 Dashboard：

- 顶部显示 Agent、角色与配置来源、当前模型；搜索输入框默认聚焦，输入即按 Provider 分组过滤模型，
  搜索栏右侧显示过滤后的数量。
- 当前模型及其 Provider 分组排在列表最前，当前模型位于首行，打开首帧即可见；收藏组内同样
  先排当前模型。宿主对 `current` 的定位滚动延后到下一帧，不能依赖滚动了事。
- 模型行单行展示：名称（过长时保留首尾关键信息）、收藏组内的 Provider（用于区分同名模型）、
  当前或待保存标记；完整引用只在右侧详情展示，行内不再重复完整 ID。
- 右侧展示所选模型的完整引用、上下文窗口与价格（目录没有价格时不显示），下方是 Variant；
  单栏模式下按 `Enter` 或 `→` 进入右侧查看，完整 ID 与价格不再依赖列表宽度。
  双栏比例优先保证模型列表宽度，Variant 面板在宽终端固定 34 列、100 列终端 30 列，
  不再用大块留白。
- 三种状态互不混淆：`当前` 表示已生效配置，强调色；键盘选中使用左侧指示条与背景
  （聚焦面板强、失焦面板弱）；`待保存` 表示用户改动后尚未提交的模型或 Variant，警告色。打开面板时的自动首选项不算待保存；
  没有生效配置时右侧显示“未设置覆盖”，选中项与生效配置不同但用户未改动时显示“当前生效”
  并保留当前模型说明。底部图例解释颜色含义（窄终端隐藏）。
- 在模型列表按 `Enter`：单栏先进入右侧详情；双栏且模型有 Variant 时聚焦思考等级面板；
  在右侧面板再按 `Enter` 保存。没有 Variant 时也只写模型引用。保存成功后停留在当前配置页，
  `当前` 标记与“当前配置”摘要立即更新。
- Provider 标题使用主题强调色并加粗，右侧显示该组过滤后的模型数；组之间用一个空行分隔，
  不再叠加分隔线与空白，模型行比标题低一级缩进。
- 左侧模型列表显示模型名称与当前/待保存标记；行选中始终用指示条与背景表示。
- 模型配置使用两层面板焦点：聚焦面板有强调色圆角边框、标题 `› 模型列表 / 思考等级`
  和轻微抬升背景；失焦面板使用普通边框与对话背景。行选中独立于面板焦点：聚焦面板用
  `raised.high` + 亮色 `|`，失焦面板用 `raised.base` + 次要色 `|`，选中位置始终保留。
  边框强调、方向符和背景差异共同表达焦点，不额外增加说明文字。
- 右侧的模型信息、Variant 列表与待保存摘要整体放在同一个滚动容器里；低高度终端也能滚动查看，
  不会因固定区块挤压而丢失 Variant 或摘要。
- 底部快捷键提示把当前面板的主操作（`Enter`）用强调色加粗显示；宽终端同时显示
  `当前 / 选中 / 待保存` 图例（窄终端隐藏）。面板切换仍用 `←→` / `Tab`。
- 右侧面板显示所选模型；Variant 直接来自 `ModelInfo.variants`，
  没有 Variant 的模型明确提示“该模型不提供 Variant”，保存时只写基础引用；
  此时右侧仍可查看完整模型信息和待保存摘要，`↑↓` 继续在模型间移动。
- 恢复原生后，如果生效模型仍是同一个基础引用，本地 Variant 会按宿主当前值回填，
  避免下一次保存静默写回旧 Variant。
- 切换模型会立即刷新 Variant 列表；模型和 Variant 只维护本地待保存状态，
  保存时才调用一次 `setAgentModel`，取消或保存失败不改变已有配置。
- 保存或恢复失败时保留在配置页，并在 Modal 内状态栏显示错误详情；右侧按操作类型标记
  “保存失败”或“恢复失败”，可重试。
- 有收藏时列表顶部显示 `FAVORITES` 分组，收藏模型不再出现在 Provider 分组；搜索同样过滤，
  空分组不显示；分组本身表示收藏状态，行内不再重复标记，`Ctrl+F` 切换当前模型。
- 重复打开会以当前覆盖重新初始化；窄终端通过左右方向键或 `Tab` 在单栏之间切换。

## Modal 内反馈

`/team` 打开期间，操作状态统一由 Dashboard 的 Solid 状态管理，并同时传给模型配置视图：

- 状态栏作为独立布局行放在快捷键栏上方，不覆盖 Agent/模型列表、搜索框、Variant 或底栏。
- 成功、普通状态使用紧凑状态栏并自动收起；警告停留更久；错误常驻并换行展示完整内容，
  直到下一次操作或关闭 Modal。
- 保存成功、RPC 失败、恢复原生、无覆盖提示、主代理/失效 Agent 提示、搜索无结果都在当前
  Modal 内反馈，不再调用可能被弹窗层遮挡的宿主 Toast。
- 模型目录或 Agent 同步失败仍由面板顶部的告警条说明；阻止打开（没有 Modal）时才使用宿主 Toast。
- 清除团队覆盖前在 Modal 内显示确认条：`Enter` 确认、`ESC` 取消；确认期间其他导航、搜索、
  鼠标选择、收藏和恢复操作暂停，避免误触。
- 异步保存/恢复完成前会显示处理中状态；关闭 Modal 后通过销毁标记丢弃后续状态更新，
  不向已卸载组件写入反馈或关闭动作。

## 验证

```bash
npm install --no-package-lock
npm run typecheck
npm run check:prompts
npm run build:tui
node --test
npm run bundle:check
npm pack --dry-run
git diff --check
```

自动验证只覆盖 `node --test`、构建与打包；TUI 视觉、终端尺寸和真实交互由用户手动验证，
临时渲染脚本和截图不入库。TUI 代码更新后必须完全重启 OpenCode 才能加载新入口。
