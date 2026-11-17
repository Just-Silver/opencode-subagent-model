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
  模型名称回退为原始引用，选择模型时再重试。
- 策略冲突、缺少工具钩子、策略损坏：按原有安全路径直接阻止打开。

Dashboard 只展示团队范围：Orchestrator、所有可见子代理，以及已保存但当前不可用的覆盖。
Build/Plan 等其他 primary 不进入列表；隐藏 Agent 不展示。模型覆盖仍然只写子代理。

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
- `agent.system` 缺失或为空白时，面板明确说明宿主没有提供独立 System Prompt，
  不生成、不补全、不伪造内容。
- `AgentInfo.system` 只是 Agent 定义中的 System Prompt；请求时宿主还会附加全局
  instructions、工具说明与环境信息，插件无法读取完整拼装结果。界面会明确说明这一点。
- `P` 打开完整 Prompt 页，可滚动；`P` 或 `Esc` 返回 Dashboard。

## 权限摘要

权限摘要按宿主合并后的规则计算：

- 相同 `action + resource` 只保留最后一次规则，符合宿主“最后命中”的语义。
- 统计允许、询问、拒绝的生效规则数，展示默认 `*/*` 规则与少量关键限制。
- 文案明确这是规则效果摘要，**不是权限沙箱**；Shell 仍可能写文件，需要硬限制时由用户配置
  Agent 权限。

## 键盘与布局

Dashboard：

| 按键 | 行为 |
|---|---|
| `↑↓` / `j k` | 选择 Agent；Prompt 页滚动 |
| `Home` / `End` | 首个/最后一个 Agent；Prompt 页到顶/到底 |
| `PgUp` / `PgDn` | 滚动详情或 Prompt |
| `Enter` | 打开内嵌模型配置；单栏模式下先进入详情 |
| `P` | 完整 System Prompt / 返回 |
| `R` | 清除团队覆盖；无覆盖时只提示 |
| `/` | 进入搜索 |
| `Esc` | 退出搜索 / 返回列表 / 关闭面板 |

模型配置：

| 按键 | 行为 |
|---|---|
| `↑↓` / `j k` | 移动当前焦点：模型列表或 Variant 列表 |
| `Tab` / `Shift+Tab` | 在模型、Variant、搜索之间切换焦点 |
| `Enter` | 一次性保存当前模型与 Variant；失败时留在配置页 |
| `/` | 聚焦搜索并过滤模型名称、Provider、引用 |
| `R` | 恢复原生 / 清除团队覆盖 |
| `PgUp` / `PgDn` | 滚动模型或 Variant |
| `Esc` | 退出搜索 / 返回 Dashboard，不保存 |

搜索只在搜索态挂载输入框，其余时间不占用字符快捷键。搜索匹配名称、角色、状态、来源和模型名；
过滤后子代理计数随之更新。

- 宽度 `< 90`：Dashboard 单栏，列表与详情切换；模型配置也只显示当前焦点面板。
- 高度 `< 20` 或宽度 `< 100`：Agent/模型行使用紧凑布局。
- 宽度 `< 50`：只保留核心快捷键；模型配置隐藏常驻搜索栏，按 `/` 展开。
- 尺寸变化通过 `useTerminalDimensions()` 响应式重算。

## 内嵌模型配置

模型配置是 Dashboard 内的视图，不替换弹窗、不重新打开 Dashboard：

- 顶部显示 Agent、当前模型与来源；搜索栏按 Provider 分组过滤模型。
- 左侧模型列表显示模型名称与完整引用，当前生效模型有“当前”标记。
- 右侧 Variant 面板显示所选模型；Variant 直接来自 `ModelInfo.variants`，
  没有 Variant 的模型明确提示“该模型不提供 Variant”，保存时只写基础引用。
- 模型和 Variant 只维护本地待保存状态；`Enter` 才调用一次 `setAgentModel`，
  `Esc` 取消不修改已有配置。
- 保存失败时保留在配置页并显示“保存失败，可重试”；成功后才返回 Dashboard 并更新模型显示。
- 重复打开会以当前覆盖重新初始化；窄终端通过 `Tab` 在模型/Variant 单栏之间切换。

## 验证

```bash
node --test
bun test --conditions=browser --preload @opentui/solid/preload ./<临时渲染测试>.test.ts
npx --yes esbuild plugin/opencode-team/tui.ts --bundle --platform=node --format=esm \
  --jsx=automatic --jsx-import-source=@opentui/solid \
  --external:@opencode/plugin/tui --external:@opentui/core \
  --external:@opentui/solid --external:solid-js --outfile=dist/team-tui.js
npm pack --dry-run
git diff --check
```

渲染冒烟测试覆盖 120×32、80×24、40×12，Dashboard 选择/搜索/Prompt/单栏，以及模型配置的
Provider 分组、搜索、Tab 焦点、Variant 选择、一次性保存、取消、恢复原生和保存失败。
临时渲染测试用于本地验证，不提交；TUI 代码更新后必须完全重启 OpenCode 才能加载新入口。
真实 TUI 冒烟验证过 `/team` 打开 Dashboard、鼠标选择 Agent、`Enter` 打开模型配置、
`Tab` 切换 Variant 焦点、`Esc` 返回且不保存。
