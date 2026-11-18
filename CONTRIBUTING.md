<!-- 职责：贡献者的开发、验证与 npm 分发；不写：使用教程、重复策略契约。 -->

# 贡献指南

文档地图见 [AGENTS.md](AGENTS.md#文档地图)。

## 环境与结构

Node ≥ 24，TypeScript 源文件直接由宿主加载，测试使用 Node 原生类型擦除，无运行时依赖。
`npm install` 用于安装 `typecheck` 需要的宿主类型声明，不是运行测试或本地目录加载的前置条件。

```text
plugin/opencode-team/
  index.ts                 server：注册团队 Agent、策略和 RPC
  tui.ts                   TUI：全局 /team 命令
  rpc.ts                   getTeamPolicy / setAgentModel 的 JSON Schema 契约
  policy.ts                存储、校验、旧版迁移、执行前覆盖和执行后告知
  model-ref.ts             模型引用解析、格式化与 chat 模型判定
  team-ids.ts              团队子代理固定顺序
  team-agents.ts           Orchestrator / QA / Reviewer 定义（QA/Reviewer 拒绝 question 与 subagent）
  prompts.ts               三份 System Prompt 与职责边界
  legacy.ts                旧插件检测与冲突信息
  view/configure.tsx       打开 Dashboard，注入保存/恢复回调
  view/dashboard.tsx       Dashboard JSX（Agent 列表、详情、Prompt）
  view/model-config.tsx    内嵌模型配置 JSX（Provider 分组、搜索、Variant）
  view/ui.tsx              共享 Divider/Badge/Section/Hints
  view/model.ts            纯视图模型：状态、Prompt、权限、搜索、尺寸
  view/team.ts             数据加载、保存与恢复 RPC
tests/                     业务行为用例
```

server 不能运行时依赖宿主包。TUI 的 JSX 只放在 `view/*.tsx`，OpenTUI/Solid 由宿主运行时提供，
插件包把它们声明为 peerDependencies；详细数据流、键盘层与状态语义见 [TUI Dashboard](docs/team-tui.md)。
策略、存储、Agent 注册与迁移边界只维护在[策略契约](docs/team-policy.md)和
[团队 Agent](docs/team-agents.md)。

## 本地调试

宿主只加载当前配置指向的那一份插件，改了本仓库源码不代表宿主会看到：

- 全局 `plugins` 写 `"@justsilver/opencode-team"` 时，运行的是 npm 已发布版本，本地改动无效；
- 调试本仓库改动时，把该项换成插件目录的绝对路径，并移除 npm 同名项（同一插件 ID 不能并存）：

  ```json
  { "package": "D:\\Code\\Projects\\Agents\\opencode-subagent-model\\plugin\\opencode-team" }
  ```

- 改完配置与代码后完全退出并重新启动 OpenCode；TUI 入口只在启动时加载，不存在热更新；
- 要让用户拿到改动，只能按「npm 分发」升版本发布，不能在本地验证通过后假定已生效。

## 验证

```bash
npm install --no-package-lock
npm run typecheck
node --test
npx --yes esbuild plugin/opencode-team/index.ts --bundle --platform=node --format=esm --outfile=dist/team-server.js
npx --yes esbuild plugin/opencode-team/tui.ts --bundle --platform=node --format=esm --jsx=automatic --jsx-import-source=@opentui/solid --external:@opencode/plugin/tui --external:@opentui/core --external:@opentui/solid --external:solid-js --outfile=dist/team-tui.js
npm pack --dry-run
git diff --check
```

TUI 注入包必须标为 external。测试仅模拟宿主存储、钩子、Agent 转换、模型目录、插件列表和 UI 等外部边界；
不把假件测试称为真机交互验证，不为覆盖率新增类型/常量断言。TUI 的键盘与尺寸冒烟可按
[TUI Dashboard](docs/team-tui.md#验证) 由人工在本地用宿主同版本的 `@opentui/solid` 临时渲染测试完成；
agent 不生成或提交临时渲染测试、探针和截图，临时文件不提交。

## npm 分发

版本单一来源为 `package.json`；发布前同步 CHANGELOG 并完成上述验证。
`publishConfig.tag = next`，npm 包白名单仅包含插件源码与 CHANGELOG；README、LICENSE 由 npm 自动收录。

流水线：`ci.yml` 在 push `main` / PR 上跑版本一致性 + 类型检查 + 单测 + 双入口构建 + 打包预检；
`release.yml` 用 npm Trusted Publishing（OIDC，无长期 token）发版：

| 触发 | 行为 |
|---|---|
| push 预发布 tag（如 `v0.2.0-beta.0`） | 校验版本一致 → `npm publish --tag next` → 建/更新 GitHub Release（标 prerelease） |
| push 正式 tag（如 `v0.2.0`） | **拦下并报错**，正式版只能手动发 |
| 手动 Run workflow（默认 `publish=false`） | 只做 `npm pack --dry-run` |
| 手动 Run workflow（`publish=true` [+ 正式版需 `stable=true`]） | 发布当前版本，并补建 tag 与 Release |

### 首次发布（人工一次）

新包名 `@justsilver/opencode-team` 是全新的 npm 包，OIDC 无法创建新包（`PUT` 报 404），
所以**第一个版本必须在交互终端手工发**：

```bash
npm login
npm whoami
node scripts/changelog.mjs check --tag v0.2.0
npm publish --tag next
npm view @justsilver/opencode-team dist-tags versions --json
```

首发后到 npm → 该包 → Settings → Trusted publishing 登记仓库、Workflow filename `release.yml`、
Environment 留空，并允许 `npm publish`；新配置须在 2 天内完成一次成功发布，否则过期。
GitHub 仓库已改名为 `Just-Silver/opencode-team`，`package.json` 的 homepage/repository/bugs
已同步；登记 trusted publisher 时使用该仓库名。

首发后必须核对实际 dist-tag，不能仅靠 `--tag next` 假定 `latest` 一定不存在。
正式版只走手动 dispatch；不要复用已经发布或撤回的版本号。

### 旧包弃用（已执行）

旧包 `@justsilver/opencode-subagent-model` 的全部版本已执行：

```bash
npm deprecate @justsilver/opencode-subagent-model "Renamed to @justsilver/opencode-team; see migration guide"
```

规则：

1. 旧包保留可安装，不撤包，避免已锁版本的用户无法重装；
2. 不再向旧包发布新版本，只通过 deprecate 提示迁移；
3. 需要改提示文案时重复执行 `npm deprecate`（可只针对单个版本范围），不要再发版本。

发布后 npm 可能存在元数据与 tarball 的传播延迟；确认版本、标签和 tarball 都可取后再宣告可安装。
不要用 `npm publish --dry-run` 替代打包预检。
