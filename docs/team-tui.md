<!-- 职责：TUI Dashboard 的架构、数据来源、状态语义、键盘与验证；不写：安装教程、模型策略存储契约、发布流程。 -->

# TUI Dashboard

`/team` 的 TUI 入口是 `plugin/opencode-team/tui.ts`，界面实现按职责拆分：

```text
plugin/opencode-team/
  tui.ts                  全局 /team 命令
  view/configure.tsx      打开 Dashboard，注入保存/恢复回调
  view/dashboard.tsx      Dashboard JSX（Agent 列表、详情、Prompt）
  view/model-config.tsx   内嵌模型配置 JSX（Provider 分组、搜索、Variant）
  view/ui.tsx             共享主题组件（Divider/Badge/Section/Hints）
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
- OpenCode 的 TUI 运行时会提供 `@opentui/core`、`@opentui/solid`、`solid-js`，
  并按 Solid 规则转换本地 `.tsx`。插件包把这些包声明为 peerDependencies，不额外打包另一套运行时。
- `view/team.ts` 不依赖 TUI 渲染；模型保存复用 `setAgentModel` RPC、存储与错误处理。

验证与构建命令见 [CONTRIBUTING](../CONTRIBUTING.md#验证)。

## 数据来源

`loadTeamDashboard` 在打开时读取：

- 团队模型策略：`getTeamPolicy` RPC。
- Agent 定义：`ctx.data.location.agent.sync()` 后读取。同步失败但存在缓存时继续展示，
  并明确标注内容可能不是最新；没有缓存则报错，不打开面板。
- 模型目录与供应商：只用于展示名称和模型选择；目录失败时面板仍可查看 Agent 与 Prompt，
  模型名称回退为原始引用；保存时由服务端重新校验。
- 策略冲突、缺少工具钩子、策略损坏：按原有安全路径直接阻止打开。

Dashboard 只展示团队范围：Orchestrator、所有可见子代理，以及已保存但不在团队视图的覆盖。
Build/Plan 等其他 primary 和隐藏 Agent 不进入团队列表；如果它们已有保存的覆盖，会出现在
「已保存但不在团队视图」中，只能清除。模型覆盖仍然只写子代理。

## 模型状态

| 状态 | 条件 | 模型行 | 来源 |
|---|---|---|---|
| 原生 | primary 且无团队覆盖、无 Agent 配置模型 | OpenCode 原生选择 | 无独立模型 |
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

- 主要信息（Agent 名称、模型名称、当前配置）使用 `text.base`；当前项加粗。
- 次要信息（模型 ID、来源、角色描述）使用 `text.muted`。
- 辅助信息（来源、说明、快捷键标签）也使用 `text.muted`；`text.faint` 只留给分隔点、
  未选中行的占位标记等不承载信息的位置。
- Provider 分组标题使用宿主强调色阶 `theme.hue.accent[200]`（默认主题为紫色）并加粗，
  与模型名称形成层级；右侧数量使用次要文字色。
- 选中行统一使用 `background.raised.high` 抬升表面、强调色左侧指示条和 `text.base` 正文；
  不再用整行主操作色填充。当前操作区域由面板边框或标题表示。
- 状态语义固定：原生 / 继承用次要文字色，自定义用主题强调色；权限拒绝用错误色、
  询问用警告色，允许规则保持中性以减少干扰。Badge 背景由
  `theme.decrease(theme.background.base)` 从主题推导，不在组件里维护另一套颜色。
- 当前模型卡片使用抬升表面和强调色左边条；权限详情整体降低视觉权重。
- Dashboard 左侧只保留 Agent 名称与状态，仅自定义模型追加当前模型行，避免与“继承”状态重复；
  模型行按词换行完整显示 Provider、模型与 Variant，不截断关键信息。
- 内容超过面板高度时，详情、Agent 列表、模型列表和 Variant 面板右侧显示常驻主题滚动条，
  使用 `theme.scrollbar` 颜色并绝对定位，不因滚动条出现而改变内容宽度。
- 标题、分组标题、分隔线、选中态在 Dashboard、Provider 分组、模型列表和 Variant 面板
  共用 `view/ui.tsx` 的定义；界面快捷键提示统一写作 `ESC`。

## 键盘与布局

Dashboard：

| 按键 | 行为 |
|---|---|
| 直接输入 | 顶部搜索框常驻并默认聚焦，输入即过滤 Agent |
| `↑↓` | 选择 Agent |
| `Home` / `End` | 首个/最后一个 Agent |
| `PgUp` / `PgDn` | 滚动详情或列表 |
| `Enter` | 打开内嵌模型配置；单栏模式下先进入详情；确认条出现时执行确认 |
| `Ctrl+R` | 清除团队覆盖；无覆盖时只提示；执行前在 Modal 内确认 |
| `ESC` | 取消确认 / 返回列表 / 关闭面板 |

模型配置：

| 按键 | 行为 |
|---|---|
| `↑↓` | 移动当前焦点：模型列表或 Variant 列表 |
| `←` / `→` | 在模型列表与 Variant 面板之间切换焦点 |
| `Tab` / `Shift+Tab` | 与左右方向键等效的区域切换 |
| 直接输入 | 搜索框默认聚焦，输入即过滤模型、Provider 与引用 |
| `Enter` | 模型列表中有 Variant 时先进入思考等级面板；无 Variant 或已在思考等级面板时保存；确认条出现时执行确认 |
| `Ctrl+R` | 恢复原生 / 清除团队覆盖；先在 Modal 内确认 |
| `PgUp` / `PgDn` | 滚动模型或 Variant |
| `ESC` | 取消确认 / 返回 Dashboard，不保存 |

Dashboard 与模型配置的搜索框都常驻并默认聚焦，不需要按 `/` 进入搜索；Backspace、Delete、
粘贴和中文输入法都由宿主输入组件处理。`j`、`k`、`r`、`/` 会作为普通字符输入查询，
不再触发导航或恢复。模型配置的过滤实时更新 Provider 分组与数量，空分组不显示；没有结果时
显示明确提示，清空查询后恢复完整列表。搜索变化后选中项落到第一个可见模型，没有可见模型时
不保留旧选中项。

- 宽度 `< 90`：Dashboard 单栏，列表与详情切换；模型配置也只显示当前焦点面板。
- 高度 `< 20` 或宽度 `< 100`：Agent/模型行使用紧凑布局。
- 宽度 `< 50`：只保留核心快捷键；Dashboard 与模型配置的搜索框始终显示，支持直接输入。
- 尺寸变化通过 `useTerminalDimensions()` 响应式重算。

## 内嵌模型配置

模型配置是 Dashboard 内的视图，不替换弹窗、不重新打开 Dashboard：

- 顶部显示 Agent、当前模型与来源；搜索输入框默认聚焦，输入即按 Provider 分组过滤模型。
- 在模型列表按 `Enter`：模型有 Variant 时先切到右侧思考等级面板，选中等级后再按 `Enter` 保存；
  没有 Variant 时直接保存。保存成功后停留在当前配置页并更新“当前”标记。
- Provider 标题使用主题强调色并加粗，右侧显示该组过滤后的模型数；组之间用低对比度分隔线，
  标题随列表滚动，模型行比标题低一级缩进。
- 左侧模型列表显示模型名称与完整引用，当前生效模型有“当前”标记；焦点区域强高亮，
  失焦区域保留弱高亮，两行文字都保持可读对比度。
- 右侧 Variant 面板显示所选模型；Variant 直接来自 `ModelInfo.variants`，
  没有 Variant 的模型明确提示“该模型不提供 Variant”，保存时只写基础引用；
  无 Variant 时焦点不会停留在该面板。
- 切换模型会立即刷新 Variant 列表；模型和 Variant 只维护本地待保存状态，
  保存时才调用一次 `setAgentModel`，取消或保存失败不改变已有配置。
- 保存失败时保留在配置页，并在 Modal 内状态栏显示错误详情；保存成功后同样停留在配置页，
  立即更新当前模型与状态，不自动返回 Dashboard，由 `ESC` 返回。
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
  鼠标选择和恢复操作暂停，避免误触。
- 异步保存/恢复完成前会显示处理中状态；关闭 Modal 后通过销毁标记丢弃后续状态更新，
  不向已卸载组件写入反馈或关闭动作。

## 验证

```bash
npm install --no-package-lock
npm run typecheck
node --test
npx --yes esbuild plugin/opencode-team/tui.ts --bundle --platform=node --format=esm \
  --jsx=automatic --jsx-import-source=@opentui/solid \
  --external:@opencode/plugin/tui --external:@opentui/core \
  --external:@opentui/solid --external:solid-js --outfile=dist/team-tui.js
npm pack --dry-run
git diff --check
```

自动验证只覆盖 `node --test`、构建与打包；TUI 视觉、终端尺寸和真实交互由用户手动验证，
临时渲染脚本和截图不入库。TUI 代码更新后必须完全重启 OpenCode 才能加载新入口。
